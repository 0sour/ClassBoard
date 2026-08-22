<script setup lang="ts">
// ============================================================
// ClassBoard · 城市搜索下拉（天气设置用，对齐 AppSelect 风格）
// 输入防抖搜索（/api/weather/cities 代理 QWeather 城市接口），
// 下拉列表显示城市名 + 省/市归属；外部点击关闭（文档级 mousedown）
// ============================================================
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    ariaLabel?: string
  }>(),
  { placeholder: '输入城市名搜索', ariaLabel: '城市搜索' },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

interface CityOption {
  name: string
  adm1: string
  adm2: string
  id: string
}

const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const open = ref(false)
const options = ref<CityOption[]>([])
const searching = ref(false)
const activeIndex = ref(-1)
const noResult = ref(false)

let debounceTimer: number | null = null
let searchSeq = 0

/** 输入变化：防抖 300ms 搜索 */
function onInput(): void {
  const v = inputRef.value?.value ?? ''
  // 不直接写 props.modelValue（父组件保持原值直到选中），仅本地输入
  emit('update:modelValue', v)
  open.value = true
  activeIndex.value = -1
  noResult.value = false
  if (debounceTimer !== null) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    void search(v)
  }, 300)
}

async function search(q: string): Promise<void> {
  const text = q.trim()
  if (!text) {
    options.value = []
    searching.value = false
    noResult.value = false
    return
  }
  searching.value = true
  const seq = ++searchSeq
  try {
    const list = await api.searchCities(text)
    if (seq !== searchSeq) return // 过期响应丢弃
    options.value = list
    noResult.value = list.length === 0
  } catch {
    if (seq !== searchSeq) return
    options.value = []
    noResult.value = true
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

function choose(opt: CityOption): void {
  emit('update:modelValue', opt.name)
  open.value = false
  activeIndex.value = -1
}

/** 键盘：↑↓ 移动、Enter 选中、Esc 关闭 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    open.value = false
    return
  }
  if (!open.value || options.value.length === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % options.value.length
    scrollActiveIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = activeIndex.value <= 0 ? options.value.length - 1 : activeIndex.value - 1
    scrollActiveIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const opt = options.value[activeIndex.value]
    if (opt) choose(opt)
  }
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    rootRef.value?.querySelector('.city-opt.is-active')?.scrollIntoView({ block: 'nearest' })
  })
}

/** 点击外部关闭 */
function onDocMousedown(e: MouseEvent): void {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

/** 外部值变化（回显/清空）时同步输入框 */
watch(
  () => props.modelValue,
  (v) => {
    const input = inputRef.value
    if (input && input.value !== v) input.value = v
  },
)

onMounted(() => document.addEventListener('mousedown', onDocMousedown))
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  if (debounceTimer !== null) window.clearTimeout(debounceTimer)
})

/** 城市归属展示：「省 · 市」或仅省 */
function admText(opt: CityOption): string {
  if (opt.adm1 === opt.adm2) return opt.adm1
  return `${opt.adm1} · ${opt.adm2}`
}
</script>

<template>
  <div ref="rootRef" class="city-select" :class="{ 'is-open': open }">
    <span class="city-select__wrap">
      <input
        ref="inputRef"
        class="city-select__input"
        type="text"
        :placeholder="placeholder"
        :aria-label="ariaLabel"
        :value="modelValue"
        autocomplete="off"
        @input="onInput"
        @focus="open = true"
        @keydown="onKeydown"
      />
      <svg v-if="searching" class="city-select__spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>
    </span>

    <Transition name="city">
      <div v-if="open" class="city-select__menu" role="listbox" :aria-label="ariaLabel">
        <button
          v-for="(opt, i) in options"
          :key="opt.id"
          class="city-opt"
          :class="{ 'is-active': i === activeIndex }"
          type="button"
          role="option"
          :aria-selected="i === activeIndex"
          @mousedown.prevent
          @click="choose(opt)"
        >
          <span class="city-opt__name">{{ opt.name }}</span>
          <span class="city-opt__adm">{{ admText(opt) }}</span>
        </button>
        <div v-if="noResult" class="city-empty">未找到匹配城市，试试「杭州」「信阳」等名称</div>
        <div v-else-if="!options.length" class="city-empty">
          {{ searching ? '搜索中…' : '输入城市名搜索，如「杭州」' }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.city-select {
  position: relative;
  display: inline-block;
}

.city-select__wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.city-select__input {
  height: 34px;
  min-width: 220px;
  padding: 0 var(--spacing-sm);
  padding-right: 30px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  font-size: var(--font-size-sm);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    outline-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.city-select__input:focus,
.city-select.is-open .city-select__input {
  outline: none;
  border-color: var(--color-border-focus);
}

.city-select__spin {
  position: absolute;
  right: 8px;
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
  animation: city-spin 0.8s linear infinite;
}

@keyframes city-spin {
  to { transform: rotate(360deg); }
}

/* 下拉面板（与 AppSelect 风格一致） */
.city-select__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 100%;
  max-width: 320px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xs);
  z-index: var(--z-index-float);
}

.city-opt {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.city-opt:hover,
.city-opt.is-active {
  background: var(--color-brand-subtle);
}

.city-opt__name {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
  flex: none;
}

.city-opt__adm {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.city-empty {
  padding: var(--spacing-lg) var(--spacing-md);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

/* 面板过渡 */
.city-enter-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.city-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.city-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.city-leave-to {
  opacity: 0;
}
</style>
