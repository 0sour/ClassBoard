// ============================================================
// ClassBoard · REST API 客户端（与 server 契约一一对应）
// 归属：班级 → 多个学期 → 课表；公开面（/public/*）无需登录且只读
// ============================================================
import type {
  ChangeList,
  Course,
  CourseAdjustment,
  DayRule,
  Exam,
  Homework,
  Notice,
  Period,
  Semester,
} from '@/types'
import type { ImportRow } from '@/utils/pdf'

const BASE = '/api'

export interface SettingsPayload {
  showOddEvenFilter: boolean
  weather: WeatherSettings
}

/** 天气设置（和风天气；密钥只存服务端，非管理员读到脱敏值） */
export interface WeatherSettings {
  enabled: boolean
  apiKey: string
  location: string
}

/** 天气聚合数据（/api/weather 或公开班级天气返回） */
export interface WeatherData {
  enabled?: boolean
  reason?: string
  city: string
  now: { text: string; temp: string; feelsLike: string; humidity: string; precip: string; windDir: string; windScale: string; obsTime: string }
  daily: { fxDate: string; textDay: string; iconDay: string; tempMax: string; tempMin: string }[]
  air: { aqi: string; category: string } | null
  warning: { id: string; title: string; text: string; severity: string }[]
  /** 日出日落（Open-Meteo，免费接口） */
  sun: { sunrise: string; sunset: string } | null
  updatedAt: string
}

/** 班级（负责人侧） */
export interface ClassInfo {
  id: number
  school: string
  name: string
  major: string
  city: string
  currentSemesterId: number | null
  createdAt: string
  updatedAt: string
  semesterCount: number
  memberCount: number
}

export interface ClassMemberInfo {
  id: number
  username: string
  role: 'admin' | 'leader'
  joinedAt: string
}

/** 公开班级列表项 */
export interface PublicClassBrief {
  id: number
  school: string
  name: string
  major: string
  semesterCount: number
  updatedAt: string
}

export interface ContextResponse {
  /** 是否已登录 */
  authenticated: boolean
  user?: UserInfo
  /** 已登录时：该账号名下的班级（班级 → 多个学期 → 课表） */
  classes?: ClassInfo[]
  settings?: SettingsPayload
}

export interface ScheduleWeek {
  weekNumber: number | null
  isOddWeek: boolean
  isHoliday: boolean
  /** 未开学（早于学期起始日）：weekNumber 为 null 但语义区别于假期 */
  isBeforeSemester?: boolean
  startDate: string | null
  endDate: string | null
  semester: Semester | null
}

/** 周聚合返回的课程块（服务端已按周过滤；同一课程多个上课时间=多块） */
export interface ScheduleCourseBlock {
  id: number
  sessionId: number
  semesterId: number
  type: 'course' | 'lab'
  name: string
  teacher: string
  location: string
  color: string
  remark: string
  weekday: number
  /** 该周实际出现的节次（逐项） */
  periods: number[]
  /** 完整节次集合（不限周次）：定位与冲突检测用 */
  allPeriods: number[]
  startPeriod: number
  endPeriod: number
  runs: [number, number][]
  startTime: string | null
  endTime: string | null
}

export interface ScheduleResponse {
  week: ScheduleWeek
  courses: ScheduleCourseBlock[]
  exams: Exam[]
  homework: Homework[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    let code = ''
    let payload: unknown = null
    try {
      const body = await res.json()
      payload = body
      if (body?.message) message = body.message
      if (body?.code) code = body.code
      if (body?.details?.length) message = `${message}：${body.details[0].message}`
    } catch {
      // 忽略非 JSON 响应
    }
    const err = new Error(message) as Error & { code?: string; status?: number; payload?: unknown }
    err.code = code
    err.status = res.status
    err.payload = payload
    throw err
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** 课程创建/更新请求体：元数据 + 上课时间组（节次/周次逐项数组） */
export interface CoursePayload {
  classId?: number
  semesterId?: number
  type: 'course' | 'lab'
  name: string
  teacher: string
  location: string
  color: string
  remark?: string
  /** 空数组 = 无固定时间课程 */
  sessions: {
    weekday: number
    location: string
    periods: number[]
    weeks: number[]
  }[]
}

/** 单课调整请求体（节次为逐项数组） */
export interface AdjustmentPayload {
  courseId: number
  date: string
  kind: 'cancel' | 'move' | 'extra'
  /** cancel/move：定位原时间组 */
  fromWeekday?: number | null
  fromPeriods?: number[]
  /** move：目标日期 */
  toDate?: string | null
  /** move/extra：目标节次 */
  periods?: number[]
  location?: string
  note?: string
}

function query(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

export const api = {
  getContext: () => request<ContextResponse>('/context'),

  getSchedule: (opts: { classId: number; semesterId?: number; date?: string }) =>
    request<ScheduleResponse>(`/schedule${query({ classId: opts.classId, semesterId: opts.semesterId, date: opts.date })}`),

  // ---- 班级（负责人侧）----
  listClasses: () => request<ClassInfo[]>('/classes'),

  /** 按「学校 + 班级名」查已有班级（建班前确认是否同名加入） */
  lookupClass: (school: string, name: string) =>
    request<{ found: boolean; class?: ClassInfo }>(`/classes/lookup${query({ school, name })}`),

  getClass: (id: number) => request<ClassInfo & { members: ClassMemberInfo[] }>(`/classes/${id}`),

  createClass: (body: { school: string; name: string; major?: string; city?: string }) =>
    request<ClassInfo>('/classes', { method: 'POST', body: JSON.stringify(body) }),

  joinClass: (id: number) =>
    request<ClassInfo & { members: ClassMemberInfo[] }>(`/classes/${id}/join`, { method: 'POST' }),

  updateClass: (id: number, body: { school?: string; name?: string; major?: string; city?: string }) =>
    request<ClassInfo & { members: ClassMemberInfo[] }>(`/classes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  leaveClass: (id: number) => request<{ deleted: boolean }>(`/classes/${id}/members/me`, { method: 'DELETE' }),

  deleteClass: (id: number) => request<{ deleted: boolean }>(`/classes/${id}`, { method: 'DELETE' }),

  // ---- 学期 ----
  listSemesters: (classId: number) => request<Semester[]>(`/semesters${query({ classId })}`),

  createSemester: (body: { classId: number; name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 }) =>
    request<Semester>('/semesters', { method: 'POST', body: JSON.stringify(body) }),

  updateSemester: (id: number, body: { name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 }) =>
    request<Semester>(`/semesters/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteSemester: (id: number) => request<void>(`/semesters/${id}`, { method: 'DELETE' }),

  setCurrentSemester: (id: number) =>
    request<{ currentSemesterId: number }>('/semesters/current', { method: 'PUT', body: JSON.stringify({ id }) }),

  // ---- 节次模板 ----
  listPeriods: (opts: { classId?: number; semesterId?: number }) =>
    request<Period[]>(`/periods${query({ classId: opts.classId, semesterId: opts.semesterId })}`),

  createPeriod: (body: { semesterId: number; startTime: string; endTime: string }) =>
    request<Period>('/periods', { method: 'POST', body: JSON.stringify(body) }),

  updatePeriod: (id: number, body: { startTime: string; endTime: string }) =>
    request<Period>(`/periods/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deletePeriod: (id: number) =>
    request<{ removedPeriod: number; affectedCourses: number }>(`/periods/${id}`, { method: 'DELETE' }),

  // ---- 课程 ----
  listCourses: (opts: { classId?: number; semesterId?: number; type?: 'course' | 'lab' } = {}) =>
    request<Course[]>(`/courses${query({ classId: opts.classId, semesterId: opts.semesterId, type: opts.type })}`),

  createCourse: (body: CoursePayload) =>
    request<Course>('/courses', { method: 'POST', body: JSON.stringify(body) }),

  updateCourse: (id: number, body: CoursePayload) =>
    request<Course>(`/courses/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteCourse: (id: number) => request<void>(`/courses/${id}`, { method: 'DELETE' }),

  // ---- 学期日历（放假 / 整日移课）----
  listDayRules: (opts: { classId?: number; semesterId?: number }) =>
    request<DayRule[]>(`/calendar${query({ classId: opts.classId, semesterId: opts.semesterId })}`),

  /** 区间/整日移课设置日历规则：kind='clear' 清除该区间；返回该学期全部规则 */
  setCalendarRange: (body: { semesterId: number; from: string; to: string; kind: 'holiday' | 'shift' | 'clear'; note?: string }) =>
    request<DayRule[]>('/calendar', { method: 'PUT', body: JSON.stringify(body) }),

  // ---- 单课调整（停课 / 调课 / 补课）----
  listAdjustments: (opts: { classId?: number; semesterId?: number }) =>
    request<CourseAdjustment[]>(`/adjustments${query({ classId: opts.classId, semesterId: opts.semesterId })}`),

  createAdjustment: (body: AdjustmentPayload) =>
    request<CourseAdjustment>('/adjustments', { method: 'POST', body: JSON.stringify(body) }),

  updateAdjustment: (id: number, body: Omit<AdjustmentPayload, 'courseId'>) =>
    request<CourseAdjustment>(`/adjustments/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteAdjustment: (id: number) => request<void>(`/adjustments/${id}`, { method: 'DELETE' }),

  // ---- 考试 ----
  listExams: (opts: { classId?: number; semesterId?: number } = {}) =>
    request<Exam[]>(`/exams${query({ classId: opts.classId, semesterId: opts.semesterId })}`),

  createExam: (body: { classId?: number; semesterId?: number; courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }) =>
    request<Exam>('/exams', { method: 'POST', body: JSON.stringify(body) }),

  updateExam: (id: number, body: { courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }) =>
    request<Exam>(`/exams/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteExam: (id: number) => request<void>(`/exams/${id}`, { method: 'DELETE' }),

  // ---- 作业（班级公示：无个人完成态）----
  listHomework: (opts: { classId?: number; semesterId?: number; scope?: 'upcoming' | 'all' } = {}) =>
    request<Homework[]>(`/homework${query({ classId: opts.classId, semesterId: opts.semesterId, scope: opts.scope })}`),

  createHomework: (body: { classId?: number; semesterId?: number; courseId?: number | null; name: string; dueAt: string; remark?: string }) =>
    request<Homework>('/homework', { method: 'POST', body: JSON.stringify(body) }),

  updateHomework: (id: number, body: { courseId?: number | null; name: string; dueAt: string; remark?: string }) =>
    request<Homework>(`/homework/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteHomework: (id: number) => request<void>(`/homework/${id}`, { method: 'DELETE' }),

  // ---- 班级通知（负责人手写；学生端在公开接口读同一份）----
  listNotices: (opts: { classId: number }) => request<Notice[]>(`/notices${query({ classId: opts.classId })}`),

  createNotice: (body: { classId: number; date: string; title: string; body?: string; courseId?: number | null; pinned?: boolean }) =>
    request<Notice>('/notices', { method: 'POST', body: JSON.stringify(body) }),

  updateNotice: (id: number, body: { classId: number; date: string; title: string; body?: string; courseId?: number | null; pinned?: boolean }) =>
    request<Notice>(`/notices/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteNotice: (id: number) => request<void>(`/notices/${id}`, { method: 'DELETE' }),

  // ---- 导入（PDF 课表）----
  importConfirm: (body: { mode: 'append' | 'overwrite'; semesterId: number; rows: ImportRow[]; keepLabs?: boolean }) =>
    request<{ count: number; removed?: number; keptLabs?: number; snapshot?: string }>('/import/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ---- 设置 ----
  updateSettings: (patch: Partial<SettingsPayload>) =>
    request<SettingsPayload>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  // ---- 天气 ----
  getWeather: () => request<WeatherData>('/weather'),

  /** 城市搜索（设置页下拉）：返回 [{ name, adm1, adm2, id }] */
  searchCities: (q: string) => request<{ name: string; adm1: string; adm2: string; id: string }[]>(`/weather/cities?q=${encodeURIComponent(q)}`),

  // ---- 备份 / 导入导出 ----
  /** 导出：scope='account' 我名下全部班级；'site' 整站（仅管理员，含账号与口令哈希） */
  exportBackup: async (scope: 'account' | 'site' = 'account'): Promise<void> => {
    const res = await fetch(BASE + (scope === 'site' ? '/backup/site' : '/backup'))
    if (!res.ok) {
      let message = `导出失败（${res.status}）`
      try {
        const body = await res.json()
        if (body?.message) message = body.message
      } catch {
        // 忽略
      }
      throw new Error(message)
    }
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const match = disposition.match(/filename="?([^";]+)"?/)
    const filename = match?.[1] ?? `classboard-backup-${new Date().toISOString().slice(0, 10)}.json`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  /**
   * 恢复备份：
   *   - 覆盖模式：传 classId（该班数据被清空后按备份重建）
   *   - 新建班模式：不传 classId，用 school + name 给新班起名（多班备份各自沿用备份里的名字）
   */
  restoreBackup: async (
    file: File,
    opts: { classId?: number | null; school?: string; name?: string } = {},
  ): Promise<{ restored: Record<string, unknown> }> => {
    const form = new FormData()
    if (opts.classId) form.append('classId', String(opts.classId))
    if (opts.school) form.append('school', opts.school)
    if (opts.name) form.append('name', opts.name)
    form.append('file', file)
    const res = await fetch(BASE + '/backup/restore', { method: 'POST', body: form })
    if (!res.ok) {
      let message = `恢复失败（${res.status}）`
      try {
        const body = await res.json()
        if (body?.message) message = body.message
      } catch {
        // 忽略
      }
      throw new Error(message)
    }
    return res.json()
  },

  // ---- 认证 ----
  login: (username: string, password: string, remember: boolean) =>
    request<{ ok: true; user: UserInfo }>('/access/login', { method: 'POST', body: JSON.stringify({ username, password, remember }) }),

  /** 注册班级负责人：提交学校 / 专业 / 班级名，等待管理员审核 */
  register: (body: { username: string; password: string; school: string; major?: string; className: string }) =>
    request<{ ok: true; user: UserInfo }>('/access/register', { method: 'POST', body: JSON.stringify(body) }),

  logout: () => request<void>('/access/logout', { method: 'POST' }),

  getSignupEnabled: () => request<{ enabled: boolean }>('/access/signup-enabled'),

  listSessions: () => request<{ sessions: SessionInfo[] }>('/access/sessions'),

  revokeSession: (id: number) => request<void>(`/access/sessions/${id}`, { method: 'DELETE' }),

  // ---- 变更记录与回退 ----
  /** 班级变更记录（负责人）：可按实体 / 对象 id / 操作人筛选，before 为游标（加载更多） */
  listChanges: (
    classId: number,
    opts: { entity?: string; entityId?: number; actorId?: number; action?: string; before?: number; limit?: number } = {},
  ) => request<ChangeList>(`/classes/${classId}/changes${query({ ...opts })}`),

  /** 全站变更记录（admin）：platform=1 只看平台级（班级已删除等） */
  listAllChanges: (opts: { classId?: number; platform?: 1; actor?: string; entity?: string; before?: number; limit?: number } = {}) =>
    request<ChangeList>(`/changes${query({ ...opts })}`),

  /** 撤销一条记录（把该对象恢复成它的 before）；之后又被改过 → 409 CHANGE_CONFLICT */
  revertChange: (id: number) => request<{ ok: true; reverted: number }>(`/changes/${id}/revert`, { method: 'POST' }),

  /** 整班回退：回到某条记录的状态（before=true 表示回到它改之前） */
  rollbackClass: (classId: number, changeId: number, before = false) =>
    request<{ ok: true; rolledBackTo: number; discarded: number }>(`/classes/${classId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ changeId, before }),
    }),

  // ---- 注册审批（admin）----
  listApprovals: (status: 'pending' | 'all' = 'pending') => request<UserInfo[]>(`/approvals${query({ status })}`),

  approveUser: (id: number) => request<UserInfo>(`/approvals/${id}/approve`, { method: 'POST' }),

  rejectUser: (id: number, note: string) =>
    request<UserInfo>(`/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),

  // ---- 用户管理（admin）----
  listUsers: () => request<{ users: UserInfo[] }>('/users'),

  createUser: (body: { username: string; password: string; role: 'admin' | 'leader' }) =>
    request<{ user: UserInfo }>('/users', { method: 'POST', body: JSON.stringify(body) }),

  updateUser: (id: number, body: { role?: 'admin' | 'leader'; disabled?: boolean }) =>
    request<{ user: UserInfo }>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  resetUserPassword: (id: number, password: string) =>
    request<{ ok: true }>(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),

  deleteUser: (id: number) => request<void>(`/users/${id}`, { method: 'DELETE' }),

  setSignupEnabled: (enabled: boolean) =>
    request<{ enabled: boolean }>('/users/signup', { method: 'PUT', body: JSON.stringify({ enabled }) }),

  // ---- 公开面（无需登录，只读）----
  listPublicClasses: (q = '') => request<PublicClassBrief[]>(`/public/classes${query({ q })}`),

  getPublicClass: (id: number) =>
    request<{
      class: { id: number; school: string; name: string; major: string }
      semesters: Semester[]
      currentSemesterId: number | null
      periods: Period[]
    }>(`/public/classes/${id}`),

  /** 课表解析所需的全部数据（前端 resolveDay 的唯一输入） */
  getPublicTimetable: (id: number, semesterId?: number) =>
    request<{
      semester: Semester | null
      periods: Period[]
      courses: Course[]
      dayRules: DayRule[]
      adjustments: CourseAdjustment[]
    }>(`/public/classes/${id}/timetable${query({ semesterId })}`),

  getPublicWeather: (id: number) => request<WeatherData>(`/public/classes/${id}/weather`),

  /** 班级通知（无需登录；置顶优先、按日期倒序） */
  listPublicNotices: (id: number) => request<Notice[]>(`/public/classes/${id}/notices`),

  /** 作业公示（无需登录；一次取全，前端按 dueAt 分「待交 / 已截止」） */
  listPublicHomework: (id: number, semesterId?: number) =>
    request<Homework[]>(`/public/classes/${id}/homework${query({ semesterId })}`),

  /** 考试公示（无需登录；前端按 datetime 分「未考 / 已结束」） */
  listPublicExams: (id: number, semesterId?: number) =>
    request<Exam[]>(`/public/classes/${id}/exams${query({ semesterId })}`),
}

export interface UserInfo {
  id: number
  username: string
  role: 'admin' | 'leader'
  /** 注册审批状态：待审核 / 已通过 / 已拒绝 */
  status?: 'pending' | 'active' | 'rejected'
  school?: string
  major?: string
  claimedClass?: string
  reviewNote?: string
  disabled: boolean
  createdAt: string
  lastLoginAt: string | null
}

export interface SessionInfo {
  id: number
  type: 'access' | 'remember'
  deviceName: string
  ip: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string
}
