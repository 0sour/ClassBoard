// DatePicker 交互单测：渲染/打开面板/月导航/选择日期/外部关闭
// 面板经 Teleport 渲染到 body，断言用 document 查询
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DatePicker from './DatePicker.vue'

function mountPicker(value = '2026-09-07') {
  return mount(DatePicker, {
    props: { modelValue: value, size: 'sm', ariaLabel: '开始日期' },
    attachTo: document.body,
  })
}

function panel() {
  return document.querySelector<HTMLElement>('.dp-panel')
}

function dayCells() {
  return Array.from(panel()?.querySelectorAll<HTMLButtonElement>('.dp-day') ?? [])
}

describe('DatePicker', () => {
  it('渲染触发器并显示当前值', () => {
    const w = mountPicker('2026-09-07')
    expect(w.get('.dp-trigger').text()).toContain('2026-09-07')
    expect(w.get('.dp-trigger').attributes('aria-label')).toBe('开始日期')
    w.unmount()
  })

  it('空值显示占位文字', () => {
    const w = mountPicker('')
    expect(w.get('.dp-value').classes()).toContain('placeholder')
    w.unmount()
  })

  it('点击触发器展开面板，标题为选中日期所在月，选中日高亮', async () => {
    const w = mountPicker('2026-09-07')
    expect(panel()).toBeNull()
    await w.get('.dp-trigger').trigger('click')
    await w.vm.$nextTick()
    expect(panel()).not.toBeNull()
    expect(panel()!.querySelector('.dp-title')!.textContent).toBe('2026年9月')
    const sel = dayCells().find((b) => b.classList.contains('selected'))
    expect(sel?.textContent).toBe('7')
    w.unmount()
  })

  it('月份导航切换标题', async () => {
    const w = mountPicker('2026-09-07')
    await w.get('.dp-trigger').trigger('click')
    await w.vm.$nextTick()
    const prev = panel()!.querySelector<HTMLButtonElement>('[aria-label="上个月"]')!
    prev.click()
    await w.vm.$nextTick()
    expect(panel()!.querySelector('.dp-title')!.textContent).toBe('2026年8月')
    w.unmount()
  })

  it('选择日期触发 update:modelValue 并关闭面板', async () => {
    const w = mountPicker('2026-09-07')
    await w.get('.dp-trigger').trigger('click')
    await w.vm.$nextTick()
    const d15 = dayCells().find((b) => b.textContent === '15')!
    d15.click()
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['2026-09-15'])
    await w.vm.$nextTick()
    expect(panel()).toBeNull()
    w.unmount()
  })

  it('点击外部关闭面板', async () => {
    const w = mountPicker('2026-09-07')
    await w.get('.dp-trigger').trigger('click')
    await w.vm.$nextTick()
    expect(panel()).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(panel()).toBeNull()
    w.unmount()
  })
})
