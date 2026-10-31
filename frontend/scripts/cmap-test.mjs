// 临时调试：带 cmapReaderFactory 提取 PDF 文本，验证 cMap 是否是空文本根因
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const pdfPath = process.argv[2]
const buf = readFileSync(pdfPath)

const cmapsDir = path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps')
const cmapReaderFactory = {
  async fetch({ name }) {
    const file = path.join(cmapsDir, name + '.bcmap')
    if (!existsSync(file)) throw new Error('cmap not found: ' + name)
    return {
      cMapData: new Uint8Array(readFileSync(file)),
      compressionType: 1, // CMapCompressionType.BINARY
    }
  },
}

const doc = await getDocument({ data: new Uint8Array(buf), cmapReaderFactory }).promise
console.log('pages:', doc.numPages)
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  console.log(`page ${p}: textItems=${tc.items.length}`)
  const s = tc.items.map((it) => it.str).join('|')
  console.log('sample:', s.slice(0, 260))
}
