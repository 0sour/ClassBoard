<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import { MOCK_PRACTICE } from '@/data/mock'
import type { Course } from '@/types'

const router = useRouter()
const store = useScheduleStore()

const emit = defineEmits<{
  (e: 'openCourse', course: Course): void
  (e: 'openHomework', homework: { id: number; name: string; courseId?: number | null }): void
}>()

// 组合卡：待交作业 / 实践与其他 分段切换（样式同顶栏视图切换 seg）
const panelTab = ref<'hw' | 'practice'>('hw')

// 今日课程数：按今天真实所在周统计，不随周视图切换变化
const todayCourseCount = computed(() => {
  const wd = ((store.today.getDay() + 6) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return store.todayCoursesByWeekday[wd].length
})

const courseCount = computed(() => store.visibleCourses.length)
const labCount = computed(() => store.visibleCourses.filter((c) => c.type === 'lab').length)

/** 待交作业：当前学期未完成（真实接口 /api/homework） */
const pendingHomework = computed(() => store.homework.filter((h) => !h.done))

/** 点击统计项跳转 */
function goToPage(name: string): void {
  router.push({ name })
}

/** 点击作业条目：emit 事件给父组件打开编辑弹窗 */
function openHomeworkItem(h: { id: number; name: string; courseId?: number | null }): void {
  emit('openHomework', h)
}

/** 点击实践课程条目：emit 事件给父组件打开课程详情（mock 数据转为 Course 格式） */
function openPracticeItem(p: { name: string; teacher: string; weeks: string }): void {
  const mockCourse = {
    id: 0,
    semesterId: 0,
    type: 'course' as const,
    name: p.name,
    teacher: p.teacher,
    location: '',
    color: 'course-1',
    weekType: 'all' as const,
    weekList: null,
    weekday: 1,
    startPeriod: 1,
    endPeriod: 1,
    remark: p.weeks,
    // 实践课程无固定时间：详情显示「无固定时间」，不进入课表网格/冲突检测
    unscheduled: true,
  } as Course
  emit('openCourse', mockCourse)
}
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
        <div class="num-item clickable" @click="goToPage('week')"><b class="num">{{ courseCount }}</b><span>节课</span></div>
        <div class="num-item clickable" @click="goToPage('matters')"><b class="num">{{ labCount }}</b><span>实验课</span></div>
        <div class="num-item clickable" @click="goToPage('day')"><b class="num">{{ todayCourseCount }}</b><span>今日课程</span></div>
      </div>
    </div>

    <!-- 组合卡：待交作业 / 实践与其他 -->
    <div class="sp-card reveal">
      <div class="sp-tabs" role="tablist" aria-label="信息面板">
        <button
          class="sp-tab" :class="{ active: panelTab === 'hw' }" role="tab" type="button"
          :aria-selected="panelTab === 'hw'" @click="panelTab = 'hw'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8M16 13H8M16 17H8" /></svg>
          <span>待交作业</span>
          <span class="sp-tab-count" v-if="pendingHomework.length">{{ pendingHomework.length }}</span>
        </button>
        <button
          class="sp-tab" :class="{ active: panelTab === 'practice' }" role="tab" type="button"
          :aria-selected="panelTab === 'practice'" @click="panelTab = 'practice'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          <span>实践与其他</span>
        </button>
      </div>

      <template v-if="panelTab === 'hw'">
          <div v-if="pendingHomework.length">
            <div v-for="h in pendingHomework" :key="h.id" class="sp-item clickable" @click="openHomeworkItem(h)">
              <div class="date-chip">{{ h.dueAt.slice(5, 10).replace('-', '月') }}日截止</div>
              <div class="sp-item-title">{{ h.name }}</div>
              <div class="sp-item-meta">未完成</div>
            </div>
          </div>
        <div v-else class="sp-empty">暂无待交作业，好好休息</div>
      </template>

      <template v-else>
        <div v-for="p in MOCK_PRACTICE" :key="p.name" class="sp-item clickable" @click="openPracticeItem(p)">
          <div class="sp-item-title">{{ p.name }}</div>
          <div class="sp-item-meta">{{ p.teacher }} · {{ p.weeks }}</div>
        </div>
      </template>
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

.num-item.clickable {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: background-color var(--motion-duration-normal) var(--motion-easing-standard);
}

.num-item.clickable:hover {
  background-color: var(--color-bg-hover);
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

/* 组合卡分段切换（样式同顶栏视图切换 seg） */
.sp-tabs {
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
  margin-bottom: var(--spacing-md);
}

.sp-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  transition: color var(--motion-duration-normal) var(--motion-easing-standard),
    background-color var(--motion-duration-normal) var(--motion-easing-standard),
    box-shadow var(--motion-duration-normal) var(--motion-easing-standard);
}

.sp-tab svg {
  width: 14px;
  height: 14px;
}

.sp-tab.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.sp-tab-count {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-size: 11px;
  font-weight: var(--font-weight-bold);
}

.sp-tab.active .sp-tab-count {
  background: var(--color-brand);
  color: var(--color-text-inverse);
}

.sp-item {
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
}

.sp-item.clickable {
  cursor: pointer;
  padding: var(--spacing-sm) var(--spacing-sm);
  margin: 0 calc(-1 * var(--spacing-sm));
  border-radius: var(--radius-sm);
  transition: background-color var(--motion-duration-normal) var(--motion-easing-standard);
}

.sp-item.clickable:hover {
  background-color: var(--color-bg-hover);
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

.sp-empty {
  padding: var(--spacing-xl) 0;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

@media (min-width: 1280px) {
  .side-panel {
    position: sticky;
    /* 初始位置与周导航内容行（按钮行）上边缘对齐：顶栏高 + 周导航内边距；
       容器余量不足时 sticky 退化为跟随滚动，对齐由 margin-top 保证 */
    margin-top: var(--spacing-md);
    top: var(--topbar-h);
  }
}

@media (min-width: 768px) and (max-width: 1279px) {
  .side-panel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
