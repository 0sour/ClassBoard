// ============================================================
// ClassBoard · 导入确认路由
// 覆盖模式单事务：快照 → 清空目标学期课程（exam/homework 的 course_id
// 由 FK ON DELETE SET NULL 自动置空）→ 批量插入；任一行失败整批回滚。
// 覆盖可选 keepLabs：保留该学期已有的实验课（PDF 导入只产理论课时的救生索）。
// ============================================================
import { Router } from 'express'
import { db, DATA_DIR, replaceCourseSessions } from '../lib/db.js'
import { AppError, badRequest, notFound, wrap } from '../lib/errors.js'
import { validateCourse } from '../lib/validate.js'
import { assignCourseColors } from '../lib/colors.js'
import { createSnapshot } from '../lib/snapshot.js'
import { periodLimitOf, weekLimitOf } from '../lib/semesters.js'

export const importRouter = Router()

const MAX_ROWS = 2000

importRouter.post(
  '/confirm',
  wrap(async (req, res) => {
    const { mode, semesterId, rows, keepLabs = false } = req.body ?? {}
    if (!['append', 'overwrite'].includes(mode)) throw badRequest('mode 须为 append 或 overwrite')
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')
    const sem = db.prepare('SELECT id FROM semester WHERE id = ? AND user_id = ?').get(semesterId, req.user.id)
    if (!sem) throw notFound('学期不存在')
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('rows 不能为空')
    if (rows.length > MAX_ROWS) {
      throw new AppError(413, 'FILE_TOO_LARGE', `导入行数超过 ${MAX_ROWS} 上限`)
    }

    const maxPeriod = periodLimitOf(semesterId)
    const maxWeek = weekLimitOf(semesterId)

    // 服务端逐行再校验（与手动录入共享约束），收集行级错误
    const validated = []
    const errors = []
    rows.forEach((row, i) => {
      try {
        validated.push(validateCourse(row, { maxPeriod, maxWeek }))
      } catch (e) {
        if (e instanceof AppError && e.code === 'VALIDATION_ERROR') {
          const first = e.details?.[0]
          errors.push({ row: i + 1, message: first ? `${first.field}：${first.message}` : e.message })
        } else {
          errors.push({ row: i + 1, message: '字段校验失败' })
        }
      }
    })
    if (errors.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '存在非法导入行', errors)
    }

    // 颜色分配：与手动录入、模板导入同一套规则（前端已算好颜色时保留其值）
    assignCourseColors(validated, semesterId, req.user.id)

    // 覆盖模式会删除数据：先做一致性快照
    let snapshot = null
    let removedCourses = 0
    let keptLabs = 0
    if (mode === 'overwrite') {
      snapshot = await createSnapshot(db, DATA_DIR, 'import-overwrite')
      removedCourses = db
        .prepare('SELECT COUNT(*) AS n FROM course WHERE semester_id = ? AND user_id = ?')
        .get(semesterId, req.user.id).n
      if (keepLabs) {
        keptLabs = db
          .prepare("SELECT COUNT(*) AS n FROM course WHERE semester_id = ? AND user_id = ? AND type = 'lab'")
          .get(semesterId, req.user.id).n
      }
    }

    const run = db.transaction(() => {
      if (mode === 'overwrite') {
        if (keepLabs) {
          db.prepare("DELETE FROM course WHERE semester_id = ? AND user_id = ? AND type != 'lab'").run(semesterId, req.user.id)
        } else {
          db.prepare('DELETE FROM course WHERE semester_id = ? AND user_id = ?').run(semesterId, req.user.id)
        }
      }
      const insCourse = db.prepare(
        `INSERT INTO course (semester_id, user_id, type, name, teacher, location, color, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const c of validated) {
        const info = insCourse.run(semesterId, req.user.id, c.type, c.name, c.teacher, c.location, c.color, c.remark)
        replaceCourseSessions(info.lastInsertRowid, c.sessions)
      }
      return validated.length
    })
    const count = run()
    res.json({ count, ...(snapshot ? { snapshot, removed: removedCourses, keptLabs } : {}) })
  }),
)
