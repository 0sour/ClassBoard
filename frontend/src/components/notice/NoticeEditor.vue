<script setup lang="ts">
// ============================================================
// ClassBoard · 通知编辑弹窗（负责人）
//   日期 = 排序键（默认今天），标题必填；可置顶、可关联课程（课程调整通知）。
// ============================================================
import { computed, reactive, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import { useScheduleStore } from '@/stores/schedule'
import type { Notice } from '@/types'

const props = defineProps<{ open: boolean; notice: Notice | null }>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const store = useScheduleStore()

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = reactive({
  date: todayStr(),
  title: '',
  body: '',
  courseId: null as number | null,
  pinned: false,
})

const error = ref('')
const busy = ref(false)

const courseOptions = computed<AppSelectOption[]>(() =>
  store.courses
    .filter((c) => c.semesterId === store.currentSemesterId)
    .map((c) => ({ value: c.id, label: c.name })),
)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    error.value = ''
    busy.value = false
    if (props.notice) {
      form.date = props.notice.date
      form.title = props.notice.title
      form.body = props.notice.body
      form.courseId = props.notice.courseId
      form.pinned = props.notice.pinned
    } else {
      form.date = todayStr()
      form.title = ''
      form.body = ''
      form.courseId = null
      form.pinned = false
    }
  },
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

async function submit(): Promise<void> {
  error.value = ''
  const title = form.title.trim()
  if (!title) {
    error.value = '请填写通知标题'
    return
  }
  if (!form.date) {
    error.value = '请选择通知日期'
    return
  }
  busy.value = true
  try {
    const payload = {
      date: form.date,
      title,
      body: form.body.trim(),
      courseId: form.courseId,
      pinned: form.pinned,
    }
    if (props.notice) await store.updateNotice(props.notice.id, payload)
    else await store.addNotice(payload)
    emit('done')
    emit('close')
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
        <div class="modal" role="dialog" aria-modal="true" :aria-label="notice ? '编辑通知' : '发布通知'">
          <div class="modal-head">
            <h3 class="m-title">{{ notice ? '编辑通知' : '发布通知' }}</h3>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="form-grid">
              <label class="field">
                <span class="field__label">日期（排序用）</span>
                <DatePicker v-model="form.date" size="md" aria-label="通知日期" />
              </label>
              <label class="field">
                <span class="field__label">关联课程（可选）</span>
                <AppSelect
                  v-model="form.courseId"
                  :options="courseOptions"
                  size="md"
                  placeholder="不关联课程"
                  aria-label="关联课程"
                />
              </label>
              <label class="field field--full">
                <span class="field__label">标题</span>
                <input v-model="form.title" class="text-input" type="text" placeholder="如：国庆放假安排 / 周三高数调至周五" maxlength="100" />
              </label>
              <label class="field field--full">
                <span class="field__label">正文</span>
                <textarea v-model="form.body" class="text-area" rows="5" maxlength="2000" placeholder="写清楚时间、地点、需要同学准备什么；留空也可以"></textarea>
              </label>
              <label class="field field--full">
                <span class="field__label">置顶</span>
                <div class="switch-row">
                  <input v-model="form.pinned" class="switch" type="checkbox" role="switch" aria-label="置顶通知" />
                  <span class="switch-label">{{ form.pinned ? '置顶显示' : '按日期排序' }}</span>
                </div>
              </label>
            </div>
            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          </div>

          <div class="modal-foot">
            <button class="btn-ghost" type="button" :disabled="busy" @click="emit('close')">取消</button>
            <button class="btn-primary" type="button" :disabled="busy" @click="submit">
              {{ busy ? '保存中…' : notice ? '保存修改' : '发布' }}
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
  width: min(460px, 100%);
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
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field--full {
  grid-column: 1 / -1;
}

.field__label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.text-input,
.text-area {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);
}

.text-area {
  resize: vertical;
  line-height: 1.6;
}

.text-input:focus,
.text-area:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.switch-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.form-error {
  margin-top: var(--spacing-md);
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

.btn-ghost {
  padding: 8px 14px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.btn-primary {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.btn-primary:disabled,
.btn-ghost:disabled {
  opacity: 0.6;
}

@media (max-width: 480px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
