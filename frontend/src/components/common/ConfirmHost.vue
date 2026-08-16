<script setup lang="ts">
// 全局确认对话框（规范 4.3：危险操作二次确认，确认按钮 danger 色）
import { confirmState, settleConfirm } from '@/utils/ui'

function onMaskClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) settleConfirm(false)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') settleConfirm(false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="confirmState.open"
        class="confirm-mask"
        role="presentation"
        @mousedown="onMaskClick"
        @keydown="onKeydown"
      >
        <div class="confirm" role="alertdialog" aria-modal="true" :aria-label="confirmState.options.title">
          <h3 class="confirm-title">{{ confirmState.options.title }}</h3>
          <p v-if="confirmState.options.desc" class="confirm-desc">{{ confirmState.options.desc }}</p>
          <div class="confirm-foot">
            <button class="btn btn--ghost" type="button" @click="settleConfirm(false)">取消</button>
            <button
              class="btn"
              :class="confirmState.options.danger ? 'btn--danger' : 'btn--primary'"
              type="button"
              @click="settleConfirm(true)"
            >
              {{ confirmState.options.confirmText ?? '确认' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(4px);
}

.confirm {
  width: min(400px, 100%);
  background: var(--color-bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xl);
}

.confirm-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.confirm-desc {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-normal);
  color: var(--color-text-secondary);
}

.confirm-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xl);
}

.btn {
  height: 38px;
  padding: 0 var(--spacing-lg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn--primary {
  background: var(--color-brand);
  color: var(--color-text-inverse);
}

.btn--primary:hover {
  background: var(--color-brand-hover);
}

.btn--danger {
  background: var(--color-feedback-error);
  color: var(--color-text-inverse);
}

.btn--danger:hover {
  filter: brightness(0.94);
}

.btn--ghost {
  border: 1px solid var(--color-border-default);
  color: var(--color-text-body);
}

.btn--ghost:hover {
  background: var(--color-bg-hover);
}

/* 桌面 pop 动画 */
.modal-enter-active {
  animation: pop var(--motion-duration-slow) var(--motion-easing-standard) both;
}

.modal-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.modal-leave-to {
  opacity: 0;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 767px) {
  .confirm-mask {
    align-items: flex-end;
    padding: 0;
  }

  .confirm {
    width: 100%;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding-bottom: calc(var(--spacing-xl) + env(safe-area-inset-bottom));
  }

  .modal-enter-active {
    animation: sheetUp var(--motion-duration-normal) var(--motion-easing-standard) both;
  }

  @keyframes sheetUp {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
}
</style>
