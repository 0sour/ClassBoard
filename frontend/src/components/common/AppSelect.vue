<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface AppSelectOption {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null
    options: AppSelectOption[]
    ariaLabel?: string
    placeholder?: string
    /** sm=紧凑（顶栏 32px），md=标准（表单 40px），对齐《05-UI组件参考》 */
    size?: 'sm' | 'md'
  }>(),
  { ariaLabel: '下拉选择', placeholder: '请选择', size: 'sm' },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string | number | null): void }>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const selected = computed(() => props.options.find((o) => o.value === props.modelValue))

function choose(value: string | number): void {
  emit('update:modelValue', value)
  open.value = false
}

/** 点击组件外部区域关闭下拉（mousedown 早于 click，避免与选项/触发器点击冲突） */
function onDocMousedown(e: MouseEvent): void {
  if (!open.value) return
  const root = rootRef.value
  if (root && !root.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onDocMousedown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMousedown))
</script>

<template>
  <div ref="rootRef" class="select" :class="{ 'is-open': open, 'select--md': size === 'md' }">
    <button
      class="select__trigger"
      type="button"
      role="combobox"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="select__value">{{ selected?.label ?? placeholder }}</span>
      <svg class="icon select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>

    <Transition name="sel">
      <div v-if="open" class="select__menu" role="listbox" :aria-label="ariaLabel">
        <button
          v-for="opt in options"
          :key="opt.value"
          class="select-option"
          :class="{ 'is-selected': opt.value === modelValue }"
          type="button"
          role="option"
          :aria-selected="opt.value === modelValue"
          @click="choose(opt.value)"
        >
          {{ opt.label }}
          <svg class="icon select-option__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.select {
  position: relative;
  display: inline-flex;
}

.select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  width: 100%;
  height: 32px;
  padding: 0 var(--spacing-md);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    outline-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.select--md .select__trigger {
  height: 40px;
}

.select__trigger:hover {
  border-color: var(--color-border-strong);
}

.select.is-open .select__trigger {
  border-color: var(--color-border-focus);
  outline: 2px solid var(--color-border-focus);
  outline-offset: 0;
}

.select__value {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.select__arrow {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.select.is-open .select__arrow {
  transform: rotate(180deg);
}

.select__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 100%;
  max-width: 280px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xs);
  z-index: var(--z-index-float);
}

.sel-enter-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.sel-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.sel-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.sel-leave-to {
  opacity: 0;
}

.select-option {
  display: flex;
  align-items: center;
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
  white-space: nowrap;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.select-option:hover {
  background: var(--color-bg-subtle);
}

.select-option.is-selected {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.select-option__check {
  display: none;
  margin-left: auto;
  width: 14px;
  height: 14px;
  color: var(--color-brand);
}

.select-option.is-selected .select-option__check {
  display: inline-block;
}
</style>
