// ============================================================
// ClassBoard · 作业路由（按班级学期归属）
//   作业 = 班级公示内容：负责人添加、可关联课程，截止前对所有人生效；
//   没有个人完成态（P2 起 done 字段已删除，「已截止」只是按时间分组）。
// ============================================================
import { Router } from 'express'
import { db, getClassCurrentSemesterId, toHomework } from '../lib/db.js'
import { classFromRequest, memberCourse, memberSemester } from '../lib/classes.js'
import { recordChange, entitySnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { validateHomework } from '../lib/validate.js'
import { attachmentsOf } from '../lib/attachments.js'

export const homeworkRouter = Router()

function resolveSemesterId(value, req) {
  if (value !== undefined && value !== null && value !== '') return Number(value)
  const cls = classFromRequest(req)
  return getClassCurrentSemesterId(cls.id)
}

homeworkRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.query.semesterId, req)
    if (semesterId === null) return res.json([])
    const sem = memberSemester(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    // scope=upcoming 只取未截止（公开页「待交」用）；缺省返回全量（「已截止」历史用）
    let sql = 'SELECT * FROM homework WHERE semester_id = ?'
    const params = [semesterId]
    if (req.query.scope === 'upcoming') {
      sql += ' AND due_at >= ?'
      params.push(new Date().toISOString().slice(0, 16))
    } else if (req.query.scope !== undefined && req.query.scope !== 'all') {
      throw badRequest('scope 取值无效')
    }
    sql += ' ORDER BY due_at ASC, id ASC'
    res.json(db.prepare(sql).all(...params).map((r) => ({ ...toHomework(r), attachments: attachmentsOf('homework', r.id) })))
  }),
)

homeworkRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.body.semesterId, req)
    if (semesterId === null || !Number.isInteger(semesterId)) {
      throw badRequest('未设置当前学期，请先创建或切换学期')
    }
    const sem = memberSemester(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    const h = validateHomework(req.body)
    if (h.courseId !== null && !memberCourse(h.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const info = db
      .prepare('INSERT INTO homework (semester_id, course_id, name, due_at, remark) VALUES (?, ?, ?, ?, ?)')
      .run(semesterId, h.courseId, h.name, h.dueAt, h.remark)
    const id = info.lastInsertRowid
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'create',
      entity: 'homework',
      entityId: id,
      after: entitySnapshot('homework', id),
    })
    res.status(201).json({ ...toHomework(db.prepare('SELECT * FROM homework WHERE id = ?').get(id)), attachments: [] })
  }),
)

homeworkRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM homework WHERE id = ?').get(id)
    const sem = row ? memberSemester(row.semester_id, req.user.id) : null
    if (!row || !sem) throw notFound('作业不存在')
    const h = validateHomework(req.body)
    if (h.courseId !== null && !memberCourse(h.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const before = entitySnapshot('homework', id)
    db.prepare('UPDATE homework SET course_id = ?, name = ?, due_at = ?, remark = ? WHERE id = ?').run(
      h.courseId, h.name, h.dueAt, h.remark, id,
    )
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'update',
      entity: 'homework',
      entityId: id,
      before,
      after: entitySnapshot('homework', id),
    })
    res.json({ ...toHomework(db.prepare('SELECT * FROM homework WHERE id = ?').get(id)), attachments: attachmentsOf('homework', id) })
  }),
)

homeworkRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM homework WHERE id = ?').get(id)
    const sem = row ? memberSemester(row.semester_id, req.user.id) : null
    if (!row || !sem) throw notFound('作业不存在')
    const before = entitySnapshot('homework', id)
    db.prepare('DELETE FROM homework WHERE id = ?').run(id)
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'delete',
      entity: 'homework',
      entityId: id,
      before,
    })
    res.status(204).end()
  }),
)
