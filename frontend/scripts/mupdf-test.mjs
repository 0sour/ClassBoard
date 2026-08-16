// 临时调试：用 MuPDF 提取课表 PDF 文本，验证 CJK 支持
import * as mupdf from 'mupdf'
import { readFileSync } from 'node:fs'

const pdfPath = process.argv[2]
const buf = readFileSync(pdfPath)
const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'pdf')
console.log('pages:', doc.countPages())
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i)
  const stext = page.toStructuredText('preserve-ligatures')
  const blocks = JSON.parse(stext.asJSON())
  console.log(`--- page ${i + 1}: blocks=${blocks.blocks.length}`)
  console.log('sample block JSON:', JSON.stringify(blocks.blocks[0]).slice(0, 400))
  for (const b of blocks.blocks.slice(1, 6)) {
    const lines = b.lines || []
    for (const l of lines.slice(0, 2)) {
      console.log(' ', (l.spans || []).map((s) => s.text).join(''))
    }
  }
}
