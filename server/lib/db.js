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
  fmtDate,
  normalizeInts,
  parseLocalDate,
  periodRange,
  semesterWeekCount,
  weekStartOf,
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
-- 班级：一门班级一行；school + name 为去重键（同名即同一个班）
CREATE TABLE IF NOT EXISTS class (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school TEXT NOT NULL,
  name TEXT NOT NULL,
  major TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  current_semester_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (school, name)
);

-- 学期归属班级（班级 → 多个学期 → 课表）
CREATE TABLE IF NOT EXISTS semester (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  week_start_day INTEGER NOT NULL CHECK (week_start_day IN (1, 7)),
  updated_at TEXT NOT NULL,
  UNIQUE (name, class_id)
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
  remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 学期日历：日期级规则。
--   holiday = 该日放假（不上课）
--   shift   = 整日移课：把 date 这一天的课移到 to_date（源日显示调休、目标日显示源日当天的课）
-- 放假支持区间录入（逐日展开存储）；移课是「某日 → 某日」的一对一关系。
CREATE TABLE IF NOT EXISTS semester_day_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('holiday', 'shift')),
  to_date TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_day_rule_unique ON semester_day_rule (semester_id, date);

-- 单课日期调整：停课 / 调课 / 补课。基准课表（course_slot）不改动，读取时叠加。
CREATE TABLE IF NOT EXISTS course_adjustment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cancel', 'move', 'extra')),
  from_weekday INTEGER,
  from_periods TEXT NOT NULL DEFAULT '[]',
  to_date TEXT,
  periods TEXT NOT NULL DEFAULT '[]',
  location TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adjust_course_date ON course_adjustment (course_id, date);
CREATE INDEX IF NOT EXISTS idx_adjust_to_date ON course_adjustment (to_date);
`)

// ============================================================
// 账号与班级：user / session / user_setting / class / class_member / notice / change_log
//   角色只有两类：admin（平台管理员）与 leader（班级负责人）
//   业务数据归属「班级」：semester.class_id，其余表经学期派生
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
      role TEXT NOT NULL DEFAULT 'leader' CHECK (role IN ('admin', 'leader')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'rejected')),
      school TEXT NOT NULL DEFAULT '',
      major TEXT NOT NULL DEFAULT '',
      claimed_class TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      reviewed_by INTEGER,
      reviewed_at TEXT,
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
  `)
  const adminHash = hashPassphraseForMigration()
  db.prepare('INSERT INTO user (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(
    'admin',
    adminHash,
    'admin',
    new Date().toISOString(),
  )
  console.log('[migrate] 初始化：admin 用户已创建')
}

// 班级成员 / 通知 / 变更记录（class 表已在上方基础建表中创建）
db.exec(`
  -- 班级成员：同级无 owner 之分，一个班可有多名负责人
  CREATE TABLE IF NOT EXISTS class_member (
    class_id INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (class_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_class_member_user ON class_member (user_id);

  -- 班级通知：负责人手工发布（date 为关键信息，默认今天，列表按 置顶 + date 倒序）
  CREATE TABLE IF NOT EXISTS notice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notice_class_date ON notice (class_id, date DESC, id DESC);

  -- 变更记录（git 式）：每条写操作一条，before/after 为字段级 diff 的原始快照
  CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER,
    actor_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    before TEXT,
    after TEXT,
    revert_of INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_change_class ON change_log (class_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_change_entity ON change_log (entity, entity_id);
`)

// （原「学期名称按用户唯一」迁移已并入班级平台迁移：semester 统一重建为 UNIQUE(name, class_id)）

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

// ============================================================
// 学期日历迁移：调休由「按周几课表」改为「整日移课（某日 → 某日）」
// 旧表：kind IN ('holiday','follow') + follow_weekday，无 to_date
// 新表：kind IN ('holiday','shift')  + to_date
// 幂等：仅当表存在且缺 to_date 列时重建；旧 follow 行无损转换为 shift
// （源日 = 该周内 follow_weekday 对应的那一天，目标日 = 原来的 date），
// 学期信息缺失时退化为 holiday，避免静默丢数据。
// ============================================================
{
  const ruleCols = db.prepare("SELECT name FROM pragma_table_info('semester_day_rule')").all().map((r) => r.name)
  if (ruleCols.length && !ruleCols.includes('to_date')) {
    const legacyRows = db.prepare('SELECT * FROM semester_day_rule').all()
    db.pragma('foreign_keys = OFF')
    const run = db.transaction(() => {
      db.exec(`
        CREATE TABLE semester_day_rule_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('holiday', 'shift')),
          to_date TEXT,
          note TEXT NOT NULL DEFAULT ''
        );
      `)
      const ins = db.prepare(
        'INSERT INTO semester_day_rule_new (id, semester_id, date, kind, to_date, note) VALUES (?, ?, ?, ?, ?, ?)',
      )
      const getSem = db.prepare('SELECT * FROM semester WHERE id = ?')
      let converted = 0
      for (const r of legacyRows) {
        if (r.kind === 'follow' && r.follow_weekday) {
          const sem = getSem.get(r.semester_id)
          if (sem) {
            // 旧规则：date 当天按「该周 follow_weekday」上课 → 新规则：把那一天（源日）的课移到 date
            const weekStart = weekStartOf(parseLocalDate(r.date), sem.week_start_day)
            const source = new Date(weekStart)
            source.setDate(weekStart.getDate() + ((((r.follow_weekday - sem.week_start_day) % 7) + 7) % 7))
            ins.run(r.id, r.semester_id, fmtDate(source), 'shift', r.date, r.note)
            converted++
            continue
          }
        }
        ins.run(r.id, r.semester_id, r.date, 'holiday', null, r.note)
      }
      db.exec('DROP TABLE semester_day_rule; ALTER TABLE semester_day_rule_new RENAME TO semester_day_rule;')
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_day_rule_unique ON semester_day_rule (semester_id, date)')
      console.log(
        `[migrate] 学期日历改为「整日移课」：${legacyRows.length} 条规则（其中 ${converted} 条旧「按周几课表」已转换为移课）`,
      )
    })
    try {
      run()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }
}

// ============================================================
// 班级平台迁移（P1）：账号/班级模型 + 归属由「用户」改为「班级」
//   1) user 重建：role IN ('admin','leader') + 审批状态与申请资料字段
//   2) semester 重建：class_id 取代 user_id，UNIQUE(name, class_id)
//   3) period_template / course / exam / homework 去掉 user_id（归属经学期派生）
//   4) 旧账号 → 各建一个班级（学校留空、班级名 = 用户名）并成为负责人，保证升级不丢数据；
//      生产库另由一次性脚本把该班改名为「示例2301」、清理不再保留的账号
//   5) 模板功能整体删除：DROP template / import_log
// 幂等：以 semester 缺少 class_id 列为界（新库建表时即带 class_id，不触发）
// ============================================================
{
  const semColsProbe = db.prepare("SELECT name FROM pragma_table_info('semester')").all().map((r) => r.name)
  if (semColsProbe.length && !semColsProbe.includes('class_id')) migrateToClassPlatform()
}

// ============================================================
// P2 清理：作业改为班级公示（去掉个人 done 列）、移除个人提醒设置
// 幂等：以 homework 是否仍含 done 列 / 是否仍有 reminder 键为界
// ============================================================
{
  const hwCols = db.prepare("SELECT name FROM pragma_table_info('homework')").all().map((r) => r.name)
  if (hwCols.includes('done')) {
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE homework_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
            course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            due_at TEXT NOT NULL,
            remark TEXT NOT NULL DEFAULT ''
          );
          INSERT INTO homework_new (id, semester_id, course_id, name, due_at, remark)
            SELECT id, semester_id, course_id, name, due_at, remark FROM homework;
          DROP TABLE homework;
          ALTER TABLE homework_new RENAME TO homework;
        `)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
    console.log('[migrate] 作业改为班级公示：done 个人完成态已移除')
  }
  const removed = db
    .prepare("DELETE FROM user_setting WHERE key IN ('reminder', 'lab_reminder', 'homework_reminder')")
    .run()
  const removedLegacy = db
    .prepare("DELETE FROM setting WHERE key IN ('reminder', 'lab_reminder', 'homework_reminder')")
    .run()
  if (removed.changes || removedLegacy.changes) console.log('[migrate] 个人提醒设置已移除（浏览器提醒功能下线）')
}

// ============================================================
// 附件（作业 / 考试的图片与文件）
//   attachment = 元数据行（挂在 exam 或 homework 上，级联删除）
//   blob       = 文件内容，内容寻址（sha256 主键）且**不随删除清理** ——
//                撤销 / 整班回退 / 导出导入都能按哈希把内容原样接回来
// 幂等：CREATE TABLE IF NOT EXISTS
// ============================================================
{
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER REFERENCES exam(id) ON DELETE CASCADE,
      homework_id INTEGER REFERENCES homework(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      CHECK ((exam_id IS NULL) != (homework_id IS NULL))
    );
    CREATE TABLE IF NOT EXISTS blob (
      sha256 TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachment_exam ON attachment(exam_id);
    CREATE INDEX IF NOT EXISTS idx_attachment_homework ON attachment(homework_id);
  `)
}

function migrateToClassPlatform() {
  const snap = createSnapshotSync(db, DATA_DIR, 'pre-class-migration')
  console.log('[migrate] 班级平台迁移开始，快照：' + snap)
  const now = new Date().toISOString()
  const cols = (t) => db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name)

  db.pragma('foreign_keys = OFF')
  const run = db.transaction(() => {
    // 1) user 重建：旧 role 'user' → 'leader'，新增审批与申请资料字段
    if (!cols('user').includes('status')) {
      db.exec(`
        CREATE TABLE user_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'leader' CHECK (role IN ('admin', 'leader')),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'rejected')),
          school TEXT NOT NULL DEFAULT '',
          major TEXT NOT NULL DEFAULT '',
          claimed_class TEXT NOT NULL DEFAULT '',
          review_note TEXT NOT NULL DEFAULT '',
          reviewed_by INTEGER,
          reviewed_at TEXT,
          disabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          last_login_at TEXT
        );
      `)
      db.prepare(
        `INSERT INTO user_new (id, username, password_hash, role, status, disabled, created_at, last_login_at)
         SELECT id, username, password_hash, CASE role WHEN 'admin' THEN 'admin' ELSE 'leader' END,
                'active', disabled, created_at, last_login_at FROM user`,
      ).run()
      db.exec('DROP TABLE user; ALTER TABLE user_new RENAME TO user;')
    }

    // 2) 旧账号 → 班级（有学期数据的账号各得一班，班级名 = 用户名）
    const semCols = cols('semester')
    const hasUserId = semCols.includes('user_id')
    const semesterCount = db.prepare('SELECT COUNT(*) AS c FROM semester').get().c
    const firstUserId = db.prepare('SELECT id FROM user ORDER BY id ASC LIMIT 1').get()?.id ?? null
    const ownerIds =
      semesterCount === 0
        ? []
        : hasUserId
          ? db.prepare('SELECT DISTINCT user_id FROM semester WHERE user_id IS NOT NULL').all().map((r) => r.user_id)
          : [firstUserId]
    const insClass = db.prepare(
      'INSERT INTO class (school, name, major, city, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    const insMember = db.prepare(
      'INSERT OR IGNORE INTO class_member (class_id, user_id, joined_at) VALUES (?, ?, ?)',
    )
    const classByUser = new Map()
    for (const uid of ownerIds) {
      const u = db.prepare('SELECT id, username FROM user WHERE id = ?').get(uid)
      if (!u) continue
      const info = insClass.run('', u.username, '', '', u.id, now, now)
      classByUser.set(uid, info.lastInsertRowid)
      insMember.run(info.lastInsertRowid, u.id, now)
    }

    // 3) semester 重建：class_id 取代 user_id
    db.exec(`
      CREATE TABLE semester_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        week_start_day INTEGER NOT NULL CHECK (week_start_day IN (1, 7)),
        updated_at TEXT NOT NULL,
        UNIQUE (name, class_id)
      );
    `)
    const insSem = db.prepare(
      'INSERT INTO semester_new (id, class_id, name, start_date, end_date, week_start_day, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    let movedSemesters = 0
    let orphanSemesters = 0
    for (const s of db.prepare('SELECT * FROM semester').all()) {
      const cid = hasUserId ? classByUser.get(s.user_id) : classByUser.get(firstUserId)
      if (cid == null) {
        orphanSemesters++
        continue
      }
      insSem.run(s.id, cid, s.name, s.start_date, s.end_date, s.week_start_day, s.updated_at)
      movedSemesters++
    }
    db.exec('DROP TABLE semester; ALTER TABLE semester_new RENAME TO semester;')

    // 4) 其余业务表去掉 user_id（归属经 semester.class_id 派生）
    const rebuilds = {
      period_template: [
        `CREATE TABLE period_template_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
          period_index INTEGER NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          UNIQUE (semester_id, period_index)
        );`,
        ['id', 'semester_id', 'period_index', 'start_time', 'end_time'],
      ],
      course: [
        `CREATE TABLE course_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('course', 'lab')),
          name TEXT NOT NULL,
          teacher TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT 'course-1',
          remark TEXT NOT NULL DEFAULT ''
        );`,
        ['id', 'semester_id', 'type', 'name', 'teacher', 'location', 'color', 'remark'],
      ],
      exam: [
        `CREATE TABLE exam_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
          course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          datetime TEXT NOT NULL,
          location TEXT NOT NULL DEFAULT '',
          remark TEXT NOT NULL DEFAULT ''
        );`,
        ['id', 'semester_id', 'course_id', 'name', 'datetime', 'location', 'remark'],
      ],
      homework: [
        `CREATE TABLE homework_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
          course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          due_at TEXT NOT NULL,
          done INTEGER NOT NULL DEFAULT 0,
          remark TEXT NOT NULL DEFAULT ''
        );`,
        ['id', 'semester_id', 'course_id', 'name', 'due_at', 'done', 'remark'],
      ],
    }
    for (const [table, [ddl, keep]] of Object.entries(rebuilds)) {
      if (!cols(table).includes('user_id')) continue
      db.exec(ddl)
      const list = keep.join(', ')
      db.exec(`INSERT INTO ${table}_new (${list}) SELECT ${list} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table};`)
    }

    // 5) 每个班级的当前学期：沿用原 user_setting.current_semester_id，否则取该班最早的学期
    const setCur = db.prepare('UPDATE class SET current_semester_id = ? WHERE id = ?')
    for (const r of db.prepare("SELECT user_id, value FROM user_setting WHERE key = 'current_semester_id'").all()) {
      const cid = classByUser.get(r.user_id)
      if (cid != null) setCur.run(Number(r.value), cid)
    }
    db.prepare("DELETE FROM user_setting WHERE key = 'current_semester_id'").run()
    db.exec(`UPDATE class SET current_semester_id = (
        SELECT id FROM semester WHERE semester.class_id = class.id ORDER BY start_date ASC, id ASC LIMIT 1
      ) WHERE current_semester_id IS NULL OR current_semester_id NOT IN (SELECT id FROM semester);`)

    // 6) 天气城市：沿用原全站配置里的城市，作为各班的初始城市（负责人可改）
    let city = ''
    try {
      const row =
        db.prepare("SELECT value FROM user_setting WHERE key = 'weather' ORDER BY user_id ASC LIMIT 1").get() ??
        db.prepare("SELECT value FROM setting WHERE key = 'weather'").get()
      if (row) {
        const cfg = JSON.parse(row.value) ?? {}
        city = String(cfg.city ?? cfg.location ?? '').trim()
      }
    } catch {
      /* 配置解析失败时留空 */
    }
    if (city) db.prepare("UPDATE class SET city = ? WHERE city = ''").run(city)

    // 7) 单用户时代的全局设置并入管理员的个人设置
    if (db.prepare('SELECT COUNT(*) AS c FROM user_setting').get().c === 0) {
      const admin = db.prepare("SELECT id FROM user WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get()
      if (admin) {
        const ins = db.prepare('INSERT OR IGNORE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)')
        for (const s of db.prepare('SELECT key, value FROM setting').all()) {
          if (s.key === 'access_hash') continue
          ins.run(admin.id, s.key, s.value)
        }
      }
    }

    // 8) 模板功能整体删除
    db.exec('DROP TABLE IF EXISTS import_log; DROP TABLE IF EXISTS template;')

    console.log(
      `[migrate] 班级平台迁移完成：${classByUser.size} 个班级（承接 ${movedSemesters} 个学期` +
        (orphanSemesters ? `，${orphanSemesters} 个无主学期已跳过` : '') +
        '）、user 角色改为 admin/leader、模板表已删除',
    )
  })
  try {
    run()
  } catch (err) {
    console.error('[migrate] 班级平台迁移失败，可从快照恢复：' + snap, err)
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

/** 班级当前学期 id */
export function getClassCurrentSemesterId(classId) {
  const row = db.prepare('SELECT current_semester_id AS id FROM class WHERE id = ?').get(classId)
  return row?.id ?? null
}

export function setClassCurrentSemesterId(classId, id) {
  db.prepare('UPDATE class SET current_semester_id = ?, updated_at = ? WHERE id = ?').run(
    id,
    new Date().toISOString(),
    classId,
  )
}

export function clearClassCurrentSemesterId(classId) {
  db.prepare('UPDATE class SET current_semester_id = NULL, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    classId,
  )
}

/** 学期行 → API 对象 */
export function toSemester(row) {
  if (!row) return null
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    weekStartDay: row.week_start_day,
  }
}

/** 班级行 → API 对象 */
export function toClass(row) {
  if (!row) return null
  return {
    id: row.id,
    school: row.school,
    name: row.name,
    major: row.major,
    city: row.city,
    currentSemesterId: row.current_semester_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 班级通知行 → API 对象 */
export function toNotice(row) {
  if (!row) return null
  return {
    id: row.id,
    classId: row.class_id,
    date: row.date,
    title: row.title,
    body: row.body,
    courseId: row.course_id,
    pinned: !!row.pinned,
    authorId: row.author_id,
    authorName: row.author_name ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    remark: row.remark,
  }
}

/** 学期日历规则行 → API 对象（holiday=放假；shift=把该日的课移到 toDate） */
export function toDayRule(row) {
  return {
    id: row.id,
    semesterId: row.semester_id,
    date: row.date,
    kind: row.kind,
    toDate: row.to_date,
    note: row.note,
  }
}

/** 单课调整行 → API 对象（节次为逐项整数数组） */
export function toAdjustment(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    date: row.date,
    kind: row.kind,
    fromWeekday: row.from_weekday,
    fromPeriods: normalizeInts(safeParseInts(row.from_periods)),
    toDate: row.to_date,
    periods: normalizeInts(safeParseInts(row.periods)),
    location: row.location,
    note: row.note,
    createdAt: row.created_at,
  }
}

export { DATA_DIR }
