// ============================================================
// ClassBoard · scheduleStore 单测：跨天刷新（today 不再是永久缓存的 computed）
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useScheduleStore } from '@/stores/schedule'

describe('store.tickDate：挂机跨天后「今天」跟随日期', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('同日调用不改变 today', () => {
    vi.setSystemTime(new Date(2026, 8, 2, 10, 0, 0))
    const store = useScheduleStore()
    const first = store.today
    expect(store.tickDate()).toBe(false)
    expect(store.today.getTime()).toBe(first.getTime())
  })

  it('跨天调用更新 today 并返回 true', () => {
    vi.setSystemTime(new Date(2026, 8, 2, 23, 59, 0))
    const store = useScheduleStore()
    const before = store.today
    expect(before.getDate()).toBe(2)

    // 时间推进到次日凌晨
    vi.setSystemTime(new Date(2026, 8, 3, 0, 1, 0))
    expect(store.tickDate()).toBe(true)
    expect(store.today.getDate()).toBe(3)
    expect(store.today.getTime()).toBeGreaterThan(before.getTime())
  })

  it('跨天后 anchorMonday / weekDays 跟着推进', () => {
    // 2026-09-06 是周日，其所在周周一为 08-31
    vi.setSystemTime(new Date(2026, 8, 6, 12, 0, 0))
    const store = useScheduleStore()
    expect(store.anchorMonday.getDate()).toBe(31) // 8/31

    // 跨到下一周周一
    vi.setSystemTime(new Date(2026, 8, 7, 8, 0, 0))
    expect(store.tickDate()).toBe(true)
    expect(store.anchorMonday.getMonth()).toBe(8) // 9 月
    expect(store.anchorMonday.getDate()).toBe(7)
    expect(store.weekDays[0].getDate()).toBe(7)
  })
})
