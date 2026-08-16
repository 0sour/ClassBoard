<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { confirm, toast } from '@/utils/ui'
import type { Course } from '@/types'

const props = defineProps<{ course: Course | null }>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'edit', course: Course): void }>()

const store = useScheduleStore()
const deleting = ref(false)

const style = computed(() => ({
  '--cbg': props.course ? `var(--${props.course.color}-bg)` : 'transparent',
  '--cline': props.course ? `var(--${props.course.color}-line)` : 'transparent',
  '--ctext': props.course ? `var(--${props.course.color}-text)` : 'transparent',
}))

const weekdayLabel = computed(() => {
  if (!props.course) return ''
  return `周${'一二三四五六日'[props.course.weekday - 1]}`
})

const periodLabel = computed(() => {
  if (!props.course) return ''
  const start = store.periods[props.course.startPeriod - 1]
  const end = store.periods[props.course.endPeriod - 1]
  const s = start ? start.startTime : ''
  const e = end ? end.endTime : ''
  return `${props.course.startPeriod}–${props.course.endPeriod} 节 · ${s}–${e}`
})

const weekLabel = computed(() => {
  const c = props.course
  if (!c) return ''
  if (c.weekType === 'all') return '全部周'
  if (c.weekType === 'odd') return '单周'
  if (c.weekType === 'even') return '双周'
  return c.weekList ? `第 ${c.weekList.join(',')} 周` : ''
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

function onMaskClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}

async function onDelete(): Promise<void> {
  if (!props.course) return
  const ok = await confirm({
    title: '删除课程',
    desc: `将删除课程「${props.course.name}」，其关联的考试与作业记录保留（课程关联置空），此操作不可撤销。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  deleting.value = true
  try {
    await store.deleteCourse(props.course.id)
    toast('已删除课程', 'success')
    emit('close')
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
  } finally {
    deleting.value = false
  }
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
              <span class="v">{{ course.location || '—' }}</span>
            </div>
            <div class="m-row">
              <span class="k">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
                时间
              </span>
              <span class="v">{{ weekdayLabel }} · {{ periodLabel }}</span>
            </div>
            <div class="m-row">
              <span class="k">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
                周次
              </span>
              <span class="v">{{ weekLabel }}</span>
            </div>
            <div class="m-row" v-if="course.remark">
              <span class="k">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
                备注
              </span>
              <span class="v note">{{ course.remark }}</span>
            </div>
          </div>

          <!-- 操作栏：编辑 / 删除（删除需二次确认） -->
          <div class="modal-foot">
            <button class="btn btn--danger" type="button" :disabled="deleting" @click="onDelete">
              {{ deleting ? '删除中…' : '删除' }}
            </button>
            <button class="btn btn--primary" type="button" @click="emit('edit', course)">
              编辑
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
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(4px);
  padding: var(--spacing-lg);
}

.modal {
  width: min(400px, 100%);
  max-height: 85vh;
  overflow: auto;
  background: var(--color-bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xl);
}

.modal-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.m-title {
  font-size: var(--font-size-xl);
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lab-chip {
  font-size: var(--font-size-xs);
  color: var(--course-3-text);
  background: var(--course-3-bg);
  border: 1px solid var(--course-3-line);
  border-radius: var(--radius-full);
  padding: 1px 8px;
  flex-shrink: 0;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.modal-close:hover {
  background: var(--color-bg-hover);
}

.modal-close svg {
  width: 16px;
  height: 16px;
}

.m-row {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
}

.m-row:first-of-type {
  border-top: none;
}

.k {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  width: 72px;
  flex-shrink: 0;
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
}

.k svg {
  width: 14px;
  height: 14px;
}

.v {
  font-size: var(--font-size-body);
  color: var(--color-text-body);
  font-weight: var(--font-weight-medium);
  flex: 1;
  word-break: break-all;
}

.v.note {
  background: var(--color-bg-page);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  font-weight: var(--font-weight-regular);
  color: var(--color-text-secondary);
}

.modal-foot {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
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

.btn--danger {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  color: var(--color-feedback-error);
}

.btn--danger:hover {
  background: rgba(239, 68, 68, 0.08);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 桌面 pop 动画 */
.modal-enter-active {
  animation: pop var(--motion-duration-slow) var(--motion-easing-standard) both;
}

.modal-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.modal-leave-to {
  opacity: 0;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 767px) {
  .modal-mask {
    align-items: flex-end;
    padding: 0;
  }

  .modal {
    width: 100%;
    max-height: 85vh;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding-bottom: calc(var(--spacing-xl) + env(safe-area-inset-bottom));
  }

  .modal-enter-active {
    animation: sheetUp var(--motion-duration-normal) var(--motion-easing-standard) both;
  }

  @keyframes sheetUp {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
}
</style>
