// ============================================================
// ClassBoard · 学期路由（技术文档 4.3.1 #7-#11，多用户按 user_id 隔离）
// ============================================================
import { Router } from 'express'
import { db, DEFAULT_PERIODS, getCurrentSemesterId, setCurrentSemesterId, clearCurrentSemesterId, toSemester } from '../lib/db.js'
import { badRequest, notFound } from '../lib/errors.js'
import { wrap } from '../lib/errors.js'
import { semesterRules, validateFields } from '../lib/validate.js'

export const semestersRouter = Router()

/** 创建学期：自动生成默认节次模板并设为当前学期（按用户） */
function createSemesterWithDefaults(body, userId) {
  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO semester (name, start_date, end_date, week_start_day, updated_at, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(body.name, body.startDate, body.endDate, body.weekStartDay, new Date().toISOString(), userId)
    const id = info.lastInsertRowid
    const insertPeriod = db.prepare(
      'INSERT INTO period_template (semester_id, user_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
    )
    DEFAULT_PERIODS.forEach(([start, end], i) => insertPeriod.run(id, userId, i + 1, start, end))
    setCurrentSemesterId(userId, id)
    return id
  })
  return create()
}

semestersRouter.get(
  '/',
  wrap(async (req, res) => {
    const rows = db.prepare('SELECT * FROM semester WHERE user_id = ? ORDER BY start_date ASC, id ASC').all(req.user.id)
    res.json(rows.map(toSemester))
  }),
)

semestersRouter.post(
  '/',
  wrap(async (req, res) => {
    validateFields(req.body, semesterRules())
    const exists = db.prepare('SELECT id FROM semester WHERE name = ? AND user_id = ?').get(req.body.name, req.user.id)
    if (exists) throw badRequest('学期名称已存在', [{ field: 'name', message: '学期名称已存在' }])
    const id = createSemesterWithDefaults(req.body, req.user.id)
    res.status(201).json(toSemester(db.prepare('SELECT * FROM semester WHERE id = ?').get(id)))
  }),
)

semestersRouter.put(
  '/current',
  wrap(async (req, res) => {
    const id = Number(req.body.id)
    if (!Number.isInteger(id)) throw badRequest('id 取值无效')
    const row = db.prepare('SELECT id FROM semester WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('学期不存在')
    setCurrentSemesterId(req.user.id, id)
    res.json({ currentSemesterId: id })
  }),
)

semestersRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM semester WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('学期不存在')
    validateFields(req.body, semesterRules())
    const dup = db.prepare('SELECT id FROM semester WHERE name = ? AND id != ? AND user_id = ?').get(req.body.name, id, req.user.id)
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
    const row = db.prepare('SELECT * FROM semester WHERE id = ? AND user_id = ?').get(id, req.user.id)
    if (!row) throw notFound('学期不存在')
    const del = db.transaction(() => {
      db.prepare('DELETE FROM semester WHERE id = ?').run(id)
      if (getCurrentSemesterId(req.user.id) === id) {
        const next = db.prepare('SELECT id FROM semester WHERE user_id = ? ORDER BY start_date ASC, id ASC LIMIT 1').get(req.user.id)
        if (next) setCurrentSemesterId(req.user.id, next.id)
        else clearCurrentSemesterId(req.user.id)
      }
    })
    del()
    res.status(204).end()
  }),
)
