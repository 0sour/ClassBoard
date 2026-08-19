// ============================================================
// ClassBoard · scheduleStore（学期 / 周次 / 课程 / 节次）
// 数据源：后端 API 优先（remote 模式），后端不可用时回退本地 mock
// ============================================================
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, type ScheduleResponse, type SettingsPayload } from '@/api/client'
import { MOCK_COURSES, MOCK_PERIODS, MOCK_SEMESTER } from '@/data/mock'
import type { Course, Exam, Homework, Period, Semester, Weekday, WeekType } from '@/types'
import { pickCourseColor } from '@/utils/course'
import type { ImportRow } from '@/utils/pdf'
import {
  calcWeekNumber,
  formatDate,
  formatMonthDay,
  getWeekday,
  isOddWeek,
  isVisibleInWeek,
  parseDate,
  toMonday,
  weekDates,
} from '@/utils/week'

export const useScheduleStore = defineStore('schedule', () => {
  // 学期状态
  const semesters = ref<Semester[]>([MOCK_SEMESTER])
  const currentSemesterId = ref<number | null>(MOCK_SEMESTER.id)
  const periods = ref<Period[]>(MOCK_PERIODS)
  const courses = ref<Course[]>(MOCK_COURSES)

  // 事项状态（考试 / 作业，当前学期全量）
  const exams = ref<Exam[]>([])
  const homework = ref<Homework[]>([])

  // 周视图状态
  const weekOffset = ref(0) // 0=当前周，-1=上一周
  const showOddEvenFilter = ref(true)

  // 设置（提醒等；remote 模式以服务端为准）
  const settings = ref<SettingsPayload>({
    showOddEvenFilter: true,
    reminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
    labReminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
    homeworkReminder: { enabled: false, advanceDays: 2 },
    accessEnabled: false,
  })

  // 访问口令：开启且未登录时为 true（App 层据此展示口令页）
  const accessRequired = ref(false)

  // 远端模式：API 连接成功即为 true；weekContext 为 /api/schedule 的周聚合数据
  const remote = ref(false)
  const weekContext = ref<ScheduleResponse | null>(null)
  // 今天所在周的聚合数据：与周视图切换（weekOffset）解耦，日视图/「今日课程」据此显示
  const todayContext = ref<ScheduleResponse | null>(null)

  // 加载标志（骨架屏用，UI 设计文档 4.4）
  const mattersLoading = ref(false)

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

  /** 任意日期的课程（双日视图用）：按该日所在周独立过滤，跨周（周六+周日、滑入下周）正确。
   * remote 模式 courses 为当前学期全量（loadCourses 已拉取），不依赖单周 weekContext。 */
  function coursesOfDate(date: Date): Course[] {
    const wd = getWeekday(date)
    const info = weekInfoOf(date)
    if (info.weekNumber === null) return []
    return courses.value.filter((c) => {
      if (c.semesterId !== currentSemesterId.value) return false
      if (c.weekday !== wd) return false
      if (!showOddEvenFilter.value) return true
      return isVisibleInWeek(c.weekType, c.weekList, info.weekNumber)
    })
  }

  /** 今天真实日期所在周的周号（remote 以服务端为准） */
  const todayWeekNumber = computed(() => {
    if (remote.value && todayContext.value) return todayContext.value.week.weekNumber
    return currentSemester.value ? calcWeekNumber(toMonday(today.value), currentSemester.value) : null
  })

  /** 今天所在周的可见课程：不随周视图切换（weekOffset）变化，日视图/「今日课程」据此显示 */
  const todayCourses = computed<Course[]>(() => {
    if (remote.value && todayContext.value) return todayContext.value.courses
    return courses.value.filter((c) => {
      if (c.semesterId !== currentSemesterId.value) return false
      if (!showOddEvenFilter.value) return true
      return isVisibleInWeek(c.weekType, c.weekList, todayWeekNumber.value)
    })
  })

  /** 今天所在周按星期分组 */
  const todayCoursesByWeekday = computed<Record<Weekday, Course[]>>(() => {
    const map = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
    } as Record<Weekday, Course[]>
    for (const c of todayCourses.value) {
      map[c.weekday].push(c)
    }
    return map
  })

  /** 拉取今天所在周的聚合数据（与 refreshSchedule 的展示周相互独立） */
  async function refreshToday(): Promise<void> {
    if (!remote.value) return
    try {
      todayContext.value = await api.getSchedule(formatDate(toMonday(today.value)))
    } catch {
      // 拉取失败保留旧数据
    }
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
        // 访问口令已开启且未登录：标记后由 App 层展示口令页
        accessRequired.value = true
        return
      }
      accessRequired.value = false
      semesters.value = ctx.semesters
      currentSemesterId.value = ctx.currentSemesterId ?? (ctx.semesters[0]?.id ?? null)
      periods.value = ctx.periods
      showOddEvenFilter.value = ctx.settings.showOddEvenFilter
      settings.value = ctx.settings
      remote.value = true
      await loadCourses()
      await refreshSchedule()
      await refreshToday()
      await loadMatters()
    } catch {
      remote.value = false
    }
  }

  /** 拉取当前学期课程全量（颜色轮询/统计以真实数据为基准；远端拉取失败保留本地） */
  async function loadCourses(): Promise<void> {
    if (!remote.value) return
    try {
      const list = await api.listCourses(currentSemesterId.value ?? undefined)
      if (list.length) courses.value = list
    } catch {
      // 拉取失败保留本地数据
    }
  }

  /** 拉取当前学期考试与作业（事项页 / 信息面板 / 铃铛共用） */
  async function loadMatters(): Promise<void> {
    if (!remote.value) return
    mattersLoading.value = true
    try {
      const semId = currentSemesterId.value
      const [examList, hwList] = await Promise.all([
        api.listExams(semId ?? undefined),
        api.listHomework(semId ?? undefined),
      ])
      exams.value = examList
      homework.value = hwList
    } catch {
      // 拉取失败保留旧数据
    } finally {
      mattersLoading.value = false
    }
  }

  /** 口令校验成功后的恢复流程：重新拉取 context 并进入应用 */
  async function afterAccessVerified(): Promise<void> {
    accessRequired.value = false
    await bootstrap()
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
      await loadCourses()
      await refreshSchedule()
      await loadMatters()
    } catch {
      // 失败保持本地切换
    }
  }

  /** 创建学期（服务端自动生成默认节次模板并设为当前学期） */
  async function createSemester(payload: {
    name: string
    startDate: string
    endDate: string
    weekStartDay: 1 | 7
  }): Promise<Semester> {
    const created = await api.createSemester(payload)
    semesters.value.push(created)
    currentSemesterId.value = created.id
    await setSemester(created.id)
    return created
  }

  /** 删除学期（级联清理该学期全部数据；删除当前学期后自动切换） */
  async function deleteSemester(id: number): Promise<void> {
    await api.deleteSemester(id)
    semesters.value = semesters.value.filter((s) => s.id !== id)
    if (currentSemesterId.value === id) {
      const next = semesters.value.length ? semesters.value[0] : null
      currentSemesterId.value = next?.id ?? null
      if (next) {
        const ctx = await api.getContext()
        periods.value = ctx.periods
        await refreshSchedule()
        await loadMatters()
      }
    }
  }

  /** 新增节次行（追加到学期末尾） */
  async function addPeriod(payload: { startTime: string; endTime: string }): Promise<void> {
    if (!currentSemesterId.value) throw new Error('未设置当前学期')
    const created = await api.createPeriod({ semesterId: currentSemesterId.value, ...payload })
    periods.value.push(created)
  }
  /** 修改节次行起止时间 */
  async function updatePeriod(id: number, payload: { startTime: string; endTime: string }): Promise<void> {
    const updated = await api.updatePeriod(id, payload)
    const idx = periods.value.findIndex((p) => p.id === id)
    if (idx >= 0) periods.value[idx] = updated
    await refreshSchedule()
  }

  /** 删除节次行（剩余行自动重排） */
  async function deletePeriod(id: number): Promise<void> {
    await api.deletePeriod(id)
    periods.value = periods.value.filter((p) => p.id !== id)
    await refreshSchedule()
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
   * 颜色分配与手动录入一致（技术设计 3.3.1）：按录入顺序 8 色轮询，同名复用。
   * @param semesterId 目标学期，缺省为当前学期
   * @returns 实际写入的课程数
   */
  async function importCourses(rows: ImportRow[], mode: 'append' | 'overwrite', semesterId?: number): Promise<number> {
    const targetId = semesterId ?? currentSemesterId.value
    if (targetId === null) throw new Error('未设置当前学期，请先创建学期')
    // 逐行分配颜色：同名复用已有颜色，其余按顺序轮询（与 addCourse 一致）
    let autoCount = courses.value.length
    const colored = rows.map((row) => {
      const { color, autoCount: next } = pickCourseColor(courses.value, row.name, autoCount)
      autoCount = next
      return { ...row, color }
    })
    if (remote.value) {
      const res = await api.importConfirm({ mode, semesterId: targetId, rows: colored })
      await refreshSchedule()
      return res.count
    }
    // 本地 mock 模式
    if (mode === 'overwrite') {
      courses.value = courses.value.filter((c) => c.semesterId !== targetId)
    }
    let added = 0
    for (const row of colored) {
      const { color, autoCount: next } = pickCourseColor(courses.value, row.name, autoCount)
      autoCount = next
      courses.value.push({ ...row, id: nextId(), semesterId: targetId, color })
      added++
    }
    return added
  }

  /** 更新课程（remote 走 API，mock 本地写入） */
  async function updateCourse(id: number, payload: {
    type: 'course' | 'lab'
    name: string
    teacher: string
    location: string
    color: string
    weekType: WeekType
    weekList: number[] | null
    weekday: Weekday
    startPeriod: number
    endPeriod: number
    remark?: string
  }): Promise<Course> {
    if (remote.value) {
      const updated = await api.updateCourse(id, payload)
      const idx = courses.value.findIndex((c) => c.id === id)
      if (idx >= 0) courses.value[idx] = updated
      await refreshSchedule()
      return updated
    }
    const idx = courses.value.findIndex((c) => c.id === id)
    if (idx < 0) throw new Error('课程不存在')
    courses.value[idx] = { ...courses.value[idx], ...payload, remark: payload.remark ?? '' }
    return courses.value[idx]
  }

  /** 删除课程（关联考试/作业的 courseId 由服务端置空保留） */
  async function deleteCourse(id: number): Promise<void> {
    if (remote.value) {
      await api.deleteCourse(id)
      await loadMatters()
    }
    courses.value = courses.value.filter((c) => c.id !== id)
    await refreshSchedule()
  }

  // ---- 考试 ----
  async function addExam(payload: { courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }): Promise<Exam> {
    const created = await api.createExam({ semesterId: currentSemesterId.value ?? undefined, ...payload })
    exams.value.push(created)
    await refreshSchedule()
    return created
  }

  async function updateExam(id: number, payload: { courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }): Promise<Exam> {
    const updated = await api.updateExam(id, payload)
    const idx = exams.value.findIndex((e) => e.id === id)
    if (idx >= 0) exams.value[idx] = updated
    await refreshSchedule()
    return updated
  }

  async function deleteExam(id: number): Promise<void> {
    await api.deleteExam(id)
    exams.value = exams.value.filter((e) => e.id !== id)
    await refreshSchedule()
  }

  // ---- 作业 ----
  async function addHomework(payload: { courseId?: number | null; name: string; dueAt: string; remark?: string }): Promise<Homework> {
    const created = await api.createHomework({ semesterId: currentSemesterId.value ?? undefined, ...payload })
    homework.value.push(created)
    await refreshSchedule()
    return created
  }

  async function updateHomework(id: number, payload: { courseId?: number | null; name: string; dueAt: string; remark?: string }): Promise<Homework> {
    const updated = await api.updateHomework(id, payload)
    const idx = homework.value.findIndex((h) => h.id === id)
    if (idx >= 0) homework.value[idx] = updated
    await refreshSchedule()
    return updated
  }

  /** 切换作业完成状态（列表勾选即时生效） */
  async function setHomeworkDone(id: number, done: boolean): Promise<void> {
    const idx = homework.value.findIndex((h) => h.id === id)
    if (idx >= 0) homework.value[idx] = { ...homework.value[idx], done }
    try {
      await api.setHomeworkDone(id, done)
      await refreshSchedule()
    } catch (e) {
      if (idx >= 0) homework.value[idx] = { ...homework.value[idx], done: !done }
      throw e
    }
  }

  async function deleteHomework(id: number): Promise<void> {
    await api.deleteHomework(id)
    homework.value = homework.value.filter((h) => h.id !== id)
    await refreshSchedule()
  }

  // ---- 设置 ----
  /** 部分写设置（提醒 / 单双周过滤），成功后同步本地 */
  async function updateSettings(patch: Partial<SettingsPayload>): Promise<void> {
    if (!remote.value) {
      settings.value = { ...settings.value, ...patch }
      if (patch.showOddEvenFilter !== undefined) showOddEvenFilter.value = patch.showOddEvenFilter
      return
    }
    const updated = await api.updateSettings(patch)
    settings.value = updated
    showOddEvenFilter.value = updated.showOddEvenFilter
    if (patch.showOddEvenFilter !== undefined) await refreshSchedule()
  }

  /** 单双周过滤开关（同时写回设置） */
  async function setShowOddEvenFilter(v: boolean): Promise<void> {
    showOddEvenFilter.value = v
    if (!remote.value) {
      settings.value = { ...settings.value, showOddEvenFilter: v }
      return
    }
    try {
      const updated = await api.updateSettings({ showOddEvenFilter: v })
      settings.value = updated
      await refreshSchedule()
    } catch {
      // 本地已生效，服务端失败时保留
    }
  }

  // ---- 访问口令 ----
  async function verifyAccess(passphrase: string): Promise<void> {
    await api.verifyAccess(passphrase)
    await afterAccessVerified()
  }

  async function enableAccess(passphrase: string): Promise<void> {
    await api.enableAccess(passphrase)
    settings.value = { ...settings.value, accessEnabled: true }
  }

  async function disableAccess(passphrase: string): Promise<void> {
    await api.disableAccess(passphrase)
    settings.value = { ...settings.value, accessEnabled: false }
  }

  async function logoutAccess(): Promise<void> {
    await api.logoutAccess()
  }

  /** 供日视图/聚合使用：某日期所在周信息
   * remote 模式下仅当日期属于当前展示周时直接使用服务端周号，
   * 其余日期按本地学期起止计算（与周视图切换解耦，不随 weekOffset 漂移） */
  function weekInfoOf(date: Date) {
    const mon = toMonday(date)
    const inDisplayedWeek =
      remote.value && weekContext.value &&
      weekContext.value.week.startDate === formatDate(mon)
    const weekNo = inDisplayedWeek && weekContext.value
      ? weekContext.value.week.weekNumber
      : currentSemester.value
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
    bootstrap,
    semesters,
    currentSemesterId,
    currentSemester,
    periods,
    courses,
    exams,
    homework,
    weekOffset,
    showOddEvenFilter,
    settings,
    accessRequired,
    remote,
    mattersLoading,
    weekContext,
    today,
    anchorMonday,
    weekDays,
    weekNumber,
    isOdd,
    weekTitle,
    visibleCourses,
    coursesByWeekday,
    coursesOf,
    coursesOfDate,
    todayWeekNumber,
    todayCourses,
    todayCoursesByWeekday,
    refreshToday,
    weekExams,
    weekHomework,
    weekInfoOf,
    nextWeek,
    prevWeek,
    goNow,
    setSemester,
    createSemester,
    deleteSemester,
    updateSemester,
    addPeriod,
    updatePeriod,
    deletePeriod,
    addCourse,
    updateCourse,
    deleteCourse,
    importCourses,
    addExam,
    updateExam,
    deleteExam,
    addHomework,
    updateHomework,
    setHomeworkDone,
    deleteHomework,
    loadMatters,
    updateSettings,
    setShowOddEvenFilter,
    verifyAccess,
    enableAccess,
    disableAccess,
    logoutAccess,
  }
})

/** 今天是否在展示周内（供今天列高亮） */
export function isTodayInView(view: Date[], today: Date): boolean {
  return view.some((d) => d.getTime() === today.getTime())
}

export { parseDate }
