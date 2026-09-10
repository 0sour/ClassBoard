// ============================================================
// ClassBoard · 课程路由（技术文档 4.3.2 #16-#20，多用户按 user_id 隔离）
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toCourse } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { COURSE_TYPES, validateCourse } from '../lib/validate.js'

export const coursesRouter = Router()

function defaultSemesterId(body, userId) {
  if (body.semesterId !== undefined && body.semesterId !== null) return Number(body.semesterId)
  return getCurrentSemesterId(userId)
}

/** 学期归属校验：学期必须属于当前用户 */
function ownedSemester(semesterId, userId) {
  const sem = db.prepare('SELECT id FROM semester WHERE id = ? AND user_id = ?').get(semesterId, userId)
  if (!sem) throw notFound('学期不存在')
  return sem
}

coursesRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = req.query.semesterId !== undefined ? Number(req.query.semesterId) : getCurrentSemesterId(req.user.id)
    if (req.query.type !== undefined && !COURSE_TYPES.includes(req.query.type)) {
      throw badRequest('type 取值无效')
    }
    let sql = 'SELECT * FROM course WHERE semester_id = ? AND user_id = ?'
    const params = [semesterId, req.user.id]
    if (req.query.type) {
      sql += ' AND type = ?'
      params.push(req.query.type)
    }
    sql += ' ORDER BY weekday ASC, start_period ASC'
    const rows = db.prepare(sql).all(...params)
    res.json(rows.map(toCourse))
  }),
)

coursesRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = defaultSemesterId(req.body, req.user.id)
    if (semesterId === null) throw badRequest('未设置当前学期，请先创建或切换学期')
    ownedSemester(semesterId, req.user.id)
    const c = validateCourse(req.body)
    const info = db
      .prepare(
        `INSERT INTO course (semester_id, user_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        semesterId, req.user.id, c.type, c.name, c.teacher, c.location, c.color, c.weekType,
        c.weekList ? JSON.stringify(c.weekList) : null,
        c.weekday, c.startPeriod, c.endPeriod, c.remark,
      )
    res.status(201).json(toCourse(db.prepare('SELECT * FROM course WHERE id = ?').get(info.lastInsertRowid)))
  }),
)

coursesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM course WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id)
    if (!row) throw notFound('课程不存在')
    res.json(toCourse(row))
  }),
)

coursesRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM course WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('课程不存在')
    const c = validateCourse(req.body)
    db.prepare(
      `UPDATE course SET type = ?, name = ?, teacher = ?, location = ?, color = ?, week_type = ?, week_list = ?,
       weekday = ?, start_period = ?, end_period = ?, remark = ? WHERE id = ?`,
    ).run(
      c.type, c.name, c.teacher, c.location, c.color, c.weekType,
      c.weekList ? JSON.stringify(c.weekList) : null,
      c.weekday, c.startPeriod, c.endPeriod, c.remark, id,
    )
    res.json(toCourse(db.prepare('SELECT * FROM course WHERE id = ?').get(id)))
  }),
)

coursesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT id FROM course WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('课程不存在')
    // exam/homework 的 course_id 由 FK ON DELETE SET NULL 自动置空
    db.prepare('DELETE FROM course WHERE id = ?').run(id)
    res.status(204).end()
  }),
)
