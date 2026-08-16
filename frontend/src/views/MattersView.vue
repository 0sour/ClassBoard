<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { MOCK_HOMEWORK } from '@/data/mock'
import CourseModal from '@/components/schedule/CourseModal.vue'
import type { Course } from '@/types'

type Tab = 'exam' | 'lab' | 'homework'

const store = useScheduleStore()
const tab = ref<Tab>('exam')

const labCourses = computed(() =>
  store.visibleCourses.filter((c) => c.type === 'lab').sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod),
)

const homeworkDone = ref<Record<number, boolean>>(Object.fromEntries(MOCK_HOMEWORK.map((h) => [h.id, h.done])))

const selected = ref<Course | null>(null)

const tabs: { key: Tab; label: string }[] = [
  { key: 'exam', label: '考试' },
  { key: 'lab', label: '实验' },
  { key: 'homework', label: '作业' },
]
</script>

<template>
  <div class="page matters-view">
    <div class="matters-head reveal">
      <h2>事项</h2>
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

    <!-- 考试：暂无数据占位 -->
    <div class="empty" v-if="tab === 'exam'">
      还没有考试安排
    </div>

    <!-- 实验课列表 -->
    <div class="list" v-else-if="tab === 'lab'">
      <button
        v-for="c in labCourses"
        :key="c.id"
        class="list-item"
        type="button"
        @click="selected = c"
      >
        <span class="dot" :style="{ background: `var(--${c.color}-text)` }"></span>
        <span class="item-main">
          <span class="item-name">{{ c.name }}</span>
          <span class="item-meta">{{ c.location }} · {{ c.teacher }}</span>
        </span>
        <span class="item-slot num">周{{ '一二三四五六日'[c.weekday - 1] }} 第{{ c.startPeriod }}–{{ c.endPeriod }}节</span>
      </button>
      <div class="empty" v-if="labCourses.length === 0">还没有实验课</div>
    </div>

    <!-- 作业列表 -->
    <div class="list" v-else>
      <div v-for="h in MOCK_HOMEWORK" :key="h.id" class="list-item">
        <label class="check">
          <input
            type="checkbox"
            :checked="homeworkDone[h.id]"
            @change="homeworkDone[h.id] = !homeworkDone[h.id]"
          />
          <span class="box"></span>
        </label>
        <span class="item-main" :class="{ done: homeworkDone[h.id] }">
          <span class="item-name">{{ h.name }}</span>
          <span class="item-meta">{{ h.dueAt.slice(0, 10) }} 截止</span>
        </span>
      </div>
      <div class="empty" v-if="MOCK_HOMEWORK.length === 0">还没有作业</div>
    </div>

    <CourseModal :course="selected" @close="selected = null" />
  </div>
</template>

<style scoped>
.page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--spacing-lg);
}

.matters-head h2 {
  font-size: var(--font-size-2xl);
  margin-bottom: var(--spacing-lg);
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
  padding: 6px 18px;
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
  transition: box-shadow var(--motion-duration-normal) var(--motion-easing-standard);
}

.list-item:hover {
  box-shadow: var(--shadow-hover);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
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

.check {
  display: flex;
  align-items: center;
  cursor: pointer;
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
  padding: var(--spacing-2xl);
  text-align: center;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}
</style>
