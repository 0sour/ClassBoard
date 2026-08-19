<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import WeekNav from '@/components/schedule/WeekNav.vue'
import WeekGrid from '@/components/schedule/WeekGrid.vue'
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
// 移动端双日视图：dayOffset = 相对今天的天数偏移（0=今天）
// 默认显示今天+明天；周日只显示当天（「此周最后一天除外」）
// ============================================================
const dayOffset = ref(0)

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 移动端判定（<768px 与全局断点一致） */
const isMobile = ref(window.innerWidth < 768)

function onResize(): void {
  isMobile.value = window.innerWidth < 768
}

window.addEventListener('resize', onResize)
/** 双日视图日期列表（仅移动端使用） */
const mobileDays = computed<Date[]>(() => {
  const base = new Date(store.today)
  base.setDate(base.getDate() + dayOffset.value)
  const next = new Date(base)
  next.setDate(next.getDate() + 1)
  // 周日只显示当天（跨周时明天属于下一周，不显示）
  if (base.getDay() === 0) return [base]
  return [base, next]
})

/** 双日标题：「周三 8/19 · 周四 8/20」 */
const mobileTitle = computed(() =>
  mobileDays.value.map((d) => `${DAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1]} ${d.getMonth() + 1}/${d.getDate()}`).join(' · '),
)

/** 滑动方向（驱动双日视图切换动画） */
const slideDir = ref<'next' | 'prev'>('next')
/** 动画锁：切换动画进行中忽略新滑动，避免连续滑动动画叠加导致闪现 */
const sliding = ref(false)

function onSwipe(dir: 'next' | 'prev'): void {
  if (sliding.value) return
  // 记录滑动方向，驱动 Transition 水平滑入/滑出动画
  slideDir.value = dir
  dayOffset.value += dir === 'next' ? 1 : -1
  sliding.value = true
  window.setTimeout(() => {
    sliding.value = false
  }, 260)
}

function goToday(): void {
  if (dayOffset.value === 0) return
  slideDir.value = dayOffset.value > 0 ? 'next' : 'prev'
  dayOffset.value = 0
}

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
        <!-- 桌面/平板：周导航；移动端：双日标题条（滑动切日） -->
        <WeekNav v-if="!isMobile" class="reveal" />
        <div v-else class="days-head reveal">
          <span class="days-title num">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
            {{ mobileTitle }}
          </span>
          <button class="days-today" type="button" @click="goToday">今天</button>
        </div>

        <section class="schedule-card reveal">
          <div class="sched-scroll">
            <!-- 周数据拉取中显示网格骨架（UI 4.4） -->
            <Skeleton v-if="store.remote && !store.weekContext" variant="grid" />
            <!-- 移动端双日视图：推入式滑动——默认 mode 新旧同时动画，
                 enter 元素绝对定位覆盖在旧页上方滑入，旧页原位滑出，视觉连续无闪烁 -->
            <Transition v-else-if="isMobile" :name="slideDir === 'next' ? 'slide-next' : 'slide-prev'">
              <WeekGrid
                :key="dayOffset"
                :days="mobileDays"
                @open="openCourse"
                @create="createFromSlot"
                @swipe="onSwipe"
              />
            </Transition>
            <WeekGrid
              v-else
              :days="undefined"
              @open="openCourse"
              @create="createFromSlot"
              @swipe="onSwipe"
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

/* 移动端双日视图标题条：日期标题 + 今天按钮（替代周导航） */
.days-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin: var(--spacing-lg) 0;
}

.days-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.days-title svg {
  width: 18px;
  height: 18px;
  color: var(--color-brand);
  flex: none;
}

.days-today {
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

.days-today:hover {
  background: var(--color-brand-hover);
}

/* 双日视图推入式滑动动画（默认 mode：新旧同时动画）：
   enter 元素绝对定位覆盖在旧页上方，从侧边 100% 滑入；
   leave 元素原位向左/右 100% 滑出。视觉连续无闪烁。
   左滑（next）：新页从右滑入、旧页向左滑出；
   右滑（prev）：新页从左滑入、旧页向右滑出。 */
.slide-next-enter-active,
.slide-next-leave-active,
.slide-prev-enter-active,
.slide-prev-leave-active {
  transition: transform var(--motion-duration-slow) var(--motion-easing-standard);
}

.slide-next-enter-active {
  position: absolute;
  inset: 0;
  width: 100%;
  z-index: 1;
}

.slide-next-enter-from {
  transform: translateX(100%);
}

.slide-next-leave-to {
  transform: translateX(-100%);
}

.slide-prev-enter-active {
  position: absolute;
  inset: 0;
  width: 100%;
  z-index: 1;
}

.slide-prev-enter-from {
  transform: translateX(-100%);
}

.slide-prev-leave-to {
  transform: translateX(100%);
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
