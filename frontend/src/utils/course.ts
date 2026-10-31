// ============================================================
// ClassBoard · 课程工具：颜色轮询、冲突检测、排序（以课程块为渲染单位）
// ============================================================
import { COURSE_COLOR_NAMES, type Course, type CourseBlock, type CourseColorName, type ResolvedBlock } from '@/types'

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

/**
 * 课程下拉选项文案：实验课加「（实验）」后缀，避免与同名理论课混在列表里分不清
 * （教务导入的实验课常与理论课同名）。课名里已含「实验」二字的不再加后缀。
 */
export function courseOptionLabel(c: Pick<Course, 'name' | 'type'>): string {
  if (c.type === 'lab' && !c.name.includes('实验')) return `${c.name}（实验）`
  return c.name
}

/**
 * 两个课程块是否时间重叠（同列 + 节次区间相交）。
 *
 * 调休 / 调课会让**同一次发生**出现在另一天或当天另几个节次上；同一个上课时间组
 * 因此可能一天出现两次（基准一次、调来一次）。冲突必须按「当天实际所在的节次」
 * （periods）比较——若按原始节次（allPeriods）比较，「基准 5–6 节」和「从别处调来的
 * 7–8 节」会被误判成互相冲突，渲染层进而把调来的那块当成重复键丢掉
 * （会话 94 用户反馈：调课到 10/27 第 7–8 节，周课表上看不到）。periods 为空
 * （当周不上课）时仍退回 allPeriods，保留原来的「保守判断」。
 */
export function isOverlap(a: CourseBlock, b: CourseBlock): boolean {
  if (a.weekday !== b.weekday) return false
  const pa = a.periods.length ? a.periods : a.allPeriods
  const pb = b.periods.length ? b.periods : b.allPeriods
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

/**
 * 块的稳定唯一键：课程 + 时间组 + 基准日 + 起始节。
 * 调休 / 调课可能让同一时间组在同一天出现两次（基准一次、调来一次），
 * 键里必须带上「基准日 + 起始节」才能区分，否则渲染层会把其中一块当重复项丢掉。
 */
export function blockKey(b: CourseBlock): string {
  const origin = (b as Partial<ResolvedBlock>).originDate ?? ''
  return `${b.id}:${b.sessionId ?? 0}:${origin}:${b.startPeriod}`
}
