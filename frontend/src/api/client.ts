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
}

export interface ContextResponse {
  semesters: Semester[]
  currentSemesterId: number | null
  periods: Period[]
  settings: SettingsPayload
  /** 访问口令已开启时返回 true（前端需跳口令页，当前里程碑仅标记） */
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

export const api = {
  getContext: () => request<ContextResponse>('/context'),

  getSchedule: (date?: string) =>
    request<ScheduleResponse>(`/schedule${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  listSemesters: () => request<Semester[]>('/semesters'),

  createSemester: (body: { name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 }) =>
    request<Semester>('/semesters', { method: 'POST', body: JSON.stringify(body) }),

  updateSemester: (id: number, body: { name: string; startDate: string; endDate: string; weekStartDay: 1 | 7 }) =>
    request<Semester>(`/semesters/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  setCurrentSemester: (id: number) =>
    request<{ currentSemesterId: number }>('/semesters/current', { method: 'PUT', body: JSON.stringify({ id }) }),

  createCourse: (body: Partial<Course> & { name: string }) =>
    request<Course>('/courses', { method: 'POST', body: JSON.stringify(body) }),

  importConfirm: (body: { mode: 'append' | 'overwrite'; semesterId: number; rows: ImportRow[] }) =>
    request<{ count: number }>('/import/confirm', { method: 'POST', body: JSON.stringify(body) }),

  getSettings: () => request<SettingsPayload>('/settings'),

  updateSettings: (patch: Partial<SettingsPayload>) =>
    request<SettingsPayload>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
}
