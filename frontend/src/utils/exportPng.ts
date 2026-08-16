// ============================================================
// ClassBoard · 周课表导出 PNG（UI 设计文档 4.7）
// 将课表网格 DOM 序列化为 SVG（foreignObject）→ canvas → PNG 下载
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

function serializeNode(node: Node): string {
  return new XMLSerializer().serializeToString(node)
}

/** 将容器 DOM 渲染为 PNG 并触发下载 */
export async function exportElementAsPng(root: HTMLElement, filename: string): Promise<void> {
  const rect = root.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)

  // 克隆节点以移除滚动容器影响，保留样式
  const clone = root.cloneNode(true) as HTMLElement
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.overflow = 'visible'
  clone.style.transform = 'none'

  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((el) => serializeNode(el))
    .join('')

  const foreign = document.createElementNS(XHTML_NS, 'div')
  foreign.setAttribute('xmlns', XHTML_NS)
  foreign.innerHTML = `<style>${styles}</style>${clone.outerHTML}`

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', `${width}`)
  svg.setAttribute('height', `${height}`)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.appendChild(foreign)

  const blob = new Blob(
    [`<?xml version="1.0" encoding="UTF-8"?>${serializeNode(svg)}`],
    { type: 'image/svg+xml;charset=utf-8' },
  )
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片渲染失败'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.scale(2, 2)
  ctx.drawImage(img, 0, 0, width, height)

  URL.revokeObjectURL(url)

  const pngUrl = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = pngUrl
  a.download = filename
  a.click()
}
