// ============================================================
// ClassBoard · 考试路由（按班级学期归属）
// ============================================================
import { Router } from 'express'
import { db, getClassCurrentSemesterId, toExam } from '../lib/db.js'
import { classFromRequest, memberCourse, memberSemester } from '../lib/classes.js'
import { recordChange, entitySnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { validateExam } from '../lib/validate.js'

export const examsRouter = Router()

function resolveSemesterId(value, req) {
  if (value !== undefined && value !== null && value !== '') return Number(value)
  const cls = classFromRequest(req)
  return getClassCurrentSemesterId(cls.id)
}

examsRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.query.semesterId, req)
    if (semesterId === null) return res.json([])
    const sem = memberSemester(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    const rows = db.prepare('SELECT * FROM exam WHERE semester_id = ? ORDER BY datetime DESC').all(semesterId)
    res.json(rows.map(toExam))
  }),
)

examsRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.body.semesterId, req)
    if (semesterId === null || !Number.isInteger(semesterId)) {
      throw badRequest('未设置当前学期，请先创建或切换学期')
    }
    const sem = memberSemester(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    const e = validateExam(req.body)
    if (e.courseId !== null && !memberCourse(e.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const info = db
      .prepare('INSERT INTO exam (semester_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?)')
      .run(semesterId, e.courseId, e.name, e.datetime, e.location, e.remark)
    const id = info.lastInsertRowid
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'create',
      entity: 'exam',
      entityId: id,
      after: entitySnapshot('exam', id),
    })
    res.status(201).json(toExam(db.prepare('SELECT * FROM exam WHERE id = ?').get(id)))
  }),
)

examsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM exam WHERE id = ?').get(id)
    const sem = row ? memberSemester(row.semester_id, req.user.id) : null
    if (!row || !sem) throw notFound('考试不存在')
    const e = validateExam(req.body)
    if (e.courseId !== null && !memberCourse(e.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const before = entitySnapshot('exam', id)
    db.prepare('UPDATE exam SET course_id = ?, name = ?, datetime = ?, location = ?, remark = ? WHERE id = ?').run(
      e.courseId, e.name, e.datetime, e.location, e.remark, id,
    )
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'update',
      entity: 'exam',
      entityId: id,
      before,
      after: entitySnapshot('exam', id),
    })
    res.json(toExam(db.prepare('SELECT * FROM exam WHERE id = ?').get(id)))
  }),
)

examsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM exam WHERE id = ?').get(id)
    const sem = row ? memberSemester(row.semester_id, req.user.id) : null
    if (!row || !sem) throw notFound('考试不存在')
    const before = entitySnapshot('exam', id)
    db.prepare('DELETE FROM exam WHERE id = ?').run(id)
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'delete',
      entity: 'exam',
      entityId: id,
      before,
    })
    res.status(204).end()
  }),
)
