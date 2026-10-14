// ============================================================
// ClassBoard · 单课日期调整路由（停课 / 调课 / 补课）
// 基准课表 course_slot 不改动；调整是独立的「日期覆盖层」，读取时叠加。
// 归属校验：调整 → 课程 → 用户与学期（course 删除时级联清理）。
// ============================================================
import { Router } from 'express'
import { db, getClassCurrentSemesterId, toAdjustment } from '../lib/db.js'
import { classFromRequest, memberCourse, memberSemester } from '../lib/classes.js'
import { recordChange, entitySnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { isValidDate, validateAdjustment } from '../lib/validate.js'
import { periodLimitOf } from '../lib/semesters.js'

export const adjustmentsRouter = Router()

/** 解析学期：?semesterId= 优先，否则取 ?classId= 的当前学期 */
function resolveSemester(req) {
  if (req.query.semesterId !== undefined && req.query.semesterId !== '') {
    const row = memberSemester(Number(req.query.semesterId), req.user.id)
    if (!row) throw notFound('学期不存在')
    return row
  }
  const cls = classFromRequest(req)
  const id = getClassCurrentSemesterId(cls.id)
  return id === null ? null : db.prepare('SELECT * FROM semester WHERE id = ?').get(id)
}

/** 调整行 + 其课程（校验调用者是否为该班成员） */
function adjustmentWithCourse(id, userId) {
  const row = db
    .prepare(
      `SELECT a.*, c.semester_id AS course_semester_id
         FROM course_adjustment a JOIN course c ON c.id = a.course_id
        WHERE a.id = ?`,
    )
    .get(id)
  if (!row) return null
  return memberCourse(row.course_id, userId) ? row : null
}

function listAdjustments(semesterId) {
  return db
    .prepare(
      `SELECT a.* FROM course_adjustment a JOIN course c ON c.id = a.course_id
        WHERE c.semester_id = ?
        ORDER BY a.date ASC, a.id ASC`,
    )
    .all(semesterId)
    .map(toAdjustment)
}

/** 学期内全部调整 */
adjustmentsRouter.get(
  '/',
  wrap(async (req, res) => {
    const sem = resolveSemester(req)
    if (!sem) return res.json([])
    res.json(listAdjustments(sem.id))
  }),
)

/** 新建调整（课程归属决定学期；节次上限取该学期节次模板长度） */
adjustmentsRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const courseId = Number(body.courseId)
    if (!Number.isInteger(courseId)) throw badRequest('courseId 取值无效')
    const course = memberCourse(courseId, req.user.id)
    if (!course) throw notFound('课程不存在')
    const semester = memberSemester(course.semester_id, req.user.id)
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
    const newId = info.lastInsertRowid
    recordChange({
      classId: semester.class_id,
      actorId: req.user.id,
      action: 'create',
      entity: 'adjustment',
      entityId: newId,
      after: entitySnapshot('adjustment', newId),
    })
    res.status(201).json(toAdjustment(db.prepare('SELECT * FROM course_adjustment WHERE id = ?').get(newId)))
  }),
)

/** 更新调整（课程不可改，始终沿用原课程） */
adjustmentsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = adjustmentWithCourse(id, req.user.id)
    if (!row) throw notFound('调整不存在')
    const semester = memberSemester(row.course_semester_id, req.user.id)
    const c = validateAdjustment(req.body ?? {}, { maxPeriod: periodLimitOf(semester.id), semester })
    const before = entitySnapshot('adjustment', id)
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
    recordChange({
      classId: semester.class_id,
      actorId: req.user.id,
      action: 'update',
      entity: 'adjustment',
      entityId: id,
      before,
      after: entitySnapshot('adjustment', id),
    })
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
    const semester = memberSemester(row.course_semester_id, req.user.id)
    const before = entitySnapshot('adjustment', id)
    // 拖拽撤销用：允许按「课程 + 原日期」批量删除该日全部调整
    const byDate = req.query.date
    if (typeof byDate === 'string') {
      if (!isValidDate(byDate)) throw badRequest('date 格式须为 YYYY-MM-DD')
      db.prepare('DELETE FROM course_adjustment WHERE course_id = ? AND date = ?').run(row.course_id, byDate)
    } else {
      db.prepare('DELETE FROM course_adjustment WHERE id = ?').run(id)
    }
    recordChange({
      classId: semester?.class_id ?? null,
      actorId: req.user.id,
      action: 'delete',
      entity: 'adjustment',
      entityId: id,
      before,
    })
    res.status(204).end()
  }),
)
