<script setup lang="ts">
// 考试编辑弹窗（规范 3.5 / PRD 5.7）：新增与编辑共用
import { computed, reactive, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import TimePicker from '@/components/common/TimePicker.vue'
import { useScheduleStore } from '@/stores/schedule'
import type { Exam } from '@/types'

const props = defineProps<{ open: boolean; exam: Exam | null }>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const store = useScheduleStore()

const form = reactive({
  courseId: null as number | null,
  name: '',
  date: '',
  time: '',
  location: '',
  remark: '',
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
    if (props.exam) {
      form.courseId = props.exam.courseId
      form.name = props.exam.name
      form.date = props.exam.datetime.slice(0, 10)
      form.time = props.exam.datetime.slice(11, 16)
      form.location = props.exam.location
      form.remark = props.exam.remark
    } else {
      form.courseId = null
      form.name = ''
      form.date = ''
      form.time = ''
      form.location = ''
      form.remark = ''
    }
  },
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

async function submit(): Promise<void> {
  error.value = ''
  const name = form.name.trim()
  if (!name) {
    error.value = '请填写考试名称'
    return
  }
  if (!form.date || !form.time) {
    error.value = '请选择考试日期与时间'
    return
  }
  busy.value = true
  try {
    const payload = {
      courseId: form.courseId,
      name,
      datetime: `${form.date}T${form.time}`,
      location: form.location.trim(),
      remark: form.remark.trim(),
    }
    if (props.exam) await store.updateExam(props.exam.id, payload)
    else await store.addExam(payload)
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
        <div class="modal" role="dialog" aria-modal="true" :aria-label="exam ? '编辑考试' : '新增考试'">
          <div class="modal-head">
            <h3 class="m-title">{{ exam ? '编辑考试' : '新增考试' }}</h3>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="form-grid">
              <div class="field field--full">
                <span class="field__label">所属课程</span>
                <AppSelect
                  v-model="form.courseId"
                  :options="courseOptions"
                  size="md"
                  placeholder="不关联课程"
                  aria-label="所属课程"
                />
              </div>
              <label class="field field--full">
                <span class="field__label">考试名称</span>
                <input v-model="form.name" class="text-input" type="text" placeholder="如：高等数学期中" maxlength="50" />
              </label>
              <label class="field field--full">
                <span class="field__label">考试时间</span>
                <div class="datetime-row">
                  <input v-model="form.date" class="date-input" type="date" aria-label="考试日期" />
                  <TimePicker v-model="form.time" size="md" aria-label="考试时间" />
                </div>
              </label>
              <label class="field">
                <span class="field__label">地点</span>
                <input v-model="form.location" class="text-input" type="text" placeholder="选填" maxlength="50" />
              </label>
              <label class="field">
                <span class="field__label">备注</span>
                <input v-model="form.remark" class="text-input" type="text" placeholder="选填" maxlength="200" />
              </label>
            </div>

            <p v-if="error" class="form-error" role="alert">{{ error }}</p>

            <div class="footer">
              <button class="btn btn--ghost" type="button" :disabled="busy" @click="emit('close')">取消</button>
              <button class="btn btn--primary" type="button" :disabled="busy" @click="submit">
                {{ busy ? '保存中…' : '保存' }}
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
  width: min(480px, 100%);
  max-height: 85vh;
  overflow: auto;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
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

.modal-body {
  padding: var(--spacing-xl);
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
  height: 40px;
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

.datetime-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.date-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  font-family: inherit;
  font-size: var(--font-size-md);
}

.date-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
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
}
</style>
