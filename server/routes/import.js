// ============================================================
// ClassBoard · 导入确认路由（技术文档 4.3.5 #30）
// 覆盖模式单事务：清空目标学期课程（exam/homework 的 course_id
// 由 FK ON DELETE SET NULL 自动置空），再批量插入；任一行失败整批回滚。
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import { AppError, badRequest, notFound, wrap } from '../lib/errors.js'
import { validateCourse } from '../lib/validate.js'

export const importRouter = Router()

const MAX_ROWS = 2000

importRouter.post(
  '/confirm',
  wrap(async (req, res) => {
    const { mode, semesterId, rows } = req.body ?? {}
    if (!['append', 'overwrite'].includes(mode)) throw badRequest('mode 须为 append 或 overwrite')
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')
    const sem = db.prepare('SELECT id FROM semester WHERE id = ?').get(semesterId)
    if (!sem) throw notFound('学期不存在')
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('rows 不能为空')
    if (rows.length > MAX_ROWS) {
      throw new AppError(413, 'FILE_TOO_LARGE', `导入行数超过 ${MAX_ROWS} 上限`)
    }

    // 服务端逐行再校验（与手动录入共享约束），收集行级错误
    const validated = []
    const errors = []
    rows.forEach((row, i) => {
      try {
        validated.push(validateCourse(row))
      } catch (e) {
        if (e instanceof AppError && e.code === 'VALIDATION_ERROR') {
          const first = e.details?.[0]
          errors.push({ row: i + 1, message: first ? first.message : e.message })
        } else {
          errors.push({ row: i + 1, message: '字段校验失败' })
        }
      }
    })
    if (errors.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '存在非法导入行', errors)
    }

    const run = db.transaction(() => {
      if (mode === 'overwrite') {
        db.prepare('DELETE FROM course WHERE semester_id = ?').run(semesterId)
      }
      const insert = db.prepare(
        `INSERT INTO course (semester_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const c of validated) {
        insert.run(
          semesterId, c.type, c.name, c.teacher, c.location, c.color, c.weekType,
          c.weekList ? JSON.stringify(c.weekList) : null,
          c.weekday, c.startPeriod, c.endPeriod, c.remark,
        )
      }
      return validated.length
    })
    const count = run()
    res.json({ count })
  }),
)
