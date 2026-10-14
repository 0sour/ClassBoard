// ============================================================
// ClassBoard · 学期路由（按班级隔离：班级 → 多个学期 → 课表）
//   列表/新建经 ?classId=（或 body.classId）校验班级成员身份；
//   单条操作经学期反查班级成员身份。
// ============================================================
import { Router } from 'express'
import {
  db,
  DATA_DIR,
  DEFAULT_PERIODS,
  setClassCurrentSemesterId,
  clearClassCurrentSemesterId,
  toSemester,
} from '../lib/db.js'
import { classFromRequest, memberSemester } from '../lib/classes.js'
import { recordChange, entitySnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { semesterRules, validateFields } from '../lib/validate.js'
import { createSnapshot } from '../lib/snapshot.js'

export const semestersRouter = Router()

/** 创建学期：自动生成默认节次模板并设为该班当前学期 */
function createSemesterWithDefaults(body, classId) {
  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO semester (class_id, name, start_date, end_date, week_start_day, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(classId, body.name, body.startDate, body.endDate, body.weekStartDay, new Date().toISOString())
    const id = info.lastInsertRowid
    const insertPeriod = db.prepare(
      'INSERT INTO period_template (semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?)',
    )
    DEFAULT_PERIODS.forEach(([start, end], i) => insertPeriod.run(id, i + 1, start, end))
    setClassCurrentSemesterId(classId, id)
    return id
  })
  return create()
}

semestersRouter.get(
  '/',
  wrap(async (req, res) => {
    const cls = classFromRequest(req)
    const rows = db
      .prepare('SELECT * FROM semester WHERE class_id = ? ORDER BY start_date ASC, id ASC')
      .all(cls.id)
    res.json(rows.map(toSemester))
  }),
)

semestersRouter.post(
  '/',
  wrap(async (req, res) => {
    const cls = classFromRequest(req)
    validateFields(req.body, semesterRules())
    const exists = db
      .prepare('SELECT id FROM semester WHERE name = ? AND class_id = ?')
      .get(req.body.name, cls.id)
    if (exists) throw badRequest('学期名称已存在', [{ field: 'name', message: '学期名称已存在' }])
    const id = createSemesterWithDefaults(req.body, cls.id)
    const row = db.prepare('SELECT * FROM semester WHERE id = ?').get(id)
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'create',
      entity: 'semester',
      entityId: id,
      after: entitySnapshot('semester', id),
    })
    res.status(201).json(toSemester(row))
  }),
)

semestersRouter.put(
  '/current',
  wrap(async (req, res) => {
    const id = Number(req.body.id)
    if (!Number.isInteger(id)) throw badRequest('id 取值无效')
    const row = memberSemester(id, req.user.id)
    if (!row) throw notFound('学期不存在')
    setClassCurrentSemesterId(row.class_id, id)
    res.json({ currentSemesterId: id })
  }),
)

semestersRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = memberSemester(id, req.user.id)
    if (!row) throw notFound('学期不存在')
    validateFields(req.body, semesterRules())
    const dup = db
      .prepare('SELECT id FROM semester WHERE name = ? AND id != ? AND class_id = ?')
      .get(req.body.name, id, row.class_id)
    if (dup) throw badRequest('学期名称已存在', [{ field: 'name', message: '学期名称已存在' }])
    const before = entitySnapshot('semester', id)
    db.prepare(
      `UPDATE semester SET name = ?, start_date = ?, end_date = ?, week_start_day = ?, updated_at = ?
       WHERE id = ?`,
    ).run(req.body.name, req.body.startDate, req.body.endDate, req.body.weekStartDay, new Date().toISOString(), id)
    recordChange({
      classId: row.class_id,
      actorId: req.user.id,
      action: 'update',
      entity: 'semester',
      entityId: id,
      before,
      after: entitySnapshot('semester', id),
    })
    res.json(toSemester(db.prepare('SELECT * FROM semester WHERE id = ?').get(id)))
  }),
)

semestersRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = memberSemester(id, req.user.id)
    if (!row) throw notFound('学期不存在')
    const before = entitySnapshot('semester', id)
    // 删除学期会级联清空课程/考试/作业：先做一致性快照
    const removedCourses = db
      .prepare('SELECT COUNT(*) AS n FROM course WHERE semester_id = ?')
      .get(id).n
    const snapshot = await createSnapshot(db, DATA_DIR, 'semester-delete')
    const del = db.transaction(() => {
      db.prepare('DELETE FROM semester WHERE id = ?').run(id)
      const cls = db.prepare('SELECT * FROM class WHERE id = ?').get(row.class_id)
      if (cls && cls.current_semester_id === id) {
        const next = db
          .prepare('SELECT id FROM semester WHERE class_id = ? ORDER BY start_date ASC, id ASC LIMIT 1')
          .get(row.class_id)
        if (next) setClassCurrentSemesterId(row.class_id, next.id)
        else clearClassCurrentSemesterId(row.class_id)
      }
    })
    del()
    recordChange({
      classId: row.class_id,
      actorId: req.user.id,
      action: 'delete',
      entity: 'semester',
      entityId: id,
      before,
    })
    res.json({ deletedCourses: removedCourses, snapshot })
  }),
)
