// ============================================================
// ClassBoard · 课程工具：颜色轮询、冲突检测、排序（以课程块为渲染单位）
// ============================================================
import { COURSE_COLOR_NAMES, type Course, type CourseBlock, type CourseColorName } from '@/types'

/**
 * 新课程颜色分配：按录入顺序从 8 色轮询；
 * 同课程名复用已有颜色，不占用新的轮询序号。
 */
export function pickCourseColor(
  existing: Pick<Course, 'name' | 'color'>[],
  name: string,
  autoCount: number,
): { color: CourseColorName; autoCount: number } {
  const hit = existing.find((c) => c.name === name)
  if (hit && COURSE_COLOR_NAMES.includes(hit.color as CourseColorName)) {
    return { color: hit.color as CourseColorName, autoCount }
  }
  const color = COURSE_COLOR_NAMES[autoCount % COURSE_COLOR_NAMES.length]
  return { color, autoCount: autoCount + 1 }
}

/** 两个课程块是否时间重叠（同列 + 完整节次集合相交）。
 * 用完整节次（allPeriods）而非当周节次：保证冲突分组稳定、不随周次跳变。 */
export function isOverlap(a: CourseBlock, b: CourseBlock): boolean {
  if (a.weekday !== b.weekday) return false
  const pa = a.allPeriods?.length ? a.allPeriods : a.periods
  const pb = b.allPeriods?.length ? b.allPeriods : b.periods
  if (!pa.length || !pb.length) return false
  const lo = Math.min(...pa)
  const hi = Math.max(...pa)
  const lo2 = Math.min(...pb)
  const hi2 = Math.max(...pb)
  return lo <= hi2 && lo2 <= hi
}

/** 按星期、起始节次排序（块） */
export function sortBlocks(blocks: CourseBlock[]): CourseBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday
    return a.startPeriod - b.startPeriod || a.id - b.id
  })
}

/** 计算某列课程块中与每块重叠的其他块（用于冲突分栏显示）。
 * 键为块标识（同一课程不同时间段用 `id:sessionId` 区分）。 */
export function computeBlockOverlapGroups(blocks: CourseBlock[]): Map<CourseBlock, CourseBlock[]> {
  const map = new Map<CourseBlock, CourseBlock[]>()
  for (const b of blocks) {
    const conflicts = blocks.filter((other) => other !== b && isOverlap(b, other))
    map.set(b, conflicts)
  }
  return map
}

/** 块的稳定唯一键（同一课程多个上课时间互不相同） */
export function blockKey(b: CourseBlock): string {
  return `${b.id}:${b.sessionId ?? 0}`
}
