// ============================================================
// ClassBoard · 周课表导出 PNG（UI 设计文档 4.7）
// 将课表网格 DOM 序列化为 SVG（foreignObject）→ canvas → PNG 下载
// Firefox 兼容：foreignObject 对链接样式表解析不可靠，
// 导出前把每个元素的计算样式内联到 style 属性，保证离线渲染一致。
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

function serializeNode(node: Node): string {
  return new XMLSerializer().serializeToString(node)
}

/** 深拷贝并将全部计算样式内联（取 DOM 树所有元素的 getComputedStyle） */
function cloneWithInlineStyles(root: HTMLElement): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement
  const elements: Element[] = [clone]
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  while (node) {
    elements.push(node as Element)
    node = walker.nextNode()
  }
  for (const el of elements) {
    const computed = window.getComputedStyle(el)
    let inline = ''
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i]
      inline += `${prop}:${computed.getPropertyValue(prop)};`
    }
    el.setAttribute('style', inline)
  }
  return clone
}

/** 将容器 DOM 渲染为 PNG 并触发下载 */
export async function exportElementAsPng(root: HTMLElement, filename: string): Promise<void> {
  const rect = root.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)

  // 克隆节点并内联计算样式（滚动容器影响、链接样式表不可靠问题一并处理）
  const clone = cloneWithInlineStyles(root)
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.overflow = 'visible'
  clone.style.transform = 'none'

  const foreign = document.createElementNS(XHTML_NS, 'div')
  foreign.setAttribute('xmlns', XHTML_NS)
  foreign.innerHTML = clone.outerHTML

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
