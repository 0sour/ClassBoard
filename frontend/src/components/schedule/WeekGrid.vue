<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import CourseBlock from './CourseBlock.vue'
import { computeOverlapGroups } from '@/utils/course'
import type { Course, Weekday } from '@/types'

const store = useScheduleStore()

const emit = defineEmits<{
  (e: 'open', course: Course): void
  (e: 'create', slot: { weekday: Weekday; period: number }): void
}>()

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

const todayWeekday = computed<Weekday>(() => ((store.today.getDay() + 6) % 7 + 1) as Weekday)

/** 仅在当前周（weekOffset=0）时高亮今天列 */
const isCurrentWeek = computed(() => store.weekOffset === 0)

/** 今天列高亮（仅当前周生效） */
const highlightedWeekday = computed<Weekday | null>(() => (isCurrentWeek.value ? todayWeekday.value : null))

/** 每列课程（冲突时后导入者右移半格） */
const columns = computed(() => {
  const out: { course: Course; offset: boolean; conflict: boolean }[][] = []
  for (let wd = 1; wd <= 7; wd++) {
    const list = store.coursesByWeekday[wd as Weekday]
    const groups = computeOverlapGroups(list)
    out.push(
      list.map((c) => {
        const conflicts = groups.get(c.id) ?? []
        const offset = conflicts.some((o) => o.id > c.id)
        return { course: c, offset, conflict: conflicts.length > 0 }
      }),
    )
  }
  return out
})

// ============================================================
// 桌面端动态行高：让 12 节课表在常见分辨率（1280×720 / 1920×1080）下
// 一屏完整显示、无需滚动页面。
// 公式：行高 = (视口高 − 页面上部固定开销 200px − 表头 44px) / 12 节，
// 上限 64px（设计 token），下限 36px（保证课程块可读）。
// 平板/移动端仍用断点 token（52/56px）。
// ============================================================
const isDesktop = ref(window.innerWidth >= 1280)
const viewportH = ref(window.innerHeight)

function onResize(): void {
  isDesktop.value = window.innerWidth >= 1280
  viewportH.value = window.innerHeight
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const rowHeight = computed(() => {
  if (!isDesktop.value) return null
  const h = Math.floor((viewportH.value - 244) / 12)
  return Math.min(64, Math.max(36, h))
})
</script>

<template>
  <div class="weekgrid" :style="rowHeight ? { '--ph-row-dyn': rowHeight + 'px' } : undefined">
    <!-- 时间列 -->
    <div class="col time-col" aria-hidden="true">
      <div class="day-head corner"></div>
      <div v-for="p in store.periods" :key="p.id" class="time-cell">
        <b>第{{ p.index }}节</b>
        <span>{{ p.startTime }}–{{ p.endTime }}</span>
      </div>
    </div>

    <!-- 7 天列 -->
    <div
      v-for="(col, idx) in columns"
      :key="idx"
      class="col day-col"
      :class="{ today: idx + 1 === highlightedWeekday }"
    >
      <div class="day-head">
        <div class="wd">
          {{ DAY_LABELS[idx] }}
          <span v-if="idx + 1 === highlightedWeekday" class="pill">今天</span>
        </div>
        <div class="dt num">{{ store.weekDays[idx].getMonth() + 1 }}/{{ store.weekDays[idx].getDate() }}</div>
      </div>

      <!-- 空白槽：点击快捷新增课程（预填星期与节次，PRD 5.2 / UI 3.1） -->
      <button
        v-for="p in store.periods"
        :key="'slot-' + p.id"
        class="slot"
        type="button"
        :style="{
          gridRow: `${p.index + 1} / ${p.index + 2}`,
          gridColumn: '1 / 3',
        }"
        :aria-label="`新增课程：周${DAY_LABELS[idx]} 第${p.index}节`"
        @click="emit('create', { weekday: (idx + 1) as Weekday, period: p.index })"
      ></button>

      <CourseBlock
        v-for="item in col"
        :key="item.course.id"
        :style="{
          // 行轨道：第 1 行为 44px 表头，第 2 行起才是第 1 节，故整体 +1
          gridRow: `${item.course.startPeriod + 1} / ${item.course.endPeriod + 2}`,
          // 冲突课程各占一列，非冲突课程跨两列
          gridColumn: item.conflict
            ? item.offset ? '2' : '1'
            : '1 / 3',
        }"
        :course="item.course"
        :conflict="item.conflict"
        @open="(c) => emit('open', c)"
      />
    </div>
  </div>
</template>

<style scoped>
.weekgrid {
  display: grid;
  grid-template-columns: var(--tc-w) repeat(7, minmax(120px, 1fr));
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

.col {
  /* 桌面端优先使用动态行高（--ph-row-dyn，WeekGrid 按视口计算），
     未设置时回退设计 token；平板/移动端断点仍覆盖为 52/56px */
  --ph-row: var(--ph-row-dyn, var(--ph-desktop));
  display: grid;
  /* 两列网格：冲突课程各占一列，非冲突课程跨两列 */
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: 44px;
  grid-auto-rows: var(--ph-row);
  border-right: 1px solid var(--color-border-default);
  position: relative;
}

.col:last-child {
  border-right: none;
}

/* 空白槽：占位可点击，hover 提示；课程块渲染在其上（DOM 顺序在后） */
.slot {
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.slot:hover {
  background: var(--color-bg-subtle);
}

.slot:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -1px;
}

/* 时间列 */
.time-col {
  background: var(--color-bg-corner);
  position: sticky;
  left: 0;
  z-index: var(--z-index-grid-corner);
  grid-template-columns: 1fr;
}

.time-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-top: 1px solid var(--color-border-default);
}

.time-cell b {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-bold);
  font-variant-numeric: tabular-nums;
}

.time-cell span {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 表头 */
.day-head {
  position: sticky;
  top: 0;
  z-index: var(--z-index-grid-corner);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  background: var(--color-bg-corner);
  border-bottom: 1px solid var(--color-border-default);
}

.day-col.today .day-head {
  background: var(--color-brand-subtle);
}

.wd {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.day-col.today .wd {
  color: var(--color-brand-hover);
  font-weight: var(--font-weight-bold);
}

.dt {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.day-col.today .dt {
  color: var(--color-brand-hover);
}

.pill {
  font-size: 10px;
  color: var(--color-text-inverse);
  background: var(--color-brand);
  border-radius: var(--radius-full);
  padding: 1px 6px;
  font-weight: var(--font-weight-medium);
}

/* 今天列底色 */
.day-col.today::before {
  content: '';
  position: absolute;
  inset: 44px 0 0 0;
  background: var(--color-brand-subtle);
  pointer-events: none;
}

/* 网格行分割线 */
.col::after {
  content: '';
  position: absolute;
  inset: 44px 0 0 0;
  background-image: linear-gradient(
    to bottom,
    transparent calc(var(--ph-row) - 1px),
    var(--color-border-default) calc(var(--ph-row) - 1px)
  );
  background-size: 100% var(--ph-row);
  pointer-events: none;
  opacity: 0.7;
}

@media (max-width: 1279px) {
  .col {
    --ph-row: var(--ph-tablet);
  }
}

@media (max-width: 767px) {
  .weekgrid {
    grid-template-columns: var(--tc-w) repeat(7, 140px);
    min-width: calc(var(--tc-w) + 7 * 140px);
    border-radius: var(--radius-lg);
  }

  .col {
    --ph-row: var(--ph-mobile);
  }
}
</style>
