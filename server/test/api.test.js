// ============================================================
// ClassBoard · 服务端集成测试（node:test + 随机端口 + 临时数据库）
// 班级平台：管理员 / 班级负责人（注册需审批）；数据归属「班级 → 学期 → 课表」
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
/** 管理员自己的班级（每个用例重置后重建） */
let adminClassId = null

/** 登录管理员并刷新 adminCookie */
async function loginAdmin() {
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  })
  assert.equal(res.status, 200)
  adminCookie = res.headers.get('set-cookie').split(';')[0].split('=')[1]
}

/** 管理员建一个自己的班级（后续用例的默认归属） */
async function createAdminClass(school = '测试学院', name = '测试班') {
  const r = await authApi('POST', '/api/classes', { school, name })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  adminClassId = r.body.id
  return r.body
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
  await loginAdmin()
  await createAdminClass()
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
  await loginAdmin()
  await createAdminClass()
})

async function api(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get('set-cookie')?.split(';')[0].split('=')[1] ?? null }
}

function authApi(method, path, body) {
  return api(method, path, body, { Cookie: `classboard_session=${adminCookie}` })
}

/** 以某个负责人的身份请求 */
function asApi(cookie, method, path, body) {
  return api(method, path, body, { Cookie: `classboard_session=${cookie}` })
}

/** 注册班级负责人（提交学校 / 专业 / 班级名供审核）；返回 cookie（未审批前仍可登录看状态） */
async function registerLeader(username, { school = '测试学院', major = '集成电路设计与集成系统', className = '测试班' } = {}) {
  return api('POST', '/api/access/register', { username, password: 'pass123', school, major, className })
}

/** 管理员审批通过 */
async function approveLeader(id) {
  const r = await authApi('POST', `/api/approvals/${id}/approve`)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

/** 一站式：注册 + 审批通过，返回 cookie 与 userId */
async function makeApprovedLeader(username, opts = {}) {
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await registerLeader(username, opts)
  assert.equal(reg.status, 201, JSON.stringify(reg.body))
  await approveLeader(reg.body.user.id)
  return { cookie: reg.cookie, userId: reg.body.user.id }
}

/** 该负责人建班（学校 + 班级名） */
async function createClassAs(cookie, school, name) {
  const r = await asApi(cookie, 'POST', '/api/classes', { school, name })
  return r
}

const semesterBody = { name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }

/** 默认在管理员的班级下建学期 */
async function createSemester(over = {}) {
  return authApi('POST', '/api/semesters', { ...semesterBody, ...over, classId: over.classId ?? adminClassId })
}

/** 便捷构造：单时间段课程请求体（默认落在管理员的班级） */
function courseBody(semesterId, over = {}) {
  const {
    name = '数字信号处理', type = 'course', teacher = '陈俊如', location = 'C5科教中心217',
    color = 'course-1', remark = '',
    weekday = 2, periods = [5, 6], weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    classId = adminClassId,
  } = over
  return {
    classId, semesterId, type, name, teacher, location, color, remark,
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

test('注册：默认关闭返回 400；开启后提交申请 → 待审核 → 审批通过后才能建班', async () => {
  const closed = await api('POST', '/api/access/register', { username: 'newuser', password: 'pass123' })
  assert.equal(closed.status, 400)

  const en = await authApi('PUT', '/api/users/signup', { enabled: true })
  assert.equal(en.status, 200)

  // 申请资料不完整 → 400
  const bad = await registerLeader('newuser', { school: '', className: '' })
  assert.equal(bad.status, 400)

  const reg = await registerLeader('newuser')
  assert.equal(reg.status, 201)
  assert.equal(reg.body.user.role, 'leader')
  assert.equal(reg.body.user.status, 'pending')
  assert.equal(reg.body.user.claimedClass, '测试班')

  // 待审核账号能登录、能看自己的申请状态，但没有任何班级权限
  const me = await asApi(reg.cookie, 'GET', '/api/access/me')
  assert.equal(me.body.user.username, 'newuser')
  assert.equal(me.body.user.status, 'pending')
  const blocked = await asApi(reg.cookie, 'POST', '/api/classes', { school: '测试学院', name: '新班' })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'ACCOUNT_PENDING')

  // 待审核列表 → 通过 → 建班成功
  const pending = await authApi('GET', '/api/approvals')
  assert.equal(pending.body.length, 1)
  assert.equal(pending.body[0].username, 'newuser')
  await approveLeader(reg.body.user.id)
  const created = await asApi(reg.cookie, 'POST', '/api/classes', { school: '测试学院', name: '新班' })
  assert.equal(created.status, 201, JSON.stringify(created.body))

  const dup = await registerLeader('newuser')
  assert.equal(dup.status, 400)
})

test('创建学期自动生成默认节次模板并设为当前学期', async () => {
  const r = await createSemester()
  assert.equal(r.status, 201)
  assert.equal(r.body.weekStartDay, 1)

  const ctx = await authApi('GET', '/api/context')
  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.user.username, 'admin')
  const mine = ctx.body.classes.find((c) => c.id === adminClassId)
  assert.equal(mine.currentSemesterId, r.body.id)

  const periods = await authApi('GET', `/api/periods?classId=${adminClassId}`)
  assert.equal(periods.body.length, 12)
  assert.equal(periods.body[0].startTime, '08:00')
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

  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
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

  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
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
test('班级隔离：别的负责人看不到、改不了本班的课程与学期', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '本班课程' }))

  // 负责人 B：自己的班
  const { cookie } = await makeApprovedLeader('leaderb')
  const clsB = await createClassAs(cookie, '测试学院', 'B班')
  assert.equal(clsB.status, 201)
  const semB = await asApi(cookie, 'POST', '/api/semesters', { ...semesterBody, name: 'B的学期', classId: clsB.body.id })
  assert.equal(semB.status, 201)

  // B 看自己的班：正常；访问 A 的班：404
  const ownSem = await asApi(cookie, 'GET', `/api/semesters?classId=${clsB.body.id}`)
  assert.equal(ownSem.body.length, 1)
  const deniedSem = await asApi(cookie, 'GET', `/api/semesters?classId=${adminClassId}`)
  assert.equal(deniedSem.status, 404)
  const deniedCourse = await asApi(cookie, 'GET', `/api/courses?semesterId=${sem.body.id}`)
  assert.equal(deniedCourse.status, 404)
  // B 的班里没有课
  const ownCourses = await asApi(cookie, 'GET', `/api/courses?semesterId=${semB.body.id}`)
  assert.deepEqual(ownCourses.body, [])

  const coursesA = await authApi('GET', `/api/courses?classId=${adminClassId}`)
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
  const r1 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-09-01`)
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
  const r2 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-09-08`)
  const names2 = r2.body.courses.map((c) => c.name)
  assert.ok(!names2.includes('单周课'))
  assert.ok(names2.includes('全部周课'))

  // 学期外 → 假期
  const r4 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2027-02-01`)
  assert.equal(r4.body.week.isHoliday, true)
  assert.equal(r4.body.courses.length, 0)
})

test('周聚合：实验课在指定周出现、其他周不出现', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, {
    name: '数字电路实验', type: 'lab', weekday: 1, periods: [7, 8], weeks: [10, 11, 12],
  }))

  // 学期起始 2026-09-01（周二）→ 第 10 周周一为 2026-11-02
  const w10 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-11-02`)
  assert.equal(w10.body.week.weekNumber, 10)
  assert.equal(w10.body.courses.filter((c) => c.type === 'lab').length, 1)

  const w9 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-10-26`)
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
  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
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
  const list2 = await authApi('GET', `/api/courses?classId=${adminClassId}`)
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
  // 作业是班级公示内容：没有个人完成态（done 字段与端点已删除）
  assert.equal(hw.body.done, undefined)
  const noDone = await authApi('PATCH', `/api/homework/${hw.body.id}/done`, { done: true })
  assert.equal(noDone.status, 404)

  const sched = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-09-10`)
  assert.equal(sched.body.homework.length, 1)
  assert.equal(sched.body.homework[0].name, '习题1')

  await authApi('DELETE', '/api/courses/' + c.body.id)
  const exams = await authApi('GET', '/api/exams?classId=' + adminClassId)
  assert.equal(exams.body[0].courseId, null)
})

test('班级通知：负责人增删改与置顶排序；公开页无需登录可读且不泄露账号', async () => {
  const sem = await createSemester()
  const c = await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '数字信号处理' }))

  const a = await authApi('POST', '/api/notices', { classId: adminClassId, date: '2026-10-01', title: '国庆放假安排', body: '10月1日至7日放假' })
  assert.equal(a.status, 201)
  const b = await authApi('POST', '/api/notices', { classId: adminClassId, date: '2026-10-12', title: '调课通知', body: '周三的课移至周五', courseId: c.body.id })
  assert.equal(b.status, 201)

  // 排序：置顶优先 → 日期倒序（新的在前）
  let list = await authApi('GET', `/api/notices?classId=${adminClassId}`)
  assert.deepEqual(list.body.map((n) => n.title), ['调课通知', '国庆放假安排'])
  assert.equal(list.body[0].courseId, c.body.id)

  // 置顶后仍排最前；日期改成更早的也压在最上
  const pinned = await authApi('PUT', `/api/notices/${a.body.id}`, { classId: adminClassId, date: '2026-09-01', title: '国庆放假安排', body: '10月1日至7日放假', pinned: true })
  assert.equal(pinned.status, 200)
  list = await authApi('GET', `/api/notices?classId=${adminClassId}`)
  assert.deepEqual(list.body.map((n) => n.title), ['国庆放假安排', '调课通知'])
  assert.equal(list.body[0].pinned, true)

  // 校验：标题必填、日期格式、课程必须属于本班
  assert.equal((await authApi('POST', '/api/notices', { classId: adminClassId, date: '2026-10-01', title: '' })).status, 400)
  assert.equal((await authApi('POST', '/api/notices', { classId: adminClassId, date: '2026-13-40', title: 'x' })).status, 400)
  assert.equal((await authApi('POST', '/api/notices', { classId: adminClassId, date: '2026-10-01', title: 'x', courseId: 999999 })).status, 400)

  // 公开读取：无需登录，按同一排序；不泄露作者账号与班级内部字段
  const pub = await fetch(`${base}/api/public/classes/${adminClassId}/notices`)
  assert.equal(pub.status, 200)
  const pubList = (await pub.json()).map((n) => n.title)
  assert.deepEqual(pubList, ['国庆放假安排', '调课通知'])
  const raw = await (await fetch(`${base}/api/public/classes/${adminClassId}/notices`)).text()
  assert.ok(!raw.includes('admin_001'), '公开通知不得包含作者用户名')

  // 删除
  assert.equal((await authApi('DELETE', `/api/notices/${b.body.id}`)).status, 204)
  list = await authApi('GET', `/api/notices?classId=${adminClassId}`)
  assert.deepEqual(list.body.map((n) => n.title), ['国庆放假安排'])

  // 变更记录：通知的增改删都留痕
  const noticeLogs = db
    .prepare("SELECT * FROM change_log WHERE entity = 'notice' ORDER BY id ASC")
    .all()
  assert.ok(noticeLogs.some((l) => l.action === 'create'))
  assert.ok(noticeLogs.some((l) => l.action === 'update'))
  assert.ok(noticeLogs.some((l) => l.action === 'delete'))
  const updateLog = noticeLogs.find((l) => l.action === 'update')
  assert.equal(JSON.parse(updateLog.after).pinned, true)
})

test('备份导出 v5 与恢复；天气 Key 脱敏', async () => {
  await createSemester()
  await authApi('POST', '/api/courses', courseBody(undefined, {
    name: '备份课程', type: 'lab', weekday: 1, periods: [1, 2], weeks: [1, 2, 3],
  }))
  await authApi('PUT', '/api/settings', { weather: { enabled: true, apiKey: 'secret-key-12345678', location: '信阳' } })

  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(out.status, 200)
  assert.equal(payload.version, 6)
  assert.deepEqual(payload.classes[0], { id: adminClassId, school: '测试学院', name: '测试班', major: '', city: '' })
  assert.equal(payload.semesters[0].classId, adminClassId)
  assert.equal(payload.courses.length, 1)
  assert.deepEqual(payload.courses[0].sessions[0].periods, [1, 2])
  assert.deepEqual(payload.courses[0].sessions[0].weeks, [1, 2, 3])
  assert.ok(!payload.settings.weather.apiKey.includes('secret-key'), 'API Key 不应明文导出')
  assert.ok(payload.settings.weather.apiKey.endsWith('5678'))

  // 清空目标班级的数据后恢复
  db.prepare('DELETE FROM semester WHERE class_id = ?').run(adminClassId)
  const form = new FormData()
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  const restored = await res.json()
  assert.equal(res.status, 200)
  assert.equal(restored.restored.semesters, 1)
  assert.equal(restored.restored.courses, 1)

  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].type, 'lab')
  assert.deepEqual(list.body[0].sessions[0].weeks, [1, 2, 3])

  // 非 JSON → 400 BAD_FILE
  const form2 = new FormData()
  form2.append('classId', String(adminClassId))
  form2.append('file', new Blob(['not json'], { type: 'text/plain' }), 'x.json')
  const res2 = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form2 })
  assert.equal(res2.status, 400)
  assert.equal((await res2.json()).code, 'BAD_FILE')
})

test('恢复：待审核账号被拒（403）；非本班成员指定目标班级被拒（400）', async () => {
  await createSemester()
  // 待审核账号
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await registerLeader('pending2')
  const cookieP = reg.cookie
  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  const form = new FormData()
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${cookieP}` }, body: form })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'ACCOUNT_PENDING')

  // 已审批但非该班成员：指定别人的班 → 400
  const { cookie } = await makeApprovedLeader('outsider')
  const form2 = new FormData()
  form2.append('classId', String(adminClassId))
  form2.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res2 = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${cookie}` }, body: form2 })
  assert.equal(res2.status, 400)
  assert.equal((await res2.json()).code, 'BAD_FILE')
})

test('恢复隔离：恢复只覆盖目标班级，别的班级数据不受影响', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '本班的课' }))

  // 负责人 B 自己的班
  const { cookie } = await makeApprovedLeader('leaderb2')
  const clsB = await createClassAs(cookie, '测试学院', 'B班2')
  const semB = await asApi(cookie, 'POST', '/api/semesters', { ...semesterBody, name: 'B的学期', classId: clsB.body.id })
  await asApi(cookie, 'POST', '/api/courses', courseBody(semB.body.id, { name: 'B的课', classId: clsB.body.id }))

  // admin 导出自己的班（只含本班）后恢复
  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(payload.courses.length, 1)
  const form = new FormData()
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 200)

  // B 的班必须原样还在
  const coursesB = await asApi(cookie, 'GET', `/api/courses?semesterId=${semB.body.id}`)
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
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(bad)], { type: 'application/json' }), 'bad.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'BAD_FILE')
  // 原有数据未被清空
  const sems = await authApi('GET', `/api/semesters?classId=${adminClassId}`)
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
  form.append('classId', String(adminClassId))
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

  // 导出（v6：当前学期指向挂在班级上）后还原
  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(payload.semesters[0].id, sem.body.id)
  const form = new FormData()
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 200)

  // 不带 semesterId 查询：应仍指向备份中的当前学期，而非空数组
  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
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
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(legacy)], { type: 'application/json' }), 'v3.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 200)

  // 无 semesterId 查询应落到第一个学期（甲），而不是空数组
  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].name, '甲课')
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

  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
  const colors = list.body.map((c) => `${c.name}=${c.color}`).sort()
  assert.deepEqual(colors, ['课1=course-1', '课2=course-2', '课3=course-3'])

  // 同名课程复用已有颜色，不占用新的轮询序号（不传 color，交由服务端分配）
  await authApi('POST', '/api/courses', {
    classId: adminClassId, semesterId: sem.body.id, type: 'course', name: '课1', teacher: '', location: '', remark: '',
    sessions: [{ weekday: 2, location: '', periods: [5], weeks: [1] }],
  })
  // 新课继续轮询
  await authApi('POST', '/api/courses', {
    classId: adminClassId, semesterId: sem.body.id, type: 'course', name: '新课X', teacher: '', location: '', remark: '',
    sessions: [{ weekday: 3, location: '', periods: [5], weeks: [1] }],
  })
  const list2 = await authApi('GET', `/api/courses?classId=${adminClassId}`)
  const same = list2.body.filter((c) => c.name === '课1')
  assert.equal(same.length, 2)
  assert.ok(same.every((c) => c.color === 'course-1'), '同名应复用已有颜色')
  assert.ok(list2.body.find((c) => c.name === '新课X').color !== 'course-1', '新课程应继续轮询')

  // 显式提供的合法颜色应被尊重（PDF 导入时前端已算好颜色）
  await authApi('POST', '/api/import/confirm', {
    mode: 'append', semesterId: sem.body.id,
    rows: [{ name: '指定色课', type: 'course', location: '', color: 'course-6',
      sessions: [{ weekday: 4, location: '', periods: [1], weeks: [1] }] }],
  })
  const list3 = await authApi('GET', `/api/courses?classId=${adminClassId}`)
  assert.equal(list3.body.find((c) => c.name === '指定色课').color, 'course-6')
})

test('模板功能已移除：接口不再存在', async () => {
  const r = await authApi('GET', '/api/templates')
  assert.equal(r.status, 404)
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('template','import_log')").all().length, 0)
})

test('学期删除：级联清空并返回删除数量与快照', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '将被删的课' }))
  const del = await authApi('DELETE', `/api/semesters/${sem.body.id}`)
  assert.equal(del.status, 200)
  assert.equal(del.body.deletedCourses, 1)
  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
  assert.equal(list.body.length, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_session').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n, 0)
})

test('用户管理：admin 创建/禁用/重置密码/删除；负责人访问被拒 403', async () => {
  const { cookie: cookieN } = await makeApprovedLeader('normal')
  const forbidden = await asApi(cookieN, 'GET', '/api/users')
  assert.equal(forbidden.status, 403)

  const created = await authApi('POST', '/api/users', { username: 'member', password: 'pass123', role: 'leader' })
  assert.equal(created.status, 201)
  assert.equal(created.body.user.role, 'leader')
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

  // 负责人读取
  const { cookie: cookieU } = await makeApprovedLeader('weatheruser')

  // 读取：拿到的是脱敏值，不能含明文
  const got = await asApi(cookieU, 'GET', '/api/settings')
  assert.equal(got.status, 200)
  assert.ok(!String(got.body.weather.apiKey).includes('real-secret'), '普通用户不应读到明文 Key')
  assert.ok(String(got.body.weather.apiKey).endsWith('efgh'))

  // 写入：403
  const forbidden = await asApi(cookieU, 'PUT', '/api/settings', {
    weather: { enabled: false, apiKey: 'hacked', location: '北京' },
  })
  assert.equal(forbidden.status, 403)

  // 库中真实 Key 未被改动
  const after = await authApi('GET', '/api/settings')
  assert.equal(after.body.weather.apiKey, 'real-secret-abcdefgh')

  // 普通用户回传脱敏值时（如保存提醒设置顺带带上 weather），不应把真实 Key 覆盖成星号
  const keepMasked = await asApi(cookieU, 'PUT', '/api/settings', {
    reminder: { enabled: true, mode: 'every', advanceMinutes: 10 },
  })
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

  const periods = await authApi('GET', `/api/periods?classId=${adminClassId}`)
  const target = periods.body.find((p) => p.index === 3) // 删除第 3 节

  const del = await authApi('DELETE', `/api/periods/${target.id}`)
  assert.equal(del.status, 200)
  assert.equal(del.body.removedPeriod, 3)
  assert.equal(del.body.affectedCourses, 1, '仅跨节课程在第 3 节有课')

  // 节次模板重排为 1..11
  const after = await authApi('GET', `/api/periods?classId=${adminClassId}`)
  assert.equal(after.body.length, 11)
  assert.deepEqual(after.body.map((p) => p.index), Array.from({ length: 11 }, (_, i) => i + 1))

  // 跨节课程：原 [2,3,4] 移除第 3 节 → 剩 [2,4]，且第 4 节前移为第 3 节 → [2,3]
  const list = await authApi('GET', `/api/courses?classId=${adminClassId}`)
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

  const w1 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-09-01`) // 第 1 周
  const w3 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-09-15`) // 第 3 周
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
  const w2 = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-09-08`)
  const b2 = w2.body.courses.find((c) => c.name === '短课')
  assert.deepEqual(b2.allPeriods, [7, 8])
})

test('周聚合：未开学（早于起始日）与假期（晚于结束日）语义区分', async () => {
  await createSemester() // 2026-09-01 ~ 2027-01-15

  // 早于起始日 → 未开学
  const before = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-08-20`)
  assert.equal(before.body.week.isBeforeSemester, true)
  assert.equal(before.body.week.isHoliday, false)
  assert.equal(before.body.week.weekNumber, null)
  assert.equal(before.body.courses.length, 0)

  // 晚于结束日 → 假期
  const holiday = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2027-02-01`)
  assert.equal(holiday.body.week.isBeforeSemester, false)
  assert.equal(holiday.body.week.isHoliday, true)

  // 学期内 → 正常周号，两个标志都为 false
  const inside = await authApi('GET', `/api/schedule?classId=${adminClassId}&date=2026-09-08`)
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
// ============================================================
// 学期日历（放假 / 整日移课）
// ============================================================

test('学期日历：放假区间逐日展开、整日移课、清除与越界拒绝', async () => {
  const sem = await createSemester()
  const semId = sem.body.id

  // 国庆放假 10/1–10/3 → 逐日三行
  const r1 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-01', to: '2026-10-03', kind: 'holiday', note: '国庆节' })
  assert.equal(r1.status, 200)
  assert.deepEqual(r1.body.map((x) => x.date), ['2026-10-01', '2026-10-02', '2026-10-03'])
  assert.equal(r1.body[0].kind, 'holiday')
  assert.equal(r1.body[0].note, '国庆节')

  // 整日移课：把 9/29（周二）的课移到 10/10（周六）——不假设课表每周重复
  const r2 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-09-29', to: '2026-10-10', kind: 'shift', note: '国庆调休' })
  assert.equal(r2.status, 200)
  assert.equal(r2.body.length, 4)
  const shift = r2.body.find((x) => x.kind === 'shift')
  assert.equal(shift.date, '2026-09-29')
  assert.equal(shift.toDate, '2026-10-10')
  assert.equal(shift.note, '国庆调休')

  // 同一源日再录一次 = 覆盖（不新增行）
  const r3 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-09-29', to: '2026-10-09', kind: 'shift' })
  assert.equal(r3.body.length, 4, '移课覆盖不应新增行')
  assert.equal(r3.body.find((x) => x.kind === 'shift').toDate, '2026-10-09')

  // 清除区间：只清区间内的日期，移课行不受影响
  const r4 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-01', to: '2026-10-03', kind: 'clear' })
  assert.deepEqual(r4.body.map((x) => `${x.kind}:${x.date}`), ['shift:2026-09-29'])

  // 读取一致
  const list = await authApi('GET', `/api/calendar?semesterId=${semId}`)
  assert.equal(list.body.length, 1)

  // 非法：学期范围外 / 移课源=目标 / 非法 kind / 缺字段 → 400 且不改动数据
  const bad1 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-08-01', to: '2026-08-02', kind: 'holiday' })
  assert.equal(bad1.status, 400)
  const bad2 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-05', to: '2027-03-01', kind: 'shift' })
  assert.equal(bad2.status, 400, '移到哪天超学期范围')
  const bad3 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-05', to: '2026-10-05', kind: 'shift' })
  assert.equal(bad3.status, 400, '源日与目标日不能相同')
  const bad4 = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-05', to: '2026-10-05', kind: 'follow' })
  assert.equal(bad4.status, 400, '旧的「按周几课表」已不再是合法类型')
  const after = await authApi('GET', `/api/calendar?semesterId=${semId}`)
  assert.equal(after.body.length, 1, '校验失败不应写入')
})

test('学期日历：移课目标日唯一 + 无环（多源指同一天 / A→B→A 都拒绝）', async () => {
  const sem = await createSemester()
  const semId = sem.body.id

  const a = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-09-29', to: '2026-10-10', kind: 'shift' })
  assert.equal(a.status, 200)

  // 另一个源日也想移到 10/10 → 同一天承接两天的课，拒绝
  const dup = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-06', to: '2026-10-10', kind: 'shift' })
  assert.equal(dup.status, 400)
  assert.match(dup.body.details[0].message, /移课目标日/)

  // 同一条规则再录一次 = 覆盖自己，不受「目标日唯一」影响
  const again = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-09-29', to: '2026-10-10', kind: 'shift' })
  assert.equal(again.status, 200)

  // 链式调休 A→B→C 合法
  const chain = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-10', to: '2026-10-17', kind: 'shift' })
  assert.equal(chain.status, 200, '调休链合法')

  // 再加 10/17 → 9/29 就绕回起点 → 拒绝
  const cyc = await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-17', to: '2026-09-29', kind: 'shift' })
  assert.equal(cyc.status, 400)
  assert.match(cyc.body.details[0].message, /死循环/)

  const list = await authApi('GET', `/api/calendar?semesterId=${semId}`)
  assert.deepEqual(
    list.body.map((x) => `${x.date}→${x.toDate}`),
    ['2026-09-29→2026-10-10', '2026-10-10→2026-10-17'],
    '被拒绝的两条没有落库',
  )
})

test('学期日历：跨用户隔离、删学期级联清理', async () => {
  const sem = await createSemester()
  const semId = sem.body.id
  await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-01', to: '2026-10-01', kind: 'holiday' })

  const { cookie: cookieB } = await makeApprovedLeader('caluser')
  const clsB = await createClassAs(cookieB, '测试学院', '日历B班')

  // 别人班的学期 → 404；自己班（还没有学期）→ 空数组
  const denied = await asApi(cookieB, 'GET', `/api/calendar?semesterId=${semId}`)
  assert.equal(denied.status, 404)
  const own = await asApi(cookieB, 'GET', `/api/calendar?classId=${clsB.body.id}`)
  assert.deepEqual(own.body, [])

  // 删学期 → 规则级联清理
  await authApi('DELETE', `/api/semesters/${semId}`)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semester_day_rule').get().n, 0)
})

// ============================================================
// 单课调整（停课 / 调课 / 补课）
// ============================================================

test('单课调整：停课 / 调课 / 补课的创建、更新、删除与校验', async () => {
  const sem = await createSemester()
  const semId = sem.body.id
  const created = await authApi('POST', '/api/courses', courseBody(semId, { weekday: 4, periods: [5, 6], weeks: [6, 7, 8] }))
  const courseId = created.body.id

  // 停课：第 7 周周四 5–6 节
  const cancel = await authApi('POST', '/api/adjustments', {
    courseId, date: '2026-10-15', kind: 'cancel', fromWeekday: 4, fromPeriods: [5, 6], note: '老师出差',
  })
  assert.equal(cancel.status, 201)
  assert.equal(cancel.body.kind, 'cancel')
  assert.deepEqual(cancel.body.fromPeriods, [5, 6])
  assert.equal(cancel.body.toDate, null)

  // 调课：10/22 的课改到 10/24（周六）3–4 节
  const move = await authApi('POST', '/api/adjustments', {
    courseId, date: '2026-10-22', kind: 'move', fromWeekday: 4, fromPeriods: [5, 6], toDate: '2026-10-24', periods: [3, 4],
  })
  assert.equal(move.status, 201)
  assert.equal(move.body.toDate, '2026-10-24')
  assert.deepEqual(move.body.periods, [3, 4])

  // 补课：10/31（周六）3–4 节
  const extra = await authApi('POST', '/api/adjustments', {
    courseId, date: '2026-10-31', kind: 'extra', periods: [3, 4], location: '实验楼302',
  })
  assert.equal(extra.status, 201)
  assert.equal(extra.body.location, '实验楼302')
  assert.equal(extra.body.fromWeekday, null)

  const list = await authApi('GET', `/api/adjustments?semesterId=${semId}`)
  assert.equal(list.body.length, 3)
  assert.deepEqual(list.body.map((x) => x.date), ['2026-10-15', '2026-10-22', '2026-10-31'])

  // 更新：把调课目标改到 10/25 5–6 节
  const upd = await authApi('PUT', `/api/adjustments/${move.body.id}`, {
    date: '2026-10-22', kind: 'move', fromWeekday: 4, fromPeriods: [5, 6], toDate: '2026-10-25', periods: [5, 6],
  })
  assert.equal(upd.status, 200)
  assert.equal(upd.body.toDate, '2026-10-25')

  // 撤销
  const del = await authApi('DELETE', `/api/adjustments/${extra.body.id}`)
  assert.equal(del.status, 204)
  const after = await authApi('GET', `/api/adjustments?semesterId=${semId}`)
  assert.equal(after.body.length, 2)

  // 非法：move 缺目标日期 / 停课缺原时间组 / 节次超上限 / 日期在学期外
  const bad1 = await authApi('POST', '/api/adjustments', { courseId, date: '2026-10-15', kind: 'move', fromWeekday: 4, fromPeriods: [5], periods: [3] })
  assert.equal(bad1.status, 400)
  const bad2 = await authApi('POST', '/api/adjustments', { courseId, date: '2026-10-15', kind: 'cancel' })
  assert.equal(bad2.status, 400)
  const bad3 = await authApi('POST', '/api/adjustments', { courseId, date: '2026-10-15', kind: 'move', fromWeekday: 4, fromPeriods: [5], toDate: '2026-10-16', periods: [99] })
  assert.equal(bad3.status, 400)
  const bad4 = await authApi('POST', '/api/adjustments', { courseId, date: '2027-03-01', kind: 'cancel', fromWeekday: 4, fromPeriods: [5] })
  assert.equal(bad4.status, 400)
  const still = await authApi('GET', `/api/adjustments?semesterId=${semId}`)
  assert.equal(still.body.length, 2, '非法请求不应写入')
})

test('单课调整：跨用户不可见；删课程级联清理；基准课表不受影响', async () => {
  const sem = await createSemester()
  const semId = sem.body.id
  const created = await authApi('POST', '/api/courses', courseBody(semId, { weekday: 4, periods: [5, 6], weeks: [6, 7, 8] }))
  const courseId = created.body.id
  const slotCountBefore = db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n

  await authApi('POST', '/api/adjustments', {
    courseId, date: '2026-10-15', kind: 'cancel', fromWeekday: 4, fromPeriods: [5, 6],
  })

  // 调整是「日期覆盖层」：基准课表的节×周格子一格未动
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n, slotCountBefore)

  // 另一个负责人看不到、也改不了
  const { cookie: cookieB } = await makeApprovedLeader('adjuser')
  const listB = await asApi(cookieB, 'GET', `/api/adjustments?semesterId=${semId}`)
  assert.equal(listB.status, 404, '别人班的学期 → 学期不存在')
  const delB = await asApi(cookieB, 'DELETE', '/api/adjustments/1')
  assert.equal(delB.status, 404)

  // 删课程 → 调整级联清理
  await authApi('DELETE', `/api/courses/${courseId}`)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_adjustment').get().n, 0)
})

test('备份 v6：班级数据、日历与调整随备份导出并还原（含计数）', async () => {
  const sem = await createSemester()
  const semId = sem.body.id
  const created = await authApi('POST', '/api/courses', courseBody(semId, { weekday: 4, periods: [5, 6], weeks: [6, 7, 8] }))
  const courseId = created.body.id
  await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-10-01', to: '2026-10-02', kind: 'holiday', note: '国庆' })
  await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-09-29', to: '2026-10-10', kind: 'shift', note: '调休' })
  await authApi('POST', '/api/adjustments', { courseId, date: '2026-10-15', kind: 'cancel', fromWeekday: 4, fromPeriods: [5, 6], note: '出差' })
  await authApi('POST', '/api/adjustments', { courseId, date: '2026-10-22', kind: 'move', fromWeekday: 4, fromPeriods: [5, 6], toDate: '2026-10-24', periods: [3, 4] })

  const out = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${adminCookie}` } })
  const payload = await out.json()
  assert.equal(payload.version, 6)
  assert.equal(payload.calendar.length, 3)
  assert.equal(payload.adjustments.length, 2)
  const shift = payload.calendar.find((r) => r.kind === 'shift')
  assert.equal(shift.date, '2026-09-29')
  assert.equal(shift.toDate, '2026-10-10')
  assert.equal(payload.adjustments.find((a) => a.kind === 'move').toDate, '2026-10-24')

  // 清空全部业务数据后还原
  db.prepare('DELETE FROM semester WHERE class_id = ?').run(adminClassId)
  const form = new FormData()
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'backup.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  const body = await res.json()
  assert.equal(res.status, 200, JSON.stringify(body))
  assert.equal(body.restored.calendar, 3)
  assert.equal(body.restored.adjustments, 2)

  const rules = await authApi('GET', `/api/calendar?semesterId=${semId}`)
  assert.equal(rules.body.length, 3)
  assert.equal(rules.body.find((r) => r.kind === 'shift').toDate, '2026-10-10')
  const adjs = await authApi('GET', `/api/adjustments?semesterId=${semId}`)
  assert.equal(adjs.body.length, 2)
  assert.equal(adjs.body.find((a) => a.kind === 'move').toDate, '2026-10-24')
  assert.deepEqual(adjs.body.find((a) => a.kind === 'cancel').fromPeriods, [5, 6])
})

test('恢复：v4 备份缺日历与调整字段 → 按空处理，课程照常恢复', async () => {
  await createSemester()
  const v4 = {
    version: 4,
    semesters: [{ id: 7, name: 'v4 学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }],
    periods: [],
    courses: [{ id: 70, semesterId: 7, type: 'course', name: 'v4 课程', sessions: [{ weekday: 1, periods: [1, 2], weeks: [1, 2] }] }],
    exams: [], homework: [], settings: {}, templates: [],
  }
  const form = new FormData()
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(v4)], { type: 'application/json' }), 'v4.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  const body = await res.json()
  assert.equal(res.status, 200, JSON.stringify(body))
  assert.equal(body.restored.upgradedFrom, null, 'v4 与新版本课程结构一致，不算旧结构升级')
  assert.equal(body.restored.calendar, 0)
  assert.equal(body.restored.adjustments, 0)
  const courses = await authApi('GET', '/api/courses?semesterId=7')
  assert.equal(courses.body.length, 1)
  assert.deepEqual(courses.body[0].sessions[0].weeks, [1, 2])
})

test('恢复：调整引用了不存在的课程 → 整批拒绝', async () => {
  await createSemester()
  const bad = {
    version: 5,
    semesters: [{ id: 9, name: 'S', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }],
    periods: [],
    courses: [{ id: 90, semesterId: 9, type: 'course', name: '课', sessions: [{ weekday: 1, periods: [1], weeks: [1] }] }],
    exams: [], homework: [], settings: {}, templates: [],
    calendar: [{ semesterId: 9, date: '2026-10-01', kind: 'holiday', toDate: null, note: '' }],
    adjustments: [{ courseId: 999, date: '2026-10-15', kind: 'cancel', fromWeekday: 4, fromPeriods: [5], toDate: null, periods: [] }],
  }
  const form = new FormData()
  form.append('classId', String(adminClassId))
  form.append('file', new Blob([JSON.stringify(bad)], { type: 'application/json' }), 'bad.json')
  const res = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Cookie: `classboard_session=${adminCookie}` }, body: form })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'BAD_FILE')
  const sems = await authApi('GET', `/api/semesters?classId=${adminClassId}`)
  assert.equal(sems.body.length, 1, '原有数据未被清空')
})

test('迁移：学期日历由「按周几课表」转为「整日移课」', async () => {
  const { execFileSync } = await import('node:child_process')
  const migDir = mkdtempSync(join(tmpdir(), 'classboard-calendar-mig-'))
  const legacy = new Database(join(migDir, 'classboard.db'))
  legacy.exec(`
    CREATE TABLE semester (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date TEXT NOT NULL, week_start_day INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE semester_day_rule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('holiday', 'follow')),
      follow_weekday INTEGER,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX idx_day_rule_unique ON semester_day_rule (semester_id, date);
    INSERT INTO semester (id, name, start_date, end_date, week_start_day, updated_at)
      VALUES (1, '旧学期', '2026-09-07', '2026-12-27', 1, '2026-09-01T00:00:00Z');
    INSERT INTO semester_day_rule (semester_id, date, kind, follow_weekday, note)
      VALUES (1, '2026-10-01', 'holiday', NULL, '国庆');
    INSERT INTO semester_day_rule (semester_id, date, kind, follow_weekday, note)
      VALUES (1, '2026-10-10', 'follow', 4, '补班');
  `)
  legacy.close()

  const script = `
    const { db } = await import('./lib/db.js')
    const rules = db.prepare('SELECT date, kind, to_date, note FROM semester_day_rule ORDER BY date').all()
    console.log(JSON.stringify({ rules }))
  `
  const res = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CLASSBOARD_DATA_DIR: migDir },
    encoding: 'utf8',
  })
  const out = JSON.parse(res.trim().split(String.fromCharCode(10)).pop())
  assert.deepEqual(out.rules, [
    { date: '2026-10-01', kind: 'holiday', to_date: null, note: '国庆' },
    // 旧规则「10/10 按周四课表」→ 新规则「把该周周四（10/8）的课移到 10/10」
    { date: '2026-10-08', kind: 'shift', to_date: '2026-10-10', note: '补班' },
  ])
  rmSync(migDir, { recursive: true, force: true })
})

// ============================================================
// 班级平台（P1）：班级与成员、注册审批、公开只读接口、变更记录
// ============================================================

test('班级：创建 / 资料校验 / 同名 409 并可加入 / 资料修改', async () => {
  // 资料校验
  const bad = await authApi('POST', '/api/classes', { school: '', name: 'x' })
  assert.equal(bad.status, 400)

  // 同名（学校 + 班级名）→ 409 且带已存在的班级
  const dup = await authApi('POST', '/api/classes', { school: '测试学院', name: '测试班' })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.code, 'CLASS_EXISTS')
  assert.equal(dup.body.class.id, adminClassId)

  // 另一位负责人同名加入 → 同级成员
  const { cookie } = await makeApprovedLeader('mate')
  const lookup = await asApi(cookie, 'GET', '/api/classes/lookup?school=测试学院&name=测试班')
  assert.equal(lookup.body.found, true)
  const join = await asApi(cookie, 'POST', `/api/classes/${adminClassId}/join`)
  assert.equal(join.status, 200)
  assert.equal(join.body.members.length, 2)
  assert.deepEqual(join.body.members.map((m) => m.username).sort(), ['admin', 'mate'])

  // 我的班级列表里能看到
  const mine = await asApi(cookie, 'GET', '/api/classes')
  assert.equal(mine.body.length, 1)
  assert.equal(mine.body[0].name, '测试班')
  assert.equal(mine.body[0].memberCount, 2)

  // 任一负责人可改资料（含天气城市）；改成与别的班同名 → 409
  const upd = await asApi(cookie, 'PUT', `/api/classes/${adminClassId}`, { city: '无锡', major: '集成电路设计与集成系统' })
  assert.equal(upd.status, 200)
  assert.equal(upd.body.city, '无锡')
  assert.equal(upd.body.major, '集成电路设计与集成系统')

  const other = await makeApprovedLeader('other1')
  await createClassAs(other.cookie, '测试学院', '另一个班')
  const clash = await authApi('PUT', `/api/classes/${adminClassId}`, { school: '测试学院', name: '另一个班' })
  assert.equal(clash.status, 409)

  // 管理员对任意班级有查看 / 修改权（本用例里 admin 本身就是成员；这里验证跨班查看）
  const otherClassId = (await asApi(other.cookie, 'GET', '/api/classes')).body[0].id
  const adminJoin = await authApi('POST', `/api/classes/${otherClassId}/join`)
  assert.equal(adminJoin.status, 200)
  const adminEdit = await authApi('PUT', `/api/classes/${otherClassId}`, { city: '南京' })
  assert.equal(adminEdit.status, 200)
})

test('班级：退出与删除（最后一人退出即删班，数据级联清理）', async () => {
  const { cookie } = await makeApprovedLeader('coboss')
  await asApi(cookie, 'POST', `/api/classes/${adminClassId}/join`)
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '共享班的课' }))

  // 非最后一人退出：班级保留，课程还在
  const leave = await asApi(cookie, 'DELETE', `/api/classes/${adminClassId}/members/me`)
  assert.equal(leave.status, 200)
  assert.equal(leave.body.deleted, false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course').get().n, 1)

  // 最后一人退出：班级连同数据删除
  const leaveAdmin = await authApi('DELETE', `/api/classes/${adminClassId}/members/me`)
  assert.equal(leaveAdmin.body.deleted, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semester').get().n, 0)

  // 任一负责人可显式删班
  const cls = await createClassAs(cookie, '测试学院', '待删班')
  const del = await asApi(cookie, 'DELETE', `/api/classes/${cls.body.id}`)
  assert.equal(del.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class WHERE id = ?').get(cls.body.id).n, 0)
})

test('审批：拒绝带理由，申请人登录后能看到；被拒账号无法建班', async () => {
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await registerLeader('rejectme')
  assert.equal(reg.status, 201)

  const reject = await authApi('POST', `/api/approvals/${reg.body.user.id}/reject`, { note: '请用真实姓名与班级' })
  assert.equal(reject.status, 200)
  assert.equal(reject.body.status, 'rejected')

  const me = await asApi(reg.cookie, 'GET', '/api/access/me')
  assert.equal(me.body.user.status, 'rejected')
  assert.equal(me.body.user.reviewNote, '请用真实姓名与班级')

  const blocked = await asApi(reg.cookie, 'POST', '/api/classes', { school: '测试学院', name: '被拒班' })
  assert.equal(blocked.status, 403)

  // 审批列表默认只看待审；status=all 含已拒绝
  const pending = await authApi('GET', '/api/approvals')
  assert.equal(pending.body.length, 0)
  const all = await authApi('GET', '/api/approvals?status=all')
  assert.equal(all.body.length, 1)
})

test('公开接口：无需登录即可看班级与课表；不泄露账号与配置', async () => {
  const sem = await createSemester()
  await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '公开课' }))
  await authApi('PUT', '/api/calendar', { semesterId: sem.body.id, from: '2026-09-29', to: '2026-10-10', kind: 'shift', note: '调休' })
  await authApi('POST', '/api/adjustments', {
    courseId: (await authApi('GET', `/api/courses?classId=${adminClassId}`)).body[0].id,
    date: '2026-10-15', kind: 'cancel', fromWeekday: 4, fromPeriods: [5, 6],
  })

  const list = await api('GET', '/api/public/classes?q=测试班')
  assert.equal(list.status, 200)
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].name, '测试班')
  assert.ok(!('createdBy' in list.body[0]))

  const info = await api('GET', `/api/public/classes/${adminClassId}`)
  assert.equal(info.status, 200)
  assert.equal(info.body.class.school, '测试学院')
  assert.equal(info.body.semesters.length, 1)
  assert.equal(info.body.periods.length, 12)
  assert.ok(!('members' in info.body))

  const tt = await api('GET', `/api/public/classes/${adminClassId}/timetable`)
  assert.equal(tt.status, 200)
  assert.equal(tt.body.courses.length, 1)
  assert.equal(tt.body.dayRules.length, 1)
  assert.equal(tt.body.adjustments.length, 1)
  assert.equal(tt.body.semester.id, sem.body.id)

  const notices = await api('GET', `/api/public/classes/${adminClassId}/notices`)
  assert.deepEqual(notices.body, [])

  const weather = await api('GET', `/api/public/classes/${adminClassId}/weather`)
  assert.equal(weather.status, 200)
  assert.equal(weather.body.enabled, false)

  // 不存在的班级 → 404；未配置城市不会 500
  const missing = await api('GET', '/api/public/classes/9999')
  assert.equal(missing.status, 404)

  // 响应里不应出现任何账号 / 密钥字段
  const raw = JSON.stringify(tt.body)
  assert.ok(!/apiKey|password|"user"/.test(raw))
})

test('变更记录：写操作落库（班级 / 学期 / 课程 / 调整 / 班级成员）', async () => {
  const sem = await createSemester()
  const created = await authApi('POST', '/api/courses', courseBody(sem.body.id, { name: '被记录的课' }))
  await authApi('PUT', `/api/courses/${created.body.id}`, courseBody(sem.body.id, { name: '被记录的课', periods: [1, 2] }))
  const adj = await authApi('POST', '/api/adjustments', {
    courseId: created.body.id, date: '2026-10-15', kind: 'cancel', fromWeekday: 2, fromPeriods: [1, 2],
  })
  await authApi('DELETE', `/api/adjustments/${adj.body.id}`)
  await authApi('DELETE', `/api/courses/${created.body.id}`)

  const rows = db.prepare('SELECT * FROM change_log ORDER BY id ASC').all()
  const kinds = rows.map((r) => `${r.entity}:${r.action}`)
  assert.ok(kinds.includes('class:create'), '建班应记录')
  assert.ok(kinds.includes('member:join'), '成员加入应记录')
  assert.ok(kinds.includes('semester:create'), '建学期应记录')
  assert.ok(kinds.includes('course:create'))
  assert.ok(kinds.includes('course:update'))
  assert.ok(kinds.includes('course:delete'))
  assert.ok(kinds.includes('adjustment:create'))
  assert.ok(kinds.includes('adjustment:delete'))

  const courseUpdate = rows.find((r) => r.entity === 'course' && r.action === 'update')
  assert.equal(courseUpdate.class_id, adminClassId)
  assert.equal(courseUpdate.actor_id, 1)
  const before = JSON.parse(courseUpdate.before)
  const after = JSON.parse(courseUpdate.after)
  assert.deepEqual(before.sessions[0].periods, [5, 6])
  assert.deepEqual(after.sessions[0].periods, [1, 2])
  assert.equal(before.name, after.name)
  assert.ok(courseUpdate.created_at)

  // 删课程：before 里带上完整的课（含上课时间），便于回退
  const courseDelete = rows.find((r) => r.entity === 'course' && r.action === 'delete')
  const del = JSON.parse(courseDelete.before)
  assert.equal(del.name, '被记录的课')
  assert.deepEqual(del.sessions[0].periods, [1, 2])
})

// ============================================================
// 迁移：班级平台（旧多用户库 → 班级模型）
// 覆盖：user 角色与新增字段、semester.class_id、user_id 列移除、
//       旧账号自动建班并承接学期、当前学期指针迁移、模板表删除
// ============================================================
test('迁移：旧多用户库升级为班级模型（账号建班、归属改班级、模板表删除）', async () => {
  const { execFileSync } = await import('node:child_process')
  const { pathToFileURL } = await import('node:url')
  const migDir = mkdtempSync(join(tmpdir(), 'classboard-class-mig-'))
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
      user_id INTEGER, type TEXT NOT NULL CHECK (type IN ('course','lab')), name TEXT NOT NULL,
      teacher TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'course-1', remark TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE course_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), location TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE course_slot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES course_session(id) ON DELETE CASCADE,
      period INTEGER NOT NULL, week INTEGER NOT NULL, UNIQUE (session_id, period, week)
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
    CREATE TABLE semester_day_rule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
      date TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('holiday','shift')),
      to_date TEXT, note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE course_adjustment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      date TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('cancel','move','extra')),
      from_weekday INTEGER, from_periods TEXT NOT NULL DEFAULT '[]', to_date TEXT,
      periods TEXT NOT NULL DEFAULT '[]', location TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
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
    CREATE TABLE template (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, content TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'unit'
    );
    CREATE TABLE import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES template(id) ON DELETE CASCADE,
      template_version INTEGER NOT NULL, semester_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      mode TEXT NOT NULL, count INTEGER NOT NULL, imported_at TEXT NOT NULL
    );

    INSERT INTO user (id, username, password_hash, role, created_at) VALUES
      (1, 'admin', 'x:y', 'admin', '2026-09-01T00:00:00Z'),
      (2, 'sour', 'x:y', 'admin', '2026-09-01T00:00:00Z'),
      (3, 'stu1', 'x:y', 'user', '2026-09-02T00:00:00Z');
    INSERT INTO semester (id, name, start_date, end_date, week_start_day, updated_at, user_id) VALUES
      (10, '第一学期', '2026-09-07', '2026-12-27', 1, '2026-09-07T00:00:00Z', 2),
      (20, '第二学期', '2027-02-22', '2027-06-27', 1, '2026-09-07T00:00:00Z', 2),
      (30, '别人的学期', '2026-09-07', '2026-12-27', 1, '2026-09-07T00:00:00Z', 3);
    INSERT INTO user_setting (user_id, key, value) VALUES
      (2, 'current_semester_id', '20'),
      (2, 'weather', '{"enabled":true,"apiKey":"k","location":"信阳"}');
    INSERT INTO period_template (semester_id, period_index, start_time, end_time, user_id)
      VALUES (10, 1, '08:00', '08:45', 2);
    INSERT INTO course (id, semester_id, user_id, type, name, teacher, location, color) VALUES
      (100, 10, 2, 'course', '高等数学', '张老师', 'A101', 'course-1'),
      (200, 30, 3, 'course', '别人的课', '', '', 'course-2');
    INSERT INTO course_session (id, course_id, weekday, location) VALUES
      (100, 100, 1, 'A101'), (200, 200, 2, '');
    INSERT INTO course_slot (session_id, period, week) VALUES (100, 1, 1), (100, 1, 2), (200, 1, 1);
    INSERT INTO exam (semester_id, course_id, name, datetime, user_id) VALUES (10, 100, '期中', '2026-11-01T09:00', 2);
    INSERT INTO homework (semester_id, course_id, name, due_at, user_id) VALUES (10, 100, '作业1', '2026-10-01T23:59', 2);
    INSERT INTO semester_day_rule (semester_id, date, kind, to_date, note) VALUES (10, '2026-09-29', 'shift', '2026-10-10', '调休');
    INSERT INTO course_adjustment (course_id, date, kind, from_weekday, from_periods, to_date, periods, note, created_at)
      VALUES (100, '2026-10-15', 'cancel', 1, '[1]', NULL, '[]', '', '2026-10-01T00:00:00Z');
    INSERT INTO template (id, name, content, created_by, created_at, updated_at, kind)
      VALUES (40, '旧模板', '[]', 2, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 'unit');
  `)
  legacy.close()

  const dbUrl = pathToFileURL(join(process.cwd(), 'lib', 'db.js')).href
  const script = `
    const m = await import(${JSON.stringify(dbUrl)});
    const db = m.db;
    const out = {
      userCols: db.prepare("SELECT name FROM pragma_table_info('user')").all().map(r => r.name).sort(),
      users: db.prepare('SELECT username, role, status, school, claimed_class FROM user ORDER BY id').all(),
      classes: db.prepare('SELECT id, school, name, city, current_semester_id FROM class ORDER BY id').all(),
      members: db.prepare('SELECT class_id, user_id FROM class_member ORDER BY class_id, user_id').all(),
      semesters: db.prepare('SELECT id, class_id, name FROM semester ORDER BY id').all(),
      semCols: db.prepare("SELECT name FROM pragma_table_info('semester')").all().map(r => r.name),
      courseCols: db.prepare("SELECT name FROM pragma_table_info('course')").all().map(r => r.name),
      periodCols: db.prepare("SELECT name FROM pragma_table_info('period_template')").all().map(r => r.name),
      examCols: db.prepare("SELECT name FROM pragma_table_info('exam')").all().map(r => r.name),
      hwCols: db.prepare("SELECT name FROM pragma_table_info('homework')").all().map(r => r.name),
      counts: {
        courses: db.prepare('SELECT COUNT(*) AS n FROM course').get().n,
        cells: db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n,
        exams: db.prepare('SELECT COUNT(*) AS n FROM exam').get().n,
        homework: db.prepare('SELECT COUNT(*) AS n FROM homework').get().n,
        rules: db.prepare('SELECT COUNT(*) AS n FROM semester_day_rule').get().n,
        adjs: db.prepare('SELECT COUNT(*) AS n FROM course_adjustment').get().n,
      },
      templateTables: db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('template','import_log')").get().n,
      weatherCity: db.prepare("SELECT city FROM class WHERE name = 'sour'").get()?.city ?? null,
    };
    console.log(JSON.stringify(out));
  `
  const res = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CLASSBOARD_DATA_DIR: migDir },
    encoding: 'utf8',
  })
  const out = JSON.parse(res.trim().split(String.fromCharCode(10)).pop())

  // 账号：新增审批字段；角色只有 admin / leader；既有数据标记为已通过
  for (const c of ['status', 'school', 'major', 'claimed_class', 'review_note', 'reviewed_by', 'reviewed_at']) {
    assert.ok(out.userCols.includes(c), 'user 表应有列 ' + c)
  }
  const byName = Object.fromEntries(out.users.map((u) => [u.username, u]))
  assert.equal(byName.admin.role, 'admin')
  assert.equal(byName.sour.role, 'admin', '管理员账号保持 admin')
  assert.equal(byName.stu1.role, 'leader', '旧普通用户升级为班级负责人')
  assert.ok(out.users.every((u) => u.status === 'active'))

  // 旧账号自动建班（学校留空、班级名 = 用户名），并把学期接过去
  assert.equal(out.classes.length, 2, '只有拥有学期的账号才建班')
  assert.deepEqual(out.classes.map((c) => `${c.school}|${c.name}`).sort(), ['|sour', '|stu1'])
  assert.equal(out.members.length, 2)
  const sourClass = out.classes.find((c) => c.name === 'sour')
  assert.equal(sourClass.current_semester_id, 20, '当前学期指针迁移到班级上')
  assert.equal(out.weatherCity, '信阳', '全站天气城市带入班级城市')

  const sems = Object.fromEntries(out.semesters.map((s) => [s.id, s]))
  assert.equal(sems[10].class_id, sourClass.id)
  assert.equal(sems[30].class_id, out.classes.find((c) => c.name === 'stu1').id)
  assert.ok(!out.semCols.includes('user_id'))
  assert.ok(out.semCols.includes('class_id'))

  // 业务表不再带 user_id（归属经学期派生）
  assert.ok(!out.courseCols.includes('user_id'))
  assert.ok(!out.periodCols.includes('user_id'))
  assert.ok(!out.examCols.includes('user_id'))
  assert.ok(!out.hwCols.includes('user_id'))

  // 数据一行不丢
  assert.deepEqual(out.counts, { courses: 2, cells: 3, exams: 1, homework: 1, rules: 1, adjs: 1 })
  // 模板功能整体删除
  assert.equal(out.templateTables, 0, 'template / import_log 表应被删除')

  rmSync(migDir, { recursive: true, force: true })
})
