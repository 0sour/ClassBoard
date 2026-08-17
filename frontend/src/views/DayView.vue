<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import CourseModal from '@/components/schedule/CourseModal.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import type { Course } from '@/types'

const store = useScheduleStore()
const selected = ref<Course | null>(null)
const editing = ref<Course | null>(null)
const showEditor = ref(false)

const today = computed(() => store.today)
const todayLabel = computed(() => {
  const d = today.value
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'一二三四五六日'[(d.getDay() + 6) % 7]}`
})

// 今天的课程按今天真实所在周过滤，与周课表切换的展示周互不影响
const todayCourses = computed(() => {
  const wd = ((today.value.getDay() + 6) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  return store.todayCoursesByWeekday[wd]
})

const todayHomework = computed(() => {
  const wd = ((today.value.getDay() + 6) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const ids = store.todayCoursesByWeekday[wd].map((c) => c.id)
  return store.homework.filter((h) => !h.done && (h.courseId === null || ids.includes(h.courseId)))
})

onMounted(() => {
  void store.refreshToday()
})

function openCourse(course: Course): void {
  selected.value = course
}

function editCourse(course: Course): void {
  selected.value = null
  editing.value = course
  showEditor.value = true
}
</script>

<template>
  <div class="page day-view">
    <div class="today-head reveal">
      <h2>今天 · {{ todayLabel }}</h2>
      <span class="today-count num">共 {{ todayCourses.length }} 节课</span>
    </div>

    <div class="today-list">
      <button
        v-for="c in todayCourses"
        :key="c.id"
        class="today-card reveal"
        type="button"
        @click="openCourse(c)"
      >
        <span class="tc-dot" :style="{ background: `var(--${c.color}-text)` }"></span>
        <span class="tc-time num">
          {{ store.periods[c.startPeriod - 1]?.startTime }}–{{ store.periods[c.endPeriod - 1]?.endTime }}
        </span>
        <span class="tc-main">
          <span class="tc-name">{{ c.name }}</span>
          <span class="tc-loc">{{ c.location }} · {{ c.teacher }}</span>
        </span>
        <span class="tc-slot num">第 {{ c.startPeriod }}–{{ c.endPeriod }} 节</span>
      </button>
    </div>

    <div class="today-empty" v-if="todayCourses.length === 0">
      今天没有排课，享受空闲时光
    </div>

    <div class="today-hw" v-if="todayHomework.length">
      <h3>今日作业</h3>
      <div v-for="h in todayHomework" :key="h.id" class="hw-item">
        <span>{{ h.name }}</span>
        <span class="hw-due num">{{ h.dueAt.slice(0, 10) }} 截止</span>
      </div>
    </div>

    <CourseModal :course="selected" @close="selected = null" @edit="editCourse" />
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
  max-width: 768px;
  margin: 0 auto;
  padding: var(--spacing-lg);
}

.today-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
}

.today-head h2 {
  font-size: var(--font-size-2xl);
}

.today-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.today-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.today-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  text-align: left;
  transition: box-shadow var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.today-card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}

.tc-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.tc-time {
  min-width: 96px;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.tc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tc-name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.tc-loc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.tc-slot {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.today-empty {
  padding: var(--spacing-2xl);
  text-align: center;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}

.today-hw {
  margin-top: var(--spacing-xl);
}

.today-hw h3 {
  font-size: var(--font-size-lg);
  margin-bottom: var(--spacing-md);
}

.hw-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) 0;
  border-bottom: 1px solid var(--color-border-default);
}

.hw-due {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}
</style>
