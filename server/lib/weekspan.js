// ============================================================
// ClassBoard · 周次/节次数学（无外部依赖，供迁移与路由共用）
// 与 frontend/src/utils/week.ts 保持同一套公式：
//   周以 weekStartDay 为界锚定；周序号 = 目标周起始日与学期首周起始日相差的周数 + 1
// ============================================================

/** 周次与节次上限（与数据库 CHECK 约束一致） */
export const MAX_WEEKS = 30
export const MAX_PERIODS = 24

/** 解析 YYYY-MM-DD 为本地 Date（避免 UTC 偏移） */
export function parseLocalDate(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 格式化为 YYYY-MM-DD */
export function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 某日期所在周的起始日（按 weekStartDay 对齐） */
export function weekStartOf(date, weekStartDay) {
  const off = (((date.getDay() - weekStartDay) % 7) + 7) % 7
  const start = new Date(date)
  start.setDate(date.getDate() - off)
  return start
}

/**
 * 周序号。
 * @returns 0=未开学（早于起始日）；null=学期已结束（晚于结束日）；1..n=第几周
 */
export function weekNumberIn(startDate, endDate, weekStartDay, date) {
  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (date.getTime() < start.getTime()) return 0
  if (date.getTime() > end.getTime()) return null
  const weeks = Math.round(
    (weekStartOf(date, weekStartDay).getTime() - weekStartOf(start, weekStartDay).getTime()) / (7 * 86400000),
  )
  return weeks + 1
}

/** 学期总周数（末周含结束日） */
export function semesterWeekCount(startDate, endDate, weekStartDay) {
  const end = parseLocalDate(endDate)
  const n = weekNumberIn(startDate, endDate, weekStartDay, end)
  return Math.min(Math.max(n ?? 16, 1), MAX_WEEKS)
}

/** 升序去重的整数数组 */
export function normalizeInts(arr) {
  if (!Array.isArray(arr)) return []
  return [...new Set(arr.filter((n) => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b)
}

/** 升序数组 → 连续区间列表 [[a,b], ...] */
export function runsOf(sorted) {
  const runs = []
  let start = null
  let prev = null
  for (const n of sorted) {
    if (start === null) {
      start = n
      prev = n
      continue
    }
    if (n === prev + 1) {
      prev = n
      continue
    }
    runs.push([start, prev])
    start = n
    prev = n
  }
  if (start !== null) runs.push([start, prev])
  return runs
}

/** 节次显示文案：[3,4,5,6] → 第 3–6 节（读取时派生，不写回存储） */
export function periodsLabel(periods) {
  const list = normalizeInts(periods)
  if (!list.length) return ''
  const runs = runsOf(list)
  if (runs.length === 1) {
    const [a, b] = runs[0]
    return a === b ? `第 ${a} 节` : `第 ${a}–${b} 节`
  }
  return `第 ${list.join('、')} 节`
}

/** 周次显示文案：[1..16] → 第 1–16 周；[1,3,5,7] → 第 1–7 周（单周） */
export function weeksLabel(weeks) {
  const list = normalizeInts(weeks)
  if (!list.length) return ''
  const runs = runsOf(list)
  if (runs.length === 1) {
    const [a, b] = runs[0]
    return a === b ? `第 ${a} 周` : `第 ${a}–${b} 周`
  }
  const step2 = list.length > 1 && list.every((w, i) => i === 0 || w - list[i - 1] === 2)
  const allOdd = list.every((w) => w % 2 === 1)
  const allEven = list.every((w) => w % 2 === 0)
  if (step2 && (allOdd || allEven)) {
    return `第 ${list[0]}–${list[list.length - 1]} 周（${allOdd ? '单' : '双'}周）`
  }
  return `第 ${list.join('、')} 周`
}

/** 节次区间 [start..end] */
export function periodRange(startPeriod, endPeriod) {
  const a = Number(startPeriod)
  const b = Number(endPeriod)
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) return []
  const out = []
  for (let p = a; p <= b; p++) out.push(p)
  return out
}

/**
 * 展开旧周规则为逐周数组（迁移与旧格式转换用；新数据不再存周规则）。
 * all/odd/even/custom 语义与旧 isCourseVisible 完全一致：
 *  - all + weekList → 仅这些周
 *  - odd/even + weekList → 奇偶 ∩ weekList
 *  - odd/even 无 weekList → 学期内全部奇/偶周
 */
export function expandWeeks(weekType, weekList, maxWeeks) {
  const total = Math.min(Math.max(Number(maxWeeks) || 16, 1), MAX_WEEKS)
  const all = () => Array.from({ length: total }, (_, i) => i + 1)
  const list = normalizeInts(weekList).filter((w) => w <= MAX_WEEKS)
  const hasList = list.length > 0
  switch (weekType) {
    case 'odd':
      return hasList ? list.filter((w) => w % 2 === 1) : all().filter((w) => w % 2 === 1)
    case 'even':
      return hasList ? list.filter((w) => w % 2 === 0) : all().filter((w) => w % 2 === 0)
    case 'custom':
      return hasList ? list : all()
    default:
      return hasList ? list : all()
  }
}
