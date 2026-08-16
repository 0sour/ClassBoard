// ============================================================
// ClassBoard · 课程工具：颜色轮询、冲突检测、排序
// ============================================================
import { COURSE_COLOR_NAMES, type Course, type CourseColorName } from '@/types'

/**
 * 新课程颜色分配：按录入顺序从 8 色轮询；
 * 同课程名（name 相同）复用已有颜色，不占用新的轮询序号。
 * @param existing 已存在的课程（含本次会话内已新增的）
 * @param name 新课程名
 * @param autoCount 轮询累计器（同学期内按新建时间递增）
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

/** 判断两门课在同一列是否时间重叠（节次区间相交） */
export function isOverlap(a: Course, b: Course): boolean {
  if (a.weekday !== b.weekday) return false
  return a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod
}

/** 按星期、起始节次排序 */
export function sortCourses(courses: Course[]): Course[] {
  return [...courses].sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday
    return a.startPeriod - b.startPeriod
  })
}

/** 计算某列课程中与每门课重叠的其他课程集合（用于冲突错位显示） */
export function computeOverlapGroups(courses: Course[]): Map<number, Course[]> {
  const map = new Map<number, Course[]>()
  for (const c of courses) {
    const conflicts = courses.filter((other) => other.id !== c.id && isOverlap(c, other))
    map.set(c.id, conflicts)
  }
  return map
}
