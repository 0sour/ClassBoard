<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import TopBar from '@/components/layout/TopBar.vue'
import BottomTabBar from '@/components/layout/BottomTabBar.vue'
import ToastHost from '@/components/common/ToastHost.vue'
import ConfirmHost from '@/components/common/ConfirmHost.vue'
import AccessView from '@/views/AccessView.vue'
import { startReminderEngine } from '@/utils/reminder'

const store = useScheduleStore()

let stopReminder: (() => void) | null = null
let dateTimer: number | null = null
const retrying = ref(false)

onMounted(() => {
  stopReminder = startReminderEngine()
  // 跨天检查：挂机过夜后「今天」页/周号/铃铛需要跟着日期走
  dateTimer = window.setInterval(() => store.tickDate(), 60_000)
})

onBeforeUnmount(() => {
  stopReminder?.()
  if (dateTimer !== null) window.clearInterval(dateTimer)
})

/** 连接失败后重试：重新走一遍 bootstrap */
async function retryConnect(): Promise<void> {
  retrying.value = true
  try {
    await store.bootstrap()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <!-- 访问口令已开启且未登录：先过口令页（规范 3.7） -->
  <AccessView v-if="store.accessRequired" />

  <div v-else class="app">
    <!-- 后端不可达：明确提示并提供重试（不再静默显示空课表） -->
    <div v-if="store.connectError" class="offline-bar" role="alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 2v6" /><path d="M12 18h.01" /><circle cx="12" cy="12" r="10" />
      </svg>
      <span class="offline-text">
        无法连接服务器<template v-if="store.connectError"> · {{ store.connectError }}</template>
      </span>
      <button class="offline-retry" type="button" :disabled="retrying" @click="retryConnect">
        {{ retrying ? '重试中…' : '重试' }}
      </button>
    </div>

    <TopBar />
    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <BottomTabBar />
    <ToastHost />
    <ConfirmHost />
  </div>
</template>

<style scoped>
.app {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.app-main {
  flex: 1;
  padding-bottom: calc(64px + env(safe-area-inset-bottom));
}

@media (min-width: 768px) {
  .app-main {
    padding-bottom: 0;
  }
}

.page-enter-active,
.page-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard);
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}

/* 连接失败提示条：醒目但不遮挡内容 */
.offline-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-danger-bg, #fef2f2);
  color: var(--color-danger-text, #b91c1c);
  border-bottom: 1px solid var(--color-danger-line, #fecaca);
  font-size: var(--font-size-sm);
}

.offline-bar svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.offline-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-retry {
  flex-shrink: 0;
  padding: 3px 12px;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.offline-retry:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.6);
}

.offline-retry:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
