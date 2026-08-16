<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import TopBar from '@/components/layout/TopBar.vue'
import BottomTabBar from '@/components/layout/BottomTabBar.vue'
import ToastHost from '@/components/common/ToastHost.vue'
import ConfirmHost from '@/components/common/ConfirmHost.vue'
import AccessView from '@/views/AccessView.vue'
import { startReminderEngine } from '@/utils/reminder'

const store = useScheduleStore()

let stopReminder: (() => void) | null = null

onMounted(() => {
  stopReminder = startReminderEngine()
})

onBeforeUnmount(() => {
  stopReminder?.()
})
</script>

<template>
  <!-- 访问口令已开启且未登录：先过口令页（规范 3.7） -->
  <AccessView v-if="store.accessRequired" />

  <div v-else class="app">
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
</style>
