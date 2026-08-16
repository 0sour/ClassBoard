// ============================================================
// ClassBoard · 学期路由（技术文档 4.3.1 #7-#11）
// ============================================================
import { Router } from 'express'
import { db, DEFAULT_PERIODS, getCurrentSemesterId, setSetting, toSemester } from '../lib/db.js'
import { badRequest, notFound } from '../lib/errors.js'
import { wrap } from '../lib/errors.js'
import { semesterRules, validateFields } from '../lib/validate.js'

export const semestersRouter = Router()

/** 创建学期：自动生成默认节次模板并设为当前学期 */
function createSemesterWithDefaults(body) {
  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO semester (name, start_date, end_date, week_start_day, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(body.name, body.startDate, body.endDate, body.weekStartDay, new Date().toISOString())
    const id = info.lastInsertRowid
    const insertPeriod = db.prepare(
      'INSERT INTO period_template (semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?)',
    )
    DEFAULT_PERIODS.forEach(([start, end], i) => insertPeriod.run(id, i + 1, start, end))
    setSetting('current_semester_id', String(id))
    return id
  })
  return create()
}

semestersRouter.get(
  '/',
  wrap(async (req, res) => {
    const rows = db.prepare('SELECT * FROM semester ORDER BY start_date ASC, id ASC').all()
    res.json(rows.map(toSemester))
  }),
)

semestersRouter.post(
  '/',
  wrap(async (req, res) => {
    validateFields(req.body, semesterRules())
    const exists = db.prepare('SELECT id FROM semester WHERE name = ?').get(req.body.name)
    if (exists) throw badRequest('学期名称已存在', [{ field: 'name', message: '学期名称已存在' }])
    const id = createSemesterWithDefaults(req.body)
    res.status(201).json(toSemester(db.prepare('SELECT * FROM semester WHERE id = ?').get(id)))
  }),
)

semestersRouter.put(
  '/current',
  wrap(async (req, res) => {
    const id = Number(req.body.id)
    if (!Number.isInteger(id)) throw badRequest('id 取值无效')
    const row = db.prepare('SELECT id FROM semester WHERE id = ?').get(id)
    if (!row) throw notFound('学期不存在')
    setSetting('current_semester_id', String(id))
    res.json({ currentSemesterId: id })
  }),
)

semestersRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM semester WHERE id = ?').get(id)
    if (!row) throw notFound('学期不存在')
    validateFields(req.body, semesterRules())
    const dup = db.prepare('SELECT id FROM semester WHERE name = ? AND id != ?').get(req.body.name, id)
    if (dup) throw badRequest('学期名称已存在', [{ field: 'name', message: '学期名称已存在' }])
    db.prepare(
      `UPDATE semester SET name = ?, start_date = ?, end_date = ?, week_start_day = ?, updated_at = ?
       WHERE id = ?`,
    ).run(req.body.name, req.body.startDate, req.body.endDate, req.body.weekStartDay, new Date().toISOString(), id)
    res.json(toSemester(db.prepare('SELECT * FROM semester WHERE id = ?').get(id)))
  }),
)

semestersRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM semester WHERE id = ?').get(id)
    if (!row) throw notFound('学期不存在')
    const del = db.transaction(() => {
      db.prepare('DELETE FROM semester WHERE id = ?').run(id)
      if (getCurrentSemesterId() === id) {
        const next = db.prepare('SELECT id FROM semester ORDER BY start_date ASC, id ASC LIMIT 1').get()
        if (next) setSetting('current_semester_id', String(next.id))
        else db.prepare('DELETE FROM setting WHERE key = ?').run('current_semester_id')
      }
    })
    del()
    res.status(204).end()
  }),
)
