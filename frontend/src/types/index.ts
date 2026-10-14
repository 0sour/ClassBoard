// ============================================================
// ClassBoard · 领域类型
// 课程模型：Course（课程组）+ CourseSession（上课时间组，含逐项 periods/weeks）
// 存储永远是逐项展开的数组；区间/文案由程序读取时派生，不写回。
// ============================================================

/** 星期：1=周一 … 7=周日 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** 课程类型：普通课 / 实验课 */
export type CourseType = 'course' | 'lab'

/** 节次模板行 */
export interface Period {
  id: number
  semesterId: number
  index: number
  startTime: string // HH:mm
  endTime: string // HH:mm
}

/** 上课时间组：同一星期的一组节次 × 一组周次 */
export interface CourseSession {
  id?: number
  weekday: Weekday
  /** 该时间段的地点（空则沿用课程默认地点） */
  location: string
  /** 逐项展开的节次，如 [3,4,5,6]（升序去重） */
  periods: number[]
  /** 逐项展开的周次，如 [11,12,13,14]（升序去重） */
  weeks: number[]
}

/** 课程组：一门课一行元数据 + 其全部上课时间 */
export interface Course {
  id: number
  semesterId: number
  type: CourseType
  name: string
  teacher: string
  location: string
  color: string // 8 色预设色名之一
  remark: string
  /** 空数组 = 无固定时间课程（实践类等）：不参与网格与冲突 */
  sessions: CourseSession[]
}

/**
 * 课程块（派生视图模型）：一个上课时间组对应一个可渲染块。
 * 网格 / 课程卡 / 日视图以此为渲染单位，由 Course + CourseSession 派生。
 */
export interface CourseBlock {
  /** 课程组 id（与 Course.id 相同，用于打开详情/编辑） */
  id: number
  /** 上课时间组 id（同一门课的多个时间段以此区分） */
  sessionId: number | null
  semesterId: number
  type: CourseType
  name: string
  teacher: string
  location: string
  color: string
  remark: string
  weekday: Weekday
  /** 该块在该周实际出现的节次（逐项，已按周次过滤） */
  periods: number[]
  /** 派生：最小节次（网格定位用） */
  startPeriod: number
  /** 派生：最大节次（网格定位用；节次稀疏时可能大于 periods 长度） */
  endPeriod: number
  /** 派生：连续区间列表，如 [[3,4],[6,6]] */
  runs: [number, number][]
  /** 派生：完整节次区间（不受当周过滤影响），用于冲突检测的保守判断 */
  allPeriods: number[]
  /** 该上课时间组的全部周次（详情显示用） */
  weeks: number[]
  /** 本周是否上课（周次数组是否包含本周周号） */
  active: boolean
}

/** 学期 */
export interface Semester {
  id: number
  name: string
  startDate: string // YYYY-MM-DD
  endDate: string
  weekStartDay: 1 | 7
}

/** 考试 */
export interface Exam {
  id: number
  semesterId: number
  courseId: number | null
  name: string
  datetime: string // YYYY-MM-DDTHH:mm
  location: string
  remark: string
}

/** 作业（班级公示内容：负责人添加，截止前始终显示，无个人完成态） */
export interface Homework {
  id: number
  semesterId: number
  courseId: number | null
  name: string
  dueAt: string
  remark: string
}

/** 班级通知（负责人手写；日期是排序键，置顶优先、其余按日期倒序，一条都不隐藏） */
export interface Notice {
  id: number
  classId: number
  date: string
  title: string
  body: string
  courseId: number | null
  pinned: boolean
  authorId: number | null
  authorName: string
  createdAt: string
  updatedAt: string
}

/**
 * 学期日历规则（日期级）：
 * - holiday：该日放假（当天不上课），支持区间录入（逐日一行）
 * - shift  ：整日移课——把 `date` 这一天的课移到 `toDate`
 *            （源日显示调休、目标日显示源日当天的课；不要求课表每周重复）
 */
export interface DayRule {
  id: number
  semesterId: number
  date: string // YYYY-MM-DD
  kind: 'holiday' | 'shift'
  /** kind='shift'：移到哪一天 */
  toDate: string | null
  note: string
}

/** 单课调整类型：停课 / 调课 / 补课 */
export type AdjustmentKind = 'cancel' | 'move' | 'extra'

/**
 * 单课日期调整（基准课表之上的日期覆盖层，不改动 course_slot）。
 * - cancel：date 当天该时间组停课
 * - move  ：date 当天该时间组的课改到 toDate 的 periods
 * - extra ：date（补课日）额外上一次 periods
 * fromWeekday/fromPeriods 定位原时间组（extra 不使用）。
 */
export interface CourseAdjustment {
  id: number
  courseId: number
  date: string
  kind: AdjustmentKind
  fromWeekday: Weekday | null
  fromPeriods: number[]
  toDate: string | null
  periods: number[]
  location: string
  note: string
  createdAt: string
}

/** 课程块的来源：基准课表 / 由其他日期调来（单课调课）/ 补课 / 整日调休移来 */
export type BlockSource = 'base' | 'moved' | 'extra' | 'shifted'

/** 调整链的一站：调休整日移课（ruleId）或单课调整（adjustmentId） */
export interface AdjustHop {
  kind: 'shift' | 'move' | 'cancel' | 'extra'
  /** 该站出发日期 */
  from: string
  /** 该站到达日期（cancel 为 null） */
  to: string | null
  /** 该站节次（cancel 为被停掉的节次） */
  periods: number[]
  fromPeriods: number[]
  note: string
  /** 单课调整 id；调休为 0，用 ruleId 指回日历规则 */
  adjustmentId: number
  ruleId?: number
}

/**
 * 解析后的课程块：在 CourseBlock 之上附加「来源」信息，
 * 供所有显示面（周网格 / 日卡 / 今天页 / 侧栏）统一标记「这门课是调过来的」。
 * 链式调整（调休 ⊕ 调课，任意顺序）：块只出现在**终到日**，
 * chain 记录途经的每一站（≥2 站 → multiAdjusted）。
 */
export interface ResolvedBlock extends CourseBlock {
  source: BlockSource
  /** 基准日期（最初那一天） */
  originDate?: string
  /** 调课 / 调休来源：原日期与原时间组（= 基准日与基准节次） */
  fromDate?: string
  fromWeekday?: Weekday | null
  fromPeriods?: number[]
  /** 关联的单课调整记录（可撤销；补课为出生记录） */
  adjustmentId?: number
  /** 调整备注 */
  adjustmentNote?: string
  /** 完整调整链（基准块为空数组） */
  chain?: AdjustHop[]
  /** 链上 ≥2 站：显示「多次调整」角标 */
  multiAdjusted?: boolean
}

/** 原位置标记：被停课 / 被调走 / 整日调休移走的课，在原来的那天留一个淡显标记；
 *  链式调整的「中间站」也留一个淡显标记（kind='via'，文案带「经此」） */
export interface DayMarker {
  courseId: number
  name: string
  color: string
  weekday: Weekday
  periods: number[]
  kind: 'cancel' | 'move' | 'shift' | 'via'
  /** 调课 / 调休目标日期（终到日） */
  toDate: string | null
  toPeriods: number[]
  note: string
  /** 从这一站把课调走的那条调整记录 id（整日调休站为 0，看 chain / ruleId） */
  adjustmentId: number
  /** 整日调休：对应的日历规则 id */
  ruleId?: number
  /** 完整调整链（终到日视角），用于点开同一张详情卡 */
  chain?: AdjustHop[]
}

/** 某一天解析结果：实际发生的课程块 + 原位置标记 + 该日日历规则 */
export interface ResolvedDay {
  date: string
  weekNumber: number | null
  /** 当天实际上课采用的星期（放假 / 调休移走为 null） */
  effectiveWeekday: Weekday | null
  /** 该日自己的日历规则 */
  rule: DayRule | null
  /** 该日作为调休目标时，被移来的源日规则列表 */
  shiftSources: DayRule[]
  /** 日头角标文案：'假期' | '调休' | '补 9月29日' | ''（由解析层统一生成，各显示面直接用） */
  dayLabel: string
  blocks: ResolvedBlock[]
  markers: DayMarker[]
}

/** 课程色板 */
export const COURSE_COLOR_NAMES = [
  'course-1',
  'course-2',
  'course-3',
  'course-4',
  'course-5',
  'course-6',
  'course-7',
  'course-8',
] as const

export type CourseColorName = (typeof COURSE_COLOR_NAMES)[number]
