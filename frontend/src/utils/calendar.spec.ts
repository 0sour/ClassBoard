// ============================================================
// ClassBoard · 学期日历与单课调整解析测试
// 覆盖：放假 / 调休按周几上课 / 停课 / 调课（跨周）/ 补课 / 原位置标记 / 来源角标 /
//       周次+星期→日期 的边界（星期日起算、学期首日非周起点）
// 样例日期取自真实 2026 年 10 月：10/1 周四（国庆）、10/10 周六（调休补班）
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  adjustmentsOf,
  dateOfWeekday,
  dateWithWeekdayLabel,
  dayRuleLabel,
  groupDayRules,
  markerLabel,
  movedFromLabel,
  rangeLabel,
  resolveDay,
  sourceBadge,
  weekdayOfDateStr,
} from '@/utils/calendar'
import type { Course, CourseAdjustment, DayRule } from '@/types'

const semester = { startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 as const }

/** 周二 5–6 节的理论课（第 1–8 周）+ 同名实验课（仅第 7 周周四 7–8 节） */
const courses: Course[] = [
  {
    id: 1, semesterId: 1, type: 'course', name: '数字信号处理', teacher: '陈俊如',
    location: 'C5-217', color: 'course-1', remark: '',
    sessions: [{ id: 11, weekday: 4, location: '', periods: [5, 6], weeks: [1, 2, 3, 4, 5, 6, 7, 8] }],
  },
  {
    id: 2, semesterId: 1, type: 'lab', name: '数字信号处理', teacher: '',
    location: '实验楼302', color: 'course-2', remark: '',
    sessions: [{ id: 21, weekday: 4, location: '', periods: [7, 8], weeks: [7] }],
  },
]

const d = (s: string): Date => {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day)
}

const rule = (date: string, kind: 'holiday' | 'follow', followWeekday: number | null = null, note = ''): DayRule => ({
  id: 1, semesterId: 1, date, kind, followWeekday: followWeekday as DayRule['followWeekday'], note,
})

const adj = (over: Partial<CourseAdjustment>): CourseAdjustment => ({
  id: 1, courseId: 1, date: '2026-10-15', kind: 'cancel', fromWeekday: 4, fromPeriods: [5, 6],
  toDate: null, periods: [], location: '', note: '', createdAt: '2026-10-11T00:00:00.000Z', ...over,
})

describe('dateOfWeekday：周次 + 星期 → 日期（录入与校验共用）', () => {
  it('周一制学期：第 6 周周四 = 10/8（国庆假期中的那个周四）', () => {
    expect(dateOfWeekday(6, 4, semester)).toBe('2026-10-08')
    expect(dateOfWeekday(6, 7, semester)).toBe('2026-10-11') // 周日
    expect(dateOfWeekday(7, 4, semester)).toBe('2026-10-15')
  })

  it('星期日起算的学期：第 1 周周日 = 学期首周起点（早于起始日 8/30）', () => {
    const sun = { startDate: '2026-09-01', weekStartDay: 7 as const }
    expect(dateOfWeekday(1, 7, sun)).toBe('2026-08-30')
    expect(dateOfWeekday(1, 1, sun)).toBe('2026-08-31')
    expect(dateOfWeekday(2, 4, sun)).toBe('2026-09-10')
  })

  it('回读：日期 → 星期与生成时一致', () => {
    for (const w of [1, 5, 6, 12]) {
      for (const wd of [1, 2, 3, 4, 5, 6, 7] as const) {
        expect(weekdayOfDateStr(dateOfWeekday(w, wd, semester))).toBe(wd)
      }
    }
  })
})

describe('resolveDay：普通日 / 放假 / 调休按周几上课', () => {
  it('普通日：该日真实星期的课都出现，来源均为基准课表', () => {
    const day = resolveDay(d('2026-10-15'), { semester, courses })
    expect(day.weekNumber).toBe(7)
    expect(day.effectiveWeekday).toBe(4)
    expect(day.rule).toBeNull()
    expect(day.blocks.map((b) => b.id)).toEqual([1, 2])
    expect(day.blocks.every((b) => b.source === 'base')).toBe(true)
    // 实验课只在第 7 周，普通周不出现（第 6 周）
    const w6 = resolveDay(d('2026-10-08'), { semester, courses })
    expect(w6.blocks.map((b) => b.id)).toEqual([1])
  })

  it('放假：当天无课，effectiveWeekday 为 null，规则带备注', () => {
    const day = resolveDay(d('2026-10-08'), {
      semester, courses, rules: [rule('2026-10-08', 'holiday', null, '国庆节')],
    })
    expect(day.effectiveWeekday).toBeNull()
    expect(day.blocks).toEqual([])
    expect(day.rule?.kind).toBe('holiday')
    expect(dayRuleLabel(day.rule)).toBe('假期')
  })

  it('调休：10/10（周六）按周四课表上课——出现的是第 6 周周四的课', () => {
    const day = resolveDay(d('2026-10-10'), {
      semester, courses, rules: [rule('2026-10-10', 'follow', 4, '补 10/8 的课')],
    })
    expect(day.weekNumber).toBe(6)
    expect(day.effectiveWeekday).toBe(4)
    expect(day.blocks.map((b) => b.id)).toEqual([1]) // 第 6 周周四：只有理论课
    expect(day.blocks[0].periods).toEqual([5, 6])
    expect(dayRuleLabel(day.rule)).toBe('按周四课表')
  })

  it('未开学 / 学期结束：均无课', () => {
    expect(resolveDay(d('2026-08-20'), { semester, courses }).blocks).toEqual([])
    expect(resolveDay(d('2027-03-01'), { semester, courses }).blocks).toEqual([])
  })
})

describe('单课调整：停课 / 调课 / 补课与标记', () => {
  it('停课：原位置移除该课并留下标记，其他课不受影响', () => {
    const day = resolveDay(d('2026-10-15'), {
      semester, courses, adjustments: [adj({ id: 5, kind: 'cancel', note: '老师出差' })],
    })
    expect(day.blocks.map((b) => b.id)).toEqual([2]) // 理论课被移除，实验课还在
    expect(day.markers).toHaveLength(1)
    expect(day.markers[0]).toMatchObject({ courseId: 1, kind: 'cancel', periods: [5, 6], weekday: 4 })
    expect(markerLabel(day.markers[0])).toBe('停课（老师出差）')
  })

  it('调课（跨周同星期）：原位置留「已调至 …」，目标日出现带来源标记的块', () => {
    const move = adj({ id: 7, kind: 'move', date: '2026-10-15', toDate: '2026-10-17', periods: [3, 4] })
    // 原位置：10/15（周四）
    const src = resolveDay(d('2026-10-15'), { semester, courses, adjustments: [move] })
    expect(src.blocks.map((b) => b.id)).toEqual([2])
    expect(markerLabel(src.markers[0])).toBe('已调至 10月17日 第 3–4 节')
    // 目标位置：10/17（周六，第 7 周）
    const dst = resolveDay(d('2026-10-17'), { semester, courses, adjustments: [move] })
    const moved = dst.blocks.find((b) => b.source === 'moved')
    expect(moved).toBeTruthy()
    expect(moved!.id).toBe(1)
    expect(moved!.periods).toEqual([3, 4])
    expect(moved!.weekday).toBe(6)
    expect(moved!.fromDate).toBe('2026-10-15')
    expect(moved!.adjustmentId).toBe(7)
    expect(sourceBadge(moved!.source)).toBe('调课')
    expect(movedFromLabel(moved!)).toBe('由 10月15日（周四） 第 5–6 节 调来')
    expect(dst.markers).toEqual([])
  })

  it('调课到同一天的其他节次：仍是一次合法调整（日期相同）', () => {
    const move = adj({ id: 8, kind: 'move', date: '2026-10-15', toDate: '2026-10-15', periods: [9, 10] })
    const day = resolveDay(d('2026-10-15'), { semester, courses, adjustments: [move] })
    expect(day.blocks.map((b) => `${b.id}:${b.source}:${b.startPeriod}`)).toEqual(['2:base:7', '1:moved:9'])
    expect(day.markers).toHaveLength(1)
  })

  it('补课：额外一次课，带「补课」角标；显式指定优先于当天放假', () => {
    const extra = adj({ id: 9, courseId: 2, kind: 'extra', date: '2026-10-31', fromWeekday: null, fromPeriods: [], periods: [1, 2], location: '实验楼302', note: '补实验' })
    const day = resolveDay(d('2026-10-31'), {
      semester, courses, adjustments: [extra], rules: [rule('2026-10-31', 'holiday', null, '校庆')],
    })
    expect(day.rule?.kind).toBe('holiday')
    expect(day.blocks).toHaveLength(1)
    const b = day.blocks[0]
    expect(b.source).toBe('extra')
    expect(b.id).toBe(2)
    expect(b.periods).toEqual([1, 2])
    expect(b.location).toBe('实验楼302')
    expect(sourceBadge(b.source)).toBe('补课')
    expect(movedFromLabel(b)).toBe('补课（补实验）')
  })

  it('只影响被调整的那个时间组（同日同名课程的另一组不受影响）', () => {
    // 停掉实验课（周 4 第 7–8 节）：理论课（周 4 第 5–6 节）不受影响
    const day = resolveDay(d('2026-10-15'), {
      semester, courses, adjustments: [adj({ id: 10, courseId: 2, fromPeriods: [7, 8] })],
    })
    expect(day.blocks.map((b) => b.id)).toEqual([1])
    expect(day.markers[0]).toMatchObject({ courseId: 2, periods: [7, 8] })
  })

  it('节次对不上时不误伤：仅按星期匹配会命中，故按「星期 + 节次」精确定位', () => {
    // 理论课（节 5–6）配了 [7,8] 的调整（数据对不上）→ 不移除任何块，但仍留标记
    const day = resolveDay(d('2026-10-15'), {
      semester, courses, adjustments: [adj({ id: 12, courseId: 1, fromPeriods: [7, 8] })],
    })
    expect(day.blocks.map((b) => b.id)).toEqual([1, 2])
    expect(day.markers).toHaveLength(1)
  })

  it('调整块不再叠加自身：目标日不会同时出现基准块与被调来的块', () => {
    const move = adj({ id: 11, kind: 'move', date: '2026-10-15', toDate: '2026-10-15', periods: [5, 6] })
    const day = resolveDay(d('2026-10-15'), { semester, courses, adjustments: [move] })
    const ids = day.blocks.filter((b) => b.id === 1)
    expect(ids).toHaveLength(1)
    expect(ids[0].source).toBe('moved')
  })
})

describe('日历规则列表与文案', () => {
  it('连续日期合并为区间；类型/星期/备注不同则断开', () => {
    const rules: DayRule[] = [
      rule('2026-10-01', 'holiday', null, '国庆节'),
      { ...rule('2026-10-02', 'holiday', null, '国庆节'), id: 2 },
      { ...rule('2026-10-03', 'holiday', null, '国庆节'), id: 3 },
      { ...rule('2026-10-10', 'follow', 4, '补班'), id: 4 },
      { ...rule('2026-10-05', 'holiday', null, '调休放假'), id: 5 },
    ]
    const ranges = groupDayRules(rules)
    expect(ranges.map((r) => [rangeLabel(r), r.kind, r.dates.length])).toEqual([
      ['10月1日–10月3日', 'holiday', 3],
      ['10月5日', 'holiday', 1],
      ['10月10日', 'follow', 1],
    ])
  })

  it('日期文案带星期', () => {
    expect(dateWithWeekdayLabel('2026-10-15')).toBe('10月15日（周四）')
    expect(dateWithWeekdayLabel('2026-10-17')).toBe('10月17日（周六）')
  })

  it('adjustmentsOf：按课程过滤并升序', () => {
    const list: CourseAdjustment[] = [
      adj({ id: 3, date: '2026-10-20' }),
      adj({ id: 4, courseId: 2, date: '2026-10-10' }),
      adj({ id: 5, date: '2026-10-05' }),
    ]
    expect(adjustmentsOf(list, 1).map((a) => a.id)).toEqual([5, 3])
    expect(adjustmentsOf(list, 2).map((a) => a.id)).toEqual([4])
  })
})
