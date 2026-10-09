// ============================================================
// ClassBoard · 服务端集成测试（node:test + 随机端口 + 临时数据库）
// 多用户：登录拿 cookie → 带会话访问业务接口
// 课程模型：course 组 + course_session 上课时间 + course_slot 节×周格子
// ============================================================
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

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
  db.prepare('UPDATE user SET password_hash = ? WHERE username = ?').run(hashPassword('test-admin-pass'), 'admin')
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  })
  assert.equal(res.status, 200)
  adminCookie = res.headers.get('set-cookie').split(';')[0].split('=')[1]
})

after(() => {
  server?.close()
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(async () => {
  db.exec(
    'DELETE FROM homework; DELETE FROM exam; DELETE FROM course_session; DELETE FROM course; DELETE FROM period_template; DELETE FROM semester; DELETE FROM session; DELETE FROM user_setting;',
  )
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  })
  adminCookie = res.headers.get('set-cookie').split(';')[0].split('=')[1]
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

function authApi(method, path, body) {
  return api(method, path, body, { Cookie: `classboard_session=${adminCookie}` })
}

const semesterBody = { name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }

async function createSemester() {
  return authApi('POST', '/api/semesters', semesterBody)
}

/** 便捷构造：单时间段课程请求体 */
function courseBody(semesterId, over = {}) {
  const {
    name = '数字信号处理', type = 'course', teacher = '陈俊如', location = 'C5科教中心217',
    color = 'course-1', remark = '',
    weekday = 2, periods = [5, 6], weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  } = over
  return {
    semesterId, type, name, teacher, location, color, remark,
    sessions: [{ weekday, location, periods, weeks }],
  }
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

test('课程创建：节次/周次逐项落库并可回读', async () => {
  const sem = await createSemester()
  const r = await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    periods: [3, 4, 5, 6], weeks: [1, 2, 3, 4, 5, 6, 7, 8],
  }))
  assert.equal(r.status, 201)
  assert.equal(r.body.name, '数字信号处理')
  assert.equal(r.body.sessions.length, 1)
  assert.deepEqual(r.body.sessions[0].periods, [3, 4, 5, 6])
  assert.deepEqual(r.body.sessions[0].weeks, [1, 2, 3, 4, 5, 6, 7, 8])

  // 数据库层确实是逐格子
  const cells = db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n
  assert.equal(cells, 4 * 8)

  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].sessions[0].weekday, 2)
})

test('实验课：同名理论课与实验课互不覆盖，类型各自保留', async () => {
  const sem = await createSemester()
  const lab = await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '微电子器件基础', type: 'lab', teacher: '曹英男', weekday: 4, periods: [9, 10], weeks: [11, 12, 13, 14],
  }))
  assert.equal(lab.status, 201)
  assert.equal(lab.body.type, 'lab')

  const theory = await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '微电子器件基础', type: 'course', teacher: '曹英男', weekday: 2, periods: [2, 3, 4], weeks: [1, 3, 5, 7],
  }))
  assert.equal(theory.status, 201)
  assert.equal(theory.body.type, 'course')

  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 2)
  assert.deepEqual(list.body.map((c) => c.type).sort(), ['course', 'lab'])
})

test('校验失败：节次越界 / weekday 非法；空 sessions 视为无固定时间课程', async () => {
  const sem = await createSemester()
  const bad1 = await authApi('POST', '/api/courses', courseBody(sem.body.id, { periods: [1, 99] }))
  assert.equal(bad1.status, 400)

  // 空 sessions 合法：无固定时间课程（实践类）
  const noTime = await authApi('POST', '/api/courses', { semesterId: sem.body.id, name: '无时间课', sessions: [] })
  assert.equal(noTime.status, 201)
  assert.deepEqual(noTime.body.sessions, [])

  const bad3 = await authApi('POST', '/api/courses', courseBody(sem.body.id, { weekday: 8 }))
  assert.equal(bad3.status, 400)
  assert.ok(bad3.body.details.some((d) => d.field.includes('weekday')))
})
test('数据隔离：用户 B 看不到用户 A 的课程', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: 'A的课程' }))

  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'userb', password: 'pass123' }),
  })
  const cookieB = reg.headers.get('set-cookie').split(';')[0].split('=')[1]

  const semsB = await api('GET', '/api/semesters', undefined, { Cookie: `classboard_session=${cookieB}` })
  assert.equal(semsB.body.length, 0)
  const coursesB = await api('GET', '/api/courses', undefined, { Cookie: `classboard_session=${cookieB}` })
  assert.equal(coursesB.body.length, 0)
  const coursesA = await authApi('GET', '/api/courses')
  assert.equal(coursesA.body.length, 1)
})

test('周聚合：按周号取格子，单双周自然生效', async () => {
  await createSemester()
  await authApi('POST', '/api/courses', courseBody(undefined, {
    name: '单周课', weekday: 1, periods: [1, 2], weeks: [1, 3, 5, 7, 9, 11],
  }))
  await authApi('POST', '/api/courses', courseBody(undefined, {
    name: '全部周课', weekday: 2, periods: [5, 6], weeks: Array.from({ length: 16 }, (_, i) => i + 1),
  }))

  // 2026-09-01 是周二，学期起始日 → 第 1 周
  const r1 = await authApi('GET', '/api/schedule?date=2026-09-01')
  assert.equal(r1.status, 200)
  assert.equal(r1.body.week.weekNumber, 1)
  const names = r1.body.courses.map((c) => c.name)
  assert.ok(names.includes('单周课'))
  assert.ok(names.includes('全部周课'))
  const allW = r1.body.courses.find((c) => c.name === '全部周课')
  assert.equal(allW.startTime, '14:00')
  assert.equal(allW.endTime, '15:40')
  assert.deepEqual(allW.periods, [5, 6])
  assert.ok(Number.isInteger(allW.sessionId))

  // 第 2 周：单周课不可见
  const r2 = await authApi('GET', '/api/schedule?date=2026-09-08')
  const names2 = r2.body.courses.map((c) => c.name)
  assert.ok(!names2.includes('单周课'))
  assert.ok(names2.includes('全部周课'))

  // 学期外 → 假期
  const r4 = await authApi('GET', '/api/schedule?date=2027-02-01')
  assert.equal(r4.body.week.isHoliday, true)
  assert.equal(r4.body.courses.length, 0)
})

test('周聚合：实验课在指定周出现、其他周不出现', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '数字电路实验', type: 'lab', weekday: 1, periods: [7, 8], weeks: [10, 11, 12],
  }))

  // 学期起始 2026-09-01（周二）→ 第 10 周周一为 2026-11-02
  const w10 = await authApi('GET', '/api/schedule?date=2026-11-02')
  assert.equal(w10.body.week.weekNumber, 10)
  assert.equal(w10.body.courses.filter((c) => c.type === 'lab').length, 1)

  const w9 = await authApi('GET', '/api/schedule?date=2026-10-26')
  assert.equal(w9.body.week.weekNumber, 9)
  assert.equal(w9.body.courses.filter((c) => c.type === 'lab').length, 0)
})

test('课程更新：整组原子替换（旧时间不残留）', async () => {
  const sem = await createSemester()
  const created = await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    weekday: 1, periods: [1, 2], weeks: [1, 2],
  }))
  const id = created.body.id
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n, 4)

  const updated = await authApi('PUT', `/api/courses/${id}`, courseBody(sem.body.id, {
    weekday: 3, periods: [5, 6, 7], weeks: [3],
  }))
  assert.equal(updated.status, 200)
  assert.equal(updated.body.sessions.length, 1)
  assert.deepEqual(updated.body.sessions[0].periods, [5, 6, 7])
  assert.deepEqual(updated.body.sessions[0].weeks, [3])
  assert.equal(updated.body.sessions[0].weekday, 3)
  // 旧格子已被清掉
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n, 3)
})

test('导入确认：追加 / 覆盖（保留实验课选项）/ 行级错误回滚', async () => {
  const sem = await createSemester()
  const rows = [
    {
      name: '数字信号处理', type: 'course', teacher: '陈俊如', location: 'C5科教中心217',
      sessions: [{ weekday: 2, location: 'C5科教中心217', periods: [5, 6], weeks: [1, 2, 3] }],
    },
    {
      name: '微电子器件基础', type: 'lab', teacher: '曹英男', location: 'C3敏学楼501',
      sessions: [{ weekday: 3, location: 'C3敏学楼501', periods: [3, 4], weeks: [1, 3, 5] }],
    },
  ]

  const r = await authApi('POST', '/api/import/confirm', { mode: 'append', semesterId: sem.body.id, rows })
  assert.equal(r.status, 200)
  assert.equal(r.body.count, 2)

  // 覆盖但保留实验课：实验课应活下来
  const rows2 = [{
    name: '人文地理学', type: 'course', location: 'C5科教中心229',
    sessions: [{ weekday: 2, location: 'C5科教中心229', periods: [9, 10], weeks: [1, 2] }],
  }]
  const r2 = await authApi('POST', '/api/import/confirm', {
    mode: 'overwrite', semesterId: sem.body.id, rows: rows2, keepLabs: true,
  })
  assert.equal(r2.status, 200)
  assert.equal(r2.body.removed, 2)
  assert.equal(r2.body.keptLabs, 1)
  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 2)
  assert.ok(list.body.some((c) => c.type === 'lab' && c.name === '微电子器件基础'))
  const namesAfter = list.body.map((c) => c.name)
  assert.ok(namesAfter.includes('人文地理学'))
  assert.ok(!namesAfter.includes('数字信号处理'))

  // 错误行 → 400 且整批回滚
  const badRows = [
    { name: '有效课', sessions: [{ weekday: 1, periods: [1, 2], weeks: [1] }] },
    { name: '坏课', sessions: [{ weekday: 9, periods: [1, 2], weeks: [1] }] },
  ]
  const r3 = await authApi('POST', '/api/import/confirm', { mode: 'append', semesterId: sem.body.id, rows: badRows })
  assert.equal(r3.status, 400)
  assert.equal(r3.body.details[0].row, 2)
  const list2 = await authApi('GET', '/api/courses')
  assert.equal(list2.body.length, 2)
})

test('导入覆盖前自动生成快照', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '待清空课' }))
  const snapshotExists = () => {
    try {
      return readdirSync(join(tmpDir, 'snapshots')).length
    } catch {
      return 0
    }
  }
  const before = snapshotExists()

  const rows = [{ name: '新课', sessions: [{ weekday: 1, periods: [1], weeks: [1] }] }]
  const r = await authApi('POST', '/api/import/confirm', { mode: 'overwrite', semesterId: sem.body.id, rows })
  assert.equal(r.status, 200)
  assert.ok(snapshotExists() > before, '覆盖导入应生成快照')

  // 快照可读且包含清空前的课程
  const snapPath = join(tmpDir, 'snapshots', r.body.snapshot.split(/[\\/]/).pop())
  const snap = new Database(snapPath, { readonly: true })
  const n = snap.prepare('SELECT COUNT(*) AS n FROM course').get().n
  assert.equal(n, 1)
  snap.close()
})

test('考试与作业 CRUD 及周聚合联动', async () => {
  const sem = await createSemester()
  const c = await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '数字信号处理' }))

  const ex = await authApi('POST', '/api/exams', { semesterId: sem.body.id, courseId: c.body.id, name: '期中', datetime: '2026-10-20T09:00' })
  assert.equal(ex.status, 201)

  const hw = await authApi('POST', '/api/homework', { semesterId: sem.body.id, courseId: c.body.id, name: '习题1', dueAt: '2026-09-10T23:59' })
  assert.equal(hw.status, 201)

  const done = await authApi('PATCH', `/api/homework/${hw.body.id}/done`, { done: true })
  assert.equal(done.body.done, true)

  const sched = await authApi('GET', '/api/schedule?date=2026-09-10')
  assert.equal(sched.body.homework.length, 1)
  assert.ok(sched.body.homework[0].done)

  await authApi('DELETE', `/api/courses/${c.body.id}`)
  const exams = await authApi('GET', '/api/exams')
  assert.equal(exams.body[0].courseId, null)
})

test('备份导出 v4 与恢复；天气 Key 脱敏', async () => {
  await createSemester()
  await authApi('POST', '/api/courses', courseBody(undefined, {
    name: '备份课程', type: 'lab', weekday: 1, periods: [1, 2], weeks: [1, 2, 3],
  }))
  await authApi('PUT', '/api/settings', { weather: { enabled: true, apiKey: 'secret-key-12345678', location: '信阳' } })

  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(out.status, 200)
  assert.equal(payload.version, 4)
  assert.equal(payload.courses.length, 1)
  assert.deepEqual(payload.courses[0].sessions[0].periods, [1, 2])
  assert.deepEqual(payload.courses[0].sessions[0].weeks, [1, 2, 3])
  assert.ok(!payload.settings.weather.apiKey.includes('secret-key'), 'API Key 不应明文导出')
  assert.ok(payload.settings.weather.apiKey.endsWith('5678'))

  // 清空后恢复
  db.exec('DELETE FROM course_session; DELETE FROM course; DELETE FROM semester; DELETE FROM period_template')
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  const restored = await res.json()
  assert.equal(res.status, 200)
  assert.equal(restored.restored.semesters, 1)
  assert.equal(restored.restored.courses, 1)

  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].type, 'lab')
  assert.deepEqual(list.body[0].sessions[0].weeks, [1, 2, 3])

  // 非 JSON → 400 BAD_FILE
  const form2 = new FormData()
  form2.append('file', new Blob(['not json'], { type: 'text/plain' }), 'x.json')
  const res2 = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form2 })
  assert.equal(res2.status, 400)
  assert.equal((await res2.json()).code, 'BAD_FILE')
})

test('恢复：非 admin 被拒（403）', async () => {
  await createSemester()
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'normal2', password: 'pass123' }),
  })
  const cookieN = reg.headers.get('set-cookie').split(';')[0].split('=')[1]

  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${cookieN}` }, body: form })
  assert.equal(res.status, 403)
})

test('恢复隔离：admin 恢复不影响其他用户的数据', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: 'admin的课' }))

  // 用户 B 建自己的课
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'userb2', password: 'pass123' }),
  })
  const cookieB = reg.headers.get('set-cookie').split(';')[0].split('=')[1]
  const semB = await api('POST', '/api/semesters', {
    name: 'B的学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1,
  }, { Cookie: `classboard_session=${cookieB}` })
  await api('POST', '/api/courses', courseBody(semB.body.id, { name: 'B的课' }), { Cookie: `classboard_session=${cookieB}` })

  // admin 导出（只含自己的）后恢复
  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(payload.courses.length, 1)
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 200)

  // B 的数据必须还在
  const coursesB = await api('GET', '/api/courses', undefined, { Cookie: `classboard_session=${cookieB}` })
  assert.equal(coursesB.body.length, 1)
  assert.equal(coursesB.body[0].name, 'B的课')
})

test('恢复：损坏的课程行整批拒绝（不再静默丢弃）', async () => {
  await createSemester()
  const bad = {
    version: 4,
    semesters: [{ id: 1, name: 'S', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }],
    periods: [],
    courses: [
      { id: 1, semesterId: 1, type: 'course', name: '好课', sessions: [{ weekday: 1, periods: [1], weeks: [1] }] },
      { id: 2, semesterId: 1, type: 'course', name: '坏课', sessions: [{ weekday: 99, periods: [1], weeks: [1] }] },
    ],
    exams: [], homework: [], settings: {}, templates: [],
  }
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(bad)], { type: 'application/json' }), 'bad.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'BAD_FILE')
  // 原有数据未被清空
  const sems = await authApi('GET', '/api/semesters')
  assert.equal(sems.body.length, 1)
})

test('恢复：v3 旧备份自动升级（weekType/weekList 展开）', async () => {
  const legacy = {
    version: 3,
    semesters: [{ id: 10, name: '旧学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }],
    periods: [],
    courses: [
      {
        id: 100, semesterId: 10, type: 'lab', name: '数字电路实验', teacher: '陈刚', location: '实验楼B103',
        color: 'course-2', weekType: 'even', weekList: null, weekday: 1, startPeriod: 7, endPeriod: 8, remark: '',
      },
    ],
    exams: [], homework: [], settings: {}, templates: [],
  }
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(legacy)], { type: 'application/json' }), 'v3.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  const body = await res.json()
  assert.equal(res.status, 200, JSON.stringify(body))
  assert.equal(body.restored.upgradedFrom, 3)

  // 当前学期被旧备份替换为「旧学期」→ 查询需指定该学期
  const list = await authApi('GET', '/api/courses?semesterId=10')
  assert.equal(list.body.length, 1)
  const c = list.body[0]
  assert.equal(c.type, 'lab')
  assert.deepEqual(c.sessions[0].periods, [7, 8])
  // 双周：学期约 20 周 → 偶数周
  assert.ok(c.sessions[0].weeks.every((w) => w % 2 === 0))
  assert.ok(c.sessions[0].weeks.length >= 9)
})

test('恢复：当前学期指针不悬空（还原后课表不为空）', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '还原前就有' }))

  // 导出（v4 备份携带 currentSemesterId）后还原
  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(payload.currentSemesterId, sem.body.id, '备份应携带当前学期指向')
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 200)

  // 不带 semesterId 查询：应仍指向备份中的当前学期，而非空数组
  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 1, '还原后当前学期指针不应悬空导致课表空白')
  assert.equal(list.body[0].name, '还原前就有')
})

test('恢复：旧备份未携带当前学期指向时，回退到备份内第一个学期', async () => {
  const legacy = {
    version: 3,
    semesters: [
      { id: 30, name: '旧学期甲', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 },
      { id: 31, name: '旧学期乙', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 },
    ],
    periods: [],
    courses: [
      { id: 300, semesterId: 30, type: 'course', name: '甲课', teacher: '', location: '', color: 'course-1', weekType: 'all', weekList: null, weekday: 1, startPeriod: 1, endPeriod: 2, remark: '' },
      { id: 301, semesterId: 31, type: 'course', name: '乙课', teacher: '', location: '', color: 'course-2', weekType: 'all', weekList: null, weekday: 2, startPeriod: 1, endPeriod: 2, remark: '' },
    ],
    exams: [], homework: [], settings: {}, templates: [],
  }
  const form = new FormData()
  form.append('file', new Blob([JSON.stringify(legacy)], { type: 'application/json' }), 'v3.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 200)

  // 无 semesterId 查询应落到第一个学期（甲），而不是空数组
  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].name, '甲课')
})

test('模板：去重键含类型与完整节次/周次（同名实验课不被跳过）', async () => {
  const sem = await createSemester()
  // 已有同名理论课，同星期同节次
  await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '微电子器件基础', type: 'course', weekday: 2, periods: [2, 3], weeks: [1, 3, 5],
  }))

  const tpl = await authApi('POST', '/api/templates', {
    kind: 'course', name: '器件实验模板', category: '测试', description: '',
    content: [{
      name: '微电子器件基础', type: 'lab', teacher: '曹英男', location: '实验楼',
      sessions: [{ weekday: 2, location: '实验楼', periods: [2, 3], weeks: [1, 3, 5] }],
    }],
  })
  assert.equal(tpl.status, 201)

  const imp = await authApi('POST', `/api/templates/${tpl.body.template.id}/import`, {
    semesterId: sem.body.id, mode: 'dedupe',
  })
  assert.equal(imp.status, 200)
  assert.equal(imp.body.count, 1, '同名同时间的实验课不应被判重复而跳过')
  assert.equal(imp.body.skipped, 0)

  // 再导一次同样的 → 这次才是真重复
  const imp2 = await authApi('POST', `/api/templates/${tpl.body.template.id}/import`, {
    semesterId: sem.body.id, mode: 'dedupe',
  })
  assert.equal(imp2.body.count, 0)
  assert.equal(imp2.body.skipped, 1)
})

test('模板：导入旧格式内容自动升级', async () => {
  const sem = await createSemester()
  const created = await authApi('POST', '/api/templates', {
    kind: 'course', name: '旧格式模板', category: '', description: '',
    content: [{
      type: 'course', name: '马克思主义基本原理', teacher: '焦鑫', location: 'C5科教中心231',
      weekType: 'custom', weekList: [1, 2, 3], weekday: 3, startPeriod: 1, endPeriod: 2, remark: '',
    }],
  })
  // 旧格式应被规范化保存
  assert.equal(created.status, 201)
  const content = created.body.template.content
  assert.ok(Array.isArray(content[0].sessions))
  assert.deepEqual(content[0].sessions[0].periods, [1, 2])
  assert.deepEqual(content[0].sessions[0].weeks, [1, 2, 3])

  const imp = await authApi('POST', `/api/templates/${created.body.template.id}/import`, {
    semesterId: sem.body.id, mode: 'append',
  })
  assert.equal(imp.body.count, 1)
})

// ============================================================
// 存储格式适配回归：模板/导入对 sessions 空值与周次上限的处理
// ============================================================
test('模板：无固定时间课程（sessions 为空）可存为模板并导入', async () => {
  const sem = await createSemester()
  // 「从学期另存」场景：内容含一门无固定时间的实践课
  const created = await authApi('POST', '/api/templates', {
    kind: 'course', name: '实践课模板', category: '', description: '',
    content: [{
      type: 'course', name: '集成电路设计综合实践', teacher: '徐馨', location: '', remark: '共 16 周', sessions: [],
    }],
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.deepEqual(created.body.template.content[0].sessions, [])

  // 导入后应仍然是无固定时间课程（sessions 为空，出现在「实践与其他」）
  const imp = await authApi('POST', `/api/templates/${created.body.template.id}/import`, {
    semesterId: sem.body.id, mode: 'append',
  })
  assert.equal(imp.status, 200)
  assert.equal(imp.body.count, 1)
  const list = await authApi('GET', '/api/courses')
  const practice = list.body.find((c) => c.name === '集成电路设计综合实践')
  assert.ok(practice, '实践课应成功导入')
  assert.deepEqual(practice.sessions, [])

  // 组合模板（unit）快照路径同样允许空 sessions
  const unit = await authApi('POST', '/api/templates', {
    kind: 'unit', name: '含实践课组合', category: '', description: '',
    content: [{ type: 'course', name: '劳动实践', teacher: '', location: '', remark: '', sessions: [] }],
  })
  assert.equal(unit.status, 201, JSON.stringify(unit.body))

  // 学期聚合：无固定时间课程不应出现在周网格块中
  const sched = await authApi('GET', '/api/schedule?date=2026-09-08')
  assert.ok(!sched.body.courses.some((c) => c.name === '集成电路设计综合实践'))
})

test('模板：周次上限随目标学期（不再固定 16 周）', async () => {
  // 20 周学期（2026-09-01 ~ 2027-01-25 约 21 周）
  const sem = await authApi('POST', '/api/semesters', {
    name: '长学期', startDate: '2026-09-01', endDate: '2027-01-25', weekStartDay: 1,
  })
  const weeks20 = Array.from({ length: 20 }, (_, i) => i + 1)

  // 20 周的课程应能存为模板（此前被固定 16 周上限拒绝）
  const created = await authApi('POST', '/api/templates', {
    kind: 'course', name: '全学期模板', category: '', description: '',
    content: [{
      type: 'course', name: '全学期课', teacher: '', location: '',
      sessions: [{ weekday: 1, location: '', periods: [1, 2], weeks: weeks20 }],
    }],
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.deepEqual(created.body.template.content[0].sessions[0].weeks, weeks20)

  // 导入到该学期
  const imp = await authApi('POST', `/api/templates/${created.body.template.id}/import`, {
    semesterId: sem.body.id, mode: 'append',
  })
  assert.equal(imp.status, 200, JSON.stringify(imp.body))
  assert.equal(imp.body.count, 1)
  const list = await authApi('GET', `/api/courses?semesterId=${sem.body.id}`)
  assert.deepEqual(list.body[0].sessions[0].weeks, weeks20)

  // 模板本身无目标学期，采用全局上限 30 周；超出仍应被拒
  const tooLong = await authApi('POST', '/api/templates', {
    kind: 'course', name: '超长模板', category: '', description: '',
    content: [{
      type: 'course', name: '超范围课', teacher: '', location: '',
      sessions: [{ weekday: 1, location: '', periods: [1], weeks: [1, 31] }],
    }],
  })
  assert.equal(tooLong.status, 400)

  // 但导入到该学期时，超出该学期周数（21 周）的应被拒
  const tpl = await authApi('POST', '/api/templates', {
    kind: 'course', name: '跨学期超范围模板', category: '', description: '',
    content: [{
      type: 'course', name: '超学期课', teacher: '', location: '',
      sessions: [{ weekday: 1, location: '', periods: [1], weeks: [1, 25] }],
    }],
  })
  assert.equal(tpl.status, 201)
  const overImport = await authApi('POST', `/api/templates/${tpl.body.template.id}/import`, {
    semesterId: sem.body.id, mode: 'append',
  })
  assert.equal(overImport.status, 400, '导入时周次超出目标学期应被拒')
})

test('导入：未指定颜色时按 8 色轮询分配（不再全部落 course-1）', async () => {
  const sem = await createSemester()
  // 刻意不传 color，模拟直接调用 API / 第三方导入
  const rows = [1, 2, 3].map((i) => ({
    name: `课${i}`, type: 'course', teacher: '', location: '',
    sessions: [{ weekday: 1, location: '', periods: [i], weeks: [1, 2] }],
  }))
  const r = await authApi('POST', '/api/import/confirm', { mode: 'append', semesterId: sem.body.id, rows })
  assert.equal(r.status, 200)

  const list = await authApi('GET', '/api/courses')
  const colors = list.body.map((c) => `${c.name}=${c.color}`).sort()
  assert.deepEqual(colors, ['课1=course-1', '课2=course-2', '课3=course-3'])

  // 同名课程复用已有颜色，不占用新的轮询序号（不传 color，交由服务端分配）
  await authApi('POST', '/api/courses', {
    semesterId: sem.body.id, type: 'course', name: '课1', teacher: '', location: '', remark: '',
    sessions: [{ weekday: 2, location: '', periods: [5], weeks: [1] }],
  })
  // 新课继续轮询到 course-4
  await authApi('POST', '/api/courses', {
    semesterId: sem.body.id, type: 'course', name: '新课X', teacher: '', location: '', remark: '',
    sessions: [{ weekday: 3, location: '', periods: [5], weeks: [1] }],
  })
  const list2 = await authApi('GET', '/api/courses')
  const same = list2.body.filter((c) => c.name === '课1')
  assert.equal(same.length, 2)
  assert.ok(same.every((c) => c.color === 'course-1'), '同名应复用已有颜色')
  // 轮询基准为「该学期已有课程数」：导入 3 门 + 新增「课1」= 4 → 下一门取 course-5
  assert.equal(list2.body.find((c) => c.name === '新课X').color, 'course-5', '新课程应继续轮询')

  // 显式提供的合法颜色应被尊重（PDF 导入时前端已算好颜色）
  await authApi('POST', '/api/import/confirm', {
    mode: 'append', semesterId: sem.body.id,
    rows: [{ name: '指定色课', type: 'course', location: '', color: 'course-6',
      sessions: [{ weekday: 4, location: '', periods: [1], weeks: [1] }] }],
  })
  const list3 = await authApi('GET', '/api/courses')
  assert.equal(list3.body.find((c) => c.name === '指定色课').color, 'course-6')
})

test('模板：组合模板引用展开的课程也允许无固定时间', async () => {
  const sem = await createSemester()
  const course = await authApi('POST', '/api/templates', {
    kind: 'course', name: '单课模板', category: '', description: '',
    content: [{ type: 'course', name: '形势与政策', teacher: '崔锦文', location: '', remark: '', sessions: [] }],
  })
  const unit = await authApi('POST', '/api/templates', {
    kind: 'unit', name: '引用型组合', category: '', description: '',
    content: [course.body.template.id],
  })
  assert.equal(unit.status, 201)

  const imp = await authApi('POST', `/api/templates/${unit.body.template.id}/import`, {
    semesterId: sem.body.id, mode: 'append',
  })
  assert.equal(imp.status, 200, JSON.stringify(imp.body))
  assert.equal(imp.body.count, 1)
  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body[0].name, '形势与政策')
  assert.deepEqual(list.body[0].sessions, [])
})

test('学期删除：级联清空并返回删除数量与快照', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '将被删的课' }))
  const del = await authApi('DELETE', `/api/semesters/${sem.body.id}`)
  assert.equal(del.status, 200)
  assert.equal(del.body.deletedCourses, 1)
  const list = await authApi('GET', '/api/courses')
  assert.equal(list.body.length, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_session').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n, 0)
})

test('用户管理：admin 创建/禁用/重置密码/删除，普通用户 403', async () => {
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'normal', password: 'pass123' }),
  })
  const cookieN = reg.headers.get('set-cookie').split(';')[0].split('=')[1]
  const forbidden = await api('GET', '/api/users', undefined, { Cookie: `classboard_session=${cookieN}` })
  assert.equal(forbidden.status, 403)

  const created = await authApi('POST', '/api/users', { username: 'member', password: 'pass123', role: 'user' })
  assert.equal(created.status, 201)
  const uid = created.body.user.id

  const disabled = await authApi('PUT', `/api/users/${uid}`, { disabled: true })
  assert.equal(disabled.body.user.disabled, true)

  const reset = await authApi('POST', `/api/users/${uid}/reset-password`, { password: 'newpass123' })
  assert.equal(reset.status, 200)

  const del = await authApi('DELETE', `/api/users/${uid}`)
  assert.equal(del.status, 204)

  const lastAdmin = await authApi('DELETE', '/api/users/1')
  assert.equal(lastAdmin.status, 400)
})

// ============================================================
// 本次修复的回归用例
// ============================================================
test('天气设置：非 admin 读到脱敏 Key、写入被拒 403；admin 可读写', async () => {
  // admin 写入真实 Key
  const put = await authApi('PUT', '/api/settings', {
    weather: { enabled: true, apiKey: 'real-secret-abcdefgh', location: '信阳' },
  })
  assert.equal(put.status, 200)
  assert.equal(put.body.weather.apiKey, 'real-secret-abcdefgh')

  // 注册普通用户
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await fetch(base + '/api/access/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'weatheruser', password: 'pass123' }),
  })
  const cookieU = reg.headers.get('set-cookie').split(';')[0].split('=')[1]

  // 读取：拿到的是脱敏值，不能含明文
  const got = await api('GET', '/api/settings', undefined, { Cookie: `classboard_session=${cookieU}` })
  assert.equal(got.status, 200)
  assert.ok(!String(got.body.weather.apiKey).includes('real-secret'), '普通用户不应读到明文 Key')
  assert.ok(String(got.body.weather.apiKey).endsWith('efgh'))

  // 写入：403
  const forbidden = await api('PUT', '/api/settings', {
    weather: { enabled: false, apiKey: 'hacked', location: '北京' },
  }, { Cookie: `classboard_session=${cookieU}` })
  assert.equal(forbidden.status, 403)

  // 库中真实 Key 未被改动
  const after = await authApi('GET', '/api/settings')
  assert.equal(after.body.weather.apiKey, 'real-secret-abcdefgh')

  // 普通用户回传脱敏值时（如保存提醒设置顺带带上 weather），不应把真实 Key 覆盖成星号
  const keepMasked = await api('PUT', '/api/settings', {
    reminder: { enabled: true, mode: 'every', advanceMinutes: 10 },
  }, { Cookie: `classboard_session=${cookieU}` })
  assert.equal(keepMasked.status, 200)
  const stillReal = await authApi('GET', '/api/settings')
  assert.equal(stillReal.body.weather.apiKey, 'real-secret-abcdefgh')

  // 管理员回传脱敏值也应保留原 Key（前端表单原样回填场景）
  await authApi('PUT', '/api/settings', {
    weather: { enabled: true, apiKey: got.body.weather.apiKey, location: '信阳' },
  })
  const adminAfter = await authApi('GET', '/api/settings')
  assert.equal(adminAfter.body.weather.apiKey, 'real-secret-abcdefgh')
})

test('删除节次：级联清理该节次的课程格子，后续节次前移（课表不错位）', async () => {
  const sem = await createSemester()
  // 12 节默认模板；课程占第 2..4 节与第 10 节
  await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '跨节课程', weekday: 1, periods: [2, 3, 4], weeks: [1, 2],
  }))
  await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '晚课', weekday: 2, periods: [10], weeks: [1],
  }))

  const periods = await authApi('GET', '/api/periods')
  const target = periods.body.find((p) => p.index === 3) // 删除第 3 节

  const del = await authApi('DELETE', `/api/periods/${target.id}`)
  assert.equal(del.status, 200)
  assert.equal(del.body.removedPeriod, 3)
  assert.equal(del.body.affectedCourses, 1, '仅跨节课程在第 3 节有课')

  // 节次模板重排为 1..11
  const after = await authApi('GET', '/api/periods')
  assert.equal(after.body.length, 11)
  assert.deepEqual(after.body.map((p) => p.index), Array.from({ length: 11 }, (_, i) => i + 1))

  // 跨节课程：原 [2,3,4] 移除第 3 节 → 剩 [2,4]，且第 4 节前移为第 3 节 → [2,3]
  const list = await authApi('GET', '/api/courses')
  const cross = list.body.find((c) => c.name === '跨节课程')
  assert.deepEqual(cross.sessions[0].periods, [2, 3])

  // 第 10 节前移为第 9 节
  const late = list.body.find((c) => c.name === '晚课')
  assert.deepEqual(late.sessions[0].periods, [9])

  // 直接查库核对格子（无残留第 10 节）
  const maxPeriod = db.prepare('SELECT MAX(period) AS m FROM course_slot').get().m
  assert.equal(maxPeriod, 9)
  const stray = db.prepare('SELECT COUNT(*) AS n FROM course_slot WHERE period = 10').get().n
  assert.equal(stray, 0)
})

test('周聚合：块的 allPeriods 与 startPeriod/endPeriod 不随周次跳变', async () => {
  const sem = await createSemester()
  // 课程占第 3..6 节，但只在第 1 周与第 2 周的周二上课（第 3 周起不上）
  await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '跨节课程', weekday: 2, periods: [3, 4, 5, 6], weeks: [1, 2],
  }))

  const w1 = await authApi('GET', '/api/schedule?date=2026-09-01') // 第 1 周
  const w3 = await authApi('GET', '/api/schedule?date=2026-09-15') // 第 3 周
  assert.equal(w1.body.week.weekNumber, 1)
  assert.equal(w3.body.week.weekNumber, 3)

  const b1 = w1.body.courses.find((c) => c.name === '跨节课程')
  assert.ok(b1, '第 1 周应返回该课')
  assert.deepEqual(b1.periods, [3, 4, 5, 6])
  assert.deepEqual(b1.allPeriods, [3, 4, 5, 6])
  assert.equal(b1.startPeriod, 3)
  assert.equal(b1.endPeriod, 6)

  // 第 3 周该课不上课 → 服务端不返回该块（按周过滤），说明 allPeriods 不会退化为空
  assert.ok(!w3.body.courses.some((c) => c.name === '跨节课程'))

  // 同一课程在"部分周次"场景下：只上 1 周的短课，allPeriods 仍为该 session 的完整节次
  await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '短课', weekday: 3, periods: [7, 8], weeks: [2],
  }))
  const w2 = await authApi('GET', '/api/schedule?date=2026-09-08')
  const b2 = w2.body.courses.find((c) => c.name === '短课')
  assert.deepEqual(b2.allPeriods, [7, 8])
})

test('周聚合：未开学（早于起始日）与假期（晚于结束日）语义区分', async () => {
  await createSemester() // 2026-09-01 ~ 2027-01-15

  // 早于起始日 → 未开学
  const before = await authApi('GET', '/api/schedule?date=2026-08-20')
  assert.equal(before.body.week.isBeforeSemester, true)
  assert.equal(before.body.week.isHoliday, false)
  assert.equal(before.body.week.weekNumber, null)
  assert.equal(before.body.courses.length, 0)

  // 晚于结束日 → 假期
  const holiday = await authApi('GET', '/api/schedule?date=2027-02-01')
  assert.equal(holiday.body.week.isBeforeSemester, false)
  assert.equal(holiday.body.week.isHoliday, true)

  // 学期内 → 正常周号，两个标志都为 false
  const inside = await authApi('GET', '/api/schedule?date=2026-09-08')
  assert.equal(inside.body.week.isBeforeSemester, false)
  assert.equal(inside.body.week.isHoliday, false)
  assert.equal(inside.body.week.weekNumber, 2)
})

test('会话管理：列表与撤销', async () => {
  const sessions = await authApi('GET', '/api/access/sessions')
  assert.equal(sessions.status, 200)
  assert.ok(sessions.body.sessions.length >= 1)
  const first = sessions.body.sessions[0]
  assert.ok(first.type === 'access' || first.type === 'remember')

  const revoke = await authApi('DELETE', `/api/access/sessions/${first.id}`)
  assert.equal(revoke.status, 204)
})

// ============================================================
// 迁移测试：独立临时库，模拟旧模型（含 week_type 列）后跑迁移
// ============================================================
test('迁移：旧模型课程行 → 组 + sessions，实验课不丢、关联重定向', async () => {
  const migDir = mkdtempSync(join(tmpdir(), 'classboard-migrate-'))
  // 手工建旧模型库
  const legacy = new Database(join(migDir, 'classboard.db'))
  legacy.exec(`
    CREATE TABLE semester (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date TEXT NOT NULL, week_start_day INTEGER NOT NULL CHECK (week_start_day IN (1,7)),
      updated_at TEXT NOT NULL, user_id INTEGER, UNIQUE (name, user_id)
    );
    CREATE TABLE period_template (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
      period_index INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      user_id INTEGER, UNIQUE (semester_id, period_index)
    );
    CREATE TABLE course (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('course','lab')), name TEXT NOT NULL,
      teacher TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'course-1',
      week_type TEXT NOT NULL CHECK (week_type IN ('all','odd','even','custom')),
      week_list TEXT, weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      start_period INTEGER NOT NULL, end_period INTEGER NOT NULL,
      remark TEXT NOT NULL DEFAULT '', user_id INTEGER
    );
    CREATE TABLE exam (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
      name TEXT NOT NULL, datetime TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '', user_id INTEGER
    );
    CREATE TABLE homework (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES course(id) ON DELETE SET NULL,
      name TEXT NOT NULL, due_at TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '', user_id INTEGER
    );
    CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE user (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT
    );
    CREATE TABLE session (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK (type IN ('access','remember')),
      device_name TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT NOT NULL
    );
    CREATE TABLE user_setting (
      user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key)
    );
    INSERT INTO semester (id, name, start_date, end_date, week_start_day, updated_at, user_id)
      VALUES (1, '迁移学期', '2026-09-01', '2027-01-10', 1, '2026-09-01T00:00:00Z', 1);
    INSERT INTO user (id, username, password_hash, role, created_at) VALUES (1, 'admin', 'x:y', 'admin', '2026-09-01T00:00:00Z');
    -- 理论课 2 行（同名同教师 → 合并为 1 组 2 个上课时间）
    INSERT INTO course (semester_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark, user_id)
      VALUES (1, 'course', '马克思主义基本原理', '焦鑫', 'C5科教中心231', 'course-1', 'odd', NULL, 1, 3, 4, '', 1);
    INSERT INTO course (semester_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark, user_id)
      VALUES (1, 'course', '马克思主义基本原理', '焦鑫', 'C5科教中心231', 'course-1', 'custom', '[1,2,3,4,5,6,7,8,10,12,14,16]', 3, 1, 2, '', 1);
    -- 实验课 3 行（同名同类型 → 合并为 1 组 1 个上课时间，周次并集）
    INSERT INTO course (semester_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark, user_id)
      VALUES (1, 'lab', '数字信号处理', '陈俊如', '实验楼B103', 'course-2', 'custom', '[11]', 4, 9, 10, '', 1);
    INSERT INTO course (semester_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark, user_id)
      VALUES (1, 'lab', '数字信号处理', '陈俊如', '实验楼B103', 'course-2', 'custom', '[12]', 4, 9, 10, '', 1);
    INSERT INTO course (semester_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark, user_id)
      VALUES (1, 'lab', '数字信号处理', '陈俊如', '实验楼B103', 'course-2', 'custom', '[13,14]', 4, 9, 10, '', 1);
    INSERT INTO exam (semester_id, course_id, name, datetime, user_id) VALUES (1, 4, '实验理论考试', '2026-12-01T09:00', 1);
    INSERT INTO homework (semester_id, course_id, name, due_at, user_id) VALUES (1, 4, '实验报告', '2026-12-02T23:59', 1);
  `)
  legacy.close()

  // 在新进程中加载 db.js 触发迁移
  const { execFileSync } = await import('node:child_process')
  const { pathToFileURL } = await import('node:url')
  const dbUrl = pathToFileURL(join(process.cwd(), 'lib', 'db.js')).href
  const script = `
    const m = await import(${JSON.stringify(dbUrl)});
    const db = m.db;
    const out = {
      courses: db.prepare('SELECT COUNT(*) AS n FROM course').get().n,
      labs: db.prepare("SELECT COUNT(*) AS n FROM course WHERE type='lab'").get().n,
      sessions: db.prepare('SELECT COUNT(*) AS n FROM course_session').get().n,
      cells: db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n,
      examCourse: db.prepare('SELECT course_id FROM exam').get().course_id,
      hwCourse: db.prepare('SELECT course_id FROM homework').get().course_id,
      labWeeks: (() => {
        const c = db.prepare("SELECT id FROM course WHERE type='lab'").get();
        const s = db.prepare('SELECT id FROM course_session WHERE course_id=?').get(c.id);
        return db.prepare('SELECT DISTINCT week FROM course_slot WHERE session_id=? ORDER BY week').all(s.id).map(r=>r.week);
      })(),
      theorySessions: (() => {
        const c = db.prepare("SELECT id FROM course WHERE type='course'").get();
        return db.prepare('SELECT COUNT(*) AS n FROM course_session WHERE course_id=?').get(c.id).n;
      })(),
    };
    console.log(JSON.stringify(out));
  `
  const res = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CLASSBOARD_DATA_DIR: migDir },
    encoding: 'utf8',
  })
  const out = JSON.parse(res.trim().split('\n').pop())
  assert.equal(out.courses, 2, '理论课 1 组 + 实验课 1 组')
  assert.equal(out.labs, 1)
  assert.equal(out.theorySessions, 2)
  assert.equal(out.sessions, 3)
  assert.deepEqual(out.labWeeks, [11, 12, 13, 14])
  // 关联指向合并后的实验课组
  assert.ok(out.examCourse !== null)
  assert.equal(out.examCourse, out.hwCourse)

  rmSync(migDir, { recursive: true, force: true })
})
