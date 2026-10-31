// ============================================================
// ClassBoard · 班级与成员（归属判定的唯一入口）
//   归属链：user ← class_member → class → semester → {period_template, course, exam, homework}
//   所有业务路由都经这里判定归属，不直接查 user_id
// ============================================================
import { db, toClass } from './db.js'
import { badRequest, notFound } from './errors.js'

/** 用户是否为该班成员（同级，无 owner 之分） */
export function isClassMember(classId, userId) {
  if (!classId || !userId) return false
  return !!db.prepare('SELECT 1 FROM class_member WHERE class_id = ? AND user_id = ?').get(classId, userId)
}

/** 用户所属的班级 id 列表 */
export function classIdsOfUser(userId) {
  return db
    .prepare('SELECT class_id FROM class_member WHERE user_id = ? ORDER BY class_id ASC')
    .all(userId)
    .map((r) => r.class_id)
}

/** 班级行（含成员数、学期数、我是否成员） */
export function classSummary(row) {
  const semesters = db.prepare('SELECT COUNT(*) AS c FROM semester WHERE class_id = ?').get(row.id).c
  const members = db.prepare('SELECT COUNT(*) AS c FROM class_member WHERE class_id = ?').get(row.id).c
  return { ...toClass(row), semesterCount: semesters, memberCount: members }
}

/** 用户所属的班级列表（负责人后台用） */
export function listClassesOfUser(userId) {
  return db
    .prepare(
      `SELECT c.* FROM class c JOIN class_member m ON m.class_id = c.id
        WHERE m.user_id = ? ORDER BY c.updated_at DESC, c.id DESC`,
    )
    .all(userId)
    .map(classSummary)
}

/** 按 学校 + 班级名 查班（去重键） */
export function findClassByKey(school, name) {
  return db.prepare('SELECT * FROM class WHERE school = ? AND name = ?').get(school, name) ?? null
}

/** 班级行（校验调用者是否为成员；不是则 null） */
export function memberClass(classId, userId) {
  const row = db.prepare('SELECT * FROM class WHERE id = ?').get(classId)
  if (!row || !isClassMember(row.id, userId)) return null
  return row
}

/** 学期行（校验调用者是否为该班成员） */
export function memberSemester(semesterId, userId) {
  const row = db.prepare('SELECT * FROM semester WHERE id = ?').get(semesterId)
  if (!row || !isClassMember(row.class_id, userId)) return null
  return row
}

/** 课程行（校验调用者是否为该课所在学期的班级成员） */
export function memberCourse(courseId, userId) {
  const row = db.prepare('SELECT * FROM course WHERE id = ?').get(courseId)
  if (!row) return null
  const sem = db.prepare('SELECT class_id FROM semester WHERE id = ?').get(row.semester_id)
  if (!sem || !isClassMember(sem.class_id, userId)) return null
  return row
}

/** 班级成员列表（含用户名） */
export function classMembers(classId) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.role, m.joined_at AS joinedAt
         FROM class_member m JOIN user u ON u.id = m.user_id
        WHERE m.class_id = ? ORDER BY m.joined_at ASC, u.id ASC`,
    )
    .all(classId)
}

/**
 * 建班：学校 + 班级名 已存在时不新建，返回已存在的班供调用方「同名即加入」。
 * @returns {{ created: boolean, class: object, memberCount?: number }}
 */
export function createClass({ school, name, major = '', city = '', userId }) {
  const existing = findClassByKey(school, name)
  if (existing) return { created: false, class: existing }
  const now = new Date().toISOString()
  const info = db
    .prepare(
      'INSERT INTO class (school, name, major, city, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(school, name, major, city, userId, now, now)
  const classId = info.lastInsertRowid
  joinClass(classId, userId)
  return { created: true, class: db.prepare('SELECT * FROM class WHERE id = ?').get(classId) }
}

/** 加入班级（同级负责人） */
export function joinClass(classId, userId) {
  const row = db.prepare('SELECT id FROM class WHERE id = ?').get(classId)
  if (!row) return false
  db.prepare('INSERT OR IGNORE INTO class_member (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    classId,
    userId,
    new Date().toISOString(),
  )
  return true
}

/** 退出班级；返回该班是否已被删除（最后一人退出即删班） */
export function leaveClass(classId, userId) {
  db.prepare('DELETE FROM class_member WHERE class_id = ? AND user_id = ?').run(classId, userId)
  const left = db.prepare('SELECT COUNT(*) AS c FROM class_member WHERE class_id = ?').get(classId).c
  if (left === 0) {
    deleteClass(classId)
    return { deleted: true }
  }
  return { deleted: false }
}

/** 删除班级（级联删除其全部数据） */
export function deleteClass(classId) {
  db.prepare('DELETE FROM class WHERE id = ?').run(classId)
}

/** 班级下的学期列表（按起始日期） */
export function semestersOfClass(classId) {
  return db
    .prepare('SELECT * FROM semester WHERE class_id = ? ORDER BY start_date ASC, id ASC')
    .all(classId)
}

/**
 * 从请求里取 classId（query 或 body）并校验成员身份；供各业务路由统一使用。
 * @returns 班级行
 */
export function classFromRequest(req) {
  const raw = req.query?.classId ?? req.body?.classId
  const classId = Number(raw)
  if (raw === undefined || raw === null || raw === '' || !Number.isInteger(classId)) {
    throw badRequest('缺少 classId')
  }
  const cls = memberClass(classId, req.user.id)
  if (!cls) throw notFound('班级不存在')
  return cls
}
