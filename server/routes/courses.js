// ============================================================
// ClassBoard · 课程路由（按班级学期归属）
// 模型：course（课程组）+ course_session（上课时间组）+ course_slot（节×周逐格子）
// 写入为整组原子替换：先删该课全部 sessions（级联清空 slot），再按请求重建。
// ============================================================
import { Router } from 'express'
import { db, getClassCurrentSemesterId, loadCourseWithSessions, replaceCourseSessions, toCoursesWithSessions } from '../lib/db.js'
import { classFromRequest, memberCourse, memberSemester } from '../lib/classes.js'
import { recordChange, entitySnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { COURSE_TYPES, validateCourse } from '../lib/validate.js'
import { periodLimitOf, weekLimitOf } from '../lib/semesters.js'
import { assignCourseColors } from '../lib/colors.js'

export const coursesRouter = Router()

/** 解析学期：body/query 里的 semesterId，否则取 classId 的当前学期 */
function resolveSemesterId(value, req) {
  if (value !== undefined && value !== null && value !== '') return Number(value)
  const cls = classFromRequest(req)
  return getClassCurrentSemesterId(cls.id)
}

coursesRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.query.semesterId, req)
    if (req.query.type !== undefined && !COURSE_TYPES.includes(req.query.type)) {
      throw badRequest('type 取值无效')
    }
    if (semesterId === null) return res.json([])
    const sem = memberSemester(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    let sql = 'SELECT * FROM course WHERE semester_id = ?'
    const params = [semesterId]
    if (req.query.type) {
      sql += ' AND type = ?'
      params.push(req.query.type)
    }
    sql += ' ORDER BY name ASC, id ASC'
    res.json(toCoursesWithSessions(db.prepare(sql).all(...params)))
  }),
)

coursesRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.body.semesterId, req)
    if (semesterId === null || !Number.isInteger(semesterId)) {
      throw badRequest('未设置当前学期，请先创建或切换学期')
    }
    const sem = memberSemester(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    const c = validateCourse(req.body, { maxPeriod: periodLimitOf(semesterId), maxWeek: weekLimitOf(semesterId) })
    // 颜色缺省时按「同名复用 + 8 色轮询」分配（与前端 pickCourseColor 同规则）
    assignCourseColors([c], semesterId)
    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO course (semester_id, type, name, teacher, location, color, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(semesterId, c.type, c.name, c.teacher, c.location, c.color, c.remark)
      const id = info.lastInsertRowid
      replaceCourseSessions(id, c.sessions)
      return id
    })
    const id = create()
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'create',
      entity: 'course',
      entityId: id,
      after: entitySnapshot('course', id),
    })
    res.status(201).json(loadCourseWithSessions(db.prepare('SELECT * FROM course WHERE id = ?').get(id)))
  }),
)

coursesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const row = memberCourse(Number(req.params.id), req.user.id)
    if (!row) throw notFound('课程不存在')
    res.json(loadCourseWithSessions(row))
  }),
)

coursesRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = memberCourse(id, req.user.id)
    if (!row) throw notFound('课程不存在')
    const sem = db.prepare('SELECT * FROM semester WHERE id = ?').get(row.semester_id)
    const c = validateCourse(req.body, { maxPeriod: periodLimitOf(row.semester_id), maxWeek: weekLimitOf(row.semester_id) })
    if (c.color === undefined) c.color = row.color ?? 'course-1'
    const before = entitySnapshot('course', id)
    const update = db.transaction(() => {
      db.prepare(
        'UPDATE course SET type = ?, name = ?, teacher = ?, location = ?, color = ?, remark = ? WHERE id = ?',
      ).run(c.type, c.name, c.teacher, c.location, c.color, c.remark, id)
      // sessions 缺省 = 只改元信息：不动上课时间（前端编辑弹窗总会带全量 sessions）
      if (req.body?.sessions !== undefined) replaceCourseSessions(id, c.sessions)
    })
    update()
    recordChange({
      classId: sem?.class_id ?? null,
      actorId: req.user.id,
      action: 'update',
      entity: 'course',
      entityId: id,
      before,
      after: entitySnapshot('course', id),
    })
    res.json(loadCourseWithSessions(db.prepare('SELECT * FROM course WHERE id = ?').get(id)))
  }),
)

coursesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = memberCourse(id, req.user.id)
    if (!row) throw notFound('课程不存在')
    const sem = db.prepare('SELECT * FROM semester WHERE id = ?').get(row.semester_id)
    const before = entitySnapshot('course', id)
    // exam/homework 的 course_id 由 FK ON DELETE SET NULL 自动置空；sessions/slots 级联删除
    db.prepare('DELETE FROM course WHERE id = ?').run(id)
    recordChange({
      classId: sem?.class_id ?? null,
      actorId: req.user.id,
      action: 'delete',
      entity: 'course',
      entityId: id,
      before,
    })
    res.status(204).end()
  }),
)
