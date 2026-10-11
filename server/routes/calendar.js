// ============================================================
// ClassBoard · 学期日历路由（放假 / 调休「按周几上课」）
// 只影响「某一天按谁的课表上课、当天有没有课」，不改动 course_slot 的周次存储。
// 区间录入逐日展开落库，列表展示再由前端合并为区间（读取时派生）。
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toDayRule } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { isValidDate } from '../lib/validate.js'
import { fmtDate, parseLocalDate } from '../lib/weekspan.js'

export const calendarRouter = Router()

const RULE_KINDS = ['holiday', 'follow']

function ownedSemester(semesterId, userId) {
  const sem = db.prepare('SELECT * FROM semester WHERE id = ? AND user_id = ?').get(semesterId, userId)
  if (!sem) throw notFound('学期不存在')
  return sem
}

function resolveSemesterId(query, userId) {
  if (query.semesterId !== undefined) return Number(query.semesterId)
  return getCurrentSemesterId(userId)
}

function listRules(semesterId) {
  return db
    .prepare('SELECT * FROM semester_day_rule WHERE semester_id = ? ORDER BY date ASC')
    .all(semesterId)
    .map(toDayRule)
}

/** 区间内全部日期（含两端） */
function datesInRange(from, to) {
  const out = []
  const d = parseLocalDate(from)
  const end = parseLocalDate(to)
  while (d.getTime() <= end.getTime() && out.length < 400) {
    out.push(fmtDate(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** 学期日历（按日期升序） */
calendarRouter.get(
  '/',
  wrap(async (req, res) => {
    const semesterId = resolveSemesterId(req.query, req.user.id)
    if (semesterId === null) return res.json([])
    ownedSemester(semesterId, req.user.id)
    res.json(listRules(semesterId))
  }),
)

/**
 * 区间设置日历规则（整段覆盖 / 清除）。
 * body: { semesterId, from, to, kind: 'holiday' | 'follow' | 'clear', followWeekday?, note? }
 * 返回该学期全部规则，前端直接整表替换。
 */
calendarRouter.put(
  '/',
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const semesterId = Number(body.semesterId)
    if (!Number.isInteger(semesterId)) throw badRequest('semesterId 取值无效')
    const semester = ownedSemester(semesterId, req.user.id)

    const { from, to, kind } = body
    const issues = []
    if (!(typeof from === 'string' && isValidDate(from))) {
      issues.push({ field: 'from', message: '起始日期格式须为 YYYY-MM-DD' })
    }
    if (!(typeof to === 'string' && isValidDate(to))) {
      issues.push({ field: 'to', message: '结束日期格式须为 YYYY-MM-DD' })
    }
    if (!issues.length) {
      if (to < from) issues.push({ field: 'to', message: '结束日期不能早于起始日期' })
      if (from < semester.start_date || to > semester.end_date) {
        issues.push({ field: 'from', message: '日期须在学期范围内' })
      }
    }
    if (![...RULE_KINDS, 'clear'].includes(kind)) {
      issues.push({ field: 'kind', message: 'kind 须为 holiday / follow / clear' })
    }
    if (kind === 'follow' && ![1, 2, 3, 4, 5, 6, 7].includes(body.followWeekday)) {
      issues.push({ field: 'followWeekday', message: '按周几上课须为 1-7' })
    }
    if (body.note != null && String(body.note).length > 100) {
      issues.push({ field: 'note', message: '备注长度须 ≤ 100' })
    }
    if (issues.length) throw badRequest('日历校验失败', issues)

    const dates = datesInRange(from, to)
    const note = String(body.note ?? '')
    const followWeekday = kind === 'follow' ? Number(body.followWeekday) : null

    const apply = db.transaction(() => {
      if (kind === 'clear') {
        const del = db.prepare('DELETE FROM semester_day_rule WHERE semester_id = ? AND date = ?')
        for (const d of dates) del.run(semesterId, d)
      } else {
        const up = db.prepare(
          `INSERT INTO semester_day_rule (semester_id, date, kind, follow_weekday, note)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(semester_id, date) DO UPDATE SET
             kind = excluded.kind, follow_weekday = excluded.follow_weekday, note = excluded.note`,
        )
        for (const d of dates) up.run(semesterId, d, kind, followWeekday, note)
      }
    })
    apply()
    res.json(listRules(semesterId))
  }),
)
