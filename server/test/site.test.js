// ============================================================
// ClassBoard · 站点页脚与访问统计测试
//   页脚配置为全站共享（管理员写）；访问统计落独立 stats.db，不碰主库
// ============================================================
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpDir = mkdtempSync(join(tmpdir(), 'classboard-site-test-'))
process.env.NODE_ENV = 'test'
process.env.CLASSBOARD_DATA_DIR = tmpDir

const { app } = await import('../index.js')
const { db } = await import('../lib/db.js')
const { hashPassword } = await import('../lib/access.js')

let server
let base
let adminCookie = ''
let leaderCookie = ''

async function login(username, password) {
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  assert.equal(res.status, 200, await res.text())
  return res.headers.get('set-cookie').split(';')[0]
}

async function api(method, path, body, cookie = '') {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

before(async () => {
  db.prepare('UPDATE user SET password_hash = ? WHERE username = ?').run(hashPassword('site-admin-pass'), 'admin')
  db.prepare("UPDATE user SET status = 'active' WHERE username = 'admin'").run()
  db.prepare(
    `INSERT INTO user (username, password_hash, role, status, created_at)
     VALUES (?, ?, 'leader', 'active', ?)`,
  ).run('site-leader', hashPassword('site-leader-pass'), new Date().toISOString())
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
  adminCookie = await login('admin', 'site-admin-pass')
  leaderCookie = await login('site-leader', 'site-leader-pass')
})

after(() => {
  server?.close()
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

test('公开站点页脚默认全空，且不创建统计库', async () => {
  const r = await api('GET', '/api/public/site')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { footerText: '', icp: '', policeIcp: '', showVisits: false })
  assert.equal(existsSync(join(tmpDir, 'stats.db')), false)
})

test('管理员可保存页脚配置，公开接口立即可读', async () => {
  const r = await api(
    'PUT',
    '/api/settings',
    { site: { footerText: '由示例班维护', icp: '示例ICP备00000000号-1', policeIcp: '', showVisits: true } },
    adminCookie,
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.site.icp, '示例ICP备00000000号-1')

  const pub = await api('GET', '/api/public/site')
  assert.deepEqual(pub.body, {
    footerText: '由示例班维护',
    icp: '示例ICP备00000000号-1',
    policeIcp: '',
    showVisits: true,
  })
})

test('非管理员不能修改站点配置', async () => {
  const r = await api('PUT', '/api/settings', { site: { icp: '越权' } }, leaderCookie)
  assert.equal(r.status, 403)
})

test('关闭统计时 POST /visit 不计数、不创建统计库', async () => {
  await api('PUT', '/api/settings', { site: { showVisits: false } }, adminCookie)
  const r = await api('POST', '/api/public/visit')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { today: 0, total: 0 })
  assert.equal(existsSync(join(tmpDir, 'stats.db')), false)
})

test('开启统计后访问累加，数据落独立 stats.db 且主库不变', async () => {
  await api('PUT', '/api/settings', { site: { showVisits: true } }, adminCookie)
  const first = await api('POST', '/api/public/visit')
  assert.equal(first.status, 200)
  assert.equal(first.body.today, 1)
  assert.equal(first.body.total, 1)

  const second = await api('POST', '/api/public/visit')
  assert.equal(second.body.today, 2)
  assert.equal(second.body.total, 2)

  const stats = await api('GET', '/api/public/stats')
  assert.deepEqual(stats.body, { today: 2, total: 2 })
  assert.equal(existsSync(join(tmpDir, 'stats.db')), true)

  // 主库没有多出统计表；访问计数不写 classboard.db
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  assert.equal(tables.includes('visit_day'), false)
})
