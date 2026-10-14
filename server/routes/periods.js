// ============================================================
// ClassBoard · 节次模板路由（按班级学期：班次模板随学期，归属经 semester.class_id）
// ============================================================
import { Router } from 'express'
import { db, getClassCurrentSemesterId, toPeriod } from '../lib/db.js'
import { classFromRequest, memberSemester } from '../lib/classes.js'
import { recordChange, entitySnapshot, classStateSnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { periodRules, validateFields } from '../lib/validate.js'

export const periodsRouter = Router()

/** 解析目标学期：优先 ?semesterId=，否则取 ?classId= 的当前学期 */
function resolveSemester(req) {
  if (req.query.semesterId !== undefined && req.query.semesterId !== '') {
    const row = memberSemester(Number(req.query.semesterId), req.user.id)
    if (!row) throw notFound('学期不存在')
    return row
  }
  const cls = classFromRequest(req)
  const id = getClassCurrentSemesterId(cls.id)
  if (id === null) return null
  return db.prepare('SELECT * FROM semester WHERE id = ?').get(id)
}

periodsRouter.get(
  '/',
  wrap(async (req, res) => {
    const sem = resolveSemester(req)
    if (!sem) return res.json([])
    const rows = db
      .prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
      .all(sem.id)
    res.json(rows.map(toPeriod))
  }),
)

periodsRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = Number(req.body.semesterId)
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')
    const sem = memberSemester(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    validateFields(req.body, periodRules())
    const maxIndex = db
      .prepare('SELECT COALESCE(MAX(period_index), 0) AS m FROM period_template WHERE semester_id = ?')
      .get(semesterId).m
    const info = db
      .prepare(
        'INSERT INTO period_template (semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?)',
      )
      .run(semesterId, maxIndex + 1, req.body.startTime, req.body.endTime)
    const id = info.lastInsertRowid
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'create',
      entity: 'period',
      entityId: id,
      after: entitySnapshot('period', id),
    })
    res.status(201).json(toPeriod(db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)))
  }),
)

periodsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)
    const sem = row ? memberSemester(row.semester_id, req.user.id) : null
    if (!sem) throw notFound('节次不存在')
    validateFields(req.body, periodRules())
    const before = entitySnapshot('period', id)
    db.prepare('UPDATE period_template SET start_time = ?, end_time = ? WHERE id = ?').run(
      req.body.startTime,
      req.body.endTime,
      id,
    )
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'update',
      entity: 'period',
      entityId: id,
      before,
      after: entitySnapshot('period', id),
    })
    res.json(toPeriod(db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)))
  }),
)

periodsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)
    const sem = row ? memberSemester(row.semester_id, req.user.id) : null
    if (!sem) throw notFound('节次不存在')
    const removedIndex = row.period_index

    // 受影响课程数（该节次上有课的课程组数），供前端提示
    const affectedCourses = db
      .prepare(
        `SELECT COUNT(DISTINCT cs.course_id) AS n
           FROM course_slot sl
           JOIN course_session cs ON cs.id = sl.session_id
           JOIN course c ON c.id = cs.course_id
          WHERE sl.period = ? AND c.semester_id = ?`,
      )
      .get(removedIndex, row.semester_id).n

    // 该操作会连带走期表格子（后续节次前移）：按整班状态记录，便于整体回退
    const beforeState = classStateSnapshot(sem.class_id)

    const reorder = db.transaction(() => {
      const sessionFilter = `session_id IN (
        SELECT cs.id FROM course_session cs
          JOIN course c ON c.id = cs.course_id
         WHERE c.semester_id = ?
      )`

      // 被删节次上的格子连同课程时间一起移除（节次序号已不存在）
      db.prepare(`DELETE FROM course_slot WHERE period = ? AND ${sessionFilter}`).run(removedIndex, row.semester_id)

      // 后续节次整体前移 1，保持 course_slot.period 与节次模板索引一致。
      // 按节次升序逐值更新：可证明不与 UNIQUE(session_id, period, week) 冲突
      // （最小的 p 更新为 p-1 时，p-1 ≤ removedIndex 且该值已无行占用）。
      const shifting = db
        .prepare(`SELECT DISTINCT period AS p FROM course_slot WHERE period > ? AND ${sessionFilter} ORDER BY p ASC`)
        .all(removedIndex, row.semester_id)
      const shiftOne = db.prepare(`UPDATE course_slot SET period = ? WHERE period = ? AND ${sessionFilter}`)
      for (const { p } of shifting) {
        shiftOne.run(p - 1, p, row.semester_id)
      }

      db.prepare('DELETE FROM period_template WHERE id = ?').run(id)
      const rest = db
        .prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
        .all(row.semester_id)
      const update = db.prepare('UPDATE period_template SET period_index = ? WHERE id = ?')
      rest.forEach((p, i) => update.run(i + 1, p.id))
    })
    reorder()
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'delete',
      entity: 'class_state',
      entityId: sem.class_id,
      before: beforeState,
      after: classStateSnapshot(sem.class_id),
    })
    res.json({ removedPeriod: removedIndex, affectedCourses })
  }),
)
