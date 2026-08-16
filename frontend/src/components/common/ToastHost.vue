<script setup lang="ts">
// 全局 Toast 渲染（规范 4.2：页面顶部居中、四类语义色、3s 自动消失、fast 动效）
import { toastState } from '@/utils/ui'

const icons = {
  success:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>',
  info:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>',
} as const
</script>

<template>
  <Teleport to="body">
    <div class="toast-region" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="t in toastState.list"
          :key="t.id"
          class="toast"
          :class="`toast--${t.type}`"
          role="status"
        >
          <span class="toast__icon" v-html="icons[t.type]"></span>
          <span>{{ t.msg }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-region {
  position: fixed;
  left: 50%;
  top: calc(var(--topbar-h-mobile) + var(--spacing-md));
  transform: translateX(-50%);
  z-index: var(--z-index-modal);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  pointer-events: none;
}

@media (min-width: 768px) {
  .toast-region {
    top: calc(var(--topbar-h) + var(--spacing-md));
  }
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  max-width: min(88vw, 420px);
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-left: 4px solid var(--toast-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  font-size: var(--font-size-md);
  color: var(--color-text-body);
}

.toast__icon {
  flex: none;
  display: flex;
  color: var(--toast-color);
}

.toast__icon svg {
  width: 18px;
  height: 18px;
}

.toast--success { --toast-color: var(--color-feedback-success); }
.toast--warning { --toast-color: var(--color-feedback-warning); }
.toast--error { --toast-color: var(--color-feedback-error); }
.toast--info { --toast-color: var(--color-feedback-info); }

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
