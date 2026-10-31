// ============================================================
// ClassBoard · scheduleStore（班级 / 学期 / 周次 / 课程 / 节次）
// 归属：班级 → 多个学期 → 课表；后台按「当前班级」加载
// 公开班级页（无需登录）：loadPublicClass() 进入只读模式，写入动作一律拒绝
// 数据源：后端 API；连接失败进入明确的「连接失败」状态（可重试），不回退 mock
// ============================================================
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  api,
  type ClassInfo,
  type ScheduleResponse,
  type SettingsPayload,
  type UserInfo,
  type WeatherData,
} from '@/api/client'
import type { Attachment, Course, CourseAdjustment, CourseBlock, DayRule, Exam, Homework, Notice, Period, ResolvedDay, Semester, Weekday } from '@/types'
import type { AdjustmentPayload } from '@/api/client'
import { pickCourseColor } from '@/utils/course'
import { resolveDay, resolveDays, ruleMapOf, type ResolveContext } from '@/utils/calendar'
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
  // 班级（班级 → 多个学期 → 课表）
  const classes = ref<ClassInfo[]>([])
  const currentClassId = ref<number | null>(null)
  /** 只读模式（公开班级页）：隐藏一切写入交互，写入动作抛错 */
  const readonly = ref(false)
  /** 公开班级页的班级资料（只读模式下使用） */
  const publicClass = ref<{ id: number; school: string; name: string; major: string } | null>(null)

  // 学期状态
  const semesters = ref<Semester[]>([])
  const currentSemesterId = ref<number | null>(null)
  const periods = ref<Period[]>([])
  const courses = ref<Course[]>([])

  // 事项状态（考试 / 作业，当前学期全量）
  const exams = ref<Exam[]>([])
  const homework = ref<Homework[]>([])

  /** 班级通知（负责人手写；学生只读同一份） */
  const notices = ref<Notice[]>([])

  // 学期日历（放假 / 调休按周几上课）与单课调整（停课 / 调课 / 补课）
  const dayRules = ref<DayRule[]>([])
  const adjustments = ref<CourseAdjustment[]>([])

  // 周视图状态
  const weekOffset = ref(0) // 0=当前周，-1=上一周
  /** 已废弃的单双周过滤：周次已逐项存储，保留开关语义为「忽略周次过滤，显示全部课程」 */
  const showOddEvenFilter = ref(true)

  // 设置（显示 / 天气；remote 模式以服务端为准）
  const settings = ref<SettingsPayload>({
    showOddEvenFilter: true,
    weather: { enabled: false, apiKey: '', location: '' },
    site: { footerText: '', icp: '', policeIcp: '', showVisits: false },
  })

  // 天气数据（/api/weather；服务端 30 分钟缓存）
  const weatherData = ref<WeatherData | null>(null)
  const weatherLoading = ref(false)

  async function refreshWeather(): Promise<void> {
    if (!remote.value) {
      weatherData.value = null
      return
    }
    // 公开班级页：天气按班级城市（无需登录）；后台：管理员配置的城市
    if (readonly.value) {
      if (currentClassId.value === null) return
      weatherLoading.value = true
      try {
        const data = await api.getPublicWeather(currentClassId.value)
        weatherData.value = data?.enabled ? data : null
      } catch {
        weatherData.value = null
      } finally {
        weatherLoading.value = false
      }
      return
    }
    if (!settings.value.weather?.enabled) {
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

  /** 是否已登录（App/路由守卫据此决定进后台还是公开页） */
  const authenticated = ref(false)

  // 远端模式：API 连接成功即为 true
  const remote = ref(false)
  /** 连接失败状态（区分「后端不可达」与「数据为空」——不再回退 mock 造成错觉） */
  const connectError = ref<string | null>(null)
  const bootstrapping = ref(false)
  const weekContext = ref<ScheduleResponse | null>(null)
  const todayContext = ref<ScheduleResponse | null>(null)

  // 加载标志（骨架屏用）
  const mattersLoading = ref(false)

  /** 当前班级（后台的归属单位） */
  const currentClass = computed(() => classes.value.find((c) => c.id === currentClassId.value) ?? null)

  function classIdOrThrow(): number {
    if (currentClassId.value === null) throw new Error('还没有班级，请先创建或加入一个班级')
    return currentClassId.value
  }

  function assertWritable(): void {
    if (readonly.value) throw new Error('只读模式：公开页面不能修改数据')
  }

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

  /** 日历规则按日期索引 */
  const rulesByDate = computed(() => ruleMapOf(dayRules.value))

  /** 解析上下文：课程 / 日历规则 / 单课调整（唯一解析入口 resolveDay 的输入） */
  const resolveCtx = computed<ResolveContext>(() => ({
    semester: currentSemester.value,
    courses: courses.value.filter((c) => c.semesterId === currentSemesterId.value),
    rules: rulesByDate.value,
    adjustments: adjustments.value,
    ignoreWeeks: !showOddEvenFilter.value,
  }))

  /** 解析任意一天（手机滑动日卡 / 今天页 / 提醒） */
  function resolvedDayOf(date: Date): ResolvedDay {
    return resolveDay(date, resolveCtx.value)
  }

  /** 展示周 7 天的解析结果（桌面周网格按日期列渲染） */
  const resolvedWeek = computed<ResolvedDay[]>(() => resolveDays(weekDays.value, resolveCtx.value))

  /**
   * 展示周的课程块（含单课调整结果）。
   * remote 模式与本地模式同源：由课程时间组派生后叠加日历与调整，
   * 保证桌面网格、手机日卡、今天页看到的是同一份数据。
   */
  const visibleCourseBlocks = computed<CourseBlock[]>(() => resolvedWeek.value.flatMap((d) => d.blocks))

  /** 任意日期的课程块（手机滑动日卡 / 双日视图用）：走同一套解析（含调休与单课调整） */
  function coursesOfDate(date: Date): CourseBlock[] {
    return resolvedDayOf(date).blocks
  }

  /** 任意日期的解析结果（需要标记 / 规则信息时用） */
  function resolvedDay(date: Date): ResolvedDay {
    return resolvedDayOf(date)
  }

  /** 今天真实日期所在周的周号 */
  const todayWeekNumber = computed(() => {
    if (remote.value && todayContext.value) return todayContext.value.week.weekNumber
    return currentSemester.value ? calcWeekNumber(toMonday(today.value), currentSemester.value) : null
  })

  /** 今天的解析结果（今天页 / 铃铛 / 侧栏 / 提醒共用） */
  const todayResolved = computed<ResolvedDay>(() => resolvedDayOf(today.value))

  /** 今天实际要上的课（含调来 / 补课，已按当天日历规则解析） */
  const todayCourseBlocks = computed<CourseBlock[]>(() => todayResolved.value.blocks)

  /** 拉取今天所在周的聚合数据（公开只读页不需要：数据已随公开课表一次取回） */
  async function refreshToday(): Promise<void> {
    if (readonly.value) return
    if (!remote.value || currentClassId.value === null) return
    try {
      todayContext.value = await api.getSchedule({ classId: classIdOrThrow(), date: formatDate(toMonday(today.value)) })
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
      authenticated.value = ctx.authenticated
      if (!ctx.authenticated) {
        remote.value = false
        currentUser.value = null
        return
      }
      connectError.value = null
      currentUser.value = ctx.user ?? null
      settings.value = ctx.settings ?? settings.value
      showOddEvenFilter.value = settings.value.showOddEvenFilter
      classes.value = ctx.classes ?? []
      remote.value = true
      // 当前班级：沿用已选（若仍存在），否则取第一个
      if (currentClassId.value === null || !classes.value.some((c) => c.id === currentClassId.value)) {
        currentClassId.value = classes.value[0]?.id ?? null
      }
      await loadClassData()
    } catch (e) {
      // 保留已有数据；标记连接失败供 UI 提示与重试
      connectError.value = e instanceof Error ? e.message : '无法连接服务器'
    } finally {
      bootstrapping.value = false
    }
  }

  /** 加载当前班级的全部数据（学期 → 当前学期 → 节次 → 课程 → 日历 → 周 → 今天 → 事项 → 通知 → 天气） */
  async function loadClassData(): Promise<void> {
    if (!remote.value || currentClassId.value === null) return
    semesters.value = await api.listSemesters(currentClassId.value)
    currentSemesterId.value = currentClass.value?.currentSemesterId ?? semesters.value[0]?.id ?? null
    weekOffset.value = 0
    await loadSemesterData()
  }

  /** 加载当前学期下的全部数据 */
  async function loadSemesterData(): Promise<void> {
    if (currentSemesterId.value === null) {
      periods.value = []
      courses.value = []
      dayRules.value = []
      adjustments.value = []
      exams.value = []
      homework.value = []
      return
    }
    periods.value = await api.listPeriods({ semesterId: currentSemesterId.value })
    await loadCourses()
    await loadCalendar()
    await refreshSchedule()
    await refreshToday()
    await loadMatters()
    await loadNotices()
    await refreshWeather()
  }

  /** 切换当前班级（后台） */
  async function selectClass(id: number): Promise<void> {
    if (currentClassId.value === id) return
    currentClassId.value = id
    weekOffset.value = 0
    if (!remote.value) return
    try {
      await loadClassData()
    } catch {
      // 失败保留本地切换
    }
  }

  /** 公开班级页：无需登录，只读加载 */
  async function loadPublicClass(id: number): Promise<void> {
    readonly.value = true
    const info = await api.getPublicClass(id)
    publicClass.value = info.class
    classes.value = [
      {
        id: info.class.id,
        school: info.class.school,
        name: info.class.name,
        major: info.class.major,
        city: '',
        currentSemesterId: info.currentSemesterId,
        createdAt: '',
        updatedAt: '',
        semesterCount: info.semesters.length,
        memberCount: 0,
      },
    ]
    currentClassId.value = info.class.id
    semesters.value = info.semesters
    currentSemesterId.value = info.currentSemesterId ?? info.semesters[0]?.id ?? null
    periods.value = info.periods
    remote.value = true
    weekOffset.value = 0
    if (currentSemesterId.value === null) {
      courses.value = []
      dayRules.value = []
      adjustments.value = []
      exams.value = []
      homework.value = []
      return
    }
    const tt = await api.getPublicTimetable(currentClassId.value, currentSemesterId.value)
    periods.value = tt.periods
    courses.value = tt.courses
    dayRules.value = tt.dayRules
    adjustments.value = tt.adjustments
    await loadPublicFeed()
    await refreshWeather()
  }

  /** 公开页的作业 / 考试 / 通知（公示内容，无需登录；与后台同一份数据） */
  async function loadPublicFeed(): Promise<void> {
    const id = currentClassId.value
    if (id === null) return
    const semId = currentSemesterId.value ?? undefined
    try {
      const [hw, ex, ns] = await Promise.all([
        api.listPublicHomework(id, semId),
        api.listPublicExams(id, semId),
        api.listPublicNotices(id),
      ])
      homework.value = hw
      exams.value = ex
      notices.value = ns
    } catch {
      // 拉取失败保留旧数据
    }
  }

  /** 公开班级页的学期切换（只读，仅本地） */
  async function selectPublicSemester(id: number): Promise<void> {
    if (currentSemesterId.value === id) return
    currentSemesterId.value = id
    weekOffset.value = 0
    const tt = await api.getPublicTimetable(classIdOrThrow(), id)
    periods.value = tt.periods
    courses.value = tt.courses
    dayRules.value = tt.dayRules
    adjustments.value = tt.adjustments
    await loadPublicFeed()
  }

  /** 退出公开只读模式（回到后台时调用） */
  function clearPublicMode(): void {
    if (!readonly.value) return
    readonly.value = false
    publicClass.value = null
  }

  async function login(username: string, password: string, remember: boolean): Promise<void> {
    const res = await api.login(username, password, remember)
    currentUser.value = res.user
    await afterAccessVerified()
  }

  /** 注册班级负责人（提交学校 / 专业 / 班级名，等待管理员审核） */
  async function register(payload: {
    username: string
    password: string
    school: string
    major?: string
    className: string
  }): Promise<void> {
    const res = await api.register(payload)
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
    authenticated.value = false
    remote.value = false
    classes.value = []
    currentClassId.value = null
    // 清空账号数据：登出后不应继续显示上一位用户/班级的课表
    semesters.value = []
    currentSemesterId.value = null
    periods.value = []
    courses.value = []
    exams.value = []
    homework.value = []
    dayRules.value = []
    adjustments.value = []
    weekContext.value = null
    todayContext.value = null
    weatherData.value = null
    clearPublicMode()
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
    if (!remote.value || currentSemesterId.value === null) return
    const list = await api.listCourses({ semesterId: currentSemesterId.value ?? undefined })
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
        api.listExams({ semesterId: semId ?? undefined }),
        api.listHomework({ semesterId: semId ?? undefined }),
      ])
      exams.value = examList
      homework.value = hwList
    } catch {
      // 拉取失败保留旧数据
    } finally {
      mattersLoading.value = false
    }
  }

  /** 拉取当前学期日历规则与单课调整（与课程同源，解析层的输入） */
  async function loadCalendar(): Promise<void> {
    if (!remote.value) return
    const semId = currentSemesterId.value ?? undefined
    try {
      const [rules, list] = await Promise.all([
        api.listDayRules({ semesterId: semId }),
        api.listAdjustments({ semesterId: semId }),
      ])
      dayRules.value = rules
      adjustments.value = list
    } catch {
      // 拉取失败保留旧数据
    }
  }

  async function afterAccessVerified(): Promise<void> {
    authenticated.value = true
    clearPublicMode()
    await bootstrap()
  }

  /** 按当前展示周刷新 /api/schedule（公开只读页不走后台聚合接口：周次与课程由前端按学期计算） */
  async function refreshSchedule(): Promise<void> {
    if (readonly.value) return
    if (!remote.value || currentClassId.value === null) return
    try {
      const date = formatDate(anchorMonday.value)
      weekContext.value = await api.getSchedule({ classId: classIdOrThrow(), date })
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
    // 公开只读模式：仅本地切换
    if (readonly.value) {
      await selectPublicSemester(id)
      return
    }
    try {
      await api.setCurrentSemester(id)
      const cls = classes.value.find((c) => c.id === currentClassId.value)
      if (cls) cls.currentSemesterId = id
      periods.value = await api.listPeriods({ semesterId: id })
      await loadCourses()
      await loadCalendar()
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
    assertWritable()
    const created = await api.createSemester({ classId: classIdOrThrow(), ...payload })
    semesters.value.push(created)
    currentSemesterId.value = created.id
    await setSemester(created.id)
    return created
  }

  /** 删除学期（级联清理该学期全部数据；删除当前学期后自动切换） */
  async function deleteSemester(id: number): Promise<void> {
    assertWritable()
    await api.deleteSemester(id)
    semesters.value = semesters.value.filter((s) => s.id !== id)
    if (currentSemesterId.value === id) {
      const next = semesters.value.length ? semesters.value[0] : null
      currentSemesterId.value = next?.id ?? null
      if (next) periods.value = await api.listPeriods({ semesterId: next.id })
      else periods.value = []
    }
    // 无论是否删的是当前学期，都要重拉课程与周数据（修复残留旧课程）
    await loadCourses()
    await loadCalendar()
    await refreshSchedule()
    await refreshToday()
    await loadMatters()
  }

  async function addPeriod(payload: { startTime: string; endTime: string }): Promise<void> {
    assertWritable()
    if (!currentSemesterId.value) throw new Error('未设置当前学期')
    const created = await api.createPeriod({ semesterId: currentSemesterId.value, ...payload })
    periods.value.push(created)
  }

  async function updatePeriod(id: number, payload: { startTime: string; endTime: string }): Promise<void> {
    assertWritable()
    const updated = await api.updatePeriod(id, payload)
    const idx = periods.value.findIndex((p) => p.id === id)
    if (idx >= 0) periods.value[idx] = updated
    await refreshSchedule()
  }

  /** 删除节次行（剩余行自动重排；被删节次上的课程时间一并移除，后续节次前移） */
  async function deletePeriod(id: number): Promise<{ removedPeriod: number; affectedCourses: number }> {
    assertWritable()
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
    assertWritable()
    const updated = await api.updateSemester(id, patch)
    const idx = semesters.value.findIndex((s) => s.id === id)
    if (idx >= 0) semesters.value[idx] = updated
    if (id === currentSemesterId.value) await refreshSchedule()
  }

  /** 新增课程（含实验课与无固定时间课程） */
  async function addCourse(payload: CourseWritePayload): Promise<Course> {
    assertWritable()
    const semesterId = currentSemesterId.value
    if (semesterId === null) throw new Error('未设置当前学期，请先创建学期')
    const { color } = pickCourseColor(courses.value, payload.name, courses.value.length)
    const created = await api.createCourse({
      classId: classIdOrThrow(),
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
    assertWritable()
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
    await loadCalendar()
    await refreshSchedule()
    await refreshToday()
    return { count: res.count, removed: res.removed ?? 0, keptLabs: res.keptLabs ?? 0 }
  }

  /** 更新课程（整组原子替换：元数据 + 全部上课时间） */
  async function updateCourse(id: number, payload: CourseWritePayload): Promise<Course> {
    assertWritable()
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

  /** 删除课程（关联考试/作业的 courseId 由服务端置空保留；其单课调整级联清理） */
  async function deleteCourse(id: number): Promise<void> {
    assertWritable()
    if (remote.value) {
      await api.deleteCourse(id)
      await loadMatters()
    }
    courses.value = courses.value.filter((c) => c.id !== id)
    adjustments.value = adjustments.value.filter((a) => a.courseId !== id)
    await refreshSchedule()
    await refreshToday()
  }

  // ---- 学期日历（放假 / 调休按周几上课）----

  /** 区间设置日历规则（kind='clear' 清除；kind='shift' 时 from→to 为整日移课）；服务端返回整表，直接替换 */
  async function setCalendarRange(payload: {
    from: string
    to: string
    kind: 'holiday' | 'shift' | 'clear'
    note?: string
  }): Promise<void> {
    assertWritable()
    if (!currentSemesterId.value) throw new Error('未设置当前学期')
    dayRules.value = await api.setCalendarRange({ semesterId: currentSemesterId.value, ...payload })
  }

  // ---- 单课调整（停课 / 调课 / 补课）----

  async function addAdjustment(payload: AdjustmentPayload): Promise<CourseAdjustment> {
    assertWritable()
    const created = await api.createAdjustment(payload)
    adjustments.value = [...adjustments.value, created]
    return created
  }

  async function updateAdjustment(id: number, payload: Omit<AdjustmentPayload, 'courseId'>): Promise<CourseAdjustment> {
    assertWritable()
    const updated = await api.updateAdjustment(id, payload)
    const idx = adjustments.value.findIndex((a) => a.id === id)
    if (idx >= 0) adjustments.value[idx] = updated
    else adjustments.value = [...adjustments.value, updated]
    return updated
  }

  /** 撤销调整（单条，或按「课程 + 原日期」整日撤销——拖拽改回原位置时用） */
  async function deleteAdjustment(id: number): Promise<void> {
    assertWritable()
    await api.deleteAdjustment(id)
    adjustments.value = adjustments.value.filter((a) => a.id !== id)
  }

  // ---- 考试 ----
  async function addExam(payload: { courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }): Promise<Exam> {
    assertWritable()
    const created = await api.createExam({ classId: classIdOrThrow(), semesterId: currentSemesterId.value ?? undefined, ...payload })
    exams.value.push(created)
    await refreshSchedule()
    return created
  }

  async function updateExam(id: number, payload: { courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }): Promise<Exam> {
    assertWritable()
    const updated = await api.updateExam(id, payload)
    const idx = exams.value.findIndex((e) => e.id === id)
    if (idx >= 0) exams.value[idx] = updated
    await refreshSchedule()
    return updated
  }

  async function deleteExam(id: number): Promise<void> {
    assertWritable()
    await api.deleteExam(id)
    exams.value = exams.value.filter((e) => e.id !== id)
    await refreshSchedule()
  }

  // ---- 作业 ----
  async function addHomework(payload: { courseId?: number | null; name: string; dueAt: string; remark?: string }): Promise<Homework> {
    assertWritable()
    const created = await api.createHomework({ classId: classIdOrThrow(), semesterId: currentSemesterId.value ?? undefined, ...payload })
    homework.value.push(created)
    await refreshSchedule()
    return created
  }

  async function updateHomework(id: number, payload: { courseId?: number | null; name: string; dueAt: string; remark?: string }): Promise<Homework> {
    assertWritable()
    const updated = await api.updateHomework(id, payload)
    const idx = homework.value.findIndex((h) => h.id === id)
    if (idx >= 0) homework.value[idx] = updated
    await refreshSchedule()
    return updated
  }

  async function deleteHomework(id: number): Promise<void> {
    assertWritable()
    await api.deleteHomework(id)
    homework.value = homework.value.filter((h) => h.id !== id)
    await refreshSchedule()
  }

  // ---- 作业 / 考试的图片与附件（图片在详情弹窗内联显示，其余下载）----

  /** 上传一个文件到某条作业 / 考试；成功后把元数据接进对应条目 */
  async function uploadAttachment(kind: 'exam' | 'homework', matterId: number, file: File): Promise<Attachment> {
    assertWritable()
    const form = new FormData()
    form.append(kind === 'exam' ? 'examId' : 'homeworkId', String(matterId))
    form.append('file', file)
    const att = await api.uploadAttachment(form)
    const list = kind === 'exam' ? exams.value : homework.value
    const matter = list.find((m) => m.id === matterId)
    if (matter) matter.attachments = [...matter.attachments, att]
    return att
  }

  /** 删除一个附件（两张列表里一起摘掉，调用方不用管它挂在哪） */
  async function deleteAttachment(id: number): Promise<void> {
    assertWritable()
    await api.deleteAttachment(id)
    for (const m of exams.value) m.attachments = m.attachments.filter((a) => a.id !== id)
    for (const m of homework.value) m.attachments = m.attachments.filter((a) => a.id !== id)
  }

  // ---- 班级通知（负责人手写；置顶优先、按日期倒序，一条都不隐藏）----

  /** 与服务端同一排序：置顶优先 → 日期倒序 → id 倒序 */
  function sortNotices(list: Notice[]): Notice[] {
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return b.id - a.id
    })
  }

  async function loadNotices(): Promise<void> {
    const id = currentClassId.value
    if (!remote.value || id === null) return
    try {
      const list = readonly.value ? await api.listPublicNotices(id) : await api.listNotices({ classId: id })
      notices.value = sortNotices(list)
    } catch {
      // 拉取失败保留旧数据
    }
  }

  async function addNotice(payload: {
    date: string
    title: string
    body?: string
    courseId?: number | null
    pinned?: boolean
  }): Promise<Notice> {
    assertWritable()
    const created = await api.createNotice({ classId: classIdOrThrow(), ...payload })
    notices.value = sortNotices([...notices.value, created])
    return created
  }

  async function updateNotice(
    id: number,
    payload: { date: string; title: string; body?: string; courseId?: number | null; pinned?: boolean },
  ): Promise<Notice> {
    assertWritable()
    const updated = await api.updateNotice(id, { classId: classIdOrThrow(), ...payload })
    notices.value = sortNotices(notices.value.map((n) => (n.id === id ? updated : n)))
    return updated
  }

  async function deleteNotice(id: number): Promise<void> {
    assertWritable()
    await api.deleteNotice(id)
    notices.value = notices.value.filter((n) => n.id !== id)
  }

  // ---- 设置 ----
  async function updateSettings(patch: Partial<SettingsPayload>): Promise<void> {
    assertWritable()
    const updated = await api.updateSettings(patch)
    settings.value = updated
    showOddEvenFilter.value = updated.showOddEvenFilter
    if (patch.showOddEvenFilter !== undefined) await refreshSchedule()
    if (patch.weather !== undefined) await refreshWeather()
  }

  async function setShowOddEvenFilter(v: boolean): Promise<void> {
    showOddEvenFilter.value = v
    if (readonly.value) return
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

  // 启动时自动尝试连接后端；路由守卫用 ensureReady() 等它完成
  let bootstrapPromise: Promise<void> | null = null
  function ensureReady(): Promise<void> {
    if (!bootstrapPromise) bootstrapPromise = bootstrap()
    return bootstrapPromise
  }
  bootstrapPromise = bootstrap()

  return {
    bootstrap,
    ensureReady,
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
    authenticated,
    classes,
    currentClass,
    currentClassId,
    readonly,
    publicClass,
    selectClass,
    loadClassData,
    loadPublicClass,
    selectPublicSemester,
    clearPublicMode,
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
    resolveCtx,
    resolvedWeek,
    resolvedDay,
    coursesOfDate,
    todayWeekNumber,
    todayCourseBlocks,
    todayResolved,
    dayRules,
    adjustments,
    rulesByDate,
    loadCalendar,
    setCalendarRange,
    addAdjustment,
    updateAdjustment,
    deleteAdjustment,
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
    deleteHomework,
    uploadAttachment,
    deleteAttachment,
    loadMatters,
    loadNotices,
    notices,
    addNotice,
    updateNotice,
    deleteNotice,
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


