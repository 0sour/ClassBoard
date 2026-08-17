<script setup lang="ts">
// 事项页（规范 3.5）：考试 / 实验 / 作业三子 Tab
// 考试：时间倒序 + 橙色标签；实验：实验课课程列表；作业：勾选完成 + 蓝色标签
// 桌面端（≥1280px）双栏：左侧列表 + 右侧详情面板（UI 3.5）
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import CourseModal from '@/components/schedule/CourseModal.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import ExamEditor from '@/components/matters/ExamEditor.vue'
import HomeworkEditor from '@/components/matters/HomeworkEditor.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import { confirm, toast } from '@/utils/ui'
import type { Course, Exam, Homework } from '@/types'

type Tab = 'exam' | 'lab' | 'homework'
type HwFilter = 'all' | 'open' | 'done'

const store = useScheduleStore()
const tab = ref<Tab>('exam')
const hwFilter = ref<HwFilter>('all')

/** 桌面双栏：右侧详情面板选中项 */
const isDesktop = ref(window.innerWidth >= 1280)
const selectedExam = ref<Exam | null>(null)
const selectedHomework = ref<Homework | null>(null)
const selectedLab = ref<Course | null>(null)

function onResize(): void {
  isDesktop.value = window.innerWidth >= 1280
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

// ---- 考试 ----
const examEditing = ref<Exam | null>(null)
const showExamEditor = ref(false)

function openNewExam(): void {
  examEditing.value = null
  showExamEditor.value = true
}

function openEditExam(e: Exam): void {
  examEditing.value = e
  showExamEditor.value = true
}

async function removeExam(e: Exam): Promise<void> {
  const ok = await confirm({
    title: '删除考试',
    desc: `将删除考试「${e.name}」，此操作不可撤销。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await store.deleteExam(e.id)
    toast('已删除考试', 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : '删除失败，请重试', 'error')
  }
}

// ---- 实验课 ----
const labCourses = computed(() =>
  store.visibleCourses.filter((c) => c.type === 'lab').sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod),
)
const selectedCourse = ref<Course | null>(null)
const showLabEditor = ref(false)
const labEditorPresetLab = ref(true)
const editingCourse = ref<Course | null>(null)

function openNewLab(): void {
  labEditorPresetLab.value = true
  editingCourse.value = null
  showLabEditor.value = true
}

function editLabCourse(c: Course): void {
  selectedCourse.value = null
  editingCourse.value = c
  showLabEditor.value = true
}

async function removeLab(c: Course): Promise<void> {
  const ok = await confirm({
    title: '删除实验课',
    desc: `将删除课程「${c.name}」，此操作不可撤销。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await store.deleteCourse(c.id)
    selectedLab.value = null
    toast('已删除实验课', 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : '删除失败，请重试', 'error')
  }
}

// ---- 作业 ----
const homeworkEditing = ref<Homework | null>(null)
const showHomeworkEditor = ref(false)

const filteredHomework = computed(() => {
  if (hwFilter.value === 'open') return store.homework.filter((h) => !h.done)
  if (hwFilter.value === 'done') return store.homework.filter((h) => h.done)
  return store.homework
})

async function toggleHomework(h: Homework): Promise<void> {
  try {
    await store.setHomeworkDone(h.id, !h.done)
  } catch (err) {
    toast(err instanceof Error ? err.message : '操作失败，请重试', 'error')
  }
}

function openNewHomework(): void {
  homeworkEditing.value = null
  showHomeworkEditor.value = true
}

function openEditHomework(h: Homework): void {
  homeworkEditing.value = h
  showHomeworkEditor.value = true
}

async function removeHomework(h: Homework): Promise<void> {
  const ok = await confirm({
    title: '删除作业',
    desc: `将删除作业「${h.name}」，此操作不可撤销。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await store.deleteHomework(h.id)
    toast('已删除作业', 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : '删除失败，请重试', 'error')
  }
}

function onSaved(msg: string): void {
  toast(msg, 'success')
}

function onExamSaved(): void {
  onSaved('考试已保存')
  refreshSelected()
}

function onHomeworkSaved(): void {
  onSaved('作业已保存')
  refreshSelected()
}

function onCourseSaved(): void {
  onSaved(editingCourse.value ? '课程已保存' : '实验课已添加')
  refreshSelected()
}

/** 桌面双栏：列表点击选中到右侧详情面板；移动端维持原有行为 */
function selectExam(e: Exam): void {
  if (isDesktop.value) {
    selectedExam.value = e
    selectedHomework.value = null
    selectedLab.value = null
  } else {
    openEditExam(e)
  }
}

function selectHomework(h: Homework): void {
  if (isDesktop.value) {
    selectedHomework.value = h
    selectedExam.value = null
    selectedLab.value = null
  } else {
    openEditHomework(h)
  }
}

function selectLab(c: Course): void {
  if (isDesktop.value) {
    selectedLab.value = c
    selectedExam.value = null
    selectedHomework.value = null
  } else {
    selectedCourse.value = c
  }
}

/** 详情面板操作后刷新选中态 */
function refreshSelected(): void {
  if (selectedExam.value) {
    selectedExam.value = store.exams.find((e) => e.id === selectedExam.value!.id) ?? null
  }
  if (selectedHomework.value) {
    selectedHomework.value = store.homework.find((h) => h.id === selectedHomework.value!.id) ?? null
  }
  if (selectedLab.value) {
    selectedLab.value = store.courses.find((c) => c.id === selectedLab.value!.id) ?? null
  }
}

const tabs: { key: Tab; label: string }[] = [
  { key: 'exam', label: '考试' },
  { key: 'lab', label: '实验' },
  { key: 'homework', label: '作业' },
]

const hwFilters: { key: HwFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '未完成' },
  { key: 'done', label: '已完成' },
]

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
</script>

<template>
  <div class="page matters-view">
    <div class="matters-layout">
      <div class="matters-main">
    <div class="matters-head reveal">
      <h2>事项</h2>
      <button class="btn-add" type="button" @click="tab === 'exam' ? openNewExam() : tab === 'lab' ? openNewLab() : openNewHomework()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>新增{{ tab === 'lab' ? '实验课' : tab === 'exam' ? '考试' : '作业' }}</span>
      </button>
    </div>

    <div class="seg reveal" role="tablist" aria-label="事项分类">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="seg-btn"
        :class="{ active: tab === t.key }"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- ===== 考试 ===== -->
    <div v-if="tab === 'exam'" class="list reveal">
      <Skeleton v-if="store.mattersLoading && store.exams.length === 0" variant="card" :count="4" />
      <template v-else>
        <div v-for="e in store.exams" :key="e.id" class="list-item" :class="{ selected: isDesktop && selectedExam?.id === e.id }" @click="selectExam(e)">
          <span class="tag tag--exam">考试</span>
          <span class="item-main">
            <span class="item-name">{{ e.name }}</span>
            <span class="item-meta">
              {{ e.datetime.slice(0, 10) }} {{ e.datetime.slice(11, 16) }}
              <template v-if="e.location"> · {{ e.location }}</template>
            </span>
          </span>
          <button class="btn-mini" type="button" aria-label="删除考试" @click.stop="removeExam(e)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        </div>
        <div v-if="store.exams.length === 0" class="empty">
          <p class="empty__title">还没有考试安排</p>
          <p class="empty__desc">新增考试后按时间倒序展示。</p>
          <button class="btn-empty" type="button" @click="openNewExam">新增考试</button>
        </div>
      </template>
    </div>

    <!-- ===== 实验 ===== -->
    <div v-else-if="tab === 'lab'" class="list reveal">
      <button
        v-for="c in labCourses"
        :key="c.id"
        class="list-item"
        :class="{ selected: isDesktop && selectedLab?.id === c.id }"
        type="button"
        @click="selectLab(c)"
      >
        <span class="tag tag--lab">实验</span>
        <span class="item-main">
          <span class="item-name">{{ c.name }}</span>
          <span class="item-meta">{{ c.location }} · {{ c.teacher }}</span>
        </span>
        <span class="item-slot num">{{ WEEKDAY_LABELS[c.weekday - 1] }} 第{{ c.startPeriod }}–{{ c.endPeriod }}节</span>
      </button>
      <div v-if="labCourses.length === 0" class="empty">
        <p class="empty__title">还没有实验课</p>
        <p class="empty__desc">实验课为手动录入的课程类型。</p>
        <button class="btn-empty" type="button" @click="openNewLab">新增实验课</button>
      </div>
    </div>

    <!-- ===== 作业 ===== -->
    <div v-else class="reveal">
      <div class="filter-bar" role="group" aria-label="作业状态筛选">
        <button
          v-for="f in hwFilters"
          :key="f.key"
          class="filter-btn"
          :class="{ active: hwFilter === f.key }"
          type="button"
          @click="hwFilter = f.key"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="list">
        <div v-for="h in filteredHomework" :key="h.id" class="list-item" :class="{ selected: isDesktop && selectedHomework?.id === h.id }">
          <label class="check" :aria-label="h.done ? '标记为未完成' : '标记为已完成'">
            <input type="checkbox" :checked="h.done" @change="toggleHomework(h)" />
            <span class="box"></span>
          </label>
          <span class="item-main" :class="{ done: h.done }" @click="selectHomework(h)">
            <span class="item-name">{{ h.name }}</span>
            <span class="item-meta">{{ h.dueAt.slice(0, 10) }} 截止</span>
          </span>
          <button class="btn-mini" type="button" aria-label="删除作业" @click.stop="removeHomework(h)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        </div>
        <div v-if="filteredHomework.length === 0" class="empty">
          <p class="empty__title">{{ hwFilter === 'all' ? '还没有作业' : hwFilter === 'open' ? '没有未完成的作业' : '还没有已完成的作业' }}</p>
          <button class="btn-empty" type="button" @click="openNewHomework">新增作业</button>
        </div>
      </div>
    </div>
      </div>

      <!-- 桌面双栏：右侧详情面板（UI 3.5） -->
      <aside v-if="isDesktop" class="matters-detail reveal" aria-label="详情">
        <!-- 考试详情 -->
        <template v-if="selectedExam">
          <div class="detail-card">
            <span class="tag tag--exam">考试</span>
            <h3 class="detail-title">{{ selectedExam.name }}</h3>
            <dl class="detail-list">
              <div class="detail-row"><dt>时间</dt><dd class="num">{{ selectedExam.datetime.slice(0, 10) }} {{ selectedExam.datetime.slice(11, 16) }}</dd></div>
              <div class="detail-row"><dt>地点</dt><dd>{{ selectedExam.location || '—' }}</dd></div>
              <div class="detail-row" v-if="selectedExam.remark"><dt>备注</dt><dd>{{ selectedExam.remark }}</dd></div>
            </dl>
            <div class="detail-actions">
              <button class="btn-mini btn-mini--danger" type="button" @click="removeExam(selectedExam)">删除</button>
              <button class="btn-mini btn-mini--primary" type="button" @click="openEditExam(selectedExam)">编辑</button>
            </div>
          </div>
        </template>

        <!-- 作业详情 -->
        <template v-else-if="selectedHomework">
          <div class="detail-card">
            <span class="tag tag--info">作业</span>
            <h3 class="detail-title">{{ selectedHomework.name }}</h3>
            <dl class="detail-list">
              <div class="detail-row"><dt>截止</dt><dd class="num">{{ selectedHomework.dueAt.slice(0, 10) }} {{ selectedHomework.dueAt.slice(11, 16) }}</dd></div>
              <div class="detail-row"><dt>状态</dt><dd>{{ selectedHomework.done ? '已完成' : '未完成' }}</dd></div>
              <div class="detail-row" v-if="selectedHomework.remark"><dt>备注</dt><dd>{{ selectedHomework.remark }}</dd></div>
            </dl>
            <div class="detail-actions">
              <button class="btn-mini btn-mini--danger" type="button" @click="removeHomework(selectedHomework)">删除</button>
              <button class="btn-mini btn-mini--primary" type="button" @click="openEditHomework(selectedHomework)">编辑</button>
            </div>
          </div>
        </template>

        <!-- 实验课详情 -->
        <template v-else-if="selectedLab">
          <div class="detail-card">
            <span class="tag tag--lab">实验</span>
            <h3 class="detail-title">{{ selectedLab.name }}</h3>
            <dl class="detail-list">
              <div class="detail-row"><dt>教师</dt><dd>{{ selectedLab.teacher || '—' }}</dd></div>
              <div class="detail-row"><dt>地点</dt><dd>{{ selectedLab.location || '—' }}</dd></div>
              <div class="detail-row"><dt>时间</dt><dd class="num">{{ WEEKDAY_LABELS[selectedLab.weekday - 1] }} 第{{ selectedLab.startPeriod }}–{{ selectedLab.endPeriod }}节</dd></div>
              <div class="detail-row" v-if="selectedLab.remark"><dt>备注</dt><dd>{{ selectedLab.remark }}</dd></div>
            </dl>
            <div class="detail-actions">
              <button class="btn-mini btn-mini--danger" type="button" @click="removeLab(selectedLab)">删除</button>
              <button class="btn-mini btn-mini--primary" type="button" @click="editLabCourse(selectedLab)">编辑</button>
            </div>
          </div>
        </template>

        <div v-else class="detail-empty">从左侧选择一项查看详情</div>
      </aside>
    </div>

    <CourseModal :course="selectedCourse" @close="selectedCourse = null" @edit="editLabCourse" />
    <CourseEditor
      :open="showLabEditor"
      :course="editingCourse"
      :preset-type="'lab'"
      @close="showLabEditor = false"
      @done="onCourseSaved"
    />
    <ExamEditor :open="showExamEditor" :exam="examEditing" @close="showExamEditor = false" @done="onExamSaved" />
    <HomeworkEditor :open="showHomeworkEditor" :homework="homeworkEditing" @close="showHomeworkEditor = false" @done="onHomeworkSaved" />
  </div>
</template>

<style scoped>
.page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--spacing-lg);
}

.matters-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
}

.matters-head h2 {
  font-size: var(--font-size-2xl);
}

.btn-add {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  height: 34px;
  padding: 0 var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-btn);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-add:hover {
  background: var(--color-brand-hover);
}

.btn-add svg {
  width: 15px;
  height: 15px;
}

.seg {
  display: inline-flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
  margin-bottom: var(--spacing-lg);
}

.seg-btn {
  width: 80px;
  height: 34px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  transition: all var(--motion-duration-normal) var(--motion-easing-standard);
}

.seg-btn.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.list-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  text-align: left;
  cursor: pointer;
  transition: box-shadow var(--motion-duration-normal) var(--motion-easing-standard);
}

.list-item:hover {
  box-shadow: var(--shadow-hover);
}

.tag {
  flex: none;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  border-radius: var(--radius-full);
  padding: 2px 10px;
}

.tag--exam {
  color: var(--color-feedback-warning);
  background: rgba(245, 158, 11, 0.12);
}

.tag--lab {
  color: var(--course-3-text);
  background: rgba(91, 33, 182, 0.08);
}

.tag--info {
  color: var(--color-feedback-info);
  background: rgba(6, 182, 212, 0.12);
}

.item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.item-name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.item-main.done .item-name {
  text-decoration: line-through;
  color: var(--color-text-tertiary);
}

.item-meta {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.item-slot {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.btn-mini {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-mini:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-feedback-error);
}

.btn-mini svg {
  width: 15px;
  height: 15px;
}

.filter-bar {
  display: inline-flex;
  gap: var(--spacing-xs);
  padding: 3px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-md);
}

.filter-btn {
  padding: 5px 14px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  transition: all var(--motion-duration-fast) var(--motion-easing-standard);
}

.filter-btn.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.check {
  display: flex;
  align-items: center;
  cursor: pointer;
  flex: none;
}

.check input {
  position: absolute;
  opacity: 0;
}

.box {
  width: 18px;
  height: 18px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
}

.check input:checked + .box {
  background: var(--color-feedback-success);
  border-color: var(--color-feedback-success);
}

.check input:checked + .box::after {
  content: '';
  display: block;
  width: 10px;
  height: 5px;
  border-left: 2px solid var(--color-text-inverse);
  border-bottom: 2px solid var(--color-text-inverse);
  transform: translate(3px, 4px) rotate(-45deg);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-2xl) var(--spacing-lg);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}

.empty__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.empty__desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.btn-empty {
  margin-top: var(--spacing-xs);
  height: 32px;
  padding: 0 var(--spacing-lg);
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-btn);
}

.btn-empty:hover {
  background: var(--color-brand-hover);
}

/* ===== 桌面双栏（≥1280px，UI 3.5） ===== */
.matters-layout {
  display: block;
}

.matters-main {
  min-width: 0;
}

.matters-detail {
  position: sticky;
  top: calc(var(--topbar-h) + var(--spacing-lg));
  align-self: start;
}

.detail-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: var(--spacing-lg);
}

.detail-title {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  word-break: break-all;
}

.detail-list {
  margin-top: var(--spacing-md);
}

.detail-row {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
  font-size: var(--font-size-md);
}

.detail-row:first-of-type {
  border-top: none;
}

.detail-row dt {
  flex: none;
  width: 48px;
  color: var(--color-text-tertiary);
}

.detail-row dd {
  flex: 1;
  color: var(--color-text-body);
  font-weight: var(--font-weight-medium);
  word-break: break-all;
}

.detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-lg);
}

.detail-empty {
  padding: var(--spacing-2xl) var(--spacing-lg);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}

.list-item.selected {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

@media (min-width: 1280px) {
  .matters-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: var(--spacing-xl);
    align-items: start;
  }
}
</style>
