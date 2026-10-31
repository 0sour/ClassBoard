// SiteFooter：备案号 / 页脚文案 / 访问统计 / Powered by GitHub
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteFooter from './SiteFooter.vue'
import { api } from '@/api/client'

vi.mock('@/api/client', () => ({
  api: {
    getPublicSite: vi.fn(),
    getPublicStats: vi.fn(),
    recordVisit: vi.fn(),
  },
}))

const mocked = vi.mocked(api)

function site(over: Partial<Awaited<ReturnType<typeof api.getPublicSite>>> = {}) {
  return { footerText: '', icp: '', policeIcp: '', showVisits: false, ...over }
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('SiteFooter', () => {
  it('默认只显示版权与 Powered by，且链接到 GitHub', async () => {
    mocked.getPublicSite.mockResolvedValue(site())
    const w = mount(SiteFooter)
    await flushPromises()

    const text = w.text()
    expect(text).toContain('ClassBoard')
    expect(text).toContain('Powered by ClassBoard')
    const github = w.get('a[href="https://github.com/0sour/ClassBoard"]')
    expect(github.attributes('target')).toBe('_blank')
    expect(github.attributes('rel')).toContain('noopener')
    expect(w.find('.line--meta').exists()).toBe(false)
    expect(mocked.recordVisit).not.toHaveBeenCalled()
    w.unmount()
  })

  it('填写备案号与文案后显示，备案号链接到工信部', async () => {
    mocked.getPublicSite.mockResolvedValue(
      site({ footerText: '由示例班维护', icp: '示例ICP备00000000号-1' }),
    )
    const w = mount(SiteFooter)
    await flushPromises()

    expect(w.text()).toContain('由示例班维护')
    const icp = w.get('a[href="https://beian.miit.gov.cn/"]')
    expect(icp.text()).toBe('示例ICP备00000000号-1')
    expect(w.text()).not.toContain('今日访问')
    w.unmount()
  })

  it('开启统计后当天首次访问记一次并显示今日 / 累计', async () => {
    mocked.getPublicSite.mockResolvedValue(site({ showVisits: true }))
    mocked.recordVisit.mockResolvedValue({ today: 3, total: 128 })
    const w = mount(SiteFooter)
    await flushPromises()

    expect(mocked.recordVisit).toHaveBeenCalledTimes(1)
    expect(mocked.getPublicStats).not.toHaveBeenCalled()
    expect(w.text()).toContain('今日访问 3 次 · 累计 128 次')
    expect(window.localStorage.getItem('classboard.visit.day')).toBeTruthy()
    w.unmount()
  })

  it('同一天再次打开只读统计，不重复计数', async () => {
    window.localStorage.setItem('classboard.visit.day', new Date().toLocaleDateString('sv-SE'))
    mocked.getPublicSite.mockResolvedValue(site({ showVisits: true }))
    mocked.getPublicStats.mockResolvedValue({ today: 4, total: 129 })
    const w = mount(SiteFooter)
    await flushPromises()

    expect(mocked.recordVisit).not.toHaveBeenCalled()
    expect(mocked.getPublicStats).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('今日访问 4 次 · 累计 129 次')
    w.unmount()
  })
})
