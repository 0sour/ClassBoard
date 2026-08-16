import { describe, expect, it } from 'vitest'
import {
  calcWeekNumber,
  formatDate,
  formatMonthDay,
  getWeekday,
  isOddWeek,
  isVisibleInWeek,
  parseDate,
  toMonday,
  weekDates,
} from '@/utils/week'

describe('week 工具：日期解析与格式化', () => {
  it('parseDate 按本地时间解析 YYYY-MM-DD', () => {
    const d = parseDate('2026-09-02')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8) // 9 月
    expect(d.getDate()).toBe(2)
  })

  it('formatDate 输出 YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 8, 2))).toBe('2026-09-02')
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('formatMonthDay 输出 月日', () => {
    expect(formatMonthDay(new Date(2026, 8, 2))).toBe('9月2日')
  })

  it('getWeekday 周一=1 周日=7', () => {
    // 2026-09-02 是周三（见样本）
    expect(getWeekday(new Date(2026, 8, 2))).toBe(3)
    expect(getWeekday(new Date(2026, 8, 6))).toBe(7) // 周日
  })
})

describe('week 工具：周次计算', () => {
  const semester = { startDate: '2026-09-02', endDate: '2026-12-27', weekStartDay: 1 as const }

  it('学期起始日所在周为第 1 周', () => {
    expect(calcWeekNumber(parseDate('2026-09-02'), semester)).toBe(1)
  })

  it('起始日 +7 天进入第 2 周', () => {
    expect(calcWeekNumber(parseDate('2026-09-09'), semester)).toBe(2)
  })

  it('早于学期起始日返回 0', () => {
    expect(calcWeekNumber(parseDate('2026-08-31'), semester)).toBe(0)
  })

  it('晚于学期结束日返回 null（假期）', () => {
    expect(calcWeekNumber(parseDate('2026-12-28'), semester)).toBeNull()
  })

  it('周起始日为周日时平移 1 天', () => {
    const sunSemester = { ...semester, weekStartDay: 7 as const }
    // 2026-09-06 是周日，作为第 1 周
    expect(calcWeekNumber(parseDate('2026-09-06'), sunSemester)).toBe(1)
  })
})

describe('week 工具：周视图日期', () => {
  it('toMonday 将任意日归位到所在周周一', () => {
    expect(formatDate(toMonday(new Date(2026, 8, 2)))).toBe('2026-08-31') // 周三 -> 周一
    expect(formatDate(toMonday(new Date(2026, 8, 6)))).toBe('2026-08-31') // 周日 -> 周一
  })

  it('weekDates 返回 7 天', () => {
    const days = weekDates(parseDate('2026-08-31'))
    expect(days).toHaveLength(7)
    expect(formatDate(days[0])).toBe('2026-08-31')
    expect(formatDate(days[6])).toBe('2026-09-06')
  })
})

describe('week 工具：单双周与可见性', () => {
  it('isOddWeek 奇数为单周', () => {
    expect(isOddWeek(1)).toBe(true)
    expect(isOddWeek(2)).toBe(false)
    expect(isOddWeek(null)).toBe(false)
  })

  it('all 规则任意周可见', () => {
    expect(isVisibleInWeek('all', null, 1)).toBe(true)
    expect(isVisibleInWeek('all', null, 3)).toBe(true)
    expect(isVisibleInWeek('all', null, null)).toBe(false)
  })

  it('odd 规则仅单周可见', () => {
    expect(isVisibleInWeek('odd', null, 1)).toBe(true)
    expect(isVisibleInWeek('odd', null, 2)).toBe(false)
  })

  it('even 规则仅双周可见', () => {
    expect(isVisibleInWeek('even', null, 2)).toBe(true)
    expect(isVisibleInWeek('even', null, 1)).toBe(false)
  })

  it('custom 规则按周列表匹配', () => {
    expect(isVisibleInWeek('custom', [1, 3, 5], 3)).toBe(true)
    expect(isVisibleInWeek('custom', [1, 3, 5], 4)).toBe(false)
    // 样本：1-10周,12周,15周
    expect(isVisibleInWeek('custom', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15], 12)).toBe(true)
  })
})
