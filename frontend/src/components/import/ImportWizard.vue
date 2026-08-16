<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import { parsePdf, type ImportError, type PdfParseResult } from '@/utils/pdf'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'done', added: number): void }>()

const store = useScheduleStore()

/** 步骤：1 上传 → 2 解析预览 → 3 确认导入 */
const step = ref(1)
const busy = ref(false)
const progress = ref({ page: 0, total: 0 })
const fileName = ref('')
const result = ref<PdfParseResult | null>(null)
const parseError = ref('')
const doneCount = ref(0)

const importMode = ref<'append' | 'overwrite'>('append')
const targetSemesterId = ref<number>(store.currentSemesterId ?? 0)

const semesterOptions = computed<AppSelectOption[]>(() =>
  store.semesters.map((s) => ({ value: s.id, label: s.name })),
)

const validCount = computed(() => result.value?.rows.length ?? 0)
const errorCount = computed(() => result.value?.errors.length ?? 0)

/** 预览网格：10 节 × 7 天 */
const GRID_PERIODS = 10

interface PreviewCell {
  name: string
  type: string
  startPeriod: number
  endPeriod: number
}

const grid = computed<Record<number, PreviewCell[]>>(() => {
  const map: Record<number, PreviewCell[]> = {}
  for (const r of result.value?.rows ?? []) {
    const key = r.weekday
    map[key] ??= []
    map[key].push({
      name: r.name,
      type: r.type,
      startPeriod: r.startPeriod,
      endPeriod: r.endPeriod,
    })
  }
  return map
})

function cellOf(weekday: number, period: number): PreviewCell | undefined {
  return grid.value[weekday]?.find((c) => c.startPeriod <= period && period <= c.endPeriod)
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday - 1] ?? ''
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

function onMaskClick(event: MouseEvent): void {
  if (event.target === event.currentTarget && !busy.value) emit('close')
}

const fileInput = ref<HTMLInputElement | null>(null)

/** 每次打开向导回到初始状态 */
watch(
  () => props.open,
  (v) => {
    if (!v) return
    step.value = 1
    busy.value = false
    progress.value = { page: 0, total: 0 }
    fileName.value = ''
    result.value = null
    parseError.value = ''
    importMode.value = 'append'
    targetSemesterId.value = store.currentSemesterId ?? 0
  },
)

/** 读取并解析 PDF */
async function handleFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    parseError.value = '仅支持 .pdf 文件，请重新选择'
    return
  }
  fileName.value = file.name
  busy.value = true
  parseError.value = ''
  step.value = 2
  try {
    const buf = await file.arrayBuffer()
    result.value = await parsePdf(buf, (p) => {
      progress.value = { page: p.page, total: p.total }
    })
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : 'PDF 解析失败，请确认是教务系统导出的课表文件'
    result.value = null
  } finally {
    busy.value = false
    progress.value = { page: 0, total: 0 }
  }
}

let dragDepth = 0

function onDrop(e: DragEvent): void {
  dragDepth = 0
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file) void handleFile(file)
}

function onInput(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) void handleFile(file)
}

async function confirmImport(): Promise<void> {
  if (!result.value || busy.value) return
  busy.value = true
  parseError.value = ''
  try {
    const added = await store.importCourses(result.value.rows, importMode.value, targetSemesterId.value)
    doneCount.value = added
    step.value = 4
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : '导入失败，请重试'
    step.value = 1
  } finally {
    busy.value = false
  }
}

function formatIssue(e: ImportError): string {
  const where = e.weekday >= 1 ? `周${weekdayLabel(e.weekday)} 第 ${e.startPeriod} 节` : '整页'
  return `${where} · ${e.name || '未知课程'}：${e.message}`
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-mask" role="presentation" @mousedown="onMaskClick" @keydown="onKeydown">
        <div class="modal" role="dialog" aria-modal="true" aria-label="从 PDF 导入课表">
          <div class="modal-head">
            <h3 class="m-title">从 PDF 导入课表</h3>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <!-- 步骤条 -->
          <ol class="steps" aria-label="导入步骤">
            <li class="steps-item" :class="{ done: step > 1, current: step === 1 }">
              <span class="steps-dot">1</span>
              <span class="steps-label">上传 PDF</span>
            </li>
            <li class="steps-line" :class="{ done: step > 2 }"></li>
            <li class="steps-item" :class="{ done: step > 2, current: step === 2 }">
              <span class="steps-dot">2</span>
              <span class="steps-label">解析预览</span>
            </li>
            <li class="steps-line" :class="{ done: step > 3 }"></li>
            <li class="steps-item" :class="{ done: step > 3, current: step === 3 }">
              <span class="steps-dot">3</span>
              <span class="steps-label">确认导入</span>
            </li>
          </ol>

          <!-- 步骤 1：上传 -->
          <div v-if="step === 1" class="step-body">
            <div
              class="upload-zone"
              :class="{ 'is-error': !!parseError }"
              tabindex="0"
              role="button"
              aria-label="选择或拖拽课表 PDF 文件"
              @click="fileInput?.click()"
              @keydown.enter="fileInput?.click()"
              @keydown.space.prevent="fileInput?.click()"
              @dragover.prevent="dragDepth = 1"
              @dragleave="dragDepth = 0"
              @drop="onDrop"
            >
              <svg class="upload-zone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>
              <p class="upload-zone__title">点击选择或拖拽文件到此处</p>
              <p class="upload-zone__hint">上传教务系统导出的课表 PDF（仅支持 .pdf）</p>
              <input ref="fileInput" class="upload-zone__input" type="file" accept=".pdf,application/pdf" @change="onInput" />
            </div>
            <p v-if="parseError" class="form-error" role="alert">{{ parseError }}</p>
          </div>

          <!-- 步骤 2：解析预览 -->
          <div v-else-if="step === 2" class="step-body" :aria-busy="busy">
            <div v-if="busy" class="parse-state">
              <p class="parse-state__title">正在解析 {{ fileName }}</p>
              <div class="progress" role="progressbar" aria-label="解析进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progress.total ? Math.round((progress.page / progress.total) * 100) : 0">
                <div class="progress__bar" :style="{ width: progress.total ? `${(progress.page / progress.total) * 100}%` : '10%' }"></div>
              </div>
              <p class="parse-state__hint" v-if="progress.total">第 {{ progress.page }} / {{ progress.total }} 页</p>
            </div>

            <div v-else-if="parseError" class="parse-error" role="alert">
              <p class="parse-error__title">{{ parseError }}</p>
              <button class="btn btn--ghost" type="button" @click="step = 1; parseError = ''">重新上传</button>
            </div>

            <template v-else-if="result">
              <div class="summary">
                <p class="summary__line">
                  <template v-if="result.source"><span class="summary__source">{{ result.source }}</span></template>
                  <span class="summary__stat" :class="{ ok: validCount > 0 }">解析出 {{ validCount }} 门课程</span>
                  <span v-if="errorCount" class="summary__stat err">{{ errorCount }} 条需确认</span>
                </p>
              </div>

              <!-- 课程网格预览 -->
              <div class="preview" aria-label="课程预览网格">
                <div class="preview__grid">
                  <div class="preview__head p-h">节次</div>
                  <div v-for="wd in 7" :key="'h' + wd" class="preview__head">{{ weekdayLabel(wd) }}</div>
                  <template v-for="p in GRID_PERIODS" :key="'r' + p">
                    <div class="preview__period">{{ p }}</div>
                    <div v-for="wd in 7" :key="'c' + wd + '-' + p" class="preview__cell">
                      <span v-if="cellOf(wd, p)" class="preview-course" :class="{ 'preview-course--lab': cellOf(wd, p)!.type === 'lab' }">
                        {{ cellOf(wd, p)!.name }}
                      </span>
                    </div>
                  </template>
                </div>
              </div>

              <!-- 错误列表 -->
              <div v-if="errorCount" class="issue-list" role="alert">
                <p class="issue-list__title">以下条目解析存在疑问：</p>
                <ul>
                  <li v-for="(e, i) in result.errors" :key="i" class="issue-list__item">{{ formatIssue(e) }}</li>
                </ul>
              </div>

              <div class="footer">
                <button class="btn btn--ghost" type="button" @click="step = 1; parseError = ''">重新上传</button>
                <button class="btn btn--primary" type="button" :disabled="errorCount > 0" @click="step = 3">
                  下一步
                </button>
              </div>
            </template>
          </div>

          <!-- 步骤 3：确认导入 -->
          <div v-else-if="step === 3" class="step-body">
            <div class="form-row">
              <label class="form-label" for="target-semester">目标学期</label>
              <AppSelect
                id="target-semester"
                :model-value="targetSemesterId"
                :options="semesterOptions"
                size="md"
                aria-label="选择目标学期"
                @update:model-value="(v) => (targetSemesterId = Number(v))"
              />
            </div>

            <fieldset class="mode-group">
              <legend class="form-label">导入模式</legend>
              <label class="mode-option" :class="{ checked: importMode === 'append' }">
                <input v-model="importMode" type="radio" value="append" name="import-mode" />
                <span class="mode-option__dot"></span>
                <span class="mode-option__main">
                  <span class="mode-option__title">追加导入</span>
                  <span class="mode-option__desc">保留本学期现有课程，将 {{ validCount }} 门新课程追加进来</span>
                </span>
              </label>
              <label class="mode-option" :class="{ checked: importMode === 'overwrite' }">
                <input v-model="importMode" type="radio" value="overwrite" name="import-mode" />
                <span class="mode-option__dot"></span>
                <span class="mode-option__main">
                  <span class="mode-option__title">覆盖导入</span>
                  <span class="mode-option__desc">清空本学期现有课程后导入 {{ validCount }} 门课程</span>
                </span>
              </label>
            </fieldset>

            <div v-if="importMode === 'overwrite'" class="overwrite-warn" role="alert">
              将删除本学期已导入的全部课程并导入新数据，此操作不可撤销。考试与作业记录将保留，关联课程置空。
            </div>

            <div class="footer">
              <button class="btn btn--ghost" type="button" :disabled="busy" @click="step = 2">上一步</button>
              <button class="btn btn--primary" type="button" :disabled="busy" @click="confirmImport">
                {{ busy ? '正在导入…' : `确认导入 ${validCount} 门课程` }}
              </button>
            </div>
          </div>

          <!-- 步骤 4：完成 -->
          <div v-else-if="step === 4" class="step-body done-state">
            <svg class="done-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>
            <p class="done-state__title">已成功导入 {{ doneCount }} 门课程</p>
            <p class="done-state__hint">可在周课表 / 今天视图中查看</p>
            <button class="btn btn--primary" type="button" @click="emit('done', doneCount)">完成</button>
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
  width: min(720px, 100%);
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

/* 步骤条 */
.steps {
  display: flex;
  align-items: center;
  padding: var(--spacing-lg) var(--spacing-xl) 0;
  /* 重置 <ol> 默认序号：序号由 .steps-dot 自绘，避免出现多余的 "1. 2. 3." */
  list-style: none;
}

.steps-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--color-text-tertiary);
}

.steps-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  background: var(--color-bg-subtle);
  color: var(--color-text-tertiary);
  transition: background var(--motion-duration-normal) var(--motion-easing-standard),
    color var(--motion-duration-normal) var(--motion-easing-standard);
}

.steps-label {
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.steps-item.current .steps-dot {
  background: var(--color-brand);
  color: var(--color-text-inverse);
}

.steps-item.current .steps-label {
  color: var(--color-text-body);
  font-weight: var(--font-weight-medium);
}

.steps-item.done .steps-dot {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
}

.steps-line {
  flex: 1;
  height: 2px;
  margin: 0 var(--spacing-sm);
  background: var(--color-bg-subtle);
}

.steps-line.done {
  background: var(--color-brand);
}

/* 主体 */
.step-body {
  padding: var(--spacing-xl);
  overflow-y: auto;
}

/* 上传区 */
.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 48px var(--spacing-xl);
  border: 1.5px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: center;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.upload-zone:hover {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.upload-zone.is-error {
  border-color: var(--color-feedback-error);
}

.upload-zone__icon {
  width: 34px;
  height: 34px;
  color: var(--color-brand);
}

.upload-zone__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.upload-zone__hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.upload-zone__input {
  display: none;
}

.form-error {
  margin-top: var(--spacing-md);
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}

/* 解析中 */
.parse-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xl) 0;
}

.parse-state__title {
  font-size: var(--font-size-md);
  color: var(--color-text-body);
}

.progress {
  width: 100%;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-bg-subtle);
  overflow: hidden;
}

.progress__bar {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-brand);
  transition: width var(--motion-duration-normal) var(--motion-easing-standard);
}

.parse-state__hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.parse-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xl) 0;
}

.parse-error__title {
  font-size: var(--font-size-md);
  color: var(--color-feedback-error);
  text-align: center;
}

/* 摘要 */
.summary {
  margin-bottom: var(--spacing-md);
}

.summary__line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.summary__source {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-bg-subtle);
  color: var(--color-text-body);
}

.summary__stat.ok {
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.summary__stat.err {
  color: var(--color-feedback-error);
  font-weight: var(--font-weight-medium);
}

/* 预览网格 */
.preview {
  overflow-x: auto;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
}

.preview__grid {
  display: grid;
  grid-template-columns: 44px repeat(7, minmax(64px, 1fr));
  min-width: 560px;
}

.preview__head {
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-align: center;
  border-bottom: 1px solid var(--color-border-default);
}

.preview__period {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
}

.preview__cell {
  min-height: 34px;
  padding: 2px;
  border-bottom: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
}

.preview-course {
  display: block;
  padding: 3px 5px;
  border-radius: var(--radius-sm);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-size: var(--font-size-xs);
  line-height: 1.35;
  word-break: break-all;
}

.preview-course--lab {
  background: var(--color-feedback-warning-subtle, #fff7e6);
  color: #8a5a00;
}

/* 错误列表 */
.issue-list {
  margin-top: var(--spacing-md);
  padding: var(--spacing-md);
  border: 1px solid var(--color-feedback-error, #f87171);
  border-radius: var(--radius-md);
  background: var(--color-feedback-error-subtle, #fef2f2);
}

.issue-list__title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-feedback-error, #b91c1c);
}

.issue-list__item {
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
}

/* 页脚 */
.footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xl);
}

/* 按钮 */
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

.btn--primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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

/* 步骤 3 表单 */
.form-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  margin-bottom: var(--spacing-xl);
}

.form-label {
  flex: none;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.mode-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  border: none;
  margin: 0;
  padding: 0;
}

.mode-group legend {
  margin-bottom: var(--spacing-sm);
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.mode-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mode-option.checked {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.mode-option__dot {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border: 2px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mode-option.checked .mode-option__dot {
  border-color: var(--color-brand);
}

.mode-option.checked .mode-option__dot::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-brand);
}

.mode-option__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-option__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.mode-option__desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.overwrite-warn {
  margin-top: var(--spacing-md);
  padding: var(--spacing-md);
  border: 1px solid var(--color-feedback-warning, #f59e0b);
  border-radius: var(--radius-md);
  background: var(--color-feedback-warning-subtle, #fffbeb);
  font-size: var(--font-size-sm);
  color: #92400e;
  line-height: 1.6;
}

/* 完成态 */
.done-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 56px var(--spacing-xl);
  text-align: center;
}

.done-state__icon {
  width: 44px;
  height: 44px;
  color: var(--color-brand);
}

.done-state__title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.done-state__hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-bottom: var(--spacing-md);
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
</style>
