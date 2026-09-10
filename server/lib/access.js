// ============================================================
// ClassBoard · 认证与访问控制（多用户）
// 数据库 session（token 只存 SHA-256 哈希）+ 记住我双 token + 防爆破
// 参考：Grocy 双 token 验证流程 / Vikunja token 轮换 / GitLab 撤销语义
// ============================================================
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db.js'
import { accessDenied, badRequest, rateLimited } from './errors.js'

export const SESSION_COOKIE = 'classboard_session'
export const REMEMBER_COOKIE = 'classboard_remember'
const ACCESS_TTL_MS = 7 * 24 * 3600 * 1000 // 7 天
const REMEMBER_TTL_MS = 30 * 24 * 3600 * 1000 // 30 天
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX_FAILS = 5
const LOCK_WINDOW_MS = 15 * 60 * 1000 // 锁定 15 分钟
const LOCK_MAX_FAILS = 10

// ============================================================
// 密码哈希（scrypt，格式 salt:hash hex；与旧口令哈希同构）
// ============================================================
export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt.toString('hex')}:${hash}`
}

export function verifyPassword(password, stored) {
  const [saltHex, hash] = String(stored ?? '').split(':')
  if (!saltHex || !hash) return false
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 32)
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** 防时序枚举：用户不存在时也执行一次哈希校验 */
const DUMMY_HASH = hashPassword('dummy-password-for-timing')

// ============================================================
// 会话（sessions 表，token 只存 SHA-256 哈希）
// ============================================================
function sha256(s) {
  return createHash('sha256').update(s).digest('hex')
}

function newToken() {
  return randomBytes(32).toString('hex')
}

function createSession(userId, type, deviceName, ip, ttlMs) {
  const token = newToken()
  const now = new Date()
  db.prepare(
    `INSERT INTO session (user_id, token_hash, type, device_name, ip, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    sha256(token),
    type,
    deviceName,
    ip,
    now.toISOString(),
    new Date(now.getTime() + ttlMs).toISOString(),
    now.toISOString(),
  )
  return token
}

function findSession(token, type) {
  if (!token) return null
  const row = db
    .prepare('SELECT * FROM session WHERE token_hash = ? AND type = ?')
    .get(sha256(token), type)
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM session WHERE id = ?').run(row.id)
    return null
  }
  return row
}

function touchSession(id) {
  db.prepare('UPDATE session SET last_used_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  )
}

/** 轮换 remember token（Vikunja 模式：WHERE 旧哈希原子更新，防并发重放） */
function rotateRememberToken(row) {
  const token = newToken()
  const info = db
    .prepare('UPDATE session SET token_hash = ? WHERE id = ? AND token_hash = ?')
    .run(sha256(token), row.id, row.token_hash)
  if (info.changes !== 1) return null
  return token
}

/** 撤销用户全部会话（改密码/禁用/删除时调用） */
export function revokeAllSessions(userId) {
  db.prepare('DELETE FROM session WHERE user_id = ?').run(userId)
}

/** 撤销单个会话；撤销任一会话同时撤销该用户全部 remember token（GitLab 语义） */
export function revokeSession(sessionId, userId) {
  const row = db.prepare('SELECT * FROM session WHERE id = ? AND user_id = ?').get(sessionId, userId)
  if (!row) return false
  db.prepare('DELETE FROM session WHERE id = ?').run(sessionId)
  db.prepare("DELETE FROM session WHERE user_id = ? AND type = 'remember'").run(userId)
  return true
}

/** 用户会话列表（已登录设备） */
export function listSessions(userId) {
  return db
    .prepare('SELECT * FROM session WHERE user_id = ? ORDER BY last_used_at DESC')
    .all(userId)
    .map((r) => ({
      id: r.id,
      type: r.type,
      deviceName: r.device_name,
      ip: r.ip,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      lastUsedAt: r.last_used_at,
    }))
}

// ============================================================
// 登录 / 注册 / 登出
// ============================================================

/** 登录：校验用户名密码，签发 access + 可选 remember token */
export function login(username, password, remember, deviceName, ip) {
  const user = db.prepare('SELECT * FROM user WHERE username = ?').get(username)
  if (!user) {
    verifyPassword(password, DUMMY_HASH) // 防时序枚举
    throw accessDenied('用户名或密码错误')
  }
  if (user.disabled) throw accessDenied('账号已被禁用')
  if (!verifyPassword(password, user.password_hash)) {
    throw accessDenied('用户名或密码错误')
  }
  db.prepare('UPDATE user SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id)
  const access = createSession(user.id, 'access', deviceName, ip, ACCESS_TTL_MS)
  const rememberToken = remember
    ? createSession(user.id, 'remember', deviceName, ip, REMEMBER_TTL_MS)
    : null
  return { user: toUser(user), access, remember: rememberToken }
}

/** 注册（受 allow_signup 开关控制）：创建普通用户并直接登录 */
export function register(username, password, deviceName, ip) {
  const allow = db
    .prepare("SELECT value FROM user_setting WHERE user_id = (SELECT id FROM user WHERE role = 'admin' ORDER BY id LIMIT 1) AND key = 'allow_signup'")
    .get()
  if (!allow || allow.value !== 'true') throw badRequest('注册未开放，请联系管理员创建账号')
  const exists = db.prepare('SELECT id FROM user WHERE username = ?').get(username)
  if (exists) throw badRequest('用户名已存在', [{ field: 'username', message: '用户名已存在' }])
  const info = db
    .prepare('INSERT INTO user (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(password), 'user', new Date().toISOString())
  const access = createSession(info.lastInsertRowid, 'access', deviceName, ip, ACCESS_TTL_MS)
  return { user: toUser({ id: info.lastInsertRowid, username, role: 'user' }), access, remember: null }
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM session WHERE token_hash = ? AND type = ?').run(sha256(token), 'access')
}

// ============================================================
// 中间件
// ============================================================

/** 解析当前用户（access 失效时尝试 remember 自动续签），挂到 req.user / req.sessionOk */
export function attachSession(req, res, next) {
  req.user = null
  req.sessionOk = false
  const access = req.cookies?.[SESSION_COOKIE]
  const remember = req.cookies?.[REMEMBER_COOKIE]
  const row = findSession(access, 'access')
  if (row) {
    const user = db.prepare('SELECT * FROM user WHERE id = ?').get(row.user_id)
    if (user && !user.disabled) {
      req.user = user
      req.sessionOk = true
      touchSession(row.id)
      return next()
    }
  }
  // access 失效 → 尝试 remember 自动续签（Grocy 模式）
  const rem = findSession(remember, 'remember')
  if (rem) {
    const user = db.prepare('SELECT * FROM user WHERE id = ?').get(rem.user_id)
    if (user && !user.disabled) {
      const newAccess = createSession(user.id, 'access', rem.device_name, rem.ip, ACCESS_TTL_MS)
      const rotated = rotateRememberToken(rem)
      if (rotated) {
        setSessionCookies(res, newAccess, rotated)
        req.user = user
        req.sessionOk = true
        return next()
      }
    }
  }
  next()
}

/** 会话中间件：未登录 401 AUTH_REQUIRED */
export function requireSession(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要登录' })
  }
  next()
}

/** 管理员中间件：非 admin 403 */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要登录' })
  if (req.user.role !== 'admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: '需要管理员权限' })
  }
  next()
}

/** 登录失败限速（同 IP 每分钟 5 次） */
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
    if (body && body.code === 'ACCESS_DENIED') {
      const e = failCounts.get(ip)
      const windowEnd = e && e.windowEnd > now ? e.windowEnd : now + RATE_WINDOW_MS
      const fails = e && e.windowEnd > now ? e.fails + 1 : 1
      failCounts.set(ip, { fails, windowEnd })
    }
    return original(body)
  }
  next()
}

/** 账户锁定：连续失败 10 次锁定 15 分钟（按用户名） */
const lockCounts = new Map()

export function checkLocked(username) {
  const entry = lockCounts.get(username)
  if (entry && entry.lockUntil > Date.now()) {
    throw rateLimited()
  }
}

export function recordFail(username) {
  const now = Date.now()
  const entry = lockCounts.get(username)
  const fails = entry && entry.lockUntil < now ? 0 : (entry?.fails ?? 0) + 1
  if (fails >= LOCK_MAX_FAILS) {
    lockCounts.set(username, { fails: 0, lockUntil: now + LOCK_WINDOW_MS })
  } else {
    lockCounts.set(username, { fails, lockUntil: 0 })
  }
}

export function clearFails(username) {
  lockCounts.delete(username)
}

// ============================================================
// Cookie 工具
// ============================================================

function isSecureConnection(req) {
  if (req.secure) return true
  const forwardedProto = req.headers['x-forwarded-proto']
  return typeof forwardedProto === 'string' && forwardedProto.toLowerCase() === 'https'
}

export function setSessionCookies(res, accessToken, rememberToken) {
  const secure = isSecureConnection(res.req)
  res.cookie(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: ACCESS_TTL_MS,
  })
  if (rememberToken) {
    res.cookie(REMEMBER_COOKIE, rememberToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure,
      maxAge: REMEMBER_TTL_MS,
    })
  }
}

export function clearSessionCookies(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.clearCookie(REMEMBER_COOKIE, { path: '/' })
}

/** 用户行 → API 对象（不含密码哈希） */
export function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: !!row.disabled,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}
