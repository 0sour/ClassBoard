// ============================================================
// ClassBoard · 学期相关上限查询（节次模板行数 / 总周数）
// 手动录入、PDF 导入、模板导入三处共用，避免各自计算导致不一致。
// ============================================================
import { db } from './db.js'
import { semesterWeekCount, MAX_PERIODS, MAX_WEEKS } from './weekspan.js'

/**
 * 学期节次上限：节次模板行数（用户可增删，故不能写死）。
 * 未建节次模板时回退 MAX_PERIODS（24），与数据库 CHECK 一致。
 */
export function periodLimitOf(semesterId) {
  const n = db
    .prepare('SELECT COUNT(*) AS n FROM period_template WHERE semester_id = ?')
    .get(semesterId).n
  return n > 0 ? n : MAX_PERIODS
}

/** 学期总周数（旧格式展开与周次上限校验用）；学期不存在时回退 16 */
export function weekLimitOf(semesterId) {
  const sem = db.prepare('SELECT * FROM semester WHERE id = ?').get(semesterId)
  if (!sem) return 16
  return Math.min(semesterWeekCount(sem.start_date, sem.end_date, sem.week_start_day), MAX_WEEKS)
}
