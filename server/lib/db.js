// ============================================================
// ClassBoard · 数据访问层（better-sqlite3）
// ============================================================
import Database from 'better-sqlite3'
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
  name TEXT NOT NULL UNIQUE,
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

/** 当前学期 id（未设置时为 null） */
export function getCurrentSemesterId() {
  const v = getSetting('current_semester_id')
  return v ? Number(v) : null
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
