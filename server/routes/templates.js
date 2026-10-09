// ============================================================
// ClassBoard · 模板路由（两级模板体系）
// course 模板：单门课程定义（同学勾选批量导入）
// unit 模板：组合模板，引用课程模板 id 数组（一键批量导入）
// semester 模板：学期信息 + 节次时间
// 列表/详情/导入：所有登录用户；创建/编辑/删除：仅 admin
// 模板内容结构：课程组行 { type,name,teacher,location,color,remark,sessions[] }
// 旧格式（weekType/weekList/weekday/startPeriod/endPeriod）读取时自动转换。
// ============================================================
import { Router } from 'express'
import { db, DATA_DIR, replaceCourseSessions, setCurrentSemesterId } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { requireAdmin } from '../lib/access.js'
import { validateCourse } from '../lib/validate.js'
import { assignCourseColors } from '../lib/colors.js'
import { periodLimitOf, weekLimitOf } from '../lib/semesters.js'
import { createSnapshot } from '../lib/snapshot.js'
import { expandWeeks, normalizeInts, periodRange, MAX_PERIODS, MAX_WEEKS } from '../lib/weekspan.js'

export const templatesRouter = Router()

const MAX_ROWS = 2000

/** 模板行 → API 对象 */
function toTemplate(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    category: row.category,
    description: row.description,
    version: row.version,
    content: JSON.parse(row.content),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 是否为旧格式课程行（含 weekType/weekday/startPeriod 等已废弃字段） */
export function isLegacyCourseRow(row) {
  return row && typeof row === 'object' && !Array.isArray(row.sessions)
    && ('weekType' in row || 'weekday' in row || 'startPeriod' in row)
}

/**
 * 旧格式课程行 → 新结构（无损转换）。
 * weekType/weekList 展开为逐周；startPeriod..endPeriod 展开为逐节。
 * @param maxWeeks 无 weekList 时的周次上限（学期总周数）
 */
export function convertLegacyRow(row, maxWeeks = 16) {
  const weeks = expandWeeks(row.weekType ?? 'all', row.weekList ?? null, maxWeeks)
  const periods = periodRange(row.startPeriod, row.endPeriod)
  return {
    type: row.type ?? 'course',
    name: row.name,
    teacher: row.teacher ?? '',
    location: row.location ?? '',
    color: row.color,
    remark: row.remark ?? '',
    sessions: weeks.length && periods.length
      ? [{ weekday: row.weekday, location: row.location ?? '', periods, weeks }]
      : [],
  }
}

/**
 * 把任意形态的课程行统一转成新结构后校验。
 * sessions 允许为空数组（无固定时间课程，如实践/实习类）——与手动录入一致。
 * @param maxWeeks 周次上限；调用方应传目标学期实际周数（见 lib/semesters.js 的 weekLimitOf），
 *                 否则超过默认值的课程会被误判为非法
 */
function validateRowsWithConversion(rows, { maxPeriod = MAX_PERIODS, maxWeeks = MAX_WEEKS } = {}) {
  const validated = []
  const errors = []
  const weekLimit = Math.min(Math.max(maxWeeks, 1), MAX_WEEKS)
  rows.forEach((row, i) => {
    try {
      const normalized = isLegacyCourseRow(row) ? convertLegacyRow(row, weekLimit) : row
      validated.push(validateCourse(normalized, { maxPeriod, maxWeek: weekLimit }))
    } catch (e) {
      const first = e?.details?.[0]
      errors.push({ row: i + 1, message: first ? `${first.field}：${first.message}` : e.message })
    }
  })
  return { validated, errors }
}

/** 校验课程模板内容（1-N 门课程行） */
function validateCourseTemplate(content) {
  if (!Array.isArray(content) || content.length === 0) {
    throw badRequest('课程模板须包含至少一门课程')
  }
  if (content.length > MAX_ROWS) {
    throw badRequest(`课程模板课程数超过 ${MAX_ROWS} 上限`)
  }
  const { validated, errors } = validateRowsWithConversion(content)
  if (errors.length) throw badRequest('课程模板存在无效行', errors)
  return validated
}

/** 校验组合模板内容：课程模板 id 数组（引用）或课程行数组（快照） */
function validateUnitContent(content) {
  if (!Array.isArray(content) || content.length === 0) {
    throw badRequest('组合模板内容不能为空')
  }
  if (content.length > MAX_ROWS) {
    throw badRequest(`组合模板课程数超过 ${MAX_ROWS} 上限`)
  }
  // 数字数组 → 引用课程模板 id
  if (content.every((c) => typeof c === 'number' || /^\d+$/.test(String(c)))) {
    const ids = content.map((id) => Number(id))
    if (ids.some((id) => !Number.isInteger(id) || id < 1)) {
      throw badRequest('组合模板内容须为课程模板 id 数组或课程行数组')
    }
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(`SELECT id, kind FROM template WHERE id IN (${placeholders})`).all(...ids)
    const found = new Set(rows.map((r) => r.id))
    if (rows.some((r) => r.kind !== 'course')) throw badRequest('组合模板只能引用课程模板（kind=course）')
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) throw badRequest(`引用的课程模板不存在：id=${missing.join(',')}`)
    return [...new Set(ids)]
  }
  const { validated, errors } = validateRowsWithConversion(content)
  if (errors.length) throw badRequest('组合模板存在无效行', errors)
  return validated
}

/** 校验学期模板内容：{ name, startDate, endDate, weekStartDay, periods: [{startTime, endTime}] } */
function validateSemesterTemplate(content) {
  if (!content || typeof content !== 'object') throw badRequest('学期模板内容无效')
  const name = String(content.name ?? '').trim()
  if (!name || name.length > 50) throw badRequest('学期名称须为 1-50 位')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(content.startDate ?? ''))) throw badRequest('开始日期格式须为 YYYY-MM-DD')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(content.endDate ?? ''))) throw badRequest('结束日期格式须为 YYYY-MM-DD')
  if (String(content.endDate) < String(content.startDate)) throw badRequest('结束日期不能早于开始日期')
  const weekStartDay = Number(content.weekStartDay)
  if (weekStartDay !== 1 && weekStartDay !== 7) throw badRequest('每周起始日须为 1（周一）或 7（周日）')
  const periods = content.periods
  if (!Array.isArray(periods) || periods.length === 0) throw badRequest('节次时间模板不能为空')
  if (periods.length > 30) throw badRequest('节次数量超过 30 上限')
  const validatedPeriods = periods.map((p, i) => {
    const start = String(p?.startTime ?? '')
    const end = String(p?.endTime ?? '')
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      throw badRequest(`第 ${i + 1} 节时间格式须为 HH:mm`)
    }
    if (end <= start) throw badRequest(`第 ${i + 1} 节结束时间须晚于开始时间`)
    return { startTime: start, endTime: end }
  })
  return { name, startDate: content.startDate, endDate: content.endDate, weekStartDay, periods: validatedPeriods }
}

/** 解析模板为课程组行数组（course 直接返回；unit 展开引用或快照；semester 返回空） */
function resolveTemplateRows(row, maxWeeks = 16) {
  if (row.kind === 'semester') return []
  const content = JSON.parse(row.content)
  const rows = row.kind === 'course'
    ? content
    : content.length > 0 && typeof content[0] !== 'number'
      ? content
      : db
          .prepare(`SELECT * FROM template WHERE id IN (${content.map(() => '?').join(',')})`)
          .all(...content)
          .flatMap((r) => JSON.parse(r.content))
  return rows.map((r) => (isLegacyCourseRow(r) ? convertLegacyRow(r, maxWeeks) : r))
}

/**
 * 去重键：类型 + 课程名 + 教师 + 星期 + 完整节次集合 + 完整周次集合。
 * 不含 type/周次会让同名实验课与理论课互判重复（历史 bug）。
 */
export function courseDedupeKey(row) {
  const sessions = (row.sessions ?? [])
    .map((s) => `${s.weekday}:${normalizeInts(s.periods).join('.')}:${normalizeInts(s.weeks).join('.')}`)
    .sort()
    .join('|')
  return `${row.type}|${row.name}|${row.teacher ?? ''}|${sessions}`
}

/** 既有课程的去重键集合 */
function existingKeysOf(semesterId, userId) {
  const existing = db
    .prepare('SELECT * FROM course WHERE semester_id = ? AND user_id = ?')
    .all(semesterId, userId)
  const sessions = existing.length
    ? db
        .prepare(
          `SELECT * FROM course_session WHERE course_id IN (${existing.map(() => '?').join(',')})`,
        )
        .all(...existing.map((c) => c.id))
    : []
  const slotRows = sessions.length
    ? db
        .prepare(
          `SELECT session_id, period, week FROM course_slot WHERE session_id IN (${sessions.map(() => '?').join(',')})`,
        )
        .all(...sessions.map((s) => s.id))
    : []
  const bySession = new Map()
  for (const r of slotRows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, { periods: [], weeks: [] })
    const b = bySession.get(r.session_id)
    b.periods.push(r.period)
    b.weeks.push(r.week)
  }
  const sessionsByCourse = new Map()
  for (const s of sessions) {
    if (!sessionsByCourse.has(s.course_id)) sessionsByCourse.set(s.course_id, [])
    const b = bySession.get(s.id) ?? { periods: [], weeks: [] }
    sessionsByCourse.get(s.course_id).push({ weekday: s.weekday, periods: b.periods, weeks: b.weeks })
  }
  return new Set(
    existing.map((c) => courseDedupeKey({
      type: c.type, name: c.name, teacher: c.teacher, sessions: sessionsByCourse.get(c.id) ?? [],
    })),
  )
}

/** 模板列表（所有登录用户；含导入统计） */
templatesRouter.get(
  '/',
  wrap(async (req, res) => {
    const rows = db.prepare('SELECT * FROM template ORDER BY updated_at DESC, id DESC').all()
    const list = rows.map((r) => {
      const t = toTemplate(r)
      const stats = db
        .prepare('SELECT COUNT(*) AS n, MAX(imported_at) AS last FROM import_log WHERE template_id = ?')
        .get(r.id)
      return { ...t, importCount: stats.n, lastImportedAt: stats.last }
    })
    res.json({ templates: list })
  }),
)

/** 模板详情 */
templatesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM template WHERE id = ?').get(Number(req.params.id))
    if (!row) throw notFound('模板不存在')
    res.json({ template: toTemplate(row) })
  }),
)

/** 创建模板（admin） */
templatesRouter.post(
  '/',
  requireAdmin,
  wrap(async (req, res) => {
    const { kind, name, category, description, content } = req.body ?? {}
    const tkind = ['course', 'unit', 'semester'].includes(kind) ? kind : 'unit'
    const tname = String(name ?? '').trim()
    if (!tname || tname.length > 50) throw badRequest('模板名称须为 1-50 位')
    const validated =
      tkind === 'course' ? validateCourseTemplate(content)
      : tkind === 'semester' ? validateSemesterTemplate(content)
      : validateUnitContent(content)
    const info = db
      .prepare(
        `INSERT INTO template (kind, name, category, description, version, content, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        tkind,
        tname,
        String(category ?? '').slice(0, 30),
        String(description ?? '').slice(0, 200),
        JSON.stringify(validated),
        req.user.id,
        new Date().toISOString(),
        new Date().toISOString(),
      )
    res.status(201).json({ template: toTemplate(db.prepare('SELECT * FROM template WHERE id = ?').get(info.lastInsertRowid)) })
  }),
)

/** 更新模板（admin；version+1） */
templatesRouter.put(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM template WHERE id = ?').get(id)
    if (!row) throw notFound('模板不存在')
    const { kind, name, category, description, content } = req.body ?? {}
    const tkind = ['course', 'unit', 'semester'].includes(kind) ? kind : row.kind
    const tname = String(name ?? row.name).trim()
    if (!tname || tname.length > 50) throw badRequest('模板名称须为 1-50 位')
    const validated =
      content !== undefined
        ? tkind === 'course'
          ? validateCourseTemplate(content)
          : tkind === 'semester'
            ? validateSemesterTemplate(content)
            : validateUnitContent(content)
        : JSON.parse(row.content)
    db.prepare(
      `UPDATE template SET kind = ?, name = ?, category = ?, description = ?, content = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
    ).run(
      tkind,
      tname,
      String(category ?? row.category).slice(0, 30),
      String(description ?? row.description).slice(0, 200),
      JSON.stringify(validated),
      new Date().toISOString(),
      id,
    )
    res.json({ template: toTemplate(db.prepare('SELECT * FROM template WHERE id = ?').get(id)) })
  }),
)

/** 删除模板（admin；已导入的课程不受影响——快照语义） */
templatesRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM template WHERE id = ?').get(id)
    if (!row) throw notFound('模板不存在')
    const del = db.transaction(() => {
      if (row.kind === 'course') {
        const units = db.prepare("SELECT * FROM template WHERE kind = 'unit'").all()
        const update = db.prepare('UPDATE template SET content = ?, version = version + 1, updated_at = ? WHERE id = ?')
        for (const u of units) {
          const content = JSON.parse(u.content)
          if (content.length > 0 && typeof content[0] === 'number' && content.includes(id)) {
            const next = content.filter((x) => x !== id)
            update.run(JSON.stringify(next), new Date().toISOString(), u.id)
          }
        }
      }
      db.prepare('DELETE FROM template WHERE id = ?').run(id)
    })
    del()
    res.status(204).end()
  }),
)

/**
 * 导入课程组行到目标学期（共享实现）。
 * sessions 允许为空（无固定时间课程），与手动录入一致。
 * @returns { added, skipped, removed, snapshot }
 */
async function importRows(rows, { semesterId, userId, mode, maxPeriod, maxWeek }) {
  const validated = []
  const errors = []
  rows.forEach((r, i) => {
    try {
      validated.push(validateCourse(r, { maxPeriod, maxWeek }))
    } catch (e) {
      const first = e?.details?.[0]
      errors.push({ row: i + 1, message: first ? `${first.field}：${first.message}` : e.message })
    }
  })
  if (errors.length) throw badRequest('模板存在无效行', errors)

  assignCourseColors(validated, semesterId, userId, { overwrite: true })

  const existingKeys = mode === 'dedupe' ? existingKeysOf(semesterId, userId) : new Set()

  let snapshot = null
  let removed = 0
  if (mode === 'overwrite') {
    snapshot = await createSnapshot(db, DATA_DIR, 'template-overwrite')
    removed = db
      .prepare('SELECT COUNT(*) AS n FROM course WHERE semester_id = ? AND user_id = ?')
      .get(semesterId, userId).n
  }

  const run = db.transaction(() => {
    if (mode === 'overwrite') {
      db.prepare('DELETE FROM course WHERE semester_id = ? AND user_id = ?').run(semesterId, userId)
    }
    const insCourse = db.prepare(
      `INSERT INTO course (semester_id, user_id, type, name, teacher, location, color, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    let added = 0
    let skipped = 0
    for (const c of validated) {
      if (mode === 'dedupe' && existingKeys.has(courseDedupeKey(c))) {
        skipped++
        continue
      }
      const info = insCourse.run(semesterId, userId, c.type, c.name, c.teacher, c.location, c.color, c.remark)
      replaceCourseSessions(info.lastInsertRowid, c.sessions)
      added++
      existingKeys.add(courseDedupeKey(c))
    }
    return { added, skipped }
  })
  const { added, skipped } = run()
  return { added, skipped, removed, snapshot }
}

/** 批量导入多个课程模板（所有登录用户；复制快照到目标学期）
 * body: { semesterId, mode, templateIds: number[] } */
templatesRouter.post(
  '/import-batch',
  wrap(async (req, res) => {
    const { semesterId, mode, templateIds } = req.body ?? {}
    if (!['append', 'overwrite', 'dedupe'].includes(mode)) throw badRequest('mode 须为 append / overwrite / dedupe')
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')
    if (!Array.isArray(templateIds) || templateIds.length === 0) throw badRequest('templateIds 不能为空')
    const sem = db.prepare('SELECT id FROM semester WHERE id = ? AND user_id = ?').get(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')

    const ids = templateIds.map(Number)
    const placeholders = ids.map(() => '?').join(',')
    const refs = db.prepare(`SELECT * FROM template WHERE id IN (${placeholders})`).all(...ids)
    const found = new Set(refs.map((r) => r.id))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) throw badRequest(`模板不存在：id=${missing.join(',')}`)
    const badKind = refs.find((r) => r.kind !== 'course')
    if (badKind) throw badRequest(`批量导入仅支持课程模板：${badKind.name}`)

    const maxWeeks = weekLimitOf(semesterId)
    const rows = refs.flatMap((r) => resolveTemplateRows(r, maxWeeks))

    const { added, skipped, removed, snapshot } = await importRows(rows, {
      semesterId, userId: req.user.id, mode, maxPeriod: periodLimitOf(semesterId), maxWeek: weekLimitOf(semesterId),
    })

    const insLog = db.prepare(
      `INSERT INTO import_log (template_id, template_version, semester_id, user_id, mode, count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const t of refs) {
      insLog.run(t.id, t.version, semesterId, req.user.id, mode, added, new Date().toISOString())
    }

    res.json({ count: added, skipped, templateCount: refs.length, removed, snapshot })
  }),
)

/** 导入模板（所有登录用户；复制快照到目标学期）
 * body: { semesterId, mode }；学期模板导入时 semesterId 可传 0（自动创建学期） */
templatesRouter.post(
  '/:id/import',
  wrap(async (req, res) => {
    const { semesterId, mode } = req.body ?? {}
    if (!['append', 'overwrite', 'dedupe'].includes(mode)) throw badRequest('mode 须为 append / overwrite / dedupe')
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')

    const row = db.prepare('SELECT * FROM template WHERE id = ?').get(Number(req.params.id))
    if (!row) throw notFound('模板不存在')

    // 学期模板：创建学期 + 节次模板（不导入课程，无需目标学期）
    if (row.kind === 'semester') {
      const tpl = JSON.parse(row.content)
      const dup = db.prepare('SELECT id FROM semester WHERE name = ? AND user_id = ?').get(tpl.name, req.user.id)
      if (dup) throw badRequest(`学期「${tpl.name}」已存在`)
      const create = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO semester (name, start_date, end_date, week_start_day, updated_at, user_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(tpl.name, tpl.startDate, tpl.endDate, tpl.weekStartDay, new Date().toISOString(), req.user.id)
        const id = info.lastInsertRowid
        const insertPeriod = db.prepare(
          'INSERT INTO period_template (semester_id, user_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
        )
        tpl.periods.forEach((p, i) => insertPeriod.run(id, req.user.id, i + 1, p.startTime, p.endTime))
        setCurrentSemesterId(req.user.id, id)
        return id
      })
      const newSemId = create()
      db.prepare(
        `INSERT INTO import_log (template_id, template_version, semester_id, user_id, mode, count, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.version, newSemId, req.user.id, mode, tpl.periods.length, new Date().toISOString())
      return res.json({ count: 0, skipped: 0, templateCount: 1, semesterId: newSemId, semesterName: tpl.name })
    }

    const maxWeeks = weekLimitOf(semesterId)
    const rows = resolveTemplateRows(row, maxWeeks)

    const { added, skipped, removed, snapshot } = await importRows(rows, {
      semesterId, userId: req.user.id, mode, maxPeriod: periodLimitOf(semesterId), maxWeek: weekLimitOf(semesterId),
    })

    db.prepare(
      `INSERT INTO import_log (template_id, template_version, semester_id, user_id, mode, count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.version, semesterId, req.user.id, mode, added, new Date().toISOString())

    res.json({ count: added, skipped, templateCount: 1, removed, snapshot })
  }),
)
