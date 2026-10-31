<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import WeatherCard from '@/components/schedule/WeatherCard.vue'
import CourseModal from '@/components/schedule/CourseModal.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import AdjustBadge from '@/components/schedule/AdjustBadge.vue'
import AdjustDetail from '@/components/schedule/AdjustDetail.vue'
import MatterDetail from '@/components/matters/MatterDetail.vue'
import { periodsLabel } from '@/utils/session'
import { formatDate } from '@/utils/week'
import { chainOfBlock, chainOfMarker, markerLabel, monthDayLabel, type AdjustmentChain } from '@/utils/calendar'
import type { Course, DayMarker, Homework, ResolvedBlock } from '@/types'

const store = useScheduleStore()
const selectedId = ref<number | null>(null)
/** 点开课程详情时的那一块（含日期）：详情里显示这一次的实际时间 */
const selectedOcc = ref<{ block: ResolvedBlock; date: string } | null>(null)
const editing = ref<Course | null>(null)
const showEditor = ref(false)

/** 调整详情卡（角标 / 原位置标记点开，与设置台账同一张卡） */
const adjustChain = ref<AdjustmentChain | null>(null)

/** 点角标 → 详情卡；基准块退回课程详情 */
function openBlockAdjust(block: ResolvedBlock): void {
  const chain = chainOfBlock(block, formatDate(store.today))
  if (chain) adjustChain.value = chain
  else openCourse(block.id)
}

/** 点原位置 / 中间站标记 → 详情卡；无链条的旧标记退回课程详情 */
function openMarkerAdjust(marker: DayMarker): void {
  const chain = chainOfMarker(marker, formatDate(store.today))
  if (chain) adjustChain.value = chain
  else openCourse(marker.courseId)
}

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

/** 今日提示：放假 / 调休（课已移走或补某天的课）/ 有几门课是调整过来的 */
const todayNotice = computed(() => {
  const r = todayResolved.value
  if (r.rule?.kind === 'holiday') return { text: r.dayLabel, kind: 'holiday' as const }
  const adjusted = r.blocks.filter((b) => b.source !== 'base').length
  const parts: string[] = []
  if (r.dayLabel) parts.push(r.rule?.kind === 'shift' ? `${r.dayLabel}：今日的课已移至 ${r.rule.toDate ? monthDayLabel(r.rule.toDate) : ''}` : r.dayLabel)
  if (adjusted) parts.push(`今日 ${adjusted} 门课为调课/补课/调休`)
  if (r.markers.length) parts.push(`${r.markers.length} 门课停课或调走`)
  if (!parts.length) return null
  return { text: parts.join(' · '), kind: r.rule?.kind === 'shift' || r.shiftSources.length ? ('follow' as const) : ('adjust' as const) }
})

/** 本地时间 → `YYYY-MM-DDTHH:mm`（与 dueAt 同格式，可直接比字符串） */
function stampOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 今天 0 点（今天到期的作业留一整天：过点了也还显示，标「已截止」） */
function dayStartOf(d: Date): Date {
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  return t
}

/**
 * 近 7 天截止的作业：**所有课程**（含未关联课程的），不再只看「今天有课的课程」——
 * 今天没有这门课、但作业这几天要交的，同样得提醒。已过期更早的归侧栏「已截止」。
 */
const upcomingHomework = computed(() => {
  const now = new Date()
  const from = stampOf(dayStartOf(now))
  const to = stampOf(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))
  return store.homework
    .filter((h) => h.dueAt >= from && h.dueAt <= to)
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1))
})

/** 7 天之后才截止的还有几条（给一句提示，不在这块里摊开） */
const laterHomeworkCount = computed(() => {
  const now = new Date()
  const to = stampOf(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))
  return store.homework.filter((h) => h.dueAt > to).length
})

/** 截止文案：今天 15:30 / 明天 11:00 / 10月25日 11:00，过点标「已截止」 */
function dueLabel(iso: string): string {
  const [date, time] = iso.split('T')
  const days = Math.round((dayStartOf(new Date(`${date}T00:00`)).getTime() - dayStartOf(new Date()).getTime()) / 86400000)
  const dayText = days === 0 ? '今天' : days === 1 ? '明天' : monthDayLabel(date)
  const passed = iso < stampOf(new Date())
  return `${dayText} ${time ?? ''} ${passed ? '已截止' : '截止'}`.replace('  ', ' ')
}

/** 作业行点开详情（图片内联 / 附件下载；公开面只读） */
const detailHw = ref<Homework | null>(null)

onMounted(() => {
  void store.refreshToday()
})

function openCourse(courseId: number, block?: ResolvedBlock, date?: string): void {
  selectedId.value = courseId
  selectedOcc.value = block && date ? { block, date } : null
}

function editCourse(course: Course): void {
  if (store.readonly) return
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
        @click="b.chain?.length ? openBlockAdjust(b) : openCourse(b.id, b, formatDate(today))"
      >
        <span class="tc-dot" :style="{ background: `var(--${b.color}-text)` }"></span>
        <span class="tc-time num">
          {{ store.periods[b.startPeriod - 1]?.startTime }}–{{ store.periods[b.endPeriod - 1]?.endTime }}
        </span>
        <span class="tc-main">
          <span class="tc-name">
            <span class="tc-name-text">{{ b.name }}</span>
            <AdjustBadge :block="b" clickable @open="openBlockAdjust(b)" />
          </span>
          <span class="tc-loc">{{ b.location }} · {{ b.teacher }}</span>
        </span>
        <span class="tc-slot num">{{ periodsLabel(b.periods) }}</span>
      </button>

      <!-- 原位置淡显：今天本有课但停课 / 调走了（点开同一张调整详情卡） -->
      <button v-for="m in todayMarkers" :key="`marker:${m.adjustmentId}`" class="today-card today-marker reveal" type="button" @click="openMarkerAdjust(m)">
        <span class="tc-dot faint" :style="{ background: `var(--${m.color}-text)` }"></span>
        <span class="tc-time num faint">{{ periodsLabel(m.periods) }}</span>
        <span class="tc-main">
          <span class="tc-name faint">{{ m.name }}</span>
        </span>
        <span class="tc-slot num">{{ markerLabel(m) }}</span>
      </button>
    </div>

    <div class="today-empty" v-if="todayBlocks.length === 0 && todayMarkers.length === 0">
      {{ todayResolved.rule?.kind === 'holiday' ? '今天放假，没有课' : '今天没有排课，享受空闲时光' }}
    </div>

    <div class="today-hw" v-if="upcomingHomework.length || laterHomeworkCount">
      <h3>近 7 天截止的作业</h3>
      <button
        v-for="h in upcomingHomework"
        :key="h.id"
        class="hw-item hw-item--clickable"
        type="button"
        @click="detailHw = h"
      >
        <span class="hw-name">{{ h.name }}</span>
        <span class="hw-due num" :class="{ passed: h.dueAt < stampOf(new Date()) }">{{ dueLabel(h.dueAt) }}</span>
      </button>
      <p v-if="!upcomingHomework.length" class="hw-empty">近 7 天没有要交的作业</p>
      <p v-if="laterHomeworkCount" class="hw-more">另有 {{ laterHomeworkCount }} 条更晚截止，可在「周课表」侧栏「作业」里看</p>
    </div>

    <CourseModal :course-id="selectedId" :occurrence="selectedOcc" @close="selectedId = null; selectedOcc = null" @edit="editCourse" />
    <MatterDetail :open="detailHw !== null" kind="homework" :matter="detailHw" @close="detailHw = null" />
    <AdjustDetail :open="!!adjustChain" :chain="adjustChain" @close="adjustChain = null" />
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
  display: flex;
  flex-wrap: wrap; /* 窄屏两个角标换行，保住课名可读 */
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

/* 保底可读宽度：角标放不下就整体换行，而不是把课名压成一个字 */
.tc-name-text {
  flex: 1;
  min-width: 7.5em;
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

/* 原位置淡显（停课 / 已调走）：「已调至 …（备注）」较长，换行到第二行，不把课名挤成竖排 */
.today-marker {
  border-style: dashed;
  border-color: var(--color-border-strong);
  box-shadow: none;
  background: transparent;
  cursor: default;
  flex-wrap: wrap;
}

.today-marker .tc-slot {
  flex: 1 1 100%;
  white-space: normal;
  padding-left: 22px; /* 对齐课名（圆点 10 + 间距 12） */
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
  gap: var(--spacing-md);
  width: 100%;
  padding: var(--spacing-md) 0;
  border-bottom: 1px solid var(--color-border-default);
  text-align: left;
}

/* 作业行可点开详情（图片 / 附件） */
.hw-item--clickable {
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.hw-item--clickable:hover {
  background: var(--color-bg-hover);
}

.hw-item--clickable:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 1px;
}

.hw-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.hw-due.passed {
  color: var(--color-text-tertiary);
}

.hw-empty,
.hw-more {
  margin-top: var(--spacing-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.hw-due {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}
</style>
