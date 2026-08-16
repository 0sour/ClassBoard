// ============================================================
// ClassBoard · 节次模板路由（技术文档 4.3.1 #12-#15）
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toPeriod } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { periodRules, validateFields } from '../lib/validate.js'

export const periodsRouter = Router()

function resolveSemesterId(query) {
  if (query.semesterId !== undefined) return Number(query.semesterId)
  return getCurrentSemesterId()
}

periodsRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.query)
    if (semesterId === null) return res.json([])
    const sem = db.prepare('SELECT id FROM semester WHERE id = ?').get(semesterId)
    if (!sem) throw notFound('学期不存在')
    const rows = db.prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC').all(semesterId)
    res.json(rows.map(toPeriod))
  }),
)

periodsRouter.post(
  '/',
  wrap(async (req, res) => {
    const semesterId = Number(req.body.semesterId)
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')
    const sem = db.prepare('SELECT id FROM semester WHERE id = ?').get(semesterId)
    if (!sem) throw notFound('学期不存在')
    validateFields(req.body, periodRules())
    const maxIndex = db
      .prepare('SELECT COALESCE(MAX(period_index), 0) AS m FROM period_template WHERE semester_id = ?')
      .get(semesterId).m
    const info = db
      .prepare('INSERT INTO period_template (semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?)')
      .run(semesterId, maxIndex + 1, req.body.startTime, req.body.endTime)
    res.status(201).json(toPeriod(db.prepare('SELECT * FROM period_template WHERE id = ?').get(info.lastInsertRowid)))
  }),
)

periodsRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)
    if (!row) throw notFound('节次不存在')
    validateFields(req.body, periodRules())
    db.prepare('UPDATE period_template SET start_time = ?, end_time = ? WHERE id = ?').run(
      req.body.startTime,
      req.body.endTime,
      id,
    )
    res.json(toPeriod(db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)))
  }),
)

periodsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)
    if (!row) throw notFound('节次不存在')
    const reorder = db.transaction(() => {
      db.prepare('DELETE FROM period_template WHERE id = ?').run(id)
      const rest = db.prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC').all(row.semester_id)
      const update = db.prepare('UPDATE period_template SET period_index = ? WHERE id = ?')
      rest.forEach((p, i) => update.run(i + 1, p.id))
    })
    reorder()
    res.status(204).end()
  }),
)
