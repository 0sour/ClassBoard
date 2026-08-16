<script setup lang="ts">
import TopBar from '@/components/layout/TopBar.vue'
import BottomTabBar from '@/components/layout/BottomTabBar.vue'
</script>

<template>
  <div class="app">
    <TopBar />
    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <BottomTabBar />
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
