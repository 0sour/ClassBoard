// ============================================================
// ClassBoard · 认证路由（多用户）
// 登录 / 注册（开关控制）/ 登出 / 当前用户 / 会话管理
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import { badRequest, wrap } from '../lib/errors.js'
import {
  checkLocked,
  clearFails,
  clearSessionCookies,
  listSessions,
  login,
  logout,
  rateLimit,
  recordFail,
  register,
  requireSession,
  revokeSession,
  setSessionCookies,
  SESSION_COOKIE,
  toUser,
} from '../lib/access.js'

export const accessRouter = Router()

/** 解析 UA → 设备名（浏览器 on 系统，仅展示用） */
function deviceNameOf(ua) {
  const s = String(ua ?? '')
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : '浏览器'
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '未知系统'
  return `${browser} on ${os}`
}

accessRouter.post(
  '/login',
  rateLimit,
  wrap(async (req, res) => {
    const { username, password, remember } = req.body ?? {}
    if (typeof username !== 'string' || !username.trim()) throw badRequest('请输入用户名')
    if (typeof password !== 'string' || !password) throw badRequest('请输入密码')
    checkLocked(username.trim())
    try {
      const { user, access, remember: rememberToken } = login(
        username.trim(),
        password,
        !!remember,
        deviceNameOf(req.headers['user-agent']),
        req.ip ?? '',
      )
      clearFails(username.trim())
      setSessionCookies(res, access, rememberToken)
      res.json({ ok: true, user: toUser(user) })
    } catch (e) {
      recordFail(username.trim())
      throw e
    }
  }),
)

accessRouter.post(
  '/register',
  rateLimit,
  wrap(async (req, res) => {
    const { username, password } = req.body ?? {}
    const name = String(username ?? '').trim()
    if (!/^[\w\u4e00-\u9fa5-]{2,20}$/.test(name)) {
      throw badRequest('用户名须为 2-20 位字母/数字/中文/下划线/连字符', [{ field: 'username', message: '用户名格式无效' }])
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
      throw badRequest('密码长度须为 6-64 位', [{ field: 'password', message: '密码长度须为 6-64 位' }])
    }
    const { user, access } = register(name, password, deviceNameOf(req.headers['user-agent']), req.ip ?? '')
    setSessionCookies(res, access, null)
    res.status(201).json({ ok: true, user: toUser(user) })
  }),
)

accessRouter.post('/logout', (req, res) => {
  logout(req.cookies?.[SESSION_COOKIE])
  clearSessionCookies(res)
  res.status(204).end()
})

/** 当前用户（登录页/App 启动时调用） */
accessRouter.get(
  '/me',
  wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要登录' })
    res.json({ user: toUser(req.user) })
  }),
)

/** 注册开关状态（登录页判断是否显示注册入口） */
accessRouter.get(
  '/signup-enabled',
  wrap(async (req, res) => {
    const row = db
      .prepare("SELECT value FROM user_setting WHERE user_id = (SELECT id FROM user WHERE role = 'admin' ORDER BY id LIMIT 1) AND key = 'allow_signup'")
      .get()
    res.json({ enabled: row?.value === 'true' })
  }),
)

/** 已登录设备列表（当前用户） */
accessRouter.get(
  '/sessions',
  requireSession,
  wrap(async (req, res) => {
    res.json({ sessions: listSessions(req.user.id) })
  }),
)

/** 撤销单个会话（连带撤销该用户全部 remember token） */
accessRouter.delete(
  '/sessions/:id',
  requireSession,
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('id 取值无效')
    if (!revokeSession(id, req.user.id)) throw badRequest('会话不存在')
    res.status(204).end()
  }),
)
