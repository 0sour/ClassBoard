<script setup lang="ts">
// ============================================================
// ClassBoard · 周选择器（WeekPicker）
// 点击触发器（父组件内容作为 slot）弹出周列表：
// 桌面端（≥768px）居中弹窗；移动端底部弹出栏。
// 列出学期内全部周：第 N 周 + 起止日期 + 单双周 + 今天标记。
// ============================================================
import { computed, onBeforeUnmount, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { calcWeekNumber, formatMonthDay, isOddWeek, parseDate } from '@/utils/week'

const props = withDefaults(defineProps<{ currentWeek?: number | null }>(), {
  currentWeek: null,
})

const emit = defineEmits<{ (e: 'select', week: number): void }>()

const store = useScheduleStore()
const open = ref(false)

/** 桌面端判定（≥768px 弹窗；<768px 底部栏） */
const isDesktop = ref(window.innerWidth >= 768)

function onResize(): void {
  isDesktop.value = window.innerWidth >= 768
}

window.addEventListener('resize', onResize)
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

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
      <Transition :name="isDesktop ? 'wp-pop' : 'wp-sheet'">
        <div v-if="open" class="wp-overlay" :class="{ 'is-desktop': isDesktop }" @click.self="close">
          <div class="wp-panel" role="dialog" aria-label="选择周">
            <!-- 头部：标题 + 学期名 + 关闭 -->
            <div class="wp-head">
              <div class="wp-head-main">
                <span class="wp-title">选择周</span>
                <span v-if="store.currentSemester" class="wp-sem">{{ store.currentSemester.name }}</span>
              </div>
              <button class="wp-close" type="button" aria-label="关闭" @click="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <!-- 周列表：桌面两列网格 / 移动单列 -->
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
                <span v-if="w.week === todayWeek" class="wp-tag">今天</span>
                <span class="wp-odd">{{ isOddWeek(w.week) ? '单周' : '双周' }}</span>
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

/* ============ 遮罩 ============ */
.wp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(31, 24, 40, 0.45);
  z-index: var(--z-index-modal);
  display: flex;
  justify-content: center;
}

/* 移动端：底部弹出 */
.wp-overlay {
  align-items: flex-end;
}

/* 桌面端：居中弹窗 */
.wp-overlay.is-desktop {
  align-items: center;
}

/* ============ 面板 ============ */
.wp-panel {
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

/* 移动端：全宽底部栏，顶部大圆角 */
.wp-panel {
  width: 100%;
  max-width: 480px;
  max-height: 72vh;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
}

/* 桌面端：居中圆角弹窗 */
.wp-overlay.is-desktop .wp-panel {
  width: min(500px, 92vw);
  max-height: 76vh;
  border-radius: var(--radius-lg);
}

/* ============ 头部 ============ */
.wp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--color-border-default);
}

.wp-head-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wp-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.wp-sem {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  flex: none;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.wp-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-body);
}

.wp-close svg {
  width: 16px;
  height: 16px;
}

/* ============ 周列表 ============ */
.wp-list {
  overflow-y: auto;
  padding: var(--spacing-md) var(--spacing-lg) var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

/* 桌面端：两列网格卡片 */
.wp-overlay.is-desktop .wp-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-sm);
}

.wp-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 10px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.wp-item:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-hover);
}

/* 当前选中周：品牌描边 + 浅底 */
.wp-item.current {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.wp-week {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  flex: none;
}

.wp-item.current .wp-week {
  color: var(--color-brand);
}

.wp-range {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 今天标记（品牌胶囊） */
.wp-tag {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  flex: none;
}

.wp-item.current .wp-tag {
  color: var(--color-white);
  background: var(--color-brand);
}

/* 单双周标签 */
.wp-odd {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  flex: none;
}

/* ============ 动画 ============ */
/* 移动端：底部上滑 */
.wp-sheet-enter-active,
.wp-sheet-leave-active {
  transition: transform var(--motion-duration-slow) var(--motion-easing-standard);
}

.wp-sheet-enter-from,
.wp-sheet-leave-to {
  transform: translateY(100%);
}

/* 桌面端：中心淡入缩放 */
.wp-pop-enter-active,
.wp-pop-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.wp-pop-enter-from,
.wp-pop-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>
