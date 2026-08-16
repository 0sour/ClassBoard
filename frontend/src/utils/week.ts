// ============================================================
// ClassBoard · 日期与周次工具
// ============================================================
import type { Semester, Weekday, WeekType } from '@/types'

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

/** 计算日期在学期中的周序号。
 * @returns 周序号（从 1 起）；日期早于学期起始日返回 0，晚于学期结束日返回 null（假期）。
 */
export function calcWeekNumber(
  date: Date,
  semester: Pick<Semester, 'startDate' | 'endDate' | 'weekStartDay'>,
): number | null {
  const start = parseDate(semester.startDate)
  const end = parseDate(semester.endDate)
  if (date.getTime() < start.getTime()) return 0
  const offset = semester.weekStartDay === 7 ? 1 : 0 // 周起始对齐：周日=7 时平移 1 天
  const dayMs = 24 * 60 * 60 * 1000
  const diff = Math.floor((date.getTime() - start.getTime()) / dayMs) + offset
  const week = Math.floor(diff / 7) + 1
  if (date.getTime() > end.getTime()) return null
  return week
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

/** 判断周规则在指定周序号是否可见 */
export function isVisibleInWeek(
  weekType: WeekType,
  weekList: number[] | null,
  weekNumber: number | null,
): boolean {
  if (weekNumber === null) return false
  switch (weekType) {
    case 'all':
      return true
    case 'odd':
      return isOddWeek(weekNumber)
    case 'even':
      return !isOddWeek(weekNumber)
    case 'custom':
      return weekList !== null && weekList.includes(weekNumber)
  }
}

/** 展开周规则为规范表示（供测试与展示） */
export function normalizeWeekType(weekType: WeekType, weekList: number[] | null): {
  weekType: WeekType
  weekList: number[] | null
} {
  if (weekType === 'custom' && weekList === null) {
    return { weekType: 'all', weekList: null }
  }
  return { weekType, weekList }
}
