// ============================================================
// ClassBoard · 访问控制路由（技术文档 4.3.7 #1-#4）
// ============================================================
import { Router } from 'express'
import { badRequest, wrap } from '../lib/errors.js'
import { disable, enable, logout, rateLimit, requireSession, verify, SESSION_COOKIE } from '../lib/access.js'

export const accessRouter = Router()

accessRouter.post(
  '/verify',
  rateLimit,
  wrap(async (req, res) => {
    const { passphrase } = req.body ?? {}
    const token = verify(passphrase)
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 3600 * 1000,
    })
    res.json({ ok: true })
  }),
)

accessRouter.post('/logout', (req, res) => {
  logout()
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.status(204).end()
})

accessRouter.post('/enable', requireSession, wrap(async (req, res) => {
  const { passphrase } = req.body ?? {}
  enable(passphrase)
  res.json({ ok: true })
}))

accessRouter.post('/disable', requireSession, wrap(async (req, res) => {
  const { passphrase } = req.body ?? {}
  if (typeof passphrase !== 'string' || !passphrase) throw badRequest('缺少口令')
  disable(passphrase)
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.json({ ok: true })
}))
