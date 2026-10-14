<script setup lang="ts">
// ============================================================
// ClassBoard · 单课调整编辑器（设置 · 日历台账内新建）
//   停课 / 调课 / 补课。原日期不再要求「星期对得上」——
//   按解析层的结果选：先选日期，再从那一天实际发生的课里挑一节（来源发生匹配），
//   这样「先调休、再调课」的课也能继续登记调整。
// ============================================================
import { computed, reactive, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import { useScheduleStore } from '@/stores/schedule'
import { parseDate } from '@/utils/week'
import { periodsLabel } from '@/utils/session'
import { sourceBadge, weekdayOfDateStr, WEEKDAY_LABELS } from '@/utils/calendar'

const props = defineProps<{ open: boolean; presetCourseId?: number | null }>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const store = useScheduleStore()

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = reactive({
  courseId: null as number | null,
  kind: 'cancel' as 'cancel' | 'move' | 'extra',
  /** cancel/move：原上课日期；extra：补课日期 */
  date: todayStr(),
  /** cancel/move：从「这一天的实际发生」里挑中的那一节 */
  picked: -1,
  toDate: '',
  start: 1,
  end: 2,
  location: '',
  note: '',
})

const error = ref('')
const busy = ref(false)

const kindOptions: AppSelectOption[] = [
  { value: 'cancel', label: '停课（这一次不上）' },
  { value: 'move', label: '调课（改到其他时间）' },
  { value: 'extra', label: '补课（额外上一次）' },
]

/**
 * 课程下拉：同名课程（真实数据里存在，如「微电子器件基础」一门有固定时间、一门无）
 * 追加「周X 节次 · 地点」区分，否则选错课时调整会静默不生效。
 */
const courseOptions = computed<AppSelectOption[]>(() => {
  const list = store.courses.filter((c) => c.semesterId === store.currentSemesterId)
  const seen = new Map<string, number>()
  for (const c of list) seen.set(c.name, (seen.get(c.name) ?? 0) + 1)
  return list.map((c) => {
    if ((seen.get(c.name) ?? 0) < 2) return { value: c.id, label: c.name }
    const first = c.sessions[0]
    const hint = first
      ? `周${'一二三四五六日'[first.weekday - 1]} ${periodsLabel(first.periods)}${first.location ? ` · ${first.location}` : ''}`
      : '无固定时间'
    return { value: c.id, label: `${c.name} · ${hint}` }
  })
})

const periodOptions = computed<AppSelectOption[]>(() =>
  store.periods.map((p) => ({ value: p.index, label: `第 ${p.index} 节` })),
)

/** 所选课程在这一天实际发生的课（含调休 / 调课之后的位置），供「来源发生匹配」挑选 */
const hereBlocks = computed(() => {
  if (form.kind === 'extra' || !form.courseId || !form.date) return []
  return store
    .resolvedDay(parseDate(form.date))
    .blocks.filter((b) => b.id === form.courseId)
})

const pickedBlock = computed(() => hereBlocks.value[form.picked] ?? null)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    error.value = ''
    busy.value = false
    form.courseId = props.presetCourseId ?? store.courses[0]?.id ?? null
    form.kind = 'cancel'
    form.date = todayStr()
    form.picked = -1
    form.toDate = ''
    form.start = 1
    form.end = Math.min(2, Math.max(1, store.periods.length))
    form.location = ''
    form.note = ''
    pickFirst()
  },
  { immediate: true },
)

/** 换课程 / 换日期后：默认选中这一天该课的第一节，并把节次预填为它的范围 */
function pickFirst(): void {
  form.picked = hereBlocks.value.length ? 0 : -1
  syncPeriodsFromPick()
}

function syncPeriodsFromPick(): void {
  const b = pickedBlock.value
  if (!b) return
  form.start = b.startPeriod
  form.end = b.endPeriod
  form.location = b.location
}

watch(() => [form.courseId, form.date], () => pickFirst())
watch(() => form.picked, () => syncPeriodsFromPick())

async function submit(): Promise<void> {
  error.value = ''
  if (!form.courseId) {
    error.value = '请选择课程'
    return
  }
  if (!form.date) {
    error.value = form.kind === 'extra' ? '请选择补课日期' : '请选择原上课日期'
    return
  }
  if (form.kind !== 'extra' && !pickedBlock.value) {
    error.value = `${form.date} 这天没有这门课的上课记录`
    return
  }
  if (form.kind === 'move' && !form.toDate) {
    error.value = '请选择调课后的日期'
    return
  }
  if (form.kind === 'move' && form.toDate === form.date) {
    error.value = '「调到哪天」不能与原上课日相同'
    return
  }
  const target = form.kind === 'cancel' ? [] : periodRange(form.start, form.end)
  if (form.kind !== 'cancel' && !target.length) {
    error.value = '请选择节次'
    return
  }
  if (target.length && target[target.length - 1] > store.periods.length) {
    error.value = '节次超出本学期节次范围'
    return
  }

  busy.value = true
  try {
    await store.addAdjustment({
      courseId: form.courseId,
      date: form.date,
      kind: form.kind,
      fromWeekday: form.kind === 'extra' ? null : weekdayOfDateStr(form.date),
      fromPeriods: form.kind === 'extra' ? [] : (pickedBlock.value?.periods ?? []),
      toDate: form.kind === 'move' ? form.toDate : null,
      periods: target,
      location: form.kind === 'extra' ? form.location : (pickedBlock.value?.location ?? ''),
      note: form.note,
    })
    emit('done')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    busy.value = false
  }
}

function periodRange(a: number, b: number): number[] {
  const lo = Math.max(1, Math.min(a, b))
  const hi = Math.max(1, Math.max(a, b))
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-mask" @mousedown.self="emit('close')" @keydown="onKeydown">
        <div class="modal" role="dialog" aria-modal="true" aria-label="新建单课调整">
          <div class="modal-head">
            <h3 class="m-title">登记单课调整</h3>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="form-grid">
              <label class="field">
                <span class="field-label">课程</span>
                <AppSelect v-model="form.courseId" :options="courseOptions" aria-label="课程" />
              </label>
              <label class="field">
                <span class="field-label">类型</span>
                <AppSelect v-model="form.kind" :options="kindOptions" aria-label="调整类型" />
              </label>

              <label class="field">
                <span class="field-label">{{ form.kind === 'extra' ? '补课日期' : '原上课日期' }}</span>
                <DatePicker v-model="form.date" size="sm" :aria-label="form.kind === 'extra' ? '补课日期' : '原上课日期'" />
              </label>
              <label v-if="form.kind === 'move'" class="field">
                <span class="field-label">调到哪天</span>
                <DatePicker v-model="form.toDate" size="sm" aria-label="调到哪天" />
              </label>
            </div>

            <!-- 原日期这天的实际发生（含调休 / 调课之后的位置）：挑一节 = 来源发生匹配 -->
            <div v-if="form.kind !== 'extra'" class="occur">
              <div v-if="hereBlocks.length" class="occur-list">
                <button
                  v-for="(b, i) in hereBlocks"
                  :key="`${b.sessionId ?? b.adjustmentId ?? i}`"
                  class="occur-chip"
                  :class="{ active: form.picked === i }"
                  type="button"
                  @click="form.picked = i"
                >
                  {{ periodsLabel(b.periods) }}
                  <em v-if="sourceBadge(b.source)" class="occur-src">{{ sourceBadge(b.source) }}</em>
                </button>
              </div>
              <p v-else class="occur-hint">
                {{ WEEKDAY_LABELS[weekdayOfDateStr(form.date) - 1] }}这天没有这门课。
                若这天上了课，请先确认日期，或改在课表上直接拖动该课。
              </p>
            </div>

            <div v-if="form.kind !== 'cancel'" class="form-grid">
              <label class="field">
                <span class="field-label">{{ form.kind === 'extra' ? '上课节次' : '新节次' }}</span>
                <div class="period-pair">
                  <AppSelect v-model="form.start" :options="periodOptions" aria-label="起始节次" />
                  <span class="period-dash">–</span>
                  <AppSelect v-model="form.end" :options="periodOptions" aria-label="结束节次" />
                </div>
              </label>
              <label class="field">
                <span class="field-label">{{ form.kind === 'extra' ? '地点（可选）' : '备注（可选）' }}</span>
                <input
                  v-if="form.kind === 'extra'"
                  v-model="form.location"
                  class="text-input"
                  type="text"
                  placeholder="如：A101"
                  maxlength="60"
                />
                <input v-else v-model="form.note" class="text-input" type="text" placeholder="如：老师出差" maxlength="100" />
              </label>
            </div>
            <label v-else class="field">
              <span class="field-label">备注（可选）</span>
              <input v-model="form.note" class="text-input" type="text" placeholder="如：校运会停课" maxlength="100" />
            </label>

            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          </div>

          <div class="modal-foot">
            <button class="btn" type="button" @click="emit('close')">取消</button>
            <button class="btn btn--primary" type="button" :disabled="busy" @click="submit">
              {{ busy ? '保存中…' : '登记' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
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
  width: min(480px, 100%);
  max-height: min(88vh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
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

.m-title {
  flex: 1;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
}

.modal-close:hover {
  background: var(--color-bg-hover);
}

.modal-close svg {
  width: 18px;
  height: 18px;
}

.modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-lg) var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md) var(--spacing-lg);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.field-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.text-input {
  height: 38px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-body);
  background: var(--color-bg-surface);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

.period-pair {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.period-dash {
  color: var(--color-text-tertiary);
}

.occur {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
}

.occur-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.occur-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
  background: var(--color-bg-surface);
}

.occur-chip.active {
  border-color: var(--color-brand);
  color: var(--color-brand-active);
  background: var(--color-brand-subtle);
}

.occur-src {
  font-size: var(--font-size-xs);
  font-style: normal;
  color: var(--color-text-tertiary);
}

.occur-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  line-height: 1.6;
}

.form-error {
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-xl);
  border-top: 1px solid var(--color-border-default);
}

.btn {
  height: 38px;
  padding: 0 var(--spacing-lg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-body);
  background: var(--color-bg-surface);
}

.btn:hover {
  background: var(--color-bg-hover);
}

.btn--primary {
  border-color: var(--color-brand);
  color: var(--color-text-inverse);
  background: var(--color-brand);
}

.btn--primary:hover {
  background: var(--color-brand-hover);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 520px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
