// ============================================================
// ClassBoard · 回退引擎（变更记录的逆操作）
//   单条撤销：把某条记录涉及的实体恢复成它的 before 快照（before 为 null = 该实体当时还不存在 → 删除）
//   整班回退：把整个班级恢复成某条记录 after 里的班级状态（先清后建，保留原 id）
//   两条路径都只写库、不做校验（校验属于各业务路由），但会守住「不能把数据弄成半截」的底线：
//   保留至少一名负责人、唯一键冲突给出可读提示、外键悬空的行按 null 处理。
// ============================================================
import { db } from './db.js'
import { badRequest } from './errors.js'

/** 能逐条回退的实体（其余实体只能整班回退：class_state / calendar 大操作 / user） */
export const REVERTIBLE = new Set([
  'class',
  'member',
  'semester',
  'period',
  'course',
  'exam',
  'homework',
  'adjustment',
  'notice',
  'day_rule',
  'calendar',
])

// ------------------------------------------------------------
// 写入原语（都按显式 id 写，恢复出来的行与原来同 id，便于链式回退）
// ------------------------------------------------------------

function insertSemesterSubtree(sem) {
  if (db.prepare('SELECT 1 FROM semester WHERE id = ?').get(sem.id)) {
    db.prepare('DELETE FROM semester WHERE id = ?').run(sem.id) // 级联清掉旧子树
  }
  db.prepare(
    `INSERT INTO semester (id, class_id, name, start_date, end_date, week_start_day, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sem.id,
    sem.classId ?? sem.class_id,
    sem.name,
    sem.startDate ?? sem.start_date,
    sem.endDate ?? sem.end_date,
    sem.weekStartDay ?? sem.week_start_day,
    sem.updatedAt ?? sem.updated_at ?? new Date().toISOString(),
  )
  const insPeriod = db.prepare(
    'INSERT INTO period_template (id, semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
  )
  for (const p of sem.periods ?? []) insPeriod.run(p.id, sem.id, p.index, p.startTime, p.endTime)

  const insCourse = db.prepare(
    `INSERT INTO course (id, semester_id, type, name, teacher, location, color, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insSession = db.prepare('INSERT INTO course_session (id, course_id, weekday, location) VALUES (?, ?, ?, ?)')
  const insSlot = db.prepare('INSERT INTO course_slot (id, session_id, period, week) VALUES (?, ?, ?, ?)')
  const courseIds = new Set()
  for (const c of sem.courses ?? []) {
    courseIds.add(c.id)
    insCourse.run(c.id, sem.id, c.type, c.name, c.teacher ?? '', c.location ?? '', c.color ?? 'course-1', c.remark ?? '')
    for (const s of c.sessions ?? []) {
      insSession.run(s.id, c.id, s.weekday, s.location ?? '')
      for (const period of s.periods ?? []) {
        for (const week of s.weeks ?? []) insSlot.run(null, s.id, period, week)
      }
    }
  }

  const insExam = db.prepare(
    'INSERT INTO exam (id, semester_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  // 课程引用只保留确实在本子树里的（否则置空，避免外键悬空）
  for (const e of sem.exams ?? []) {
    insExam.run(e.id, sem.id, courseIds.has(e.courseId) ? e.courseId : null, e.name, e.datetime, e.location ?? '', e.remark ?? '')
  }
  const insHomework = db.prepare(
    'INSERT INTO homework (id, semester_id, course_id, name, due_at, remark) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const h of sem.homework ?? []) {
    insHomework.run(h.id, sem.id, courseIds.has(h.courseId) ? h.courseId : null, h.name, h.dueAt, h.remark ?? '')
  }

  const insRule = db.prepare(
    'INSERT INTO semester_day_rule (id, semester_id, date, kind, to_date, note) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const r of sem.dayRules ?? []) insRule.run(r.id, sem.id, r.date, r.kind, r.toDate ?? null, r.note ?? '')

  const insAdjust = db.prepare(
    `INSERT INTO course_adjustment (id, course_id, date, kind, from_weekday, from_periods, to_date, periods, location, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const a of sem.adjustments ?? []) {
    if (!courseIds.has(a.courseId)) continue
    insAdjust.run(
      a.id,
      a.courseId,
      a.date,
      a.kind,
      a.fromWeekday ?? null,
      JSON.stringify(a.fromPeriods ?? []),
      a.toDate ?? null,
      JSON.stringify(a.periods ?? []),
      a.location ?? '',
      a.note ?? '',
      a.createdAt ?? new Date().toISOString(),
    )
  }
}

function insertNotice(n) {
  db.prepare(
    `INSERT INTO notice (id, class_id, date, title, body, course_id, pinned, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    n.id,
    n.classId ?? n.class_id,
    n.date,
    n.title,
    n.body ?? '',
    // 课程可能已不在（被删/跨学期还原）→ 置空，通知本身仍然成立
    n.courseId != null && db.prepare('SELECT 1 FROM course WHERE id = ?').get(n.courseId) ? n.courseId : null,
    n.pinned ? 1 : 0,
    n.authorId != null && db.prepare('SELECT 1 FROM user WHERE id = ?').get(n.authorId) ? n.authorId : null,
    n.createdAt ?? new Date().toISOString(),
    n.updatedAt ?? new Date().toISOString(),
  )
}

function upsertClassRow(cls) {
  const exists = db.prepare('SELECT 1 FROM class WHERE id = ?').get(cls.id)
  if (exists) {
    db.prepare(
      `UPDATE class SET school = ?, name = ?, major = ?, city = ?, current_semester_id = NULL, updated_at = ? WHERE id = ?`,
    ).run(cls.school, cls.name, cls.major ?? '', cls.city ?? '', new Date().toISOString(), cls.id)
    return
  }
  db.prepare(
    `INSERT INTO class (id, school, name, major, city, current_semester_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    cls.id,
    cls.school,
    cls.name,
    cls.major ?? '',
    cls.city ?? '',
    cls.created_by ?? null,
    cls.created_at ?? new Date().toISOString(),
    new Date().toISOString(),
  )
}

/** 清空一个班的全部数据（不删 class 行本身） */
function wipeClassData(classId) {
  db.prepare('DELETE FROM notice WHERE class_id = ?').run(classId)
  db.prepare('DELETE FROM class_member WHERE class_id = ?').run(classId)
  db.prepare('UPDATE class SET current_semester_id = NULL WHERE id = ?').run(classId)
  const semIds = db.prepare('SELECT id FROM semester WHERE class_id = ?').all(classId).map((r) => r.id)
  if (semIds.length) {
    const ph = semIds.map(() => '?').join(',')
    db.prepare(`DELETE FROM course WHERE semester_id IN (${ph})`).run(...semIds) // 级联：时间组/格子/调整
    db.prepare(`DELETE FROM semester WHERE id IN (${ph})`).run(...semIds) // 级联：节次/考试/作业/日历
  }
}

function fixCurrentSemester(classId, wantSemesterId) {
  const cls = db.prepare('SELECT * FROM class WHERE id = ?').get(classId)
  if (!cls) return
  if (cls.current_semester_id != null) {
    const stillThere = db.prepare('SELECT 1 FROM semester WHERE id = ?').get(cls.current_semester_id)
    if (stillThere) return
  }
  const target = wantSemesterId ?? db
    .prepare('SELECT id FROM semester WHERE class_id = ? ORDER BY start_date ASC, id ASC LIMIT 1')
    .get(classId)?.id ?? null
  db.prepare('UPDATE class SET current_semester_id = ? WHERE id = ?').run(target, classId)
}

// ------------------------------------------------------------
// 整班回退
// ------------------------------------------------------------

/** 把班级恢复到快照状态（先清后建；用于「回退到这里」与撤销整班级操作） */
export function applyClassState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.id == null) {
    throw badRequest('这条记录没有可用的班级快照，无法回退')
  }
  const classId = snapshot.id
  const apply = db.transaction(() => {
    wipeClassData(classId)
    upsertClassRow(snapshot)
    for (const m of snapshot.members ?? []) {
      const uid = m.user_id ?? m.userId
      const joined = m.joined_at ?? m.joinedAt ?? new Date().toISOString()
      if (!uid || !db.prepare('SELECT 1 FROM user WHERE id = ?').get(uid)) continue
      db.prepare('INSERT OR REPLACE INTO class_member (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(classId, uid, joined)
    }
    // 整班快照里的节次 / 课程 / 考试…是**平铺**在顶层的（按 semesterId 归属），
    // 而 insertSemesterSubtree 吃的是「学期子树」结构 —— 这里按学期分好再插，
    // 否则回退出来的班只有学期壳子，课表全丢（P4 演练抓到的坑）。
    const pool = {
      periods: snapshot.periods ?? [],
      courses: snapshot.courses ?? [],
      exams: snapshot.exams ?? [],
      homework: snapshot.homework ?? [],
      dayRules: snapshot.dayRules ?? [],
      adjustments: snapshot.adjustments ?? [],
    }
    for (const sem of snapshot.semesters ?? []) {
      const courseIds = new Set(pool.courses.filter((c) => (c.semesterId ?? c.semester_id) === sem.id).map((c) => c.id))
      insertSemesterSubtree({
        ...sem,
        periods: pool.periods.filter((p) => (p.semesterId ?? p.semester_id) === sem.id),
        courses: pool.courses.filter((c) => (c.semesterId ?? c.semester_id) === sem.id),
        exams: pool.exams.filter((e) => (e.semesterId ?? e.semester_id) === sem.id),
        homework: pool.homework.filter((h) => (h.semesterId ?? h.semester_id) === sem.id),
        dayRules: pool.dayRules.filter((r) => (r.semesterId ?? r.semester_id) === sem.id),
        adjustments: pool.adjustments.filter((a) => courseIds.has(a.courseId ?? a.course_id)),
      })
    }
    for (const n of snapshot.notices ?? []) insertNotice(n)
  })
  try {
    apply()
  } catch (e) {
    if (String(e?.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      throw badRequest(`回退失败：${e.message}（多半是班级或学期名已被占用，请先处理冲突数据）`)
    }
    throw e
  }
  fixCurrentSemester(classId, null)
}

// ------------------------------------------------------------
// 单条撤销：实体级逆操作
// ------------------------------------------------------------

/** 把一个实体恢复成快照（snapshot 为 null = 删除该实体） */
export function restoreEntity({ entity, entityId, classId, before }) {
  switch (entity) {
    case 'class': {
      if (!before) {
        db.prepare('DELETE FROM class WHERE id = ?').run(entityId)
        return
      }
      db.prepare('UPDATE class SET school = ?, name = ?, major = ?, city = ? WHERE id = ?').run(
        before.school,
        before.name,
        before.major ?? '',
        before.city ?? '',
        entityId,
      )
      return
    }
    case 'member': {
      const uid = before?.userId ?? before?.user_id ?? entityId
      if (!before) {
        const members = db.prepare('SELECT user_id FROM class_member WHERE class_id = ?').all(classId)
        if (members.length <= 1) {
          throw badRequest('撤销后班级会一个负责人都不剩；如果要撤销建班，请撤销「创建班级」那条记录或改用整班回退')
        }
        db.prepare('DELETE FROM class_member WHERE class_id = ? AND user_id = ?').run(classId, uid)
        return
      }
      if (!db.prepare('SELECT 1 FROM user WHERE id = ?').get(uid)) {
        throw badRequest('这位负责人的账号已被删除，无法恢复其班级成员身份')
      }
      db.prepare('INSERT OR REPLACE INTO class_member (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(
        classId,
        uid,
        before.joined_at ?? before.joinedAt ?? new Date().toISOString(),
      )
      return
    }
    case 'semester': {
      const semClassId = before?.classId ?? before?.class_id ?? classId
      db.prepare('DELETE FROM semester WHERE id = ?').run(entityId)
      if (before) insertSemesterSubtree(before)
      fixCurrentSemester(semClassId, before ? entityId : null)
      return
    }
    case 'period': {
      const row = db.prepare('SELECT * FROM period_template WHERE id = ?').get(entityId)
      if (!before) {
        if (!row) return
        // 与「删节次」同构：该节次上的格子随之移除，后续节次整体前移
        const filt = `session_id IN (SELECT cs.id FROM course_session cs JOIN course c ON c.id = cs.course_id WHERE c.semester_id = ?)`
        db.prepare(`DELETE FROM course_slot WHERE period = ? AND ${filt}`).run(row.period_index, row.semester_id)
        const shifting = db
          .prepare(`SELECT DISTINCT period AS p FROM course_slot WHERE period > ? AND ${filt} ORDER BY p ASC`)
          .all(row.period_index, row.semester_id)
        for (const { p } of shifting) {
          db.prepare(`UPDATE course_slot SET period = ? WHERE period = ? AND ${filt}`).run(p - 1, p, row.semester_id)
        }
        db.prepare('DELETE FROM period_template WHERE id = ?').run(entityId)
        const rest = db
          .prepare('SELECT id FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
          .all(row.semester_id)
        rest.forEach((p, i) => db.prepare('UPDATE period_template SET period_index = ? WHERE id = ?').run(i + 1, p.id))
        return
      }
      db.prepare('DELETE FROM period_template WHERE id = ?').run(entityId)
      db.prepare(
        'INSERT INTO period_template (id, semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
      ).run(before.id, before.semesterId ?? before.semester_id, before.index, before.startTime, before.endTime)
      return
    }
    case 'course': {
      const row = db.prepare('SELECT * FROM course WHERE id = ?').get(entityId)
      const semId = before?.semesterId ?? before?.semester_id ?? row?.semester_id
      if (row) db.prepare('DELETE FROM course WHERE id = ?').run(entityId) // 级联清掉时间组 / 格子 / 调课记录
      if (before) insertCourse(before, semId)
      return
    }
    case 'exam': {
      db.prepare('DELETE FROM exam WHERE id = ?').run(entityId)
      if (before) {
        db.prepare(
          'INSERT INTO exam (id, semester_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(before.id, before.semesterId, before.courseId ?? null, before.name, before.datetime, before.location ?? '', before.remark ?? '')
      }
      return
    }
    case 'homework': {
      db.prepare('DELETE FROM homework WHERE id = ?').run(entityId)
      if (before) {
        db.prepare(
          'INSERT INTO homework (id, semester_id, course_id, name, due_at, remark) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(before.id, before.semesterId, before.courseId ?? null, before.name, before.dueAt, before.remark ?? '')
      }
      return
    }
    case 'adjustment': {
      db.prepare('DELETE FROM course_adjustment WHERE id = ?').run(entityId)
      if (before && db.prepare('SELECT 1 FROM course WHERE id = ?').get(before.courseId)) {
        db.prepare(
          `INSERT INTO course_adjustment (id, course_id, date, kind, from_weekday, from_periods, to_date, periods, location, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          before.id,
          before.courseId,
          before.date,
          before.kind,
          before.fromWeekday ?? null,
          JSON.stringify(before.fromPeriods ?? []),
          before.toDate ?? null,
          JSON.stringify(before.periods ?? []),
          before.location ?? '',
          before.note ?? '',
          before.createdAt ?? new Date().toISOString(),
        )
      }
      return
    }
    case 'notice': {
      db.prepare('DELETE FROM notice WHERE id = ?').run(entityId)
      if (before) insertNotice(before)
      return
    }
    case 'day_rule': {
      try {
        db.prepare('DELETE FROM semester_day_rule WHERE id = ?').run(entityId)
        if (before) {
          db.prepare(
            'INSERT INTO semester_day_rule (id, semester_id, date, kind, to_date, note) VALUES (?, ?, ?, ?, ?, ?)',
          ).run(before.id, before.semesterId, before.date, before.kind, before.toDate ?? null, before.note ?? '')
        }
      } catch (e) {
        if (String(e?.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
          throw badRequest('这一天已经有别的日历规则了，请先撤销那条记录')
        }
        throw e
      }
      return
    }
    case 'calendar': {
      // calendar 记录记的是整班状态：逆操作 = 把这个学期的日历规则整表恢复成 before 里的样子
      const semesterId = entityId
      if (!before?.dayRules) throw badRequest('这条记录没有可用的日历快照，无法撤销')
      db.prepare('DELETE FROM semester_day_rule WHERE semester_id = ?').run(semesterId)
      const rules = (before.dayRules ?? []).filter((r) => (r.semesterId ?? r.semester_id) === semesterId)
      const ins = db.prepare(
        'INSERT INTO semester_day_rule (id, semester_id, date, kind, to_date, note) VALUES (?, ?, ?, ?, ?, ?)',
      )
      for (const r of rules) ins.run(r.id, semesterId, r.date, r.kind, r.toDate ?? null, r.note ?? '')
      return
    }
    default:
      throw badRequest('这类记录不支持单条撤销（它改动的是整个班级），请用「整班回退」回到那一刻')
  }
}

// ------------------------------------------------------------
// 「回退到这里」：目标状态 = 最近一条带整班快照的记录 + 其后实体级改动按序重放
//   只有整班级操作（删学期 / 删节次 / 导入 / 删班 / 日历 / 退出）才存整班快照；
//   其余记录存的是实体快照。所以不能用「某条记录的 after」当整班状态，
//   要把该条之前那些实体改动照着 after 重放一遍，才等于「那一刻的班级」。
// ------------------------------------------------------------

function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 该状态是不是一份整班快照（有 semesters 数组） */
export function isClassState(v) {
  return !!v && typeof v === 'object' && Array.isArray(v.semesters)
}

/**
 * 取出「某条记录那一刻」的班级状态。
 * @param exclusive true = 回到这条记录**改之前**（即它自己不算）
 * @returns { base, steps } —— base 是起点整班快照，steps 是需要重放的实体级记录（升序）
 */
export function stateAtChange(classId, targetId, { exclusive = false } = {}) {
  const upper = exclusive ? Number(targetId) - 1 : Number(targetId)
  const rows = db
    .prepare(
      'SELECT id, entity, entity_id, action, before, after FROM change_log WHERE class_id = ? AND id <= ? ORDER BY id ASC',
    )
    .all(classId, upper)
  if (!rows.length) throw badRequest('这条记录之前还没有可回退的状态')
  let start = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isClassState(parseJson(rows[i].after))) {
      start = i
      break
    }
  }
  if (start < 0) {
    // 这条记录之前还没有任何整班快照（老库早期记录就是这样）：没法凭空重建那一刻，
    // 硬要「从空班重放」会把学期/课表全抹掉——宁可明说回退不了这么早。
    throw badRequest('这条记录之前还没有整班快照，回退不到这么早；请改选它之后的一条记录')
  }
  const base = parseJson(rows[start].after)
  const steps = rows
    .slice(start + 1)
    .map((r) => ({ entity: r.entity, entityId: r.entity_id, after: parseJson(r.after), action: r.action }))
  return { base, steps }
}

/** 把班级改写成「某条记录那一刻」的状态（调用方负责事务与记录） */
export function restoreStateAt(classId, targetId, { exclusive = false } = {}) {
  const { base, steps } = stateAtChange(classId, targetId, { exclusive })
  applyClassState(base)
  for (const step of steps) {
    if (!REVERTIBLE.has(step.entity)) continue
    restoreEntity({ entity: step.entity, entityId: step.entityId, classId, before: step.after })
  }
}

/** 课程子树（课程 + 上课时间 + 格子 + 调课记录）——撤销「删课程 / 改课程」共用 */
function insertCourse(course, semesterId) {
  db.prepare(
    `INSERT INTO course (id, semester_id, type, name, teacher, location, color, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(course.id, semesterId, course.type, course.name, course.teacher ?? '', course.location ?? '', course.color ?? 'course-1', course.remark ?? '')
  const insSession = db.prepare('INSERT INTO course_session (id, course_id, weekday, location) VALUES (?, ?, ?, ?)')
  const insSlot = db.prepare('INSERT INTO course_slot (session_id, period, week) VALUES (?, ?, ?)')
  for (const s of course.sessions ?? []) {
    insSession.run(s.id, course.id, s.weekday, s.location ?? '')
    for (const period of s.periods ?? []) for (const week of s.weeks ?? []) insSlot.run(s.id, period, week)
  }
  const insAdjust = db.prepare(
    `INSERT INTO course_adjustment (id, course_id, date, kind, from_weekday, from_periods, to_date, periods, location, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const a of course.adjustments ?? []) {
    insAdjust.run(
      a.id,
      course.id,
      a.date,
      a.kind,
      a.fromWeekday ?? null,
      JSON.stringify(a.fromPeriods ?? []),
      a.toDate ?? null,
      JSON.stringify(a.periods ?? []),
      a.location ?? '',
      a.note ?? '',
      a.createdAt ?? new Date().toISOString(),
    )
  }
  // 删课程时被置空的考试 / 作业，撤销后按原引用接回去
  for (const e of course.refs?.exams ?? []) {
    db.prepare('UPDATE exam SET course_id = ? WHERE id = ? AND course_id IS NULL').run(course.id, e)
  }
  for (const h of course.refs?.homework ?? []) {
    db.prepare('UPDATE homework SET course_id = ? WHERE id = ? AND course_id IS NULL').run(course.id, h)
  }
}
