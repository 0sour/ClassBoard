// ============================================================
// ClassBoard · 班级通知路由（负责人侧）
//   通知 = 班级通知 / 课程调整通知，由负责人手写；日期是排序键，
//   置顶优先、其余按日期倒序，一条都不隐藏。学生端在公开接口读取同一份数据。
// ============================================================
import { Router } from 'express'
import { db, toNotice } from '../lib/db.js'
import { classFromRequest, memberClass, memberCourse } from '../lib/classes.js'
import { recordChange, entitySnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { validateNotice } from '../lib/validate.js'

export const noticesRouter = Router()

/** 置顶在前，其余按日期倒序（同一天按 id 倒序）；不隐藏任何记录 */
function listOf(classId) {
  return db
    .prepare(
      `SELECT n.*, u.username AS author_name FROM notice n
        LEFT JOIN user u ON u.id = n.author_id
        WHERE n.class_id = ?
        ORDER BY n.pinned DESC, n.date DESC, n.id DESC`,
    )
    .all(classId)
    .map(toNotice)
}

noticesRouter.get(
  '/',
  wrap(async (req, res) => {
    const cls = classFromRequest(req)
    res.json(listOf(cls.id))
  }),
)

noticesRouter.post(
  '/',
  wrap(async (req, res) => {
    const cls = classFromRequest(req)
    const n = validateNotice(req.body)
    if (n.courseId !== null && !memberCourse(n.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const now = new Date().toISOString()
    const info = db
      .prepare(
        'INSERT INTO notice (class_id, date, title, body, course_id, pinned, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(cls.id, n.date, n.title, n.body, n.courseId, n.pinned ? 1 : 0, req.user.id, now, now)
    const id = info.lastInsertRowid
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'create',
      entity: 'notice',
      entityId: id,
      after: entitySnapshot('notice', id),
    })
    res.status(201).json(toNotice(db.prepare('SELECT * FROM notice WHERE id = ?').get(id)))
  }),
)

noticesRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM notice WHERE id = ?').get(id)
    const cls = row ? memberClass(row.class_id, req.user.id) : null
    if (!row || !cls) throw notFound('通知不存在')
    const n = validateNotice(req.body)
    if (n.courseId !== null && !memberCourse(n.courseId, req.user.id)) {
      throw badRequest('课程不存在', [{ field: 'courseId', message: '课程不存在' }])
    }
    const before = entitySnapshot('notice', id)
    db.prepare(
      'UPDATE notice SET date = ?, title = ?, body = ?, course_id = ?, pinned = ?, updated_at = ? WHERE id = ?',
    ).run(n.date, n.title, n.body, n.courseId, n.pinned ? 1 : 0, new Date().toISOString(), id)
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'update',
      entity: 'notice',
      entityId: id,
      before,
      after: entitySnapshot('notice', id),
    })
    res.json(toNotice(db.prepare('SELECT * FROM notice WHERE id = ?').get(id)))
  }),
)

noticesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM notice WHERE id = ?').get(id)
    const cls = row ? memberClass(row.class_id, req.user.id) : null
    if (!row || !cls) throw notFound('通知不存在')
    const before = entitySnapshot('notice', id)
    db.prepare('DELETE FROM notice WHERE id = ?').run(id)
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'delete',
      entity: 'notice',
      entityId: id,
      before,
    })
    res.status(204).end()
  }),
)
