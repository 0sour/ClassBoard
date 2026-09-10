// ============================================================
// ClassBoard · 作业路由（技术文档 4.3.4 #25-#29，多用户按 user_id 隔离）
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toHomework } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { validateHomework } from '../lib/validate.js'

export const homeworkRouter = Router()

function defaultSemesterId(body, userId) {
  if (body.semesterId !== undefined && body.semesterId !== null) return Number(body.semesterId)
  return getCurrentSemesterId(userId)
}

function ownedSemester(semesterId, userId) {
  const sem = db.prepare('SELECT id FROM semester WHERE id = ? AND user_id = ?').get(semesterId, userId)
  if (!sem) throw notFound('学期不存在')
  return sem
}

homeworkRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = req.query.semesterId !== undefined ? Number(req.query.semesterId) : getCurrentSemesterId(req.user.id)
    if (req.query.status !== undefined && !['open', 'done'].includes(req.query.status)) {
      throw badRequest('status 取值无效')
    }
    if (semesterId === null) return res.json([])
    let sql = 'SELECT * FROM homework WHERE semester_id = ? AND user_id = ?'
    const params = [semesterId, req.user.id]
    if (req.query.status === 'open') {
      sql += ' AND done = 0'
    } else if (req.query.status === 'done') {
      sql += ' AND done = 1'
    }
    sql += ' ORDER BY due_at DESC'
    res.json(db.prepare(sql).all(...params).map(toHomework))
  }),
)

homeworkRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = defaultSemesterId(req.body, req.user.id)
    if (semesterId === null) throw badRequest('未设置当前学期，请先创建或切换学期')
    ownedSemester(semesterId, req.user.id)
    const h = validateHomework(req.body)
    if (h.courseId !== null && !db.prepare('SELECT id FROM course WHERE id = ? AND user_id = ?').get(h.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const info = db
      .prepare('INSERT INTO homework (semester_id, user_id, course_id, name, due_at, done, remark) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(semesterId, req.user.id, h.courseId, h.name, h.dueAt, h.done ? 1 : 0, h.remark)
    res.status(201).json(toHomework(db.prepare('SELECT * FROM homework WHERE id = ?').get(info.lastInsertRowid)))
  }),
)

homeworkRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM homework WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('作业不存在')
    const h = validateHomework(req.body)
    if (h.courseId !== null && !db.prepare('SELECT id FROM course WHERE id = ? AND user_id = ?').get(h.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    db.prepare('UPDATE homework SET course_id = ?, name = ?, due_at = ?, done = ?, remark = ? WHERE id = ?').run(
      h.courseId, h.name, h.dueAt, h.done ? 1 : 0, h.remark, id,
    )
    res.json(toHomework(db.prepare('SELECT * FROM homework WHERE id = ?').get(id)))
  }),
)

homeworkRouter.patch(
  '/:id/done',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM homework WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('作业不存在')
    if (typeof req.body.done !== 'boolean') throw badRequest('done 须为布尔值')
    db.prepare('UPDATE homework SET done = ? WHERE id = ?').run(req.body.done ? 1 : 0, id)
    res.json({ id, done: req.body.done })
  }),
)

homeworkRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const info = db.prepare('DELETE FROM homework WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id)
    if (!info.changes) throw notFound('作业不存在')
    res.status(204).end()
  }),
)
