// ============================================================
// ClassBoard · 课程路由（多用户按 user_id 隔离）
// 模型：course（课程组）+ course_session（上课时间组）+ course_slot（节×周逐格子）
// 写入为整组原子替换：先删该课全部 sessions（级联清空 slot），再按请求重建。
// ============================================================
import { Router } from 'express'
import {
  db,
  getCurrentSemesterId,
  loadCourseWithSessions,
  replaceCourseSessions,
  toCoursesWithSessions,
} from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { COURSE_TYPES, validateCourse } from '../lib/validate.js'
import { periodLimitOf, weekLimitOf } from '../lib/semesters.js'
import { assignCourseColors } from '../lib/colors.js'

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
    if (semesterId === null) return res.json([])
    let sql = 'SELECT * FROM course WHERE semester_id = ? AND user_id = ?'
    const params = [semesterId, req.user.id]
    if (req.query.type) {
      sql += ' AND type = ?'
      params.push(req.query.type)
    }
    sql += ' ORDER BY name ASC, id ASC'
    const rows = db.prepare(sql).all(...params)
    res.json(toCoursesWithSessions(rows))
  }),
)

coursesRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = defaultSemesterId(req.body, req.user.id)
    if (semesterId === null) throw badRequest('未设置当前学期，请先创建或切换学期')
    ownedSemester(semesterId, req.user.id)
    const c = validateCourse(req.body, { maxPeriod: periodLimitOf(semesterId), maxWeek: weekLimitOf(semesterId) })
    // 颜色缺省时按「同名复用 + 8 色轮询」分配（与前端 pickCourseColor 同规则）
    assignCourseColors([c], semesterId, req.user.id)
    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO course (semester_id, user_id, type, name, teacher, location, color, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(semesterId, req.user.id, c.type, c.name, c.teacher, c.location, c.color, c.remark)
      const id = info.lastInsertRowid
      replaceCourseSessions(id, c.sessions)
      return id
    })
    const id = create()
    res.status(201).json(loadCourseWithSessions(db.prepare('SELECT * FROM course WHERE id = ?').get(id)))
  }),
)

coursesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM course WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id)
    if (!row) throw notFound('课程不存在')
    res.json(loadCourseWithSessions(row))
  }),
)

coursesRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM course WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('课程不存在')
    const c = validateCourse(req.body, { maxPeriod: periodLimitOf(row.semester_id), maxWeek: weekLimitOf(row.semester_id) })
    if (c.color === undefined) c.color = row.color ?? 'course-1'
    const update = db.transaction(() => {
      db.prepare(
        'UPDATE course SET type = ?, name = ?, teacher = ?, location = ?, color = ?, remark = ? WHERE id = ?',
      ).run(c.type, c.name, c.teacher, c.location, c.color, c.remark, id)
      replaceCourseSessions(id, c.sessions)
    })
    update()
    res.json(loadCourseWithSessions(db.prepare('SELECT * FROM course WHERE id = ?').get(id)))
  }),
)

coursesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT id FROM course WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('课程不存在')
    // exam/homework 的 course_id 由 FK ON DELETE SET NULL 自动置空；sessions/slots 级联删除
    db.prepare('DELETE FROM course WHERE id = ?').run(id)
    res.status(204).end()
  }),
)

