import { describe, expect, it } from 'vitest'
import {
  calcWeekNumber,
  formatDate,
  formatMonthDay,
  getWeekday,
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

  it('学期起始日所在周为第 1 周；早于起始日返回 0（未开学）', () => {
    expect(calcWeekNumber(parseDate('2026-09-02'), semester)).toBe(1)
    // 08-31 虽与起始日同属一个"周起点周"，但早于学期起始日 → 未开学
    expect(calcWeekNumber(parseDate('2026-08-31'), semester)).toBe(0)
    expect(calcWeekNumber(parseDate('2026-09-07'), semester)).toBe(2)
  })

  it('起始日 +7 天进入第 2 周', () => {
    expect(calcWeekNumber(parseDate('2026-09-09'), semester)).toBe(2)
  })

  it('早于学期起始日返回 0（未开学）', () => {
    expect(calcWeekNumber(parseDate('2026-08-30'), semester)).toBe(0)
    expect(calcWeekNumber(parseDate('2026-08-01'), semester)).toBe(0)
  })

  it('晚于学期结束日返回 null（假期）', () => {
    expect(calcWeekNumber(parseDate('2026-12-28'), semester)).toBeNull()
  })

  it('周起始日为周日时按周日对齐周起点', () => {
    const sunSemester = { ...semester, weekStartDay: 7 as const }
    // 起始日 09-02（周三）早于 09-06，故 09-05 仍属第 1 周；09-06（周日）进入第 2 周
    expect(calcWeekNumber(parseDate('2026-09-02'), sunSemester)).toBe(1)
    expect(calcWeekNumber(parseDate('2026-09-05'), sunSemester)).toBe(1)
    expect(calcWeekNumber(parseDate('2026-09-06'), sunSemester)).toBe(2)
  })
})

describe('week 工具：与服务端周号算法一致性（防止前后端漂移）', () => {
  /** 服务端 weekspan.js 的最小类型（无共享类型定义，此处按调用面声明） */
  type ServerWeekspan = {
    weekNumberIn: (start: string, end: string, weekStartDay: 1 | 7, date: Date) => number | null
    semesterWeekCount: (start: string, end: string, weekStartDay: 1 | 7) => number
  }

  async function loadServerWeekspan(): Promise<ServerWeekspan> {
    // 服务端 weekspan.js 是同仓库的 .js 模块（无类型声明），且位于前端项目根之外，
    // vitest 的模块运行器无法直接解析其路径 → 读取源码后用 data: URL 加载。
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, resolve } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url)) // frontend/src/utils
    const source = readFileSync(resolve(here, '../../../server/lib/weekspan.js'), 'utf8')
    const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
    return (await import(/* @vite-ignore */ url)) as unknown as ServerWeekspan
  }

  it('同一矩阵下两端 calcWeekNumber 结果完全一致', async () => {
    // 直接加载服务端实现（同一仓库，ESM）；任一端公式改动都会让本用例失败
    const serverWeek = await loadServerWeekspan()
    const cases: { startDate: string; endDate: string; weekStartDay: 1 | 7 }[] = [
      { startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 },
      { startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 7 },
      { startDate: '2026-09-02', endDate: '2026-12-27', weekStartDay: 1 },
      { startDate: '2026-09-02', endDate: '2026-12-27', weekStartDay: 7 },
      { startDate: '2026-09-06', endDate: '2027-01-10', weekStartDay: 7 },
    ]
    const probes = [
      '2026-08-01', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
      '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-13', '2026-09-14',
      '2026-12-27', '2026-12-28', '2027-01-15', '2027-01-16',
    ]
    for (const sem of cases) {
      for (const d of probes) {
        const date = parseDate(d)
        const mine = calcWeekNumber(date, sem)
        const theirs = serverWeek.weekNumberIn(sem.startDate, sem.endDate, sem.weekStartDay, date)
        expect(`起始${sem.startDate}/周起${sem.weekStartDay}/${d} → ${mine}`).toBe(
          `起始${sem.startDate}/周起${sem.weekStartDay}/${d} → ${theirs}`,
        )
      }
    }
  })

  it('学期总周数两端一致', async () => {
    const serverWeek = await loadServerWeekspan()
    const cases: { startDate: string; endDate: string; weekStartDay: 1 | 7 }[] = [
      { startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 },
      { startDate: '2026-09-02', endDate: '2026-12-27', weekStartDay: 7 },
    ]
    for (const sem of cases) {
      const end = parseDate(sem.endDate)
      const mine = calcWeekNumber(end, sem)
      const theirs = serverWeek.semesterWeekCount(sem.startDate, sem.endDate, sem.weekStartDay)
      expect(mine).toBe(theirs)
    }
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

