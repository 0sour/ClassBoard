// ============================================================
// ClassBoard · scheduleStore（学期 / 周次 / 课程 / 节次）
// 数据源：后端 API 优先；连接失败进入明确的「连接失败」状态（可重试），不回退 mock
// 课程模型：course 组 + sessions（每个上课时间一组逐项 periods/weeks）
// ============================================================
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  api,
  type ScheduleCourseBlock,
  type ScheduleResponse,
  type SettingsPayload,
  type UserInfo,
  type WeatherData,
} from '@/api/client'
import type { Course, CourseBlock, Exam, Homework, Period, Semester, Weekday } from '@/types'
import { pickCourseColor } from '@/utils/course'
import { courseBlocks, normalizeServerBlock, runsOf, toBlocks } from '@/utils/session'
import type { ImportRow } from '@/utils/pdf'
import {
  calcWeekNumber,
  formatDate,
  formatMonthDay,
  getWeekday,
  isOddWeek,
  parseDate,
  toMonday,
  weekDates,
} from '@/utils/week'

/** 服务端课程块 → 前端 CourseBlock */
function serverBlockToBlock(raw: ScheduleCourseBlock): CourseBlock {
  // 服务端的 startPeriod/endPeriod 基于「本周节次」，跨节课程在部分周会缩水；
  // 网格定位与冲突检测统一用完整节次（allPeriods），保证块位置不随切周跳变。
  const allPeriods = raw.allPeriods?.length ? raw.allPeriods : raw.periods
  return normalizeServerBlock({
    id: raw.id,
    sessionId: raw.sessionId,
    semesterId: raw.semesterId,
    type: raw.type,
    name: raw.name,
    teacher: raw.teacher,
    location: raw.location,
    color: raw.color,
    remark: raw.remark,
    weekday: raw.weekday as Weekday,
    periods: raw.periods,
    startPeriod: allPeriods.length ? allPeriods[0] : raw.startPeriod,
    endPeriod: allPeriods.length ? allPeriods[allPeriods.length - 1] : raw.endPeriod,
    runs: runsOf(raw.periods),
    allPeriods,
    weeks: [],
    active: true,
  })
}

/** 课程写入载荷（元数据 + 上课时间组） */
export interface CourseWritePayload {
  type: 'course' | 'lab'
  name: string
  teacher: string
  location: string
  color?: string
  remark?: string
  sessions: { weekday: Weekday; location: string; periods: number[]; weeks: number[] }[]
}

export const useScheduleStore = defineStore('schedule', () => {
  // 学期状态
  const semesters = ref<Semester[]>([])
  const currentSemesterId = ref<number | null>(null)
  const periods = ref<Period[]>([])
  const courses = ref<Course[]>([])

  // 事项状态（考试 / 作业，当前学期全量）
  const exams = ref<Exam[]>([])
  const homework = ref<Homework[]>([])

  // 周视图状态
  const weekOffset = ref(0) // 0=当前周，-1=上一周
  /** 已废弃的单双周过滤：周次已逐项存储，保留开关语义为「忽略周次过滤，显示全部课程」 */
  const showOddEvenFilter = ref(true)

  // 设置（提醒等；remote 模式以服务端为准）
  const settings = ref<SettingsPayload>({
    showOddEvenFilter: true,
    reminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
    labReminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
    homeworkReminder: { enabled: false, advanceDays: 2 },
    accessEnabled: false,
    weather: { enabled: false, apiKey: '', location: '' },
  })

  // 天气数据（/api/weather；服务端 30 分钟缓存）
  const weatherData = ref<WeatherData | null>(null)
  const weatherLoading = ref(false)

  async function refreshWeather(): Promise<void> {
    if (!remote.value || !settings.value.weather?.enabled) {
      weatherData.value = null
      return
    }
    weatherLoading.value = true
    try {
      weatherData.value = await api.getWeather()
    } catch {
      weatherData.value = null
    } finally {
      weatherLoading.value = false
    }
  }

  // 未登录时为 true（App 层据此展示口令页）
  const accessRequired = ref(false)

  // 远端模式：API 连接成功即为 true
  const remote = ref(false)
  /** 连接失败状态（区分「后端不可达」与「数据为空」——不再回退 mock 造成错觉） */
  const connectError = ref<string | null>(null)
  const bootstrapping = ref(false)
  const weekContext = ref<ScheduleResponse | null>(null)
  const todayContext = ref<ScheduleResponse | null>(null)

  // 加载标志（骨架屏用）
  const mattersLoading = ref(false)

  const currentSemester = computed(
    () => semesters.value.find((s) => s.id === currentSemesterId.value) ?? null,
  )

  /**
   * 当前日期。用 ref 而非 computed(() => new Date())：
   * 后者没有响应式依赖，首次求值后永久缓存，挂机跨天后「今天」页/周号/铃铛会停在旧日期。
   * 由 tickDate() 定时刷新（App 启动时注册）。
   */
  const today = ref(new Date())

  /** 跨天检查：日期字符串变化时更新 today 并重拉「今天」所在周数据 */
  function tickDate(): boolean {
    const now = new Date()
    const sameDay =
      now.getFullYear() === today.value.getFullYear() &&
      now.getMonth() === today.value.getMonth() &&
      now.getDate() === today.value.getDate()
    if (sameDay) return false
    today.value = now
    // 跨天后「今天」相关的周数据（今日课程、铃铛）需要重取
    void refreshToday()
    return true
  }

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

  /** 标题日期区间 */
  const weekTitle = computed(() => {
    const mon = weekDays.value[0]
    const sun = weekDays.value[6]
    return `${formatMonthDay(mon)}–${formatMonthDay(sun)}`
  })

  /**
   * 展示周的课程块：remote 模式用服务端按周聚合的结果；
   * 本地模式由课程组按周号派生（周次数组包含即出现）。
   */
  const visibleCourseBlocks = computed<CourseBlock[]>(() => {
    if (remote.value && weekContext.value) {
      return weekContext.value.courses.map(serverBlockToBlock)
    }
    const wn = weekNumber.value
    if (wn === null) return []
    if (!showOddEvenFilter.value) {
      // 开关关闭：显示全部课程（忽略周次过滤）
      return courses.value
        .filter((c) => c.semesterId === currentSemesterId.value)
        .flatMap((c) => courseBlocks(c))
    }
    return courses.value
      .filter((c) => c.semesterId === currentSemesterId.value)
      .flatMap((c) => toBlocks(c, wn).filter((b) => b.active))
  })

  /** 按星期分组（渲染单位：课程块） */
  const blocksByWeekday = computed<Record<Weekday, CourseBlock[]>>(() => {
    const map = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] } as Record<Weekday, CourseBlock[]>
    for (const b of visibleCourseBlocks.value) map[b.weekday].push(b)
    return map
  })


  /** 任意日期的课程块（双日视图用）：按该日所在周独立过滤 */
  function coursesOfDate(date: Date): CourseBlock[] {
    const wd = getWeekday(date)
    const info = weekInfoOf(date)
    if (info.weekNumber === null || info.weekNumber === 0) return []
    return courses.value
      .filter((c) => c.semesterId === currentSemesterId.value)
      .flatMap((c) => toBlocks(c, info.weekNumber))
      .filter((b) => b.active && b.weekday === wd)
  }

  /** 今天真实日期所在周的周号 */
  const todayWeekNumber = computed(() => {
    if (remote.value && todayContext.value) return todayContext.value.week.weekNumber
    return currentSemester.value ? calcWeekNumber(toMonday(today.value), currentSemester.value) : null
  })

  /** 今天所在周的可见课程块 */
  const todayCourseBlocks = computed<CourseBlock[]>(() => {
    if (remote.value && todayContext.value) return todayContext.value.courses.map(serverBlockToBlock)
    const wn = todayWeekNumber.value
    if (wn === null) return []
    return courses.value
      .filter((c) => c.semesterId === currentSemesterId.value)
      .flatMap((c) => toBlocks(c, wn).filter((b) => b.active))
  })


  /** 今天所在周按星期分组 */
  const todayCoursesByWeekday = computed<Record<Weekday, CourseBlock[]>>(() => {
    const map = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] } as Record<Weekday, CourseBlock[]>
    for (const c of todayCourseBlocks.value) map[c.weekday].push(c)
    return map
  })

  /** 拉取今天所在周的聚合数据 */
  async function refreshToday(): Promise<void> {
    if (!remote.value) return
    try {
      todayContext.value = await api.getSchedule(formatDate(toMonday(today.value)))
    } catch {
      // 拉取失败保留旧数据
    }
  }

  // ============================================================
  // 远端数据加载
  // ============================================================

  const currentUser = ref<UserInfo | null>(null)
  const signupEnabled = ref(false)

  /**
   * 启动：拉取 context，失败时进入 connectError 状态并保留已有数据。
   * 不再回退 mock 课表——避免「课程看起来丢了」的错觉。
   */
  async function bootstrap(): Promise<void> {
    bootstrapping.value = true
    try {
      const ctx = await api.getContext()
      if (ctx.accessRequired) {
        accessRequired.value = true
        return
      }
      accessRequired.value = false
      connectError.value = null
      currentUser.value = ctx.user ?? null
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
      await refreshWeather()
    } catch (e) {
      // 保留已有数据；标记连接失败供 UI 提示与重试
      connectError.value = e instanceof Error ? e.message : '无法连接服务器'
    } finally {
      bootstrapping.value = false
    }
  }

  async function login(username: string, password: string, remember: boolean): Promise<void> {
    const res = await api.login(username, password, remember)
    currentUser.value = res.user
    await afterAccessVerified()
  }

  async function register(username: string, password: string): Promise<void> {
    const res = await api.register(username, password)
    currentUser.value = res.user
    await afterAccessVerified()
  }

  async function logout(): Promise<void> {
    try {
      await api.logout()
    } catch {
      // 忽略登出失败
    }
    currentUser.value = null
    accessRequired.value = true
    remote.value = false
  }

  async function refreshSignupEnabled(): Promise<void> {
    try {
      const res = await api.getSignupEnabled()
      signupEnabled.value = res.enabled
    } catch {
      signupEnabled.value = false
    }
  }

  /** 拉取当前学期课程全量（颜色轮询/统计以真实数据为基准；失败保留本地并抛出） */
  async function loadCourses(): Promise<void> {
    if (!remote.value) return
    const list = await api.listCourses(currentSemesterId.value ?? undefined)
    // 真实为空要如实反映（不再用 if (list.length) 掩盖清空结果）
    courses.value = list
  }

  /** 拉取当前学期考试与作业 */
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

  function goToWeek(week: number): void {
    const base = todayWeekNumber.value
    if (base !== null) {
      weekOffset.value = week - base
    } else {
      const sem = currentSemester.value
      if (!sem) return
      const firstMonday = toMonday(parseDate(sem.startDate))
      const target = new Date(firstMonday)
      target.setDate(firstMonday.getDate() + (week - 1) * 7)
      weekOffset.value = Math.round((target.getTime() - toMonday(today.value).getTime()) / 86400000 / 7)
    }
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
      await refreshToday()
      await loadMatters()
    } catch {
      // 失败保持本地切换
    }
  }

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
      }
    }
    // 无论是否删的是当前学期，都要重拉课程与周数据（修复残留旧课程）
    await loadCourses()
    await refreshSchedule()
    await refreshToday()
    await loadMatters()
  }

  async function addPeriod(payload: { startTime: string; endTime: string }): Promise<void> {
    if (!currentSemesterId.value) throw new Error('未设置当前学期')
    const created = await api.createPeriod({ semesterId: currentSemesterId.value, ...payload })
    periods.value.push(created)
  }

  async function updatePeriod(id: number, payload: { startTime: string; endTime: string }): Promise<void> {
    const updated = await api.updatePeriod(id, payload)
    const idx = periods.value.findIndex((p) => p.id === id)
    if (idx >= 0) periods.value[idx] = updated
    await refreshSchedule()
  }

  /** 删除节次行（剩余行自动重排；被删节次上的课程时间一并移除，后续节次前移） */
  async function deletePeriod(id: number): Promise<{ removedPeriod: number; affectedCourses: number }> {
    const res = await api.deletePeriod(id)
    periods.value = periods.value.filter((p) => p.id !== id)
    // 节次序号变化会同步迁移课程格子，需重拉课程与周数据
    await loadCourses()
    await refreshSchedule()
    await refreshToday()
    return res
  }

  async function updateSemester(
    id: number,
    patch: { name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 },
  ): Promise<void> {
    const updated = await api.updateSemester(id, patch)
    const idx = semesters.value.findIndex((s) => s.id === id)
    if (idx >= 0) semesters.value[idx] = updated
    if (id === currentSemesterId.value) await refreshSchedule()
  }

  /** 新增课程（含实验课与无固定时间课程） */
  async function addCourse(payload: CourseWritePayload): Promise<Course> {
    const semesterId = currentSemesterId.value
    if (semesterId === null) throw new Error('未设置当前学期，请先创建学期')
    const { color } = pickCourseColor(courses.value, payload.name, courses.value.length)
    const created = await api.createCourse({
      semesterId,
      type: payload.type,
      name: payload.name,
      teacher: payload.teacher,
      location: payload.location,
      color: payload.color ?? color,
      remark: payload.remark,
      sessions: payload.sessions,
    })
    courses.value.push(created)
    await refreshSchedule()
    await refreshToday()
    return created
  }

  /** 导入落库：remote 提交服务端事务（追加/覆盖），本地模式直接写入。
   * @param keepLabs 覆盖导入时保留已有实验课（PDF 只产理论课时的救生索）
   */
  async function importCourses(
    rows: ImportRow[],
    mode: 'append' | 'overwrite',
    semesterId?: number,
    keepLabs = false,
  ): Promise<{ count: number; removed: number; keptLabs: number }> {
    const targetId = semesterId ?? currentSemesterId.value
    if (targetId === null) throw new Error('未设置当前学期，请先创建学期')
    let autoCount = courses.value.length
    const colored = rows.map((row) => {
      const { color, autoCount: next } = pickCourseColor(courses.value, row.name, autoCount)
      autoCount = next
      return { ...row, color: row.color ?? color }
    })
    const res = await api.importConfirm({ mode, semesterId: targetId, rows: colored, keepLabs })
    await loadCourses()
    await refreshSchedule()
    await refreshToday()
    return { count: res.count, removed: res.removed ?? 0, keptLabs: res.keptLabs ?? 0 }
  }

  /** 更新课程（整组原子替换：元数据 + 全部上课时间） */
  async function updateCourse(id: number, payload: CourseWritePayload): Promise<Course> {
    const updated = await api.updateCourse(id, {
      type: payload.type,
      name: payload.name,
      teacher: payload.teacher,
      location: payload.location,
      color: payload.color ?? (courses.value.find((c) => c.id === id)?.color ?? 'course-1'),
      remark: payload.remark,
      sessions: payload.sessions,
    })
    const idx = courses.value.findIndex((c) => c.id === id)
    if (idx >= 0) courses.value[idx] = updated
    await refreshSchedule()
    await refreshToday()
    return updated
  }

  /** 删除课程（关联考试/作业的 courseId 由服务端置空保留） */
  async function deleteCourse(id: number): Promise<void> {
    if (remote.value) {
      await api.deleteCourse(id)
      await loadMatters()
    }
    courses.value = courses.value.filter((c) => c.id !== id)
    await refreshSchedule()
    await refreshToday()
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
  async function updateSettings(patch: Partial<SettingsPayload>): Promise<void> {
    const updated = await api.updateSettings(patch)
    settings.value = updated
    showOddEvenFilter.value = updated.showOddEvenFilter
    if (patch.showOddEvenFilter !== undefined) await refreshSchedule()
    if (patch.weather !== undefined) await refreshWeather()
  }

  async function setShowOddEvenFilter(v: boolean): Promise<void> {
    showOddEvenFilter.value = v
    try {
      const updated = await api.updateSettings({ showOddEvenFilter: v })
      settings.value = updated
      await refreshSchedule()
    } catch {
      // 本地已生效，服务端失败时保留
    }
  }


  /** 供日视图/聚合使用：某日期所在周信息 */
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
      weekday: getWeekday(date),
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
    weatherData,
    weatherLoading,
    refreshWeather,
    accessRequired,
    remote,
    connectError,
    bootstrapping,
    mattersLoading,
    weekContext,
    today,
    anchorMonday,
    weekDays,
    weekNumber,
    isOdd,
    weekTitle,
    visibleCourseBlocks,
    blocksByWeekday,
    coursesOfDate,
    todayWeekNumber,
    todayCourseBlocks,
    todayCoursesByWeekday,
    refreshToday,
    tickDate,
    refreshSchedule,
    weekInfoOf,
    nextWeek,
    prevWeek,
    goNow,
    goToWeek,
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
    loadCourses,
    updateSettings,
    setShowOddEvenFilter,
    currentUser,
    signupEnabled,
    login,
    register,
    logout,
    refreshSignupEnabled,
  }
})


