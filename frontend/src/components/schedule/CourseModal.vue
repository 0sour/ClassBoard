<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { confirm, toast } from '@/utils/ui'
import { periodsLabel, weeksLabel } from '@/utils/session'
import type { Course } from '@/types'

const props = defineProps<{ courseId: number | null }>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'edit', course: Course): void }>()

const store = useScheduleStore()
const deleting = ref(false)

/** 课程组（由 id 从 store 取，始终反映最新数据） */
const course = computed<Course | null>(() =>
  props.courseId === null ? null : store.courses.find((c) => c.id === props.courseId) ?? null,
)

/** 考试/作业 Tab（课程详情聚合该课程的记录） */
const tab = ref<'exam' | 'homework'>('exam')

const examsOf = computed(() =>
  props.courseId === null ? [] : store.exams.filter((e) => e.courseId === props.courseId),
)

const homeworkOf = computed(() =>
  props.courseId === null ? [] : store.homework.filter((h) => h.courseId === props.courseId),
)

const style = computed(() => ({
  '--cbg': course.value ? `var(--${course.value.color}-bg)` : 'transparent',
  '--cline': course.value ? `var(--${course.value.color}-line)` : 'transparent',
  '--ctext': course.value ? `var(--${course.value.color}-text)` : 'transparent',
}))

const hasFixedTime = computed(() => (course.value?.sessions.length ?? 0) > 0)

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

            <!-- 上课时间：无固定时间 / 每个时间段一行 -->
            <div class="m-row">
              <span class="k">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
                时间
              </span>
              <span class="v" v-if="!hasFixedTime">无固定时间</span>
              <span class="v slot-lines" v-else>
                <span v-for="(s, i) in sessionLines" :key="i" class="slot-line">
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
          </div>

          <div class="rel-body">
            <template v-if="tab === 'exam'">
              <div v-if="examsOf.length">
                <div v-for="e in examsOf" :key="e.id" class="rel-item">
                  <span class="rel-name">{{ e.name }}</span>
                  <span class="rel-meta num">{{ e.datetime.replace('T', ' ') }}<template v-if="e.location"> · {{ e.location }}</template></span>
                </div>
              </div>
              <div v-else class="rel-empty">暂无关联考试</div>
            </template>
            <template v-else>
              <div v-if="homeworkOf.length">
                <div v-for="h in homeworkOf" :key="h.id" class="rel-item">
                  <span class="rel-name">{{ h.name }}</span>
                  <span class="rel-meta num">{{ h.dueAt.slice(0, 16).replace('T', ' ') }} 截止{{ h.done ? ' · 已完成' : '' }}</span>
                </div>
              </div>
              <div v-else class="rel-empty">暂无关联作业</div>
            </template>
          </div>

          <div class="modal-foot">
            <button class="btn-ghost" type="button" :disabled="deleting" @click="onDelete">
              {{ deleting ? '正在删除…' : '删除课程' }}
            </button>
            <button class="btn-primary" type="button" @click="emit('edit', course)">编辑</button>
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

.modal-body {
  padding: var(--spacing-lg) var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  overflow-y: auto;
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

.rel-tabs {
  display: flex;
  gap: 2px;
  padding: 0 var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
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
  overflow-y: auto;
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
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-xl) var(--spacing-lg);
  border-top: 1px solid var(--color-border-default);
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
</style>
