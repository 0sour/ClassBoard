<script setup lang="ts">
// ============================================================
// ClassBoard · 侧栏（周课表右侧）
//   天气卡 + 本周摘要 + 「作业 / 考试」公示卡
//   作业：截止前始终显示，点「已截止」查看过去的；考试：未考在前，点「已结束」看历史
//   负责人可在卡内直接增删改（学生只读）
// ============================================================
import { computed, onBeforeUnmount, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import WeatherCard from './WeatherCard.vue'
import HomeworkEditor from '@/components/matters/HomeworkEditor.vue'
import ExamEditor from '@/components/matters/ExamEditor.vue'
import { confirm, toast } from '@/utils/ui'
import type { Exam, Homework } from '@/types'

const store = useScheduleStore()

const emit = defineEmits<{
  (e: 'openCourse', courseId: number): void
}>()

// 桌面端（≥768px）才在侧栏显示天气卡；移动端天气卡只在今日页（DayView）
const isDesktop = ref(window.innerWidth >= 768)

function onResize(): void {
  isDesktop.value = window.innerWidth >= 768
}

window.addEventListener('resize', onResize)
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

// 公示卡：作业 / 考试 分段切换（样式同顶栏视图切换 seg）
const panelTab = ref<'hw' | 'exam'>('hw')
/** 是否查看历史（作业=已截止 / 考试=已结束） */
const showPast = ref(false)
const canEdit = computed(() => !store.readonly)
const deleting = ref(false)

const hwEditing = ref<Homework | null>(null)
const showHwEditor = ref(false)
const examEditing = ref<Exam | null>(null)
const showExamEditor = ref(false)

/** 今日课程数：走统一解析（放假 / 调休按周几课表 / 调课与补课），不随周视图切换变化 */
const todayCourseCount = computed(() => store.todayResolved.blocks.length)

const courseCount = computed(() => store.visibleCourseBlocks.length)
const labCount = computed(() => store.visibleCourseBlocks.filter((c) => c.type === 'lab').length)

/** 分钟级「现在」（HH:mm 字符串便于与 dueAt/datetime 直接比较） */
function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const hwPending = computed(() =>
  store.homework.filter((h) => h.dueAt >= nowStamp()).sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1)),
)
const hwPast = computed(() =>
  store.homework.filter((h) => h.dueAt < nowStamp()).sort((a, b) => (a.dueAt > b.dueAt ? -1 : 1)),
)
const examPending = computed(() =>
  store.exams.filter((e) => e.datetime >= nowStamp()).sort((a, b) => (a.datetime < b.datetime ? -1 : 1)),
)
const examPast = computed(() =>
  store.exams.filter((e) => e.datetime < nowStamp()).sort((a, b) => (a.datetime > b.datetime ? -1 : 1)),
)

const hwList = computed(() => (showPast.value ? hwPast.value : hwPending.value))
const examList = computed(() => (showPast.value ? examPast.value : examPending.value))

function switchTab(t: 'hw' | 'exam'): void {
  panelTab.value = t
  showPast.value = false
}

function courseNameOf(courseId: number | null): string {
  if (courseId === null) return ''
  return store.courses.find((c) => c.id === courseId)?.name ?? ''
}

/** 日期徽标：作业=截止，考试=考试时间 */
function dateChip(iso: string): string {
  const d = iso.slice(5, 10).replace('-', '月')
  return `${d}日`
}

function timeOf(iso: string): string {
  return iso.slice(11, 16)
}

function pickCourse(courseId: number | null): void {
  if (courseId === null) return
  emit('openCourse', courseId)
}

function openCreate(): void {
  if (panelTab.value === 'hw') {
    hwEditing.value = null
    showHwEditor.value = true
  } else {
    examEditing.value = null
    showExamEditor.value = true
  }
}

function openEditHw(h: Homework): void {
  hwEditing.value = h
  showHwEditor.value = true
}

function openEditExam(e: Exam): void {
  examEditing.value = e
  showExamEditor.value = true
}

function removeHw(h: Homework): void {
  void confirm({
    title: '删除作业',
    desc: `将删除作业「${h.name}」，此操作可在变更记录中回退。`,
    danger: true,
    confirmText: '删除',
  }).then(async (ok) => {
    if (!ok) return
    deleting.value = true
    try {
      await store.deleteHomework(h.id)
      toast('作业已删除', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
    } finally {
      deleting.value = false
    }
  })
}

function removeExam(e: Exam): void {
  void confirm({
    title: '删除考试',
    desc: `将删除考试「${e.name}」，此操作可在变更记录中回退。`,
    danger: true,
    confirmText: '删除',
  }).then(async (ok) => {
    if (!ok) return
    deleting.value = true
    try {
      await store.deleteExam(e.id)
      toast('考试已删除', 'success')
    } catch (e2) {
      toast(e2 instanceof Error ? e2.message : '删除失败，请重试', 'error')
    } finally {
      deleting.value = false
    }
  })
}
</script>

<template>
  <aside class="side-panel">
    <!-- 天气卡（仅桌面端显示在侧栏顶部；移动端在今日页） -->
    <WeatherCard v-if="isDesktop && store.weatherData" variant="glass" class="reveal" />

    <!-- 本周摘要 -->
    <div class="sp-card reveal">
      <div class="sp-head">
        <span class="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
        </span>
        <h3>本周摘要</h3>
      </div>
      <div class="summary-nums">
        <div class="num-item" :class="{ clickable: !store.readonly }" @click="!store.readonly && $router.push('/week')"><b class="num">{{ courseCount }}</b><span>节课</span></div>
        <div class="num-item"><b class="num">{{ labCount }}</b><span>实验课</span></div>
        <div class="num-item" :class="{ clickable: !store.readonly }" @click="!store.readonly && $router.push('/day')"><b class="num">{{ todayCourseCount }}</b><span>今日课程</span></div>
      </div>
    </div>

    <!-- 公示卡：作业 / 考试（截止前 / 未考前始终显示，历史按需展开；负责人可增删改） -->
    <div class="sp-card reveal">
      <div class="sp-tabs" role="tablist" aria-label="班级公示">
        <button
          class="sp-tab" :class="{ active: panelTab === 'hw' }" role="tab" type="button"
          :aria-selected="panelTab === 'hw'" @click="switchTab('hw')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8M16 13H8M16 17H8" /></svg>
          <span>作业</span>
          <span class="sp-tab-count" v-if="hwPending.length">{{ hwPending.length }}</span>
        </button>
        <button
          class="sp-tab" :class="{ active: panelTab === 'exam' }" role="tab" type="button"
          :aria-selected="panelTab === 'exam'" @click="switchTab('exam')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>
          <span>考试</span>
          <span class="sp-tab-count" v-if="examPending.length">{{ examPending.length }}</span>
        </button>
      </div>

      <!-- 工具行：负责人添加 / 历史切换 -->
      <div class="sp-tools">
        <button v-if="canEdit" class="sp-add" type="button" @click="openCreate">
          ＋ 添加{{ panelTab === 'hw' ? '作业' : '考试' }}
        </button>
        <button
          class="sp-past"
          :class="{ active: showPast }"
          type="button"
          @click="showPast = !showPast"
        >
          {{ panelTab === 'hw' ? (showPast ? '← 返回待交' : '已截止') : showPast ? '← 返回未考' : '已结束' }}
          <span v-if="panelTab === 'hw' && hwPast.length">({{ hwPast.length }})</span>
          <span v-else-if="panelTab === 'exam' && examPast.length">({{ examPast.length }})</span>
        </button>
      </div>

      <!-- 作业 -->
      <template v-if="panelTab === 'hw'">
        <div v-if="hwList.length" class="sp-list">
          <div v-for="h in hwList" :key="h.id" class="sp-item">
            <div class="sp-item__main">
              <div class="date-chip">{{ dateChip(h.dueAt) }} {{ timeOf(h.dueAt) }} 截止</div>
              <div class="sp-item-title">{{ h.name }}</div>
              <div class="sp-item-meta">
                <button v-if="h.courseId !== null" class="sp-link" type="button" @click="pickCourse(h.courseId)">
                  {{ courseNameOf(h.courseId) }}
                </button>
                <span v-if="h.remark">{{ h.remark }}</span>
              </div>
            </div>
            <div v-if="canEdit" class="sp-item__tools">
              <button class="sp-tool" type="button" @click="openEditHw(h)">编辑</button>
              <button class="sp-tool sp-tool--danger" type="button" :disabled="deleting" @click="removeHw(h)">删除</button>
            </div>
          </div>
        </div>
        <div v-else class="sp-empty">{{ showPast ? '还没有已截止的作业' : '暂无待交作业' }}</div>
      </template>

      <!-- 考试 -->
      <template v-else>
        <div v-if="examList.length" class="sp-list">
          <div v-for="e in examList" :key="e.id" class="sp-item">
            <div class="sp-item__main">
              <div class="date-chip">{{ dateChip(e.datetime) }} {{ timeOf(e.datetime) }}</div>
              <div class="sp-item-title">{{ e.name }}</div>
              <div class="sp-item-meta">
                <button v-if="e.courseId !== null" class="sp-link" type="button" @click="pickCourse(e.courseId)">
                  {{ courseNameOf(e.courseId) }}
                </button>
                <span v-if="e.location">{{ e.location }}</span>
                <span v-if="e.remark">{{ e.remark }}</span>
              </div>
            </div>
            <div v-if="canEdit" class="sp-item__tools">
              <button class="sp-tool" type="button" @click="openEditExam(e)">编辑</button>
              <button class="sp-tool sp-tool--danger" type="button" :disabled="deleting" @click="removeExam(e)">删除</button>
            </div>
          </div>
        </div>
        <div v-else class="sp-empty">{{ showPast ? '还没有已结束的考试' : '暂无考试安排' }}</div>
      </template>
    </div>

    <HomeworkEditor :open="showHwEditor" :homework="hwEditing" @close="showHwEditor = false" @done="showHwEditor = false" />
    <ExamEditor :open="showExamEditor" :exam="examEditing" @close="showExamEditor = false" @done="showExamEditor = false" />
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

/* 公示卡分段切换（样式同顶栏视图切换 seg） */
.sp-tabs {
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
  margin-bottom: var(--spacing-sm);
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

/* 工具行 */
.sp-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
}

.sp-add {
  font-size: var(--font-size-sm);
  color: var(--color-brand);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

.sp-add:hover {
  background: var(--color-brand-subtle);
}

.sp-past {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  padding: 2px 8px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
}

.sp-past:hover {
  background: var(--color-bg-hover);
}

.sp-past.active {
  border-color: var(--color-brand);
  color: var(--color-brand);
}

.sp-list {
  display: flex;
  flex-direction: column;
}

.sp-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
  min-width: 0;
}

.sp-item:first-child {
  border-top: none;
}

.sp-item__main {
  flex: 1;
  min-width: 0;
}

.sp-item__tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: none;
}

.sp-tool {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  padding: 1px 8px;
}

.sp-tool:hover {
  background: var(--color-bg-hover);
}

.sp-tool--danger {
  color: var(--color-feedback-error);
  border-color: var(--color-feedback-error);
}

.sp-tool:disabled {
  opacity: 0.5;
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
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

/* 关联课程：点击打开课程详情 */
.sp-link {
  font-size: var(--font-size-xs);
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}

.sp-link:hover {
  background: var(--color-brand);
  color: var(--color-text-inverse);
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
