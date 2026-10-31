// ============================================================
// ClassBoard · 日期与周次工具
// ============================================================
import type { Semester, Weekday } from '@/types'

/** 解析 YYYY-MM-DD 为本地 Date（避免 UTC 偏移） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 格式化为 YYYY-MM-DD */
export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 月份+日，如 "9月4日" */
export function formatMonthDay(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 星期几（1=周一 … 7=周日） */
export function getWeekday(d: Date): Weekday {
  const js = d.getDay() // 0=周日
  return ((js + 6) % 7 + 1) as Weekday
}

/** 某日期所在周的起始日（按 weekStartDay 对齐：周一起算或周日起算） */
export function weekStartOf(date: Date, weekStartDay: 1 | 7): Date {
  const off = (((date.getDay() - weekStartDay) % 7) + 7) % 7
  const start = new Date(date)
  start.setDate(date.getDate() - off)
  return start
}

/**
 * 计算日期在学期中的周序号。
 * 算法与服务端 server/lib/weekspan.js 的 weekNumberIn 完全一致：
 * 以 weekStartDay 对齐「周起点」，周序号 = 目标周起始日与学期首周起始日相差的周数 + 1。
 * @returns 0=未开学（早于起始日）；null=学期已结束（晚于结束日）；1..n=第几周
 */
export function calcWeekNumber(
  date: Date,
  semester: Pick<Semester, 'startDate' | 'endDate' | 'weekStartDay'>,
): number | null {
  const start = parseDate(semester.startDate)
  const end = parseDate(semester.endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (date.getTime() < start.getTime()) return 0
  if (date.getTime() > end.getTime()) return null
  const weeks = Math.round(
    (weekStartOf(date, semester.weekStartDay).getTime() - weekStartOf(start, semester.weekStartDay).getTime()) /
      (7 * 24 * 60 * 60 * 1000),
  )
  return weeks + 1
}

/** 获取某周（以周一为锚）的 7 天日期列表 */
export function weekDates(anchorMonday: Date): Date[] {
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(anchorMonday)
    d.setDate(anchorMonday.getDate() + i)
    days.push(d)
  }
  return days
}

/** 将周一锚点平移到所在周的周一（任意日 -> 所在周周一） */
export function toMonday(d: Date): Date {
  const js = d.getDay()
  const diff = js === 0 ? -6 : 1 - js
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  return monday
}

/** 单双周判定：奇数为单周 */
export function isOddWeek(weekNumber: number | null): boolean {
  if (weekNumber === null) return false
  return weekNumber % 2 === 1
}


