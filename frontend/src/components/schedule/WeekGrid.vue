<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import CourseBlock from './CourseBlock.vue'
import { computeOverlapGroups, isOverlap } from '@/utils/course'
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

/** 最后停留的冲突课程 id（不随 mouseleave 清空）；null = 从未 hover 过（均分） */
const hovered = ref<number | null>(null)

/** 动画后的 flex-grow 实时值，驱动模板 style 绑定 */
const growValues = ref<Record<number, number>>({})
let animRaf = 0

/** 缓动函数：easeOutCubic */
function ease(t: number): number {
  return t < 1 ? 1 - (1 - t) * (1 - t) * (1 - t) : 1
}

/** 对当前所有冲突课程执行 rAF 补间动画 */
function animateGrow(targetGrow: Record<number, number>, duration = 200): void {
  cancelAnimationFrame(animRaf)
  const from: Record<number, number> = {}
  for (const id of Object.keys(targetGrow)) {
    from[Number(id)] = growValues.value[Number(id)] ?? 1
  }
  const t0 = performance.now()
  const tick = (now: number): void => {
    const p = Math.min(1, (now - t0) / duration)
    const e = ease(p)
    for (const id of Object.keys(targetGrow)) {
      const nid = Number(id)
      const f = from[nid] ?? 1
      const t = targetGrow[nid]
      growValues.value[nid] = f + (t - f) * e
    }
    if (p < 1) animRaf = requestAnimationFrame(tick)
  }
  animRaf = requestAnimationFrame(tick)
}

function handleHoverEnter(id: number): void {
  hovered.value = id
  // 计算该组所有课程的目标 grow：hover 的 2/3，其余 1/3
  const targets: Record<number, number> = {}
  for (const g of allConflictGroupsFlat.value) {
    targets[g.id] = g.id === id ? 2 : 1
  }
  animateGrow(targets)
}

function handleHoverLeave(): void {
  // 不清空 hovered——保留最后停留的课程为 2/3
}

/** 所有冲突课程 id 列表（供动画目标计算用） */
const allConflictGroupsFlat = computed(() => {
  const result: { id: number }[] = []
  const seen = new Set<number>()
  for (const col of columns.value) {
    for (const item of col) {
      if (item.conflict && !seen.has(item.course.id)) {
        result.push({ id: item.course.id })
        seen.add(item.course.id)
      }
    }
  }
  return result
})

/** 获取某课程的 flex-grow 值（动画补间驱动） */
function getGrow(id: number): number {
  return growValues.value[id] ?? 1
}

type ColItem = { course: Course; offset: boolean; conflict: boolean }

/** 每列课程（仅标注是否冲突；错位布局已改为 flex 分栏，offset 不再用于定位） */
const columns = computed(() => {
  const out: ColItem[][] = []
  for (let wd = 1; wd <= 7; wd++) {
    const list = store.coursesByWeekday[wd as Weekday]
    const groups = computeOverlapGroups(list)
    out.push(
      list.map((c) => {
        const conflicts = groups.get(c.id) ?? []
        return { course: c, offset: conflicts.some((o) => o.id > c.id), conflict: conflicts.length > 0 }
      }),
    )
  }
  return out
})

/** 非冲突课程（单独渲染，跨全列） */
const soloItems = (idx: number): ColItem[] => columns.value[idx].filter((i) => !i.conflict)

/** 冲突课程按重叠关系分组成连通分量：每组渲染为一个 flex 分栏容器 */
function conflictGroupsOf(idx: number): { course: Course }[][] {
  const col = columns.value[idx]
  const used = new Set<number>()
  const groups: { course: Course }[][] = []
  for (const item of col) {
    if (!item.conflict || used.has(item.course.id)) continue
    const group: { course: Course }[] = []
    let frontier: ColItem[] = [item]
    used.add(item.course.id)
    while (frontier.length) {
      const next: ColItem[] = []
      for (const cur of frontier) {
        group.push(cur)
        for (const other of col) {
          if (!other.conflict || used.has(other.course.id)) continue
          if (isOverlap(cur.course, other.course)) {
            next.push(other)
            used.add(other.course.id)
          }
        }
      }
      frontier = next
    }
    // 无 hover 时第一门展开为 2/3，按节次与 id 排序保证稳定
    group.sort((a, b) => a.course.startPeriod - b.course.startPeriod || a.course.id - b.course.id)
    groups.push(group)
  }
  return groups
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  cancelAnimationFrame(animRaf)
})

// ============================================================
// 桌面端动态行高：让 12 节课表在常见分辨率（1280×720 / 1920×1080）下
// 一屏完整显示、无需滚动页面。
// ============================================================
const isDesktop = ref(window.innerWidth >= 1280)
const viewportH = ref(window.innerHeight)

function onResize(): void {
  isDesktop.value = window.innerWidth >= 1280
  viewportH.value = window.innerHeight
}

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
          gridColumn: '1',
        }"
        :aria-label="`新增课程：周${DAY_LABELS[idx]} 第${p.index}节`"
        @click="emit('create', { weekday: (idx + 1) as Weekday, period: p.index })"
      ></button>

      <!-- 非冲突课程：跨全列 -->
      <CourseBlock
        v-for="item in soloItems(idx)"
        :key="'c-' + item.course.id"
        :style="{
          gridRow: `${item.course.startPeriod + 1} / ${item.course.endPeriod + 2}`,
          gridColumn: '1',
        }"
        :course="item.course"
        @open="(c) => emit('open', c)"
      />

      <!-- 冲突课程组：flex 分栏，hover 展开 2/3（1/3 只显示名称） -->
      <div
        v-for="(group, gi) in conflictGroupsOf(idx)"
        :key="'grp-' + gi"
        class="overlap"
        :style="{
          gridRow: `${group[0].course.startPeriod + 1} / ${group[0].course.endPeriod + 2}`,
          gridColumn: '1',
        }"
        @mouseleave="handleHoverLeave"
      >
        <CourseBlock
          v-for="item in group"
          :key="'g-' + item.course.id"
          :style="{ flexGrow: getGrow(item.course.id), flexBasis: '0%' }"
          :collapsed="getGrow(item.course.id) < Math.max(...group.map((c) => getGrow(c.course.id))) - 0.01"
          :course="item.course"
          @mouseenter="handleHoverEnter(item.course.id)"
          @open="(c) => emit('open', c)"
        />
      </div>
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
  grid-template-columns: 1fr;
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

/* 冲突课程组：flex 分栏容器（1/3 与 2/3 动态分配，hover 展开） */
.overlap {
  display: flex;
  align-items: stretch;
  min-width: 0;
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
