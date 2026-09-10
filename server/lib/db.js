// ============================================================
// ClassBoard · 数据访问层（better-sqlite3）
// ============================================================
import Database from 'better-sqlite3'
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.CLASSBOARD_DATA_DIR
  ? resolve(process.env.CLASSBOARD_DATA_DIR)
  : resolve(here, 'data')
mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(resolve(DATA_DIR, 'classboard.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 3000')

db.exec(`
CREATE TABLE IF NOT EXISTS semester (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  week_start_day INTEGER NOT NULL CHECK (week_start_day IN (1, 7)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS period_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  period_index INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  UNIQUE (semester_id, period_index)
);

CREATE TABLE IF NOT EXISTS course (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('course', 'lab')),
  name TEXT NOT NULL,
  teacher TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'course-1',
  week_type TEXT NOT NULL CHECK (week_type IN ('all', 'odd', 'even', 'custom')),
  week_list TEXT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_period INTEGER NOT NULL,
  end_period INTEGER NOT NULL,
  remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS exam (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  datetime TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS homework (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  due_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)

// ============================================================
// 多用户迁移：user / session / user_setting 表 + 业务表 user_id 列
// 幂等：已存在则跳过；现有数据归入自动创建的 admin 用户
// ============================================================
const hasUserTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'")
  .get()
if (!hasUserTable) {
  db.exec(`
    CREATE TABLE user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('access', 'remember')),
      device_name TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE user_setting (
      user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    ALTER TABLE semester ADD COLUMN user_id INTEGER;
    ALTER TABLE period_template ADD COLUMN user_id INTEGER;
    ALTER TABLE course ADD COLUMN user_id INTEGER;
    ALTER TABLE exam ADD COLUMN user_id INTEGER;
    ALTER TABLE homework ADD COLUMN user_id INTEGER;
  `)
  // 现有数据归入 admin（先建 admin 再回填 user_id）
  const adminHash = hashPassphraseForMigration()
  const info = db
    .prepare('INSERT INTO user (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run('admin', adminHash, 'admin', new Date().toISOString())
  const adminId = info.lastInsertRowid
  for (const t of ['semester', 'period_template', 'course', 'exam', 'homework']) {
    db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(adminId)
  }
  // 全局设置迁移为 admin 的用户设置（current_semester_id 与业务设置）
  const globalSettings = db.prepare('SELECT key, value FROM setting').all()
  const insUserSetting = db.prepare(
    'INSERT OR IGNORE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)',
  )
  for (const s of globalSettings) {
    if (s.key === 'access_hash') continue // 口令哈希不迁移（被账号体系取代）
    insUserSetting.run(adminId, s.key, s.value)
  }
  console.log('[migrate] 多用户迁移完成：admin 用户 id=' + adminId)
}

// ============================================================
// 模板迁移：template / import_log 表（幂等）
// ============================================================
const hasTemplateTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='template'")
  .get()
if (!hasTemplateTable) {
  db.exec(`
    CREATE TABLE template (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES template(id) ON DELETE CASCADE,
      template_version INTEGER NOT NULL,
      semester_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      count INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
  `)
  console.log('[migrate] 模板表迁移完成')
}

// 模板类型列：course=单门课程模板 / unit=组合模板（引用课程模板 id 数组）
const hasKindColumn = db
  .prepare("SELECT name FROM pragma_table_info('template') WHERE name = 'kind'")
  .get()
if (!hasKindColumn) {
  db.exec("ALTER TABLE template ADD COLUMN kind TEXT NOT NULL DEFAULT 'unit'")
  console.log('[migrate] 模板表加 kind 列')
}

// 学期名称唯一性：全局 UNIQUE → 按用户唯一（多用户下不同用户可同名学期）
// SQLite 无法直接改约束，重建表迁移
const semUnique = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='semester'")
  .get()
if (semUnique && /name TEXT NOT NULL UNIQUE/.test(semUnique.sql)) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE semester_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      week_start_day INTEGER NOT NULL CHECK (week_start_day IN (1, 7)),
      updated_at TEXT NOT NULL,
      user_id INTEGER,
      UNIQUE (name, user_id)
    );
    INSERT INTO semester_new (id, name, start_date, end_date, week_start_day, updated_at, user_id)
      SELECT id, name, start_date, end_date, week_start_day, updated_at, user_id FROM semester;
    DROP TABLE semester;
    ALTER TABLE semester_new RENAME TO semester;
    PRAGMA foreign_keys = ON;
  `)
  console.log('[migrate] semester 表重建：name 唯一性改为按用户')
}

/** 迁移用：生成 admin 初始密码哈希（随机 16 位，打印到日志，首次登录后应修改） */
function hashPassphraseForMigration() {
  const pass = randomBytes(8).toString('hex')
  const salt = randomBytes(16)
  const hash = scryptSync(pass, salt, 32).toString('hex')
  console.log('[migrate] admin 初始密码：' + pass + '（请登录后立即修改）')
  return `${salt.toString('hex')}:${hash}`
}

/** 默认节次模板（创建学期时自动生成，含晚自习，见技术文档 4.3.1） */
export const DEFAULT_PERIODS = [
  ['08:00', '08:45'],
  ['08:55', '09:40'],
  ['10:00', '10:45'],
  ['10:55', '11:40'],
  ['14:00', '14:45'],
  ['14:55', '15:40'],
  ['16:00', '16:45'],
  ['16:55', '17:40'],
  ['19:00', '19:45'],
  ['19:55', '20:40'],
  ['20:50', '21:35'],
  ['21:45', '22:30'],
]

/** 读取设置（返回 undefined 表示未设置） */
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key)
  return row ? row.value : undefined
}

/** 写入设置 */
export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

/** 删除设置 */
export function deleteSetting(key) {
  db.prepare('DELETE FROM setting WHERE key = ?').run(key)
}

/** 当前学期 id（按用户；未设置时为 null） */
export function getCurrentSemesterId(userId) {
  const row = db
    .prepare('SELECT value FROM user_setting WHERE user_id = ? AND key = ?')
    .get(userId, 'current_semester_id')
  return row ? Number(row.value) : null
}

/** 设置当前学期（按用户） */
export function setCurrentSemesterId(userId, id) {
  db.prepare(
    'INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  ).run(userId, 'current_semester_id', String(id))
}

/** 删除当前学期设置（按用户） */
export function clearCurrentSemesterId(userId) {
  db.prepare('DELETE FROM user_setting WHERE user_id = ? AND key = ?').run(userId, 'current_semester_id')
}

/** 学期行 → API 对象 */
export function toSemester(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    weekStartDay: row.week_start_day,
  }
}

/** 节次行 → API 对象 */
export function toPeriod(row) {
  return {
    id: row.id,
    semesterId: row.semester_id,
    index: row.period_index,
    startTime: row.start_time,
    endTime: row.end_time,
  }
}

/** 课程行 → API 对象（week_list 由 JSON 还原） */
export function toCourse(row) {
  return {
    id: row.id,
    semesterId: row.semester_id,
    type: row.type,
    name: row.name,
    teacher: row.teacher,
    location: row.location,
    color: row.color,
    weekType: row.week_type,
    weekList: row.week_list ? JSON.parse(row.week_list) : null,
    weekday: row.weekday,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    remark: row.remark,
  }
}

/** 考试行 → API 对象 */
export function toExam(row) {
  return {
    id: row.id,
    semesterId: row.semester_id,
    courseId: row.course_id,
    name: row.name,
    datetime: row.datetime,
    location: row.location,
    remark: row.remark,
  }
}

/** 作业行 → API 对象 */
export function toHomework(row) {
  return {
    id: row.id,
    semesterId: row.semester_id,
    courseId: row.course_id,
    name: row.name,
    dueAt: row.due_at,
    done: !!row.done,
    remark: row.remark,
  }
}
