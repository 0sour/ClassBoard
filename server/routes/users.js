// ============================================================
// ClassBoard · 用户管理路由（admin 专属）
// 列表 / 创建 / 编辑 / 禁用启用 / 重置密码 / 删除（数据归属选择）
// 安全：最后一个管理员保护、不能操作自己、审计日志
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { hashPassword, requireAdmin, revokeAllSessions, toUser } from '../lib/access.js'

export const usersRouter = Router()

usersRouter.use(requireAdmin)

/** 审计日志（user_setting 表，key=audit_log，JSON 数组） */
function audit(adminId, action, target) {
  const row = db
    .prepare("SELECT value FROM user_setting WHERE user_id = ? AND key = 'audit_log'")
    .get(adminId)
  const list = row ? JSON.parse(row.value) : []
  list.push({ at: new Date().toISOString(), action, target })
  db.prepare(
    'INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  ).run(adminId, 'audit_log', JSON.stringify(list.slice(-200)))
}

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
    if (role !== 'admin' && role !== 'user') throw badRequest('角色取值无效')
    const exists = db.prepare('SELECT id FROM user WHERE username = ?').get(name)
    if (exists) throw badRequest('用户名已存在', [{ field: 'username', message: '用户名已存在' }])
    const info = db
      .prepare('INSERT INTO user (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(name, hashPassword(password), role, new Date().toISOString())
    audit(req.user.id, 'create_user', { id: info.lastInsertRowid, username: name, role })
    res.status(201).json({ user: toUser(db.prepare('SELECT * FROM user WHERE id = ?').get(info.lastInsertRowid)) })
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
    audit(req.user.id, 'set_signup', { enabled })
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
    if (role !== undefined && role !== 'admin' && role !== 'user') throw badRequest('角色取值无效')
    if (role !== undefined) guardLastAdmin(id, role)
    db.prepare('UPDATE user SET role = COALESCE(?, role), disabled = COALESCE(?, disabled) WHERE id = ?').run(
      role ?? null,
      typeof disabled === 'boolean' ? (disabled ? 1 : 0) : null,
      id,
    )
    if (disabled === true) revokeAllSessions(id)
    audit(req.user.id, 'update_user', { id, role, disabled })
    res.json({ user: toUser(db.prepare('SELECT * FROM user WHERE id = ?').get(id)) })
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
    audit(req.user.id, 'reset_password', { id, username: target.username })
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
    const { transferTo } = req.body ?? {}
    const del = db.transaction(() => {
      if (transferTo !== undefined && transferTo !== null) {
        const receiver = db.prepare('SELECT id FROM user WHERE id = ?').get(Number(transferTo))
        if (!receiver) throw badRequest('接收用户不存在')
        for (const t of ['semester', 'period_template', 'course', 'exam', 'homework']) {
          db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(Number(transferTo), id)
        }
      } else {
        for (const t of ['semester', 'period_template', 'course', 'exam', 'homework']) {
          db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id)
        }
      }
      db.prepare('DELETE FROM user WHERE id = ?').run(id) // session/user_setting 级联删除
    })
    del()
    audit(req.user.id, 'delete_user', { id, username: target.username, transferTo: transferTo ?? null })
    res.status(204).end()
  }),
)
