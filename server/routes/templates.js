// ============================================================
// ClassBoard · 课程模板路由
// 模板 = 一组课程行（JSON），管理员维护，用户一键导入（复制快照）
// 列表/详情/导入：所有登录用户；创建/编辑/删除：仅 admin
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { requireAdmin } from '../lib/access.js'
import { validateCourse } from '../lib/validate.js'

export const templatesRouter = Router()

const MAX_ROWS = 2000

/** 模板行 → API 对象 */
function toTemplate(row) {
  return {
    id: row.id,
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

/** 校验模板内容（课程行数组），返回规范化行 */
function validateTemplateContent(content) {
  if (!Array.isArray(content) || content.length === 0) {
    throw badRequest('模板内容不能为空')
  }
  if (content.length > MAX_ROWS) {
    throw badRequest(`模板课程数超过 ${MAX_ROWS} 上限`)
  }
  return content.map((row, i) => {
    try {
      return validateCourse(row)
    } catch (e) {
      throw badRequest(`第 ${i + 1} 行课程数据无效：${e.message}`)
    }
  })
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
    const { name, category, description, content } = req.body ?? {}
    const tname = String(name ?? '').trim()
    if (!tname || tname.length > 50) throw badRequest('模板名称须为 1-50 位')
    const validated = validateTemplateContent(content)
    const info = db
      .prepare(
        `INSERT INTO template (name, category, description, version, content, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
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
    const { name, category, description, content } = req.body ?? {}
    const tname = String(name ?? row.name).trim()
    if (!tname || tname.length > 50) throw badRequest('模板名称须为 1-50 位')
    const validated = content !== undefined ? validateTemplateContent(content) : JSON.parse(row.content)
    db.prepare(
      `UPDATE template SET name = ?, category = ?, description = ?, content = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
    ).run(
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
    const info = db.prepare('DELETE FROM template WHERE id = ?').run(Number(req.params.id))
    if (!info.changes) throw notFound('模板不存在')
    res.status(204).end()
  }),
)

/** 一键导入模板（所有登录用户；复制快照到目标学期） */
templatesRouter.post(
  '/:id/import',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM template WHERE id = ?').get(id)
    if (!row) throw notFound('模板不存在')
    const { semesterId, mode } = req.body ?? {}
    if (!['append', 'overwrite', 'dedupe'].includes(mode)) throw badRequest('mode 须为 append / overwrite / dedupe')
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')
    const sem = db.prepare('SELECT id FROM semester WHERE id = ? AND user_id = ?').get(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')

    const templateRows = JSON.parse(row.content)
    // 目标学期节次行数（节次越界校验）
    const periodCount = db
      .prepare('SELECT COUNT(*) AS n FROM period_template WHERE semester_id = ?')
      .get(semesterId).n

    // 服务端逐行校验 + 节次越界检查
    const validated = []
    const errors = []
    templateRows.forEach((r, i) => {
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

    // 记录导入日志
    db.prepare(
      `INSERT INTO import_log (template_id, template_version, semester_id, user_id, mode, count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, row.version, semesterId, req.user.id, mode, added, new Date().toISOString())

    res.json({ count: added, skipped, templateVersion: row.version })
  }),
)
