// ============================================================
// ClassBoard · 学期与周次计算（技术文档 3.2.3 / 3.2.5）
// ============================================================
import { db } from './db.js'

/**
 * 周序号算法（技术文档 3.2.3）：
 * offset = (date.getDay() - weekStartDay + 7) % 7
 * weekNumber = floor((date - S + offset) / 7天) + 1
 * 返回 null 表示不在学期内（假期/未开学）。
 */
export function calcWeekNumber(dateStr, semester) {
  const s = parseLocalDate(semester.startDate)
  const d = parseLocalDate(dateStr)
  if (Number.isNaN(s.getTime()) || Number.isNaN(d.getTime())) return null
  const offset = (d.getDay() - semester.weekStartDay + 7) % 7
  const days = Math.floor((d - s) / 86400000) + offset
  const week = Math.floor(days / 7) + 1
  if (week < 1) return null
  const end = parseLocalDate(semester.endDate)
  if (d > end) return null
  return week
}

export function isOddWeek(weekNumber) {
  return weekNumber != null && weekNumber % 2 === 1
}

function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 指定日期所在周的起止日（按学期 weekStartDay 对齐） */
export function weekRange(dateStr, weekStartDay) {
  const d = parseLocalDate(dateStr)
  const offset = (d.getDay() - weekStartDay + 7) % 7
  const start = new Date(d)
  start.setDate(d.getDate() - offset)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

/**
 * 课程周可见性（技术文档 3.2.5）。
 * @param weekType all/odd/even/custom
 * @param weekList number[] | null
 * @param weekNumber number | null（null 表示不在学期内 → 全部可见，供"未设置当前学期"时用）
 * @param filter 是否启用单双周过滤（默认启用）
 */
export function isCourseVisible(weekType, weekList, weekNumber, filter = true) {
  if (weekNumber === null) return true
  if (weekType === 'all') {
    if (!weekList || weekList.length === 0) return true
    return weekList.includes(weekNumber)
  }
  if (weekType === 'custom') {
    return !!weekList && weekList.includes(weekNumber)
  }
  // odd / even：关闭单双周过滤时退化为按 week_list（或全部周）显示，不判奇偶
  if (!filter) {
    if (!weekList || weekList.length === 0) return true
    return weekList.includes(weekNumber)
  }
  const matchesParity = weekType === 'odd' ? isOddWeek(weekNumber) : !isOddWeek(weekNumber)
  if (!matchesParity) return false
  if (!weekList || weekList.length === 0) return true
  return weekList.includes(weekNumber)
}

/** 当前学期的完整行（未设置时为 null） */
export function getCurrentSemester() {
  const id = getCurrentSemesterIdRaw()
  if (id === null) return null
  const row = db.prepare('SELECT * FROM semester WHERE id = ?').get(id)
  return row ? rowToSemester(row) : null
}

import { getCurrentSemesterId as getCurrentSemesterIdRaw, toSemester as rowToSemester } from './db.js'
