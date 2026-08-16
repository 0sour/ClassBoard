<script setup lang="ts">
import { ref } from 'vue'
import WeekNav from '@/components/schedule/WeekNav.vue'
import WeekGrid from '@/components/schedule/WeekGrid.vue'
import SidePanel from '@/components/schedule/SidePanel.vue'
import CourseModal from '@/components/schedule/CourseModal.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import { exportElementAsPng } from '@/utils/exportPng'
import { toast } from '@/utils/ui'
import type { Course } from '@/types'

const selected = ref<Course | null>(null)
const editing = ref<Course | null>(null)
const showEditor = ref(false)
const exporting = ref(false)

function openCourse(course: Course): void {
  selected.value = course
}

function closeModal(): void {
  selected.value = null
}

function editCourse(course: Course): void {
  selected.value = null
  editing.value = course
  showEditor.value = true
}

function printWeek(): void {
  window.print()
}

async function exportPng(): Promise<void> {
  const grid = document.querySelector('.week-grid')
  if (!grid || !(grid instanceof HTMLElement)) {
    toast('未找到课表网格', 'error')
    return
  }
  exporting.value = true
  try {
    const date = new Date().toISOString().slice(0, 10)
    await exportElementAsPng(grid, `classboard-week-${date}.png`)
    toast('课表已导出为 PNG', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败，请重试', 'error')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="page week-view">
    <div class="week-layout">
      <!-- 主区：周导航与课表同宽对齐 -->
      <div class="week-main">
        <WeekNav class="reveal" />

        <!-- 打印 / 导出 PNG（UI 设计文档 4.7） -->
        <div class="week-actions">
          <button class="act-btn" type="button" @click="printWeek">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect width="12" height="8" x="6" y="14" rx="1" /></svg>
            打印
          </button>
          <button class="act-btn" type="button" :disabled="exporting" @click="exportPng">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>
            {{ exporting ? '导出中…' : '导出 PNG' }}
          </button>
        </div>

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

    <CourseModal :course="selected" @close="closeModal" @edit="editCourse" />
    <CourseEditor
      :open="showEditor"
      :course="editing"
      @close="showEditor = false"
      @done="showEditor = false"
    />
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

/* 打印 / 导出操作条（文档 4.7：操作对象仅限课表网格） */
.week-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-sm);
}

.act-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.act-btn:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-hover);
}

.act-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.act-btn svg {
  width: 14px;
  height: 14px;
}

/* 打印：仅输出课表网格 + 周导航条（A4 横向），隐藏应用外壳 */
@media print {
  :global(.topbar),
  :global(.tabbar),
  :global(.side-panel),
  :global(.scroll-hint),
  .week-actions {
    display: none !important;
  }

  .page {
    max-width: none;
    padding: 0;
  }

  .week-main {
    width: 100%;
  }

  .sched-scroll {
    overflow: visible;
  }

  @page {
    size: A4 landscape;
    margin: 12mm;
  }
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
