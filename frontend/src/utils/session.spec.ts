// ============================================================
// ClassBoard · 上课时间工具单测：展开/收起、周次与节次文案、课程块派生
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  courseBlocks,
  isScheduled,
  normalizeInts,
  periodRange,
  periodsLabel,
  runsOf,
  toBlocks,
  weeksLabel,
} from '@/utils/session'
import type { Course, Weekday } from '@/types'

function makeCourse(sessions: Course['sessions'], over: Partial<Course> = {}): Course {
  return {
    id: 1,
    semesterId: 1,
    type: 'course',
    name: '数字信号处理',
    teacher: '陈俊如',
    location: 'C5科教中心217',
    color: 'course-2',
    remark: '',
    sessions,
    ...over,
  }
}

describe('normalizeInts', () => {
  it('去重并升序排序', () => {
    expect(normalizeInts([3, 1, 2, 3, 1])).toEqual([1, 2, 3])
  })
  it('过滤非整数与小于 1 的值', () => {
    expect(normalizeInts([0, -1, 1.5, 2, Number.NaN, 3])).toEqual([2, 3])
  })
  it('非数组返回空数组', () => {
    expect(normalizeInts(null)).toEqual([])
    expect(normalizeInts('abc')).toEqual([])
  })
})

describe('runsOf', () => {
  it('连续序列合并为单个区间', () => {
    expect(runsOf([1, 2, 3, 4])).toEqual([[1, 4]])
  })
  it('断开处切分区间', () => {
    expect(runsOf([1, 2, 5, 6, 9])).toEqual([[1, 2], [5, 6], [9, 9]])
  })
  it('空数组返回空列表', () => {
    expect(runsOf([])).toEqual([])
  })
  it('单元素返回单点区间', () => {
    expect(runsOf([7])).toEqual([[7, 7]])
  })
})

describe('periodRange', () => {
  it('展开为逐项节次', () => {
    expect(periodRange(3, 6)).toEqual([3, 4, 5, 6])
  })
  it('起止相同时为单节', () => {
    expect(periodRange(5, 5)).toEqual([5])
  })
  it('结束小于起始时返回空数组', () => {
    expect(periodRange(6, 3)).toEqual([])
  })
})

describe('periodsLabel（读取时派生，不写回）', () => {
  it('连续节次 → 区间文案', () => {
    expect(periodsLabel([3, 4, 5, 6])).toBe('第 3–6 节')
  })
  it('单节 → 单节文案', () => {
    expect(periodsLabel([5])).toBe('第 5 节')
  })
  it('不连续 → 顿号罗列', () => {
    expect(periodsLabel([3, 5])).toBe('第 3、5 节')
  })
  it('隔节规律 → 隔节文案', () => {
    expect(periodsLabel([1, 3, 5])).toBe('第 1–5 节（隔节）')
  })
  it('空数组 → 空串', () => {
    expect(periodsLabel([])).toBe('')
  })
  it('乱序输入也能正确归并', () => {
    expect(periodsLabel([6, 3, 5, 4])).toBe('第 3–6 节')
  })
})

describe('weeksLabel（读取时派生，不写回）', () => {
  const full = Array.from({ length: 16 }, (_, i) => i + 1)

  it('全周次 → 区间文案', () => {
    expect(weeksLabel(full)).toBe('第 1–16 周')
  })
  it('单周 → 单周文案', () => {
    expect(weeksLabel([11])).toBe('第 11 周')
  })
  it('连续子区间 → 区间文案', () => {
    expect(weeksLabel([11, 12, 13, 14])).toBe('第 11–14 周')
  })
  it('等差数列单周 → 单周文案', () => {
    expect(weeksLabel([1, 3, 5, 7])).toBe('第 1–7 周（单周）')
  })
  it('等差数列双周 → 双周文案', () => {
    expect(weeksLabel([2, 4, 6, 8])).toBe('第 2–8 周（双周）')
  })
  it('不规律周次 → 顿号罗列', () => {
    expect(weeksLabel([1, 2, 3, 5, 8])).toBe('第 1、2、3、5、8 周')
  })
  it('空数组 → 空串', () => {
    expect(weeksLabel([])).toBe('')
  })
})


describe('toBlocks / courseBlocks（课程组 → 可渲染块）', () => {
  const course = makeCourse([
    { id: 1, weekday: 2 as Weekday, location: 'C5科教中心217', periods: [5, 6], weeks: [1, 2, 3] },
    { id: 2, weekday: 4 as Weekday, location: '实验楼B103', periods: [9, 10], weeks: [11, 12, 13, 14] },
  ])

  it('每个上课时间派生一个块，sessionId 保留', () => {
    const blocks = courseBlocks(course)
    expect(blocks.length).toBe(2)
    expect(blocks.map((b) => b.sessionId)).toEqual([1, 2])
  })

  it('块的地点优先取上课时间自己的，空则沿用课程默认', () => {
    const c = makeCourse([
      { weekday: 1 as Weekday, location: '', periods: [1], weeks: [1] },
    ])
    expect(courseBlocks(c)[0].location).toBe('C5科教中心217')
  })

  it('派生 startPeriod/endPeriod 与 runs', () => {
    const b = courseBlocks(course)[0]
    expect(b.startPeriod).toBe(5)
    expect(b.endPeriod).toBe(6)
    expect(b.runs).toEqual([[5, 6]])
    expect(b.periods).toEqual([5, 6])
  })

  it('节次稀疏时 endPeriod 取最大值（网格定位用）', () => {
    const c = makeCourse([{ weekday: 1 as Weekday, location: '', periods: [3, 4, 7], weeks: [1] }])
    const b = courseBlocks(c)[0]
    expect(b.startPeriod).toBe(3)
    expect(b.endPeriod).toBe(7)
    expect(b.runs).toEqual([[3, 4], [7, 7]])
  })

  it('按周号过滤：该周上课的块 active 且有节次', () => {
    const blocks = toBlocks(course, 12)
    const active = blocks.filter((b) => b.active)
    expect(active.length).toBe(1)
    expect(active[0].weekday).toBe(4)
    expect(active[0].periods).toEqual([9, 10])
  })

  it('按周号过滤：该周不上课的块 active=false 且节次为空（不渲染）', () => {
    // 第 5 周：块 1（weeks [1,2,3]）不上课，块 2（weeks [11..14]）也不上课
    const blocks5 = toBlocks(course, 5)
    expect(blocks5[0].active).toBe(false)
    expect(blocks5[0].periods).toEqual([])
    expect(blocks5[1].active).toBe(false)
    // 第 2 周：块 1 上课、块 2 不上课
    const blocks2 = toBlocks(course, 2)
    expect(blocks2[0].active).toBe(true)
    expect(blocks2[1].active).toBe(false)
    expect(blocks2[1].periods).toEqual([])
  })

  it('weekNumber 为 null 时全部视为 active（不做周过滤）', () => {
    const blocks = toBlocks(course, null)
    expect(blocks.every((b) => b.active)).toBe(true)
  })

  it('无固定时间课程（空 sessions）派生零个块', () => {
    const c = makeCourse([])
    expect(courseBlocks(c)).toEqual([])
    expect(isScheduled(c)).toBe(false)
  })

  it('isScheduled 对有上课时间的课程为 true', () => {
    expect(isScheduled(course)).toBe(true)
  })
})

describe('场景回归：实验课不会被周次过滤丢失', () => {
  it('实验课仅在第 11–14 周出现，其他周不渲染但数据仍在', () => {
    const lab = makeCourse(
      [{ weekday: 4 as Weekday, location: '实验楼B103', periods: [9, 10], weeks: [11, 12, 13, 14] }],
      { type: 'lab', name: '数字信号处理实验' },
    )
    for (const w of [11, 12, 13, 14]) {
      const blocks = toBlocks(lab, w).filter((b) => b.active)
      expect(blocks.length, `第 ${w} 周应出现`).toBe(1)
    }
    for (const w of [1, 5, 10, 15]) {
      expect(toBlocks(lab, w).filter((b) => b.active).length, `第 ${w} 周不应出现`).toBe(0)
    }
    // 数据本身始终完整（不因某周不可见而丢周次）
    expect(lab.sessions[0].weeks).toEqual([11, 12, 13, 14])
  })
})
