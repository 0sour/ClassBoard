// ============================================================
// ClassBoard · 注册审批路由（管理员）
//   待审核列表 / 通过 / 拒绝（可选理由）
//   拒绝后账号保留为 rejected 状态，申请人登录后能看到理由
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import { requireAdmin, toUser } from '../lib/access.js'
import { recordChange } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'

export const approvalsRouter = Router()

approvalsRouter.use(requireAdmin)

/** 待审核申请列表（可含已拒绝，便于复查） */
approvalsRouter.get(
  '/',
  wrap(async (req, res) => {
    const includeRejected = req.query.status === 'all'
    const rows = db
      .prepare(
        `SELECT * FROM user WHERE role = 'leader' AND status IN (${includeRejected ? "'pending','rejected'" : "'pending'"})
          ORDER BY created_at ASC, id ASC`,
      )
      .all()
    res.json(rows.map(toUser))
  }),
)

/** 通过：账号变为 active，可以创建 / 加入班级 */
approvalsRouter.post(
  '/:id/approve',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM user WHERE id = ?').get(id)
    if (!row || row.role !== 'leader') throw notFound('申请不存在')
    const before = toUser(row)
    db.prepare(
      "UPDATE user SET status = 'active', review_note = '', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
    ).run(req.user.id, new Date().toISOString(), id)
    const after = toUser(db.prepare('SELECT * FROM user WHERE id = ?').get(id))
    recordChange({ classId: null, actorId: req.user.id, action: 'approve', entity: 'user', entityId: id, before, after })
    res.json(after)
  }),
)

/** 拒绝：可填理由，申请人登录后能看到 */
approvalsRouter.post(
  '/:id/reject',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM user WHERE id = ?').get(id)
    if (!row || row.role !== 'leader') throw notFound('申请不存在')
    const note = String(req.body?.note ?? '').trim()
    if (note.length > 100) throw badRequest('理由长度须 ≤ 100', [{ field: 'note', message: '理由长度须 ≤ 100' }])
    const before = toUser(row)
    db.prepare(
      "UPDATE user SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
    ).run(note, req.user.id, new Date().toISOString(), id)
    const after = toUser(db.prepare('SELECT * FROM user WHERE id = ?').get(id))
    recordChange({ classId: null, actorId: req.user.id, action: 'reject', entity: 'user', entityId: id, before, after })
    res.json(after)
  }),
)
