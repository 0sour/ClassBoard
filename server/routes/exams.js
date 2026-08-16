// ============================================================
// ClassBoard · 考试路由（技术文档 4.3.3 #21-#24）
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toExam } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { validateExam } from '../lib/validate.js'

export const examsRouter = Router()

function defaultSemesterId(body) {
  if (body.semesterId !== undefined && body.semesterId !== null) return Number(body.semesterId)
  return getCurrentSemesterId()
}

examsRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = req.query.semesterId !== undefined ? Number(req.query.semesterId) : getCurrentSemesterId()
    if (semesterId === null) return res.json([])
    const rows = db
      .prepare('SELECT * FROM exam WHERE semester_id = ? ORDER BY datetime DESC')
      .all(semesterId)
    res.json(rows.map(toExam))
  }),
)

examsRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = defaultSemesterId(req.body)
    if (semesterId === null) throw badRequest('未设置当前学期，请先创建或切换学期')
    const sem = db.prepare('SELECT id FROM semester WHERE id = ?').get(semesterId)
    if (!sem) throw notFound('学期不存在')
    const e = validateExam(req.body)
    if (e.courseId !== null && !db.prepare('SELECT id FROM course WHERE id = ?').get(e.courseId)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const info = db
      .prepare('INSERT INTO exam (semester_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?)')
      .run(semesterId, e.courseId, e.name, e.datetime, e.location, e.remark)
    res.status(201).json(toExam(db.prepare('SELECT * FROM exam WHERE id = ?').get(info.lastInsertRowid)))
  }),
)

examsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM exam WHERE id = ?').get(id)
    if (!row) throw notFound('考试不存在')
    const e = validateExam(req.body)
    if (e.courseId !== null && !db.prepare('SELECT id FROM course WHERE id = ?').get(e.courseId)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    db.prepare('UPDATE exam SET course_id = ?, name = ?, datetime = ?, location = ?, remark = ? WHERE id = ?').run(
      e.courseId, e.name, e.datetime, e.location, e.remark, id,
    )
    res.json(toExam(db.prepare('SELECT * FROM exam WHERE id = ?').get(id)))
  }),
)

examsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const info = db.prepare('DELETE FROM exam WHERE id = ?').run(Number(req.params.id))
    if (!info.changes) throw notFound('考试不存在')
    res.status(204).end()
  }),
)
