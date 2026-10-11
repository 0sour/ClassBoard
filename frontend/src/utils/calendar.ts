// ============================================================
// ClassBoard · 学期日历与单课调整的解析层（唯一真理）
// 给定日期 → 该日实际发生的课程块（含「是否调整而来」的来源信息）+ 原位置标记。
// 桌面周网格、手机滑动日卡、今天页、侧栏、铃铛、提醒引擎全部走这里，
// 避免多套路径各算各的造成不一致（历史教训：手机端与桌面端曾各有一套周过滤）。
// 基准课表（course_slot）永不被本模块改动：调休与调课都是「日期覆盖层」。
// ============================================================
import type {
  Course,
  CourseAdjustment,
  CourseBlock,
  DayMarker,
  DayRule,
  ResolvedBlock,
  ResolvedDay,
  Semester,
  Weekday,
} from '@/types'
import { calcWeekNumber, formatDate, getWeekday, parseDate, weekStartOf } from './week'
import { courseBlocks, normalizeInts, periodsLabel, runsOf, toBlocks } from './session'

/** 星期文案（1=周一 … 7=周日） */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

export function weekdayLabel(weekday: number | null | undefined): string {
  if (!weekday || weekday < 1 || weekday > 7) return ''
  return WEEKDAY_LABELS[weekday - 1]
}

/** 「10月17日」 */
export function monthDayLabel(dateStr: string): string {
  const d = parseDate(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 「10月17日（周六）」 */
export function dateWithWeekdayLabel(dateStr: string): string {
  return `${monthDayLabel(dateStr)}（${weekdayLabel(getWeekday(parseDate(dateStr)))}）`
}

/** 日期 → 该日真实星期 */
export function weekdayOfDateStr(dateStr: string): Weekday {
  return getWeekday(parseDate(dateStr))
}

/** 周次 + 星期 → 日期（调课表单按「第几周 周几」录入时用；与周次算法同一套对齐） */
export function dateOfWeekday(
  weekNumber: number,
  weekday: Weekday,
  semester: Pick<Semester, 'startDate' | 'weekStartDay'>,
): string {
  const first = weekStartOf(parseDate(semester.startDate), semester.weekStartDay)
  const offset = (((weekday - semester.weekStartDay) % 7) + 7) % 7
  const d = new Date(first)
  d.setDate(first.getDate() + (weekNumber - 1) * 7 + offset)
  return formatDate(d)
}

// ============================================================
// 日期规则（学期日历）
// ============================================================

export function ruleMapOf(rules: DayRule[] | undefined | null): Map<string, DayRule> {
  const map = new Map<string, DayRule>()
  for (const r of rules ?? []) map.set(r.date, r)
  return map
}

/** 当天是否有课（放假、调休移走均为 false） */
export function hasClassesToday(day: Pick<ResolvedDay, 'rule' | 'effectiveWeekday'>): boolean {
  return day.effectiveWeekday !== null
}

/** 日头角标文案：'假期' / '调休'（该日的课已移走）/ '补 9月29日'（该日是某日的调休目标） */
export function dayRuleLabel(rule: DayRule | null | undefined, shiftSources: DayRule[] = []): string {
  if (rule?.kind === 'holiday') return '假期'
  if (rule?.kind === 'shift') return '调休'
  if (shiftSources.length) {
    return shiftSources.length === 1 ? `补 ${monthDayLabel(shiftSources[0].date)}` : `补 ${shiftSources.length} 天课`
  }
  return ''
}

/** 按「连续日期 + 同类型 + 同备注」合并为区间（设置页列表展示用；移课是「某日→某日」，不合并） */
export interface DayRuleRange {
  from: string
  to: string
  kind: 'holiday' | 'shift'
  toDate: string | null
  note: string
  dates: string[]
}

export function groupDayRules(rules: DayRule[]): DayRuleRange[] {
  const sorted = [...rules].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const out: DayRuleRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    let contiguous = false
    if (last && last.kind === 'holiday' && r.kind === 'holiday') {
      const next = parseDate(last.to)
      next.setDate(next.getDate() + 1)
      contiguous = formatDate(next) === r.date
    }
    if (last && contiguous && last.note === r.note) {
      last.to = r.date
      last.dates.push(r.date)
    } else {
      out.push({
        from: r.date,
        to: r.date,
        kind: r.kind,
        toDate: r.toDate,
        note: r.note,
        dates: [r.date],
      })
    }
  }
  return out
}

/** 区间文案：'10月1日–10月8日'（同日显示单个日期） */
export function rangeLabel(r: Pick<DayRuleRange, 'from' | 'to'>): string {
  return r.from === r.to ? monthDayLabel(r.from) : `${monthDayLabel(r.from)}–${monthDayLabel(r.to)}`
}

// ============================================================
// 单课调整文案
// ============================================================

/** 调整记录一行文案（课程详情 / 提示） */
export function adjustmentLabel(a: CourseAdjustment): string {
  const from = `${dateWithWeekdayLabel(a.date)} ${periodsLabel(a.fromPeriods)}`
  if (a.kind === 'cancel') return `停课：${from}`
  if (a.kind === 'extra') return `补课：${dateWithWeekdayLabel(a.date)} ${periodsLabel(a.periods)}`
  const to = a.toDate ? `${dateWithWeekdayLabel(a.toDate)} ${periodsLabel(a.periods)}` : periodsLabel(a.periods)
  return `调课：${from} → ${to}`
}

/** 原位置淡显标记文案：'已调至 10月17日 第 3–4 节' / '已移至 10月10日' / '停课' */
export function markerLabel(m: Pick<DayMarker, 'kind' | 'toDate' | 'toPeriods' | 'note'>): string {
  if (m.kind === 'cancel') return m.note ? `停课（${m.note}）` : '停课'
  if (m.kind === 'shift') {
    const base = m.toDate ? `已移至 ${monthDayLabel(m.toDate)}` : '已调休'
    return m.note ? `${base}（${m.note}）` : base
  }
  const parts = [m.toDate ? monthDayLabel(m.toDate) : '', periodsLabel(m.toPeriods ?? [])].filter(Boolean)
  const base = parts.length ? `已调至 ${parts.join(' ')}` : '已调课'
  return m.note ? `${base}（${m.note}）` : base
}

/** 调来块的角标文案 */
export function sourceBadge(source: string | undefined): string {
  if (source === 'moved') return '调课'
  if (source === 'extra') return '补课'
  if (source === 'shifted') return '调休'
  return ''
}

/** 调来块的完整说明：'由 10月15日（周四） 第 5–6 节 调来' / '9月29日（周二） 的课调至今天' */
export function movedFromLabel(
  b: Pick<ResolvedBlock, 'fromDate' | 'fromPeriods' | 'adjustmentNote'> & { source?: ResolvedBlock['source'] },
): string {
  if (b.source === 'extra') return b.adjustmentNote ? `补课（${b.adjustmentNote}）` : '补课'
  if (b.source === 'shifted') {
    const base = b.fromDate ? `${dateWithWeekdayLabel(b.fromDate)} 的课调至今天` : '调休移来的课'
    return b.adjustmentNote ? `${base}（${b.adjustmentNote}）` : base
  }
  if (b.source !== 'moved' || !b.fromDate) return ''
  const from = `${dateWithWeekdayLabel(b.fromDate)}${b.fromPeriods?.length ? ` ${periodsLabel(b.fromPeriods)}` : ''}`
  return b.adjustmentNote ? `由 ${from} 调来（${b.adjustmentNote}）` : `由 ${from} 调来`
}

// ============================================================
// 解析
// ============================================================

export interface ResolveContext {
  /** 当前学期（为 null 时不做周次过滤） */
  semester: Pick<Semester, 'startDate' | 'endDate' | 'weekStartDay'> | null
  /** 该学期的课程（调用方负责按学期过滤） */
  courses: Course[]
  /** 学期日历规则 */
  rules?: DayRule[] | Map<string, DayRule>
  /** 单课调整 */
  adjustments?: CourseAdjustment[]
  /** 忽略周次过滤（设置里「单双周过滤」关闭时的兼容行为：显示全部课程） */
  ignoreWeeks?: boolean
}

function isRuleMap(v: ResolveContext['rules']): v is Map<string, DayRule> {
  return v instanceof Map
}

function rulesMapOf(rules: ResolveContext['rules']): Map<string, DayRule> {
  return isRuleMap(rules) ? rules : ruleMapOf(rules)
}

/** 块是否命中调整记录定位的原时间组（节次优先；未记录节次时按星期匹配） */
function matchesSourceBlock(b: CourseBlock, a: CourseAdjustment): boolean {
  if (a.fromWeekday && b.weekday !== a.fromWeekday) return false
  const from = normalizeInts(a.fromPeriods)
  if (from.length) return normalizeInts(b.allPeriods).join('.') === from.join('.')
  return Boolean(a.fromWeekday)
}

/** 由调整记录构造「调来 / 补课」块 */
function adjustedBlock(course: Course, a: CourseAdjustment, date: Date, locationFallback: string): ResolvedBlock {
  const periods = normalizeInts(a.periods)
  return {
    id: course.id,
    sessionId: null,
    semesterId: course.semesterId,
    type: course.type,
    name: course.name,
    teacher: course.teacher,
    location: a.location || locationFallback || course.location,
    color: course.color,
    remark: course.remark,
    weekday: getWeekday(date),
    periods,
    startPeriod: periods.length ? periods[0] : 1,
    endPeriod: periods.length ? periods[periods.length - 1] : 1,
    runs: runsOf(periods),
    allPeriods: periods,
    weeks: [],
    active: true,
    source: a.kind === 'move' ? 'moved' : 'extra',
    fromDate: a.kind === 'move' ? a.date : undefined,
    fromWeekday: a.fromWeekday,
    fromPeriods: normalizeInts(a.fromPeriods),
    adjustmentId: a.id,
    adjustmentNote: a.note,
  }
}

/**
 * 基准课表上「某一天」应有的课（不看日历规则）：该日所在周 + 该日真实星期。
 * 调休移课要把源日这一整天的课原样搬走，故按源日的「周号 + 星期」取。
 */
function baseBlocksOf(date: Date, ctx: ResolveContext): ResolvedBlock[] {
  const weekNumber = ctx.semester ? calcWeekNumber(date, ctx.semester) : null
  if (weekNumber === null || weekNumber === 0) return []
  const weekday = getWeekday(date)
  const out: ResolvedBlock[] = []
  for (const c of ctx.courses) {
    const list = ctx.ignoreWeeks ? courseBlocks(c) : toBlocks(c, weekNumber)
    for (const b of list) {
      if (b.weekday !== weekday) continue
      if (!ctx.ignoreWeeks && !b.active) continue
      out.push({ ...b, source: 'base' })
    }
  }
  return out
}

/**
 * 解析某一天实际发生的课程。
 * 1) 日历规则：放假 → 当天无课；调休移课 → 源日无课（课被搬走）、目标日显示源日当天的课
 * 2) 基础课来自各课程时间组（weekday 命中且 weeks 含该日周号）——**不假设课表每周重复**
 * 3) 叠加单课调整：原位置的 cancel/move 移除并留标记；目标日的 move / 当日的 extra 追加带来源标记的块
 * 显式指定的调课/补课/调休目标日不受「该日放假」影响（用户手动指定优先）。
 */
export function resolveDay(date: Date, ctx: ResolveContext): ResolvedDay {
  const dateStr = formatDate(date)
  const rules = rulesMapOf(ctx.rules)
  const rule = rules.get(dateStr) ?? null
  /** 该日作为调休目标：有哪些源日的课被移到了这一天 */
  const shiftSources = [...rules.values()].filter((r) => r.kind === 'shift' && r.toDate === dateStr)

  const courseById = new Map(ctx.courses.map((c) => [c.id, c]))

  // 本日自己的课：放假与「课被移走」两种情况都为空
  let blocks: ResolvedBlock[] = []
  const movedAway = rule?.kind === 'shift'
  const ownBlocks = rule?.kind === 'holiday' ? [] : baseBlocksOf(date, ctx)
  if (!movedAway) blocks = ownBlocks

  const markers: DayMarker[] = []

  // 整日调休：源日原位置留淡显标记，目标日把源日当天的课整批搬来
  if (movedAway && rule) {
    for (const b of ownBlocks) {
      markers.push({
        courseId: b.id,
        name: b.name,
        color: b.color,
        weekday: b.weekday,
        periods: normalizeInts(b.allPeriods),
        kind: 'shift',
        toDate: rule.toDate,
        toPeriods: [],
        note: rule.note,
        adjustmentId: 0,
        ruleId: rule.id,
      })
    }
  }
  for (const src of shiftSources) {
    for (const b of baseBlocksOf(parseDate(src.date), ctx)) {
      blocks.push({
        ...b,
        // 板块渲染列 = 目标日的真实星期
        weekday: getWeekday(date),
        source: 'shifted',
        fromDate: src.date,
        adjustmentNote: src.note,
      })
    }
  }

  // 单课调整（停课 / 调课 / 补课）
  for (const a of ctx.adjustments ?? []) {
    const course = courseById.get(a.courseId)
    if (!course) continue

    // 原位置：停课 / 调走的课——移除基础块并留淡显标记
    if ((a.kind === 'cancel' || a.kind === 'move') && a.date === dateStr) {
      const matched = blocks.filter((b) => b.id === a.courseId && matchesSourceBlock(b, a))
      if (matched.length) blocks = blocks.filter((b) => !matched.includes(b))
      const sourceSession = course.sessions.find(
        (s) =>
          s.weekday === a.fromWeekday &&
          normalizeInts(s.periods).join('.') === normalizeInts(a.fromPeriods).join('.'),
      )
      markers.push({
        courseId: course.id,
        name: course.name,
        color: course.color,
        weekday: (a.fromWeekday ?? matched[0]?.weekday ?? getWeekday(date)) as Weekday,
        periods: normalizeInts(a.fromPeriods).length
          ? normalizeInts(a.fromPeriods)
          : normalizeInts(matched[0]?.allPeriods ?? sourceSession?.periods ?? []),
        kind: a.kind,
        toDate: a.toDate,
        toPeriods: normalizeInts(a.periods),
        note: a.note,
        adjustmentId: a.id,
      })
    }

    // 目标位置：调来的课 / 补课
    const targetsHere = (a.kind === 'move' && a.toDate === dateStr) || (a.kind === 'extra' && a.date === dateStr)
    if (targetsHere) {
      const sourceSession = course.sessions.find(
        (s) =>
          s.weekday === a.fromWeekday &&
          normalizeInts(s.periods).join('.') === normalizeInts(a.fromPeriods).join('.'),
      )
      blocks.push(adjustedBlock(course, a, date, sourceSession?.location ?? ''))
    }
  }

  blocks.sort((x, y) => x.startPeriod - y.startPeriod || x.endPeriod - y.endPeriod || x.id - y.id)

  return {
    date: dateStr,
    weekNumber: ctx.semester ? calcWeekNumber(date, ctx.semester) : null,
    effectiveWeekday: movedAway || rule?.kind === 'holiday' ? null : getWeekday(date),
    rule,
    shiftSources,
    dayLabel: dayRuleLabel(rule, shiftSources),
    blocks,
    markers,
  }
}

/** 解析多天（周网格 7 列 / 手机日卡），规则表只归一化一次 */
export function resolveDays(dates: Date[], ctx: ResolveContext): ResolvedDay[] {
  const merged: ResolveContext = { ...ctx, rules: rulesMapOf(ctx.rules) }
  return dates.map((d) => resolveDay(d, merged))
}

/** 某门课的调整记录（课程详情展示 / 撤销用），按日期升序 */
export function adjustmentsOf(adjustments: CourseAdjustment[] | undefined, courseId: number): CourseAdjustment[] {
  return (adjustments ?? [])
    .filter((a) => a.courseId === courseId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
}
