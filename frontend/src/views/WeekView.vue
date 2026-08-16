<script setup lang="ts">
import { ref } from 'vue'
import WeekNav from '@/components/schedule/WeekNav.vue'
import WeekGrid from '@/components/schedule/WeekGrid.vue'
import SidePanel from '@/components/schedule/SidePanel.vue'
import CourseModal from '@/components/schedule/CourseModal.vue'
import type { Course } from '@/types'

const selected = ref<Course | null>(null)

function openCourse(course: Course): void {
  selected.value = course
}

function closeModal(): void {
  selected.value = null
}
</script>

<template>
  <div class="page week-view">
    <div class="week-layout">
      <!-- 主区：周导航与课表同宽对齐 -->
      <div class="week-main">
        <WeekNav class="reveal" />

        <section class="schedule-card reveal">
          <div class="scroll-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6-6 6 6 6" /><path d="m15 6 6 6-6 6" /></svg>
            <span>左右滑动查看本周全部课程 · 点击课程查看详情</span>
          </div>
          <div class="sched-scroll">
            <WeekGrid @open="openCourse" />
          </div>
        </section>
      </div>

      <!-- 信息面板（桌面右侧 / 平板下方三列） -->
      <SidePanel />
    </div>

    <CourseModal :course="selected" @close="closeModal" />
  </div>
</template>

<style scoped>
.page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 var(--spacing-lg) var(--spacing-xl);
}

.week-layout {
  display: block;
}

.week-main {
  min-width: 0;
}

.schedule-card {
  background: transparent;
}

.scroll-hint {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-bottom: none;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.scroll-hint svg {
  width: 14px;
  height: 14px;
}

.sched-scroll {
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.sched-scroll::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}

.sched-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-full);
}

.sched-scroll::-webkit-scrollbar-track {
  background: transparent;
}

@media (min-width: 1280px) {
  .week-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--side-panel-w);
    gap: var(--spacing-xl);
    align-items: start;
  }
}
</style>
