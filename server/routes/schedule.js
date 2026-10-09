// ============================================================
// ClassBoard · 启动聚合与周聚合路由（多用户按 user_id 隔离）
// 周聚合直接按周号查 course_slot（索引命中），不再做 week_type 语义过滤。
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toExam, toHomework, toPeriod, toSemester } from '../lib/db.js'
import { badRequest, wrap } from '../lib/errors.js'
import { readSettings } from '../lib/settings.js'
import { getCurrentSemester, calcWeekNumber, weekRange } from '../lib/week.js'
import { isValidDate } from '../lib/validate.js'
import { normalizeInts, runsOf } from '../lib/weekspan.js'

export const contextRouter = Router()
export const scheduleRouter = Router()

contextRouter.get(
  '/',
  wrap(async (req, res) => {
    if (!req.user) {
      return res.json({ accessRequired: true })
    }
    const currentSemesterId = getCurrentSemesterId(req.user.id)
    const semesters = db
      .prepare('SELECT * FROM semester WHERE user_id = ? ORDER BY start_date ASC, id ASC')
      .all(req.user.id)
      .map(toSemester)
    const periods =
      currentSemesterId === null
        ? []
        : db.prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC').all(currentSemesterId).map(toPeriod)
    res.json({
      semesters,
      currentSemesterId,
      periods,
      settings: readSettings(req.user.id),
      user: { id: req.user.id, username: req.user.username, role: req.user.role },
    })
  }),
)

/**
 * 取指定周可见的课程（含该周内实际出现的节次集合）。
 * 一个 course_session 若本周有 slot，则作为一个课程块返回。
 */
export function coursesVisibleInWeek(semesterId, userId, weekNumber, { includeAll = false } = {}) {
  const courseRows = db
    .prepare('SELECT * FROM course WHERE semester_id = ? AND user_id = ? ORDER BY name ASC, id ASC')
    .all(semesterId, userId)
  if (!courseRows.length) return []

  const ids = courseRows.map((c) => c.id)
  const ph = ids.map(() => '?').join(',')
  const sessionRows = db
    .prepare(`SELECT * FROM course_session WHERE course_id IN (${ph}) ORDER BY weekday ASC, id ASC`)
    .all(...ids)
  if (!sessionRows.length) return []

  const sessionIds = sessionRows.map((s) => s.id)
  const sph = sessionIds.map(() => '?').join(',')
  // 关键查询：本周的格子（week 列有索引）
  const slotRows = db
    .prepare(`SELECT session_id, period, week FROM course_slot WHERE week = ? AND session_id IN (${sph}) ORDER BY period ASC`)
    .all(weekNumber, ...sessionIds)
  const periodsBySession = new Map()
  for (const r of slotRows) {
    if (!periodsBySession.has(r.session_id)) periodsBySession.set(r.session_id, [])
    periodsBySession.get(r.session_id).push(r.period)
  }
  if (!includeAll && periodsBySession.size === 0) return []

  // 各时间组的「完整节次集合」（不限周次）：冲突检测用它，保证分组不随切周跳变
  const allPeriodRows = db
    .prepare(`SELECT DISTINCT session_id, period FROM course_slot WHERE session_id IN (${sph}) ORDER BY period ASC`)
    .all(...sessionIds)
  const allPeriodsBySession = new Map()
  for (const r of allPeriodRows) {
    if (!allPeriodsBySession.has(r.session_id)) allPeriodsBySession.set(r.session_id, [])
    allPeriodsBySession.get(r.session_id).push(r.period)
  }

  const periodRows = db
    .prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
    .all(semesterId)
  const periodMap = new Map(periodRows.map((p) => [p.period_index, p]))
  const courseById = new Map(courseRows.map((c) => [c.id, c]))

  const blocks = []
  for (const s of sessionRows) {
    const periods = normalizeInts(periodsBySession.get(s.id) ?? [])
    if (!includeAll && periods.length === 0) continue
    const c = courseById.get(s.course_id)
    if (!c) continue
    const list = periods.length ? periods : []
    const startPeriod = list.length ? list[0] : 1
    const endPeriod = list.length ? list[list.length - 1] : 1
    const runs = runsOf(list)
    const sTpl = periodMap.get(startPeriod)
    const eTpl = periodMap.get(endPeriod)
    blocks.push({
      id: c.id,
      sessionId: s.id,
      semesterId: c.semester_id,
      type: c.type,
      name: c.name,
      teacher: c.teacher,
      location: s.location || c.location,
      color: c.color,
      remark: c.remark,
      weekday: s.weekday,
      periods: list,
      // 完整节次（不受本周过滤影响）——前端冲突检测与块定位以此为准
      allPeriods: normalizeInts(allPeriodsBySession.get(s.id) ?? []),
      startPeriod,
      endPeriod,
      runs,
      startTime: sTpl ? sTpl.start_time : null,
      endTime: eTpl ? eTpl.end_time : null,
    })
  }
  return blocks
}

scheduleRouter.get(
  '/',
  wrap(async (req, res) => {
    const dateStr = req.query.date ?? new Date().toISOString().slice(0, 10)
    if (typeof dateStr !== 'string' || !isValidDate(dateStr)) {
      throw badRequest('date 格式须为 YYYY-MM-DD', [{ field: 'date', message: 'date 格式须为 YYYY-MM-DD' }])
    }

    const semester = getCurrentSemester(req.user.id)
    // weekNumber: 0=未开学（早于起始日）、null=学期已结束（假期）、1..n=第几周
    const weekNumber = semester ? calcWeekNumber(dateStr, semester) : null
    const isBeforeSemester = weekNumber === 0
    const isHoliday = semester !== null && weekNumber === null
    const range = semester ? weekRange(dateStr, semester.weekStartDay) : null

    let courses = []
    let exams = []
    let homework = []

    if (semester) {
      if (!isHoliday && !isBeforeSemester) {
        courses = coursesVisibleInWeek(semester.id, req.user.id, weekNumber)
      }
      exams = db
        .prepare("SELECT * FROM exam WHERE semester_id = ? AND user_id = ? AND datetime >= ? AND datetime <= ? ORDER BY datetime DESC")
        .all(semester.id, req.user.id, `${range.startDate}T00:00`, `${range.endDate}T23:59`)
        .map(toExam)
      homework = db
        .prepare("SELECT * FROM homework WHERE semester_id = ? AND user_id = ? AND due_at >= ? AND due_at <= ? ORDER BY due_at DESC")
        .all(semester.id, req.user.id, `${range.startDate}T00:00`, `${range.endDate}T23:59`)
        .map(toHomework)
    }

    res.json({
      week: {
        // 未开学对前端回传 null（与"该周无课"等价），并额外给出 isBeforeSemester 供 UI 提示
        weekNumber: isBeforeSemester ? null : weekNumber,
        isOddWeek: weekNumber !== null && weekNumber > 0 && weekNumber % 2 === 1,
        isHoliday,
        isBeforeSemester,
        startDate: range ? range.startDate : null,
        endDate: range ? range.endDate : null,
        semester: semester ? toSemester(semester) : null,
      },
      courses,
      exams,
      homework,
    })
  }),
)
