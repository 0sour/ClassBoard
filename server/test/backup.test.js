// ============================================================
// ClassBoard · 导入导出 v6 收尾（P5）
//   整站导出（仅管理员）/ 两种导入模式（覆盖已有班级、作为新班级）/
//   多班级备份分组 / 旧版 v2–v5 翻译 / 不再恢复已下线的个人提醒键
// ============================================================
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpDir = mkdtempSync(join(tmpdir(), 'classboard-backup-'))
process.env.NODE_ENV = 'test'
process.env.CLASSBOARD_DATA_DIR = tmpDir

const { app } = await import('../index.js')
const { db } = await import('../lib/db.js')
const { hashPassword } = await import('../lib/access.js')

let server
let base
let adminCookie = ''
let adminClassId = null

async function api(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    cookie: res.headers.get('set-cookie')?.split(';')[0].split('=')[1] ?? null,
  }
}
const authApi = (m, p, b) => api(m, p, b, { Cookie: `classboard_session=${adminCookie}` })
const asApi = (c, m, p, b) => api(m, p, b, { Cookie: `classboard_session=${c}` })

async function download(path, cookie = adminCookie) {
  const res = await fetch(base + path, { headers: { Cookie: `classboard_session=${cookie}` } })
  const text = await res.text()
  return { status: res.status, payload: text ? JSON.parse(text) : null, disposition: res.headers.get('content-disposition') }
}

async function restoreBackup(payload, { classId, school, name } = {}, cookie = adminCookie) {
  const form = new FormData()
  if (classId !== undefined && classId !== null) form.append('classId', String(classId))
  if (school !== undefined) form.append('school', school)
  if (name !== undefined) form.append('name', name)
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', {
    method: 'POST',
    headers: { Cookie: `classboard_session=${cookie}` },
    body: form,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

async function makeApprovedLeader(username) {
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await api('POST', '/api/access/register', {
    username,
    password: 'pass123',
    school: '测试学院',
    major: '计算机科学与技术',
    className: '测试班',
  })
  assert.equal(reg.status, 201, JSON.stringify(reg.body))
  assert.equal((await authApi('POST', `/api/approvals/${reg.body.user.id}/approve`)).status, 200)
  return { cookie: reg.cookie, userId: reg.body.user.id }
}

const semesterBody = { name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }

function createSemester(over = {}, cookie = null) {
  const body = { ...semesterBody, ...over, classId: over.classId ?? adminClassId }
  return cookie ? asApi(cookie, 'POST', '/api/semesters', body) : authApi('POST', '/api/semesters', body)
}

function courseBody(semesterId, over = {}) {
  const {
    name = '数字信号处理', type = 'course', teacher = '张老师', location = 'C5科教中心217',
    color = 'course-1', remark = '', weekday = 2, periods = [5, 6], weeks = [1, 2, 3],
    classId = adminClassId,
  } = over
  return { classId, semesterId, type, name, teacher, location, color, remark, sessions: [{ weekday, location, periods, weeks }] }
}

before(async () => {
  db.prepare('UPDATE user SET password_hash = ? WHERE username = ?').run(hashPassword('test-admin-pass'), 'admin')
  db.prepare("UPDATE user SET status = 'active' WHERE username = 'admin'").run()
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
  adminCookie = res.headers.get('set-cookie').split(';')[0].split('=')[1]
  const cls = await authApi('POST', '/api/classes', { school: '测试学院', name: '测试班' })
  adminClassId = cls.body.id
})

after(() => {
  server?.close()
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(async () => {
  db.exec(
    "DELETE FROM change_log; DELETE FROM notice; DELETE FROM class_member; DELETE FROM class; " +
      "DELETE FROM session; DELETE FROM user_setting; DELETE FROM user WHERE username != 'admin';",
  )
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  })
  adminCookie = res.headers.get('set-cookie').split(';')[0].split('=')[1]
  const cls = await authApi('POST', '/api/classes', { school: '测试学院', name: '测试班' })
  adminClassId = cls.body.id
})

test('整站导出：仅管理员可用；含全部班级、全部账号与口令哈希，并明确标注', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '高等数学' }))

  const { cookie: cookieB } = await makeApprovedLeader('siteother')
  const clsB = await asApi(cookieB, 'POST', '/api/classes', { school: '测试学院', name: '另一个班' })
  const semB = await asApi(cookieB, 'POST', '/api/semesters', { ...semesterBody, classId: clsB.body.id })
  await asApi(cookieB, 'POST', '/api/courses', courseBody(semB.body.id, { name: '大学英语', classId: clsB.body.id }))

  // 负责人拿不到整站导出
  const denied = await download('/api/backup/site', cookieB)
  assert.equal(denied.status, 403)

  const { status, payload, disposition } = await download('/api/backup/site')
  assert.equal(status, 200)
  assert.equal(payload.kind, 'site')
  assert.equal(payload.includesPasswordHashes, true)
  assert.match(payload.warning, /口令哈希/)
  assert.match(disposition, /classboard-site-backup-\d{8}\.json/)

  // 两个班的数据都在（按班级分组）
  assert.equal(payload.classes.length, 2)
  const names = payload.classes.map((c) => c.name).sort()
  assert.deepEqual(names, ['另一个班', '测试班'])
  assert.equal(payload.semesters.length, 2)
  assert.deepEqual(payload.courses.map((c) => c.name).sort(), ['大学英语', '高等数学'])
  // 账号：admin + 负责人，带口令哈希（可重建登录）
  assert.equal(payload.users.length, 2)
  const adminRow = payload.users.find((u) => u.username === 'admin')
  assert.ok(adminRow.passwordHash.startsWith('scrypt$') || adminRow.passwordHash.length > 20)
  assert.equal(adminRow.role, 'admin')
  // 班级数据里不带「我的设置」，天气 Key 也不出现
  assert.equal(payload.settings, null)
  assert.ok(!JSON.stringify(payload).includes('secret-key'))

  // 管理员自己的账号导出仍然只含「我名下的班级」
  const mine = await download('/api/backup')
  assert.equal(mine.payload.classes.length, 1)
  assert.equal(mine.payload.classes[0].id, adminClassId)
})

test('导入模式一「覆盖已有班级」：清空该班后按备份重建，别的班不受影响', async () => {
  const sem = await createSemester()
  const course = await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '被覆盖的课' }))
  const backup = (await download('/api/backup')).payload

  // 再建第二个班（不该被牵连）
  const { cookie: cookieB } = await makeApprovedLeader('keepother')
  const clsB = await asApi(cookieB, 'POST', '/api/classes', { school: '测试学院', name: '保留班' })
  const semB = await asApi(cookieB, 'POST', '/api/semesters', { ...semesterBody, classId: clsB.body.id })
  await asApi(cookieB, 'POST', '/api/courses', courseBody(semB.body.id, { name: '保留的课', classId: clsB.body.id }))

  // 改一下目标班的状态，再覆盖导入回去
  await authApi('PUT', `/api/courses/${course.body.id}`, { name: '改坏了' })
  const res = await restoreBackup(backup, { classId: adminClassId })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.restored.createdClass, false)
  assert.equal(res.body.restored.classId, adminClassId)
  assert.deepEqual(res.body.restored.classes, [{ id: adminClassId, school: '测试学院', name: '测试班', created: false }])

  const courses = await authApi('GET', `/api/courses?semesterId=${sem.body.id}`)
  assert.deepEqual(courses.body.map((c) => c.name), ['被覆盖的课'])
  // 保留班一行未动
  assert.equal((await asApi(cookieB, 'GET', `/api/courses?semesterId=${semB.body.id}`)).body[0].name, '保留的课')
})

test('导入模式二「作为新班级」：用表单填的学校 + 班级名新建一个班承接', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '要搬走的课' }))
  const backup = (await download('/api/backup')).payload

  const res = await restoreBackup(backup, { school: '江南大学', name: '物联网 2301' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.restored.createdClass, true)
  assert.equal(res.body.restored.classes[0].school, '江南大学')
  assert.equal(res.body.restored.classes[0].name, '物联网 2301')

  const cls = await authApi('GET', `/api/classes/${res.body.restored.classId}`)
  assert.equal(cls.body.school, '江南大学')
  assert.equal(cls.body.name, '物联网 2301')
  const newSems = await authApi('GET', `/api/semesters?classId=${res.body.restored.classId}`)
  const courses = await authApi('GET', `/api/courses?semesterId=${newSems.body[0].id}`)
  assert.equal(courses.body[0].name, '要搬走的课', '数据落到新班')
  // 原班也还在（导入只是新建一个班）
  assert.equal((await authApi('GET', '/api/classes')).body.length, 2)

  // 学校 / 班级名不合法 → 明确报错
  const bad = await restoreBackup(backup, { school: '江', name: '班' })
  assert.equal(bad.status, 400)
  assert.match(bad.body.message, /2–40/)

  // 重名 → 提示改用覆盖模式
  const dup = await restoreBackup(backup, { school: '江南大学', name: '物联网 2301' })
  assert.equal(dup.status, 400)
  assert.match(dup.body.message, /覆盖已有班级/)
})

test('多班级备份：作为新班级导入时每个班各建一个；覆盖模式拒绝合并', async () => {
  // 造一个「两个班」的账号备份
  const { cookie: cookieB } = await makeApprovedLeader('multi')
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await api('POST', '/api/access/register', {
    username: 'multi2',
    password: 'pass123',
    school: '测试学院',
    major: '集成电路',
    className: '多班乙',
  })
  assert.equal(reg.status, 201, JSON.stringify(reg.body))
  await authApi('POST', `/api/approvals/${reg.body.user.id}/approve`)
  const multi2Cookie = reg.cookie
  // 同一个账号建两个班：直接把第二个班加入自己名下
  const c1 = await asApi(cookieB, 'POST', '/api/classes', { school: '测试学院', name: '多班甲' })
  const s1 = await asApi(cookieB, 'POST', '/api/semesters', { ...semesterBody, classId: c1.body.id })
  await asApi(cookieB, 'POST', '/api/courses', courseBody(s1.body.id, { name: '甲课', classId: c1.body.id }))
  const c2 = await asApi(multi2Cookie, 'POST', '/api/classes', { school: '测试学院', name: '多班乙' })
  const s2 = await asApi(multi2Cookie, 'POST', '/api/semesters', { ...semesterBody, classId: c2.body.id })
  await asApi(multi2Cookie, 'POST', `/api/classes/${c1.body.id}/join`)
  await asApi(multi2Cookie, 'POST', '/api/courses', courseBody(s2.body.id, { name: '乙课', classId: c2.body.id }))

  const backup = (await download('/api/backup', multi2Cookie)).payload
  assert.equal(backup.classes.length, 2, '这个账号名下有 2 个班')

  // 覆盖模式：拒绝（否则两个班会并成一个）
  const overwrite = await restoreBackup(backup, { classId: c1.body.id }, multi2Cookie)
  assert.equal(overwrite.status, 400)
  assert.match(overwrite.body.message, /合并/)

  // 作为新班级：两个班各自新建
  const res = await restoreBackup(backup, {}, multi2Cookie)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.restored.classes.length, 2)
  const created = res.body.restored.classes.map((c) => c.name).sort()
  // 原班还在 → 重名自动加「（导入）」后缀（多班备份无法逐个改名）
  assert.deepEqual(created, ['多班乙（导入）', '多班甲（导入）'])
  assert.equal(res.body.restored.courses, 2)
})

test('旧版备份翻译：v2/v3 旧课程结构与 v4/v5 缺字段都能导入', async () => {
  const sem = await createSemester()
  const semId = sem.body.id

  // v2：旧「一行一时间」课程结构（weekType/weekList），无日历 / 调整 / 班级
  const v2 = {
    version: 2,
    semesters: [{ id: semId, name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }],
    periods: [{ id: 9001, semesterId: semId, index: 1, startTime: '08:00', endTime: '08:45' }],
    courses: [
      { id: 9101, semesterId: semId, type: 'course', name: '旧版高数', teacher: '张老师', location: 'A101', color: 'course-2', remark: '', weekday: 1, startPeriod: 1, endPeriod: 1, weekType: 'odd', weekList: null },
    ],
    exams: [],
    homework: [{ id: 9201, semesterId: semId, courseId: null, name: '旧作业', dueAt: '2026-10-01', remark: '', done: false }],
    settings: { showOddEvenFilter: false, reminder: { enabled: true, mode: 'every', advanceMinutes: 5 } },
  }
  const res = await restoreBackup(v2, { school: '旧版学校', name: '旧版班' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.restored.upgradedFrom, 2)
  const newClassId = res.body.restored.classId
  // 导入到新班会重编主键（避免与原班撞车）：从新班拿学期 id
  const newSems = await authApi('GET', `/api/semesters?classId=${newClassId}`)
  const newSemId = newSems.body[0].id
  assert.notEqual(newSemId, semId, '导入到新班时重编 id（原班还在，不能撞主键）')

  const courses = await authApi('GET', `/api/courses?semesterId=${newSemId}`)
  assert.equal(courses.body[0].name, '旧版高数')
  assert.deepEqual(courses.body[0].sessions[0].periods, [1])
  const weeks = courses.body[0].sessions[0].weeks
  assert.ok(weeks.length >= 8 && weeks.every((w) => w % 2 === 1), `单周展开（实际 ${weeks.join(',')}）`)
  const hw = await authApi('GET', `/api/homework?semesterId=${newSemId}&scope=all`)
  assert.equal(hw.body[0].name, '旧作业')
  assert.equal(hw.body[0].done, undefined, '个人完成态不再存在')
  // 学期范围外/日历缺失都不影响：日历与调整按空处理
  assert.deepEqual((await authApi('GET', `/api/calendar?semesterId=${newSemId}`)).body, [])
  assert.deepEqual((await authApi('GET', `/api/adjustments?semesterId=${newSemId}`)).body, [])
  // 已下线的个人提醒键不再写回
  const keys = db.prepare('SELECT key FROM user_setting WHERE user_id = 1').all().map((r) => r.key)
  assert.ok(!keys.includes('reminder'), '导入不该复活提醒设置')
  assert.ok(!keys.includes('lab_reminder'))
  assert.ok(!keys.includes('homework_reminder'))
  assert.ok(keys.includes('show_odd_even_filter'))
  assert.equal(newClassId, adminClassId + 1)

  // v5：有日历与调整、没有 classes 字段 → 落到「作为新班级」时用表单填的名字
  const v5 = {
    version: 5,
    semesters: [{ id: semId, name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }],
    periods: [],
    courses: [
      { id: semId * 100 + 1, semesterId: semId, type: 'course', name: 'v5 课', teacher: '', location: '', color: 'course-1', remark: '', sessions: [{ weekday: 3, location: '', periods: [3, 4], weeks: [1, 2] }] },
    ],
    exams: [],
    homework: [],
    calendar: [{ semesterId: semId, date: '2026-09-29', kind: 'shift', toDate: '2026-10-10', note: '国庆调休' }],
    adjustments: [{ courseId: semId * 100 + 1, date: '2026-10-12', kind: 'cancel', fromWeekday: 1, fromPeriods: [3, 4], toDate: null, periods: [], location: '', note: '' }],
  }
  const res5 = await restoreBackup(v5, { school: '五版学校', name: '五版班' })
  assert.equal(res5.status, 200, JSON.stringify(res5.body))
  assert.equal(res5.body.restored.calendar, 1)
  assert.equal(res5.body.restored.adjustments, 1)
  assert.equal(res5.body.restored.classes[0].name, '五版班')
  const sems5 = await authApi('GET', `/api/semesters?classId=${res5.body.restored.classId}`)
  const rules = await authApi('GET', `/api/calendar?semesterId=${sems5.body[0].id}`)
  assert.equal(rules.body[0].toDate, '2026-10-10')
})

test('导入后能在变更记录里整班回退（restore 是一条整班记录）', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '原来的课' }))
  const backup = (await download('/api/backup')).payload

  await authApi('DELETE', `/api/courses/${(await authApi('GET', `/api/courses?semesterId=${sem.body.id}`)).body[0].id}`)
  const res = await restoreBackup(backup, { classId: adminClassId })
  assert.equal(res.status, 200)

  const log = await authApi('GET', `/api/classes/${adminClassId}/changes?limit=10`)
  const restoreRow = log.body.changes.find((c) => c.action === 'restore')
  assert.ok(restoreRow, '恢复操作有记录')
  assert.equal(restoreRow.entity, 'class_state')
  assert.ok(restoreRow.before.semesters !== undefined && restoreRow.after.semesters !== undefined, '前后都是整班快照')

  // 整班回退到「导入之前」→ 课程回到被删掉的状态
  const back = await authApi('POST', `/api/classes/${adminClassId}/rollback`, { changeId: restoreRow.id, before: true })
  assert.equal(back.status, 200, JSON.stringify(back.body))
  const courses = await authApi('GET', `/api/courses?semesterId=${sem.body.id}`)
  assert.deepEqual(courses.body, [], '回到导入之前（那门课已被删掉）')
})
