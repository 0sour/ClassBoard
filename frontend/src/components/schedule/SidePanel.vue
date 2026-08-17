<script setup lang="ts">
import { computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { MOCK_PRACTICE } from '@/data/mock'

const store = useScheduleStore()

const todayCourseCount = computed(() => {
  const wd = ((store.today.getDay() + 6) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return store.coursesByWeekday[wd].length
})

const courseCount = computed(() => store.visibleCourses.length)
const labCount = computed(() => store.visibleCourses.filter((c) => c.type === 'lab').length)

/** 待交作业：当前学期未完成（真实接口 /api/homework） */
const pendingHomework = computed(() => store.homework.filter((h) => !h.done))
</script>

<template>
  <aside class="side-panel">
    <!-- 本周摘要 -->
    <div class="sp-card reveal">
      <div class="sp-head">
        <span class="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
        </span>
        <h3>本周摘要</h3>
      </div>
      <div class="summary-nums">
        <div class="num-item"><b class="num">{{ courseCount }}</b><span>门课程</span></div>
        <div class="num-item"><b class="num">{{ labCount }}</b><span>实验课</span></div>
        <div class="num-item"><b class="num">{{ todayCourseCount }}</b><span>今日课程</span></div>
      </div>
    </div>

    <!-- 作业 -->
    <div class="sp-card hw reveal" v-if="pendingHomework.length">
      <div class="sp-head">
        <span class="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8M16 13H8M16 17H8" /></svg>
        </span>
        <h3>待交作业</h3>
      </div>
      <div v-for="h in pendingHomework" :key="h.id" class="sp-item">
        <div class="date-chip">{{ h.dueAt.slice(5, 10).replace('-', '月') }}日截止</div>
        <div class="sp-item-title">{{ h.name }}</div>
        <div class="sp-item-meta">未完成</div>
      </div>
    </div>

    <!-- 实践与其他课程（PDF 第 2 页汇总行） -->
    <div class="sp-card reveal">
      <div class="sp-head">
        <span class="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
        </span>
        <h3>实践与其他</h3>
      </div>
      <div v-for="p in MOCK_PRACTICE" :key="p.name" class="sp-item">
        <div class="sp-item-title">{{ p.name }}</div>
        <div class="sp-item-meta">{{ p.teacher }} · {{ p.weeks }}</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.sp-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: var(--spacing-lg);
}

.sp-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.ic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
}

.ic svg {
  width: 15px;
  height: 15px;
}

.sp-head h3 {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.8px;
}

.summary-nums {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.num-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.num-item b {
  font-size: var(--font-size-stat);
  font-weight: var(--font-weight-heavy);
  color: var(--color-text-primary);
  line-height: 1.2;
}

.num-item span {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.sp-item {
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
}

.sp-item:first-of-type {
  border-top: none;
}

.date-chip {
  display: inline-block;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-line);
  border-radius: var(--radius-full);
  padding: 1px 10px;
  margin-bottom: 4px;
}

.sp-item-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.sp-item-meta {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

@media (min-width: 1280px) {
  .side-panel {
    position: sticky;
    /* 与周导航内容行上边缘对齐（顶栏高 + 周导航内边距） */
    top: calc(var(--topbar-h) + var(--spacing-md));
    align-self: start;
  }
}

@media (min-width: 768px) and (max-width: 1279px) {
  .side-panel {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
