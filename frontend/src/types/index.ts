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

/** 作业 */
export interface Homework {
  id: number
  semesterId: number
  courseId: number | null
  name: string
  dueAt: string
  done: boolean
  remark: string
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
