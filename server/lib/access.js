// ============================================================
// ClassBoard · 访问控制（技术文档 3.2.2 / 4.3.7）
// scrypt 口令哈希 + 内存会话表 + 失败限速
// ============================================================
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { accessDenied, badRequest, rateLimited } from './errors.js'
import { getAccessHash, isAccessEnabled, setAccessHash, clearAccessHash } from './settings.js'

export const SESSION_COOKIE = 'classboard_session'
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000 // 7 天
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX_FAILS = 5

/** 内存会话表：token → 过期时间戳 */
const sessions = new Map()

function signPassphrase(passphrase, saltHex) {
  const salt = Buffer.from(saltHex, 'hex')
  return scryptSync(passphrase, salt, 32).toString('hex')
}

export function hashPassphrase(passphrase) {
  const salt = randomBytes(16)
  const hash = signPassphrase(passphrase, salt.toString('hex'))
  return `${salt.toString('hex')}:${hash}`
}

function verifyPassphrase(passphrase, stored) {
  const [saltHex, hash] = stored.split(':')
  if (!saltHex || !hash) return false
  const actual = Buffer.from(signPassphrase(passphrase, saltHex), 'hex')
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function verify(passphrase) {
  if (typeof passphrase !== 'string' || !passphrase) throw badRequest('缺少口令')
  const stored = getAccessHash()
  if (!stored) throw badRequest('访问口令未开启')
  if (!verifyPassphrase(passphrase, stored)) throw accessDenied()
  const token = randomBytes(32).toString('hex')
  sessions.set(token, Date.now() + SESSION_TTL_MS)
  return token
}

export function enable(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 4 || passphrase.length > 20) {
    throw badRequest('口令长度须为 4-20 位', [{ field: 'passphrase', message: '口令长度须为 4-20 位' }])
  }
  if (isAccessEnabled()) throw badRequest('访问口令已开启')
  setAccessHash(hashPassphrase(passphrase))
}

export function disable(passphrase) {
  const stored = getAccessHash()
  if (!stored) throw badRequest('访问口令未开启')
  if (!verifyPassphrase(passphrase, stored)) throw accessDenied('口令不一致')
  clearAccessHash()
  sessions.clear()
}

export function logout() {
  sessions.clear()
}

function isValidToken(token) {
  const exp = sessions.get(token)
  if (exp === undefined) return false
  if (exp < Date.now()) {
    sessions.delete(token)
    return false
  }
  return true
}

/** 仅标记会话状态（不拦截），供降级响应接口使用 */
export function attachSession(req, res, next) {
  req.sessionOk = false
  if (!isAccessEnabled()) {
    req.sessionOk = true
    return next()
  }
  const token = req.cookies?.[SESSION_COOKIE]
  if (token && isValidToken(token)) req.sessionOk = true
  next()
}

/** 会话中间件：口令开启时要求有效会话，否则 401 AUTH_REQUIRED */
export function requireSession(req, res, next) {
  if (!isAccessEnabled()) {
    req.sessionOk = true
    return next()
  }
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token || !isValidToken(token)) {
    return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要验证访问口令' })
  }
  req.sessionOk = true
  next()
}

/** 失败限速（同 IP 每分钟 5 次） */
const failCounts = new Map()

export function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown'
  const now = Date.now()
  const entry = failCounts.get(ip)
  if (entry && entry.windowEnd > now && entry.fails >= RATE_MAX_FAILS) {
    return res.status(429).json({ code: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' })
  }
  const original = res.json.bind(res)
  res.json = (body) => {
    if (req.path.endsWith('/verify') && body && body.code === 'ACCESS_DENIED') {
      const e = failCounts.get(ip)
      const windowEnd = e && e.windowEnd > now ? e.windowEnd : now + RATE_WINDOW_MS
      const fails = e && e.windowEnd > now ? e.fails + 1 : 1
      failCounts.set(ip, { fails, windowEnd })
    }
    return original(body)
  }
  next()
}
