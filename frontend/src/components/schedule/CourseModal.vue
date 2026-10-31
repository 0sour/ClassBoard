<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { confirm, toast } from '@/utils/ui'
import { periodsLabel, weeksLabel } from '@/utils/session'
import { adjustmentLabel, chainLabel, dateWithWeekdayLabel, explainAdjustment, monthDayLabel, movedFromLabel, weekdayOfDateStr, type AdjustmentChain } from '@/utils/calendar'
import { parseDate } from '@/utils/week'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import AdjustDetail from '@/components/schedule/AdjustDetail.vue'
import ChangeHistoryModal from '@/components/changes/ChangeHistoryModal.vue'
import MatterDetail from '@/components/matters/MatterDetail.vue'
import AdjustBadge from '@/components/schedule/AdjustBadge.vue'
import type { Course, CourseAdjustment, Exam, Homework, ResolvedBlock } from '@/types'

const props = defineProps<{
  courseId: number | null
  /** 从哪张卡片点进来的（块 + 所在日期）：时间行据此显示「本次」实际发生与调整说明 */
  occurrence?: { block: ResolvedBlock; date: string } | null
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'edit', course: Course): void }>()

const store = useScheduleStore()
const deleting = ref(false)

/** 课程组（由 id 从 store 取，始终反映最新数据） */
const course = computed<Course | null>(() =>
  props.courseId === null ? null : store.courses.find((c) => c.id === props.courseId) ?? null,
)

/** 关联记录 Tab（课程详情聚合该课程的考试/作业/调整） */
const tab = ref<'exam' | 'homework' | 'adjust'>('exam')

/** 关联记录 → 详情弹窗（图片内联 / 附件下载；负责人可上传） */
const detail = ref<{ kind: 'exam' | 'homework'; matter: Exam | Homework } | null>(null)

const examsOf = computed(() =>
  props.courseId === null ? [] : store.exams.filter((e) => e.courseId === props.courseId),
)

const homeworkOf = computed(() =>
  props.courseId === null ? [] : store.homework.filter((h) => h.courseId === props.courseId),
)

/** 该课程的调整记录（停课 / 调课 / 补课），可单条撤销 */
const adjustmentsOf = computed<CourseAdjustment[]>(() =>
  props.courseId === null
    ? []
    : store.adjustments
        .filter((a) => a.courseId === props.courseId)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)),
)

const style = computed(() => ({
  '--cbg': course.value ? `var(--${course.value.color}-bg)` : 'transparent',
  '--cline': course.value ? `var(--${course.value.color}-line)` : 'transparent',
  '--ctext': course.value ? `var(--${course.value.color}-text)` : 'transparent',
}))

const hasFixedTime = computed(() => (course.value?.sessions.length ?? 0) > 0)

/**
 * 点开的这一块如果被调整过（调休 / 调课 / 补课），时间行先列出「本次」实际发生；
 * 基准块本身就是固定时间，不重复。
 */
const occ = computed(() => {
  const o = props.occurrence
  if (!o || !o.block.source || o.block.source === 'base') return null
  const b = o.block
  // 链式调整给完整路径；调休日说明「补哪一天的课」；单步调课 / 补课沿用 movedFromLabel
  const note =
    b.chain && b.chain.length >= 2
      ? `调整路径：${chainLabel(b.chain, b.originDate ?? b.fromDate, b.fromPeriods)}`
      : b.source === 'shifted'
        ? `调休日 · 补 ${b.fromDate ? monthDayLabel(b.fromDate) : ''} 的课`
        : movedFromLabel(b)
  return {
    dateLabel: dateWithWeekdayLabel(o.date),
    periods: periodsLabel(b.periods),
    location: b.location,
    note,
  }
})

/** 详情页地点：点开的是调整后的一次课，就显示这一次的地点（固定地点仍在「固定时间」行） */
const detailLocation = computed(() => occ.value?.location || course.value?.location || '')

/** 各上课时间的文案行：周一 · 第 3–4 节 · 第 1–16 周 */
const sessionLines = computed(() => {
  const c = course.value
  if (!c) return []
  return c.sessions.map((s) => ({
    weekday: `周${'一二三四五六日'[s.weekday - 1]}`,
    periods: periodsLabel(s.periods),
    weeks: weeksLabel(s.weeks),
    location: s.location || c.location,
  }))
})

/** 周次汇总（多个时间组的并集文案） */
const weekSummary = computed(() => {
  const c = course.value
  if (!c || !c.sessions.length) return ''
  const set = new Set<number>()
  for (const s of c.sessions) for (const w of s.weeks) set.add(w)
  return weeksLabel([...set])
})

// ============================================================
// 调整时间：停课 / 调课 / 补课（写「日期覆盖层」，不改基准课表）
// ============================================================
const adjOpen = ref(false)
const adjFormEl = ref<HTMLElement | null>(null)
const adjBusy = ref(false)
const adjError = ref('')
const adjKind = ref<'cancel' | 'move' | 'extra' | 'room'>('cancel')
const adjSessionIdx = ref(0)
const adjDate = ref('')
const adjToDate = ref('')
const adjStart = ref(1)
const adjEnd = ref(2)
const adjLocation = ref('')
const adjNote = ref('')
/** 原日期这天匹配到的实际发生（校验与登记都以它为准） */
const adjMatched = ref<ResolvedBlock | null>(null)

const adjKindOptions: AppSelectOption[] = [
  { value: 'cancel', label: '停课（这一次不上）' },
  { value: 'move', label: '调课（改到其他时间）' },
  { value: 'room', label: '换教室（这一次改地点）' },
  { value: 'extra', label: '补课（额外上一次）' },
]

/** 节次数组是否完全相同（来源发生匹配 / 「本次」判定共用） */
function samePeriods(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

const sessionOptions = computed<AppSelectOption[]>(() => {
  const list = (course.value?.sessions ?? []).map((s, i) => ({
    value: i,
    label: `周${'一二三四五六日'[s.weekday - 1]} ${periodsLabel(s.periods)}${s.location ? ` · ${s.location}` : ''}`,
  }))
  // 被调过来的块（如调休+调课落到 10/27 第 7–8 节）在固定时间组里没有对应项：
  // 补一个「本次」，否则只能选到别的节次、登记会落到错的那一节上。
  const occ = props.occurrence
  if (occ && !(course.value?.sessions ?? []).some((s) => samePeriods(s.periods, occ.block.periods))) {
    list.push({ value: -1, label: `本次 · ${dateWithWeekdayLabel(occ.date)} ${periodsLabel(occ.block.periods)}` })
  }
  return list
})

const periodOptions = computed<AppSelectOption[]>(() =>
  store.periods.map((p) => ({ value: p.index, label: `第 ${p.index} 节` })),
)

/** 从今天起，最近一次落在该星期的日期（表单默认值：多半就是这一次课） */
function nextDateOfWeekday(weekday: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const current = ((d.getDay() + 6) % 7) + 1
  d.setDate(d.getDate() + ((weekday - current + 7) % 7))
  return formatDateOf(d)
}

function openAdjust(kind: 'cancel' | 'move' | 'extra' | 'room'): void {
  adjKind.value = kind
  adjError.value = ''
  adjOpen.value = true
  // 展开后滚到表单可见位置（否则表单在滚动区下方，看起来「打不开」）
  void nextTick(() => adjFormEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  const sessions = course.value?.sessions ?? []
  const opened = props.occurrence
  // 从卡片点进来：原时间默认取「这一次」的时间组（按节次匹配，调休 / 调课搬过家的块也对得上）
  const matched = opened
    ? sessions.findIndex(
        (s) => s.periods.length === opened.block.periods.length && s.periods.every((v, i) => v === opened.block.periods[i]),
      )
    : 0
  // 对不上任何固定时间组、但确实是从这张卡片点进来的 → 用「本次」
  adjSessionIdx.value = matched >= 0 ? matched : opened ? -1 : 0
  const s0 = sessions[adjSessionIdx.value >= 0 ? adjSessionIdx.value : 0]
  const occPeriods = opened?.block.periods ?? s0?.periods ?? []
  adjStart.value = occPeriods[0] ?? 1
  adjEnd.value = occPeriods[occPeriods.length - 1] ?? Math.min(2, store.periods.length)
  // 换教室 / 调课：地点预填为这一次当前的地点（换教室时直接改它；调课留空则沿用原地点）
  adjLocation.value = kind === 'extra' ? '' : (opened?.block.location ?? s0?.location ?? course.value?.location ?? '')
  adjNote.value = ''
  const wd = s0?.weekday
  // 原日期：优先用点开的那张卡片的日期；没有卡片时取「最近一次该星期的日期」
  adjDate.value = opened?.date ?? (wd ? nextDateOfWeekday(wd) : formatDateOf(new Date()))
  adjToDate.value = adjDate.value
}

function formatDateOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 切换时间组时：目标节次预填为该组节次范围，原日期若与新星期不符则顺延到最近一次 */
function onSessionChange(): void {
  const idx = adjSessionIdx.value
  if (idx < 0) {
    // 「本次」：节次就是这一块当前的节次，日期不动
    const periods = props.occurrence?.block.periods ?? []
    if (periods.length) {
      adjStart.value = periods[0]
      adjEnd.value = periods[periods.length - 1]
    }
    return
  }
  const s = course.value?.sessions[idx]
  if (!s) return
  adjStart.value = s.periods[0]
  adjEnd.value = s.periods[s.periods.length - 1]
  if (adjDate.value && weekdayOfDateStr(adjDate.value) !== s.weekday) {
    const sameAsSource = adjToDate.value === adjDate.value
    adjDate.value = nextDateOfWeekday(s.weekday)
    if (sameAsSource) adjToDate.value = adjDate.value
  }
}

async function submitAdjust(): Promise<void> {
  const c = course.value
  if (!c) return
  adjError.value = ''
  if (!adjDate.value) {
    adjError.value = adjKind.value === 'extra' ? '请选择补课日期' : '请选择原上课日期'
    return
  }
  const uiKind = adjKind.value
  if (uiKind === 'cancel' || uiKind === 'move' || uiKind === 'room') {
    if (adjSessionIdx.value < 0) {
      // 「本次」：只能用在该卡片所在的那一天
      const occ = props.occurrence
      if (!occ || occ.date !== adjDate.value) {
        adjError.value = '「本次」只对点开的那一天有效；请改选原日期，或改选一个固定的上课时间'
        return
      }
      adjMatched.value = occ.block
    } else {
      const s = c.sessions[adjSessionIdx.value]
      if (!s) {
        adjError.value = '请选择要调整的上课时间'
        return
      }
      // 来源发生匹配：查这一天这门课实际有没有（已含调休 / 调课搬动后的位置），
      // 不再要求「日期星期 = 时间组星期」——先调休、再调课的课也就能继续登记。
      const here = store.resolvedDay(parseDate(adjDate.value)).blocks.filter((b) => b.id === c.id)
      adjMatched.value = here.find((b) => samePeriods(b.periods, s.periods)) ?? (here.length === 1 ? here[0] : null)
      if (!adjMatched.value) {
        const what = here.length ? `这天这门课是 ${here.map((b) => periodsLabel(b.periods)).join('、')}` : '这天没有这门课'
        adjError.value = `${what}，与所选原时间（${periodsLabel(s.periods)}）对不上；请核对日期或改选原时间`
        return
      }
    }
  }
  if (uiKind === 'move' && !adjToDate.value) {
    adjError.value = '请选择调课后的日期'
    return
  }
  if (uiKind === 'move' && adjToDate.value === adjDate.value) {
    adjError.value = '「调到哪天」不能与原上课日相同；只改教室请用「换教室」'
    return
  }
  if (uiKind === 'room') {
    const room = adjLocation.value.trim()
    if (!room) {
      adjError.value = '请填写新地点'
      return
    }
    if (adjMatched.value && room === adjMatched.value.location) {
      adjError.value = '新地点与当前地点相同，不用登记'
      return
    }
  }
  if (uiKind === 'move' || uiKind === 'extra') {
    if (!(adjStart.value <= adjEnd.value)) {
      adjError.value = '节次范围有误'
      return
    }
    if (adjEnd.value > store.periods.length) {
      adjError.value = '节次超出本学期节次范围'
      return
    }
  }

  adjBusy.value = true
  try {
    const s = course.value?.sessions[adjSessionIdx.value]
    const fromPeriods = uiKind === 'extra' ? [] : (adjMatched.value?.periods ?? s?.periods ?? [])
    const range = Array.from({ length: adjEnd.value - adjStart.value + 1 }, (_, i) => adjStart.value + i)
    // 换教室 = 原地调课：日期与节次都不变，只把这一次的地点换掉（不需要新增 kind / 改表结构）
    const toDate = uiKind === 'move' ? adjToDate.value : uiKind === 'room' ? adjDate.value : null
    const periods = uiKind === 'cancel' ? [] : uiKind === 'room' ? fromPeriods.slice() : range
    const location =
      uiKind === 'cancel' ? '' : uiKind === 'room' ? adjLocation.value.trim() : adjLocation.value.trim() || (s?.location ?? '')
    await store.addAdjustment({
      courseId: c.id,
      date: adjDate.value,
      kind: uiKind === 'room' ? 'move' : uiKind,
      fromWeekday: uiKind === 'extra' ? null : weekdayOfDateStr(adjDate.value),
      fromPeriods,
      toDate,
      periods,
      location,
      note: adjNote.value,
    })
    toast(
      uiKind === 'cancel'
        ? '已登记停课'
        : uiKind === 'move'
          ? '已登记调课'
          : uiKind === 'room'
            ? '已登记换教室'
            : '已登记补课',
      'success',
    )
    adjOpen.value = false
    tab.value = 'adjust'
  } catch (e) {
    adjError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    adjBusy.value = false
  }
}

/** 这门课的变更历史（含撤销） */
const showHistory = ref(false)

/** 查看链路：走解析层算整条链（含调休与后续移动），与课表角标 / 台账点开的是同一张卡 */
const adjustChain = ref<AdjustmentChain | null>(null)

function openChain(a: CourseAdjustment): void {
  const chain = explainAdjustment(a, store.resolveCtx)
  if (!chain) {
    toast('这条调整当前没有生效（原日期这天没有这门课）', 'error')
    return
  }
  adjustChain.value = chain
}

/** 撤销一条调整（回到基准课表） */
function undoAdjust(a: CourseAdjustment): void {
  void confirm({
    title: '撤销这条调整？',
    desc: `${adjustmentLabel(a)}——撤销后该课恢复为基准课表的上课时间。`,
    danger: true,
    confirmText: '撤销',
  }).then(async (ok) => {
    if (!ok) return
    try {
      await store.deleteAdjustment(a.id)
      toast('已撤销调整', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '撤销失败，请重试', 'error')
    }
  })
}

/**
 * 换一门课（或点开另一张卡片）时复位临时 UI：
 * 表单收起、子弹层关闭——否则上一门课没填完的调整表单（原日期 / 节次 / 备注）
 * 会被原样带到下一门课上。
 */
watch(
  () => [props.courseId, props.occurrence?.date ?? ''] as const,
  () => {
    adjOpen.value = false
    adjError.value = ''
    adjustChain.value = null
    detail.value = null
    showHistory.value = false
    tab.value = 'exam'
  },
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

function onMaskClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}

function onDelete(): void {
  const c = course.value
  if (!c) return
  void confirm({
    title: '删除课程',
    desc: `将删除课程「${c.name}」及其全部上课时间，其关联的考试与作业记录保留（课程关联置空），此操作不可撤销。`,
    danger: true,
    confirmText: '删除',
  }).then(async (ok) => {
    if (!ok) return
    deleting.value = true
    try {
      await store.deleteCourse(c.id)
      toast('已删除课程', 'success')
      emit('close')
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
    } finally {
      deleting.value = false
    }
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="course"
        class="modal-mask"
        role="presentation"
        @mousedown="onMaskClick"
        @keydown="onKeydown"
      >
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          :aria-label="course.name"
          :style="style"
        >
          <div class="modal-head">
            <span class="dot" :style="{ background: 'var(--ctext)' }"></span>
            <h3 class="m-title">{{ course.name }}</h3>
            <span v-if="course.type === 'lab'" class="lab-chip">实验课</span>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="modal-scroll">
            <div class="modal-body">
              <div class="m-row">
                <span class="k">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  教师
                </span>
                <span class="v">{{ course.teacher || '—' }}</span>
              </div>
              <div class="m-row">
                <span class="k">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                  地点
                </span>
                <span class="v">{{ detailLocation || '—' }}</span>
              </div>

              <!-- 上课时间：无固定时间 / 每个时间段一行 -->
              <div class="m-row">
                <span class="k">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
                  时间
                </span>
                <span class="v" v-if="!hasFixedTime">无固定时间</span>
                <span class="v slot-lines" v-else>
                  <!-- 这一块被调整过：先给「本次」实际发生（日期 + 节次 + 地点 + 角标） -->
                  <span v-if="occ" class="slot-line slot-line--now">
                    <span class="now-tag">本次</span>
                    {{ occ.dateLabel }} · {{ occ.periods }}<template v-if="occ.location"> · {{ occ.location }}</template>
                    <AdjustBadge :block="occurrence!.block" compact />
                  </span>
                  <span v-if="occ && occ.note" class="slot-line slot-line--note">{{ occ.note }}</span>
                  <span v-for="(s, i) in sessionLines" :key="i" class="slot-line" :class="{ 'slot-line--fixed': occ }">
                    <span v-if="occ && i === 0" class="fixed-tag">固定时间</span>
                    {{ s.weekday }} · {{ s.periods }}<template v-if="s.location"> · {{ s.location }}</template>
                  </span>
                </span>
              </div>

              <div class="m-row" v-if="hasFixedTime">
                <span class="k">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
                  周次
                </span>
                <span class="v">{{ weekSummary }}</span>
              </div>

              <div class="m-row" v-if="course.remark">
                <span class="k">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
                  备注
                </span>
                <span class="v note">{{ course.remark }}</span>
              </div>
            </div>

            <!-- 考试/作业 Tab（聚合该课程的记录） -->
            <div class="rel-tabs" role="tablist" aria-label="关联记录">
              <button
                class="rel-tab"
                :class="{ active: tab === 'exam' }"
                type="button"
                role="tab"
                :aria-selected="tab === 'exam'"
                @click="tab = 'exam'"
              >考试<span v-if="examsOf.length" class="rel-count">{{ examsOf.length }}</span></button>
              <button
                class="rel-tab"
                :class="{ active: tab === 'homework' }"
                type="button"
                role="tab"
                :aria-selected="tab === 'homework'"
                @click="tab = 'homework'"
              >作业<span v-if="homeworkOf.length" class="rel-count">{{ homeworkOf.length }}</span></button>
              <button
                class="rel-tab"
                :class="{ active: tab === 'adjust' }"
                type="button"
                role="tab"
                :aria-selected="tab === 'adjust'"
                @click="tab = 'adjust'"
              >调整<span v-if="adjustmentsOf.length" class="rel-count">{{ adjustmentsOf.length }}</span></button>
            </div>

            <div class="rel-body">
              <template v-if="tab === 'exam'">
                <div v-if="examsOf.length">
                  <div
                    v-for="e in examsOf"
                    :key="e.id"
                    class="rel-item rel-item--clickable"
                    role="button"
                    tabindex="0"
                    @click="detail = { kind: 'exam', matter: e }"
                    @keydown.enter="detail = { kind: 'exam', matter: e }"
                  >
                    <span class="rel-name">{{ e.name }}</span>
                    <span v-if="e.attachments.length" class="rel-att">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                      {{ e.attachments.length }}
                    </span>
                    <span class="rel-meta num">{{ e.datetime.replace('T', ' ') }}<template v-if="e.location"> · {{ e.location }}</template></span>
                  </div>
                </div>
                <div v-else class="rel-empty">暂无关联考试</div>
              </template>
              <template v-else-if="tab === 'homework'">
                <div v-if="homeworkOf.length">
                  <div
                    v-for="h in homeworkOf"
                    :key="h.id"
                    class="rel-item rel-item--clickable"
                    role="button"
                    tabindex="0"
                    @click="detail = { kind: 'homework', matter: h }"
                    @keydown.enter="detail = { kind: 'homework', matter: h }"
                  >
                    <span class="rel-name">{{ h.name }}</span>
                    <span v-if="h.attachments.length" class="rel-att">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                      {{ h.attachments.length }}
                    </span>
                    <span class="rel-meta num">{{ h.dueAt.slice(0, 16).replace('T', ' ') }} 截止</span>
                  </div>
                </div>
                <div v-else class="rel-empty">暂无关联作业</div>
              </template>
              <!-- 调整：登记（停课 / 调课 / 补课）与记录撤销；公开只读页仅展示记录 -->
              <template v-else>
                <template v-if="store.readonly">
                  <div v-if="adjustmentsOf.length">
                    <div v-for="a in adjustmentsOf" :key="a.id" class="rel-item rel-item--row">
                      <span class="rel-main">
                        <span class="rel-name">{{ adjustmentLabel(a) }}</span>
                        <span v-if="a.note" class="rel-meta">{{ a.note }}</span>
                      </span>
                      <button class="btn-mini" type="button" @click="openChain(a)">链路</button>
                    </div>
                  </div>
                  <div v-else class="rel-empty">暂无调整记录（停课 / 调课 / 补课）</div>
                </template>

                <!-- 表单：与详情同构的键值行，展开时替代工具行 -->
                <div v-else-if="adjOpen" ref="adjFormEl" class="adj-form">
                  <div class="adj-row">
                    <span class="adj-k">类型</span>
                    <div class="adj-c">
                      <AppSelect v-model="adjKind" :options="adjKindOptions" aria-label="调整类型" />
                    </div>
                  </div>
                  <div v-if="adjKind !== 'extra'" class="adj-row">
                    <span class="adj-k">原时间</span>
                    <div class="adj-c">
                      <AppSelect v-model="adjSessionIdx" :options="sessionOptions" aria-label="原上课时间" @change="onSessionChange" />
                    </div>
                  </div>
                  <div class="adj-row">
                    <span class="adj-k">{{ adjKind === 'extra' ? '补课日' : '原日期' }}</span>
                    <div class="adj-c">
                      <DatePicker v-model="adjDate" size="sm" aria-label="原上课日期" />
                    </div>
                  </div>
                  <div v-if="adjKind === 'move'" class="adj-row">
                    <span class="adj-k">调到</span>
                    <div class="adj-c">
                      <DatePicker v-model="adjToDate" size="sm" aria-label="调课后的日期" />
                    </div>
                  </div>
                  <div v-if="adjKind === 'move' || adjKind === 'extra'" class="adj-row adj-row--range">
                    <span class="adj-k">节次</span>
                    <div class="adj-c adj-c--range">
                      <AppSelect v-model="adjStart" :options="periodOptions" aria-label="起始节次" />
                      <span class="adj-dash">–</span>
                      <AppSelect v-model="adjEnd" :options="periodOptions" aria-label="结束节次" />
                    </div>
                  </div>
                  <div v-if="adjKind !== 'cancel'" class="adj-row">
                    <span class="adj-k">{{ adjKind === 'room' ? '新地点' : '地点' }}</span>
                    <div class="adj-c">
                      <input
                        v-model="adjLocation"
                        class="adj-input"
                        type="text"
                        maxlength="50"
                        :placeholder="adjKind === 'room' ? '如：C3敏学楼 102（必填）' : '可选，如：实验楼 302；留空沿用原地点'"
                      />
                    </div>
                  </div>
                  <div class="adj-row">
                    <span class="adj-k">备注</span>
                    <div class="adj-c">
                      <input v-model="adjNote" class="adj-input" type="text" maxlength="200" placeholder="可选，如：老师出差" />
                    </div>
                  </div>
                  <p v-if="adjError" class="adj-error" role="alert">{{ adjError }}</p>
                  <div class="adj-actions">
                    <button class="btn-mini" type="button" :disabled="adjBusy" @click="adjOpen = false">取消</button>
                    <button class="btn-mini btn-mini--primary" type="button" :disabled="adjBusy" @click="submitAdjust">
                      {{ adjBusy ? '保存中…' : '确定' }}
                    </button>
                  </div>
                </div>

                <template v-else>
                  <div class="adj-tools">
                    <span class="adj-tools__label">登记调整</span>
                    <button v-if="hasFixedTime" class="btn-mini" type="button" @click="openAdjust('cancel')">停课</button>
                    <button v-if="hasFixedTime" class="btn-mini" type="button" @click="openAdjust('move')">调课</button>
                    <button v-if="hasFixedTime" class="btn-mini" type="button" @click="openAdjust('room')">换教室</button>
                    <button class="btn-mini" type="button" @click="openAdjust('extra')">补课</button>
                  </div>
                  <div v-if="adjustmentsOf.length">
                    <div v-for="a in adjustmentsOf" :key="a.id" class="rel-item rel-item--row">
                      <span class="rel-main">
                        <span class="rel-name">{{ adjustmentLabel(a) }}</span>
                        <span v-if="a.note" class="rel-meta">{{ a.note }}</span>
                      </span>
                      <button class="btn-mini" type="button" @click="openChain(a)">链路</button>
                      <button class="btn-mini" type="button" @click="undoAdjust(a)">撤销</button>
                    </div>
                  </div>
                  <div v-else class="rel-empty">暂无调整记录（停课 / 调课 / 补课）</div>
                </template>
              </template>
            </div>

          </div>

          <div v-if="!store.readonly" class="modal-foot">
            <span class="foot-left">
              <button class="btn-ghost" type="button" :disabled="deleting" @click="onDelete">
                {{ deleting ? '正在删除…' : '删除课程' }}
              </button>
              <button class="btn-ghost" type="button" @click="showHistory = true">历史</button>
            </span>
            <button class="btn-primary" type="button" @click="emit('edit', course)">编辑</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 调整链路详情（与课表角标 / 台账同一张卡，叠在本弹窗之上） -->
    <AdjustDetail :open="!!adjustChain" :chain="adjustChain" @close="adjustChain = null" />

    <!-- 关联作业 / 考试的详情（图片内联 / 附件下载，负责人可上传） -->
    <MatterDetail
      :open="detail !== null"
      :kind="detail?.kind ?? 'homework'"
      :matter="detail?.matter ?? null"
      @close="detail = null"
    />

    <!-- 这门课的变更历史（时间线 + 撤销） -->
    <ChangeHistoryModal
      :open="showHistory"
      entity="course"
      :entity-id="courseId"
      :title="course?.name ?? '课程'"
      @close="showHistory = false"
    />
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(2px);
}

.modal {
  width: min(420px, 100%);
  max-height: min(88vh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.m-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.lab-chip {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--ctext);
  background: var(--cbg);
  border: 1px solid var(--cline);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.modal-close:hover {
  background: var(--color-bg-hover);
}

/* 中间整体滚动区：头部与底部固定，详情/Tab/表单一起滚，表单不会再被挤出可视区 */
.modal-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* 对话框宽度固定，纵向滚动条之外不应再出现横向滚动条 */
  overflow-x: hidden;
  overscroll-behavior: contain;
}

.modal-body {
  padding: var(--spacing-lg) var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.m-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md);
  font-size: var(--font-size-sm);
}

.m-row .k {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 60px;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.m-row .k svg {
  width: 14px;
  height: 14px;
}

.m-row .v {
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  word-break: break-all;
}

.m-row .v.note {
  color: var(--color-text-secondary);
}

.slot-lines {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.slot-line {
  display: block;
}

/* 「本次」（被调整过的这一块）与「固定时间」（基准课表）区分开 */
.slot-line--now {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.now-tag,
.fixed-tag {
  flex: none;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  border-radius: var(--radius-full);
  padding: 1px 6px;
}

.now-tag {
  color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.fixed-tag {
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
  margin-right: 4px;
}

.slot-line--note {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.slot-line--fixed {
  color: var(--color-text-tertiary);
}

.rel-tabs {
  display: flex;
  gap: 2px;
  padding: 0 var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
  /* 滚动时吸顶，随时可切换 Tab */
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg-surface);
}

.rel-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 9px 12px;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.rel-tab.active {
  color: var(--color-brand);
  border-bottom-color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.rel-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-size: 10px;
  font-weight: var(--font-weight-bold);
}

.rel-body {
  padding: var(--spacing-md) var(--spacing-xl);
  min-height: 88px;
}

.rel-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
}

.rel-item:first-of-type {
  border-top: none;
}

/* 关联作业 / 考试可点开详情（图片内联 / 附件下载） */
.rel-item--clickable {
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding-left: 6px;
  padding-right: 6px;
  margin-left: -6px;
  margin-right: -6px;
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.rel-item--clickable:hover {
  background: var(--color-bg-hover);
}

.rel-item--clickable:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 1px;
}

/* 附件指示：图片 / 文件个数 */
.rel-att {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.rel-att svg {
  width: 12px;
  height: 12px;
}

.rel-item--row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.rel-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* 调整工具行：登记入口（停课 / 调课 / 补课） */
.adj-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-md);
  margin-bottom: var(--spacing-xs);
  border-bottom: 1px dashed var(--color-border-default);
}

.adj-tools__label {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  margin-right: 2px;
}

/* 调整表单：与详情同构的键值行（左标签 60px + 右控件，控件占满余宽） */
.adj-form {
  scroll-margin-top: 44px;
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle, var(--color-bg-surface));
}

.adj-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-2xs) 0;
}

.adj-k {
  flex: none;
  width: 60px;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.adj-c {
  flex: 1;
  min-width: 0;
}

.adj-c--range {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

/* 子组件（AppSelect / DatePicker）铺满所在行 */
.adj-c :deep(.select),
.adj-c :deep(.dp),
.adj-c :deep(.select__trigger),
.adj-c :deep(.dp-trigger) {
  width: 100%;
  min-width: 0;
}

/* 节次区间：两个下拉等分余宽，窄屏可收缩（文本省略），不撑出横向滚动条 */
.adj-c--range :deep(.select),
.adj-c--range :deep(.dp) {
  flex: 1 1 0;
}

.adj-dash {
  flex: none;
  color: var(--color-text-tertiary);
}

.adj-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.adj-error {
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--color-feedback-danger, #dc2626);
}

.adj-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

.foot-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* 底部小按钮（与设置页 btn-mini 视觉一致） */
.btn-mini {
  flex: none;
  white-space: nowrap;
  padding: 6px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.btn-mini:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.btn-mini--primary {
  border-color: var(--color-brand);
  color: var(--color-brand);
}

.rel-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.rel-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.rel-empty {
  padding: var(--spacing-lg) 0;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-xl) var(--spacing-lg);
  border-top: 1px solid var(--color-border-default);
}

.foot-left {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.btn-ghost,
.btn-primary {
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.btn-ghost {
  color: var(--color-feedback-danger, #dc2626);
  border: 1px solid var(--color-border-default);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.btn-primary {
  background: var(--color-brand);
  color: var(--color-text-inverse);
}

.btn-primary:hover {
  background: var(--color-brand-hover, var(--color-brand));
}

.btn-ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* 窄屏（手机）：收窄左右留白换取内容宽度；节次区间行独占一行，两个下拉才放得下 */
@media (max-width: 480px) {
  .modal-mask {
    padding: var(--spacing-sm);
  }

  .modal-body,
  .rel-body {
    padding-left: var(--spacing-lg);
    padding-right: var(--spacing-lg);
  }

  .rel-tabs {
    padding: 0 var(--spacing-lg);
  }

  .modal-foot {
    padding: var(--spacing-md) var(--spacing-lg) var(--spacing-lg);
  }

  .adj-row--range {
    flex-wrap: wrap;
  }

  .adj-row--range .adj-k {
    width: 100%;
    padding-bottom: 2px;
  }
}
</style>
