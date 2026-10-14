// ============================================================
// ClassBoard · 变更记录（git 式）
//   每条写操作落一条 change_log：who / when / what / before → after。
//   回退 = 生成一条新记录并应用逆操作（不截断历史）。
//   快照按「实体」取全量（课程含上课时间与格子），供回退时原样恢复。
// ============================================================
import {
  db,
  loadCourseWithSessions,
  toAdjustment,
  toCoursesWithSessions,
  toDayRule,
  toExam,
  toHomework,
  toNotice,
  toPeriod,
  toSemester,
} from './db.js'

/** 整班状态快照（用于大范围操作：删学期、删节次连带的格子前移、导入覆盖、删班） */
export function classStateSnapshot(classId) {
  const cls = db.prepare('SELECT * FROM class WHERE id = ?').get(classId)
  if (!cls) return null
  const semesters = db
    .prepare('SELECT * FROM semester WHERE class_id = ? ORDER BY id ASC')
    .all(classId)
    .map(toSemester)
  const semIds = semesters.map((s) => s.id)
  const inSems = semIds.length ? semIds.map(() => '?').join(',') : null
  const periods = inSems
    ? db
        .prepare(`SELECT * FROM period_template WHERE semester_id IN (${inSems}) ORDER BY semester_id ASC, period_index ASC`)
        .all(...semIds)
        .map(toPeriod)
    : []
  const courses = inSems
    ? toCoursesWithSessions(
        db.prepare(`SELECT * FROM course WHERE semester_id IN (${inSems}) ORDER BY id ASC`).all(...semIds),
      )
    : []
  const exams = inSems
    ? db.prepare(`SELECT * FROM exam WHERE semester_id IN (${inSems}) ORDER BY id ASC`).all(...semIds).map(toExam)
    : []
  const homework = inSems
    ? db
        .prepare(`SELECT * FROM homework WHERE semester_id IN (${inSems}) ORDER BY id ASC`)
        .all(...semIds)
        .map(toHomework)
    : []
  const dayRules = inSems
    ? db
        .prepare(`SELECT * FROM semester_day_rule WHERE semester_id IN (${inSems}) ORDER BY id ASC`)
        .all(...semIds)
        .map(toDayRule)
    : []
  const adjustments = courses.length
    ? db
        .prepare(
          `SELECT * FROM course_adjustment WHERE course_id IN (${courses.map(() => '?').join(',')}) ORDER BY id ASC`,
        )
        .all(...courses.map((c) => c.id))
        .map(toAdjustment)
    : []
  const notices = db
    .prepare(
      `SELECT n.*, u.username AS author_name FROM notice n LEFT JOIN user u ON u.id = n.author_id
        WHERE n.class_id = ? ORDER BY n.id ASC`,
    )
    .all(classId)
    .map(toNotice)
  const members = db
    .prepare('SELECT class_id, user_id, joined_at FROM class_member WHERE class_id = ? ORDER BY user_id ASC')
    .all(classId)
  return { ...cls, semesters, periods, courses, exams, homework, dayRules, adjustments, notices, members }
}

/** 学期子树快照：学期行 + 节次 + 课程（含上课时间与格子）+ 考试 / 作业 / 日历 / 调整。
 *  删学期、删课程都会级联带走这些行，快照必须够还原，否则「回退」只是空壳。 */
export function semesterSubtree(semesterId) {
  const row = db.prepare('SELECT * FROM semester WHERE id = ?').get(semesterId)
  if (!row) return null
  const periods = db
    .prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
    .all(semesterId)
    .map(toPeriod)
  const courses = toCoursesWithSessions(
    db.prepare('SELECT * FROM course WHERE semester_id = ? ORDER BY id ASC').all(semesterId),
  )
  return {
    ...toSemester(row),
    periods,
    courses,
    exams: db.prepare('SELECT * FROM exam WHERE semester_id = ? ORDER BY id ASC').all(semesterId).map(toExam),
    homework: db.prepare('SELECT * FROM homework WHERE semester_id = ? ORDER BY id ASC').all(semesterId).map(toHomework),
    dayRules: db
      .prepare('SELECT * FROM semester_day_rule WHERE semester_id = ? ORDER BY id ASC')
      .all(semesterId)
      .map(toDayRule),
    adjustments: courses.length
      ? db
          .prepare(
            `SELECT * FROM course_adjustment WHERE course_id IN (${courses.map(() => '?').join(',')}) ORDER BY id ASC`,
          )
          .all(...courses.map((c) => c.id))
          .map(toAdjustment)
      : [],
  }
}

/** 实体 → 快照读取器（返回 null 表示该实体当前不存在） */
const SNAPSHOTS = {
  class: (id) => db.prepare('SELECT * FROM class WHERE id = ?').get(id) ?? null,
  member: (id) => db.prepare('SELECT * FROM class_member WHERE rowid = ?').get(id) ?? null,
  semester: (id) => semesterSubtree(id),
  period: (id) => {
    const row = db.prepare('SELECT * FROM period_template WHERE id = ?').get(id)
    return row ? toPeriod(row) : null
  },
  course: (id) => {
    const c = loadCourseWithSessions(db.prepare('SELECT * FROM course WHERE id = ?').get(id))
    if (!c) return null
    // 调课记录随课程级联删除，快照里带上，回退才不会丢
    c.adjustments = db
      .prepare('SELECT * FROM course_adjustment WHERE course_id = ? ORDER BY id ASC')
      .all(id)
      .map(toAdjustment)
    // 删课程会把考试 / 作业的 courseId 置空，记下原引用，回退时接回去
    c.refs = {
      exams: db.prepare('SELECT id FROM exam WHERE course_id = ?').all(id).map((r) => r.id),
      homework: db.prepare('SELECT id FROM homework WHERE course_id = ?').all(id).map((r) => r.id),
    }
    return c
  },
  exam: (id) => {
    const row = db.prepare('SELECT * FROM exam WHERE id = ?').get(id)
    return row ? toExam(row) : null
  },
  homework: (id) => {
    const row = db.prepare('SELECT * FROM homework WHERE id = ?').get(id)
    return row ? toHomework(row) : null
  },
  day_rule: (id) => {
    const row = db.prepare('SELECT * FROM semester_day_rule WHERE id = ?').get(id)
    return row ? toDayRule(row) : null
  },
  adjustment: (id) => {
    const row = db.prepare('SELECT * FROM course_adjustment WHERE id = ?').get(id)
    return row ? toAdjustment(row) : null
  },
  notice: (id) => {
    const row = db.prepare(
      `SELECT n.*, u.username AS author_name FROM notice n LEFT JOIN user u ON u.id = n.author_id WHERE n.id = ?`,
    ).get(id)
    return row ? toNotice(row) : null
  },
}

/** 取实体快照（回退与记录共用） */
export function entitySnapshot(entity, id) {
  const fn = SNAPSHOTS[entity]
  if (!fn || id == null) return null
  return fn(id)
}

/** 写一条变更记录 */
export function recordChange({
  classId = null,
  actorId = null,
  action,
  entity,
  entityId = null,
  before = null,
  after = null,
  revertOf = null,
}) {
  db.prepare(
    `INSERT INTO change_log (class_id, actor_id, action, entity, entity_id, before, after, revert_of, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    classId,
    actorId,
    action,
    entity,
    entityId,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    revertOf,
    new Date().toISOString(),
  )
}
