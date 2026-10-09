// ============================================================
// ClassBoard · 课程工具单测：颜色轮询、冲突检测（以课程块为单位）
// ============================================================
import { describe, it, expect } from 'vitest'
import { blockKey, computeBlockOverlapGroups, isOverlap, pickCourseColor, sortBlocks } from '@/utils/course'
import { courseBlocks } from '@/utils/session'
import type { Course, CourseBlock, Weekday } from '@/types'

/** 测试用课程组 */
function makeCourse(over: Partial<Course> & { id: number; name: string }): Course {
  return {
    semesterId: 1,
    type: 'course',
    teacher: '',
    location: '',
    color: 'course-1',
    remark: '',
    sessions: [],
    ...over,
  }
}

/** 测试用课程块（由课程组派生，保证与运行时一致） */
function blockOf(
  over: Partial<Course> & { id: number; name: string },
  weekday: Weekday,
  periods: number[],
  weeks = [1, 2, 3],
): CourseBlock {
  const c = makeCourse({
    ...over,
    sessions: [{ weekday, location: '', periods, weeks }],
  })
  return courseBlocks(c)[0]
}

describe('pickCourseColor', () => {
  it('同名课程复用已有颜色，不占用轮询序号', () => {
    const existing = [{ name: '高等数学', color: 'course-3' }]
    const r = pickCourseColor(existing, '高等数学', 5)
    expect(r.color).toBe('course-3')
    expect(r.autoCount).toBe(5)
  })

  it('新课程按轮询序号取色并递增', () => {
    const r = pickCourseColor([], '新课程', 0)
    expect(r.color).toBe('course-1')
    expect(r.autoCount).toBe(1)
  })

  it('轮询越界后回绕到第一色', () => {
    const r = pickCourseColor([], '新课程', 8)
    expect(r.color).toBe('course-1')
  })

  it('已有同名课程颜色非法时按轮询重新分配', () => {
    const existing = [{ name: '高等数学', color: 'not-a-color' }]
    const r = pickCourseColor(existing, '高等数学', 2)
    expect(r.color).toBe('course-3')
  })
})

describe('isOverlap', () => {
  it('不同星期不重叠', () => {
    const a = blockOf({ id: 1, name: 'A' }, 1, [1, 2])
    const b = blockOf({ id: 2, name: 'B' }, 2, [1, 2])
    expect(isOverlap(a, b)).toBe(false)
  })

  it('同星期节次区间相交 → 重叠', () => {
    const a = blockOf({ id: 1, name: 'A' }, 1, [1, 2])
    const b = blockOf({ id: 2, name: 'B' }, 1, [2, 3])
    expect(isOverlap(a, b)).toBe(true)
  })

  it('同星期节次完全分离 → 不重叠', () => {
    const a = blockOf({ id: 1, name: 'A' }, 1, [1, 2])
    const b = blockOf({ id: 2, name: 'B' }, 1, [3, 4])
    expect(isOverlap(a, b)).toBe(false)
  })

  it('完全相同的节次 → 重叠', () => {
    const a = blockOf({ id: 1, name: 'A' }, 3, [5, 6])
    const b = blockOf({ id: 2, name: 'B' }, 3, [5, 6])
    expect(isOverlap(a, b)).toBe(true)
  })

  it('周次不同不影响冲突判定（冲突看节次）', () => {
    const a = blockOf({ id: 1, name: 'A' }, 1, [1, 2], [1, 3, 5])
    const b = blockOf({ id: 2, name: 'B' }, 1, [1, 2], [2, 4, 6])
    expect(isOverlap(a, b)).toBe(true)
  })
})

describe('computeBlockOverlapGroups', () => {
  it('无冲突时每组为空', () => {
    const a = blockOf({ id: 1, name: 'A' }, 1, [1, 2])
    const b = blockOf({ id: 2, name: 'B' }, 2, [1, 2])
    const groups = computeBlockOverlapGroups([a, b])
    expect(groups.get(a)).toEqual([])
    expect(groups.get(b)).toEqual([])
  })

  it('三方互相重叠时各自都列出其他两方', () => {
    const a = blockOf({ id: 1, name: 'A' }, 1, [1, 2, 3])
    const b = blockOf({ id: 2, name: 'B' }, 1, [2, 3, 4])
    const c = blockOf({ id: 3, name: 'C' }, 1, [3, 4, 5])
    const groups = computeBlockOverlapGroups([a, b, c])
    expect(groups.get(a)?.length).toBe(2)
    expect(groups.get(b)?.length).toBe(2)
    expect(groups.get(c)?.length).toBe(2)
  })

  it('同一课程的两个上课时间互不判为自身冲突', () => {
    const c = makeCourse({
      id: 7, name: '数字信号处理',
      sessions: [
        { weekday: 2, location: '', periods: [5, 6], weeks: [1] },
        { weekday: 4, location: '', periods: [5, 6], weeks: [1] },
      ],
    })
    const blocks = courseBlocks(c)
    expect(blocks.length).toBe(2)
    const groups = computeBlockOverlapGroups(blocks)
    expect(groups.get(blocks[0])).toEqual([])
    expect(groups.get(blocks[1])).toEqual([])
  })
})

describe('blockKey / sortBlocks', () => {
  it('同一课程不同上课时间的键互不相同', () => {
    const c = makeCourse({
      id: 7, name: 'X',
      sessions: [
        { weekday: 2, location: '', periods: [5], weeks: [1] },
        { weekday: 4, location: '', periods: [5], weeks: [1] },
      ],
    })
    const [b1, b2] = courseBlocks(c)
    expect(blockKey(b1)).not.toBe(blockKey(b2))
  })

  it('按星期与起始节次排序', () => {
    const a = blockOf({ id: 1, name: 'A' }, 3, [5])
    const b = blockOf({ id: 2, name: 'B' }, 1, [7])
    const c = blockOf({ id: 3, name: 'C' }, 1, [2])
    expect(sortBlocks([a, b, c]).map((x) => x.id)).toEqual([3, 2, 1])
  })
})
