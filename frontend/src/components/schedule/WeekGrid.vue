<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import CourseBlock from './CourseBlock.vue'
import { computeOverlapGroups, isOverlap } from '@/utils/course'
import { calcWeekNumber, parseDate } from '@/utils/week'
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

/** 冲突课程按重叠关系分组成连通分量：每组渲染为一个 flex 分栏容器
 * computed 缓存：仅随 columns 变化重算，避免模板每次渲染重复计算 */
const conflictGroups = computed(() => {
  return columns.value.map((col) => {
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
  })
})

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  cancelAnimationFrame(animRaf)
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('keydown', onWindowKeyDown)
  if (longPressTimer !== null) window.clearTimeout(longPressTimer)
})

// ============================================================
// 长按拖拽调课：按下 ~400ms 不移动进入拖动模式，松手落格
// 保持原跨节宽度，允许与已有课程重叠（沿用冲突分栏约定）
// ============================================================
const gridEl = ref<HTMLElement | null>(null)
const draggingCourse = ref<Course | null>(null)
const dragSource = ref<{ startPeriod: number; endPeriod: number } | null>(null)
const dragPos = ref<{ x: number; y: number } | null>(null)
const dragTarget = ref<{ weekday: Weekday; startPeriod: number; endPeriod: number } | null>(null)
const suppressClickUntil = ref(0)

/** 目标格在 grid 内的绝对定位框（高亮预览） */
const targetBox = computed(() => {
  const t = dragTarget.value
  const grid = gridEl.value
  if (!t || !grid) return null
  const dayCols = Array.from(grid.querySelectorAll('.day-col'))
  const col = dayCols[t.weekday - 1]
  if (!col) return null
  const gridRect = grid.getBoundingClientRect()
  const colRect = col.getBoundingClientRect()
  const rowH = getRowHeight()
  const span = t.endPeriod - t.startPeriod + 1
  return {
    left: colRect.left - gridRect.left + 3,
    width: colRect.width - 6,
    top: HEADER_H + (t.startPeriod - 1) * rowH,
    height: span * rowH,
  }
})

let longPressTimer: number | null = null
let dragAnchor = { x: 0, y: 0, active: false }
let dragMoved = false

const LONG_PRESS_MS = 400
const MOVE_THRESHOLD_PX = 8
const HEADER_H = 44 // day-head 高度（网格首行）

/** 课程卡 pointerdown：启动长按计时，进入潜在拖拽 */
function onCoursePointerDown(course: Course, e: PointerEvent): void {
  if (course.unscheduled) return
  dragAnchor = { x: e.clientX, y: e.clientY, active: true }
  suppressClickUntil.value = 0
  if (longPressTimer !== null) window.clearTimeout(longPressTimer)
  longPressTimer = window.setTimeout(() => beginDrag(course), LONG_PRESS_MS)
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('keydown', onWindowKeyDown)
}

/** 长按达成：进入拖拽模式（原卡半透明占位 + 幽灵卡跟随） */
function beginDrag(course: Course): void {
  if (!dragAnchor.active) return
  draggingCourse.value = course
  dragSource.value = { startPeriod: course.startPeriod, endPeriod: course.endPeriod }
  dragPos.value = { x: dragAnchor.x, y: dragAnchor.y }
  dragTarget.value = {
    weekday: course.weekday,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod,
  }
  dragMoved = false
  suppressClickUntil.value = Date.now() + 300
}

function onWindowPointerMove(e: PointerEvent): void {
  if (!dragAnchor.active) return
  const dx = e.clientX - dragAnchor.x
  const dy = e.clientY - dragAnchor.y
  // 未进入长按前移动超阈值：取消长按（视为点击/滚动）
  if (!draggingCourse.value && longPressTimer !== null && Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
    window.clearTimeout(longPressTimer)
    longPressTimer = null
    dragAnchor.active = false
    cleanupDrag()
    return
  }
  if (!draggingCourse.value) return
  dragMoved = true
  dragPos.value = { x: e.clientX, y: e.clientY }
  dragTarget.value = findTargetCell(e.clientX, e.clientY)
}

function onWindowPointerUp(): void {
  const course = draggingCourse.value
  const target = dragTarget.value
  // 长按后原地松手（无移动）视为误触，不落库
  const didMove = dragMoved
  cleanupDrag()
  if (course && target && didMove) {
    void applyDrag(course, target)
  }
}

function onWindowKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') cleanupDrag()
}

/** 结束拖拽：清 ghost/目标，恢复原卡 */
function cleanupDrag(): void {
  draggingCourse.value = null
  dragSource.value = null
  dragPos.value = null
  dragTarget.value = null
  dragAnchor.active = false
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer)
    longPressTimer = null
  }
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('keydown', onWindowKeyDown)
}

/** 指针坐标 → 目标格子（保持跨节宽度，clamp 1..12） */
function findTargetCell(clientX: number, clientY: number): { weekday: Weekday; startPeriod: number; endPeriod: number } | null {
  const grid = gridEl.value
  if (!grid) return null
  const dayCols = Array.from(grid.querySelectorAll('.day-col'))
  let weekday: Weekday | null = null
  for (let i = 0; i < dayCols.length; i++) {
    const r = dayCols[i].getBoundingClientRect()
    if (clientX >= r.left && clientX < r.right) {
      weekday = (i + 1) as Weekday
      break
    }
  }
  if (weekday === null || !dragSource.value) return null
  const gridRect = grid.getBoundingClientRect()
  const relY = clientY - gridRect.top
  const rowH = getRowHeight()
  const startPeriod = Math.min(12, Math.max(1, Math.floor((relY - HEADER_H) / rowH) + 1))
  const span = dragSource.value.endPeriod - dragSource.value.startPeriod + 1
  let end = startPeriod + span - 1
  let start = startPeriod
  if (end > 12) {
    start = 12 - span + 1
    end = 12
  }
  return { weekday, startPeriod: start, endPeriod: end }
}

/** 实测行高（像素），回退 52 */
function getRowHeight(): number {
  const cell = gridEl.value?.querySelector('.time-cell')
  if (cell) {
    const h = cell.getBoundingClientRect().height
    if (h > 0) return h
  }
  return 52
}

/** 点击课程：拖拽刚落格后 300ms 内抑制 click（避免误开详情） */
function handleOpen(course: Course): void {
  if (Date.now() < suppressClickUntil.value) return
  emit('open', course)
}

/** 学期总周数（节次模板编辑器同款逻辑；上限 30 与服务端校验一致） */
const MAX_WEEKS = 30
const maxWeeks = computed(() => {
  const sem = store.currentSemester
  if (!sem) return 16
  return Math.min(calcWeekNumber(parseDate(sem.endDate), sem) ?? 16, MAX_WEEKS)
})

/** 生成「除某周外的保留周」：按原课周规则决定哪些周保留原位置 */
function restWeeksOf(course: Course, exclude: number): number[] {
  const total = maxWeeks.value
  const isOdd = (w: number): boolean => w % 2 === 1
  const all = Array.from({ length: total }, (_, i) => i + 1)
  switch (course.weekType) {
    case 'all':
      return all.filter((w) => w !== exclude)
    case 'odd':
      return all.filter((w) => w !== exclude && isOdd(w))
    case 'even':
      return all.filter((w) => w !== exclude && !isOdd(w))
    case 'custom':
      return (course.weekList ?? []).filter((w) => w !== exclude)
  }
}

/** 落库：仅调整当周（单周例外）——原课缩小周范围保持原位置，新增本周新位置副本 */
async function applyDrag(course: Course, target: { weekday: Weekday; startPeriod: number; endPeriod: number }): Promise<void> {
  const weekNo = store.weekNumber
  const slot = target.endPeriod > target.startPeriod ? `第 ${target.startPeriod}–${target.endPeriod} 节` : `第 ${target.startPeriod} 节`
  const base = {
    type: course.type,
    name: course.name,
    teacher: course.teacher,
    location: course.location,
    color: course.color,
    weekType: course.weekType,
    weekList: course.weekList,
    remark: course.remark,
  }
  let step = '准备调整'
  try {
    if (!Number.isInteger(target.weekday) || !Number.isInteger(target.startPeriod) || !Number.isInteger(target.endPeriod)) {
      throw new Error('目标节次无效，请重新拖到课表格内')
    }
    // 无周号（假期等）时退回全局调整
    if (weekNo === null) {
      step = '更新课程'
      await store.updateCourse(course.id, {
        ...base,
        weekday: target.weekday,
        startPeriod: target.startPeriod,
        endPeriod: target.endPeriod,
      })
      void import('@/utils/ui').then(({ toast }) => toast(`已调整至 ${DAY_LABELS[target.weekday - 1]} ${slot}`, 'success'))
      return
    }
    const rest = restWeeksOf(course, weekNo)
    // 课程仅出现在本周：直接改时间（原位置被覆盖）
    if (rest.length === 0) {
      step = '更新本周课程'
      await store.updateCourse(course.id, {
        ...base,
        weekType: 'custom',
        weekList: [weekNo],
        weekday: target.weekday,
        startPeriod: target.startPeriod,
        endPeriod: target.endPeriod,
      })
      void import('@/utils/ui').then(({ toast }) => toast(`已调整至 ${DAY_LABELS[target.weekday - 1]} ${slot}`, 'success'))
      return
    }
    // 单周例外：原课保留「除本周外」的周在原位置；新增本周新位置副本
    step = '保留其他周课程'
    await store.updateCourse(course.id, {
      ...base,
      weekday: course.weekday,
      startPeriod: course.startPeriod,
      endPeriod: course.endPeriod,
      weekType: 'custom',
      weekList: rest,
    })
    step = '创建本周课程'
    await store.addCourse({
      type: course.type,
      name: course.name,
      teacher: course.teacher,
      location: course.location,
      weekType: 'custom',
      weekList: [weekNo],
      weekday: target.weekday,
      startPeriod: target.startPeriod,
      endPeriod: target.endPeriod,
      remark: course.remark,
    })
    void import('@/utils/ui').then(({ toast }) => toast(`本周已调整至 ${DAY_LABELS[target.weekday - 1]} ${slot}，其余周不变`, 'success'))
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.error('[WeekGrid] 调整课程失败', { step, courseId: course.id, target, error })
    void import('@/utils/ui').then(({ toast }) => toast(`${step}失败：${message}`, 'error'))
  }
}

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
  <div ref="gridEl" class="weekgrid" :class="{ 'is-dragging': draggingCourse }" :style="rowHeight ? { '--ph-row-dyn': rowHeight + 'px' } : undefined">
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
      v-for="(_, idx) in columns"
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
        :dragging="draggingCourse?.id === item.course.id"
        @pointerdown="(e: PointerEvent) => onCoursePointerDown(item.course, e)"
        @open="handleOpen"
      />

      <!-- 冲突课程组：flex 分栏，hover 展开 2/3（1/3 只显示名称） -->
      <div
        v-for="(group, gi) in conflictGroups[idx]"
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
          :dragging="draggingCourse?.id === item.course.id"
          @pointerdown="(e: PointerEvent) => onCoursePointerDown(item.course, e)"
          @mouseenter="handleHoverEnter(item.course.id)"
          @open="handleOpen"
        />
      </div>
    </div>

    <!-- 拖拽目标格高亮框（weekday/节次换算后绝对定位） -->
    <div
      v-if="targetBox"
      class="drag-target-overlay"
      :style="{ left: targetBox.left + 'px', top: targetBox.top + 'px', width: targetBox.width + 'px', height: targetBox.height + 'px' }"
    ></div>

    <!-- 拖拽幽灵卡（body 顶层，跟手半透明） -->
    <Teleport to="body">
      <div
        v-if="draggingCourse && dragPos"
        class="course-ghost"
        :style="{ left: dragPos.x + 'px', top: dragPos.y + 'px' }"
      >
        <span class="ghost-name">{{ draggingCourse.name }}</span>
        <span class="ghost-slot" v-if="dragTarget">
          {{ DAY_LABELS[dragTarget.weekday - 1] }} ·
          {{ dragTarget.endPeriod > dragTarget.startPeriod ? `第 ${dragTarget.startPeriod}–${dragTarget.endPeriod} 节` : `第 ${dragTarget.startPeriod} 节` }}
        </span>
      </div>
    </Teleport>
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
  position: relative;
}

/* 拖拽目标格高亮（绝对定位覆盖预览） */
.drag-target-overlay {
  position: absolute;
  border: 2px dashed var(--color-brand);
  border-radius: var(--radius-sm);
  background: var(--color-brand-subtle);
  opacity: 0.55;
  pointer-events: none;
  z-index: var(--z-index-sticky);
}

/* 拖拽幽灵卡（body 顶层，不随滚动位移的问题由 fixed 定位规避） */
.course-ghost {
  position: fixed;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 180px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  opacity: 0.92;
  pointer-events: none;
  z-index: var(--z-index-modal);
}

.ghost-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ghost-slot {
  font-size: var(--font-size-xs);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

/* 拖动进行中：宿主网格滚动条期间保持滚动可用，卡片 hover 阴影收敛 */
.weekgrid.is-dragging .course,
.weekgrid.is-dragging .slot {
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
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
