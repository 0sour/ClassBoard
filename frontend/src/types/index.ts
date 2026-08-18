// ============================================================
// ClassBoard · 领域类型
// ============================================================

/** 星期：1=周一 … 7=周日 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** 课程类型：普通课 / 实验课 */
export type CourseType = 'course' | 'lab'

/** 周规则 */
export type WeekType = 'all' | 'odd' | 'even' | 'custom'

/** 节次模板行 */
export interface Period {
  id: number
  semesterId: number
  index: number
  startTime: string // HH:mm
  endTime: string // HH:mm
}

/** 课程 */
export interface Course {
  id: number
  semesterId: number
  type: CourseType
  name: string
  teacher: string
  location: string
  color: string // 8 色预设色名之一
  weekType: WeekType
  weekList: number[] | null // custom 必填，其余可为空
  weekday: Weekday
  startPeriod: number
  endPeriod: number
  remark: string
  /** 无固定时间课程（实践类等）：详情显示「无固定时间」，不参与网格与冲突 */
  unscheduled?: boolean
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

/** 周上下文（聚合接口返回的周数据） */
export interface WeekContext {
  weekNumber: number | null
  isOddWeek: boolean
  isHoliday: boolean
  startDate: string
  endDate: string
  semester: Semester | null
  courses: Course[]
  exams: Exam[]
  homework: Homework[]
}

/** 课程色板（v2 三值结构） */
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
