// ============================================================
// ClassBoard · 课程颜色分配（唯一来源，供 validate / templates / import / backup 共用）
// 规则（技术设计 3.3.1）：8 色轮询；同课程名复用已有颜色，不占用新的轮询序号。
// ============================================================
import { db } from './db.js'

/** 8 色预设色名（顺序即轮询顺序） */
export const COURSE_COLOR_NAMES = [
  'course-1', 'course-2', 'course-3', 'course-4',
  'course-5', 'course-6', 'course-7', 'course-8',
]

export function isValidColor(name) {
  return COURSE_COLOR_NAMES.includes(name)
}

/**
 * 为目标学期的一批课程行分配颜色。
 * @param rows               课程行（原地修改 color 字段）
 * @param opts.overwrite     true=一律按「同名复用 + 轮询」重新推导（模板导入语义：
 *                           模板内容里的颜色是保存时的快照，导入到新学期应重新分配）
 *                           false=仅补齐缺失/非法的颜色，已提供的合法颜色予以保留
 *                           （PDF 导入语义：前端已按同一规则算好颜色，服务端不覆盖）
 */
export function assignCourseColors(rows, semesterId, userId, { overwrite = false } = {}) {
  const existing = db
    .prepare('SELECT name, color FROM course WHERE semester_id = ? AND user_id = ?')
    .all(semesterId, userId)
  const colorByName = new Map(existing.map((c) => [c.name, c.color]))
  let autoCount = existing.length

  for (const c of rows) {
    if (!overwrite && isValidColor(c.color)) {
      // 已提供合法颜色：仅登记，使其后续同名行可复用
      if (!colorByName.has(c.name)) colorByName.set(c.name, c.color)
      continue
    }
    if (colorByName.has(c.name)) {
      c.color = colorByName.get(c.name)
    } else {
      c.color = COURSE_COLOR_NAMES[autoCount % COURSE_COLOR_NAMES.length]
      autoCount++
      colorByName.set(c.name, c.color)
    }
  }
  return rows
}
