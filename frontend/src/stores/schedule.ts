// ============================================================
// ClassBoard · scheduleStore（学期 / 周次 / 课程 / 节次）
// 数据源：后端 API 优先（remote 模式），后端不可用时回退本地 mock
// ============================================================
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, type ScheduleResponse } from '@/api/client'
import { MOCK_COURSES, MOCK_PERIODS, MOCK_SEMESTER } from '@/data/mock'
import type { Course, Period, Semester, Weekday, WeekType } from '@/types'
import { pickCourseColor } from '@/utils/course'
import type { ImportRow } from '@/utils/pdf'
import {
  calcWeekNumber,
  formatDate,
  formatMonthDay,
  isOddWeek,
  isVisibleInWeek,
  parseDate,
  toMonday,
  weekDates,
} from '@/utils/week'

export const useScheduleStore = defineStore('schedule', () => {
  // 学期状态
  const semesters = ref<Semester[]>([MOCK_SEMESTER])
  const currentSemesterId = ref<number>(MOCK_SEMESTER.id)
  const periods = ref<Period[]>(MOCK_PERIODS)
  const courses = ref<Course[]>(MOCK_COURSES)

  // 周视图状态
  const weekOffset = ref(0) // 0=当前周，-1=上一周
  const showOddEvenFilter = ref(true)

  // 远端模式：API 连接成功即为 true；weekContext 为 /api/schedule 的周聚合数据
  const remote = ref(false)
  const weekContext = ref<ScheduleResponse | null>(null)

  const currentSemester = computed(
    () => semesters.value.find((s) => s.id === currentSemesterId.value) ?? null,
  )

  const today = computed(() => new Date())

  /** 当前周周一锚点 */
  const anchorMonday = computed(() => {
    const monday = toMonday(today.value)
    monday.setDate(monday.getDate() + weekOffset.value * 7)
    return monday
  })

  /** 当前展示周的 7 天 */
  const weekDays = computed(() => weekDates(anchorMonday.value))

  /** 周序号（null=假期；remote 模式以服务端计算为准） */
  const weekNumber = computed(() => {
    if (remote.value && weekContext.value) return weekContext.value.week.weekNumber
    return currentSemester.value ? calcWeekNumber(anchorMonday.value, currentSemester.value) : null
  })

  const isOdd = computed(() => isOddWeek(weekNumber.value))

  /** 标题日期区间（周数/状态由 WeekNav badge 展示） */
  const weekTitle = computed(() => {
    const mon = weekDays.value[0]
    const sun = weekDays.value[6]
    return `${formatMonthDay(mon)}–${formatMonthDay(sun)}`
  })

  /** 课程集合：remote 模式为服务端按周过滤后的可见课程 */
  const visibleCourses = computed<Course[]>(() => {
    if (remote.value && weekContext.value) return weekContext.value.courses
    return courses.value.filter((c) => {
      if (c.semesterId !== currentSemesterId.value) return false
      if (!showOddEvenFilter.value) return true
      return isVisibleInWeek(c.weekType, c.weekList, weekNumber.value)
    })
  })

  /** 按星期分组 */
  const coursesByWeekday = computed<Record<Weekday, Course[]>>(() => {
    const map = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
    } as Record<Weekday, Course[]>
    for (const c of visibleCourses.value) {
      map[c.weekday].push(c)
    }
    return map
  })

  /** 某天的课程（日视图用） */
  function coursesOf(date: Date): Course[] {
    const wd = ((date.getDay() + 6) % 7 + 1) as Weekday
    return coursesByWeekday.value[wd]
  }

  /** 远端周数据（考试/作业，供后续页面接入） */
  const weekExams = computed(() => weekContext.value?.exams ?? [])
  const weekHomework = computed(() => weekContext.value?.homework ?? [])

  // ============================================================
  // 远端数据加载（mock 兜底）
  // ============================================================

  /** 启动：拉取 context（学期/当前学期/节次/设置），失败则保持 mock */
  async function bootstrap(): Promise<void> {
    try {
      const ctx = await api.getContext()
      if (ctx.accessRequired) {
        // 访问口令已开启：前端口令页（后续里程碑），当前保持 mock 展示
        return
      }
      semesters.value = ctx.semesters
      currentSemesterId.value = ctx.currentSemesterId ?? (ctx.semesters[0]?.id ?? null)
      periods.value = ctx.periods
      showOddEvenFilter.value = ctx.settings.showOddEvenFilter
      remote.value = true
      await refreshSchedule()
    } catch {
      remote.value = false
    }
  }

  /** 按当前展示周刷新 /api/schedule */
  async function refreshSchedule(): Promise<void> {
    if (!remote.value) return
    try {
      const date = formatDate(anchorMonday.value)
      weekContext.value = await api.getSchedule(date)
    } catch {
      // 拉取失败时保留旧数据
    }
  }

  function nextWeek(): void {
    weekOffset.value += 1
    void refreshSchedule()
  }

  function prevWeek(): void {
    weekOffset.value -= 1
    void refreshSchedule()
  }

  function goNow(): void {
    weekOffset.value = 0
    void refreshSchedule()
  }

  async function setSemester(id: number): Promise<void> {
    currentSemesterId.value = id
    weekOffset.value = 0
    if (!remote.value) return
    try {
      await api.setCurrentSemester(id)
      const ctx = await api.getContext()
      periods.value = ctx.periods
      await refreshSchedule()
    } catch {
      // 失败保持本地切换
    }
  }

  /** 更新学期信息（设置页编辑开始/结束日期） */
  async function updateSemester(
    id: number,
    patch: { name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 },
  ): Promise<void> {
    if (remote.value) {
      const updated = await api.updateSemester(id, patch)
      const idx = semesters.value.findIndex((s) => s.id === id)
      if (idx >= 0) semesters.value[idx] = updated
      if (id === currentSemesterId.value) await refreshSchedule()
    } else {
      const idx = semesters.value.findIndex((s) => s.id === id)
      if (idx >= 0) semesters.value[idx] = { ...semesters.value[idx], ...patch }
    }
  }

  /** mock 模式自增 id */
  const nextId = () => Math.max(0, ...courses.value.map((c) => c.id)) + 1

  /** 手动新增课程（含实验课）：remote 走 API，mock 本地写入 */
  async function addCourse(
    payload: {
      type: 'course' | 'lab'
      name: string
      teacher: string
      location: string
      weekType: WeekType
      weekList: number[] | null
      weekday: Weekday
      startPeriod: number
      endPeriod: number
      remark?: string
    },
  ): Promise<Course> {
    const semesterId = currentSemesterId.value
    if (semesterId === null) throw new Error('未设置当前学期，请先创建学期')
    if (remote.value) {
      const { color } = pickCourseColor(courses.value, payload.name, courses.value.length)
      const created = await api.createCourse({ ...payload, semesterId, color })
      courses.value.push(created)
      await refreshSchedule()
      return created
    }
    let autoCount = courses.value.length
    const { color, autoCount: next } = pickCourseColor(courses.value, payload.name, autoCount)
    autoCount = next
    const course: Course = { ...payload, id: nextId(), semesterId, color, remark: payload.remark ?? '' }
    courses.value.push(course)
    return course
  }

  /** 导入落库：remote 模式提交服务端事务（追加/覆盖），本地模式直接写入。
   * @param semesterId 目标学期，缺省为当前学期
   * @returns 实际写入的课程数
   */
  async function importCourses(rows: ImportRow[], mode: 'append' | 'overwrite', semesterId?: number): Promise<number> {
    const targetId = semesterId ?? currentSemesterId.value
    if (targetId === null) throw new Error('未设置当前学期，请先创建学期')
    if (remote.value) {
      const res = await api.importConfirm({ mode, semesterId: targetId, rows })
      await refreshSchedule()
      return res.count
    }
    // 本地 mock 模式
    if (mode === 'overwrite') {
      courses.value = courses.value.filter((c) => c.semesterId !== targetId)
    }
    let autoCount = courses.value.length
    let added = 0
    for (const row of rows) {
      const { color, autoCount: next } = pickCourseColor(courses.value, row.name, autoCount)
      autoCount = next
      courses.value.push({ ...row, id: nextId(), semesterId: targetId, color })
      added++
    }
    return added
  }

  /** 供日视图/聚合使用：某日期所在周信息 */
  function weekInfoOf(date: Date) {
    const mon = toMonday(date)
    const weekNo = remote.value && weekContext.value ? weekContext.value.week.weekNumber : currentSemester.value
      ? calcWeekNumber(mon, currentSemester.value)
      : null
    return {
      dateStr: formatDate(date),
      weekday: ((date.getDay() + 6) % 7 + 1) as Weekday,
      weekNumber: weekNo,
      isOdd: isOddWeek(weekNo),
    }
  }

  // 启动时自动尝试连接后端
  void bootstrap()

  return {
    semesters,
    currentSemesterId,
    currentSemester,
    periods,
    courses,
    weekOffset,
    showOddEvenFilter,
    remote,
    today,
    anchorMonday,
    weekDays,
    weekNumber,
    isOdd,
    weekTitle,
    visibleCourses,
    coursesByWeekday,
    coursesOf,
    weekExams,
    weekHomework,
    weekInfoOf,
    nextWeek,
    prevWeek,
    goNow,
    setSemester,
    updateSemester,
    addCourse,
    importCourses,
  }
})

/** 今天是否在展示周内（供今天列高亮） */
export function isTodayInView(view: Date[], today: Date): boolean {
  return view.some((d) => d.getTime() === today.getTime())
}

export { parseDate }
