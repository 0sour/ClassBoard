// ============================================================
// ClassBoard · 课表数据规范化导出（核对用）
//   把一个库里的全部班级 → 学期 → 课程/上课时间/格子、学期日历、单课调整、
//   节次、考试、作业，按稳定顺序序列化成 JSON，并给出内容摘要哈希。
//   用途：部署/迁移前后逐项比对（同一份数据在不同库上的摘要必须一致）。
//
// 用法：
//   CLASSBOARD_DATA_DIR=<数据目录> node scripts/dump-timetable.mjs [班级名关键字] [输出文件]
//   省略输出文件则打印到 stdout。
// ============================================================
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { db, toAdjustment, toCoursesWithSessions, toDayRule, toExam, toHomework, toPeriod } from '../lib/db.js'

const filter = process.argv[2] ?? ''
const outFile = process.argv[3] ?? ''

function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

const classes = db.prepare('SELECT * FROM class ORDER BY id ASC').all()
const result = []

for (const cls of classes) {
  const label = `${cls.school ? `${cls.school} · ` : ''}${cls.name}`
  if (filter && !label.includes(filter) && cls.name !== filter) continue

  const semesters = db.prepare('SELECT * FROM semester WHERE class_id = ? ORDER BY id ASC').all(cls.id)
  const semIds = semesters.map((s) => s.id)
  const ph = semIds.map(() => '?').join(',')

  const periods = semIds.length
    ? db.prepare(`SELECT * FROM period_template WHERE semester_id IN (${ph}) ORDER BY semester_id, period_index`).all(...semIds).map(toPeriod)
    : []
  const courses = semIds.length
    ? toCoursesWithSessions(db.prepare(`SELECT * FROM course WHERE semester_id IN (${ph}) ORDER BY name ASC, id ASC`).all(...semIds))
    : []
  const dayRules = semIds.length
    ? db.prepare(`SELECT * FROM semester_day_rule WHERE semester_id IN (${ph}) ORDER BY date ASC, id ASC`).all(...semIds).map(toDayRule)
    : []
  const adjustments = courses.length
    ? db
        .prepare(
          `SELECT * FROM course_adjustment WHERE course_id IN (${courses.map(() => '?').join(',')})
            ORDER BY course_id ASC, date ASC, id ASC`,
        )
        .all(...courses.map((c) => c.id))
        .map(toAdjustment)
    : []
  const exams = semIds.length
    ? db.prepare(`SELECT * FROM exam WHERE semester_id IN (${ph}) ORDER BY semester_id, name, id`).all(...semIds).map(toExam)
    : []
  const homework = semIds.length
    ? db.prepare(`SELECT * FROM homework WHERE semester_id IN (${ph}) ORDER BY semester_id, name, id`).all(...semIds).map(toHomework)
    : []
  const notices = db
    .prepare('SELECT * FROM notice WHERE class_id = ? ORDER BY date ASC, id ASC')
    .all(cls.id)
    .map((n) => ({ id: n.id, date: n.date, title: n.title, body: n.body, courseId: n.course_id, pinned: !!n.pinned }))

  // 附件（作业 / 考试的图片与文件）：挂在各自的条目里；没有附件的库 digest 与从前一致（键省略）
  const attByExam = new Map()
  const attByHw = new Map()
  if (exams.length || homework.length) {
    const ors = []
    const params = []
    if (exams.length) {
      ors.push(`exam_id IN (${exams.map(() => '?').join(',')})`)
      params.push(...exams.map((e) => e.id))
    }
    if (homework.length) {
      ors.push(`homework_id IN (${homework.map(() => '?').join(',')})`)
      params.push(...homework.map((h) => h.id))
    }
    for (const a of db.prepare(`SELECT * FROM attachment WHERE ${ors.join(' OR ')} ORDER BY id ASC`).all(...params)) {
      const byMatter = a.exam_id != null ? attByExam : attByHw
      const key = a.exam_id ?? a.homework_id
      if (!byMatter.has(key)) byMatter.set(key, [])
      byMatter.get(key).push({ name: a.name, mime: a.mime, size: a.size, sha256: a.sha256 })
    }
  }
  const withAtt = (obj, byMatter, id) => {
    const list = byMatter.get(id)
    return list?.length ? { ...obj, attachments: list } : obj
  }
  const attCount = [...attByExam.values(), ...attByHw.values()].reduce((n, l) => n + l.length, 0)

  /**
   * 内容快照：不含数据库自增 id 之外的任何环境信息；课程/上课时间/格子用
   * 名称 + 星期 + 节次 + 周次这类稳定字段表达，便于跨库比对。
   */
  const content = {
    semesters: semesters.map((s) => ({
      name: s.name,
      startDate: s.start_date,
      endDate: s.end_date,
      weekStartDay: s.week_start_day,
    })),
    periods: periods.map((p) => ({ semesterId: p.semesterId, index: p.index, startTime: p.startTime, endTime: p.endTime })),
    courses: courses.map((c) => ({
      semesterId: c.semesterId,
      name: c.name,
      type: c.type,
      teacher: c.teacher,
      location: c.location,
      color: c.color,
      remark: c.remark,
      sessions: c.sessions.map((s) => ({ weekday: s.weekday, location: s.location, periods: s.periods, weeks: s.weeks })),
    })),
    dayRules: dayRules.map((r) => ({ semesterId: r.semesterId, date: r.date, kind: r.kind, toDate: r.toDate, note: r.note })),
    adjustments: adjustments.map((a) => ({
      courseId: a.courseId,
      date: a.date,
      kind: a.kind,
      fromWeekday: a.fromWeekday,
      fromPeriods: a.fromPeriods,
      toDate: a.toDate,
      periods: a.periods,
      location: a.location,
      note: a.note,
    })),
    exams: exams.map((e) =>
      withAtt({ semesterId: e.semesterId, name: e.name, datetime: e.datetime, location: e.location, remark: e.remark }, attByExam, e.id),
    ),
    homework: homework.map((h) =>
      withAtt({ semesterId: h.semesterId, name: h.name, dueAt: h.dueAt, done: !!h.done, remark: h.remark }, attByHw, h.id),
    ),
    notices: notices.map((n) => ({ date: n.date, title: n.title, body: n.body, courseId: n.courseId, pinned: n.pinned })),
  }

  result.push({
    class: { school: cls.school, name: cls.name, major: cls.major, city: cls.city, currentSemesterId: cls.current_semester_id },
    counts: {
      semesters: semesters.length,
      periods: periods.length,
      courses: courses.length,
      sessions: content.courses.reduce((n, c) => n + c.sessions.length, 0),
      slots: content.courses.reduce((n, c) => n + c.sessions.reduce((m, s) => m + s.periods.length * s.weeks.length, 0), 0),
      dayRules: dayRules.length,
      adjustments: adjustments.length,
      exams: exams.length,
      homework: homework.length,
      attachments: attCount,
    },
    digest: digestOf(content),
    content,
  })
}

const payload = { generatedAt: new Date().toISOString(), digestAll: digestOf(result.map((r) => [r.class.school, r.class.name, r.digest])), classes: result }
const text = JSON.stringify(payload, null, 2)
if (outFile) {
  writeFileSync(outFile, text)
  console.log(`已写出 ${outFile}`)
  for (const r of result) {
    console.log(
      `  ${r.class.school ? `${r.class.school} · ` : ''}${r.class.name}：` +
        `${r.counts.courses} 门课 / ${r.counts.sessions} 个时间组 / ${r.counts.slots} 格 / ` +
        `${r.counts.dayRules} 条日历 / ${r.counts.adjustments} 条调整 · digest ${r.digest}`,
    )
  }
  console.log(`  合集 digest ${payload.digestAll}`)
} else {
  console.log(text)
}
