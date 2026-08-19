<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import AppSelect from '@/components/common/AppSelect.vue'
import ImportWizard from '@/components/import/ImportWizard.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import { formatMonthDay } from '@/utils/week'

const route = useRoute()
const router = useRouter()
const store = useScheduleStore()

const isDesktop = ref(window.innerWidth >= 768)

onMounted(() => {
  const handleResize = () => {
    isDesktop.value = window.innerWidth >= 768
  }
  window.addEventListener('resize', handleResize)
  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
  })
})

const pageTitle = computed(() => (route.meta.title as string) ?? 'ClassBoard')

const isWeek = computed(() => route.name === 'week')
const isDay = computed(() => route.name === 'day')

function switchView(name: 'week' | 'day'): void {
  router.push({ name })
}

const showImportDropdown = ref(false)
const showImportWizard = ref(false)
const showCourseEditor = ref(false)

/** 点击外部关闭导入下拉（与提醒菜单一致：文档级 mousedown 监听，无遮罩，见 UI 4.9 约定） */
function onDocMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('.import-wrap')) return
  showImportDropdown.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

function onImport(mode: 'pdf' | 'manual'): void {
  showImportDropdown.value = false
  if (mode === 'pdf') showImportWizard.value = true
  else showCourseEditor.value = true
}

/** 学期选项（自研 AppSelect，替代原生 select） */
const semesterOptions = computed(() =>
  store.semesters.map((s) => ({ value: s.id, label: s.name })),
)

function setSemester(v: string | number | null): void {
  if (v === null) return
  store.setSemester(Number(v))
}

/** 站内提醒：铃铛展开提醒下拉（不单独成页，见 UI 设计文档 1.2 / PRD 5.6）
 * 内容：未完成作业（作业截止提醒）+ 今日课程（上课提醒），数据来自真实接口 */
const showReminderMenu = ref(false)
const isSettings = computed(() => route.name === 'settings')
const isMatters = computed(() => route.name === 'matters')

const reminders = computed(() => {
  const list: { id: string; title: string; meta: string; kind: '课程' | '作业' }[] = []
  // 今日上课课程
  const wd = ((store.today.getDay() + 6) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  for (const c of store.coursesByWeekday[wd]) {
    const p = store.periods[c.startPeriod - 1]
    list.push({
      id: `c${c.id}`,
      title: c.name,
      meta: p ? `${formatMonthDay(store.today)} ${p.startTime} 上课` : '今日上课',
      kind: '课程',
    })
  }
  // 未完成作业
  for (const h of store.homework.filter((x) => !x.done)) {
    list.push({
      id: `h${h.id}`,
      title: h.name,
      meta: `${h.dueAt.slice(5, 10).replace('-', '月')}日截止`,
      kind: '作业',
    })
  }
  return list
})
</script>

<template>
  <header class="topbar">
    <!-- 品牌（桌面） -->
    <div class="brand" v-if="isDesktop">
      <svg class="logo" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <path d="M8 2v4M16 2v4M3 9.5h18" />
        <path d="M8.5 14h2M13.5 14h2M8.5 17.5h2M13.5 17.5h2" />
      </svg>
      <span>ClassBoard</span>
    </div>

    <!-- 页面标题（移动） -->
    <div class="page-title" v-else>{{ pageTitle }}</div>

    <!-- 桌面分段控件：周课表 / 今天（等宽按钮，激活块原地淡入淡出，无位移） -->
    <div class="seg" role="tablist" aria-label="视图切换" v-if="isDesktop">
      <button
        class="seg-btn"
        :class="{ active: isWeek }"
        type="button"
        role="tab"
        :aria-selected="isWeek"
        @click="switchView('week')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>
        <span>周课表</span>
      </button>
      <button
        class="seg-btn"
        :class="{ active: isDay }"
        type="button"
        role="tab"
        :aria-selected="isDay"
        @click="switchView('day')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
        <span>今天</span>
      </button>
    </div>

    <div class="top-actions">
      <!-- 学期切换（自研 AppSelect，面板风格与 UI 一致） -->
      <AppSelect
        :model-value="store.currentSemesterId"
        :options="semesterOptions"
        aria-label="切换学期"
        @update:model-value="setSemester"
      />

      <!-- 导入课程下拉 -->
      <div class="import-wrap">
        <button
          class="btn-import"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="showImportDropdown"
          @click="showImportDropdown = !showImportDropdown"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
          <span>导入课程</span>
        </button>
        <div class="import-menu" v-if="showImportDropdown" role="menu">
          <button type="button" role="menuitem" @click="onImport('pdf')">从 PDF 导入</button>
          <button type="button" role="menuitem" @click="onImport('manual')">手动录入</button>
        </div>
      </div>

      <!-- 提醒（铃铛展开提醒下拉）与设置 -->
      <div class="reminder-wrap">
        <button
          class="btn-icon"
          :class="{ active: showReminderMenu }"
          type="button"
          aria-label="提醒"
          aria-haspopup="menu"
          :aria-expanded="showReminderMenu"
          @click="showReminderMenu = !showReminderMenu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          <span v-if="reminders.length" class="btn-badge">{{ reminders.length }}</span>
        </button>
        <div class="reminder-menu" v-if="showReminderMenu" role="menu" aria-label="提醒">
          <div class="reminder-menu__head">提醒</div>
          <button
            v-for="r in reminders"
            :key="r.id"
            class="reminder-item"
            type="button"
            role="menuitem"
          >
            <span class="reminder-item__kind">{{ r.kind }}</span>
            <span class="reminder-item__main">
              <span class="reminder-item__title">{{ r.title }}</span>
              <span class="reminder-item__meta">{{ r.meta }}</span>
            </span>
          </button>
          <div v-if="!reminders.length" class="reminder-empty">暂无提醒</div>
        </div>
        <div class="menu-backdrop" v-if="showReminderMenu" @click="showReminderMenu = false"></div>
      </div>
      <!-- 事项（考试/实验/作业，UI 设计文档 1.1：桌面顶栏入口；图标与底部 Tab 一致为列表） -->
      <button
        class="btn-icon"
        :class="{ active: isMatters }"
        type="button"
        aria-label="事项"
        @click="$router.push('/matters')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
      </button>
      <button
        class="btn-icon"
        :class="{ active: isSettings }"
        type="button"
        aria-label="设置"
        @click="$router.push('/settings')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </button>
    </div>
  </header>

  <!-- PDF 导入三步向导 -->
  <ImportWizard :open="showImportWizard" @close="showImportWizard = false" @done="showImportWizard = false" />

  <!-- 手动录入课程 -->
  <CourseEditor :open="showCourseEditor" @close="showCourseEditor = false" @done="showCourseEditor = false" />
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-index-sticky);
  height: var(--topbar-h-mobile);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: 0 var(--spacing-lg);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border-default);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-heavy);
  white-space: nowrap;
}

.logo {
  color: var(--color-brand);
}

.page-title {
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  white-space: nowrap;
}

.seg {
  width: fit-content;
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
  margin-inline: auto;
}

/* 按钮等宽：激活字重变化不影响按钮宽度，托盘总宽恒定，切换时不会左右移动 */
.seg-btn {
  width: 104px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  transition: color var(--motion-duration-normal) var(--motion-easing-standard),
    background-color var(--motion-duration-normal) var(--motion-easing-standard),
    box-shadow var(--motion-duration-normal) var(--motion-easing-standard);
}

.seg-btn svg {
  width: 16px;
  height: 16px;
}

.seg-btn.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-left: auto;
}

.import-wrap {
  position: relative;
}

.btn-import {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  height: 34px;
  padding: 0 var(--spacing-lg);
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-btn);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-import:hover {
  background: var(--color-brand-hover);
}

.btn-import svg {
  width: 15px;
  height: 15px;
}

.import-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 140px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xs);
  z-index: var(--z-index-modal);
}

.import-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
  color: var(--color-text-body);
}

.import-menu button:hover {
  background: var(--color-bg-hover);
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-icon:hover {
  background: var(--color-bg-hover);
}

/* 页面级激活反馈：当前所在页（设置）或提醒下拉展开时高亮 */
.btn-icon.active {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
}

.btn-icon svg {
  width: 18px;
  height: 18px;
}

/* 未读提醒角标（颜色对齐 UI 设计文档 1.2：--color-feedback-warning） */
.btn-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: var(--color-text-inverse);
  background: var(--color-feedback-warning);
  border-radius: var(--radius-full);
}

/* 提醒下拉面板 */
.reminder-wrap {
  position: relative;
}

.reminder-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 280px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xs);
  z-index: var(--z-index-modal);
}

.reminder-menu__head {
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
}

.reminder-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  text-align: left;
}

.reminder-item:hover {
  background: var(--color-bg-hover);
}

.reminder-item__kind {
  flex: none;
  font-size: 10px;
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  border-radius: var(--radius-full);
  padding: 2px 7px;
  margin-top: 1px;
}

.reminder-item__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.reminder-item__title {
  font-size: var(--font-size-md);
  color: var(--color-text-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reminder-item__meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.reminder-empty {
  padding: var(--spacing-lg) var(--spacing-md);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

/* 点击外部关闭下拉 */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-index-modal) - 1);
}

@media (min-width: 768px) {
  .topbar {
    height: var(--topbar-h);
  }
}
</style>
