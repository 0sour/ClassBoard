// ============================================================
// ClassBoard · 服务端集成测试（node:test + 随机端口 + 临时数据库）
// 多用户：登录拿 cookie → 带会话访问业务接口
// ============================================================
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpDir = mkdtempSync(join(tmpdir(), 'classboard-test-'))
process.env.NODE_ENV = 'test'
process.env.CLASSBOARD_DATA_DIR = tmpDir

const { app } = await import('../index.js')
const { db } = await import('../lib/db.js')
const { hashPassword } = await import('../lib/access.js')

let server
let base
let adminCookie = ''

before(async () => {
  // 迁移已创建 admin（随机密码），测试里重置为已知密码
  db.prepare('UPDATE user SET password_hash = ? WHERE username = ?').run(hashPassword('test-admin-pass'), 'admin')
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
  // 登录 admin 拿会话 cookie
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  })
  assert.equal(res.status, 200)
  const setCookie = res.headers.get('set-cookie')
  adminCookie = setCookie.split(';')[0].split('=')[1]
})

after(() => {
  server?.close()
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(async () => {
  db.exec(
    'DELETE FROM homework; DELETE FROM exam; DELETE FROM course; DELETE FROM period_template; DELETE FROM semester; DELETE FROM session; DELETE FROM user_setting;',
  )
  // 重新登录 admin（session 表被清空，旧 cookie 失效）
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  })
  const setCookie = res.headers.get('set-cookie')
  adminCookie = setCookie.split(';')[0].split('=')[1]
})

async function api(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** 带 admin 会话的请求 */
function authApi(method, path, body) {
  return api(method, path, body, { Cookie: `classboard_session=${adminCookie}` })
}

const semesterBody = { name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }

async function createSemester() {
  return authApi('POST', '/api/semesters', semesterBody)
}

test('未登录访问业务接口 → 401', async () => {
  const r = await api('GET', '/api/semesters')
  assert.equal(r.status, 401)
  assert.equal(r.body.code, 'AUTH_REQUIRED')
})

test('登录：错误密码 403、正确密码签发会话、记住我 cookie', async () => {
  const bad = await api('POST', '/api/access/login', { username: 'admin', password: 'wrong' })
  assert.equal(bad.status, 403)

  const ok = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass', remember: true }),
  })
  assert.equal(ok.status, 200)
  const setCookie = ok.headers.get('set-cookie')
  assert.ok(setCookie.includes('classboard_session='))
  assert.ok(setCookie.includes('classboard_remember='))
})

test('注册：默认关闭返回 400，开启后可注册并登录', async () => {
  const closed = await api('POST', '/api/access/register', { username: 'newuser', password: 'pass123' })
  assert.equal(closed.status, 400)

  // admin 开启注册
  const en = await authApi('PUT', '/api/users/signup', { enabled: true })
  assert.equal(en.status, 200)

  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'newuser', password: 'pass123' }),
  })
  assert.equal(reg.status, 201)
  const cookie = reg.headers.get('set-cookie').split(';')[0].split('=')[1]
  const me = await api('GET', '/api/access/me', undefined, { Cookie: `classboard_session=${cookie}` })
  assert.equal(me.body.user.username, 'newuser')
  assert.equal(me.body.user.role, 'user')

  // 重复用户名 → 400
  const dup = await api('POST', '/api/access/register', { username: 'newuser', password: 'pass123' })
  assert.equal(dup.status, 400)
})

test('创建学期自动生成默认节次模板并设为当前学期', async () => {
  const r = await createSemester()
  assert.equal(r.status, 201)
  assert.equal(r.body.weekStartDay, 1)

  const ctx = await authApi('GET', '/api/context')
  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.currentSemesterId, r.body.id)
  assert.equal(ctx.body.periods.length, 12)
  assert.equal(ctx.body.periods[0].startTime, '08:00')
  assert.equal(ctx.body.user.username, 'admin')
})

test('学期名称重复返回 400', async () => {
  await createSemester()
  const r = await authApi('POST', '/api/semesters', { ...semesterBody, name: '2026-2027学年第1学期' })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'VALIDATION_ERROR')
})

test('课程创建与列表', async () => {
  const sem = await createSemester()
  const r = await authApi('POST', '/api/courses', {
    semesterId: sem.body.id,
    type: 'course',
    name: '马克思主义基本原理',
    teacher: '焦鑫',
    location: 'C5科教中心231',
    weekType: 'odd',
    weekday: 1,
    startPeriod: 3,
    endPeriod: 4,
  })
  assert.equal(r.status, 201)
  assert.equal(r.body.name, '马克思主义基本原理')
  assert.equal(r.body.color, 'course-1')

  const list = await authApi('GET', '/api/courses')
  assert.equal(list.status, 200)
  assert.equal(list.body.length, 1)

  // 校验失败
  const bad = await authApi('POST', '/api/courses', {
    semesterId: sem.body.id,
    name: '无效课程',
    weekday: 8,
    startPeriod: 1,
    endPeriod: 2,
  })
  assert.equal(bad.status, 400)
  assert.ok(bad.body.details.some((d) => d.field === 'weekday'))
})

test('数据隔离：用户 B 看不到用户 A 的课程', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', { semesterId: sem.body.id, name: 'A的课程', weekday: 1, startPeriod: 1, endPeriod: 2, weekType: 'all' })

  // 注册用户 B 并登录
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'userb', password: 'pass123' }),
  })
  const cookieB = reg.headers.get('set-cookie').split(';')[0].split('=')[1]

  // B 的学期列表为空
  const semsB = await api('GET', '/api/semesters', undefined, { Cookie: `classboard_session=${cookieB}` })
  assert.equal(semsB.body.length, 0)
  // B 的课程列表为空
  const coursesB = await api('GET', '/api/courses', undefined, { Cookie: `classboard_session=${cookieB}` })
  assert.equal(coursesB.body.length, 0)
  // A 仍能看到自己的课程
  const coursesA = await authApi('GET', '/api/courses')
  assert.equal(coursesA.body.length, 1)
})

test('周聚合：周序号、可见性、节次时间解析', async () => {
  await createSemester()
  await authApi('POST', '/api/courses', {
    type: 'course',
    name: '单周课',
    weekType: 'odd',
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
  })
  await authApi('POST', '/api/courses', {
    type: 'course',
    name: '全部周课',
    weekType: 'all',
    weekday: 2,
    startPeriod: 5,
    endPeriod: 6,
  })

  // 2026-09-01 是周二，学期起始日 → 第 1 周（周序号 1，单周）
  const r1 = await authApi('GET', '/api/schedule?date=2026-09-01')
  assert.equal(r1.status, 200)
  assert.equal(r1.body.week.weekNumber, 1)
  assert.equal(r1.body.week.isOddWeek, true)
  const names = r1.body.courses.map((c) => c.name)
  assert.ok(names.includes('单周课'))
  assert.ok(names.includes('全部周课'))
  const allW = r1.body.courses.find((c) => c.name === '全部周课')
  assert.equal(allW.startTime, '14:00')
  assert.equal(allW.endTime, '15:40')

  // 第 2 周（双周）：单周课不可见
  const r2 = await authApi('GET', '/api/schedule?date=2026-09-08')
  assert.equal(r2.body.week.isOddWeek, false)
  const names2 = r2.body.courses.map((c) => c.name)
  assert.ok(!names2.includes('单周课'))
  assert.ok(names2.includes('全部周课'))

  // 关闭单双周过滤后单周课可见
  await authApi('PUT', '/api/settings', { showOddEvenFilter: false })
  const r3 = await authApi('GET', '/api/schedule?date=2026-09-08')
  assert.ok(r3.body.courses.map((c) => c.name).includes('单周课'))

  // 学期外日期 → 假期
  const r4 = await authApi('GET', '/api/schedule?date=2027-02-01')
  assert.equal(r4.body.week.isHoliday, true)
  assert.equal(r4.body.courses.length, 0)
})

test('导入确认：追加 / 覆盖 / 行级错误回滚', async () => {
  const sem = await createSemester()
  const rows = [
    { name: '数字信号处理', type: 'course', teacher: '陈俊如', location: 'C5科教中心217', weekType: 'all', weekList: null, weekday: 2, startPeriod: 5, endPeriod: 6, remark: '' },
    { name: '微电子器件基础', type: 'lab', teacher: '曹英男', location: 'C3敏学楼501', weekType: 'custom', weekList: [1, 3, 5], weekday: 3, startPeriod: 3, endPeriod: 4, remark: '' },
  ]

  const r = await authApi('POST', '/api/import/confirm', { mode: 'append', semesterId: sem.body.id, rows })
  assert.equal(r.status, 200)
  assert.equal(r.body.count, 2)

  // 覆盖：清空后只保留新数据
  const rows2 = [{ name: '人文地理学', type: 'course', weekday: 2, startPeriod: 9, endPeriod: 10, weekType: 'all' }]
  const r2 = await authApi('POST', '/api/import/confirm', { mode: 'overwrite', semesterId: sem.body.id, rows: rows2 })
  assert.equal(r2.status, 200)
  assert.equal(r2.body.count, 1)
  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].name, '人文地理学')

  // 错误行 → 400 且整批回滚
  const badRows = [{ name: '有效课', weekday: 1, startPeriod: 1, endPeriod: 2, weekType: 'all' }, { name: '坏课', weekday: 9, startPeriod: 1, endPeriod: 2, weekType: 'all' }]
  const r3 = await authApi('POST', '/api/import/confirm', { mode: 'append', semesterId: sem.body.id, rows: badRows })
  assert.equal(r3.status, 400)
  assert.equal(r3.body.details[0].row, 2)
  const list2 = await authApi('GET', '/api/courses')
  assert.equal(list2.body.length, 1) // 未写入任何坏数据
})

test('考试与作业 CRUD 及周聚合联动', async () => {
  const sem = await createSemester()
  const c = await authApi('POST', '/api/courses', { name: '数字信号处理', weekday: 2, startPeriod: 5, endPeriod: 6, weekType: 'all' })

  const ex = await authApi('POST', '/api/exams', { semesterId: sem.body.id, courseId: c.body.id, name: '期中', datetime: '2026-10-20T09:00' })
  assert.equal(ex.status, 201)

  const hw = await authApi('POST', '/api/homework', { semesterId: sem.body.id, courseId: c.body.id, name: '习题1', dueAt: '2026-09-10T23:59' })
  assert.equal(hw.status, 201)

  const done = await authApi('PATCH', `/api/homework/${hw.body.id}/done`, { done: true })
  assert.equal(done.body.done, true)

  const sched = await authApi('GET', '/api/schedule?date=2026-09-10')
  assert.equal(sched.body.homework.length, 1)
  assert.ok(sched.body.homework[0].done)

  // 删除课程 → 考试/作业 courseId 置空
  await authApi('DELETE', `/api/courses/${c.body.id}`)
  const exams = await authApi('GET', '/api/exams')
  assert.equal(exams.body[0].courseId, null)
})

test('备份导出与恢复', async () => {
  await createSemester()
  await authApi('POST', '/api/courses', { name: '备份课程', weekday: 1, startPeriod: 1, endPeriod: 2, weekType: 'all' })

  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(out.status, 200)
  assert.equal(payload.version, 3)
  assert.equal(payload.courses.length, 1)

  // 清空后恢复
  db.exec('DELETE FROM course; DELETE FROM semester; DELETE FROM period_template')
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  const restored = await res.json()
  assert.equal(res.status, 200)
  assert.equal(restored.restored.semesters, 1)
  assert.equal(restored.restored.courses, 1)

  // 非 JSON → 400 BAD_FILE
  const form2 = new FormData()
  form2.append('file', new Blob(['not json'], { type: 'text/plain' }), 'x.json')
  const res2 = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form2 })
  assert.equal(res2.status, 400)
  assert.equal((await res2.json()).code, 'BAD_FILE')
})

test('用户管理：admin 创建/禁用/重置密码/删除，普通用户 403', async () => {
  // 普通用户访问用户管理 → 403
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'normal', password: 'pass123' }),
  })
  const cookieN = reg.headers.get('set-cookie').split(';')[0].split('=')[1]
  const forbidden = await api('GET', '/api/users', undefined, { Cookie: `classboard_session=${cookieN}` })
  assert.equal(forbidden.status, 403)

  // admin 创建用户
  const created = await authApi('POST', '/api/users', { username: 'member', password: 'pass123', role: 'user' })
  assert.equal(created.status, 201)
  const uid = created.body.user.id

  // 禁用 → 该用户会话被撤销
  const disabled = await authApi('PUT', `/api/users/${uid}`, { disabled: true })
  assert.equal(disabled.body.user.disabled, true)

  // 重置密码
  const reset = await authApi('POST', `/api/users/${uid}/reset-password`, { password: 'newpass123' })
  assert.equal(reset.status, 200)

  // 删除
  const del = await authApi('DELETE', `/api/users/${uid}`)
  assert.equal(del.status, 204)

  // 最后一个管理员保护
  const lastAdmin = await authApi('DELETE', '/api/users/1')
  assert.equal(lastAdmin.status, 400)
})

test('会话管理：列表与撤销', async () => {
  const sessions = await authApi('GET', '/api/access/sessions')
  assert.equal(sessions.status, 200)
  assert.ok(sessions.body.sessions.length >= 1)
  const first = sessions.body.sessions[0]
  assert.ok(first.deviceName.length >= 0)
  assert.ok(first.type === 'access' || first.type === 'remember')

  // 撤销一个会话
  const revoke = await authApi('DELETE', `/api/access/sessions/${first.id}`)
  assert.equal(revoke.status, 204)
})
