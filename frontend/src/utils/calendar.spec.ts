// ============================================================
// ClassBoard · 学期日历与单课调整解析测试
// 覆盖：放假 / 整日移课（某日 → 某日，不假设每周重复）/ 停课 / 调课 / 补课 /
//       原位置标记 / 来源角标 / 周次+星期→日期 的边界（星期日起算、学期首日非周起点）
// 样例日期取自真实 2026 年 10 月：9/29 周二、10/1 周四（国庆）、10/10 周六（调休）
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  adjustmentsOf,
  dateOfWeekday,
  dateWithWeekdayLabel,
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
  {
    id: 3, semesterId: 1, type: 'lab', name: '集成电路设计综合实践', teacher: '',
    location: '', color: 'course-3', remark: '',
    // 跳周实验课：第 5 周周二 第 1–4 节（9/29 就是第 5 周周二）
    sessions: [{ id: 31, weekday: 2, location: '', periods: [1, 2, 3, 4], weeks: [5] }],
  },
]

const d = (s: string): Date => {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day)
}

const rule = (date: string, kind: 'holiday' | 'shift', toDate: string | null = null, note = ''): DayRule => ({
  id: 1, semesterId: 1, date, kind, toDate, note,
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

describe('resolveDay：普通日 / 放假', () => {
  it('普通日：该日真实星期的课都出现，来源均为基准课表', () => {
    const day = resolveDay(d('2026-10-15'), { semester, courses })
    expect(day.weekNumber).toBe(7)
    expect(day.effectiveWeekday).toBe(4)
    expect(day.rule).toBeNull()
    expect(day.blocks.map((b) => b.id)).toEqual([1, 2])
    expect(day.blocks.every((b) => b.source === 'base')).toBe(true)
    expect(day.dayLabel).toBe('')
  })

  it('放假：当天无课，角标「假期」，规则带备注', () => {
    const day = resolveDay(d('2026-10-01'), {
      semester, courses, rules: [rule('2026-10-01', 'holiday', null, '国庆节')],
    })
    expect(day.effectiveWeekday).toBeNull()
    expect(day.blocks).toEqual([])
    expect(day.dayLabel).toBe('假期')
  })

  it('未开学 / 学期结束：均无课', () => {
    expect(resolveDay(d('2026-08-20'), { semester, courses }).blocks).toEqual([])
    expect(resolveDay(d('2027-03-01'), { semester, courses }).blocks).toEqual([])
  })
})

describe('整日移课：把某天的课移到另一天（不假设课表每周重复）', () => {
  // 用户场景：9月29日（周二，第 5 周）的课移到 10月10日（周六）
  const shift = rule('2026-09-29', 'shift', '2026-10-10', '国庆调休')

  it('源日：当天无课，原位置逐门留「已移至 …」标记，角标「调休」', () => {
    const day = resolveDay(d('2026-09-29'), { semester, courses, rules: [shift] })
    expect(day.weekNumber).toBe(5)
    expect(day.effectiveWeekday).toBeNull()
    expect(day.blocks).toEqual([])
    expect(day.dayLabel).toBe('调休')
    // 9/29 是第 5 周周二：只有跳周的实践课（id=3）
    expect(day.markers.map((m) => [m.courseId, m.kind, m.periods])).toEqual([[3, 'shift', [1, 2, 3, 4]]])
    expect(markerLabel(day.markers[0])).toBe('已移至 10月10日（国庆调休）')
  })

  it('目标日：出现源日当天的课（第 5 周周二的实践课），带「调休」角标与来源说明', () => {
    const day = resolveDay(d('2026-10-10'), { semester, courses, rules: [shift] })
    expect(day.dayLabel).toBe('补 9月29日')
    const shifted = day.blocks.filter((b) => b.source === 'shifted')
    expect(shifted.map((b) => b.id)).toEqual([3])
    expect(shifted[0].periods).toEqual([1, 2, 3, 4])
    expect(shifted[0].weekday).toBe(6) // 渲染在周六（目标日真实星期）
    expect(shifted[0].fromDate).toBe('2026-09-29')
    expect(sourceBadge(shifted[0].source)).toBe('调休')
    expect(movedFromLabel(shifted[0])).toBe('9月29日（周二） 的课调至今天（国庆调休）')
  })

  it('关键：移来的课按「源日所在周」取，不会错取目标日那一周的课', () => {
    // 目标日所在周的周二（10/6 属第 6 周）并没有实践课，若按「周几」模型就会显示为空
    const day = resolveDay(d('2026-10-10'), { semester, courses, rules: [shift] })
    expect(day.blocks.some((b) => b.name === '集成电路设计综合实践')).toBe(true)
  })

  it('目标日本身也有课时，两批课并存', () => {
    // 10/10 是周六：正常没有课；换到有课的目标日验证并存
    const toThu = rule('2026-10-01', 'shift', '2026-10-15')
    const day = resolveDay(d('2026-10-15'), { semester, courses, rules: [toThu] })
    // 10/15 自己的两块（理论 + 实验） + 10/1（第 5 周周四）移来的理论课
    expect(day.blocks.map((b) => `${b.id}:${b.source}`)).toEqual(['1:base', '1:shifted', '2:base'])
    expect(day.dayLabel).toBe('补 10月1日')
  })

  it('目标日即使是假期，移来的课照常出现（显式指定优先）', () => {
    const rules = [rule('2026-09-29', 'shift', '2026-10-10', ''), rule('2026-10-10', 'holiday', null, '校庆')]
    const day = resolveDay(d('2026-10-10'), { semester, courses, rules })
    expect(day.rule?.kind).toBe('holiday')
    expect(day.blocks.map((b) => b.source)).toEqual(['shifted'])
  })

  it('源日没有课（休息日）时：无标记，目标日也不追加', () => {
    const sun = rule('2026-10-11', 'shift', '2026-10-13', '')
    const src = resolveDay(d('2026-10-11'), { semester, courses, rules: [sun] })
    expect(src.markers).toEqual([])
    expect(src.dayLabel).toBe('调休')
    const dst = resolveDay(d('2026-10-13'), { semester, courses, rules: [sun] })
    expect(dst.blocks.every((b) => b.source === 'base')).toBe(true)
  })
})

describe('单课调整：停课 / 调课 / 补课与标记', () => {
  it('停课：原位置移除该课并留下标记，其他课不受影响', () => {
    const day = resolveDay(d('2026-10-15'), {
      semester, courses, adjustments: [adj({ id: 5, kind: 'cancel', note: '老师出差' })],
    })
    expect(day.blocks.map((b) => b.id)).toEqual([2])
    expect(day.markers).toHaveLength(1)
    expect(day.markers[0]).toMatchObject({ courseId: 1, kind: 'cancel', periods: [5, 6], weekday: 4 })
    expect(markerLabel(day.markers[0])).toBe('停课（老师出差）')
  })

  it('调课（跨周同星期）：原位置留「已调至 …」，目标日出现带来源标记的块', () => {
    const move = adj({ id: 7, kind: 'move', date: '2026-10-15', toDate: '2026-10-17', periods: [3, 4] })
    const src = resolveDay(d('2026-10-15'), { semester, courses, adjustments: [move] })
    expect(src.blocks.map((b) => b.id)).toEqual([2])
    expect(markerLabel(src.markers[0])).toBe('已调至 10月17日 第 3–4 节')
    const dst = resolveDay(d('2026-10-17'), { semester, courses, adjustments: [move] })
    const moved = dst.blocks.find((b) => b.source === 'moved')
    expect(moved).toBeTruthy()
    expect(moved!.periods).toEqual([3, 4])
    expect(moved!.weekday).toBe(6)
    expect(moved!.fromDate).toBe('2026-10-15')
    expect(sourceBadge(moved!.source)).toBe('调课')
    expect(movedFromLabel(moved!)).toBe('由 10月15日（周四） 第 5–6 节 调来')
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
    expect(b.periods).toEqual([1, 2])
    expect(b.location).toBe('实验楼302')
    expect(sourceBadge(b.source)).toBe('补课')
  })

  it('只影响被调整的那个时间组（同日同名课程的另一组不受影响）', () => {
    const day = resolveDay(d('2026-10-15'), {
      semester, courses, adjustments: [adj({ id: 10, courseId: 2, fromPeriods: [7, 8] })],
    })
    expect(day.blocks.map((b) => b.id)).toEqual([1])
    expect(day.markers[0]).toMatchObject({ courseId: 2, periods: [7, 8] })
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
  it('连续放假日合并为区间；移课一行一对、不合并', () => {
    const rules: DayRule[] = [
      rule('2026-10-01', 'holiday', null, '国庆节'),
      { ...rule('2026-10-02', 'holiday', null, '国庆节'), id: 2 },
      { ...rule('2026-10-03', 'holiday', null, '国庆节'), id: 3 },
      { ...rule('2026-09-29', 'shift', '2026-10-10', '调休'), id: 4 },
      { ...rule('2026-10-05', 'holiday', null, '调休放假'), id: 5 },
    ]
    const ranges = groupDayRules(rules)
    expect(ranges.map((r) => [r.kind, rangeLabel(r), r.dates.length, r.toDate ?? ''])).toEqual([
      ['shift', '9月29日', 1, '2026-10-10'],
      ['holiday', '10月1日–10月3日', 3, ''],
      ['holiday', '10月5日', 1, ''],
    ])
  })

  it('日期文案带星期', () => {
    expect(dateWithWeekdayLabel('2026-10-15')).toBe('10月15日（周四）')
    expect(dateWithWeekdayLabel('2026-10-10')).toBe('10月10日（周六）')
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
