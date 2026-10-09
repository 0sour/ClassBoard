// ============================================================
// ClassBoard · 数据访问层（better-sqlite3）
// 课程数据模型：course（课程组）→ course_session（上课时间组）→ course_slot（节×周逐格子）
// 节次与周次全部逐项展开存储，读取时由程序收起为区间/文案，不写回。
// ============================================================
import Database from 'better-sqlite3'
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSnapshotSync } from './snapshot.js'
import {
  expandWeeks,
  normalizeInts,
  periodRange,
  semesterWeekCount,
  MAX_PERIODS,
  MAX_WEEKS,
} from './weekspan.js'

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

-- 课程组：一门课一行（仅元数据；上课时间见 course_session）
CREATE TABLE IF NOT EXISTS course (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('course', 'lab')),
  name TEXT NOT NULL,
  teacher TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'course-1',
  remark TEXT NOT NULL DEFAULT ''
);

-- 上课时间组：同一星期、同一地点的一组节次×周次
CREATE TABLE IF NOT EXISTS course_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  location TEXT NOT NULL DEFAULT ''
);

-- 逐格子：一个「第几节 × 第几周」一行
CREATE TABLE IF NOT EXISTS course_slot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES course_session(id) ON DELETE CASCADE,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND ${MAX_PERIODS}),
  week INTEGER NOT NULL CHECK (week BETWEEN 1 AND ${MAX_WEEKS}),
  UNIQUE (session_id, period, week)
);

CREATE INDEX IF NOT EXISTS idx_slot_period ON course_slot (session_id, period);
CREATE INDEX IF NOT EXISTS idx_slot_week ON course_slot (week);

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
  const adminHash = hashPassphraseForMigration()
  const info = db
    .prepare('INSERT INTO user (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run('admin', adminHash, 'admin', new Date().toISOString())
  const adminId = info.lastInsertRowid
  for (const t of ['semester', 'period_template', 'course', 'exam', 'homework']) {
    db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(adminId)
  }
  const globalSettings = db.prepare('SELECT key, value FROM setting').all()
  const insUserSetting = db.prepare(
    'INSERT OR IGNORE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)',
  )
  for (const s of globalSettings) {
    if (s.key === 'access_hash') continue
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

// 模板类型列：course=单门课程模板 / unit=组合模板 / semester=学期模板
const hasKindColumn = db
  .prepare("SELECT name FROM pragma_table_info('template') WHERE name = 'kind'")
  .get()
if (!hasKindColumn) {
  db.exec("ALTER TABLE template ADD COLUMN kind TEXT NOT NULL DEFAULT 'unit'")
  console.log('[migrate] 模板表加 kind 列')
}

// 学期名称唯一性：全局 UNIQUE → 按用户唯一
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

// ============================================================
// 课程模型迁移：course 逐行（含 week_type/week_list/start_period/end_period）
//   → course 组 + course_session 上课时间组 + course_slot 逐格子
// 幂等：仅当 course 表仍含 week_type 列时执行
// ============================================================
const courseCols = db.prepare("SELECT name FROM pragma_table_info('course')").all().map((r) => r.name)
if (courseCols.includes('week_type')) {
  migrateCourseModel()
}

function migrateCourseModel() {
  const snap = createSnapshotSync(db, DATA_DIR, 'pre-migration')
  console.log('[migrate] 课程模型迁移开始，快照：' + snap)

  const legacyRows = db.prepare('SELECT * FROM course ORDER BY id ASC').all()
  const examRows = db.prepare('SELECT id, course_id FROM exam WHERE course_id IS NOT NULL').all()
  const hwRows = db.prepare('SELECT id, course_id FROM homework WHERE course_id IS NOT NULL').all()

  // 学期周数（展开 week_type='all' 等规则时的上限）
  const semesters = new Map(
    db.prepare('SELECT * FROM semester').all().map((s) => [s.id, s]),
  )

  db.pragma('foreign_keys = OFF')
  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE course_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
        user_id INTEGER,
        type TEXT NOT NULL CHECK (type IN ('course', 'lab')),
        name TEXT NOT NULL,
        teacher TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'course-1',
        remark TEXT NOT NULL DEFAULT ''
      );
    `)

    const insCourse = db.prepare(
      `INSERT INTO course_new (id, semester_id, user_id, type, name, teacher, location, color, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insSession = db.prepare(
      'INSERT INTO course_session (course_id, weekday, location) VALUES (?, ?, ?)',
    )
    const insSlot = db.prepare(
      'INSERT OR IGNORE INTO course_slot (session_id, period, week) VALUES (?, ?, ?)',
    )

    // 分组键：同用户 + 同学期 + 同类型 + 同名 + 同教师 → 合并为一门课（多个上课时间）
    const groups = new Map()
    const idMap = new Map()
    let mergedRows = 0
    let slotCount = 0
    let sessionCount = 0

    for (const row of legacyRows) {
      const key = `${row.user_id}|${row.semester_id}|${row.type}|${row.name}|${row.teacher}`
      let group = groups.get(key)
      if (!group) {
        const info = insCourse.run(
          row.id, row.semester_id, row.user_id, row.type, row.name, row.teacher, row.location, row.color, row.remark,
        )
        const courseId = info.lastInsertRowid
        group = { courseId, rows: [] }
        groups.set(key, group)
      } else {
        mergedRows++
      }
      group.rows.push(row)
      idMap.set(row.id, group.courseId)
    }

    for (const group of groups.values()) {
      // 组内补齐元数据：多行合并时取首个非空值（实验课常有多行、部分行 teacher 为空）
      const first = group.rows[0]
      const teacher = group.rows.find((r) => r.teacher)?.teacher ?? first.teacher
      const location = group.rows.find((r) => r.location)?.location ?? first.location
      const remark = group.rows.find((r) => r.remark)?.remark ?? first.remark
      const color = group.rows.find((r) => r.color)?.color ?? first.color
      db.prepare('UPDATE course_new SET teacher = ?, location = ?, remark = ?, color = ? WHERE id = ?')
        .run(teacher, location, remark, color, group.courseId)

      const sem = semesters.get(first.semester_id)
      const maxWeeks = sem
        ? semesterWeekCount(sem.start_date, sem.end_date, sem.week_start_day)
        : 16

      // 同一「星期 + 节次集合 + 地点」的多行合并为一个上课时间（周次取并集）
      const bySlotKey = new Map()
      for (const row of group.rows) {
        const weeks = expandWeeks(row.week_type, row.week_list ? safeParseInts(row.week_list) : null, maxWeeks)
        const periods = periodRange(row.start_period, row.end_period)
        if (!weeks.length || !periods.length) continue
        const key = `${row.weekday}|${periods.join('.')}|${row.location ?? ''}`
        if (!bySlotKey.has(key)) bySlotKey.set(key, { weekday: row.weekday, location: row.location ?? '', periods, weeks: new Set() })
        for (const w of weeks) bySlotKey.get(key).weeks.add(w)
      }

      for (const s of bySlotKey.values()) {
        const sInfo = insSession.run(group.courseId, s.weekday, s.location)
        sessionCount++
        for (const p of s.periods) {
          for (const w of [...s.weeks].sort((a, b) => a - b)) {
            insSlot.run(sInfo.lastInsertRowid, p, w)
            slotCount++
          }
        }
      }
    }

    // 关联重定向：exam / homework 的 course_id → 合并后的组 id
    let redirected = 0
    const updExam = db.prepare('UPDATE exam SET course_id = ? WHERE id = ?')
    for (const e of examRows) {
      const nid = idMap.get(e.course_id)
      if (nid !== undefined && nid !== e.course_id) {
        updExam.run(nid, e.id)
        redirected++
      }
    }
    const updHw = db.prepare('UPDATE homework SET course_id = ? WHERE id = ?')
    for (const h of hwRows) {
      const nid = idMap.get(h.course_id)
      if (nid !== undefined && nid !== h.course_id) {
        updHw.run(nid, h.id)
        redirected++
      }
    }

    db.exec('DROP TABLE course; ALTER TABLE course_new RENAME TO course;')
    console.log(
      `[migrate] 课程模型迁移完成：${legacyRows.length} 行 → ${groups.size} 组` +
        `（合并 ${mergedRows} 行）、${sessionCount} 个上课时间、${slotCount} 个节×周格子、重定向 ${redirected} 条关联`,
    )
  })
  try {
    run()
  } catch (err) {
    console.error('[migrate] 课程模型迁移失败，可从快照恢复：' + snap, err)
    throw err
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function safeParseInts(json) {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? normalizeInts(v) : null
  } catch {
    return null
  }
}

// ============================================================
// 查询辅助
// ============================================================

/** 课程行 + 其上课时间（收起 periods/weeks 为数组） */
export function loadCourseWithSessions(courseRow) {
  if (!courseRow) return null
  const sessions = db
    .prepare('SELECT * FROM course_session WHERE course_id = ? ORDER BY weekday ASC, id ASC')
    .all(courseRow.id)
  const slotsBySession = new Map()
  if (sessions.length) {
    const placeholders = sessions.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT session_id, period, week FROM course_slot WHERE session_id IN (${placeholders}) ORDER BY period ASC, week ASC`)
      .all(...sessions.map((s) => s.id))
    for (const r of rows) {
      if (!slotsBySession.has(r.session_id)) slotsBySession.set(r.session_id, { periods: [], weeks: [] })
      const bucket = slotsBySession.get(r.session_id)
      bucket.periods.push(r.period)
      bucket.weeks.push(r.week)
    }
  }
  return {
    id: courseRow.id,
    semesterId: courseRow.semester_id,
    type: courseRow.type,
    name: courseRow.name,
    teacher: courseRow.teacher,
    location: courseRow.location,
    color: courseRow.color,
    remark: courseRow.remark,
    sessions: sessions.map((s) => {
      const bucket = slotsBySession.get(s.id) ?? { periods: [], weeks: [] }
      return {
        id: s.id,
        weekday: s.weekday,
        location: s.location,
        periods: normalizeInts(bucket.periods),
        weeks: normalizeInts(bucket.weeks),
      }
    }),
  }
}

/** 批量：课程行数组 → API 对象（避免 N+1 查询） */
export function toCoursesWithSessions(rows) {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  const sessions = db
    .prepare(`SELECT * FROM course_session WHERE course_id IN (${placeholders}) ORDER BY weekday ASC, id ASC`)
    .all(...ids)
  const slotRows = sessions.length
    ? db
        .prepare(
          `SELECT session_id, period, week FROM course_slot WHERE session_id IN (${sessions
            .map(() => '?')
            .join(',')}) ORDER BY period ASC, week ASC`,
        )
        .all(...sessions.map((s) => s.id))
    : []
  const bySession = new Map()
  for (const r of slotRows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, { periods: [], weeks: [] })
    const bucket = bySession.get(r.session_id)
    bucket.periods.push(r.period)
    bucket.weeks.push(r.week)
  }
  const sessionsByCourse = new Map()
  for (const s of sessions) {
    if (!sessionsByCourse.has(s.course_id)) sessionsByCourse.set(s.course_id, [])
    const bucket = bySession.get(s.id) ?? { periods: [], weeks: [] }
    sessionsByCourse.get(s.course_id).push({
      id: s.id,
      weekday: s.weekday,
      location: s.location,
      periods: normalizeInts(bucket.periods),
      weeks: normalizeInts(bucket.weeks),
    })
  }
  return rows.map((row) => ({
    id: row.id,
    semesterId: row.semester_id,
    type: row.type,
    name: row.name,
    teacher: row.teacher,
    location: row.location,
    color: row.color,
    remark: row.remark,
    sessions: sessionsByCourse.get(row.id) ?? [],
  }))
}

/**
 * 写入一门课的上课时间（整组原子替换）。
 * @param courseId 课程组 id
 * @param sessions [{ weekday, location, periods:number[], weeks:number[] }]
 */
export function replaceCourseSessions(courseId, sessions) {
  db.prepare('DELETE FROM course_session WHERE course_id = ?').run(courseId)
  const insSession = db.prepare('INSERT INTO course_session (course_id, weekday, location) VALUES (?, ?, ?)')
  const insSlot = db.prepare('INSERT OR IGNORE INTO course_slot (session_id, period, week) VALUES (?, ?, ?)')
  let count = 0
  for (const s of sessions) {
    const info = insSession.run(courseId, s.weekday, s.location ?? '')
    for (const p of normalizeInts(s.periods)) {
      for (const w of normalizeInts(s.weeks)) {
        insSlot.run(info.lastInsertRowid, p, w)
        count++
      }
    }
  }
  return count
}

/** 迁移用：生成 admin 初始密码哈希 */
function hashPassphraseForMigration() {
  const pass = randomBytes(8).toString('hex')
  const salt = randomBytes(16)
  const hash = scryptSync(pass, salt, 32).toString('hex')
  console.log('[migrate] admin 初始密码：' + pass + '（请登录后立即修改）')
  return `${salt.toString('hex')}:${hash}`
}

/** 默认节次模板 */
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

/** 当前学期 id（按用户） */
export function getCurrentSemesterId(userId) {
  const row = db
    .prepare('SELECT value FROM user_setting WHERE user_id = ? AND key = ?')
    .get(userId, 'current_semester_id')
  return row ? Number(row.value) : null
}

export function setCurrentSemesterId(userId, id) {
  db.prepare(
    'INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  ).run(userId, 'current_semester_id', String(id))
}

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

export { DATA_DIR }
