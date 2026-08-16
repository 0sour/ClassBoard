// ============================================================
// ClassBoard · 服务端集成测试（node:test + 随机端口 + 临时数据库）
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

let server
let base

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
})

after(() => {
  server?.close()
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.exec(
    'DELETE FROM homework; DELETE FROM exam; DELETE FROM course; DELETE FROM period_template; DELETE FROM semester; DELETE FROM setting;',
  )
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

const semesterBody = { name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }

async function createSemester() {
  return api('POST', '/api/semesters', semesterBody)
}

test('创建学期自动生成默认节次模板并设为当前学期', async () => {
  const r = await createSemester()
  assert.equal(r.status, 201)
  assert.equal(r.body.weekStartDay, 1)

  const ctx = await api('GET', '/api/context')
  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.currentSemesterId, r.body.id)
  assert.equal(ctx.body.periods.length, 12)
  assert.equal(ctx.body.periods[0].startTime, '08:00')
  assert.equal(ctx.body.settings.accessEnabled, false)
})

test('学期名称重复返回 400', async () => {
  await createSemester()
  const r = await api('POST', '/api/semesters', { ...semesterBody, name: '2026-2027学年第1学期' })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'VALIDATION_ERROR')
})

test('课程创建与列表', async () => {
  const sem = await createSemester()
  const r = await api('POST', '/api/courses', {
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

  const list = await api('GET', '/api/courses')
  assert.equal(list.status, 200)
  assert.equal(list.body.length, 1)

  // 校验失败
  const bad = await api('POST', '/api/courses', {
    semesterId: sem.body.id,
    name: '无效课程',
    weekday: 8,
    startPeriod: 1,
    endPeriod: 2,
  })
  assert.equal(bad.status, 400)
  assert.ok(bad.body.details.some((d) => d.field === 'weekday'))
})

test('周聚合：周序号、可见性、节次时间解析', async () => {
  await createSemester()
  await api('POST', '/api/courses', {
    type: 'course',
    name: '单周课',
    weekType: 'odd',
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
  })
  await api('POST', '/api/courses', {
    type: 'course',
    name: '全部周课',
    weekType: 'all',
    weekday: 2,
    startPeriod: 5,
    endPeriod: 6,
  })

  // 2026-09-01 是周二，学期起始日 → 第 1 周（周序号 1，单周）
  const r1 = await api('GET', '/api/schedule?date=2026-09-01')
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
  const r2 = await api('GET', '/api/schedule?date=2026-09-08')
  assert.equal(r2.body.week.isOddWeek, false)
  const names2 = r2.body.courses.map((c) => c.name)
  assert.ok(!names2.includes('单周课'))
  assert.ok(names2.includes('全部周课'))

  // 关闭单双周过滤后单周课可见
  await api('PUT', '/api/settings', { showOddEvenFilter: false })
  const r3 = await api('GET', '/api/schedule?date=2026-09-08')
  assert.ok(r3.body.courses.map((c) => c.name).includes('单周课'))

  // 学期外日期 → 假期
  const r4 = await api('GET', '/api/schedule?date=2027-02-01')
  assert.equal(r4.body.week.isHoliday, true)
  assert.equal(r4.body.courses.length, 0)
})

test('导入确认：追加 / 覆盖 / 行级错误回滚', async () => {
  const sem = await createSemester()
  const rows = [
    { name: '数字信号处理', type: 'course', teacher: '陈俊如', location: 'C5科教中心217', weekType: 'all', weekList: null, weekday: 2, startPeriod: 5, endPeriod: 6, remark: '' },
    { name: '微电子器件基础', type: 'lab', teacher: '曹英男', location: 'C3敏学楼501', weekType: 'custom', weekList: [1, 3, 5], weekday: 3, startPeriod: 3, endPeriod: 4, remark: '' },
  ]

  const r = await api('POST', '/api/import/confirm', { mode: 'append', semesterId: sem.body.id, rows })
  assert.equal(r.status, 200)
  assert.equal(r.body.count, 2)

  // 覆盖：清空后只保留新数据
  const rows2 = [{ name: '人文地理学', type: 'course', weekday: 2, startPeriod: 9, endPeriod: 10, weekType: 'all' }]
  const r2 = await api('POST', '/api/import/confirm', { mode: 'overwrite', semesterId: sem.body.id, rows: rows2 })
  assert.equal(r2.status, 200)
  assert.equal(r2.body.count, 1)
  const list = await api('GET', '/api/courses')
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].name, '人文地理学')

  // 错误行 → 400 且整批回滚
  const badRows = [{ name: '有效课', weekday: 1, startPeriod: 1, endPeriod: 2, weekType: 'all' }, { name: '坏课', weekday: 9, startPeriod: 1, endPeriod: 2, weekType: 'all' }]
  const r3 = await api('POST', '/api/import/confirm', { mode: 'append', semesterId: sem.body.id, rows: badRows })
  assert.equal(r3.status, 400)
  assert.equal(r3.body.details[0].row, 2)
  const list2 = await api('GET', '/api/courses')
  assert.equal(list2.body.length, 1) // 未写入任何坏数据
})

test('考试与作业 CRUD 及周聚合联动', async () => {
  const sem = await createSemester()
  const c = await api('POST', '/api/courses', { name: '数字信号处理', weekday: 2, startPeriod: 5, endPeriod: 6, weekType: 'all' })

  const ex = await api('POST', '/api/exams', { semesterId: sem.body.id, courseId: c.body.id, name: '期中', datetime: '2026-10-20T09:00' })
  assert.equal(ex.status, 201)

  const hw = await api('POST', '/api/homework', { semesterId: sem.body.id, courseId: c.body.id, name: '习题1', dueAt: '2026-09-10T23:59' })
  assert.equal(hw.status, 201)

  const done = await api('PATCH', `/api/homework/${hw.body.id}/done`, { done: true })
  assert.equal(done.body.done, true)

  const sched = await api('GET', '/api/schedule?date=2026-09-10')
  assert.equal(sched.body.homework.length, 1)
  assert.ok(sched.body.homework[0].done)

  // 删除课程 → 考试/作业 courseId 置空
  await api('DELETE', `/api/courses/${c.body.id}`)
  const exams = await api('GET', '/api/exams')
  assert.equal(exams.body[0].courseId, null)
})

test('备份导出与恢复', async () => {
  await createSemester()
  await api('POST', '/api/courses', { name: '备份课程', weekday: 1, startPeriod: 1, endPeriod: 2, weekType: 'all' })

  const out = await fetch(base + '/api/backup')
  const payload = await out.json()
  assert.equal(out.status, 200)
  assert.equal(payload.version, 2)
  assert.equal(payload.courses.length, 1)
  assert.equal(payload.settings.accessEnabled, undefined) // 不含口令等设置结构

  // 清空后恢复
  db.exec('DELETE FROM course; DELETE FROM semester; DELETE FROM period_template')
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', body: form })
  const restored = await res.json()
  assert.equal(res.status, 200)
  assert.equal(restored.restored.semesters, 1)
  assert.equal(restored.restored.courses, 1)

  // 非 JSON → 400 BAD_FILE
  const form2 = new FormData()
  form2.append('file', new Blob(['not json'], { type: 'text/plain' }), 'x.json')
  const res2 = await fetch(base + '/api/backup/restore', { method: 'POST', body: form2 })
  assert.equal(res2.status, 400)
  assert.equal((await res2.json()).code, 'BAD_FILE')
})

test('访问口令：开启后业务接口要求会话', async () => {
  const en = await api('POST', '/api/access/enable', { passphrase: 'test1234' })
  assert.equal(en.status, 200)

  // 未登录访问业务接口 → 401
  const denied = await api('GET', '/api/semesters')
  assert.equal(denied.status, 401)
  assert.equal(denied.body.code, 'AUTH_REQUIRED')

  // context 降级响应
  const ctx = await api('GET', '/api/context')
  assert.equal(ctx.body.accessRequired, true)

  // 错误口令 → 403
  const bad = await api('POST', '/api/access/verify', { passphrase: 'wrong' })
  assert.equal(bad.status, 403)

  // 正确口令 → 签发会话
  const ok = await api('POST', '/api/access/verify', { passphrase: 'test1234' })
  assert.equal(ok.status, 200)
  const cookie = ok.body.cookie
  void cookie
  // 服务端内存会话在测试中难以直接复用 fetch cookie 容器，用 set-cookie 头验证
  const res = await fetch(base + '/api/access/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'test1234' }),
  })
  const setCookie = res.headers.get('set-cookie')
  assert.ok(setCookie && setCookie.includes('classboard_session='))

  // 带会话访问成功
  const token = setCookie.split(';')[0].split('=')[1]
  const sem = await fetch(base + '/api/semesters', { headers: { Cookie: `classboard_session=${token}` } })
  assert.equal(sem.status, 200)

  // 关闭口令（需携带会话）
  const dis = await fetch(base + '/api/access/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `classboard_session=${token}` },
    body: JSON.stringify({ passphrase: 'test1234' }),
  })
  assert.equal(dis.status, 200)
})
