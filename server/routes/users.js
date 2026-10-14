// ============================================================
// ClassBoard · 用户管理路由（admin 专属）
// 列表 / 创建 / 角色与禁用 / 重置密码 / 删除
//   角色只有两类：admin（平台管理员）与 leader（班级负责人）
//   删除账号：退出其全部班级；若某个班因此没有负责人，则连同数据删除（记入变更记录，可回退）
//   操作全部写入 change_log（第 4 阶段在界面上呈现）
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { hashPassword, requireAdmin, revokeAllSessions, toUser } from '../lib/access.js'
import { classStateSnapshot, recordChange, entitySnapshot } from '../lib/changes.js'

export const usersRouter = Router()

usersRouter.use(requireAdmin)

/** 最后一个管理员保护 */
function guardLastAdmin(targetId, nextRole) {
  if (nextRole === 'admin') return
  const target = db.prepare('SELECT * FROM user WHERE id = ?').get(targetId)
  if (!target || target.role !== 'admin') return
  const admins = db.prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'admin' AND disabled = 0").get().n
  if (admins <= 1) throw badRequest('不能删除/降级最后一个管理员')
}

usersRouter.get(
  '/',
  wrap(async (req, res) => {
    const rows = db.prepare('SELECT * FROM user ORDER BY id ASC').all()
    res.json({ users: rows.map(toUser) })
  }),
)

usersRouter.post(
  '/',
  wrap(async (req, res) => {
    const { username, password, role } = req.body ?? {}
    const name = String(username ?? '').trim()
    if (!/^[\w\u4e00-\u9fa5-]{2,20}$/.test(name)) {
      throw badRequest('用户名须为 2-20 位字母/数字/中文/下划线/连字符', [{ field: 'username', message: '用户名格式无效' }])
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
      throw badRequest('密码长度须为 6-64 位', [{ field: 'password', message: '密码长度须为 6-64 位' }])
    }
    if (role !== 'admin' && role !== 'leader') throw badRequest('角色取值无效')
    const exists = db.prepare('SELECT id FROM user WHERE username = ?').get(name)
    if (exists) throw badRequest('用户名已存在', [{ field: 'username', message: '用户名已存在' }])
    const info = db
      .prepare(
        "INSERT INTO user (username, password_hash, role, status, created_at) VALUES (?, ?, ?, 'active', ?)",
      )
      .run(name, hashPassword(password), role, new Date().toISOString())
    const created = db.prepare('SELECT * FROM user WHERE id = ?').get(info.lastInsertRowid)
    recordChange({
      classId: null,
      actorId: req.user.id,
      action: 'create',
      entity: 'user',
      entityId: created.id,
      after: toUser(created),
    })
    res.status(201).json({ user: toUser(created) })
  }),
)

/** 注册开关（admin 在用户管理面板控制；须在 /:id 之前定义，避免被 :id 匹配） */
usersRouter.put(
  '/signup',
  wrap(async (req, res) => {
    const { enabled } = req.body ?? {}
    if (typeof enabled !== 'boolean') throw badRequest('enabled 须为布尔值')
    db.prepare(
      'INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
    ).run(req.user.id, 'allow_signup', String(enabled))
    res.json({ enabled })
  }),
)

usersRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const target = db.prepare('SELECT * FROM user WHERE id = ?').get(id)
    if (!target) throw notFound('用户不存在')
    if (id === req.user.id) throw badRequest('不能修改自己的账号（请在账号页操作）')
    const { role, disabled } = req.body ?? {}
    if (role !== undefined && role !== 'admin' && role !== 'leader') throw badRequest('角色取值无效')
    if (role !== undefined) guardLastAdmin(id, role)
    const before = toUser(target)
    db.prepare('UPDATE user SET role = COALESCE(?, role), disabled = COALESCE(?, disabled) WHERE id = ?').run(
      role ?? null,
      typeof disabled === 'boolean' ? (disabled ? 1 : 0) : null,
      id,
    )
    if (disabled === true) revokeAllSessions(id)
    const after = toUser(db.prepare('SELECT * FROM user WHERE id = ?').get(id))
    recordChange({
      classId: null,
      actorId: req.user.id,
      action: 'update',
      entity: 'user',
      entityId: id,
      before,
      after,
    })
    res.json({ user: after })
  }),
)

usersRouter.post(
  '/:id/reset-password',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const target = db.prepare('SELECT * FROM user WHERE id = ?').get(id)
    if (!target) throw notFound('用户不存在')
    const { password } = req.body ?? {}
    if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
      throw badRequest('密码长度须为 6-64 位')
    }
    db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
    revokeAllSessions(id) // 改密码撤销全部会话（Vikunja 模式）
    recordChange({
      classId: null,
      actorId: req.user.id,
      action: 'reset_password',
      entity: 'user',
      entityId: id,
      after: { username: target.username },
    })
    res.json({ ok: true })
  }),
)

usersRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const target = db.prepare('SELECT * FROM user WHERE id = ?').get(id)
    if (!target) throw notFound('用户不存在')
    if (id === req.user.id) throw badRequest('不能删除自己的账号')
    guardLastAdmin(id, null)

    const before = toUser(target)
    // 该用户参与的班级：先记录状态；删除账号后若某班没有负责人了，则连同数据删除
    const memberships = db.prepare('SELECT class_id FROM class_member WHERE user_id = ?').all(id).map((r) => r.class_id)
    const states = new Map(memberships.map((cid) => [cid, classStateSnapshot(cid)]))

    const del = db.transaction(() => {
      db.prepare('DELETE FROM user WHERE id = ?').run(id) // class_member / session / user_setting 级联删除
      const orphaned = []
      for (const cid of memberships) {
        const left = db.prepare('SELECT COUNT(*) AS n FROM class_member WHERE class_id = ?').get(cid).n
        if (left === 0) {
          db.prepare('DELETE FROM class WHERE id = ?').run(cid)
          orphaned.push(cid)
        }
      }
      return orphaned
    })
    const orphaned = del()

    recordChange({
      classId: null,
      actorId: req.user.id,
      action: 'delete',
      entity: 'user',
      entityId: id,
      before,
    })
    // 因删账号而消失的班级：单独留一条可回退的记录
    for (const cid of orphaned) {
      recordChange({
        classId: null,
        actorId: req.user.id,
        action: 'delete_orphan_class',
        entity: 'class_state',
        entityId: cid,
        before: states.get(cid) ?? null,
      })
    }
    res.status(204).end()
  }),
)
