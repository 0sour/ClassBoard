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
import { toMonday } from '@/utils/week'
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
// 移动端单日视图（方案 B）：一次显示一天课程列表 + 顶部周缩略条
// dayOffset = 相对今天的天数偏移（0=今天）
// ============================================================
const dayOffset = ref(0)

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const WEEKDAY_NUM = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 移动端判定（<768px 与全局断点一致） */
const isMobile = ref(window.innerWidth < 768)

function onResize(): void {
  isMobile.value = window.innerWidth < 768
  // 移动端轮盘：窗口尺寸变化后重算格子宽与 padding，保持选中日居中
  if (isMobile.value) {
    syncWheelMetrics()
    const view = wheelRef.value
    if (view) view.scrollLeft = WHEEL_HALF * wheelItemW.value - wheelPad.value
  }
}

window.addEventListener('resize', onResize)

/** 当前展示日 */
const currentDay = computed(() => {
  const d = new Date(store.today)
  d.setDate(d.getDate() + dayOffset.value)
  return d
})

/** 单日标题：「周六 · 8月22日」 */
const dayTitle = computed(() => {
  const d = currentDay.value
  return `${DAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1]} · ${d.getMonth() + 1}月${d.getDate()}日`
})

/** 当前展示日的课程（按节次排序） */
const dayCourses = computed(() => {
  const list = store.coursesOfDate(currentDay.value)
  return [...list].sort((a, b) => a.startPeriod - b.startPeriod)
})

/** 节次时间（按节次模板） */
function periodTime(period: number): string {
  const p = store.periods[period - 1]
  return p ? `${p.startTime}–${p.endTime}` : ''
}

function goToday(): void {
  dayOffset.value = 0
  // 轮盘滑回今天（中间格）
  void scrollWheelToIndex(0)
}

/** 两个日期是否为同一天 */
function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// ============================================================
// 轮盘式日期选择：选中日恒居中，左右滑动切日，中间常驻指示器
// 序列以 centerDate 为中心 ±21 天；滑到边缘自动重建
// ============================================================
const WHEEL_HALF = 21 // 单侧天数
const wheelRef = ref<HTMLElement | null>(null)
const wheelCenter = ref(new Date(store.today))
const wheelPad = ref(0)
const wheelItemW = ref(64)

/** 轮盘日期序列（含左右哨兵） */
const wheelDates = computed(() => {
  const list: { date: Date; wd: string }[] = []
  for (let i = -WHEEL_HALF; i <= WHEEL_HALF; i++) {
    const d = new Date(wheelCenter.value)
    d.setDate(wheelCenter.value.getDate() + i)
    list.push({ date: d, wd: WEEKDAY_NUM[(d.getDay() + 6) % 7] })
  }
  return list
})

/** 计算视口 padding 与格子宽（让首尾格也能居中） */
function syncWheelMetrics(): void {
  const view = wheelRef.value
  if (!view) return
  const first = view.querySelector('.dv-wheel__day') as HTMLElement | null
  if (first) wheelItemW.value = first.offsetWidth || 64
  wheelPad.value = Math.max(0, (view.clientWidth - wheelItemW.value) / 2)
}

/** 初始定位到中心格（无动画） */
function initWheelScroll(): void {
  const view = wheelRef.value
  if (!view) return
  syncWheelMetrics()
  view.scrollLeft = WHEEL_HALF * wheelItemW.value - wheelPad.value
}

let wheelRaf = 0
let wheelTicking = false

/** 滚动中：中心格 → 更新展示日；滑到边缘重建序列 */
function onWheelScroll(): void {
  if (wheelTicking) return
  wheelTicking = true
  wheelRaf = requestAnimationFrame(() => {
    wheelTicking = false
    const view = wheelRef.value
    if (!view) return
    const idx = Math.round((view.scrollLeft + wheelPad.value) / wheelItemW.value)
    const item = wheelDates.value[idx]
    if (!item) return
    const ms = item.date.getTime() - toMonday(store.today).getTime()
    const off = Math.round(ms / 86400000)
    if (off !== dayOffset.value) dayOffset.value = off
    // 滑到边缘：以当前日为中心重建
    if (idx <= 4 || idx >= wheelDates.value.length - 5) {
      wheelCenter.value = new Date(item.date)
      initWheelScroll()
    }
  })
}

/** 滚动视口使第 i 格居中（点按 / 回到今天） */
function scrollWheelToIndex(i: number): void {
  const view = wheelRef.value
  if (!view) return
  view.scrollTo({
    left: i * wheelItemW.value - wheelPad.value,
    behavior: 'smooth',
  })
  // scroll 事件会同步 dayOffset
}

/** 移动端轮盘初始化（桌面无轮盘，仅移动端执行） */
onMounted(() => {
  if (!isMobile.value) return
  void nextTick(() => {
    initWheelScroll()
  })
})

onBeforeUnmount(() => {
  cancelAnimationFrame(wheelRaf)
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

          <!-- 轮盘式日期选择：选中日居中，左右滑动切日，中间常驻指示器 -->
          <div class="dv-wheel-wrap reveal">
            <div
              ref="wheelRef"
              class="dv-wheel"
              :style="{ '--wheel-pad': wheelPad + 'px' }"
              @scroll.passive="onWheelScroll"
            >
              <button
                v-for="(d, i) in wheelDates"
                :key="d.date.getTime()"
                class="dv-wheel__day"
                :class="{ active: isSameDate(d.date, currentDay), today: isSameDate(d.date, store.today) }"
                type="button"
                @click="scrollWheelToIndex(i)"
              >
                <span>{{ d.wd }}</span>
                <b>{{ d.date.getDate() }}</b>
              </button>
            </div>
            <!-- 常驻选中指示器 -->
            <div class="dv-wheel__indicator"></div>
          </div>

          <!-- 单日课程列表（全宽卡片，无截断） -->
          <div class="dv-list reveal">
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

/* 滚动容器：左右 padding 让首尾格也能居中 */
.dv-wheel {
  display: flex;
  overflow-x: auto;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: 0 var(--wheel-pad);
  scroll-snap-type: x mandatory;
}

.dv-wheel::-webkit-scrollbar {
  display: none;
}

.dv-wheel__day {
  flex: none;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 56px;
  padding: 7px 0 6px;
  border: none;
  border-radius: var(--radius-md);
  background: none;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text-secondary);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
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

/* 常驻选中指示器：固定中央胶囊底框 */
.dv-wheel__indicator {
  position: absolute;
  left: 50%;
  top: 4px;
  transform: translateX(-50%);
  width: 56px;
  height: 44px;
  border: 1.5px solid var(--color-brand);
  border-radius: var(--radius-lg);
  background: var(--color-brand-subtle);
  pointer-events: none;
  z-index: 1;
}

/* 选中格文字压在指示器上方 */
.dv-wheel__day {
  position: relative;
  z-index: 2;
}

.dv-wheel__day.active b,
.dv-wheel__day.active span {
  color: var(--color-brand);
  font-weight: var(--font-weight-bold);
}

/* 单日课程列表：全宽卡片 */
.dv-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
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
