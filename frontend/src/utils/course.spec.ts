import { describe, expect, it } from 'vitest'
import {
  computeOverlapGroups,
  isOverlap,
  pickCourseColor,
  sortCourses,
} from '@/utils/course'
import type { Course } from '@/types'

function makeCourse(overrides: Partial<Course> & { id: number; name: string }): Course {
  return {
    semesterId: 1,
    type: 'course',
    teacher: '',
    location: '',
    color: 'course-1',
    weekType: 'all',
    weekList: null,
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
    remark: '',
    ...overrides,
  }
}

describe('course 工具：颜色轮询', () => {
  it('无同名课程时按录入顺序轮询 8 色', () => {
    const existing: Pick<Course, 'name' | 'color'>[] = []
    const r1 = pickCourseColor(existing, '高等数学', 0)
    expect(r1.color).toBe('course-1')
    expect(r1.autoCount).toBe(1)

    const existing2 = [...existing, { name: '高等数学', color: 'course-1' }]
    const r2 = pickCourseColor(existing2, '大学英语', 1)
    expect(r2.color).toBe('course-2')
    expect(r2.autoCount).toBe(2)
  })

  it('同名课程复用已有颜色且不推进轮询序号', () => {
    const existing = [{ name: '高等数学', color: 'course-1' }]
    const r = pickCourseColor(existing, '高等数学', 5)
    expect(r.color).toBe('course-1')
    expect(r.autoCount).toBe(5)
  })

  it('超过 8 门后回到 course-1 继续轮询', () => {
    const existing: Pick<Course, 'name' | 'color'>[] = []
    const r = pickCourseColor(existing, '第9门课', 8)
    expect(r.color).toBe('course-1')
  })
})

describe('course 工具：冲突检测', () => {
  it('同天节次区间相交视为冲突', () => {
    const a = makeCourse({ id: 1, name: 'A', weekday: 1, startPeriod: 1, endPeriod: 2 })
    const b = makeCourse({ id: 2, name: 'B', weekday: 1, startPeriod: 2, endPeriod: 3 })
    expect(isOverlap(a, b)).toBe(true)
  })

  it('同天节次区间不相交不冲突', () => {
    const a = makeCourse({ id: 1, name: 'A', weekday: 1, startPeriod: 1, endPeriod: 2 })
    const b = makeCourse({ id: 2, name: 'B', weekday: 1, startPeriod: 3, endPeriod: 4 })
    expect(isOverlap(a, b)).toBe(false)
  })

  it('不同天不冲突', () => {
    const a = makeCourse({ id: 1, name: 'A', weekday: 1, startPeriod: 1, endPeriod: 2 })
    const b = makeCourse({ id: 2, name: 'B', weekday: 2, startPeriod: 1, endPeriod: 2 })
    expect(isOverlap(a, b)).toBe(false)
  })
})

describe('course 工具：排序与冲突分组', () => {
  it('sortCourses 按星期、起始节次升序', () => {
    const c1 = makeCourse({ id: 1, name: '周一2节', weekday: 1, startPeriod: 2 })
    const c2 = makeCourse({ id: 2, name: '周一1节', weekday: 1, startPeriod: 1 })
    const c3 = makeCourse({ id: 3, name: '周日', weekday: 7, startPeriod: 1 })
    expect(sortCourses([c1, c3, c2]).map((c) => c.id)).toEqual([2, 1, 3])
  })

  it('computeOverlapGroups 找出全部冲突对', () => {
    const a = makeCourse({ id: 1, name: 'A', weekday: 1, startPeriod: 1, endPeriod: 2 })
    const b = makeCourse({ id: 2, name: 'B', weekday: 1, startPeriod: 2, endPeriod: 3 })
    const c = makeCourse({ id: 3, name: 'C', weekday: 2, startPeriod: 1, endPeriod: 2 })
    const groups = computeOverlapGroups([a, b, c])
    expect(groups.get(1)?.map((x) => x.id)).toEqual([2])
    expect(groups.get(2)?.map((x) => x.id)).toEqual([1])
    expect(groups.get(3)).toEqual([])
  })
})
