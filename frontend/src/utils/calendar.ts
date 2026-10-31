// ============================================================
// ClassBoard · 学期日历与单课调整的解析层（唯一真理）
// 给定日期 → 该日实际发生的课程块（含链式调整的来源信息）+ 原位置 / 中间站标记。
// 桌面周网格、手机滑动日卡、今天页、侧栏、台账全部走这里，
// 避免多套路径各算各的造成不一致（历史教训：手机端与桌面端曾各有一套周过滤）。
//
// 分层（为什么这么写）：
//   旧实现把「调休移来的块」与「调课目标块」当两套独立路径处理，
//   于是「先调休再调课」「先调课再调休」两种叠加都会算错
//   （课同时出现在两处，或调休把调课结果漏掉）。现统一成一条流水线：
//     1) 枚举基准发生：课程时间组 × 周次 → 那一天的那一节次（放假当天不产生）
//     2) 调休闭包：基准日若被整日移课，沿 A→B→C 一路跟到底（带环保护）
//     3) 单课调整按 id 顺序游走：按「当前所在日期 + 节次」匹配（来源发生匹配，
//        不再依赖星期——调休会改掉落点的真实星期）；每次移动后若新落点本身又是
//        调休源日，继续沿调休链走（先调课后调休也成立）；如此往复直到稳定
//     4) 出账：块只出现在终到日；基准日与中间站留淡显标记（中间站带「经此」）
//   基准课表（course_slot）永不被改动，以上全是日期覆盖层的推导。
// ============================================================
import type {
  AdjustHop,
  Course,
  CourseAdjustment,
  DayMarker,
  DayRule,
  ResolvedBlock,
  ResolvedDay,
  Semester,
  Weekday,
} from '@/types'
import { calcWeekNumber, formatDate, getWeekday, parseDate, weekStartOf } from './week'
import { normalizeInts, periodsLabel, runsOf } from './session'

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

/** 按「连续日期 + 同类型 + 同备注」合并为区间（台账列表展示用；移课是「某日→某日」，不合并） */
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
// 单课调整 / 调整链文案
// ============================================================

/**
 * 「换教室」：这一次课不挪时间、只改地点。
 * 存储上是一条**原地调课**（kind=move、toDate=date、periods=fromPeriods、location=新地点），
 * 所以不需要新 kind、不动数据库 CHECK，旧备份与旧客户端都兼容。
 */
export function isRoomChange(
  a: Pick<CourseAdjustment, 'kind' | 'date' | 'toDate' | 'fromPeriods' | 'periods' | 'location'>,
): boolean {
  return (
    a.kind === 'move' &&
    a.toDate === a.date &&
    !!a.location &&
    samePeriods(normalizeInts(a.periods), normalizeInts(a.fromPeriods))
  )
}

/** 调整记录一行文案（台账 / 课程详情） */
export function adjustmentLabel(a: CourseAdjustment): string {
  const from = `${dateWithWeekdayLabel(a.date)} ${periodsLabel(a.fromPeriods)}`
  if (a.kind === 'cancel') return `停课：${from}`
  if (a.kind === 'extra') return `补课：${dateWithWeekdayLabel(a.date)} ${periodsLabel(a.periods)}`
  if (isRoomChange(a)) return `换教室：${from} → ${a.location}`
  const to = a.toDate ? `${dateWithWeekdayLabel(a.toDate)} ${periodsLabel(a.periods)}` : periodsLabel(a.periods)
  return `调课：${from} → ${to}`
}

/** 原位置淡显标记文案：'已调至 10月17日 第 3–4 节' / '已移至 10月10日' / '停课'；中间站加「（经此）」 */
export function markerLabel(m: Pick<DayMarker, 'kind' | 'toDate' | 'toPeriods' | 'note'>): string {
  if (m.kind === 'cancel') return m.note ? `停课（${m.note}）` : '停课'
  if (m.kind === 'shift') {
    const base = m.toDate ? `已移至 ${monthDayLabel(m.toDate)}` : '已调休'
    return m.note ? `${base}（${m.note}）` : base
  }
  const parts = [m.toDate ? monthDayLabel(m.toDate) : '', periodsLabel(m.toPeriods ?? [])].filter(Boolean)
  const base = parts.length ? `已调至 ${parts.join(' ')}` : '已调课'
  const text = m.note ? `${base}（${m.note}）` : base
  return m.kind === 'via' ? `${text}（经此）` : text
}

/** 调来块的角标文案：'调课' / '补课' / '调休' */
export function sourceBadge(source: string | undefined, roomChanged = false): string {
  if (roomChanged) return '换教室'
  if (source === 'moved') return '调课'
  if (source === 'extra') return '补课'
  if (source === 'shifted') return '调休'
  return ''
}

/** 角标文案组：类型角标 + 「多次调整」（链上 ≥2 站） */
export function badgeLabels(block: { source?: string; multiAdjusted?: boolean; roomChanged?: boolean }): string[] {
  const out: string[] = []
  const type = sourceBadge(block.source, block.roomChanged)
  if (type) out.push(type)
  if (block.multiAdjusted) out.push('多次调整')
  return out
}

/** 调整链 → 一行说明：'9月11日（周四）第 2–4 节 → 调休移 9月14日 → 调课改 9月15日' */
export function chainLabel(
  chain: AdjustHop[] | undefined,
  originDate?: string,
  originPeriods?: number[],
): string {
  if (!chain?.length) return ''
  const head = originDate
    ? `${dateWithWeekdayLabel(originDate)}${originPeriods?.length ? ` ${periodsLabel(originPeriods)}` : ''}`
    : ''
  const steps = chain.map((h) => {
    if (h.kind === 'shift') return `调休移 ${monthDayLabel(h.to as string)}`
    if (h.kind === 'cancel') return '停课'
    if (h.kind === 'extra') return `补课 ${monthDayLabel(h.from)}`
    // 原地调课 = 换教室：不挪时间，只报新地点
    if (h.kind === 'move' && h.from === h.to && h.location && samePeriods(h.periods, h.fromPeriods)) {
      return `换教室 ${h.location}`
    }
    return `调课改 ${monthDayLabel(h.to as string)}${h.periods.length ? ` ${periodsLabel(h.periods)}` : ''}${
      h.location ? `（${h.location}）` : ''
    }`
  })
  return [head, ...steps].filter(Boolean).join(' → ')
}

/** 调来块的完整说明：'由 10月15日（周四） 第 5–6 节 调来' / 链式调整给出完整路径 */
export function movedFromLabel(
  b: Pick<ResolvedBlock, 'fromDate' | 'fromPeriods' | 'adjustmentNote' | 'chain' | 'originDate'> & {
    source?: string
  },
): string {
  if (b.source === 'extra') {
    return b.adjustmentNote ? `补课（${b.adjustmentNote}）` : '补课'
  }
  // 只是换了教室（原地调课）：直接给新地点，不说「由某日调来」
  const last = b.chain?.[b.chain.length - 1]
  if (last && last.kind === 'move' && last.from === last.to && last.location && samePeriods(last.periods, last.fromPeriods)) {
    return b.adjustmentNote ? `换教室 → ${last.location}（${b.adjustmentNote}）` : `换教室 → ${last.location}`
  }
  // 链式调整（≥2 站）：给出完整路径，比「由某日调来」更清楚
  if (b.chain && b.chain.length >= 2) {
    const text = chainLabel(b.chain, b.originDate ?? b.fromDate, b.fromPeriods)
    return text ? `调整路径：${text}` : ''
  }
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
  /** 当前学期（为 null 时不产生任何发生） */
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

function samePeriods(a: number[], b: number[]): boolean {
  const x = normalizeInts(a)
  const y = normalizeInts(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/** 基准发生：某门课的某个时间组在某一周的那一天 */
interface Occurrence {
  course: Course
  sessionId: number | null
  /** 基准日期（最早那一天） */
  originDate: string
  /** 基准节次（时间组节次；补课为登记时的节次） */
  originPeriods: number[]
  /** 出生方式：基准课表 / 补课 */
  born: 'base' | 'extra'
  /** 补课的出生记录 id（其余为 null，游走时跳过自己） */
  bornAdjustmentId: number | null
  /** 当前所在日期（游走后 = 终到日） */
  date: string
  periods: number[]
  locationNow: string
  cancelled: boolean
  /** 途经的每一站（含起点；用于中间站标记） */
  visited: string[]
  chain: AdjustHop[]
}

/** 学期周数（枚举基准发生的上限） */
function weekCountOf(sem: ResolveContext['semester']): number {
  if (!sem) return 0
  const total = calcWeekNumber(parseDate(sem.endDate), sem)
  return total === null ? 0 : Math.max(0, Math.min(30, total))
}

/** 调休闭包：从 dateStr 出发，沿「整日移课」链跟到终到日（带环保护） */
function shiftPath(
  dateStr: string,
  rules: Map<string, DayRule>,
): { date: string; hops: AdjustHop[]; cycle: boolean } {
  const hops: AdjustHop[] = []
  const seen = new Set([dateStr])
  let cur = dateStr
  let cycle = false
  for (;;) {
    const r = rules.get(cur)
    if (!r || r.kind !== 'shift' || !r.toDate) break
    if (seen.has(r.toDate)) {
      cycle = true // A→B→A 这类冲突数据：停在当前这一站，不再前进
      break
    }
    seen.add(r.toDate)
    hops.push({
      kind: 'shift',
      from: cur,
      to: r.toDate,
      periods: [],
      fromPeriods: [],
      note: r.note ?? '',
      adjustmentId: 0,
      ruleId: r.id,
    })
    cur = r.toDate
  }
  return { date: cur, hops, cycle }
}

/** 枚举某学期的全部基准发生（放假当天不产生；补课单独追加） */
function occurrencesOf(ctx: ResolveContext, rules: Map<string, DayRule>): Occurrence[] {
  const out: Occurrence[] = []
  const weeks = weekCountOf(ctx.semester)

  if (ctx.semester && weeks > 0) {
    for (const c of ctx.courses) {
      for (const s of c.sessions ?? []) {
        const periods = normalizeInts(s.periods)
        if (!periods.length) continue
        const sessionWeeks = normalizeInts(s.weeks)
        for (let w = 1; w <= weeks; w++) {
          if (!ctx.ignoreWeeks && sessionWeeks.length && !sessionWeeks.includes(w)) continue
          const dateStr = dateOfWeekday(w, s.weekday, ctx.semester)
          // 学期起止不整周时，周次可能越过学期边界
          if (dateStr < ctx.semester.startDate || dateStr > ctx.semester.endDate) continue
          if (rules.get(dateStr)?.kind === 'holiday') continue // 放假当天没有课
          out.push({
            course: c,
            sessionId: s.id ?? null,
            originDate: dateStr,
            originPeriods: periods,
            born: 'base',
            bornAdjustmentId: null,
            date: dateStr,
            periods,
            locationNow: s.location || c.location,
            cancelled: false,
            visited: [dateStr],
            chain: [],
          })
        }
      }
    }
  }

  // 补课：登记即产生一次发生（显式指定优先，落在哪天就在哪天）
  for (const a of ctx.adjustments ?? []) {
    if (a.kind !== 'extra') continue
    const c = ctx.courses.find((x) => x.id === a.courseId)
    if (!c) continue
    const periods = normalizeInts(a.periods).length ? normalizeInts(a.periods) : normalizeInts(a.fromPeriods)
    out.push({
      course: c,
      sessionId: null,
      originDate: a.date,
      originPeriods: periods,
      born: 'extra',
      bornAdjustmentId: a.id,
      date: a.date,
      periods,
      locationNow: a.location || c.location,
      cancelled: false,
      visited: [a.date],
      chain: [
        {
          kind: 'extra',
          from: a.date,
          to: a.date,
          periods,
          fromPeriods: [],
          note: a.note,
          adjustmentId: a.id,
        },
      ],
    })
  }

  return out
}

/** 单课调整是否命中「此刻这一站」：来源发生匹配（节次精确；星期仅作旧数据兜底） */
function matchesHere(occ: Occurrence, a: CourseAdjustment): boolean {
  if (a.kind === 'extra') return false
  if (a.date !== occ.date) return false
  const from = normalizeInts(a.fromPeriods)
  if (from.length) return samePeriods(from, occ.periods)
  // 旧记录没有节次：按星期匹配（调休会改掉真实星期，故也接受时间组的原始星期）
  if (!a.fromWeekday) return false
  return (
    weekdayOfDateStr(occ.date) === a.fromWeekday ||
    occ.course.sessions.some((s) => s.weekday === a.fromWeekday)
  )
}

/**
 * 沿调休链继续走（每次落点变化后调用）。
 * 途经的每一站都记进 visited：A→B→C 里 B 是中间站，也要留「经此」标记。
 */
function followShifts(occ: Occurrence, rules: Map<string, DayRule>): void {
  const { date, hops } = shiftPath(occ.date, rules)
  if (date === occ.date || !hops.length) return
  if (hops.some((h) => occ.visited.includes(h.to as string))) return // 回到走过的站：判为环，原地停住
  for (const h of hops) occ.visited.push(h.to as string)
  occ.chain.push(...hops)
  occ.date = date
}

/**
 * 流水线：基准发生 → 调休 → 调整游走 → 再调休 …… 直到稳定。
 * 调整记录按 id 升序（创建顺序）逐条尝试；每条最多命中一次。
 */
function settle(occ: Occurrence, adjustments: CourseAdjustment[], rules: Map<string, DayRule>): void {
  followShifts(occ, rules)
  const applied = new Set<number>()
  for (let round = 0; round < 8; round++) {
    let moved = false
    for (const a of adjustments) {
      if (occ.cancelled) return
      if (applied.has(a.id)) continue
      if (a.id === occ.bornAdjustmentId) continue
      if (!matchesHere(occ, a)) continue
      applied.add(a.id)
      moved = true
      if (a.kind === 'cancel') {
        occ.chain.push({
          kind: 'cancel',
          from: occ.date,
          to: null,
          periods: occ.periods,
          fromPeriods: normalizeInts(a.fromPeriods),
          note: a.note,
          adjustmentId: a.id,
        })
        occ.cancelled = true
        return
      }
      const to = a.toDate as string
      const periods = normalizeInts(a.periods)
      // 地点有变化才记在站上（旧记录的 location 多半就是原地点，不该被当成「换地点」）
      const roomTo = a.location && a.location !== occ.locationNow ? a.location : undefined
      occ.chain.push({
        kind: 'move',
        from: occ.date,
        to,
        periods: periods.length ? periods : occ.periods,
        fromPeriods: normalizeInts(a.fromPeriods),
        note: a.note,
        location: roomTo,
        adjustmentId: a.id,
      })
      occ.date = to
      if (!occ.visited.includes(to)) occ.visited.push(to)
      if (periods.length) occ.periods = periods
      if (a.location) occ.locationNow = a.location
      followShifts(occ, rules) // 落点本身若是调休源日，继续跟（先调课、后调休的场景）
    }
    if (!moved) break
  }
}

interface Index {
  blocks: Map<string, ResolvedBlock[]>
  markers: Map<string, DayMarker[]>
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** 一次性算出整学期的落点，按日期索引（周网格 7 列复用同一份） */
function buildIndex(ctx: ResolveContext): Index {
  const rules = rulesMapOf(ctx.rules)
  const adjustments = [...(ctx.adjustments ?? [])].sort((a, b) => a.id - b.id)
  const occurrences = occurrencesOf(ctx, rules)
  for (const occ of occurrences) settle(occ, adjustments, rules)

  const blocks: Map<string, ResolvedBlock[]> = new Map()
  const markers: Map<string, DayMarker[]> = new Map()

  for (const occ of occurrences) {
    const base = occ.course
    const lastHop = occ.chain[occ.chain.length - 1]
    // 最后一次只是换教室（原地调课）：块仍在这一格，但角标要说「换教室」而不是「调课」
    const roomOnly =
      !!lastHop &&
      lastHop.kind === 'move' &&
      lastHop.from === lastHop.to &&
      !!lastHop.location &&
      samePeriods(lastHop.periods, lastHop.fromPeriods)
    const multi = occ.chain.filter((h) => h.kind !== 'extra').length >= 2

    if (occ.cancelled) {
      // 停课：在「被停掉的那一站」留停课标记
      push(markers, occ.date, {
        courseId: base.id,
        name: base.name,
        color: base.color,
        weekday: getWeekday(parseDate(occ.date)),
        periods: occ.periods,
        kind: 'cancel',
        toDate: null,
        toPeriods: [],
        note: lastHop?.note ?? '',
        adjustmentId: lastHop?.adjustmentId ?? 0,
        chain: occ.chain,
      })
      continue
    }

    const source: ResolvedBlock['source'] =
      occ.born === 'extra'
        ? 'extra'
        : occ.chain.length === 0
          ? 'base'
          : lastHop.kind === 'move'
            ? 'moved'
            : 'shifted'

    push(blocks, occ.date, {
      id: base.id,
      sessionId: occ.sessionId,
      semesterId: base.semesterId,
      type: base.type,
      name: base.name,
      teacher: base.teacher,
      location: occ.locationNow,
      color: base.color,
      remark: base.remark,
      weekday: getWeekday(parseDate(occ.date)),
      periods: occ.periods,
      startPeriod: occ.periods.length ? occ.periods[0] : 1,
      endPeriod: occ.periods.length ? occ.periods[occ.periods.length - 1] : 1,
      runs: runsOf(occ.periods),
      allPeriods: occ.born === 'base' ? occ.originPeriods : occ.periods,
      weeks: [],
      active: true,
      source,
      originDate: occ.originDate,
      fromDate: occ.chain.length ? occ.originDate : undefined,
      fromWeekday: occ.chain.length ? getWeekday(parseDate(occ.originDate)) : undefined,
      fromPeriods: occ.chain.length ? occ.originPeriods : undefined,
      adjustmentId: lastHop?.adjustmentId || undefined,
      adjustmentNote: lastHop?.note,
      chain: occ.chain,
      multiAdjusted: multi,
      roomChanged: roomOnly,
    })

    // 途经各站（基准日 + 中间站）：留淡显标记，一律指向终到日。
    // 各站的时间组用它自己当时的（调课会改节次，中间站不该显示终到节的节次）。
    // 原点标记的性质：最后一次只是换教室时，用上一站（调休 / 调课）来说明「这一天为什么没课」
    const kindHop = roomOnly ? (occ.chain[occ.chain.length - 2] ?? lastHop) : lastHop
    let stopPeriods = occ.originPeriods.slice()
    for (const hop of occ.chain) {
      const here = hop.kind === 'move' && hop.fromPeriods.length ? hop.fromPeriods.slice() : stopPeriods.slice()
      if (hop.kind === 'move') stopPeriods = hop.periods.slice()
      if (hop.from === occ.date) continue // 环保护停在原站：不画重复标记
      const isOrigin = hop.from === occ.originDate && occ.born === 'base'
      push(markers, hop.from, {
        courseId: base.id,
        name: base.name,
        color: base.color,
        weekday: getWeekday(parseDate(hop.from)),
        periods: here.length ? here : occ.originPeriods.slice(),
        kind: isOrigin ? (kindHop.kind === 'shift' ? 'shift' : 'move') : 'via',
        toDate: occ.date,
        toPeriods: occ.periods,
        note: hop.note,
        adjustmentId: hop.adjustmentId,
        chain: occ.chain,
      })
    }
  }

  return { blocks, markers }
}

function dayView(
  dateStr: string,
  ctx: ResolveContext,
  rules: Map<string, DayRule>,
  index: Index,
): ResolvedDay {
  const date = parseDate(dateStr)
  const rule = rules.get(dateStr) ?? null
  /** 该日作为调休目标：有哪些源日的课被移到了这一天 */
  const shiftSources = [...rules.values()].filter((r) => r.kind === 'shift' && r.toDate === dateStr)
  const list = [...(index.blocks.get(dateStr) ?? [])]
  // 同节次同日期的并列排序：基准课在调来的课之前（与原实现一致，避免同课两块先后跳动）
  const rank = (b: ResolvedBlock) => (b.source === 'base' ? 0 : 1)
  list.sort(
    (x, y) =>
      x.startPeriod - y.startPeriod ||
      x.endPeriod - y.endPeriod ||
      rank(x) - rank(y) ||
      x.id - y.id,
  )
  const markers = [...(index.markers.get(dateStr) ?? [])]
  markers.sort((x, y) => (x.periods[0] ?? 0) - (y.periods[0] ?? 0) || x.courseId - y.courseId)

  return {
    date: dateStr,
    weekNumber: ctx.semester ? calcWeekNumber(date, ctx.semester) : null,
    effectiveWeekday: rule?.kind === 'holiday' || rule?.kind === 'shift' ? null : getWeekday(date),
    rule,
    shiftSources,
    dayLabel: dayRuleLabel(rule, shiftSources),
    blocks: list,
    markers,
  }
}

/** 解析某一天（单日调用：今天页 / 日卡 / 标记） */
export function resolveDay(date: Date, ctx: ResolveContext): ResolvedDay {
  const rules = rulesMapOf(ctx.rules)
  const merged: ResolveContext = { ...ctx, rules }
  return dayView(formatDate(date), merged, rules, buildIndex(merged))
}

/** 解析多天（周网格 7 列 / 手机日卡）：索引只建一次 */
export function resolveDays(dates: Date[], ctx: ResolveContext): ResolvedDay[] {
  const rules = rulesMapOf(ctx.rules)
  const merged: ResolveContext = { ...ctx, rules }
  const index = buildIndex(merged)
  return dates.map((d) => dayView(formatDate(d), merged, rules, index))
}

/** 单条调整记录的完整链路（台账详情卡 / 课程详情「查看链路」） */
export interface AdjustmentChain {
  courseName: string
  courseId: number
  originDate: string
  originPeriods: number[]
  steps: AdjustHop[]
  /** 终到日与终到节次；停课为 null */
  final: { date: string; periods: number[] } | null
  cancelled: boolean
}

export function explainAdjustment(
  adjustment: CourseAdjustment,
  ctx: ResolveContext,
): AdjustmentChain | null {
  const rules = rulesMapOf(ctx.rules)
  const merged: ResolveContext = { ...ctx, rules }
  const adjustments = [...(ctx.adjustments ?? [])].sort((a, b) => a.id - b.id)
  const occurrences = occurrencesOf(merged, rules).filter((o) => o.course.id === adjustment.courseId)
  for (const occ of occurrences) {
    settle(occ, adjustments, rules)
    if (occ.chain.some((h) => h.adjustmentId === adjustment.id && h.kind !== 'extra')) {
      return {
        courseName: occ.course.name,
        courseId: occ.course.id,
        originDate: occ.originDate,
        originPeriods: occ.originPeriods,
        steps: occ.chain,
        final: occ.cancelled ? null : { date: occ.date, periods: occ.periods },
        cancelled: occ.cancelled,
      }
    }
  }
  // 补课：链路就是它自己
  if (adjustment.kind === 'extra') {
    const c = ctx.courses.find((x) => x.id === adjustment.courseId)
    if (c) {
      return {
        courseName: c.name,
        courseId: c.id,
        originDate: adjustment.date,
        originPeriods: normalizeInts(adjustment.periods),
        steps: [
          {
            kind: 'extra',
            from: adjustment.date,
            to: adjustment.date,
            periods: normalizeInts(adjustment.periods),
            fromPeriods: [],
            note: adjustment.note,
            adjustmentId: adjustment.id,
          },
        ],
        final: { date: adjustment.date, periods: normalizeInts(adjustment.periods) },
        cancelled: false,
      }
    }
  }
  return null
}

/** 某门课的调整记录（课程详情展示 / 撤销用），按日期升序 */
export function adjustmentsOf(adjustments: CourseAdjustment[] | undefined, courseId: number): CourseAdjustment[] {
  return (adjustments ?? [])
    .filter((a) => a.courseId === courseId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
}

// ============================================================
// 显示面 → 详情卡：块 / 标记自带链条，直接合成同一张卡的数据
//   （解析结果里已带 chain 与基准信息，无需重跑解析）
// ============================================================

function originOf(
  item: { chain?: AdjustHop[]; originDate?: string; fromPeriods?: number[] },
  fallbackDate: string,
): [string, number[]] {
  const first = item.chain?.[0]
  const periods = item.fromPeriods?.length ? item.fromPeriods : (first?.fromPeriods ?? [])
  return [item.originDate ?? first?.from ?? fallbackDate, [...periods]]
}

/** 课表块（终到日视角）→ 详情卡数据；基准块（无链条）返回 null */
export function chainOfBlock(block: ResolvedBlock, dateStr: string): AdjustmentChain | null {
  if (!block.chain?.length) return null
  const [originDate, originPeriods] = originOf(block, dateStr)
  return {
    courseName: block.name,
    courseId: block.id,
    originDate,
    originPeriods,
    steps: block.chain,
    final: { date: dateStr, periods: [...block.periods] },
    cancelled: false,
  }
}

/** 原位置 / 中间站标记 → 详情卡数据（停课标记的终态为「已停课」） */
export function chainOfMarker(m: DayMarker, markerDate: string): AdjustmentChain | null {
  if (!m.chain?.length) return null
  const [originDate, originPeriods] = originOf(m, markerDate)
  return {
    courseName: m.name,
    courseId: m.courseId,
    originDate,
    originPeriods,
    steps: m.chain,
    final: m.kind === 'cancel' || !m.toDate ? null : { date: m.toDate, periods: [...m.toPeriods] },
    cancelled: m.kind === 'cancel',
  }
}
