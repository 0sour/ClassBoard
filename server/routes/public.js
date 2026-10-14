// ============================================================
// ClassBoard · 公开只读路由（/api/public/*，无需登录）
//   只有这些接口对未登录访客开放：班级列表、班级资料、课表解析所需数据、天气。
//   绝不返回账号、设置、密钥等敏感内容。
// ============================================================
import { Router } from 'express'
import { db, toCoursesWithSessions, toDayRule, toPeriod, toSemester, toNotice } from '../lib/db.js'
import { semestersOfClass } from '../lib/classes.js'
import { notFound, badRequest, wrap } from '../lib/errors.js'
import { readWeatherForCity } from '../lib/weather.js'
import { attachmentsOf, isInlineImage, loadBlob } from '../lib/attachments.js'

export const publicRouter = Router()

function publicClass(id) {
  const cls = db.prepare('SELECT * FROM class WHERE id = ?').get(id)
  if (!cls) return null
  return cls
}

function classBrief(row) {
  const semesters = db.prepare('SELECT COUNT(*) AS c FROM semester WHERE class_id = ?').get(row.id).c
  return {
    id: row.id,
    school: row.school,
    name: row.name,
    major: row.major,
    semesterCount: semesters,
    updatedAt: row.updated_at,
  }
}

/** 班级列表（可按学校 / 班级名模糊搜索） */
publicRouter.get(
  '/classes',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim()
    const rows = q
      ? db
          .prepare(
            `SELECT * FROM class WHERE school LIKE ? OR name LIKE ?
              ORDER BY updated_at DESC, id DESC LIMIT 200`,
          )
          .all(`%${q}%`, `%${q}%`)
      : db.prepare('SELECT * FROM class ORDER BY updated_at DESC, id DESC LIMIT 200').all()
    res.json(rows.map(classBrief))
  }),
)

/** 班级资料 + 学期列表（公开页的学期切换用） */
publicRouter.get(
  '/classes/:id',
  wrap(async (req, res) => {
    const cls = publicClass(Number(req.params.id))
    if (!cls) throw notFound('班级不存在')
    const semesters = semestersOfClass(cls.id).map(toSemester)
    res.json({
      class: {
        id: cls.id,
        school: cls.school,
        name: cls.name,
        major: cls.major,
      },
      semesters,
      currentSemesterId: cls.current_semester_id,
      periods:
        cls.current_semester_id === null
          ? []
          : db
              .prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
              .all(cls.current_semester_id)
              .map(toPeriod),
    })
  }),
)

/**
 * 课表解析所需的全部数据（前端 resolveDay 的唯一输入，只读）。
 * 不含任何账号信息；解析照旧在前端完成。
 */
publicRouter.get(
  '/classes/:id/timetable',
  wrap(async (req, res) => {
    const cls = publicClass(Number(req.params.id))
    if (!cls) throw notFound('班级不存在')
    const semesterIdRaw = req.query.semesterId ?? cls.current_semester_id
    const semesterId = Number(semesterIdRaw)
    if (!Number.isInteger(semesterId)) return res.json({ semester: null, periods: [], courses: [], dayRules: [], adjustments: [] })
    const sem = db.prepare('SELECT * FROM semester WHERE id = ? AND class_id = ?').get(semesterId, cls.id)
    if (!sem) throw badRequest('学期不属于该班级')
    const courses = toCoursesWithSessions(
      db.prepare('SELECT * FROM course WHERE semester_id = ? ORDER BY name ASC, id ASC').all(semesterId),
    )
    const dayRules = db
      .prepare('SELECT * FROM semester_day_rule WHERE semester_id = ? ORDER BY date ASC')
      .all(semesterId)
      .map(toDayRule)
    const adjustments = courses.length
      ? db
          .prepare(
            `SELECT * FROM course_adjustment WHERE course_id IN (${courses.map(() => '?').join(',')})
              ORDER BY date ASC, id ASC`,
          )
          .all(...courses.map((c) => c.id))
          .map((r) => ({
            id: r.id,
            courseId: r.course_id,
            date: r.date,
            kind: r.kind,
            fromWeekday: r.from_weekday,
            fromPeriods: JSON.parse(r.from_periods || '[]'),
            toDate: r.to_date,
            periods: JSON.parse(r.periods || '[]'),
            location: r.location,
            note: r.note,
            createdAt: r.created_at,
          }))
      : []
    res.json({
      semester: toSemester(sem),
      periods: db
        .prepare('SELECT * FROM period_template WHERE semester_id = ? ORDER BY period_index ASC')
        .all(semesterId)
        .map(toPeriod),
      courses,
      dayRules,
      adjustments,
    })
  }),
)

/** 班级通知（置顶在前，其余按日期倒序；一条都不隐藏） */
publicRouter.get(
  '/classes/:id/notices',
  wrap(async (req, res) => {
    const cls = publicClass(Number(req.params.id))
    if (!cls) throw notFound('班级不存在')
    const rows = db
      .prepare(
        `SELECT n.*, u.username AS author_name FROM notice n LEFT JOIN user u ON u.id = n.author_id
          WHERE n.class_id = ? ORDER BY n.pinned DESC, n.date DESC, n.id DESC`,
      )
      .all(cls.id)
    res.json(rows.map(toNotice))
  }),
)

/** 班级作业（负责人公示；截止前 / 已截止由前端按 dueAt 分组，这里一次取全） */
publicRouter.get(
  '/classes/:id/homework',
  wrap(async (req, res) => {
    const cls = publicClass(Number(req.params.id))
    if (!cls) throw notFound('班级不存在')
    const semIds = semestersOfClass(cls.id)
      .filter((s) => req.query.semesterId === undefined || s.id === Number(req.query.semesterId))
      .map((s) => s.id)
    if (!semIds.length) return res.json([])
    const ph = semIds.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT * FROM homework WHERE semester_id IN (${ph}) ORDER BY due_at ASC, id ASC`)
      .all(...semIds)
    res.json(
      rows.map((r) => ({
        id: r.id,
        semesterId: r.semester_id,
        courseId: r.course_id,
        name: r.name,
        dueAt: r.due_at,
        remark: r.remark,
        attachments: attachmentsOf('homework', r.id),
      })),
    )
  }),
)

publicRouter.get(
  '/classes/:id/exams',
  wrap(async (req, res) => {
    const cls = publicClass(Number(req.params.id))
    if (!cls) throw notFound('班级不存在')
    const semIds = semestersOfClass(cls.id)
      .filter((s) => req.query.semesterId === undefined || s.id === Number(req.query.semesterId))
      .map((s) => s.id)
    if (!semIds.length) return res.json([])
    const ph = semIds.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT * FROM exam WHERE semester_id IN (${ph}) ORDER BY datetime ASC, id ASC`)
      .all(...semIds)
    res.json(
      rows.map((r) => ({
        id: r.id,
        semesterId: r.semester_id,
        courseId: r.course_id,
        name: r.name,
        datetime: r.datetime,
        location: r.location,
        remark: r.remark,
        attachments: attachmentsOf('exam', r.id),
      })),
    )
  }),
)

/**
 * 附件内容（公开）：附件跟随所在对象的可见性 —— 课表和作业/考试本来就是免登录可看的。
 * 图片内联展示；其余一律按附件下载，并带 nosniff（避免 SVG/HTML 内联的脚本风险）。
 * 内容按 sha256 寻址、永不变更，因此可以放心长缓存。
 */
publicRouter.get(
  '/attachments/:id',
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM attachment WHERE id = ?').get(Number(req.params.id))
    if (!row) throw notFound('附件不存在')
    const data = loadBlob(row.sha256)
    if (!data) throw notFound('附件内容不存在')
    const mime = row.mime || 'application/octet-stream'
    const inline = isInlineImage(mime)
    res.setHeader('Content-Type', inline ? mime : 'application/octet-stream')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Length', data.length)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`)
    res.send(data)
  }),
)

/** 班级天气（按班级城市；密钥仍只在服务端） */
publicRouter.get(
  '/classes/:id/weather',
  wrap(async (req, res) => {
    const cls = publicClass(Number(req.params.id))
    if (!cls) throw notFound('班级不存在')
    if (!cls.city) return res.json({ enabled: false, reason: '未设置城市' })
    const data = await readWeatherForCity(cls.city)
    res.json(data ?? { enabled: false, reason: '天气服务未配置' })
  }),
)
