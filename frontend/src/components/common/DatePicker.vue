<script setup lang="ts">
// ============================================================
// ClassBoard · DatePicker 日期选择（自研，对齐 UI 设计文档 4.11）
// 触发器 + 弹出日历面板（月份导航 + 星期表头 + 日期网格），
// 风格与 TimePicker 一致；面板经 Teleport 渲染到 body 并以 fixed
// 定位跟随触发器，避免被页面层叠/裁剪遮挡；滚动/缩放时跟随。
// 全项目日期选择一律使用本组件，不使用原生 <input type="date">。
// ============================================================
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** 值：YYYY-MM-DD */
  modelValue: string
  placeholder?: string
  /** sm=紧凑（32px） / md=标准（40px，表单） */
  size?: 'sm' | 'md'
  ariaLabel?: string
  /** 可选范围 */
  min?: string
  max?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
/** 面板（Teleport 到 body，需与 root 一并视为内部区域，避免点击面板内被误关） */
const panel = ref<HTMLElement | null>(null)

const panelX = ref(0)
const panelY = ref(0)

// 面板展示的年月
const viewYear = ref(2026)
const viewMonth = ref(0) // 0-11

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const display = computed(() => (props.modelValue ? props.modelValue : (props.placeholder ?? '请选择日期')))

/** 面板年月标题 */
const viewTitle = computed(() => `${viewYear.value}年${viewMonth.value + 1}月`)

/** 当月日期网格（null = 空位） */
const grid = computed<(number | null)[]>(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1)
  const startOffset = (first.getDay() + 6) % 7 // 周一为起始
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
})

/** 选中日期解析（用于高亮） */
const selected = computed(() => {
  const m = props.modelValue?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null
})

const today = new Date()
const isToday = (y: number, m: number, d: number): boolean =>
  y === today.getFullYear() && m === today.getMonth() && d === today.getDate()

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

/** 日期是否超出可选范围（min/max） */
function isMuted(y: number, m: number, d: number): boolean {
  const v = dateStr(y, m, d)
  if (props.min && v < props.min) return true
  if (props.max && v > props.max) return true
  return false
}

function panelStyle() {
  return {
    position: 'fixed' as const,
    left: `${panelX.value}px`,
    top: `${panelY.value}px`,
    zIndex: 9999,
  }
}

function updatePosition(): void {
  const r = trigger.value?.getBoundingClientRect()
  if (!r) return
  const panelW = 264
  let x = r.left
  if (x + panelW > window.innerWidth - 8) x = Math.max(8, window.innerWidth - panelW - 8)
  panelX.value = Math.round(x)
  panelY.value = Math.round(r.bottom + 6)
}

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    // 面板定位到选中日期所在月（无选中则今天所在月）
    const base = selected.value ?? { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() }
    viewYear.value = base.y
    viewMonth.value = base.m
    updatePosition()
  }
}

function prevMonth(): void {
  viewMonth.value -= 1
  if (viewMonth.value < 0) {
    viewMonth.value = 11
    viewYear.value -= 1
  }
}

function nextMonth(): void {
  viewMonth.value += 1
  if (viewMonth.value > 11) {
    viewMonth.value = 0
    viewYear.value += 1
  }
}

function pick(d: number): void {
  const value = dateStr(viewYear.value, viewMonth.value, d)
  if (props.min && value < props.min) return
  if (props.max && value > props.max) return
  emit('update:modelValue', value)
  open.value = false
}

function onDocMouseDown(e: MouseEvent): void {
  const t = e.target as Node
  if (root.value?.contains(t) || panel.value?.contains(t)) return
  open.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

function onViewportChange(): void {
  if (open.value) updatePosition()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})

// 外部值变化时同步面板月份（保持打开状态跟随）
watch(() => props.modelValue, () => {
  if (!open.value) return
  const s = selected.value
  if (s) {
    viewYear.value = s.y
    viewMonth.value = s.m
  }
})
</script>

<template>
  <div ref="root" class="dp" :class="[`dp--${size ?? 'sm'}`, { open }]">
    <button
      ref="trigger"
      class="dp-trigger"
      type="button"
      role="combobox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click="toggle"
    >
      <span class="dp-value" :class="{ placeholder: !modelValue }">{{ display }}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
    </button>
  </div>

  <!-- 日历面板渲染到 body：fixed 定位跟随触发器，规避层叠/裁剪遮挡 -->
  <Teleport to="body">
    <Transition name="dp-pop">
      <div v-if="open" ref="panel" class="dp-panel" :style="panelStyle()" role="dialog" :aria-label="`选择日期 ${ariaLabel ?? ''}`">
        <div class="dp-head">
          <button class="dp-nav" type="button" aria-label="上个月" @click="prevMonth">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span class="dp-title num">{{ viewTitle }}</span>
          <button class="dp-nav" type="button" aria-label="下个月" @click="nextMonth">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>

        <div class="dp-week" aria-hidden="true">
          <span v-for="w in WEEKDAY_LABELS" :key="w" class="dp-week-cell">{{ w }}</span>
        </div>

        <div class="dp-grid" role="grid" :aria-label="viewTitle">
          <template v-for="(d, i) in grid" :key="i">
            <button
              v-if="d !== null"
              class="dp-day"
              :class="{
                today: isToday(viewYear, viewMonth, d),
                selected: selected !== null && selected.y === viewYear && selected.m === viewMonth && selected.d === d,
                muted: isMuted(viewYear, viewMonth, d),
              }"
              type="button"
              role="gridcell"
              :aria-selected="selected !== null && selected.y === viewYear && selected.m === viewMonth && selected.d === d ? 'true' : 'false'"
              @click="pick(d)"
            >
              {{ d }}
            </button>
            <span v-else class="dp-day dp-day--blank" aria-hidden="true"></span>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dp {
  position: relative;
  display: inline-block;
}

.dp-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs);
  width: 128px;
  padding: 0 var(--spacing-sm);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--font-size-md);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  text-align: left;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    outline-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.dp--sm .dp-trigger {
  height: 32px;
}

.dp--md .dp-trigger {
  height: 40px;
  width: 150px;
}

.dp-trigger:hover {
  border-color: var(--color-border-strong);
}

.dp.open .dp-trigger {
  border-color: var(--color-border-focus);
  outline: 2px solid var(--color-border-focus);
  outline-offset: 0;
}

.dp-trigger svg {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
}

.dp-value {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dp-value.placeholder {
  color: var(--color-text-tertiary);
}

/* 日历面板 */
.dp-panel {
  width: 264px;
  padding: var(--spacing-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
}

.dp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-sm);
}

.dp-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.dp-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.dp-nav:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text-body);
}

.dp-nav svg {
  width: 15px;
  height: 15px;
}

.dp-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: var(--spacing-xs);
}

.dp-week-cell {
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.dp-day {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font-family: inherit;
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-body);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.dp-day:hover {
  background: var(--color-bg-subtle);
}

.dp-day.today {
  color: var(--color-brand);
  font-weight: var(--font-weight-bold);
}

.dp-day.selected {
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-weight: var(--font-weight-medium);
}

.dp-day.selected:hover {
  background: var(--color-brand-hover);
}

.dp-day.muted {
  color: var(--color-text-tertiary);
  opacity: 0.45;
  cursor: not-allowed;
}

.dp-day--blank {
  pointer-events: none;
}

.dp-pop-enter-active,
.dp-pop-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.dp-pop-enter-from,
.dp-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
