<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import WeekNav from '@/components/schedule/WeekNav.vue'
import WeekGrid from '@/components/schedule/WeekGrid.vue'
import WeekPicker from '@/components/schedule/WeekPicker.vue'
import SidePanel from '@/components/schedule/SidePanel.vue'
import CourseModal from '@/components/schedule/CourseModal.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import { exportElementAsPng } from '@/utils/exportPng'
import { toast } from '@/utils/ui'
import type { Course, Weekday } from '@/types'

const store = useScheduleStore()
const router = useRouter()

const selected = ref<Course | null>(null)
const editing = ref<Course | null>(null)
const showEditor = ref(false)
const exporting = ref(false)

/** 空白格快捷新增：预填星期与节次 */
const createSlot = ref<{ weekday: Weekday; period: number } | null>(null)

// ============================================================
// 移动端单日视图：一次显示一天课程列表 + 顶部 7 格轮盘
// 数据流：唯一状态 wheelCenter → 派生轮盘 7 格 + 标题 + 课程列表
// ============================================================
const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const WEEKDAY_NUM = ['一', '二', '三', '四', '五', '六', '日'] as const
/** 列表动画方向（切日时按新旧日期先后决定滑入方向） */
const wheelDir = ref<'next' | 'prev'>('next')

/** 移动端判定（<768px 与全局断点一致） */
const isMobile = ref(window.innerWidth < 768)

function onResize(): void {
  isMobile.value = window.innerWidth < 768
  // 轮盘为原生滚动布局，窗口变化无需重算
}

window.addEventListener('resize', onResize)

/** 两个日期是否为同一天 */
function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// ============================================================
// 轮盘式日期选择（固定序列 + 原生滚动，滚动停在哪就在哪）
// 序列以今天为中心固定 ±100 天（201 格），永不重建、永无回滚。
// scroll 事件实时读 scrollLeft → 中央格索引 → 更新选中日期。
// 点击格/今天按钮 → scrollTo 平滑滚动，滚动过程日期实时跟随。
// ============================================================
const WHEEL_ITEM_W = 56 // 格宽（CSS 固定）
const WHEEL_CENTER = 100 // 今天所在格索引（201 格：0..200）
const WHEEL_SPAN = 100 // 单侧天数
const wheelRef = ref<HTMLElement | null>(null)
/** 当前中央格索引（scroll 实时更新） */
const wheelIdx = ref(WHEEL_CENTER)
const wheelDragging = ref(false)
let wheelScrollRaf = 0
/** 自动回正定时器（滚动停止 300ms 后吸附） */
let wheelSettleTimer: number | null = null
/** 吸附中标志（避免 settle 引发的 scroll 再调度自己） */
let wheelSettling = false

/** 归零时分秒，避免日期比较误判 */
function normalizeDay(d: Date): Date {
  const nd = new Date(d)
  nd.setHours(0, 0, 0, 0)
  return nd
}

/** 固定日期序列（以今天为中心 ±100 天，永不重建） */
const wheelDates = computed(() => {
  const list: { date: Date; wd: string }[] = []
  const today = normalizeDay(new Date(store.today))
  for (let i = -WHEEL_SPAN; i <= WHEEL_SPAN; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    list.push({ date: d, wd: WEEKDAY_NUM[(d.getDay() + 6) % 7] })
  }
  return list
})

/** 当前选中日期（中央格）——标题与课程列表的唯一来源 */
const activeDay = computed(() => {
  const item = wheelDates.value[wheelIdx.value]
  return item ? item.date : normalizeDay(new Date(store.today))
})

/** 单日标题：「周三 · 8月26日」 */
const dayTitle = computed(() => {
  const d = activeDay.value
  return `${DAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1]} · ${d.getMonth() + 1}月${d.getDate()}日`
})

/** 当前展示日的课程（按节次排序） */
const dayCourses = computed(() => {
  const list = store.coursesOfDate(activeDay.value)
  return [...list].sort((a, b) => a.startPeriod - b.startPeriod)
})

/** 节次时间（按节次模板） */
function periodTime(period: number): string {
  const p = store.periods[period - 1]
  return p ? `${p.startTime}–${p.endTime}` : ''
}

/** 滚动事件（rAF 节流）：中央格索引实时跟随，日期/标题/列表同步刷新；
 *  同时调度「停止后自动回正」定时器（兼容不支持 scrollend 的环境） */
function onWheelScroll(): void {
  if (wheelSettling) return
  cancelAnimationFrame(wheelScrollRaf)
  if (wheelSettleTimer !== null) window.clearTimeout(wheelSettleTimer)
  wheelSettleTimer = window.setTimeout(() => {
    wheelSettleTimer = null
    settleAlign()
  }, 300)
  wheelScrollRaf = requestAnimationFrame(() => {
    const view = wheelRef.value
    if (!view) return
    const idx = Math.round(view.scrollLeft / WHEEL_ITEM_W)
    const clamped = Math.min(wheelDates.value.length - 1, Math.max(0, idx))
    if (clamped !== wheelIdx.value) {
      const prev = wheelDates.value[wheelIdx.value]?.date
      const next = wheelDates.value[clamped]?.date
      if (prev && next && next.getTime() !== prev.getTime()) {
        wheelDir.value = next.getTime() > prev.getTime() ? 'next' : 'prev'
      }
      wheelIdx.value = clamped
    }
  })
}

/** 指针按下 */
function onWheelDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  wheelDragging.value = true
  // 拖动中取消自动回正调度
  if (wheelSettleTimer !== null) {
    window.clearTimeout(wheelSettleTimer)
    wheelSettleTimer = null
  }
}

/** 指针松开：吸附到最近整格（对齐格子，避免停在两格之间） */
function onWheelUp(): void {
  wheelDragging.value = false
  settleAlign()
}

function onWheelCancel(): void {
  wheelDragging.value = false
}

/** 吸附到最近整格（scrollTo 平滑），让格子始终对齐指示器正中 */
function settleAlign(): void {
  const view = wheelRef.value
  if (!view) return
  const idx = Math.round(view.scrollLeft / WHEEL_ITEM_W)
  const target = idx * WHEEL_ITEM_W
  if (Math.abs(view.scrollLeft - target) > 1.5) {
    wheelSettling = true
    view.scrollTo({ left: target, behavior: 'smooth' })
    // 平滑滚动结束后再校验一次（防滚动回调未触发）
    if (wheelSettleTimer !== null) window.clearTimeout(wheelSettleTimer)
    wheelSettleTimer = window.setTimeout(() => {
      wheelSettleTimer = null
      wheelSettling = false
      const now = view.scrollLeft
      const cur = Math.round(now / WHEEL_ITEM_W)
      if (Math.abs(now - cur * WHEEL_ITEM_W) > 1.5) {
        settleAlign()
      } else {
        // 最终对齐后同步选中索引
        const clamped = Math.min(wheelDates.value.length - 1, Math.max(0, cur))
        if (clamped !== wheelIdx.value) wheelIdx.value = clamped
      }
    }, 420)
  }
}

/** 点击格子：平滑滚动到该格（滚动过程日期实时跟随，停止后对齐） */
function onWheelPick(i: number): void {
  if (i === wheelIdx.value) return
  const view = wheelRef.value
  if (!view) return
  view.scrollTo({ left: i * WHEEL_ITEM_W, behavior: 'smooth' })
}

/** 回到今天：平滑滚到今天所在格 */
function goToday(): void {
  const view = wheelRef.value
  if (!view) return
  view.scrollTo({ left: WHEEL_CENTER * WHEEL_ITEM_W, behavior: 'smooth' })
}

/** 移动端轮盘初始化：今天居中 */
onMounted(() => {
  if (!isMobile.value) return
  void nextTick(() => {
    const view = wheelRef.value
    if (view) {
      view.scrollLeft = WHEEL_CENTER * WHEEL_ITEM_W
      wheelIdx.value = WHEEL_CENTER
    }
  })
})

onBeforeUnmount(() => {
  cancelAnimationFrame(wheelScrollRaf)
  window.removeEventListener('resize', onResize)
})

function openCourse(course: Course): void {
  selected.value = course
}

/** 打开事项页并导航到对应作业 tab */
function openHomework(h: { id: number; name: string; courseId?: number | null }): void {
  router.push({ name: 'matters', query: { tab: 'homework', hwId: h.id } })
}

function closeModal(): void {
  selected.value = null
}

function editCourse(course: Course): void {
  selected.value = null
  editing.value = course
  showEditor.value = true
}

function createFromSlot(slot: { weekday: Weekday; period: number }): void {
  selected.value = null
  editing.value = null
  createSlot.value = slot
  showEditor.value = true
}

function printWeek(): void {
  window.print()
}

async function exportPng(): Promise<void> {
  const grid = document.querySelector('.week-grid')
  if (!grid || !(grid instanceof HTMLElement)) {
    toast('未找到课表网格', 'error')
    return
  }
  exporting.value = true
  try {
    const date = new Date().toISOString().slice(0, 10)
    await exportElementAsPng(grid, `classboard-week-${date}.png`)
    toast('课表已导出为 PNG', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败，请重试', 'error')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="page week-view">
    <div class="week-layout">
      <!-- 主区：周导航与课表同宽对齐 -->
      <div class="week-main">
        <!-- 桌面/平板：周导航；移动端：单日视图（日期标题 + 周缩略条 + 课程列表） -->
        <WeekNav v-if="!isMobile" class="reveal" />
        <div v-else class="day-view-m">
          <div class="dv-head reveal">
            <!-- 周标题：点击弹出周选择器 + 单双周徽章 -->
            <WeekPicker :current-week="store.weekNumber" @select="store.goToWeek">
              <span class="dv-title num">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
                {{ dayTitle }}
                <span v-if="store.weekNumber !== null" class="dv-week-badge num">{{ store.weekNumber }}周·{{ store.isOdd ? '单' : '双' }}</span>
              </span>
            </WeekPicker>
            <button class="dv-today" type="button" @click="goToday">今天</button>
          </div>

          <!-- 轮盘式日期选择：原生横向滚动；指示器固定在容器（不滚动） -->
          <div class="dv-wheel-wrap reveal">
            <!-- 常驻选中指示器：固定在 wrap（滚动容器外），轨道从框内流过 -->
            <div class="dv-wheel__indicator"></div>
            <div
              ref="wheelRef"
              class="dv-wheel"
              :class="{ 'is-dragging': wheelDragging }"
              @scroll.passive="onWheelScroll"
              @pointerdown="onWheelDown"
              @pointerup="onWheelUp"
              @pointercancel="onWheelCancel"
            >
              <div class="dv-wheel__track">
                <button
                  v-for="(d, i) in wheelDates"
                  :key="i"
                  class="dv-wheel__day"
                  :class="{
                    active: isSameDate(d.date, activeDay),
                    today: isSameDate(d.date, store.today),
                  }"
                  type="button"
                  @click="onWheelPick(i)"
                >
                  <span>{{ d.wd }}</span>
                  <b>{{ d.date.getDate() }}</b>
                </button>
              </div>
            </div>
          </div>

          <!-- 单日课程列表（全宽卡片；切日时按方向滑入/滑出动画，拖动中不播） -->
          <div class="dv-list reveal">
            <Transition
              :name="wheelDir === 'next' ? 'dv-next' : 'dv-prev'"
              mode="out-in"
              :duration="200"
            >
              <div :key="activeDay.getTime()" class="dv-list__inner">
                <button
                  v-for="c in dayCourses"
                  :key="c.id"
                  class="dv-card"
                  type="button"
                  @click="openCourse(c)"
                >
                  <span class="dv-dot-color" :style="{ background: `var(--${c.color}-text)` }"></span>
                  <span class="dv-time num">{{ periodTime(c.startPeriod).split('–')[0] }}<small>–{{ periodTime(c.endPeriod).split('–')[1] }}</small></span>
                  <span class="dv-main">
                    <span class="dv-name">{{ c.name }}</span>
                    <span class="dv-loc">{{ c.location }} · {{ c.teacher }}</span>
                  </span>
                  <span class="dv-slot num">第 {{ c.startPeriod }}{{ c.endPeriod > c.startPeriod ? `–${c.endPeriod}` : '' }} 节</span>
                </button>
                <div v-if="dayCourses.length === 0" class="dv-empty">
                  这一天没有排课
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- 桌面/平板：周课表网格（移动端由上方单日列表替代） -->
        <section v-if="!isMobile" class="schedule-card reveal">
          <div class="sched-scroll">
            <!-- 周数据拉取中显示网格骨架（UI 4.4） -->
            <Skeleton v-if="store.remote && !store.weekContext" variant="grid" />
            <WeekGrid
              v-else
              :days="undefined"
              @open="openCourse"
              @create="createFromSlot"
            />
          </div>
        </section>

        <!-- 课表底部操作条：打印 / 导出 PNG（UI 设计文档 4.7，操作对象仅限课表网格） -->
        <div class="card-foot">
          <div class="week-actions">
            <button class="act-btn" type="button" @click="printWeek">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect width="12" height="8" x="6" y="14" rx="1" /></svg>
              打印
            </button>
            <button class="act-btn" type="button" :disabled="exporting" @click="exportPng">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>
              {{ exporting ? '导出中…' : '导出 PNG' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 信息面板（桌面右侧 / 平板下方两列） -->
      <SidePanel @open-course="openCourse" @open-homework="openHomework" />
    </div>

    <CourseModal :course="selected" @close="closeModal" @edit="editCourse" />
    <CourseEditor
      :open="showEditor"
      :course="editing"
      :preset-weekday="createSlot?.weekday"
      :preset-period="createSlot?.period"
      @close="showEditor = false; createSlot = null"
      @done="showEditor = false; createSlot = null"
    />
  </div>
</template>

<style scoped>
.page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 var(--spacing-lg) var(--spacing-xl);
}

.week-layout {
  display: block;
}

.week-main {
  min-width: 0;
}

/* ============ 移动端单日视图（方案 B） ============ */
.day-view-m {
  margin: var(--spacing-lg) 0;
}

.dv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.dv-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.dv-title svg {
  width: 18px;
  height: 18px;
  color: var(--color-brand);
  flex: none;
}

/* 移动端周徽章：「第 N 周 · 单/双」 */
.dv-week-badge {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  border-radius: var(--radius-full);
  padding: 2px 8px;
  white-space: nowrap;
}

.dv-today {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 var(--spacing-md);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-brand);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-inverse);
  box-shadow: var(--shadow-btn);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.dv-today:hover {
  background: var(--color-brand-hover);
}

/* ============ 轮盘式日期选择 ============ */
.dv-wheel-wrap {
  position: relative;
  margin-bottom: var(--spacing-lg);
  padding: 4px 0;
}

/* 窗口：原生横向滚动容器；吸附由 JS snapAndSettle 负责（不开 scroll-snap，
   避免浏览器与 JS 双重吸附打架导致回弹） */
.dv-wheel {
  position: relative;
  height: 52px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  user-select: none;
  -webkit-user-select: none;
}

.dv-wheel::-webkit-scrollbar {
  display: none;
}

.dv-wheel.is-dragging {
  cursor: grabbing;
}

/* 轨道：flex 一排，格子带两侧 padding 使首尾也能滚到中央 */
.dv-wheel__track {
  display: flex;
  height: 100%;
  padding: 0 calc(50% - 28px);
}

.dv-wheel__day {
  flex: 0 0 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  border-radius: var(--radius-lg);
  background: none;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text-secondary);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.dv-wheel__day span {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.dv-wheel__day b {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}

/* 今天：品牌色 */
.dv-wheel__day.today b {
  color: var(--color-brand);
  font-weight: var(--font-weight-bold);
}

/* 选中格：仅文字品牌色（高亮框由固定指示器提供，格子本身不亮，
   拖动时不会出现"高亮跟着格子跑"的错位感） */
.dv-wheel__day.active b,
.dv-wheel__day.active span {
  color: var(--color-brand);
  font-weight: var(--font-weight-bold);
}

/* 常驻选中指示器：固定在 wrap（滚动容器外），对准滚动容器视口中央 */
.dv-wheel__indicator {
  position: absolute;
  left: 50%;
  top: 4px; /* 对齐 .dv-wheel 滚动容器（wrap 上下 padding 4px） */
  transform: translateX(-50%);
  width: 56px;
  height: 52px;
  border: 1.5px solid var(--color-brand);
  border-radius: var(--radius-lg);
  background: transparent;
  pointer-events: none;
  z-index: 2;
}

/* 单日课程列表：全宽卡片 */
.dv-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

/* 切日动画：旧列表淡出+位移，新列表按方向滑入（200ms，ease-out） */
.dv-list__inner {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.dv-next-enter-active,
.dv-next-leave-active,
.dv-prev-enter-active,
.dv-prev-leave-active {
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

/* 左滑（下一日）：新列表从右滑入 */
.dv-next-enter-from {
  opacity: 0;
  transform: translateX(28px);
}

.dv-next-leave-to {
  opacity: 0;
  transform: translateX(-28px);
}

/* 右滑（上一日）：新列表从左滑入 */
.dv-prev-enter-from {
  opacity: 0;
  transform: translateX(-28px);
}

.dv-prev-leave-to {
  opacity: 0;
  transform: translateX(28px);
}

.dv-card {
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

.dv-card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}

.dv-dot-color {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-sm);
  flex: none;
}

.dv-time {
  min-width: 88px;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  line-height: 1.2;
  flex: none;
}

.dv-time small {
  display: block;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
  color: var(--color-text-tertiary);
}

.dv-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dv-name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dv-loc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 2px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dv-slot {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  flex: none;
}

.dv-empty {
  padding: var(--spacing-2xl);
  text-align: center;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-sm);
}

/* 打印 / 导出操作条（文档 4.7：操作对象仅限课表网格） */
.week-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-sm);
}

.act-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.act-btn:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-hover);
}

.act-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.act-btn svg {
  width: 14px;
  height: 14px;
}

/* 打印：仅输出课表网格 + 周导航条（A4 横向），隐藏应用外壳 */
@media print {
  :global(.topbar),
  :global(.tabbar),
  :global(.side-panel),
  .card-foot {
    display: none !important;
  }

  .page {
    max-width: none;
    padding: 0;
  }

  .week-main {
    width: 100%;
  }

  .sched-scroll {
    overflow: visible;
  }

  @page {
    size: A4 landscape;
    margin: 12mm;
  }
}

.schedule-card {
  background: transparent;
}

/* 课表底部操作条（原卡片头部移至此）：打印/导出右对齐 */
.card-foot {
  display: flex;
  justify-content: flex-end;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-top: none;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

/* 打印 / 导出操作条（文档 4.7：操作对象仅限课表网格） */
.week-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.sched-scroll {
  /* position: relative：滑动动画 enter 元素（absolute inset:0）以此为定位包含块，
     否则相对视口定位导致布局错乱（只显示左半边/缩放感） */
  position: relative;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.sched-scroll::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}

.sched-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-full);
}

.sched-scroll::-webkit-scrollbar-track {
  background: transparent;
}

@media (min-width: 1280px) {
  .week-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--side-panel-w);
    gap: var(--spacing-xl);
    align-items: start;
  }
}
</style>
