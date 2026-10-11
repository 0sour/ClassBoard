// ============================================================
// ClassBoard · 学期日历路由（放假 / 整日移课）
//   holiday：该日放假（不上课），支持日期区间，逐日展开落库
//   shift  ：整日移课——把「from 这一天」的课移到「to 这一天」；
//            源日显示为调休（不上课）、目标日显示源日当天的课
// 只影响某一天的课表呈现，不改动 course_slot 的周次存储。
// ============================================================
import { Router } from 'express'
import { db, getCurrentSemesterId, toDayRule } from '../lib/db.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'
import { isValidDate } from '../lib/validate.js'
import { fmtDate, parseLocalDate } from '../lib/weekspan.js'

export const calendarRouter = Router()

const RULE_KINDS = ['holiday', 'shift']

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
 * 设置日历规则。
 * body:
 *   - 放假：{ semesterId, kind: 'holiday', from, to, note? }（from..to 为放假区间）
 *   - 移课：{ semesterId, kind: 'shift', from, to, note? }（from = 原上课日，to = 移到哪天）
 *   - 清除：{ semesterId, kind: 'clear', from, to }（清除 from..to 内已录的规则）
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
      if (from < semester.start_date || from > semester.end_date) {
        issues.push({ field: 'from', message: '日期须在学期范围内' })
      }
      if (to < semester.start_date || to > semester.end_date) {
        issues.push({ field: 'to', message: '日期须在学期范围内' })
      }
      // 放假与清除是区间语义；移课是「某日 → 某日」的一对一关系（允许往前移，如周六的课移到周五）
      if (kind !== 'shift' && to < from) {
        issues.push({ field: 'to', message: '结束日期不能早于起始日期' })
      }
      if (kind === 'shift' && from === to) {
        issues.push({ field: 'to', message: '「移到哪天」不能与原上课日相同' })
      }
    }
    if (![...RULE_KINDS, 'clear'].includes(kind)) {
      issues.push({ field: 'kind', message: 'kind 须为 holiday / shift / clear' })
    }
    if (body.note != null && String(body.note).length > 100) {
      issues.push({ field: 'note', message: '备注长度须 ≤ 100' })
    }
    if (issues.length) throw badRequest('日历校验失败', issues)

    const note = String(body.note ?? '')

    const apply = db.transaction(() => {
      if (kind === 'clear') {
        const dates = datesInRange(from, to)
        const del = db.prepare('DELETE FROM semester_day_rule WHERE semester_id = ? AND date = ?')
        for (const d of dates) del.run(semesterId, d)
        return
      }
      if (kind === 'shift') {
        // 一对一：日期唯一键落在源日上（同一源日再录一次即覆盖）
        db.prepare(
          `INSERT INTO semester_day_rule (semester_id, date, kind, to_date, note)
           VALUES (?, ?, 'shift', ?, ?)
           ON CONFLICT(semester_id, date) DO UPDATE SET kind = 'shift', to_date = excluded.to_date, note = excluded.note`,
        ).run(semesterId, from, to, note)
        return
      }
      const up = db.prepare(
        `INSERT INTO semester_day_rule (semester_id, date, kind, to_date, note)
         VALUES (?, ?, 'holiday', NULL, ?)
         ON CONFLICT(semester_id, date) DO UPDATE SET kind = 'holiday', to_date = NULL, note = excluded.note`,
      )
      for (const d of datesInRange(from, to)) up.run(semesterId, d, note)
    })
    apply()
    res.json(listRules(semesterId))
  }),
)
