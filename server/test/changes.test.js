// ============================================================
// ClassBoard · 变更记录与回退（P4）
//   独立测试文件：自带一份最小 harness（临时库 + 随机端口），
//   避免和 api.test.js 那 1700 行互相牵连。
// ============================================================
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpDir = mkdtempSync(join(tmpdir(), 'classboard-changes-'))
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

function authApi(method, path, body) {
  return api(method, path, body, { Cookie: `classboard_session=${adminCookie}` })
}

function asApi(cookie, method, path, body) {
  return api(method, path, body, { Cookie: `classboard_session=${cookie}` })
}

async function loginAdmin() {
  const res = await fetch(base + '/api/access/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pass' }),
  })
  assert.equal(res.status, 200)
  adminCookie = res.headers.get('set-cookie').split(';')[0].split('=')[1]
}

async function createAdminClass(school = '测试学院', name = '测试班') {
  const r = await authApi('POST', '/api/classes', { school, name })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  adminClassId = r.body.id
  return r.body
}

/** 注册 + 审批通过，返回 cookie 与 userId */
async function makeApprovedLeader(username) {
  await authApi('PUT', '/api/users/signup', { enabled: true })
  const reg = await api('POST', '/api/access/register', {
    username,
    password: 'pass123',
    school: '测试学院',
    major: '集成电路设计与集成系统',
    className: '测试班',
  })
  assert.equal(reg.status, 201, JSON.stringify(reg.body))
  const app1 = await authApi('POST', `/api/approvals/${reg.body.user.id}/approve`)
  assert.equal(app1.status, 200, JSON.stringify(app1.body))
  return { cookie: reg.cookie, userId: reg.body.user.id }
}

const semesterBody = { name: '2026-2027学年第1学期', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 }

function createSemester(over = {}) {
  return authApi('POST', '/api/semesters', { ...semesterBody, ...over, classId: over.classId ?? adminClassId })
}

function courseBody(semesterId, over = {}) {
  const {
    name = '数字信号处理', type = 'course', teacher = '陈俊如', location = 'C5科教中心217',
    color = 'course-1', remark = '', weekday = 2, periods = [5, 6],
    weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], classId = adminClassId,
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

function changesOf(classId, cookie = adminCookie) {
  return asApi(cookie, 'GET', `/api/classes/${classId}/changes?limit=100`)
}

test('变更记录：列表倒序、前后快照齐全；跨班不可见；全站视图仅管理员', async () => {
  const sem = await createSemester()
  const course = await authApi('POST', '/api/courses', courseBody(sem.body.id))
  assert.equal(course.status, 201)

  const list = await changesOf(adminClassId)
  assert.equal(list.status, 200)
  assert.ok(list.body.total >= 3)
  const first = list.body.changes[0]
  assert.equal(first.entity, 'course')
  assert.equal(first.action, 'create')
  assert.equal(first.actorName, 'admin')
  assert.equal(first.before, null)
  assert.equal(first.after.name, '数字信号处理')
  assert.ok(first.after.sessions[0].periods.length)

  const onlySem = await authApi('GET', `/api/classes/${adminClassId}/changes?entity=semester`)
  assert.ok(onlySem.body.changes.every((c) => c.entity === 'semester'))

  const { cookie: cookieB } = await makeApprovedLeader('changeother')
  const clsB = await asApi(cookieB, 'POST', '/api/classes', { school: '测试学院', name: '变更B班' })
  const denied = await asApi(cookieB, 'GET', `/api/classes/${adminClassId}/changes`)
  assert.equal(denied.status, 404)
  const own = await asApi(cookieB, 'GET', `/api/classes/${clsB.body.id}/changes`)
  assert.equal(own.status, 200)
  assert.equal(own.body.total, 2, '建班 + 加入各一条')

  const forbidden = await asApi(cookieB, 'GET', '/api/changes')
  assert.equal(forbidden.status, 403)
  const all = await authApi('GET', '/api/changes?limit=50')
  assert.equal(all.status, 200)
  assert.ok(all.body.classes.some((c) => c.id === adminClassId))
  assert.ok(all.body.changes.some((c) => c.classId === adminClassId))
})

test('撤销：改课程 → 撤销那条 update，课程回到旧值并留下一条 revert 记录', async () => {
  const sem = await createSemester()
  const course = await authApi('POST', '/api/courses', courseBody(sem.body.id))
  const courseId = course.body.id
  const upd = await authApi('PUT', `/api/courses/${courseId}`, { name: '数字信号处理（改）', color: 'course-3' })
  assert.equal(upd.status, 200)

  const list = await changesOf(adminClassId)
  const target = list.body.changes.find((c) => c.entity === 'course' && c.action === 'update')
  assert.ok(target)
  const rev = await authApi('POST', `/api/changes/${target.id}/revert`)
  assert.equal(rev.status, 200, JSON.stringify(rev.body))

  const after = await authApi('GET', `/api/courses/${courseId}`)
  assert.equal(after.body.name, '数字信号处理')
  assert.equal(after.body.color, 'course-1')

  const log = await changesOf(adminClassId)
  const revertRow = log.body.changes[0]
  assert.equal(revertRow.action, 'revert')
  assert.equal(revertRow.revertOf, target.id)
  assert.equal(log.body.total, list.body.total + 1, '回退不截断历史，只追加')
})

test('撤销：删课程 → 课程、上课时间、调课记录、考试关联一起回来', async () => {
  const sem = await createSemester()
  const course = await authApi('POST', '/api/courses', courseBody(sem.body.id, { weekday: 5, periods: [7, 8] }))
  const courseId = course.body.id
  const adj = await authApi('POST', '/api/adjustments', {
    courseId,
    date: '2026-10-12',
    kind: 'move',
    fromWeekday: 1,
    fromPeriods: [7, 8],
    toDate: '2026-10-25',
    periods: [5, 6],
    note: '老师出差',
  })
  assert.equal(adj.status, 201, JSON.stringify(adj.body))
  const exam = await authApi('POST', '/api/exams', {
    semesterId: sem.body.id,
    courseId,
    name: '期中考试',
    datetime: '2026-11-10T09:00',
  })
  assert.equal(exam.status, 201, JSON.stringify(exam.body))

  assert.equal((await authApi('DELETE', `/api/courses/${courseId}`)).status, 204)
  const examAfterDelete = await authApi('GET', `/api/exams?semesterId=${sem.body.id}`)
  assert.equal(examAfterDelete.body[0].courseId, null, '删课程后考试失联')

  const list = await changesOf(adminClassId)
  const target = list.body.changes.find((c) => c.entity === 'course' && c.action === 'delete')
  const rev = await authApi('POST', `/api/changes/${target.id}/revert`)
  assert.equal(rev.status, 200, JSON.stringify(rev.body))

  const back = await authApi('GET', `/api/courses/${courseId}`)
  assert.equal(back.status, 200)
  assert.equal(back.body.sessions[0].periods.length, 2)
  const adjBack = await authApi('GET', `/api/adjustments?semesterId=${sem.body.id}`)
  assert.equal(adjBack.body.length, 1, '调课记录随课程一起回来')
  assert.equal(adjBack.body[0].note, '老师出差')
  const examBack = await authApi('GET', `/api/exams?semesterId=${sem.body.id}`)
  assert.equal(examBack.body[0].courseId, courseId, '考试关联接回来')
})

test('撤销：同一对象此后又被改过 → 409 列出冲突明细，不强制覆盖', async () => {
  const sem = await createSemester()
  const course = await authApi('POST', '/api/courses', courseBody(sem.body.id))
  const courseId = course.body.id
  await authApi('PUT', `/api/courses/${courseId}`, { name: '第一次改名' })
  await authApi('PUT', `/api/courses/${courseId}`, { name: '第二次改名' })

  const list = await changesOf(adminClassId)
  const updates = list.body.changes.filter((c) => c.entity === 'course' && c.action === 'update')
  const older = updates[updates.length - 1]
  const rev = await authApi('POST', `/api/changes/${older.id}/revert`)
  assert.equal(rev.status, 409)
  assert.equal(rev.body.code, 'CHANGE_CONFLICT')
  assert.equal(rev.body.conflicts.length, 1)

  const now = await authApi('GET', `/api/courses/${courseId}`)
  assert.equal(now.body.name, '第二次改名', '冲突时什么都不改')

  // 先撤销最新那条（回到「第一次改名」），再撤销更早那条（回到最初）——
  // 上一步的撤销记录不该挡住下一步，用户本来就在往回走
  assert.equal((await authApi('POST', `/api/changes/${updates[0].id}/revert`)).status, 200)
  assert.equal((await authApi('GET', `/api/courses/${courseId}`)).body.name, '第一次改名')
  assert.equal((await authApi('POST', `/api/changes/${older.id}/revert`)).status, 200)
  const final = await authApi('GET', `/api/courses/${courseId}`)
  assert.equal(final.body.name, '数字信号处理')
})

test('撤销：日历规则（整日移课）回到改动前；通知撤销同理', async () => {
  const sem = await createSemester()
  const semId = sem.body.id
  await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-09-29', to: '2026-10-10', kind: 'shift', note: '国庆调休' })
  const notice = await authApi('POST', '/api/notices', {
    classId: adminClassId,
    date: '2026-10-14',
    title: '临时通知',
    body: '',
    courseId: null,
    pinned: false,
  })
  assert.equal(notice.status, 201)

  const list = await changesOf(adminClassId)
  const calRow = list.body.changes.find((c) => c.entity === 'calendar')
  const revCal = await authApi('POST', `/api/changes/${calRow.id}/revert`)
  assert.equal(revCal.status, 200, JSON.stringify(revCal.body))
  const rules = await authApi('GET', `/api/calendar?semesterId=${semId}`)
  assert.deepEqual(rules.body, [], '撤销后规则表回到改动前（空）')

  const noticeRow = list.body.changes.find((c) => c.entity === 'notice')
  assert.equal((await authApi('POST', `/api/changes/${noticeRow.id}/revert`)).status, 200)
  const notices = await authApi('GET', `/api/notices?classId=${adminClassId}`)
  assert.deepEqual(notices.body, [])
})

test('撤销：成员加入 → 移出该成员；最后一人不可被移出', async () => {
  const { cookie: cookieB, userId: uidB } = await makeApprovedLeader('memberb')
  const join = await asApi(cookieB, 'POST', `/api/classes/${adminClassId}/join`)
  assert.equal(join.status, 200)
  const members = await asApi(cookieB, 'GET', `/api/classes/${adminClassId}`)
  assert.equal(members.body.members.length, 2)

  const list = await changesOf(adminClassId)
  const joinRow = list.body.changes.find((c) => c.entity === 'member' && c.actorId === uidB)
  assert.equal((await authApi('POST', `/api/changes/${joinRow.id}/revert`)).status, 200)
  const after = await authApi('GET', `/api/classes/${adminClassId}`)
  assert.equal(after.body.members.length, 1)
  assert.equal(after.body.members[0].id, 1, '留下的是原负责人')

  const list2 = await changesOf(adminClassId)
  // 取最早那条「加入」（管理员建班时的那条）——此刻已是唯一负责人
  const ownJoin = list2.body.changes.filter((c) => c.entity === 'member' && c.action === 'join').pop()
  const denied = await authApi('POST', `/api/changes/${ownJoin.id}/revert`)
  assert.equal(denied.status, 400)
  assert.match(denied.body.message, /一个负责人都不剩/)
})

test('整班回退：回到某条记录的「改完」状态，并记一条 rollback', async () => {
  const sem = await createSemester()
  const course = await authApi('POST', '/api/courses', courseBody(sem.body.id))
  const courseId = course.body.id
  assert.equal((await authApi('PUT', `/api/courses/${courseId}`, { name: '改过的名字' })).status, 200)
  await authApi('PUT', `/api/courses/${courseId}`, { name: '又改一次', color: 'course-5' })

  const list = await changesOf(adminClassId)
  const renameRow = list.body.changes.find(
    (c) => c.entity === 'course' && c.action === 'update' && c.after.name === '改过的名字',
  )
  assert.ok(renameRow)

  const back = await authApi('POST', `/api/classes/${adminClassId}/rollback`, { changeId: renameRow.id })
  assert.equal(back.status, 200, JSON.stringify(back.body))
  assert.equal(back.body.discarded, 1, '丢掉的是「又改一次」那条')

  const now = await authApi('GET', `/api/courses/${courseId}`)
  assert.equal(now.body.name, '改过的名字')
  assert.equal(now.body.color, 'course-1', '颜色回到那条记录时的样子')
  const log = await changesOf(adminClassId)
  assert.equal(log.body.changes[0].action, 'rollback')
  assert.equal(log.body.changes[0].revertOf, renameRow.id)

  // 再回到这条记录「改之前」→ 名字回到最初，且上课时间一行不丢
  const back2 = await authApi('POST', `/api/classes/${adminClassId}/rollback`, { changeId: renameRow.id, before: true })
  assert.equal(back2.status, 200, JSON.stringify(back2.body))
  const first = await authApi('GET', `/api/courses/${courseId}`)
  assert.equal(first.body.name, '数字信号处理')
  assert.equal(first.body.sessions[0].periods.length, 2)
})

test('整班回退：拿整班快照当起点、再重放其后的实体改动——课表一行不丢', async () => {
  const sem = await createSemester()
  const semId = sem.body.id
  const c1 = await authApi('POST', '/api/courses', courseBody(semId, { name: '高等数学', weekday: 1, periods: [1, 2], weeks: [1, 2, 3] }))
  const c2 = await authApi('POST', '/api/courses', courseBody(semId, { name: '大学英语', weekday: 3, periods: [5, 6], weeks: [1, 2, 3] }))
  assert.equal(c1.status, 201)
  assert.equal(c2.status, 201)
  // 日历规则（整班级记录 → 从此有一条带整班快照的记录可当起点）
  await authApi('PUT', '/api/calendar', { semesterId: semId, from: '2026-09-29', to: '2026-10-10', kind: 'shift', note: '国庆调休' })
  // 之后再来一条实体级改动
  const rename = await authApi('PUT', `/api/courses/${c1.body.id}`, { name: '高等数学（改）' })
  assert.equal(rename.status, 200)

  const list = await changesOf(adminClassId)
  const row = list.body.changes.find((c) => c.entity === 'course' && c.action === 'update')
  assert.ok(row)
  const back = await authApi('POST', `/api/classes/${adminClassId}/rollback`, { changeId: row.id })
  assert.equal(back.status, 200, JSON.stringify(back.body))

  // 两门课都在、格子一行不丢、日历规则还在、名字是改后的
  const courses = await authApi('GET', `/api/courses?semesterId=${semId}`)
  assert.equal(courses.body.length, 2, '整班快照当起点时，别的课程不能被弄丢')
  assert.equal(courses.body.find((c) => c.name === '高等数学（改）').sessions[0].periods.length, 2)
  assert.equal(courses.body.find((c) => c.name === '大学英语').sessions[0].weeks.length, 3)
  const slots = db.prepare('SELECT COUNT(*) AS n FROM course_slot').get().n
  assert.equal(slots, 12, '2 门课 × 2 节 × 3 周')
  const rules = await authApi('GET', `/api/calendar?semesterId=${semId}`)
  assert.equal(rules.body.length, 1, '日历规则要跟着回来')
})

test('整班回退：新建的班从建班那一刻起就能回退（建班记录带整班快照）', async () => {
  const { cookie: cookieB } = await makeApprovedLeader('freshclass')
  const clsB = await asApi(cookieB, 'POST', '/api/classes', { school: '测试学院', name: '新班' })
  const clsId = clsB.body.id
  const semB = await asApi(cookieB, 'POST', '/api/semesters', { ...semesterBody, classId: clsId })
  await asApi(cookieB, 'POST', '/api/courses', courseBody(semB.body.id, { name: '线性代数', classId: clsId }))

  const log = await asApi(cookieB, 'GET', `/api/classes/${clsId}/changes?limit=50`)
  const createRow = log.body.changes.filter((c) => c.entity === 'class' && c.action === 'create').pop()
  assert.deepEqual(createRow.after.semesters, [], '建班记录里就是一份空班的整班快照')

  // 回退到刚建完班那一刻：学期与课程都没了，但班级本身还在
  const back = await asApi(cookieB, 'POST', `/api/classes/${clsId}/rollback`, { changeId: createRow.id })
  assert.equal(back.status, 200, JSON.stringify(back.body))
  const sems = await asApi(cookieB, 'GET', `/api/semesters?classId=${clsId}`)
  assert.deepEqual(sems.body, [])
  const cls = await asApi(cookieB, 'GET', `/api/classes/${clsId}`)
  assert.equal(cls.status, 200, '班级本身还在')
  assert.equal(cls.body.name, '新班')
})

test('整班回退：起点太早（此前没有任何整班快照）→ 明确报错，不把班清空', async () => {
  // 直接往 change_log 里塞一条「早于所有整班快照」的课程改动，模拟老库早期的记录
  const sem = await createSemester()
  const course = await authApi('POST', '/api/courses', courseBody(sem.body.id))
  const first = db.prepare('SELECT MIN(id) AS id FROM change_log WHERE class_id = ?').get(adminClassId).id
  db.prepare(
    `INSERT INTO change_log (class_id, actor_id, action, entity, entity_id, before, after, created_at)
     VALUES (?, 1, 'update', 'course', ?, ?, ?, ?)`,
  ).run(adminClassId, course.body.id, JSON.stringify({ id: course.body.id, name: '旧名' }), JSON.stringify({ id: course.body.id, name: '新名' }), new Date().toISOString())
  const inserted = db.prepare('SELECT MAX(id) AS id FROM change_log WHERE class_id = ?').get(adminClassId).id
  db.prepare('UPDATE change_log SET id = ? WHERE id = ?').run(first - 1, inserted) // 排到最早

  const back = await authApi('POST', `/api/classes/${adminClassId}/rollback`, { changeId: first - 1 })
  assert.equal(back.status, 400)
  assert.match(back.body.message, /整班快照/)
  const courses = await authApi('GET', `/api/courses?semesterId=${sem.body.id}`)
  assert.equal(courses.body.length, 1, '报错时一行都不能动')
})

test('整班回退：删班记录只在平台视图可见；单条撤销整班记录会被引导去整班回退', async () => {
  const { cookie: cookieB } = await makeApprovedLeader('rollbacker')
  const clsB = await asApi(cookieB, 'POST', '/api/classes', { school: '测试学院', name: '回退B班' })
  const semB = await asApi(cookieB, 'POST', '/api/semesters', { ...semesterBody, classId: clsB.body.id })
  assert.equal((await asApi(cookieB, 'POST', '/api/courses', courseBody(semB.body.id))).status, 201)

  assert.equal((await asApi(cookieB, 'DELETE', `/api/classes/${clsB.body.id}`)).status, 200)
  assert.equal((await asApi(cookieB, 'GET', `/api/classes/${clsB.body.id}/changes`)).status, 404, '班没了，入口也没了')

  const all = await authApi('GET', '/api/changes?platform=1&limit=50')
  const delRow = all.body.changes.find((c) => c.entity === 'class_state' && c.action === 'delete' && c.entityId === clsB.body.id)
  assert.ok(delRow, '删班记录在平台级视图里')

  const rev = await authApi('POST', `/api/changes/${delRow.id}/revert`)
  assert.equal(rev.status, 400)
  assert.match(rev.body.message, /整班回退/)
})
