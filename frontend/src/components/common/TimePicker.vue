<script setup lang="ts">
// ============================================================
// ClassBoard · TimePicker 时间选择（自研，对齐 UI 设计文档 4.10）
// 触发器 + 弹出双列（小时 / 分钟，5 分钟步进），风格与 AppSelect 一致。
// 弹出面板通过 Teleport 渲染到 body 并以 fixed 定位跟随触发器，
// 避免被页面内任意层叠上下文/裁剪容器遮挡（此前 z-index 方案在部分
// 布局下失效）；滚动/缩放窗口时面板跟随触发器移动。
// 全项目时间选择一律使用本组件，不使用原生 <input type="time">。
// ============================================================
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** 值：HH:mm */
  modelValue: string
  placeholder?: string
  /** sm=紧凑（32px，卡片内嵌） / md=标准（40px，表单） */
  size?: 'sm' | 'md'
  ariaLabel?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)

// 面板 fixed 定位（相对视口）
const panelX = ref(0)
const panelY = ref(0)

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

const hour = computed(() => props.modelValue?.slice(0, 2) || '08')
const minute = computed(() => props.modelValue?.slice(3, 5) || '00')

const display = computed(() => (props.modelValue ? props.modelValue : (props.placeholder ?? '请选择时间')))

const panelStyle = computed(() => ({
  position: 'fixed' as const,
  left: `${panelX.value}px`,
  top: `${panelY.value}px`,
  zIndex: 9999,
}))

/** 依据触发器位置计算面板坐标（底部 +6px；宽度溢出视口时回退对齐右缘） */
function updatePosition(): void {
  const r = trigger.value?.getBoundingClientRect()
  if (!r) return
  let x = r.left
  const panelW = 132
  if (x + panelW > window.innerWidth - 8) x = Math.max(8, window.innerWidth - panelW - 8)
  panelX.value = Math.round(x)
  panelY.value = Math.round(r.bottom + 6)
}

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    updatePosition()
    scrollSelectedIntoView()
  }
}

function pickHour(h: string): void {
  emit('update:modelValue', `${h}:${minute.value}`)
}

function pickMinute(m: string): void {
  emit('update:modelValue', `${hour.value}:${m}`)
}

function onDocMouseDown(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

/** 滚动/缩放时面板跟随触发器；同时用于外部点击关闭的兜底 */
function onViewportChange(): void {
  if (open.value) updatePosition()
}

/** 打开时把选中项滚动到列中央（仅滚动列容器，不影响页面） */
function scrollSelectedIntoView(): void {
  nextTick(() => {
    root.value?.querySelectorAll('.tp-col').forEach((col) => {
      const sel = col.querySelector('.tp-opt.sel')
      if (sel instanceof HTMLElement) {
        col.scrollTop = sel.offsetTop - col.clientHeight / 2 + sel.clientHeight / 2
      }
    })
  })
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

// 值变化时刷新面板选中态滚动位置（面板打开状态下）
watch(() => props.modelValue, () => {
  if (open.value) scrollSelectedIntoView()
})
</script>

<template>
  <div ref="root" class="tp" :class="[`tp--${size ?? 'sm'}`, { open }]">
    <button
      ref="trigger"
      class="tp-trigger"
      type="button"
      role="combobox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click="toggle"
    >
      <span class="tp-value" :class="{ placeholder: !modelValue }">{{ display }}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
  </div>

  <!-- 面板渲染到 body：fixed 定位跟随触发器，规避页面内层叠/裁剪遮挡 -->
  <Teleport to="body">
    <Transition name="tp-pop">
      <div
        v-if="open"
        class="tp-panel"
        :style="panelStyle"
        role="dialog"
        :aria-label="`选择时间 ${ariaLabel ?? ''}`"
      >
        <div class="tp-col" role="listbox" aria-label="小时">
          <button
            v-for="h in hours"
            :key="h"
            class="tp-opt"
            :class="{ sel: h === hour }"
            type="button"
            role="option"
            :aria-selected="h === hour"
            @click="pickHour(h)"
          >
            {{ h }}
          </button>
        </div>
        <span class="tp-sep" aria-hidden="true">:</span>
        <div class="tp-col" role="listbox" aria-label="分钟">
          <button
            v-for="m in minutes"
            :key="m"
            class="tp-opt"
            :class="{ sel: m === minute }"
            type="button"
            role="option"
            :aria-selected="m === minute"
            @click="pickMinute(m)"
          >
            {{ m }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tp {
  position: relative;
  display: inline-block;
}

.tp-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs);
  width: 92px;
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

.tp--sm .tp-trigger {
  height: 32px;
}

.tp--md .tp-trigger {
  height: 40px;
  width: 110px;
}

.tp-trigger:hover {
  border-color: var(--color-border-strong);
}

.tp.open .tp-trigger {
  border-color: var(--color-border-focus);
  outline: 2px solid var(--color-border-focus);
  outline-offset: 0;
}

.tp-trigger svg {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.tp.open .tp-trigger svg {
  transform: rotate(180deg);
}

.tp-value {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tp-value.placeholder {
  color: var(--color-text-tertiary);
}

/* 弹出面板：小时 / 分钟 双列滚动（位置由行内 fixed 样式控制） */
.tp-panel {
  display: flex;
  align-items: stretch;
  gap: 2px;
  width: 132px;
  padding: var(--spacing-xs);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
}

.tp-col {
  flex: 1;
  min-width: 0;
  height: 168px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.tp-opt {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font-family: inherit;
  font-size: var(--font-size-md);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-body);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.tp-opt:hover {
  background: var(--color-bg-subtle);
}

.tp-opt.sel {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.tp-sep {
  display: flex;
  align-items: center;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.tp-pop-enter-active,
.tp-pop-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.tp-pop-enter-from,
.tp-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
