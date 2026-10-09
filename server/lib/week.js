// ============================================================
// ClassBoard · 学期与周次计算
// 公式与 frontend/src/utils/week.ts 完全一致（同一套 weekspan 数学）
// ============================================================
import { db } from './db.js'
import { getCurrentSemesterId as getCurrentSemesterIdRaw, toSemester as rowToSemester } from './db.js'
import { fmtDate, weekNumberIn, weekStartOf } from './weekspan.js'

/**
 * 周序号：返回 0=未开学（早于起始日）、null=学期已结束（假期）、1..n=第几周
 * 与服务端 weekspan.weekNumberIn、前端 utils/week.ts 完全一致（同一套公式）。
 * @param dateStr YYYY-MM-DD
 */
export function calcWeekNumber(dateStr, semester) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return null
  return weekNumberIn(semester.startDate, semester.endDate, semester.weekStartDay, date)
}

/** 指定日期所在周的起止日（按学期 weekStartDay 对齐） */
export function weekRange(dateStr, weekStartDay) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const start = weekStartOf(date, weekStartDay)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

/** 当前学期的完整行（按用户；未设置时为 null） */
export function getCurrentSemester(userId) {
  const id = getCurrentSemesterIdRaw(userId)
  if (id === null) return null
  const row = db.prepare('SELECT * FROM semester WHERE id = ? AND user_id = ?').get(id, userId)
  return row ? rowToSemester(row) : null
}
