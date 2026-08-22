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
  /** 访问口令已开启时返回 true（前端需跳口令页） */
  accessRequired?: boolean
}

export interface ScheduleWeek {
  weekNumber: number | null
  isOddWeek: boolean
  isHoliday: boolean
  startDate: string | null
  endDate: string | null
  semester: Semester | null
}

export interface ScheduleResponse {
  week: ScheduleWeek
  courses: Course[]
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

/** 课程创建/更新请求体（id 由服务端决定；semesterId 缺省为当前学期） */
export interface CoursePayload {
  semesterId?: number
  type: 'course' | 'lab'
  name: string
  teacher: string
  location: string
  color: string
  weekType: 'all' | 'odd' | 'even' | 'custom'
  weekList: number[] | null
  weekday: number
  startPeriod: number
  endPeriod: number
  remark?: string
}

export const api = {
  getContext: () => request<ContextResponse>('/context'),

  getSchedule: (date?: string) =>
    request<ScheduleResponse>(`/schedule${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  // ---- 学期 ----
  listSemesters: () => request<Semester[]>('/semesters'),

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
    request<void>(`/periods/${id}`, { method: 'DELETE' }),

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
  importConfirm: (body: { mode: 'append' | 'overwrite'; semesterId: number; rows: ImportRow[] }) =>
    request<{ count: number }>('/import/confirm', { method: 'POST', body: JSON.stringify(body) }),

  // ---- 设置 ----
  getSettings: () => request<SettingsPayload>('/settings'),

  updateSettings: (patch: Partial<SettingsPayload>) =>
    request<SettingsPayload>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  // ---- 天气 ----
  getWeather: () => request<WeatherData>('/weather'),

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

  restoreBackup: async (file: File): Promise<{ restored: Record<string, number> }> => {
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

  // ---- 访问口令 ----
  verifyAccess: (passphrase: string) =>
    request<{ ok: true }>('/access/verify', { method: 'POST', body: JSON.stringify({ passphrase }) }),

  logoutAccess: () => request<void>('/access/logout', { method: 'POST' }),

  enableAccess: (passphrase: string) =>
    request<{ ok: true }>('/access/enable', { method: 'POST', body: JSON.stringify({ passphrase }) }),

  disableAccess: (passphrase: string) =>
    request<{ ok: true }>('/access/disable', { method: 'POST', body: JSON.stringify({ passphrase }) }),
}
