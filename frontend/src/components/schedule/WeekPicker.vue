<script setup lang="ts">
// ============================================================
// ClassBoard · 周选择弹层（WeekPicker）
// 点击触发器（父组件内容作为 slot）弹出底部 sheet，列出学期内全部周
// 带起止日期 / 单双周 / 本周标记；选中后 emit select 由父组件跳转
// ============================================================
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { calcWeekNumber, formatMonthDay, isOddWeek, parseDate } from '@/utils/week'

const props = withDefaults(defineProps<{ currentWeek?: number | null }>(), {
  currentWeek: null,
})

const emit = defineEmits<{ (e: 'select', week: number): void }>()

const store = useScheduleStore()
const open = ref(false)

/** 学期周列表（按周序 + 起止日期） */
const weeks = computed(() => {
  const sem = store.currentSemester
  if (!sem) return []
  const total = Math.min(calcWeekNumber(parseDate(sem.endDate), sem) ?? 16, 30)
  const start = parseDate(sem.startDate)
  return Array.from({ length: total }, (_, i) => {
    const monday = new Date(start)
    monday.setDate(start.getDate() + i * 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { week: i + 1, monday, sunday }
  })
})

/** 今天所在周（徽标「今天」） */
const todayWeek = computed(() => store.weekInfoOf(store.today).weekNumber)

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

function choose(w: number): void {
  open.value = false
  emit('select', w)
}

function range(w: { monday: Date; sunday: Date }): string {
  return `${formatMonthDay(w.monday)}–${formatMonthDay(w.sunday)}`
}
</script>

<template>
  <div
    class="wp-trigger"
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="toggle"
    @keydown.enter="toggle"
  >
    <slot />
    <Teleport to="body">
      <Transition name="wp">
        <div v-if="open" class="wp-overlay" @click.self="close">
          <div class="wp-sheet" role="dialog" aria-label="选择周">
            <div class="wp-head">
              <span>选择周</span>
              <button class="wp-close" type="button" aria-label="关闭" @click="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div class="wp-list">
              <button
                v-for="w in weeks"
                :key="w.week"
                class="wp-item"
                :class="{ current: w.week === currentWeek, today: w.week === todayWeek }"
                type="button"
                @click="choose(w.week)"
              >
                <span class="wp-week">第 {{ w.week }} 周</span>
                <span class="wp-range num">{{ range(w) }}</span>
                <span class="wp-odd">{{ isOddWeek(w.week) ? '单周' : '双周' }}</span>
                <span v-if="w.week === todayWeek" class="wp-tag">今天</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.wp-trigger {
  display: inline-flex;
  cursor: pointer;
}

.wp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(31, 24, 40, 0.42);
  z-index: var(--z-index-modal);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.wp-sheet {
  width: 100%;
  max-width: 460px;
  max-height: 64vh;
  overflow-y: auto;
  background: var(--color-bg-surface);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-md) var(--spacing-lg) var(--spacing-xl);
}

.wp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
}

.wp-head span {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.wp-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.wp-close:hover {
  background: var(--color-bg-hover);
}

.wp-close svg {
  width: 16px;
  height: 16px;
}

.wp-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.wp-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.wp-item:hover {
  background: var(--color-bg-hover);
}

.wp-item.current {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.wp-week {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  min-width: 64px;
}

.wp-item.current .wp-week {
  color: var(--color-brand);
}

.wp-range {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wp-odd {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  flex: none;
}

.wp-tag {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  flex: none;
}

.wp-enter-active,
.wp-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard);
}

.wp-enter-from,
.wp-leave-to {
  opacity: 0;
}
</style>
