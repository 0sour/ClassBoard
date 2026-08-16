// ============================================================
// ClassBoard · 启动聚合与周聚合路由（技术文档 4.3.1 #5-#6）
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toExam, toHomework, toPeriod, toSemester } from '../lib/db.js'
import { badRequest, wrap } from '../lib/errors.js'
import { isAccessEnabled, readSettings } from '../lib/settings.js'
import { getCurrentSemester, isCourseVisible, calcWeekNumber, weekRange } from '../lib/week.js'
import { isValidDate } from '../lib/validate.js'

export const contextRouter = Router()
export const scheduleRouter = Router()

contextRouter.get(
  '/',
  wrap(async (req, res) => {
    if (isAccessEnabled() && !req.sessionOk) {
      return res.json({ accessRequired: true })
    }
    const currentSemesterId = getCurrentSemesterId()
    const semesters = db.prepare('SELECT * FROM semester ORDER BY start_date ASC, id ASC').all().map(toSemester)
    const periods =
      currentSemesterId === null
        ? []
        : db.prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC').all(currentSemesterId).map(toPeriod)
    res.json({
      semesters,
      currentSemesterId,
      periods,
      settings: { ...readSettings(), accessEnabled: isAccessEnabled() },
    })
  }),
)

scheduleRouter.get(
  '/',
  wrap(async (req, res) => {
    const dateStr = req.query.date ?? new Date().toISOString().slice(0, 10)
    if (typeof dateStr !== 'string' || !isValidDate(dateStr)) {
      throw badRequest('date 格式须为 YYYY-MM-DD', [{ field: 'date', message: 'date 格式须为 YYYY-MM-DD' }])
    }

    const semester = getCurrentSemester()
    const weekNumber = semester ? calcWeekNumber(dateStr, semester) : null
    // 已设置学期但日期在学期外（假期/未开学）
    const isHoliday = semester !== null && weekNumber === null

    const settings = readSettings()
    let courses = []
    let exams = []
    let homework = []

    if (semester) {
      if (!isHoliday) {
        const rows = db
          .prepare('SELECT * FROM course WHERE semester_id = ? ORDER BY weekday ASC, start_period ASC')
          .all(semester.id)
        const periodRows = db
          .prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
          .all(semester.id)
        const periodMap = new Map(periodRows.map((p) => [p.period_index, p]))
        courses = rows
          .filter((c) => isCourseVisible(c.week_type, c.week_list ? JSON.parse(c.week_list) : null, weekNumber, settings.showOddEvenFilter))
          .map((c) => {
            const s = periodMap.get(c.start_period)
            const e = periodMap.get(c.end_period)
            return {
              id: c.id,
              type: c.type,
              name: c.name,
              teacher: c.teacher,
              location: c.location,
              color: c.color,
              weekType: c.week_type,
              weekList: c.week_list ? JSON.parse(c.week_list) : null,
              weekday: c.weekday,
              startPeriod: c.start_period,
              endPeriod: c.end_period,
              startTime: s ? s.start_time : null,
              endTime: e ? e.end_time : null,
              remark: c.remark,
            }
          })
      }
      const { startDate, endDate } = weekRange(dateStr, semester.weekStartDay)
      exams = db
        .prepare("SELECT * FROM exam WHERE semester_id = ? AND datetime >= ? AND datetime <= ? ORDER BY datetime DESC")
        .all(semester.id, `${startDate}T00:00`, `${endDate}T23:59`)
        .map(toExam)
      homework = db
        .prepare("SELECT * FROM homework WHERE semester_id = ? AND due_at >= ? AND due_at <= ? ORDER BY due_at DESC")
        .all(semester.id, `${startDate}T00:00`, `${endDate}T23:59`)
        .map(toHomework)
    }

    res.json({
      week: {
        weekNumber,
        isOddWeek: weekNumber !== null && weekNumber % 2 === 1,
        isHoliday,
        startDate: semester ? weekRange(dateStr, semester.weekStartDay).startDate : null,
        endDate: semester ? weekRange(dateStr, semester.weekStartDay).endDate : null,
        semester: semester ? toSemester(semester) : null,
      },
      courses,
      exams,
      homework,
    })
  }),
)
