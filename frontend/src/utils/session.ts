// ============================================================
// ClassBoard · 上课时间工具：展开/收起、周次与节次文案、课程块派生
// 存储侧永远是逐项数组；本模块负责读取时的展示派生（不写回）。
// ============================================================
import type { Course, CourseBlock, CourseSession, Weekday } from '@/types'

/** 周次与节次上限（与服务端 weekspan.js 一致） */
export const MAX_WEEKS = 30
export const MAX_PERIODS = 24

/** 升序去重的正整数数组 */
export function normalizeInts(arr: unknown): number[] {
  if (!Array.isArray(arr)) return []
  return [...new Set(arr.filter((n): n is number => Number.isInteger(n) && (n as number) >= 1))].sort(
    (a, b) => a - b,
  )
}

/** 升序数组 → 连续区间列表 [[a,b], ...] */
export function runsOf(sorted: number[]): [number, number][] {
  const runs: [number, number][] = []
  let start: number | null = null
  let prev: number | null = null
  for (const n of sorted) {
    if (start === null) {
      start = n
      prev = n
      continue
    }
    if (n === (prev as number) + 1) {
      prev = n
      continue
    }
    runs.push([start as number, prev as number])
    start = n
    prev = n
  }
  if (start !== null) runs.push([start, prev as number])
  return runs
}

/** 节次区间 [start..end]（逐项数组） */
export function periodRange(startPeriod: number, endPeriod: number): number[] {
  const a = Number(startPeriod)
  const b = Number(endPeriod)
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) return []
  const out: number[] = []
  for (let p = a; p <= b; p++) out.push(p)
  return out
}

/** 节次显示文案：[3,4,5,6] → 「第 3–6 节」；[3,5] → 「第 3、5 节」 */
export function periodsLabel(periods: number[]): string {
  const list = normalizeInts(periods)
  if (!list.length) return ''
  const runs = runsOf(list)
  if (runs.length === 1) {
    const [a, b] = runs[0]
    return a === b ? `第 ${a} 节` : `第 ${a}–${b} 节`
  }
  if (list.every((p, i) => i === 0 || p - list[i - 1] === 2) && list.length >= 3) {
    return `第 ${list[0]}–${list[list.length - 1]} 节（隔节）`
  }
  return `第 ${list.join('、')} 节`
}

/** 周次显示文案：[1..16] → 「第 1–16 周」；[1,3,5,7] → 「第 1–7 周（单周）」 */
export function weeksLabel(weeks: number[]): string {
  const list = normalizeInts(weeks)
  if (!list.length) return ''
  const runs = runsOf(list)
  if (runs.length === 1) {
    const [a, b] = runs[0]
    return a === b ? `第 ${a} 周` : `第 ${a}–${b} 周`
  }
  const consecutive = list.every((w, i) => i === 0 || w - list[i - 1] === 2)
  const allOdd = list.every((w) => w % 2 === 1)
  const allEven = list.every((w) => w % 2 === 0)
  if (consecutive && (allOdd || allEven)) {
    return `第 ${list[0]}–${list[list.length - 1]} 周（${allOdd ? '单' : '双'}周）`
  }
  return `第 ${list.join('、')} 周`
}

/** 课程是否有固定时间（有至少一个上课时间组） */
export function isScheduled(course: Pick<Course, 'sessions'>): boolean {
  return Array.isArray(course.sessions) && course.sessions.length > 0
}

/**
 * Course + CourseSession → 可渲染的课程块。
 * @param weekNumber 目标周周号（null 表示不按周过滤，全部视为 active）
 */
export function toBlocks(course: Course, weekNumber: number | null): CourseBlock[] {
  return (course.sessions ?? []).map((s, i) => {
    const allPeriods = normalizeInts(s.periods)
    const weeks = normalizeInts(s.weeks)
    const active = weekNumber === null ? true : weeks.includes(weekNumber)
    const periods = active ? allPeriods : []
    const startPeriod = allPeriods.length ? allPeriods[0] : 1
    const endPeriod = allPeriods.length ? allPeriods[allPeriods.length - 1] : 1
    return {
      id: course.id,
      sessionId: (s as CourseSession).id ?? i,
      semesterId: course.semesterId,
      type: course.type,
      name: course.name,
      teacher: course.teacher,
      location: s.location || course.location,
      color: course.color,
      remark: course.remark,
      weekday: s.weekday,
      periods,
      startPeriod,
      endPeriod,
      runs: runsOf(allPeriods),
      allPeriods,
      weeks,
      active,
    }
  })
}

/** 展开课程为全部块（不做周过滤） */
export function courseBlocks(course: Course): CourseBlock[] {
  return toBlocks(course, null)
}

/** 从服务端 /api/schedule 返回的块对象做归一化（服务端已按周过滤） */
export interface ServerBlock extends Omit<CourseBlock, 'runs' | 'allPeriods' | 'weeks' | 'active'> {
  runs?: [number, number][]
  allPeriods?: number[]
  weeks?: number[]
  active?: boolean
}

export function normalizeServerBlock(raw: ServerBlock): CourseBlock {
  const periods = normalizeInts(raw.periods)
  const allPeriods = raw.allPeriods ? normalizeInts(raw.allPeriods) : periods
  return {
    ...raw,
    periods,
    startPeriod: raw.startPeriod ?? (periods.length ? periods[0] : 1),
    endPeriod: raw.endPeriod ?? (periods.length ? periods[periods.length - 1] : 1),
    runs: raw.runs ?? runsOf(periods),
    allPeriods,
    weeks: normalizeInts(raw.weeks ?? []),
    active: raw.active ?? true,
  }
}

/** 空上课时间组（表单新增行用） */
export function blankSession(weekday: Weekday = 1): CourseSession {
  return { weekday, location: '', periods: periodRange(1, 2), weeks: [] }
}
