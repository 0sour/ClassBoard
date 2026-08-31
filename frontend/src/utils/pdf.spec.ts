import { describe, expect, it } from 'vitest'
import fixture from '@/data/pdf-fixture.json'
import {
  clusterCells,
  detectGrid,
  parseCellText,
  parseWeeks,
  type ImportRow,
  type PdfPageData,
} from '@/utils/pdf'

const page1 = (fixture as unknown as PdfPageData[]).find((p) => p.page === 1)!

describe('PDF 解析：表格检测', () => {
  it('识别 7 列表头（星期一~星期日）与节次行', () => {
    const header = detectGrid(page1.spans)
    expect(header).not.toBeNull()
    expect(header!.colLefts.length).toBe(7)
    expect(header!.periodCenters.length).toBeGreaterThanOrEqual(8)
  })

  it('列左缘由表头 x 推导：星期一列左缘 ≈ 99', () => {
    const header = detectGrid(page1.spans)!
    expect(header.colLefts[0]).toBeCloseTo(99, 0)
  })

  it('非课表 PDF 返回 null', () => {
    const header = detectGrid([{ t: '随便', x: 10, y: 10, s: 12 }])
    expect(header).toBeNull()
  })
})

describe('PDF 解析：网格聚类', () => {
  const header = detectGrid(page1.spans)!
  const cells = clusterCells(page1.spans, header)

  it('聚类出全部非空单元格', () => {
    expect(cells.length).toBeGreaterThanOrEqual(11)
  })

  it('跨节次单元格归属正确行区间（马克思主义基本原理 3-4 节，星期一）', () => {
    const cell = cells.find((c) => c.weekday === 1 && c.text.includes('马克思主义基本原理'))
    expect(cell?.periods).toEqual([3, 4])
  })

  it('同列相邻单元格正确分离', () => {
    const mon = cells.filter((c) => c.weekday === 1)
    const periods = mon.map((c) => c.periods)
    expect(periods).toContainEqual([3, 4])
    expect(periods).toContainEqual([5, 6])
    expect(periods).toContainEqual([7, 8])
    // 星期三列：马克思主义基本原理 1-2 节（课程名行 y=89 位于表头下方，不被过滤）
    const wed = cells.filter((c) => c.weekday === 3)
    expect(wed.map((c) => c.periods)).toContainEqual([1, 2])
    expect(wed.map((c) => c.periods)).toContainEqual([3, 4])
  })

  it('聚类保留上课地点字段（场地:…），同行 span 按 x 拼接', () => {
    // fixture 中「场地:C5科教中心231」跨多个 span，若拼接顺序错乱会丢字段
    const withLoc = cells.filter((c) => /场地:/.test(c.text))
    expect(withLoc.length).toBeGreaterThan(0)
    const e = cells.find((c) => c.text.includes('C5科教中心231'))
    expect(e?.text).toContain('场地:')
    expect(e?.text).toContain('教师:')
  })

  it('同行 span 乱序时按 x 从左到右拼接', () => {
    const header = {
      colLefts: [100, 204, 308, 412, 516, 620, 724],
      periodCenters: [200],
      headerY: 50,
    }
    const spans = [
      { t: '地:C3敏学楼501/教师:曹英', x: 200, y: 120, s: 10 },
      { t: '场', x: 190, y: 120, s: 10 },
      { t: '课程▲', x: 104, y: 118, s: 12 },
    ]
    const out = clusterCells(spans, header)
    expect(out[0]?.text).toBe('课程▲场地:C3敏学楼501/教师:曹英')
  })
})

describe('PDF 解析：单元格字段解析', () => {
  it('基础字段：场地 / 教师 / 节次 / 周次', () => {
    const r = parseCellText(
      '模拟集成电路设计▲/(3-4节)1-16周/场地:C3敏学楼110/教师:骆晨/教学班:模拟集成电路设计-0001/教学班组成:24集成1;24集成2/考核方式:未安排/选课备注:/课程学时组成:讲课:48/周学时:3/总学时:48/学分:3',
      5,
      [3, 4],
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.name).toBe('模拟集成电路设计')
    expect(r.location).toBe('C3敏学楼110')
    expect(r.teacher).toBe('骆晨')
    expect(r.startPeriod).toBe(3)
    expect(r.endPeriod).toBe(4)
    expect(r.weekday).toBe(5)
    expect(r.type).toBe('course')
    expect(r.remark).toBe('讲课 48 学时 / 周学时 3 / 学分 3')
  })

  it('真实格式：课程名与节次段同段，场地紧跟其后（parts[1]）', () => {
    const r = parseCellText(
      '马克思主义基本原理▲(1-2节)1-15周(单)/场地:C5科教中心231/教师:焦鑫/课程学时组成:讲课:48,实践:16/周学时:4/总学时:64/学分:4',
      1,
      [1, 2],
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.name).toBe('马克思主义基本原理')
    expect(r.location).toBe('C5科教中心231')
    expect(r.teacher).toBe('焦鑫')
    expect(r.weekType).toBe('odd')
  })

  it('课程学时组成含实验 → 仍为 course，实验学时进备注', () => {
    const r = parseCellText(
      '微电子器件基础▲/(3-4节)1-10周,12周,15周/场地:C3敏学楼501/教师:曹英男/课程学时组成:讲课:24,实验:8/周学时:2/总学时:32/学分:2',
      3,
      [3, 4],
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.type).toBe('course')
    expect(r.weekType).toBe('custom')
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15])
    expect(r.remark).toBe('讲课 24 学时 + 实验 8 学时 / 周学时 2 / 学分 2')
  })

  it('名称含实验字样也视为 course', () => {
    const r = parseCellText('集成电路工艺实验/(5-6节)1-16周/场地:C1勤学楼205/教师:黄瑞/课程学时组成:讲课:48/周学时:3/总学时:48/学分:3', 5, [5, 6])
    if ('error' in r) throw new Error(r.error)
    expect(r.type).toBe('course')
  })

  it('课程名剥离类型符号 ▲', () => {
    const r = parseCellText('数字信号处理▲/(5-6节)1-16周/场地:C5科教中心217/教师:陈俊如/课程学时组成:讲课:40,实验:8/周学时:3/总学时:48/学分:3', 2, [5, 6])
    if ('error' in r) throw new Error(r.error)
    expect(r.name).toBe('数字信号处理')
  })

  it('课程名为空 → 错误', () => {
    const r = parseCellText('/场地:C3/教师:李', 1, [1, 2])
    expect('error' in r).toBe(true)
  })

  it('节次超出模板范围 → 错误', () => {
    const r = parseCellText('某某课程/(13-14节)1-16周/场地:C3/教师:李', 1, [1, 2])
    expect('error' in r).toBe(true)
    if ('error' in r) expect(r.error).toContain('1-12')
  })

  it('无节次段时使用单元格所在行区间', () => {
    const r = parseCellText('某某课程/场地:C3/教师:李', 1, [5, 6])
    if ('error' in r) throw new Error(r.error)
    expect(r.startPeriod).toBe(5)
    expect(r.endPeriod).toBe(6)
  })
})

describe('PDF 解析：周次规则展开', () => {
  it('1-16周 → all', () => {
    expect(parseWeeks('1-16周')).toEqual({ weekType: 'all', weekList: null })
  })
  it('1-15周(单) → odd', () => {
    expect(parseWeeks('1-15周(单)')).toEqual({ weekType: 'odd', weekList: null })
  })
  it('1-7周(单) → 仅 1-7 内单周（不含 9-15 周）', () => {
    const r = parseWeeks('1-7周(单)')
    expect(r.weekType).toBe('custom')
    expect(r.weekList).toEqual([1, 3, 5, 7])
  })
  it('1-8周(双) → 仅 1-8 内双周', () => {
    const r = parseWeeks('1-8周(双)')
    expect(r.weekType).toBe('custom')
    expect(r.weekList).toEqual([2, 4, 6, 8])
  })
  it('1-8周,10-16周(双) → 前段全周 + 后段双周（(双) 只修饰最后一段）', () => {
    const r = parseWeeks('1-8周,10-16周(双)')
    expect(r.weekType).toBe('custom')
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16])
  })
  it('1-10周,12周,15周 → custom', () => {
    const r = parseWeeks('1-10周,12周,15周')
    expect(r.weekType).toBe('custom')
    expect(r.weekList).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15])
  })
  it('6-13周 → custom 连续区间', () => {
    const r = parseWeeks('6-13周')
    expect(r.weekType).toBe('custom')
    expect(r.weekList).toEqual([6, 7, 8, 9, 10, 11, 12, 13])
  })
  it('空串 → all', () => {
    expect(parseWeeks('')).toEqual({ weekType: 'all', weekList: null })
  })
})

describe('PDF 解析：真实 fixture 全量', () => {
  const header = detectGrid(page1.spans)!
  const cells = clusterCells(page1.spans, header)
  const rows = cells
    .map((c) => parseCellText(c.text, c.weekday, c.periods))
    .filter((r): r is ImportRow => !('error' in r))

  it('解析出 11 门课程（与真实样本一致）', () => {
    expect(rows).toHaveLength(11)
  })

  it('课程名清单完整', () => {
    const names = [...new Set(rows.map((r) => r.name))].sort()
    expect(names).toEqual(
      [
        'Matlab工程应用',
        '人文地理学',
        '模拟集成电路设计',
        '微电子器件基础',
        '数字信号处理',
        '集成电路工艺',
        '工程项目管理与经济决策（创新创业）',
        '马克思主义基本原理',
      ].sort(),
    )
  })

  it('全部课程星期与节次有效', () => {
    for (const r of rows) {
      expect(r.weekday).toBeGreaterThanOrEqual(1)
      expect(r.weekday).toBeLessThanOrEqual(7)
      expect(r.startPeriod).toBeGreaterThanOrEqual(1)
      expect(r.endPeriod).toBeGreaterThanOrEqual(r.startPeriod)
    }
  })

  it('单双周规则样本正确（数字信号处理 1-7周(单) 星期四 → 仅 1-7 内单周）', () => {
    const r = rows.find((x) => x.name === '数字信号处理' && x.weekday === 4)
    expect(r?.weekType).toBe('custom')
    expect(r?.weekList).toEqual([1, 3, 5, 7])
    expect(r?.startPeriod).toBe(5)
    expect(r?.endPeriod).toBe(6)
  })

  it('含实验学时的课程识别为 course（微电子器件基础）', () => {
    const r = rows.find((x) => x.name === '微电子器件基础')
    expect(r?.type).toBe('course')
  })
})
