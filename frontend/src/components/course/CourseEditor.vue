<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import { useScheduleStore } from '@/stores/schedule'
import { COURSE_COLOR_NAMES, type Course, type CourseType, type Weekday } from '@/types'
import { MAX_WEEKS, periodRange } from '@/utils/session'
import { calcWeekNumber, parseDate } from '@/utils/week'

const props = defineProps<{
  open: boolean
  /** 编辑模式：传入课程时加载其数据，保存走更新 */
  course?: Course | null
  /** 新增模式下预选课程类型（如事项页「新增实验课」） */
  presetType?: CourseType
  /** 新增模式下预填星期（如周视图空白格快捷新增） */
  presetWeekday?: Weekday
  /** 新增模式下预填起始节次（同上） */
  presetPeriod?: number
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'done', name: string): void }>()

const store = useScheduleStore()

const isEdit = computed(() => props.course !== undefined && props.course !== null)

/** 表单初始值 */
function blankForm() {
  return {
    name: '',
    type: props.presetType ?? ('course' as CourseType),
    teacher: '',
    location: '',
    color: 'course-1',
    weekday: 1 as Weekday,
    startPeriod: 1,
    endPeriod: 2,
    /** 无固定时间课程（实践类）：不排入课表网格 */
    noFixedTime: false,
    remark: '',
  }
}

const form = reactive(blankForm())
const error = ref('')
const busy = ref(false)

/** 当前标签页：fixed = 固定课表，per = 每节课调整（编辑模式隐藏） */
const activeTab = ref<'fixed' | 'per'>('fixed')

/** 周次选择的预设模式（仅界面用；保存时一律展开为逐周数组） */
type WeekMode = 'all' | 'odd' | 'even' | 'custom'
const weekMode = ref<WeekMode>('all')
const weekList = ref<number[]>([])

/** 「每节课调整」：一个时间段（同一门课的一节课），周次由此行独立选择 */
interface SessionRow {
  weekday: Weekday
  startPeriod: number
  endPeriod: number
  location: string
  weeks: number[]
}

function blankSession(): SessionRow {
  return {
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
    location: '',
    weeks: [],
  }
}

const sessions = ref<SessionRow[]>([])

function addSession(): void {
  sessions.value.push(blankSession())
}

function removeSession(i: number): void {
  sessions.value.splice(i, 1)
}

function toggleSessionWeek(s: SessionRow, w: number): void {
  const i = s.weeks.indexOf(w)
  if (i >= 0) s.weeks.splice(i, 1)
  else s.weeks.push(w)
}

/** 学期总周数（自定义周次可选范围；上限复用 utils/session 的 MAX_WEEKS） */
const maxWeeks = computed(() => {
  const sem = store.currentSemester
  if (!sem) return 16
  return Math.min(calcWeekNumber(parseDate(sem.endDate), sem) ?? 16, MAX_WEEKS)
})

const periodOptions = computed(() =>
  store.periods.map((p) => ({
    value: p.index,
    label: `第 ${p.index} 节 ${p.startTime}–${p.endTime}`,
  })),
)

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const weekdayOptions: AppSelectOption[] = WEEKDAY_LABELS.map((label, i) => ({
  value: i + 1,
  label,
}))

const weekChips = computed(() => Array.from({ length: maxWeeks.value }, (_, i) => i + 1))

function toggleWeek(w: number): void {
  const i = weekList.value.indexOf(w)
  if (i >= 0) weekList.value.splice(i, 1)
  else weekList.value.push(w)
}

/** 从课程的 sessions 反推界面所需的 weekMode/weekList（单组时用于固定课表页） */
function deriveWeekUI(course: Course): { mode: WeekMode; list: number[] } {
  if (!course.sessions.length) return { mode: 'all', list: [] }
  const set = new Set<number>()
  for (const s of course.sessions) for (const w of s.weeks) set.add(w)
  const list = [...set].sort((a, b) => a - b)
  const total = maxWeeks.value
  const all = Array.from({ length: total }, (_, i) => i + 1)
  if (list.length === total && list.every((w, i) => w === all[i])) return { mode: 'all', list: [] }
  const odds = all.filter((w) => w % 2 === 1)
  const evens = all.filter((w) => w % 2 === 0)
  if (list.length === odds.length && list.every((w, i) => w === odds[i])) return { mode: 'odd', list: [] }
  if (list.length === evens.length && list.every((w, i) => w === evens[i])) return { mode: 'even', list: [] }
  // 连续单/双周区间（如 1–7 周单周）
  const consecutive = list.every((w, i) => i === 0 || w - list[i - 1] === 2)
  if (consecutive && list.length >= 2 && list.every((w) => w % 2 === 1)) return { mode: 'odd', list }
  if (consecutive && list.length >= 2 && list.every((w) => w % 2 === 0)) return { mode: 'even', list }
  return { mode: 'custom', list }
}

/** 界面选择 → 逐周数组 */
function weeksFromUI(mode: WeekMode, list: number[], total: number): number[] {
  const all = Array.from({ length: total }, (_, i) => i + 1)
  switch (mode) {
    case 'all':
      return all
    case 'odd':
      return list.length ? list.filter((w) => w % 2 === 1) : all.filter((w) => w % 2 === 1)
    case 'even':
      return list.length ? list.filter((w) => w % 2 === 0) : all.filter((w) => w % 2 === 0)
    default:
      return [...list].sort((a, b) => a - b)
  }
}

/** 每次打开重置表单（编辑模式加载课程数据） */
watch(
  () => props.open,
  (v) => {
    if (!v) return
    if (props.course) {
      const c = props.course
      const first = c.sessions[0]
      Object.assign(form, {
        name: c.name,
        type: c.type,
        teacher: c.teacher,
        location: c.location,
        color: c.color,
        weekday: first?.weekday ?? 1,
        startPeriod: first?.periods.length ? first.periods[0] : 1,
        endPeriod: first?.periods.length ? first.periods[first.periods.length - 1] : 2,
        noFixedTime: c.sessions.length === 0,
        remark: c.remark,
      })
      const ui = deriveWeekUI(c)
      weekMode.value = ui.mode
      weekList.value = ui.list
      // 多个上课时间 → 直接进入「每节课调整」以便逐个编辑
      sessions.value = c.sessions.length > 1
        ? c.sessions.map((s) => ({
            weekday: s.weekday,
            startPeriod: s.periods[0] ?? 1,
            endPeriod: s.periods[s.periods.length - 1] ?? 2,
            location: s.location,
            weeks: [...s.weeks],
          }))
        : []
      activeTab.value = c.sessions.length > 1 ? 'per' : 'fixed'
    } else {
      Object.assign(form, blankForm())
      weekMode.value = 'all'
      weekList.value = []
      if (props.presetWeekday) form.weekday = props.presetWeekday
      if (props.presetPeriod) {
        form.startPeriod = props.presetPeriod
        form.endPeriod = Math.min(props.presetPeriod + 1, store.periods.length || props.presetPeriod + 1)
      }
      sessions.value = [blankSession()]
      activeTab.value = 'fixed'
    }
    error.value = ''
    busy.value = false
  },
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

/** 校验一行时间段，返回错误信息（空串表示通过） */
function validateSession(s: SessionRow, i: number): string {
  if (s.startPeriod > s.endPeriod) return `第 ${i + 1} 节课结束节次不能早于起始节次`
  if (s.weeks.length === 0) return `第 ${i + 1} 节课请至少选择一周`
  return ''
}

/** 组装写库载荷：sessions 中节次/周次一律为逐项数组 */
function buildPayload(rows: { weekday: Weekday; startPeriod: number; endPeriod: number; location: string; weeks: number[] }[]) {
  return {
    type: form.type,
    name: form.name.trim(),
    teacher: form.teacher.trim(),
    location: form.location.trim(),
    color: form.color,
    remark: form.remark.trim(),
    sessions: rows.map((r) => ({
      weekday: r.weekday,
      location: r.location.trim(),
      periods: periodRange(r.startPeriod, r.endPeriod),
      weeks: [...new Set(r.weeks)].sort((a, b) => a - b),
    })),
  }
}

async function submit(keepOpen = false): Promise<void> {
  error.value = ''
  const name = form.name.trim()
  if (!name) {
    error.value = '请填写课程名称'
    return
  }
  busy.value = true
  try {
    if (isEdit.value && props.course) {
      // 编辑模式：整组原子更新（元数据 + 全部上课时间）
      let rows: { weekday: Weekday; startPeriod: number; endPeriod: number; location: string; weeks: number[] }[]
      if (form.noFixedTime) {
        rows = []
      } else if (activeTab.value === 'per') {
        for (const [i, s] of sessions.value.entries()) {
          const msg = validateSession(s, i)
          if (msg) {
            error.value = msg
            return
          }
        }
        rows = sessions.value.map((s) => ({ ...s }))
      } else {
        if (form.startPeriod > form.endPeriod) {
          error.value = '结束节次不能早于起始节次'
          return
        }
        const weeks = weeksFromUI(weekMode.value, weekList.value, maxWeeks.value)
        if (!weeks.length) {
          error.value = '请选择至少一个周次'
          return
        }
        rows = [{ weekday: form.weekday, startPeriod: form.startPeriod, endPeriod: form.endPeriod, location: form.location, weeks }]
      }
      await store.updateCourse(props.course.id, buildPayload(rows))
      emit('done', name)
      emit('close')
      return
    }

    // 新增模式
    if (form.noFixedTime) {
      await store.addCourse(buildPayload([]))
      if (keepOpen) {
        Object.assign(form, { name: '', teacher: '', remark: '' })
        emit('done', name)
      } else {
        emit('done', name)
        emit('close')
      }
      return
    }
    if (activeTab.value === 'per') {
      if (sessions.value.length === 0) {
        error.value = '请至少添加一节课'
        return
      }
      for (const [i, s] of sessions.value.entries()) {
        const msg = validateSession(s, i)
        if (msg) {
          error.value = msg
          return
        }
      }
      // 每节课合并写入同一门课程（多上课时间组），不再拆成多门同名课程
      await store.addCourse(buildPayload(sessions.value.map((s) => ({ ...s }))))
    } else {
      if (form.startPeriod > form.endPeriod) {
        error.value = '结束节次不能早于起始节次'
        return
      }
      const weeks = weeksFromUI(weekMode.value, weekList.value, maxWeeks.value)
      if (!weeks.length) {
        error.value = '请选择至少一个周次'
        return
      }
      await store.addCourse(
        buildPayload([{ weekday: form.weekday, startPeriod: form.startPeriod, endPeriod: form.endPeriod, location: form.location, weeks }]),
      )
    }
    if (keepOpen) {
      Object.assign(form, { name: '', teacher: '', remark: '' })
      weekMode.value = 'all'
      weekList.value = []
      sessions.value = [blankSession()]
      emit('done', name)
    } else {
      emit('done', name)
      emit('close')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-mask" @mousedown.self="emit('close')" @keydown="onKeydown">
        <div class="modal" role="dialog" aria-modal="true" :aria-label="isEdit ? '编辑课程' : '手动录入课程'">
          <div class="modal-head">
            <h3 class="m-title">{{ isEdit ? '编辑课程' : '手动录入课程' }}</h3>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="step-body">
            <div v-if="!form.noFixedTime" class="editor-tabs" role="tablist" aria-label="录入方式">
              <button
                type="button"
                role="tab"
                class="editor-tab"
                :class="{ active: activeTab === 'fixed' }"
                :aria-selected="activeTab === 'fixed'"
                @click="activeTab = 'fixed'"
              >
                固定课表
              </button>
              <button
                type="button"
                role="tab"
                class="editor-tab"
                :class="{ active: activeTab === 'per' }"
                :aria-selected="activeTab === 'per'"
                @click="activeTab = 'per'"
              >
                每节课调整
              </button>
            </div>

            <!-- 两个标签页共享的课程信息 -->
            <div class="form-grid">
              <label class="field field--full">
                <span class="field__label">课程名称</span>
                <input v-model="form.name" class="text-input" type="text" placeholder="如：大学物理实验" maxlength="50" />
              </label>

              <fieldset class="field field--full">
                <legend class="field__label">课程类型</legend>
                <div class="seg">
                  <label class="seg-item" :class="{ checked: form.type === 'course' }">
                    <input v-model="form.type" type="radio" value="course" name="course-type" />
                    <span class="seg-item__dot"></span>
                    <span>理论课</span>
                  </label>
                  <label class="seg-item" :class="{ checked: form.type === 'lab' }">
                    <input v-model="form.type" type="radio" value="lab" name="course-type" />
                    <span class="seg-item__dot"></span>
                    <span>实验课</span>
                  </label>
                </div>
              </fieldset>

              <label class="field field--full">
                <span class="field__label">教师</span>
                <input v-model="form.teacher" class="text-input" type="text" placeholder="选填" maxlength="30" />
              </label>

              <div class="field field--full">
                <span class="field__label">课程颜色（按录入顺序轮询分配，可手动修改）</span>
                <div class="swatch-picks" role="radiogroup" aria-label="课程颜色">
                  <button
                    v-for="cn in COURSE_COLOR_NAMES"
                    :key="cn"
                    class="swatch-pick"
                    :class="{ selected: form.color === cn }"
                    type="button"
                    role="radio"
                    :aria-checked="form.color === cn"
                    :aria-label="cn"
                    :style="{ '--sw-bg': `var(--${cn}-bg)`, '--sw-line': `var(--${cn}-line)`, '--sw-text': `var(--${cn}-text)` }"
                    @click="form.color = cn"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- 固定课表：每周重复的时间安排 -->
            <div v-if="!form.noFixedTime && activeTab === 'fixed'" class="form-grid tab-grid">
              <label class="field">
                <span class="field__label">上课地点</span>
                <input v-model="form.location" class="text-input" type="text" placeholder="如：C3敏学楼501" maxlength="50" />
              </label>

              <fieldset class="field field--full">
                <legend class="field__label">星期</legend>
                <div class="weekdays" role="radiogroup" aria-label="选择星期">
                  <button
                    v-for="(label, i) in WEEKDAY_LABELS"
                    :key="label"
                    class="weekday-chip"
                    type="button"
                    :class="{ checked: form.weekday === i + 1 }"
                    @click="form.weekday = (i + 1) as Weekday"
                  >
                    {{ label }}
                  </button>
                </div>
              </fieldset>

              <div class="field">
                <span class="field__label">起始节次</span>
                <AppSelect v-model="form.startPeriod" :options="periodOptions" size="md" aria-label="起始节次" />
              </div>
              <div class="field">
                <span class="field__label">结束节次</span>
                <AppSelect v-model="form.endPeriod" :options="periodOptions" size="md" aria-label="结束节次" />
              </div>

              <fieldset class="field field--full">
                <legend class="field__label">周次规则</legend>
                <div class="seg">
                  <label class="seg-item" :class="{ checked: weekMode === 'all' }">
                    <input v-model="weekMode" type="radio" value="all" name="week-type" />
                    <span class="seg-item__dot"></span>
                    <span>每周</span>
                  </label>
                  <label class="seg-item" :class="{ checked: weekMode === 'odd' }">
                    <input v-model="weekMode" type="radio" value="odd" name="week-type" />
                    <span class="seg-item__dot"></span>
                    <span>单周</span>
                  </label>
                  <label class="seg-item" :class="{ checked: weekMode === 'even' }">
                    <input v-model="weekMode" type="radio" value="even" name="week-type" />
                    <span class="seg-item__dot"></span>
                    <span>双周</span>
                  </label>
                  <label class="seg-item" :class="{ checked: weekMode === 'custom' }">
                    <input v-model="weekMode" type="radio" value="custom" name="week-type" />
                    <span class="seg-item__dot"></span>
                    <span>自定义</span>
                  </label>
                </div>
              </fieldset>

              <div v-if="weekMode === 'custom' || weekMode === 'odd' || weekMode === 'even'" class="field field--full">
                <span class="field__label">
                  {{ weekMode === 'custom' ? '选择周次（1–' + maxWeeks + ' 周）' : '周数范围（选填，不选则为全学期' + (weekMode === 'odd' ? '单周' : '双周') + '）' }}
                </span>
                <div class="week-custom">
                  <button
                    v-for="w in weekChips"
                    :key="w"
                    class="week-chip"
                    type="button"
                    :class="{ checked: weekList.includes(w) }"
                    @click="toggleWeek(w)"
                  >
                    {{ w }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 每节课调整：每节课独立指定时间与地点 -->
            <div v-else-if="!form.noFixedTime" class="per-tab">
              <div v-for="(s, i) in sessions" :key="i" class="session-card">
                <div class="session-grid">
                  <label class="field">
                    <span class="field__label">星期</span>
                    <AppSelect v-model="s.weekday" :options="weekdayOptions" size="md" :aria-label="`第 ${i + 1} 节课星期`" />
                  </label>
                  <div class="field">
                    <span class="field__label">起始节次</span>
                    <AppSelect v-model="s.startPeriod" :options="periodOptions" size="md" :aria-label="`第 ${i + 1} 节课起始节次`" />
                  </div>
                  <div class="field">
                    <span class="field__label">结束节次</span>
                    <AppSelect v-model="s.endPeriod" :options="periodOptions" size="md" :aria-label="`第 ${i + 1} 节课结束节次`" />
                  </div>
                  <label class="field">
                    <span class="field__label">地点</span>
                    <input v-model="s.location" class="text-input" type="text" placeholder="如：C3敏学楼501" maxlength="50" :aria-label="`第 ${i + 1} 节课地点`" />
                  </label>
                </div>

                <div class="session-weeks">
                  <div class="session-weeks-head">
                    <span class="field__label">选择周次（1–{{ maxWeeks }} 周）</span>
                    <button class="session-del" type="button" :aria-label="`删除第 ${i + 1} 节课`" @click="removeSession(i)">×</button>
                  </div>
                  <div class="week-custom">
                    <button
                      v-for="w in weekChips"
                      :key="w"
                      class="week-chip"
                      type="button"
                      :class="{ checked: s.weeks.includes(w) }"
                      @click="toggleSessionWeek(s, w)"
                    >
                      {{ w }}
                    </button>
                  </div>
                </div>
              </div>

              <button class="btn btn--ghost add-session" type="button" @click="addSession">＋ 添加一节课</button>
            </div>

            <label class="field field--full no-time-toggle">
              <span class="field__label">无固定时间课程</span>
              <span class="nt-row">
                <input v-model="form.noFixedTime" type="checkbox" class="nt-check" />
                <span class="nt-hint">实践 / 实习等不排入课表的课程：勾选后不设星期与节次，仅在「实践与其他」中展示</span>
              </span>
            </label>

            <label class="field field--full editor-remark">
              <span class="field__label">备注（选填）</span>
              <input v-model="form.remark" class="text-input" type="text" placeholder="如：双周周三实验" maxlength="200" />
            </label>

            <p v-if="error" class="form-error" role="alert">{{ error }}</p>

            <div class="footer">
              <button class="btn btn--ghost" type="button" :disabled="busy" @click="emit('close')">取消</button>
              <template v-if="!isEdit">
                <button class="btn btn--primary" type="button" :disabled="busy" @click="submit(true)">
                  {{ busy ? '保存中…' : '保存并继续' }}
                </button>
                <button class="btn btn--primary" type="button" :disabled="busy" @click="submit(false)">
                  {{ busy ? '保存中…' : '保存' }}
                </button>
              </template>
              <button v-else class="btn btn--primary" type="button" :disabled="busy" @click="submit(false)">
                {{ busy ? '保存中…' : '保存修改' }}
              </button>
            </div>
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
  width: min(560px, 100%);
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
  justify-content: space-between;
  padding: var(--spacing-lg) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
}

.m-title {
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
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.modal-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-body);
}

.modal-close svg {
  width: 17px;
  height: 17px;
}

.step-body {
  padding: var(--spacing-xl);
  overflow-y: auto;
}

/* 标签页切换 */
.editor-tabs {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border-default);
}

.editor-tab {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.editor-tab:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-body);
}

.editor-tab.active {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.tab-grid {
  margin-top: var(--spacing-lg);
}

/* 每节课调整：时间段卡片 */
.per-tab {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  margin-top: var(--spacing-lg);
}

.session-card {
  padding: var(--spacing-lg);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-muted);
}

.session-grid {
  display: grid;
  /* 2 列：每节课的星期/节次/地点下拉需要足够宽度，4 列会导致触发器溢出重叠 */
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.session-weeks {
  margin-top: var(--spacing-md);
}

.session-weeks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: 6px;
}

.session-del {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-lg);
  line-height: 1;
  color: var(--color-text-tertiary);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.session-del:hover {
  background: var(--color-feedback-error-subtle, rgba(220, 38, 38, 0.1));
  color: var(--color-feedback-error);
}

.add-session {
  align-self: flex-start;
}

.no-time-toggle .nt-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
}

.nt-check {
  margin-top: 3px;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  accent-color: var(--color-brand);
}

.nt-hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  line-height: var(--line-height-normal, 1.5);
}

.editor-remark {
  margin-top: var(--spacing-lg);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-lg) var(--spacing-md);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  /* fieldset 原生凹陷边框 / legend 缩进，手动重置 */
  border: none;
  margin: 0;
  padding: 0;
}

.field legend.field__label {
  padding: 0;
  margin-bottom: 6px;
}

.field--full {
  grid-column: 1 / -1;
}

.field__label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.text-input {
  height: 38px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  font-size: var(--font-size-md);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

/* 类型 / 周次规则分段选择 */
.seg {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.seg-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
  cursor: pointer;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.seg-item input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.seg-item__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: transparent;
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.seg-item.checked {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.seg-item.checked .seg-item__dot {
  background: var(--color-brand);
}

/* 星期选择 */
.weekdays {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.weekday-chip {
  width: 44px;
  height: 34px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.weekday-chip.checked {
  border-color: var(--color-brand);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-weight: var(--font-weight-medium);
}

/* 自定义周次 */
.week-custom {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.week-chip {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.week-chip.checked {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

/* 课程颜色选择（8 色三值色卡） */
.swatch-picks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.swatch-pick {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--sw-bg);
  color: var(--sw-text);
  border: 1px solid var(--sw-line);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.swatch-pick:hover {
  transform: scale(1.08);
}

.swatch-pick svg {
  display: none;
  width: 14px;
  height: 14px;
}

.swatch-pick.selected {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 1px;
}

.swatch-pick.selected svg {
  display: block;
}

.form-error {
  margin-top: var(--spacing-md);
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xl);
}

.btn {
  height: 38px;
  padding: 0 var(--spacing-lg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn--primary {
  background: var(--color-brand);
  color: var(--color-text-inverse);
}

.btn--primary:hover {
  background: var(--color-brand-hover);
}

.btn--ghost {
  border: 1px solid var(--color-border-default);
  color: var(--color-text-body);
}

.btn--ghost:hover {
  background: var(--color-bg-hover);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 过渡 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard);
}

.modal-enter-active .modal {
  transition: transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal {
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .session-grid {
    grid-template-columns: 1fr;
  }
}
</style>
