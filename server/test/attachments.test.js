// ============================================================
// ClassBoard · 作业 / 考试附件（图片内联 + 可下载文件）
//   上传 / 删除 / 公开下载头 / 权限与限制 / 级联 / 撤销恢复 / 备份往返（含内容 sha256 校验）
// ============================================================
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpDir = mkdtempSync(join(tmpdir(), 'classboard-attach-'))
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

/** 1×1 透明 PNG（67 字节） */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

/** multipart 上传（examId 与 homeworkId 二选一） */
async function upload(cookie, { examId, homeworkId, name = 'photo.png', type = 'image/png', bytes = PNG }) {
  const form = new FormData()
  if (examId != null) form.append('examId', String(examId))
  if (homeworkId != null) form.append('homeworkId', String(homeworkId))
  form.append('file', new Blob([bytes], { type }), name)
  const res = await fetch(base + '/api/attachments', {
    method: 'POST',
    headers: { Cookie: `classboard_session=${cookie}` },
    body: form,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** 公开下载（不带任何凭据） */
async function publicDownload(id) {
  const res = await fetch(base + `/api/public/attachments/${id}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    buf,
    mime: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition'),
    nosniff: res.headers.get('x-content-type-options'),
    cache: res.headers.get('cache-control'),
  }
}

async function backupPayload(cookie = adminCookie) {
  const res = await fetch(base + '/api/backup', { headers: { Cookie: `classboard_session=${cookie}` } })
  return { status: res.status, payload: await res.json() }
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

async function makeMatters(cookie = null, classId = null) {
  const sem = cookie
    ? await asApi(cookie, 'POST', '/api/semesters', { ...semesterBody, classId })
    : await authApi('POST', '/api/semesters', { ...semesterBody, classId: adminClassId })
  assert.equal(sem.status, 201, JSON.stringify(sem.body))
  const hw = cookie
    ? await asApi(cookie, 'POST', '/api/homework', { semesterId: sem.body.id, name: '第三章习题', dueAt: '2026-10-20T22:00' })
    : await authApi('POST', '/api/homework', { semesterId: sem.body.id, name: '第三章习题', dueAt: '2026-10-20T22:00' })
  assert.equal(hw.status, 201, JSON.stringify(hw.body))
  const exam = cookie
    ? await asApi(cookie, 'POST', '/api/exams', {
        semesterId: sem.body.id, name: '期中考试', datetime: '2026-10-18T09:00', location: 'C5-217',
      })
    : await authApi('POST', '/api/exams', {
        semesterId: sem.body.id, name: '期中考试', datetime: '2026-10-18T09:00', location: 'C5-217',
      })
  assert.equal(exam.status, 201, JSON.stringify(exam.body))
  return { semesterId: sem.body.id, homeworkId: hw.body.id, examId: exam.body.id }
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
    'DELETE FROM change_log; DELETE FROM notice; DELETE FROM class_member; DELETE FROM class; ' +
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

test('上传图片到作业：元数据随作业返回；公开面未登录可直接内联查看，字节一致', async () => {
  const { homeworkId } = await makeMatters()
  const { status, body } = await upload(adminCookie, { homeworkId, name: '题目.png' })
  assert.equal(status, 201, JSON.stringify(body))
  assert.equal(body.kind, 'image')
  assert.equal(body.name, '题目.png')
  assert.equal(body.size, PNG.length)

  const list = await authApi('GET', `/api/homework?semesterId=${body.attachmentsSemesterId ?? ''}`)
  // 直接查指定学期
  const semId = db.prepare('SELECT semester_id FROM homework WHERE id = ?').get(homeworkId).semester_id
  const list2 = await authApi('GET', `/api/homework?semesterId=${semId}`)
  assert.equal(list2.status, 200)
  const hwRow = list2.body.find((h) => h.id === homeworkId)
  assert.equal(hwRow.attachments.length, 1)
  assert.equal(hwRow.attachments[0].sha256, body.sha256)
  void list

  // 公开：通知面不泄露账号信息，但附件按对象可见性开放（无需登录）
  const pub = await publicDownload(body.id)
  assert.equal(pub.status, 200)
  assert.equal(pub.mime, 'image/png')
  assert.match(pub.disposition, /^inline/)
  assert.equal(pub.nosniff, 'nosniff')
  assert.match(pub.cache, /immutable/)
  assert.ok(pub.buf.equals(PNG), '下载内容应与上传字节一致')
})

test('上传 PDF 附件：下载头为 attachment（可保存），文件名 UTF-8 编码', async () => {
  const { examId } = await makeMatters()
  const pdf = Buffer.from('%PDF-1.4 fake for test')
  const { status, body } = await upload(adminCookie, { examId, name: '考试范围说明.pdf', type: 'application/pdf', bytes: pdf })
  assert.equal(status, 201, JSON.stringify(body))
  assert.equal(body.kind, 'file')

  const pub = await publicDownload(body.id)
  assert.equal(pub.status, 200)
  assert.equal(pub.mime, 'application/octet-stream')
  assert.match(pub.disposition, /^attachment/)
  assert.ok(pub.disposition.includes(encodeURIComponent('考试范围说明.pdf')))
  assert.ok(pub.buf.equals(pdf))
})

test('权限：非本班负责人不能上传 / 删除；公开下载不需要登录', async () => {
  const { homeworkId } = await makeMatters()
  const { body: att } = await upload(adminCookie, { homeworkId })

  const { cookie: other } = await makeApprovedLeader('outsider')
  await asApi(other, 'POST', '/api/classes', { school: '测试学院', name: '别的班' })

  const denied = await upload(other, { homeworkId })
  assert.equal(denied.status, 404, JSON.stringify(denied.body))
  const del = await asApi(other, 'DELETE', `/api/attachments/${att.id}`)
  assert.equal(del.status, 404)

  // 仍可公开下载
  assert.equal((await publicDownload(att.id)).status, 200)
})

test('校验：examId / homeworkId 必须二选一；对象必须存在；超数量上限被拒', async () => {
  const { homeworkId, examId } = await makeMatters()
  assert.equal((await upload(adminCookie, {})).status, 400)
  assert.equal((await upload(adminCookie, { homeworkId, examId })).status, 400)
  assert.equal((await upload(adminCookie, { homeworkId: 999999 })).status, 404)

  for (let i = 0; i < 10; i++) {
    const r = await upload(adminCookie, { homeworkId, name: `f${i}.png` })
    assert.equal(r.status, 201, `第 ${i + 1} 个：${JSON.stringify(r.body)}`)
  }
  const over = await upload(adminCookie, { homeworkId, name: 'f10.png' })
  assert.equal(over.status, 400)
  assert.match(over.body.message, /最多/)
})

test('限制：超过 20 MB 的文件被拒（413），库中不留痕', async () => {
  const { homeworkId } = await makeMatters()
  const big = Buffer.alloc(20 * 1024 * 1024 + 1024, 7)
  const r = await upload(adminCookie, { homeworkId, name: 'huge.bin', type: 'application/octet-stream', bytes: big })
  assert.equal(r.status, 413, JSON.stringify(r.body))
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM attachment').get().c, 0)
})

test('级联：删作业 → 附件元数据随行消失、公开链接 404；撤销删作业 → 附件原样回来', async () => {
  const { homeworkId } = await makeMatters()
  const { body: att } = await upload(adminCookie, { homeworkId, name: '图.png' })

  assert.equal((await authApi('DELETE', `/api/homework/${homeworkId}`)).status, 204)
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM attachment').get().c, 0)
  assert.equal((await publicDownload(att.id)).status, 404)

  const del = db.prepare("SELECT id FROM change_log WHERE entity = 'homework' AND action = 'delete'").get()
  assert.equal((await authApi('POST', `/api/changes/${del.id}/revert`)).status, 200)
  const back = db.prepare('SELECT * FROM attachment WHERE id = ?').get(att.id)
  assert.ok(back, '撤销后附件元数据应回到原 id')
  assert.equal(back.homework_id, homeworkId)
  const pub = await publicDownload(att.id)
  assert.equal(pub.status, 200)
  assert.ok(pub.buf.equals(PNG), '撤销后内容应按 sha256 原样接回')
})

test('撤销：删附件 → 恢复（同 id、可下载）；撤销「上传附件」→ 又消失', async () => {
  const { homeworkId } = await makeMatters()
  const { body: att } = await upload(adminCookie, { homeworkId })
  assert.equal((await authApi('DELETE', `/api/attachments/${att.id}`)).status, 204)
  assert.equal((await publicDownload(att.id)).status, 404)

  const del = db.prepare("SELECT id FROM change_log WHERE entity = 'attachment' AND action = 'delete'").get()
  assert.equal((await authApi('POST', `/api/changes/${del.id}/revert`)).status, 200)
  assert.equal((await publicDownload(att.id)).status, 200)

  const create = db.prepare("SELECT id FROM change_log WHERE entity = 'attachment' AND action = 'create'").get()
  assert.equal((await authApi('POST', `/api/changes/${create.id}/revert`)).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM attachment').get().c, 0)
  assert.equal((await publicDownload(att.id)).status, 404)
})

test('备份往返：导出含附件元数据与内容；导入新班级后内容可下载且字节一致', async () => {
  const { homeworkId, examId } = await makeMatters()
  const pdf = Buffer.from('attachment content for round-trip')
  const { body: attHw } = await upload(adminCookie, { homeworkId, name: 'photo.png' })
  const { body: attExam } = await upload(adminCookie, { examId, name: '范围.pdf', type: 'application/pdf', bytes: pdf })

  const { payload } = await backupPayload()
  assert.equal(payload.attachments.length, 2)
  assert.ok(payload.blobs[attHw.sha256], '导出应内嵌附件内容（base64）')
  assert.ok(payload.blobs[attExam.sha256])

  const imported = await restoreBackup(payload, { school: '测试学院', name: '导入的另一个班' })
  assert.equal(imported.status, 200, JSON.stringify(imported.body))
  assert.equal(imported.body.restored.attachments, 2)

  // 新班级的附件：挂在重编后的作业 / 考试上，内容按 sha256 原样可用
  const rows = db
    .prepare('SELECT a.* FROM attachment a JOIN homework h ON h.id = a.homework_id JOIN semester s ON s.id = h.semester_id WHERE s.class_id = ?')
    .all(imported.body.restored.classId)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'photo.png')
  const pub = await publicDownload(rows[0].id)
  assert.equal(pub.status, 200)
  assert.ok(pub.buf.equals(PNG))

  const rows2 = db
    .prepare('SELECT a.* FROM attachment a JOIN exam e ON e.id = a.exam_id JOIN semester s ON s.id = e.semester_id WHERE s.class_id = ?')
    .all(imported.body.restored.classId)
  assert.equal(rows2.length, 1)
  const pub2 = await publicDownload(rows2[0].id)
  assert.equal(pub2.status, 200)
  assert.ok(pub2.buf.equals(pdf))
})

test('备份往返：覆盖导入回原班（沿用原 id）后附件仍在原位', async () => {
  const { semesterId, homeworkId } = await makeMatters()
  const { body: att } = await upload(adminCookie, { homeworkId })
  const { payload } = await backupPayload()

  const restored = await restoreBackup(payload, { classId: adminClassId })
  assert.equal(restored.status, 200, JSON.stringify(restored.body))
  const rows = db
    .prepare('SELECT a.* FROM attachment a JOIN homework h ON h.id = a.homework_id WHERE h.semester_id = ?')
    .all(semesterId)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].homework_id, homeworkId, '覆盖导入沿用原作业 id，附件仍挂在它上面')
  const pub = await publicDownload(rows[0].id)
  assert.ok(pub.buf.equals(PNG))
  void att
})

test('导入校验：附件内容缺失或与 sha256 不符 → 整批拒绝（400），不改动数据', async () => {
  const { homeworkId } = await makeMatters()
  await upload(adminCookie, { homeworkId })
  const { payload } = await backupPayload()
  // 模拟「换一台机器导入」：本机 blob 池里还没有这些内容，一切只能靠备份自带的 base64
  db.prepare('DELETE FROM blob').run()

  const missing = structuredClone(payload)
  missing.blobs = {}
  const r1 = await restoreBackup(missing, { classId: adminClassId })
  assert.equal(r1.status, 400)
  assert.match(r1.body.message, /附件内容缺失/)
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM attachment').get().c, 1, '拒绝时不应改动现有数据')

  const tampered = structuredClone(payload)
  const sha = payload.attachments[0].sha256
  tampered.blobs[sha] = Buffer.from('tampered-content').toString('base64')
  const r2 = await restoreBackup(tampered, { classId: adminClassId })
  assert.equal(r2.status, 400)
  assert.match(r2.body.message, /内容与校验值不符/)
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM attachment').get().c, 1)
})
