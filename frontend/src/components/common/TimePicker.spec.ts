// TimePicker 交互单测：渲染/打开面板/选择小时分钟/外部关闭
// 面板经 Teleport 渲染到 body，断言用 document 查询
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TimePicker from './TimePicker.vue'

function mountPicker(value = '08:00') {
  return mount(TimePicker, {
    props: { modelValue: value, size: 'sm', ariaLabel: '开始时间' },
    attachTo: document.body,
  })
}

function panel() {
  return document.querySelector<HTMLElement>('.tp-panel')
}

function panelOptions() {
  return Array.from(panel()?.querySelectorAll<HTMLButtonElement>('.tp-opt') ?? [])
}

describe('TimePicker', () => {
  it('渲染触发器并显示当前值', () => {
    const w = mountPicker('10:30')
    expect(w.get('.tp-trigger').text()).toContain('10:30')
    expect(w.get('.tp-trigger').attributes('aria-label')).toBe('开始时间')
    w.unmount()
  })

  it('空值显示占位文字', () => {
    const w = mountPicker('')
    expect(w.get('.tp-value').classes()).toContain('placeholder')
    w.unmount()
  })

  it('点击触发器展开面板，包含 24 小时与 12 个 5 分钟选项', async () => {
    const w = mountPicker('08:00')
    expect(panel()).toBeNull()
    await w.get('.tp-trigger').trigger('click')
    await w.vm.$nextTick()
    expect(panel()).not.toBeNull()
    expect(panelOptions().length).toBe(24 + 12)
    w.unmount()
  })

  it('选择小时与分钟分别触发 update:modelValue', async () => {
    const w = mountPicker('08:00')
    await w.get('.tp-trigger').trigger('click')
    await w.vm.$nextTick()
    // 选小时 14 → 14:00（模拟父组件 v-model 回写）
    const hour14 = panelOptions().find((b) => b.textContent === '14')!
    hour14.click()
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['14:00'])
    await w.setProps({ modelValue: '14:00' })
    await w.vm.$nextTick()
    // 选分钟 30 → 14:30
    const min30 = panelOptions().find((b) => b.textContent === '30')!
    min30.click()
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['14:30'])
    w.unmount()
  })

  it('点击外部关闭面板', async () => {
    const w = mountPicker('08:00')
    await w.get('.tp-trigger').trigger('click')
    await w.vm.$nextTick()
    expect(panel()).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(panel()).toBeNull()
    w.unmount()
  })
})
