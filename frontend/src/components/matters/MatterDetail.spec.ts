// MatterDetail：作业 / 考试详情弹窗
//   图片内联显示（点开放大）、文件走下载链接；负责人可上传 / 删除，公开只读面两样都没有
//   弹窗经 Teleport 渲染到 body，断言用 document 查询（点击用原生 DOM 事件 + nextTick）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MatterDetail from './MatterDetail.vue'
import { useScheduleStore } from '@/stores/schedule'
import { attachmentUrl } from '@/api/client'
import type { Attachment, Exam, Homework } from '@/types'

function att(over: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    examId: null,
    homeworkId: 1,
    name: 'a.png',
    mime: 'image/png',
    size: 2048,
    sha256: 'x'.repeat(64),
    kind: 'image',
    createdAt: '2026-10-14T10:00:00.000Z',
    ...over,
  }
}

function hw(attachments: Attachment[]): Homework {
  return { id: 1, semesterId: 1, courseId: null, name: '第三章习题', dueAt: '2026-10-20T22:00', remark: '', attachments }
}

let store: ReturnType<typeof useScheduleStore>
let wrappers: VueWrapper[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  store = useScheduleStore()
})

afterEach(() => {
  for (const w of wrappers) w.unmount()
  wrappers = []
  document.body.innerHTML = ''
})

function mountIt(kind: 'exam' | 'homework', matter: Homework | Exam): VueWrapper {
  const w = mount(MatterDetail, { props: { open: true, kind, matter }, attachTo: document.body })
  wrappers.push(w)
  return w
}

describe('MatterDetail', () => {
  it('图片内联显示（公开地址），点开放大预览', async () => {
    const m = hw([att()])
    store.homework.push(m)
    const w = mountIt('homework', m)

    const img = document.querySelector<HTMLImageElement>('.img-btn img')
    expect(img?.getAttribute('src')).toBe(attachmentUrl(1))
    expect(document.querySelector('.lightbox')).toBeNull()

    document.querySelector<HTMLElement>('.img-btn')?.click()
    await w.vm.$nextTick()
    const box = document.querySelector<HTMLImageElement>('.lightbox img')
    expect(box?.getAttribute('src')).toBe(attachmentUrl(1))
  })

  it('非图片走下载链接：带 download 属性与文件名、大小文案', () => {
    const m = hw([
      att({ id: 7, name: '考试范围.pdf', kind: 'file', mime: 'application/pdf', size: 3 * 1024 * 1024 + 512 * 1024 }),
    ])
    store.homework.push(m)
    mountIt('homework', m)

    const link = document.querySelector<HTMLAnchorElement>('.file-main')
    expect(link?.getAttribute('href')).toBe(attachmentUrl(7))
    expect(link?.getAttribute('download')).toBe('考试范围.pdf')
    expect(document.querySelector('.file-size')?.textContent).toBe('3.5 MB')
    expect(document.querySelector('.img-btn')).toBeNull()
  })

  it('没有附件时给出提示；只读面（公开页）不出现上传与删除', () => {
    const m = hw([])
    store.homework.push(m)
    store.readonly = true
    mountIt('homework', m)

    expect(document.querySelector('.empty')?.textContent).toContain('暂无图片或附件')
    expect(document.querySelector('.drop')).toBeNull()
    expect(document.querySelector('.img-del')).toBeNull()
    expect(document.querySelector('.file-del')).toBeNull()
  })

  it('负责人可看到上传区与删除按钮', () => {
    const m = hw([att()])
    store.homework.push(m)
    mountIt('homework', m)

    expect(document.querySelector('.drop')).not.toBeNull()
    expect(document.querySelector('.img-del')).not.toBeNull()
    expect(document.querySelector('.drop-input')?.getAttribute('multiple')).not.toBeNull()
  })
})
