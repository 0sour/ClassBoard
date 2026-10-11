<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import WeatherCard from '@/components/schedule/WeatherCard.vue'
import CourseModal from '@/components/schedule/CourseModal.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import AdjustBadge from '@/components/schedule/AdjustBadge.vue'
import { periodsLabel } from '@/utils/session'
import { dayRuleLabel, markerLabel } from '@/utils/calendar'
import type { Course } from '@/types'

const store = useScheduleStore()
const selectedId = ref<number | null>(null)
const editing = ref<Course | null>(null)
const showEditor = ref(false)

// 天气卡仅移动端显示（桌面端由周课表侧栏的毛玻璃卡承担）
const isMobile = ref(window.innerWidth < 768)

function onResize(): void {
  isMobile.value = window.innerWidth < 768
}

window.addEventListener('resize', onResize)
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const today = computed(() => store.today)
const todayLabel = computed(() => {
  const d = today.value
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'一二三四五六日'[(d.getDay() + 6) % 7]}`
})

// 今天的课：走统一解析——含学期日历（放假 / 调休按周几上课）与单课调整（调课 / 补课）
const todayResolved = computed(() => store.todayResolved)
const todayBlocks = computed(() => todayResolved.value.blocks)
const todayMarkers = computed(() => todayResolved.value.markers)

/** 今日提示：放假 / 按周几课表 / 有几门课是调整过来的 */
const todayNotice = computed(() => {
  const r = todayResolved.value
  if (r.rule?.kind === 'holiday') return { text: dayRuleLabel(r.rule), kind: 'holiday' as const }
  const adjusted = r.blocks.filter((b) => b.source !== 'base').length
  const parts: string[] = []
  if (r.rule?.kind === 'follow') parts.push(dayRuleLabel(r.rule))
  if (adjusted) parts.push(`今日 ${adjusted} 门课为调课/补课`)
  if (r.markers.length) parts.push(`${r.markers.length} 门课停课或调走`)
  if (!parts.length) return null
  return { text: parts.join(' · '), kind: r.rule?.kind === 'follow' ? ('follow' as const) : ('adjust' as const) }
})

const todayHomework = computed(() => {
  const ids = todayBlocks.value.map((c) => c.id)
  return store.homework.filter((h) => !h.done && (h.courseId === null || ids.includes(h.courseId)))
})

onMounted(() => {
  void store.refreshToday()
})

function openCourse(courseId: number): void {
  selectedId.value = courseId
}

function editCourse(course: Course): void {
  selectedId.value = null
  editing.value = course
  showEditor.value = true
}
</script>

<template>
  <div class="page day-view">
    <div class="today-head reveal">
      <h2>今天 · {{ todayLabel }}</h2>
      <span class="today-count num">共 {{ todayBlocks.length }} 节课</span>
    </div>

    <!-- 天气卡（仅移动端显示；桌面端由周课表侧栏承担） -->
    <WeatherCard v-if="isMobile && store.weatherData" variant="slim" class="reveal" />

    <!-- 今日提示：放假 / 调休按周几课表 / 有几门课是调整过来的 -->
    <div v-if="todayNotice" class="today-notice reveal" :class="todayNotice.kind">
      {{ todayNotice.text }}
    </div>

    <div class="today-list">
      <button
        v-for="b in todayBlocks"
        :key="`${b.id}:${b.sessionId ?? b.adjustmentId ?? 'x'}:${b.weekday}`"
        class="today-card reveal"
        type="button"
        @click="openCourse(b.id)"
      >
        <span class="tc-dot" :style="{ background: `var(--${b.color}-text)` }"></span>
        <span class="tc-time num">
          {{ store.periods[b.startPeriod - 1]?.startTime }}–{{ store.periods[b.endPeriod - 1]?.endTime }}
        </span>
        <span class="tc-main">
          <span class="tc-name">
            {{ b.name }}
            <AdjustBadge :block="b" />
          </span>
          <span class="tc-loc">{{ b.location }} · {{ b.teacher }}</span>
        </span>
        <span class="tc-slot num">{{ periodsLabel(b.periods) }}</span>
      </button>

      <!-- 原位置淡显：今天本有课但停课 / 调走了 -->
      <div v-for="m in todayMarkers" :key="`marker:${m.adjustmentId}`" class="today-card today-marker reveal">
        <span class="tc-dot faint" :style="{ background: `var(--${m.color}-text)` }"></span>
        <span class="tc-time num faint">{{ periodsLabel(m.periods) }}</span>
        <span class="tc-main">
          <span class="tc-name faint">{{ m.name }}</span>
        </span>
        <span class="tc-slot num">{{ markerLabel(m) }}</span>
      </div>
    </div>

    <div class="today-empty" v-if="todayBlocks.length === 0 && todayMarkers.length === 0">
      {{ todayResolved.rule?.kind === 'holiday' ? '今天放假，没有课' : '今天没有排课，享受空闲时光' }}
    </div>

    <div class="today-hw" v-if="todayHomework.length">
      <h3>今日作业</h3>
      <div v-for="h in todayHomework" :key="h.id" class="hw-item">
        <span>{{ h.name }}</span>
        <span class="hw-due num">{{ h.dueAt.slice(0, 10) }} 截止</span>
      </div>
    </div>

    <CourseModal :course-id="selectedId" @close="selectedId = null" @edit="editCourse" />
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

/* 天气卡与课程列表间距 */
.day-view > .weather,
.day-view > .reveal + .weather {
  margin-bottom: var(--spacing-lg);
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

/* 今日提示条：放假 / 调休 / 有调整 */
.today-notice {
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-subtle, var(--color-bg-surface));
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.today-notice.holiday {
  border-style: dashed;
  color: var(--color-text-tertiary);
}

/* 原位置淡显（停课 / 已调走） */
.today-marker {
  border-style: dashed;
  border-color: var(--color-border-strong);
  box-shadow: none;
  background: transparent;
  cursor: default;
}

.today-marker .faint {
  opacity: 0.55;
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
