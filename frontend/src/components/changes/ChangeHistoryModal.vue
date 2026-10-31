<script setup lang="ts">
// ============================================================
// ClassBoard · 单对象的变更历史弹窗（课程详情 / 通知列表的「历史」入口）
//   里面就是同一份 ChangeTimeline，固定按实体 + 对象 id 筛选，只保留撤销。
// ============================================================
import ChangeTimeline from './ChangeTimeline.vue'

const props = defineProps<{
  open: boolean
  entity: string
  entityId: number | null
  title: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open && entityId !== null" class="modal-mask" @mousedown.self="emit('close')" @keydown="onKeydown">
        <div class="modal" role="dialog" aria-modal="true" :aria-label="`${title} 的变更历史`">
          <div class="modal-head">
            <h3 class="m-title">{{ title }} · 变更历史</h3>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div class="modal-body">
            <ChangeTimeline scope="class" :entity="props.entity" :entity-id="props.entityId ?? undefined" compact />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(2px);
}

.modal {
  width: min(560px, 100%);
  max-height: min(86vh, 700px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
}

.m-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  flex: none;
}

.modal-close:hover {
  background: var(--color-bg-hover);
}

.modal-close svg {
  width: 18px;
  height: 18px;
}

.modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-lg) var(--spacing-xl);
}
</style>
