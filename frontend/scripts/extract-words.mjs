// 临时：用 MuPDF 提取课表 PDF 第 1 页 words（统一格式），生成测试 fixture
import * as mupdf from 'mupdf'
import { readFileSync, writeFileSync } from 'node:fs'

const pdfPath = process.argv[2]
const outPath = process.argv[3]
const buf = readFileSync(pdfPath)
const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'pdf')
const page = doc.loadPage(0)
const stext = page.toStructuredText('preserve-words')
const blocks = JSON.parse(stext.asJSON())

const words = []
for (const b of blocks.blocks) {
  if (b.type !== 'text') continue
  for (const l of b.lines || []) {
    for (const s of l.spans || []) {
      words.push({
        x: Math.round(s.bbox.x * 10) / 10,
        y: Math.round(s.bbox.y * 10) / 10,
        w: Math.round(s.bbox.w * 10) / 10,
        text: s.text,
      })
    }
  }
}
words.sort((a, b) => a.y - b.y || a.x - b.x)
writeFileSync(outPath, JSON.stringify(words, null, 1))
console.log(`words: ${words.length} -> ${outPath}`)
