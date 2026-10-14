// ============================================================
// ClassBoard · 字段校验（前后端共享同一套约束，见技术文档 4.1.3）
// ============================================================
import { badRequest } from './errors.js'
import { MAX_PERIODS, MAX_WEEKS, normalizeInts } from './weekspan.js'

export const COURSE_TYPES = ['course', 'lab']
export const COLOR_NAMES = [
  'course-1', 'course-2', 'course-3', 'course-4',
  'course-5', 'course-6', 'course-7', 'course-8',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** 严格校验日期存在性（如 2026-02-30 非法） */
export function isValidDate(s) {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

export function isValidTime(s) {
  return TIME_RE.test(s)
}

export function isValidDatetime(s) {
  if (!DATETIME_RE.test(s)) return false
  const [date, time] = s.split('T')
  return isValidDate(date) && isValidTime(time)
}

function vType(v, t) {
  return typeof v === t
}

/**
 * 通用字段校验：对给定字段集合逐项校验，收集 details。
 * rules: { field: (value, body) => boolean | string }（string 表示错误信息）
 */
export function validateFields(body, rules) {
  const details = []
  for (const [field, check] of Object.entries(rules)) {
    const v = body[field]
    if (v === undefined || v === null) {
      details.push({ field, message: `缺少必填字段 ${field}` })
      continue
    }
    const r = check(v, body)
    if (r === false) details.push({ field, message: `字段 ${field} 取值无效` })
    else if (typeof r === 'string') details.push({ field, message: r })
  }
  if (details.length) throw badRequest('参数校验失败', details)
}

/** 学期校验规则 */
export function semesterRules() {
  return {
    name: (v) => (vType(v, 'string') && v.trim().length >= 1 && v.trim().length <= 50) || '学期名称长度须为 1-50',
    startDate: (v) => (vType(v, 'string') && isValidDate(v)) || '起始日期格式须为 YYYY-MM-DD',
    endDate: (v, body) => {
      if (!(vType(v, 'string') && isValidDate(v))) return '结束日期格式须为 YYYY-MM-DD'
      if (body.startDate && isValidDate(body.startDate) && v < body.startDate) return '结束日期不能早于起始日期'
      return true
    },
    weekStartDay: (v) => v === 1 || v === 7,
  }
}

/** 节次行校验 */
export function periodRules() {
  return {
    startTime: (v) => (vType(v, 'string') && isValidTime(v)) || '开始时间格式须为 HH:mm',
    endTime: (v, body) => {
      if (!(vType(v, 'string') && isValidTime(v))) return '结束时间格式须为 HH:mm'
      if (body.startTime && isValidTime(body.startTime) && v <= body.startTime) return '结束时间须晚于开始时间'
      return true
    },
  }
}

/**
 * 课程校验（导入行与手动录入共用）。
 * 结构：{ type, name, teacher, location, color, remark, sessions:[{ weekday, location, periods[], weeks[] }] }
 * 节次与周次一律为逐项展开的整数数组；sessions 为空表示「无固定时间」课程。
 * 返回清洗后的课程字段。
 */
export function validateCourse(body, { maxPeriod = MAX_PERIODS, maxWeek = MAX_WEEKS } = {}) {
  const out = {}
  const issues = []

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 50) issues.push({ field: 'name', message: '课程名称长度须为 1-50' })
  out.name = name

  const type = body.type ?? 'course'
  if (!COURSE_TYPES.includes(type)) issues.push({ field: 'type', message: '课程类型取值无效' })
  out.type = type

  out.teacher = typeof body.teacher === 'string' ? body.teacher.slice(0, 30) : ''
  out.location = typeof body.location === 'string' ? body.location.slice(0, 50) : ''
  out.remark = typeof body.remark === 'string' ? body.remark.slice(0, 200) : ''

  // 颜色：非法值回退 course-1；未提供时保持 undefined，交给调用方按轮询规则分配
  // （lib/colors.js 的 assignCourseColors）——否则所有未指定颜色的导入行都会落成同色
  if (body.color === undefined || body.color === null || body.color === '') {
    out.color = undefined
  } else {
    out.color = COLOR_NAMES.includes(body.color) ? body.color : 'course-1'
  }

  const rawSessions = body.sessions
  if (rawSessions !== undefined && !Array.isArray(rawSessions)) {
    issues.push({ field: 'sessions', message: 'sessions 须为数组' })
    out.sessions = []
  } else {
    const sessions = []
    for (const [i, s] of (rawSessions ?? []).entries()) {
      const at = `sessions[${i}]`
      if (!s || typeof s !== 'object') {
        issues.push({ field: at, message: '上课时间须为对象' })
        continue
      }
      if (![1, 2, 3, 4, 5, 6, 7].includes(s.weekday)) {
        issues.push({ field: `${at}.weekday`, message: '星期取值必须为 1-7' })
        continue
      }
      const periods = normalizeInts(s.periods)
      if (!periods.length || periods.some((p) => p > maxPeriod)) {
        issues.push({ field: `${at}.periods`, message: `节次须为 1-${maxPeriod} 的整数数组且非空` })
        continue
      }
      const weeks = normalizeInts(s.weeks)
      if (!weeks.length || weeks.some((w) => w > maxWeek)) {
        issues.push({ field: `${at}.weeks`, message: `周次须为 1-${maxWeek} 的整数数组且非空` })
        continue
      }
      sessions.push({
        weekday: s.weekday,
        location: typeof s.location === 'string' ? s.location.slice(0, 50) : '',
        periods,
        weeks,
      })
    }
    out.sessions = sessions
  }

  if (issues.length) throw badRequest('课程字段校验失败', issues)
  return out
}

/** 考试校验 */
export function validateExam(body) {
  const issues = []
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 50) issues.push({ field: 'name', message: '考试名称长度须为 1-50' })
  if (!(typeof body.datetime === 'string' && isValidDatetime(body.datetime))) {
    issues.push({ field: 'datetime', message: '时间格式须为 YYYY-MM-DDTHH:mm' })
  }
  if (body.courseId != null && !Number.isInteger(body.courseId)) {
    issues.push({ field: 'courseId', message: 'courseId 取值无效' })
  }
  if (issues.length) throw badRequest('考试字段校验失败', issues)
  return {
    name,
    datetime: body.datetime,
    courseId: body.courseId ?? null,
    location: typeof body.location === 'string' ? body.location.slice(0, 50) : '',
    remark: typeof body.remark === 'string' ? body.remark.slice(0, 200) : '',
  }
}

/** 作业校验 */
export function validateHomework(body) {
  const issues = []
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 50) issues.push({ field: 'name', message: '作业名称长度须为 1-50' })
  if (!(typeof body.dueAt === 'string' && isValidDatetime(body.dueAt))) {
    issues.push({ field: 'dueAt', message: '截止时间格式须为 YYYY-MM-DDTHH:mm' })
  }
  if (body.courseId != null && !Number.isInteger(body.courseId)) {
    issues.push({ field: 'courseId', message: 'courseId 取值无效' })
  }
  if (issues.length) throw badRequest('作业字段校验失败', issues)
  return {
    name,
    dueAt: body.dueAt,
    courseId: body.courseId ?? null,
    remark: typeof body.remark === 'string' ? body.remark.slice(0, 200) : '',
  }
}

/**
 * 班级通知校验：日期（排序键，前端默认今天）+ 标题必填，正文可选。
 * courseId 供「课程调整通知」关联具体课程（可空）；pinned 置顶。
 */
export function validateNotice(body) {
  const issues = []
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 100) issues.push({ field: 'title', message: '通知标题长度须为 1-100' })
  if (!(typeof body.date === 'string' && isValidDate(body.date))) {
    issues.push({ field: 'date', message: '日期格式须为 YYYY-MM-DD' })
  }
  if (body.courseId != null && !Number.isInteger(body.courseId)) {
    issues.push({ field: 'courseId', message: 'courseId 取值无效' })
  }
  if (body.pinned != null && typeof body.pinned !== 'boolean') {
    issues.push({ field: 'pinned', message: 'pinned 须为布尔值' })
  }
  if (issues.length) throw badRequest('通知字段校验失败', issues)
  return {
    title,
    date: body.date,
    body: typeof body.body === 'string' ? body.body.slice(0, 2000) : '',
    courseId: body.courseId ?? null,
    pinned: body.pinned ?? false,
  }
}

export const ADJUSTMENT_KINDS = ['cancel', 'move', 'extra']

/**
 * 单课日期调整校验。
 * 结构：{ courseId, date, kind, fromWeekday, fromPeriods[], toDate, periods[], location, note }
 * - cancel：停课——date 为原上课日，fromWeekday + fromPeriods 定位原时间组
 * - move  ：调课——原时间组同 cancel 规则，另加 toDate + periods（目标）
 * - extra ：补课——date 为补课日 + periods（目标）
 * periods / fromPeriods 一律为逐项展开的整数数组。
 */
export function validateAdjustment(body, { maxPeriod = MAX_PERIODS, semester = null } = {}) {
  const issues = []
  const inSemester = (d) => !semester || (d >= semester.start_date && d <= semester.end_date)

  const kind = body.kind
  if (!ADJUSTMENT_KINDS.includes(kind)) {
    issues.push({ field: 'kind', message: 'kind 须为 cancel / move / extra' })
  }

  const date = body.date
  if (!(typeof date === 'string' && isValidDate(date))) {
    issues.push({ field: 'date', message: '日期格式须为 YYYY-MM-DD' })
  } else if (!inSemester(date)) {
    issues.push({ field: 'date', message: '日期须在学期范围内' })
  }

  let fromWeekday = null
  let fromPeriods = []
  if (kind === 'cancel' || kind === 'move') {
    if (![1, 2, 3, 4, 5, 6, 7].includes(body.fromWeekday)) {
      issues.push({ field: 'fromWeekday', message: '原时间组星期须为 1-7' })
    } else {
      fromWeekday = body.fromWeekday
    }
    fromPeriods = normalizeInts(body.fromPeriods)
    if (!fromPeriods.length || fromPeriods.some((p) => p > maxPeriod)) {
      issues.push({ field: 'fromPeriods', message: `原时间组节次须为 1-${maxPeriod} 的整数数组且非空` })
    }
  }

  let toDate = null
  if (kind === 'move') {
    if (!(typeof body.toDate === 'string' && isValidDate(body.toDate))) {
      issues.push({ field: 'toDate', message: '目标日期格式须为 YYYY-MM-DD' })
    } else if (!inSemester(body.toDate)) {
      issues.push({ field: 'toDate', message: '目标日期须在学期范围内' })
    } else {
      toDate = body.toDate
    }
  }

  let periods = []
  if (kind === 'move' || kind === 'extra') {
    periods = normalizeInts(body.periods)
    if (!periods.length || periods.some((p) => p > maxPeriod)) {
      issues.push({ field: 'periods', message: `目标节次须为 1-${maxPeriod} 的整数数组且非空` })
    }
  }

  if (body.location != null && String(body.location).length > 50) {
    issues.push({ field: 'location', message: '地点长度须 ≤ 50' })
  }
  if (body.note != null && String(body.note).length > 200) {
    issues.push({ field: 'note', message: '备注长度须 ≤ 200' })
  }

  if (issues.length) throw badRequest('调整字段校验失败', issues)
  return {
    date,
    kind,
    fromWeekday,
    fromPeriods,
    toDate,
    periods,
    location: typeof body.location === 'string' ? body.location : '',
    note: typeof body.note === 'string' ? body.note : '',
  }
}

/** 设置校验（部分字段写） */
export function validateSettingsPatch(body) {
  const out = {}
  const issues = []
  const reminderShape = (v, key) => {
    if (typeof v !== 'object' || v === null) return `${key} 须为对象`
    if (typeof v.enabled !== 'boolean') return `${key}.enabled 须为布尔值`
    if (v.mode !== undefined && !['every', 'first'].includes(v.mode)) return `${key}.mode 取值无效`
    if (v.advanceMinutes !== undefined && ![5, 10, 15, 30].includes(v.advanceMinutes)) {
      return `${key}.advanceMinutes 须为 5/10/15/30`
    }
    return true
  }
  if ('showOddEvenFilter' in body && typeof body.showOddEvenFilter !== 'boolean') {
    issues.push({ field: 'showOddEvenFilter', message: '须为布尔值' })
  }
  for (const key of ['reminder', 'labReminder']) {
    if (key in body) {
      const r = reminderShape(body[key], key)
      if (r !== true) issues.push({ field: key, message: r })
    }
  }
  if ('homeworkReminder' in body) {
    const v = body.homeworkReminder
    if (typeof v !== 'object' || v === null) issues.push({ field: 'homeworkReminder', message: '须为对象' })
    else {
      if (typeof v.enabled !== 'boolean') issues.push({ field: 'homeworkReminder.enabled', message: '须为布尔值' })
      if (v.advanceDays !== undefined && ![1, 2, 3].includes(v.advanceDays)) {
        issues.push({ field: 'homeworkReminder.advanceDays', message: '须为 1/2/3' })
      }
    }
  }
  if ('weather' in body) {
    const v = body.weather
    if (typeof v !== 'object' || v === null) issues.push({ field: 'weather', message: '须为对象' })
    else {
      if (typeof v.enabled !== 'boolean') issues.push({ field: 'weather.enabled', message: '须为布尔值' })
      if (v.apiKey !== undefined && (typeof v.apiKey !== 'string' || v.apiKey.length > 100)) {
        issues.push({ field: 'weather.apiKey', message: 'API Key 长度须 ≤ 100' })
      }
      if (v.location !== undefined && (typeof v.location !== 'string' || v.location.trim().length > 50)) {
        issues.push({ field: 'weather.location', message: '城市名称长度须 ≤ 50' })
      }
    }
  }
  if (issues.length) throw badRequest('设置校验失败', issues)

  if ('showOddEvenFilter' in body) out.showOddEvenFilter = body.showOddEvenFilter
  for (const key of ['reminder', 'labReminder', 'homeworkReminder', 'weather']) {
    if (key in body) out[key] = body[key]
  }
  return out
}
