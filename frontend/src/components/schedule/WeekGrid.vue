<script setup lang="ts">
import { computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import CourseBlock from './CourseBlock.vue'
import { computeOverlapGroups } from '@/utils/course'
import type { Course, Weekday } from '@/types'

const store = useScheduleStore()

const emit = defineEmits<{ (e: 'open', course: Course): void }>()

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
</script>

<template>
  <div class="weekgrid">
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

      <CourseBlock
        v-for="item in col"
        :key="item.course.id"
        :style="{
          // 行轨道：第 1 行为 44px 表头，第 2 行起才是第 1 节，故整体 +1
          gridRow: `${item.course.startPeriod + 1} / ${item.course.endPeriod + 2}`,
          // 显式锁定第 1 列：冲突课程允许重叠（配合 margin-left 错位），
          // 否则 grid 自动布局会把冲突课程推到隐式列导致错乱
          gridColumn: '1',
          marginLeft: item.offset ? '50%' : undefined,
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
  --ph-row: var(--ph-desktop);
  display: grid;
  /* 仅显式定义表头行；节次行由 grid-auto-rows 生成（行高跟随 --ph-row 断点）。
     注意：不可用 v-bind 拼接 var(--ph-row) —— 该变量在根元素计算时未定义，
     会导致自定义属性 invalid 而不继承，行模板整体失效。 */
  grid-template-rows: 44px;
  grid-auto-rows: var(--ph-row);
  border-right: 1px solid var(--color-border-default);
  position: relative;
}

.col:last-child {
  border-right: none;
}

/* 时间列 */
.time-col {
  background: var(--color-bg-corner);
  position: sticky;
  left: 0;
  z-index: var(--z-index-grid-corner);
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
