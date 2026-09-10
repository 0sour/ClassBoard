// ============================================================
// ClassBoard · 模板路由（两级模板体系）
// course 模板：单门课程定义（同学勾选批量导入）
// unit 模板：组合模板，引用课程模板 id 数组（一键批量导入）
// 列表/详情/导入：所有登录用户；创建/编辑/删除：仅 admin
// ============================================================
import { Router } from 'express'
import { db, setCurrentSemesterId } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { requireAdmin } from '../lib/access.js'
import { validateCourse } from '../lib/validate.js'

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

/** 校验课程模板内容（1-N 门课程行；固定课表 1 行 / 每节课调整 N 行） */
function validateCourseTemplate(content) {
  if (!Array.isArray(content) || content.length === 0) {
    throw badRequest('课程模板须包含至少一门课程')
  }
  if (content.length > MAX_ROWS) {
    throw badRequest(`课程模板课程数超过 ${MAX_ROWS} 上限`)
  }
  return content.map((row, i) => {
    try {
      return validateCourse(row)
    } catch (e) {
      throw badRequest(`第 ${i + 1} 行课程数据无效：${e.message}`)
    }
  })
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
  // 课程行数组 → 快照（逐行校验）
  return content.map((row, i) => {
    try {
      return validateCourse(row)
    } catch (e) {
      throw badRequest(`第 ${i + 1} 行课程数据无效：${e.message}`)
    }
  })
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

/** 解析模板为课程行数组（course 直接返回；unit 展开引用或快照；semester 返回空） */
function resolveTemplateRows(row) {
  if (row.kind === 'semester') return []
  const content = JSON.parse(row.content)
  if (row.kind === 'course') return content
  // 快照（课程行数组）直接返回
  if (content.length > 0 && typeof content[0] !== 'number') return content
  // 引用（id 数组）展开课程模板
  const placeholders = content.map(() => '?').join(',')
  const refs = db.prepare(`SELECT * FROM template WHERE id IN (${placeholders})`).all(...content)
  return refs.flatMap((r) => JSON.parse(r.content))
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
      // 删除课程模板时，从引用它的组合模板中移除该 id（避免残留失效引用）
      if (row.kind === 'course') {
        const units = db.prepare("SELECT * FROM template WHERE kind = 'unit'").all()
        const update = db.prepare('UPDATE template SET content = ?, version = version + 1, updated_at = ? WHERE id = ?')
        for (const u of units) {
          const content = JSON.parse(u.content)
          // 仅处理引用形态（id 数组）；快照形态（课程行数组）不受影响
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

    const rows = refs.flatMap((r) => JSON.parse(r.content))
    const periodCount = db
      .prepare('SELECT COUNT(*) AS n FROM period_template WHERE semester_id = ?')
      .get(semesterId).n

    const validated = []
    const errors = []
    rows.forEach((r, i) => {
      try {
        const c = validateCourse(r)
        if (c.endPeriod > periodCount) {
          errors.push({ row: i + 1, message: `节次 ${c.endPeriod} 超出目标学期节次模板（共 ${periodCount} 节）` })
          return
        }
        validated.push(c)
      } catch (e) {
        errors.push({ row: i + 1, message: e.message })
      }
    })
    if (errors.length) throw badRequest('模板存在无效行', errors)

    // 颜色分配：同名复用已有颜色，不同名按 8 色轮询（与手动录入一致）
    const colorRows = db
      .prepare('SELECT name, color FROM course WHERE semester_id = ? AND user_id = ?')
      .all(semesterId, req.user.id)
    const colorByName = new Map(colorRows.map((c) => [c.name, c.color]))
    const COLOR_NAMES = ['course-1', 'course-2', 'course-3', 'course-4', 'course-5', 'course-6', 'course-7', 'course-8']
    let autoCount = colorRows.length
    for (const c of validated) {
      if (colorByName.has(c.name)) {
        c.color = colorByName.get(c.name)
      } else {
        c.color = COLOR_NAMES[autoCount % COLOR_NAMES.length]
        autoCount++
        colorByName.set(c.name, c.color)
      }
    }

    const existing = db
      .prepare('SELECT name, weekday, start_period AS startPeriod, end_period AS endPeriod FROM course WHERE semester_id = ? AND user_id = ?')
      .all(semesterId, req.user.id)
    const dupKey = (c) => `${c.name}|${c.weekday}|${c.startPeriod}-${c.endPeriod}`
    const existingKeys = new Set(existing.map(dupKey))

    const run = db.transaction(() => {
      if (mode === 'overwrite') {
        db.prepare('DELETE FROM course WHERE semester_id = ? AND user_id = ?').run(semesterId, req.user.id)
      }
      const insert = db.prepare(
        `INSERT INTO course (semester_id, user_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      let added = 0
      let skipped = 0
      for (const c of validated) {
        if (mode === 'dedupe' && existingKeys.has(dupKey(c))) {
          skipped++
          continue
        }
        insert.run(
          semesterId, req.user.id, c.type, c.name, c.teacher, c.location, c.color, c.weekType,
          c.weekList ? JSON.stringify(c.weekList) : null,
          c.weekday, c.startPeriod, c.endPeriod, c.remark,
        )
        added++
        existingKeys.add(dupKey(c))
      }
      return { added, skipped }
    })
    const { added, skipped } = run()

    const insLog = db.prepare(
      `INSERT INTO import_log (template_id, template_version, semester_id, user_id, mode, count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const t of refs) {
      insLog.run(t.id, t.version, semesterId, req.user.id, mode, added, new Date().toISOString())
    }

    res.json({ count: added, skipped, templateCount: refs.length })
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

    const rows = resolveTemplateRows(row)
    const logTargets = [row]

    // 目标学期节次行数（节次越界校验）
    const periodCount = db
      .prepare('SELECT COUNT(*) AS n FROM period_template WHERE semester_id = ?')
      .get(semesterId).n

    // 服务端逐行校验 + 节次越界检查
    const validated = []
    const errors = []
    rows.forEach((r, i) => {
      try {
        const c = validateCourse(r)
        if (c.endPeriod > periodCount) {
          errors.push({ row: i + 1, message: `节次 ${c.endPeriod} 超出目标学期节次模板（共 ${periodCount} 节）` })
          return
        }
        validated.push(c)
      } catch (e) {
        errors.push({ row: i + 1, message: e.message })
      }
    })
    if (errors.length) {
      throw badRequest('模板存在无效行', errors)
    }

    // 颜色分配：同名复用已有颜色，不同名按 8 色轮询（与手动录入一致）
    const colorRows = db
      .prepare('SELECT name, color FROM course WHERE semester_id = ? AND user_id = ?')
      .all(semesterId, req.user.id)
    const colorByName = new Map(colorRows.map((c) => [c.name, c.color]))
    const COLOR_NAMES = ['course-1', 'course-2', 'course-3', 'course-4', 'course-5', 'course-6', 'course-7', 'course-8']
    let autoCount = colorRows.length
    for (const c of validated) {
      if (colorByName.has(c.name)) {
        c.color = colorByName.get(c.name)
      } else {
        c.color = COLOR_NAMES[autoCount % COLOR_NAMES.length]
        autoCount++
        colorByName.set(c.name, c.color)
      }
    }

    // 去重：同名 + 同星期 + 同节次视为重复
    const existing = db
      .prepare('SELECT name, weekday, start_period AS startPeriod, end_period AS endPeriod FROM course WHERE semester_id = ? AND user_id = ?')
      .all(semesterId, req.user.id)
    const dupKey = (c) => `${c.name}|${c.weekday}|${c.startPeriod}-${c.endPeriod}`
    const existingKeys = new Set(existing.map(dupKey))

    const run = db.transaction(() => {
      if (mode === 'overwrite') {
        db.prepare('DELETE FROM course WHERE semester_id = ? AND user_id = ?').run(semesterId, req.user.id)
      }
      const insert = db.prepare(
        `INSERT INTO course (semester_id, user_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      let added = 0
      let skipped = 0
      for (const c of validated) {
        if (mode === 'dedupe' && existingKeys.has(dupKey(c))) {
          skipped++
          continue
        }
        insert.run(
          semesterId, req.user.id, c.type, c.name, c.teacher, c.location, c.color, c.weekType,
          c.weekList ? JSON.stringify(c.weekList) : null,
          c.weekday, c.startPeriod, c.endPeriod, c.remark,
        )
        added++
        existingKeys.add(dupKey(c))
      }
      return { added, skipped }
    })
    const { added, skipped } = run()

    // 记录导入日志（每个模板一条）
    const insLog = db.prepare(
      `INSERT INTO import_log (template_id, template_version, semester_id, user_id, mode, count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const t of logTargets) {
      insLog.run(t.id, t.version, semesterId, req.user.id, mode, added, new Date().toISOString())
    }

    res.json({ count: added, skipped, templateCount: logTargets.length })
  }),
)
