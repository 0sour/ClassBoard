// ============================================================
// ClassBoard · PDF 课表解析
// 提取：mupdf（pdfjs 无法解码正方课表 PDF 的无 ToUnicode GBK 字体，
//       实测 getTextContent 返回空，故弃用 pdfjs-dist，见技术设计文档 3.3.3）
// 解析：基于真实样本《严子辰(2026-2027-1)课表.pdf》的表格重建规则
// ============================================================
import type { CourseType, WeekType, Weekday } from '@/types'

/** PDF 单行文本（mupdf stext 输出） */
export interface PdfSpan {
  t: string
  x: number
  y: number
  s: number
}

/** 单页数据 */
export interface PdfPageData {
  page: number
  width: number
  height: number
  spans: PdfSpan[]
}

/** 规范化后的导入行（与 Course 同构，缺 id/semesterId；color 由前端轮询分配后随行提交） */
export interface ImportRow {
  name: string
  type: CourseType
  teacher: string
  location: string
  weekType: WeekType
  weekList: number[] | null
  weekday: Weekday
  startPeriod: number
  endPeriod: number
  remark: string
  /** 颜色：前端按 8 色轮询规则分配（服务端缺省 course-1） */
  color?: string
}

/** 行级错误 */
export interface ImportError {
  weekday: number // 0 = 页级错误
  startPeriod: number
  name: string
  message: string
}

export interface PdfParseResult {
  rows: ImportRow[]
  errors: ImportError[]
  names: string[]
  pageCount: number
  source: string // 从标题提取的学期名，可为空
}

/** 表格结构（由第 1 页 spans 检测得到） */
interface GridHeader {
  /** 7 列左缘 x（由表头文本 x 推导：文本宽 36、列宽 104，居中 → 左缘 = headX - 34） */
  colLefts: number[]
  /** 10 行中心 y（节次数字基线 - 半字号） */
  periodCenters: number[]
  /** 表头行 y */
  headerY: number
}

/** 聚类后的单元格 */
interface Cell {
  text: string
  weekday: Weekday
  periods: [number, number]
  spans: PdfSpan[]
}

/** 单元格内文本行距约 12pt，单元格间距约 16pt；聚类阈值取 14 */
const CLUSTER_GAP = 14
/** 同一单元格内判定为同一行的 y 容差 */
const LINE_GAP = 2
/** 表头文本宽 36（3 全角 × 12pt），列宽 104 → 左缘偏移 34 */
const COL_LEFT_OFFSET = 34
/** 默认节次模板上限（技术文档 3.3.3：默认 1-12） */
const MAX_PERIOD = 12

// ============================================================
// 提取（依赖 mupdf，动态导入以便单测不加载 wasm）
// ============================================================

export async function extractPdfSpans(
  buffer: ArrayBuffer,
  onProgress?: (p: { page: number; total: number }) => void,
): Promise<PdfPageData[]> {
  const mupdf = await import('mupdf')
  const data = new Uint8Array(buffer)
  const doc = mupdf.PDFDocument.openDocument(data, 'application/pdf')
  const pages: PdfPageData[] = []
  const count = doc.countPages()
  for (let i = 0; i < count; i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds()
    const st = page.toStructuredText()
    const json = JSON.parse(st.asJSON()) as {
      blocks?: { type?: string; lines?: { text?: string; x?: number; y?: number; font?: { size?: number } }[] }[]
    }
    const spans: PdfSpan[] = []
    for (const block of json.blocks ?? []) {
      if (block.type !== 'text') continue
      for (const line of block.lines ?? []) {
        if (!line.text) continue
        spans.push({ t: line.text, x: line.x ?? 0, y: line.y ?? 0, s: line.font?.size ?? 8 })
      }
    }
    pages.push({ page: i + 1, width: bounds[2], height: bounds[3], spans })
    onProgress?.({ page: i + 1, total: count })
    // 让出主线程，避免多页解析阻塞渲染
    if (i < count - 1) await new Promise((r) => setTimeout(r, 0))
  }
  return pages
}

// ============================================================
// 表格检测
// ============================================================

/** 表头：7 个「星期X」在同一行 → colLefts；节次数字 → periodCenters */
export function detectGrid(spans: PdfSpan[]): GridHeader | null {
  const heads = spans.filter((s) => /^星期[一二三四五六日]$/.test(s.t.trim()))
  if (heads.length < 7) return null
  const headerY = Math.min(...heads.map((s) => s.y))
  const row = heads
    .filter((s) => Math.abs(s.y - headerY) < 2)
    .sort((a, b) => a.x - b.x)
  if (row.length < 7) return null
  const weekdayNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
  const map = new Map(row.map((s) => [s.t.trim(), s.x]))
  const colLefts = weekdayNames.map((n) => {
    const x = map.get(n)
    return x === undefined ? -1 : x - COL_LEFT_OFFSET
  })
  if (colLefts.some((x) => x < 0)) return null

  // 节次列：位于第一列左侧、数字文本（1-10）
  const leftBound = colLefts[0] - 40
  const periodYs = spans
    .filter(
      (s) =>
        s.y > headerY + 10 &&
        s.x >= leftBound &&
        s.x < colLefts[0] &&
        (/^[1-9]$/.test(s.t.trim()) || s.t.trim() === '10'),
    )
    .map((s) => s.y)
  const unique = [...new Set(periodYs)].sort((a, b) => a - b)
  if (unique.length < 8) return null
  return { colLefts, periodCenters: unique.map((y) => y - 6), headerY }
}

// ============================================================
// 单元格聚类
// ============================================================

export function clusterCells(spans: PdfSpan[], header: GridHeader): Cell[] {
  const { colLefts, periodCenters, headerY } = header
  const cells: Cell[] = []
  // 标题区在表头上方；表头行本身（星期X）单独排除
  const bodyTop = headerY

  // 7 列的 span 集合
  const colSpans: PdfSpan[][] = Array.from({ length: 7 }, () => [])
  for (const s of spans) {
    if (s.y < bodyTop) continue // 标题区
    if (/^星期[一二三四五六日]$/.test(s.t.trim())) continue // 表头
    if (s.x < colLefts[0]) continue // 时间段 / 节次列
    const col = colLefts.findIndex((left, i) => {
      const right = i < 6 ? colLefts[i + 1] : left + 104
      return s.x >= left && s.x < right
    })
    if (col < 0) continue
    colSpans[col].push(s)
  }

  for (let col = 0; col < 7; col++) {
    const list = colSpans[col].sort((a, b) => a.y - b.y)
    let block: PdfSpan[] = []
    let lastY = -1e9
    const flush = () => {
      if (!block.length) return
      const periods = periodsOfBlock(block, periodCenters)
      // 同一单元格：先按行分组（y 差 ≤ LINE_GAP），组内按 x 从左到右拼接，
      // 避免同行 span 顺序不稳定导致「场」「地:C3…」拼成「地:C3…场」而丢字段
      let text = ''
      let line: PdfSpan[] = []
      let lineY = -1e9
      const flushLine = () => {
        line.sort((a, b) => a.x - b.x)
        text += line.map((s) => s.t).join('')
        line = []
      }
      for (const s of block) {
        if (s.y - lineY > LINE_GAP) flushLine()
        line.push(s)
        lineY = s.y
      }
      flushLine()
      cells.push({ text, weekday: (col + 1) as Weekday, periods, spans: block })
      block = []
    }
    for (const s of list) {
      if (s.y - lastY > CLUSTER_GAP) flush()
      block.push(s)
      lastY = s.y
    }
    flush()
  }
  return cells
}

/** 块的行归属：优先取块覆盖的行区间；未命中时取最近行 */
function periodsOfBlock(block: PdfSpan[], centers: number[]): [number, number] {
  const top = block[0].y - block[0].s
  const bottom = block[block.length - 1].y
  const hit = centers
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c >= top - 1 && c <= bottom + 1)
  if (hit.length) return [hit[0].i + 1, hit[hit.length - 1].i + 1]
  let best = 0
  let bestD = Infinity
  centers.forEach((c, i) => {
    const d = Math.abs(c - top)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return [best + 1, best + 1]
}

// ============================================================
// 单元格字段解析
// ============================================================

/** 解析结果：成功返回 ImportRow；失败返回错误信息 */
export type CellParseResult = ImportRow | { name: string; error: string }

/** 单元格文本格式：课程名▲(开始-结束节)周次规则/场地:xx/教师:xx/…/课程学时组成:讲课:N,实验:M/周学时:N/总学时:N/学分:N */
export function parseCellText(text: string, weekday: Weekday, fallback: [number, number]): CellParseResult {
  const parts = text.split('/')

  // 课程名与节次段同处第一段（如「Matlab工程应用▲(7-8节)1-15周(单)」），需先剥离节次段
  let name = (parts[0] ?? '').replace(/\([\d\-]+节\)[\d,\-周单双()]*/g, '').trim()
  name = name.replace(/^[▲●■○△◆▪□]+|[▲●■○△◆▪□]+$/g, '').trim()
  if (!name) return { name: '', error: '课程名为空' }

  // 节次范围与周次规则从整段文本提取（不依赖 parts[1]）
  const periodMatch = /\((\d+)-(\d+)节\)/.exec(text) ?? /\((\d+)节\)/.exec(text)
  let startPeriod = fallback[0]
  let endPeriod = fallback[1]
  if (periodMatch) {
    startPeriod = Number(periodMatch[1])
    endPeriod = Number(periodMatch[2] ?? periodMatch[1])
  }

  // 周次规则：1-16周 / 1-15周(单) / 1-8周,10-16周(双) / 1-10周,12周,15周 / 6-13周
  const weekMatch = /\((?:\d+-\d+|\d+)节\)([\d,\-周单双()]+)/.exec(text)
  const weeks = parseWeeks(weekMatch ? weekMatch[1] : '')

  // 键值字段
  let location = ''
  let teacher = ''
  let hours = ''
  let weeklyHours = ''
  let credit = ''
  // 键值字段：真实文本「课程名▲(节次段)/场地:xx/教师:xx/…」中场地可能紧邻第一段，
  // 因此从 parts[1] 起扫描（节次段不以这些前缀开头，自然跳过）
  for (const p of parts.slice(1)) {
    if (p.startsWith('场地:')) location = p.slice(3)
    else if (p.startsWith('教师:')) teacher = p.slice(3)
    else if (p.startsWith('课程学时组成:')) hours = p.slice('课程学时组成:'.length)
    else if (p.startsWith('周学时:')) weeklyHours = p.slice(4)
    else if (p.startsWith('学分:')) credit = p.slice(3)
  }

  // PDF 课表中的课均视为理论课；「实验 X 学时」仅作备注说明，实验课由用户手动录入
  const type: CourseType = 'course'

  // 校验节次
  if (startPeriod < 1 || endPeriod < startPeriod || endPeriod > MAX_PERIOD) {
    return {
      name,
      error: `节次范围无效（第 ${startPeriod}-${endPeriod} 节，超出 1-${MAX_PERIOD}）`,
    }
  }

  return {
    name,
    type,
    teacher,
    location,
    weekType: weeks.weekType,
    weekList: weeks.weekList,
    weekday,
    startPeriod,
    endPeriod,
    remark: buildRemark(hours, weeklyHours, credit),
  }
}

/** 周次规则字符串 → weekType/weekList
 * 语义（正方教务系统）：(单)/(双) 只修饰最后一段；
 * 单段时若覆盖全学期奇偶（1-16 内全部单/双周）归约为 odd/even，
 * 否则展开为 custom（如 1-7周(单) → 1,3,5,7，不含 9-15 周）；
 * 多段时仅最后一段按奇偶过滤（如 1-8周,10-16周(双) → 1-8 全周 + 10,12,14,16）。 */
export function parseWeeks(spec: string): { weekType: WeekType; weekList: number[] | null } {
  const s = spec.trim()
  if (!s) return { weekType: 'all', weekList: null }
  const isOdd = s.endsWith('(单)')
  const isEven = s.endsWith('(双)')
  const clean = s.replace(/周/g, '').replace(/\(单\)/g, '').replace(/\(双\)/g, '')
  const segs = clean.split(',')

  // 展开：奇偶标记只作用于最后一段，其余段全部展开
  const list: number[] = []
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i].trim()
    const range = /^(\d+)-(\d+)$/.exec(seg)
    const parity = i === segs.length - 1 ? (isOdd ? 'odd' : isEven ? 'even' : null) : null
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      for (let w = a; w <= b; w++) {
        if (parity === 'odd' && w % 2 === 0) continue
        if (parity === 'even' && w % 2 === 1) continue
        list.push(w)
      }
    } else if (/^\d+$/.test(seg)) {
      list.push(Number(seg))
    }
  }
  const unique = [...new Set(list)].sort((a, b) => a - b)
  if (unique.length === 0) return { weekType: 'all', weekList: null }
  // 全学期（1-16 全周）→ all
  const full = unique.length === 16 && unique[0] === 1 && unique[15] === 16
  if (full) return { weekType: 'all', weekList: null }
  // 全学期奇偶（1-16 内全部单/双周）→ odd/even
  const ALL_ODD = [1, 3, 5, 7, 9, 11, 13, 15]
  const ALL_EVEN = [2, 4, 6, 8, 10, 12, 14, 16]
  if (unique.length === 8 && unique.every((w, i) => w === ALL_ODD[i])) return { weekType: 'odd', weekList: null }
  if (unique.length === 8 && unique.every((w, i) => w === ALL_EVEN[i])) return { weekType: 'even', weekList: null }
  return { weekType: 'custom', weekList: unique }
}

/** 学时组成「讲课:48」/「讲课:24,实验:8」→ 备注摘要 */
function buildRemark(hours: string, weeklyHours: string, credit: string): string {
  const segs: string[] = []
  if (hours) {
    const items = hours
      .split(',')
      .map((h) => {
        const m = /^(讲课|实验|上机|实践|习题|实习|线上|课外):(\d+)$/.exec(h.trim())
        return m ? `${m[1]} ${m[2]} 学时` : h.trim()
      })
      .join(' + ')
    segs.push(items)
  }
  if (weeklyHours) segs.push(`周学时 ${weeklyHours}`)
  if (credit) segs.push(`学分 ${credit}`)
  return segs.join(' / ')
}

/** 从第 1 页标题提取学期名（如「2026-2027学年第1学期」） */
function detectSemesterName(spans: PdfSpan[]): string {
  const minY = Math.min(...spans.map((s) => s.y))
  const line = spans
    .filter((s) => Math.abs(s.y - minY) < 8)
    .sort((a, b) => a.x - b.x)
    .map((s) => s.t.trim())
    .join('')
  const m = /([\d\-]+学年第[一二三四五六七八九十\d]+学期)/.exec(line)
  return m ? m[1] : ''
}

// ============================================================
// 组合入口
// ============================================================

export async function parsePdf(
  buffer: ArrayBuffer,
  onProgress?: (p: { page: number; total: number }) => void,
): Promise<PdfParseResult> {
  const pages = await extractPdfSpans(buffer, onProgress)
  const page1 = pages[0]
  const header = page1 ? detectGrid(page1.spans) : null
  if (!header) {
    return {
      rows: [],
      errors: [{ weekday: 0, startPeriod: 0, name: '', message: '未识别到课表表格，请确认是教务系统导出的课表 PDF' }],
      names: [],
      pageCount: pages.length,
      source: '',
    }
  }
  const cells = clusterCells(page1.spans, header)
  const rows: ImportRow[] = []
  const errors: ImportError[] = []
  const names = new Set<string>()
  for (const cell of cells) {
    const result = parseCellText(cell.text, cell.weekday, cell.periods)
    if ('error' in result) {
      errors.push({ weekday: cell.weekday, startPeriod: cell.periods[0], name: result.name, message: result.error })
    } else {
      rows.push(result)
      names.add(result.name)
    }
  }
  return { rows, errors, names: [...names], pageCount: pages.length, source: detectSemesterName(page1.spans) }
}
