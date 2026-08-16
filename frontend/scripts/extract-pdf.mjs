// 生成 fixture：用 mupdf 提取《严子辰(2026-2027-1)课表.pdf》文本 span（text/x/y/size）
import * as mupdf from 'mupdf'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pdfPath = resolve(here, '../../严子辰(2026-2027-1)课表.pdf')
const outPath = resolve(here, '../src/data/pdf-fixture.json')

const data = new Uint8Array(readFileSync(pdfPath))
const doc = mupdf.PDFDocument.openDocument(data, 'application/pdf')
const pages = []
for (let p = 0; p < doc.countPages(); p++) {
  const page = doc.loadPage(p)
  const bbox = page.getBounds()
  const text = page.toStructuredText()
  const json = JSON.parse(text.asJSON())
  const spans = []
  for (const block of json.blocks ?? []) {
    if (block.type !== 'text') continue
    for (const line of block.lines ?? []) {
      spans.push({ t: line.text, x: Math.round(line.x * 10) / 10, y: Math.round(line.y * 10) / 10, s: line.font?.size ?? 8 })
    }
  }
  pages.push({ page: p + 1, width: Math.round(bbox[2]), height: Math.round(bbox[3]), spans })
  console.log(`page ${p + 1}: ${spans.length} spans`)
}
writeFileSync(outPath, JSON.stringify(pages, null, 1))
console.log('fixture written')
