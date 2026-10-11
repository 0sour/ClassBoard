// ============================================================
// ClassBoard · 单课日期调整路由（停课 / 调课 / 补课）
// 基准课表 course_slot 不改动；调整是独立的「日期覆盖层」，读取时叠加。
// 归属校验：调整 → 课程 → 用户与学期（course 删除时级联清理）。
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toAdjustment } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { isValidDate, validateAdjustment } from '../lib/validate.js'
import { periodLimitOf } from '../lib/semesters.js'

export const adjustmentsRouter = Router()

function resolveSemesterId(query, userId) {
  if (query.semesterId !== undefined) return Number(query.semesterId)
  return getCurrentSemesterId(userId)
}

function ownedSemester(semesterId, userId) {
  const sem = db.prepare('SELECT * FROM semester WHERE id = ? AND user_id = ?').get(semesterId, userId)
  if (!sem) throw notFound('学期不存在')
  return sem
}

/** 调整行 + 其课程（限当前用户） */
function adjustmentWithCourse(id, userId) {
  return db
    .prepare(
      `SELECT a.*, c.semester_id AS course_semester_id
         FROM course_adjustment a JOIN course c ON c.id = a.course_id
        WHERE a.id = ? AND c.user_id = ?`,
    )
    .get(id, userId)
}

function listAdjustments(semesterId, userId) {
  return db
    .prepare(
      `SELECT a.* FROM course_adjustment a JOIN course c ON c.id = a.course_id
        WHERE c.user_id = ? AND c.semester_id = ?
        ORDER BY a.date ASC, a.id ASC`,
    )
    .all(userId, semesterId)
    .map(toAdjustment)
}

/** 学期内全部调整 */
adjustmentsRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.query, req.user.id)
    if (semesterId === null) return res.json([])
    ownedSemester(semesterId, req.user.id)
    res.json(listAdjustments(semesterId, req.user.id))
  }),
)

/** 新建调整（课程归属决定学期；节次上限取该学期节次模板长度） */
adjustmentsRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const courseId = Number(body.courseId)
    if (!Number.isInteger(courseId)) throw badRequest('courseId 取值无效')
    const course = db
      .prepare('SELECT * FROM course WHERE id = ? AND user_id = ?')
      .get(courseId, req.user.id)
    if (!course) throw notFound('课程不存在')
    const semester = ownedSemester(course.semester_id, req.user.id)
    const c = validateAdjustment(body, { maxPeriod: periodLimitOf(semester.id), semester })
    const info = db
      .prepare(
        `INSERT INTO course_adjustment
           (course_id, date, kind, from_weekday, from_periods, to_date, periods, location, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        courseId,
        c.date,
        c.kind,
        c.fromWeekday,
        JSON.stringify(c.fromPeriods),
        c.toDate,
        JSON.stringify(c.periods),
        c.location,
        c.note,
        new Date().toISOString(),
      )
    res.status(201).json(toAdjustment(db.prepare('SELECT * FROM course_adjustment WHERE id = ?').get(info.lastInsertRowid)))
  }),
)

/** 更新调整（课程不可改，始终沿用原课程） */
adjustmentsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = adjustmentWithCourse(id, req.user.id)
    if (!row) throw notFound('调整不存在')
    const semester = ownedSemester(row.course_semester_id, req.user.id)
    const c = validateAdjustment(req.body ?? {}, { maxPeriod: periodLimitOf(semester.id), semester })
    db.prepare(
      `UPDATE course_adjustment
          SET date = ?, kind = ?, from_weekday = ?, from_periods = ?, to_date = ?, periods = ?, location = ?, note = ?
        WHERE id = ?`,
    ).run(
      c.date,
      c.kind,
      c.fromWeekday,
      JSON.stringify(c.fromPeriods),
      c.toDate,
      JSON.stringify(c.periods),
      c.location,
      c.note,
      id,
    )
    res.json(toAdjustment(db.prepare('SELECT * FROM course_adjustment WHERE id = ?').get(id)))
  }),
)

/** 删除调整（撤销） */
adjustmentsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = adjustmentWithCourse(id, req.user.id)
    if (!row) throw notFound('调整不存在')
    // 拖拽撤销用：允许按「课程 + 原日期」批量删除该日全部调整
    const byDate = req.query.date
    if (typeof byDate === 'string') {
      if (!isValidDate(byDate)) throw badRequest('date 格式须为 YYYY-MM-DD')
      db.prepare('DELETE FROM course_adjustment WHERE course_id = ? AND date = ?').run(row.course_id, byDate)
    } else {
      db.prepare('DELETE FROM course_adjustment WHERE id = ?').run(id)
    }
    res.status(204).end()
  }),
)
