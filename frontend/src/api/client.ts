// ============================================================
// ClassBoard · REST API 客户端（与 server 契约一一对应）
// ============================================================
import type { Course, Exam, Homework, Period, Semester } from '@/types'
import type { ImportRow } from '@/utils/pdf'

const BASE = '/api'

export interface SettingsPayload {
  showOddEvenFilter: boolean
  reminder: { enabled: boolean; mode: 'every' | 'first'; advanceMinutes: number }
  labReminder: { enabled: boolean; mode: 'every' | 'first'; advanceMinutes: number }
  homeworkReminder: { enabled: boolean; advanceDays: number }
  accessEnabled: boolean
  weather: WeatherSettings
}

/** 天气设置（和风天气） */
export interface WeatherSettings {
  enabled: boolean
  apiKey: string
  location: string
}

/** 天气聚合数据（/api/weather 返回） */
export interface WeatherData {
  city: string
  now: { text: string; temp: string; feelsLike: string; humidity: string; precip: string; windDir: string; windScale: string; obsTime: string }
  daily: { fxDate: string; textDay: string; iconDay: string; tempMax: string; tempMin: string }[]
  air: { aqi: string; category: string } | null
  warning: { id: string; title: string; text: string; severity: string }[]
  /** 日出日落（Open-Meteo，免费接口） */
  sun: { sunrise: string; sunset: string } | null
  updatedAt: string
}

export interface ContextResponse {
  semesters: Semester[]
  currentSemesterId: number | null
  periods: Period[]
  settings: SettingsPayload
  /** 未登录时返回 true（前端需跳登录页） */
  accessRequired?: boolean
  /** 当前登录用户（已登录时返回） */
  user?: UserInfo
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
    try {
      const body = await res.json()
      if (body?.message) message = body.message
      if (body?.details?.length) message = `${message}：${body.details[0].message}`
    } catch {
      // 忽略非 JSON 响应
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** 课程创建/更新请求体：元数据 + 上课时间组（节次/周次逐项数组） */
export interface CoursePayload {
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

export const api = {
  getContext: () => request<ContextResponse>('/context'),

  getSchedule: (date?: string) =>
    request<ScheduleResponse>(`/schedule${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  // ---- 学期 ----

  createSemester: (body: { name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 }) =>
    request<Semester>('/semesters', { method: 'POST', body: JSON.stringify(body) }),

  updateSemester: (id: number, body: { name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 }) =>
    request<Semester>(`/semesters/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteSemester: (id: number) =>
    request<void>(`/semesters/${id}`, { method: 'DELETE' }),

  setCurrentSemester: (id: number) =>
    request<{ currentSemesterId: number }>('/semesters/current', { method: 'PUT', body: JSON.stringify({ id }) }),

  // ---- 节次模板 ----
  createPeriod: (body: { semesterId: number; startTime: string; endTime: string }) =>
    request<Period>('/periods', { method: 'POST', body: JSON.stringify(body) }),

  updatePeriod: (id: number, body: { startTime: string; endTime: string }) =>
    request<Period>(`/periods/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deletePeriod: (id: number) =>
    request<{ removedPeriod: number; affectedCourses: number }>(`/periods/${id}`, { method: 'DELETE' }),

  // ---- 课程 ----
  listCourses: (semesterId?: number) =>
    request<Course[]>(`/courses${semesterId ? `?semesterId=${semesterId}` : ''}`),

  createCourse: (body: CoursePayload) =>
    request<Course>('/courses', { method: 'POST', body: JSON.stringify(body) }),

  updateCourse: (id: number, body: CoursePayload) =>
    request<Course>(`/courses/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteCourse: (id: number) =>
    request<void>(`/courses/${id}`, { method: 'DELETE' }),

  // ---- 考试 ----
  listExams: (semesterId?: number) =>
    request<Exam[]>(`/exams${semesterId ? `?semesterId=${semesterId}` : ''}`),

  createExam: (body: { semesterId?: number; courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }) =>
    request<Exam>('/exams', { method: 'POST', body: JSON.stringify(body) }),

  updateExam: (id: number, body: { courseId?: number | null; name: string; datetime: string; location?: string; remark?: string }) =>
    request<Exam>(`/exams/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteExam: (id: number) =>
    request<void>(`/exams/${id}`, { method: 'DELETE' }),

  // ---- 作业 ----
  listHomework: (semesterId?: number, status?: 'open' | 'done') =>
    request<Homework[]>(
      `/homework${semesterId || status ? `?${semesterId ? `semesterId=${semesterId}` : ''}${semesterId && status ? '&' : ''}${status ? `status=${status}` : ''}` : ''}`,
    ),

  createHomework: (body: { semesterId?: number; courseId?: number | null; name: string; dueAt: string; done?: boolean; remark?: string }) =>
    request<Homework>('/homework', { method: 'POST', body: JSON.stringify(body) }),

  updateHomework: (id: number, body: { courseId?: number | null; name: string; dueAt: string; done?: boolean; remark?: string }) =>
    request<Homework>(`/homework/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  setHomeworkDone: (id: number, done: boolean) =>
    request<{ id: number; done: boolean }>(`/homework/${id}/done`, { method: 'PATCH', body: JSON.stringify({ done }) }),

  deleteHomework: (id: number) =>
    request<void>(`/homework/${id}`, { method: 'DELETE' }),

  // ---- 导入 ----
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

  // ---- 备份 ----
  exportBackup: async (): Promise<void> => {
    const res = await fetch(BASE + '/backup')
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

  restoreBackup: async (file: File): Promise<{ restored: Record<string, unknown> }> => {
    const form = new FormData()
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

  // ---- 多用户认证 ----
  login: (username: string, password: string, remember: boolean) =>
    request<{ ok: true; user: UserInfo }>('/access/login', { method: 'POST', body: JSON.stringify({ username, password, remember }) }),

  register: (username: string, password: string) =>
    request<{ ok: true; user: UserInfo }>('/access/register', { method: 'POST', body: JSON.stringify({ username, password }) }),

  logout: () => request<void>('/access/logout', { method: 'POST' }),


  getSignupEnabled: () => request<{ enabled: boolean }>('/access/signup-enabled'),

  listSessions: () => request<{ sessions: SessionInfo[] }>('/access/sessions'),

  revokeSession: (id: number) => request<void>(`/access/sessions/${id}`, { method: 'DELETE' }),

  // ---- 用户管理（admin） ----
  listUsers: () => request<{ users: UserInfo[] }>('/users'),

  createUser: (body: { username: string; password: string; role: 'admin' | 'user' }) =>
    request<{ user: UserInfo }>('/users', { method: 'POST', body: JSON.stringify(body) }),

  updateUser: (id: number, body: { role?: 'admin' | 'user'; disabled?: boolean }) =>
    request<{ user: UserInfo }>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  resetUserPassword: (id: number, password: string) =>
    request<{ ok: true }>(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),

  deleteUser: (id: number, transferTo?: number | null) =>
    request<void>(`/users/${id}`, { method: 'DELETE', body: JSON.stringify({ transferTo: transferTo ?? null }) }),

  setSignupEnabled: (enabled: boolean) =>
    request<{ enabled: boolean }>('/users/signup', { method: 'PUT', body: JSON.stringify({ enabled }) }),

  // ---- 课程模板 ----
  listTemplates: () => request<{ templates: TemplateInfo[] }>('/templates'),


  createTemplate: (body: { kind: 'course' | 'unit' | 'semester'; name: string; category: string; description: string; content: ImportRow[] | number[] | SemesterTemplateContent }) =>
    request<{ template: TemplateInfo }>('/templates', { method: 'POST', body: JSON.stringify(body) }),

  updateTemplate: (id: number, body: { kind?: 'course' | 'unit' | 'semester'; name: string; category: string; description: string; content: ImportRow[] | number[] | SemesterTemplateContent }) =>
    request<{ template: TemplateInfo }>(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteTemplate: (id: number) => request<void>(`/templates/${id}`, { method: 'DELETE' }),

  importTemplate: (id: number, body: { semesterId: number; mode: 'append' | 'overwrite' | 'dedupe' }) =>
    request<{ count: number; skipped: number; templateCount: number; removed?: number; semesterId?: number; semesterName?: string }>(`/templates/${id}/import`, { method: 'POST', body: JSON.stringify(body) }),

  importTemplateBatch: (body: { semesterId: number; mode: 'append' | 'overwrite' | 'dedupe'; templateIds: number[] }) =>
    request<{ count: number; skipped: number; templateCount: number; removed?: number }>('/templates/import-batch', { method: 'POST', body: JSON.stringify(body) }),
}

/** 模板课程行：新结构（元数据 + sessions）；旧格式字段仅为读取兼容 */
export interface TemplateRow {
  type: 'course' | 'lab'
  name: string
  teacher: string
  location: string
  color?: string
  remark?: string
  sessions?: {
    weekday: number
    location: string
    periods: number[]
    weeks: number[]
  }[]
  /** 旧格式（weekType/weekList/weekday/startPeriod/endPeriod）——服务端读取时自动升级 */
  weekType?: 'all' | 'odd' | 'even' | 'custom'
  weekList?: number[] | null
  weekday?: number
  startPeriod?: number
  endPeriod?: number
}

/** 学期模板内容：学期信息 + 节次时间模板 */
export interface SemesterTemplateContent {
  name: string
  startDate: string
  endDate: string
  weekStartDay: 1 | 7
  periods: { startTime: string; endTime: string }[]
}

export interface TemplateInfo {
  id: number
  kind: 'course' | 'unit' | 'semester'
  name: string
  category: string
  description: string
  version: number
  content: ImportRow[] | number[] | SemesterTemplateContent
  createdBy: number
  createdAt: string
  updatedAt: string
  importCount?: number
  lastImportedAt?: string | null
}

export interface UserInfo {
  id: number
  username: string
  role: 'admin' | 'user'
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
