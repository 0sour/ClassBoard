<script setup lang="ts">
// ============================================================
// ClassBoard · 通知中心（后台与公开班级页共用）
//   铃铛 + 下拉列表：日期是排序键，置顶优先、其余按日期倒序，一条都不隐藏。
//   未登录同学在公开班级页看到同一份（只读）；负责人可在此新建 / 编辑 / 置顶 / 删除。
//   角标 = 通知总条数（暂不做设备级未读标记）。
// ============================================================
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import NoticeEditor from './NoticeEditor.vue'
import ChangeHistoryModal from '@/components/changes/ChangeHistoryModal.vue'
import { confirm, toast } from '@/utils/ui'
import { monthDayLabel } from '@/utils/calendar'
import type { Notice } from '@/types'

const props = withDefaults(defineProps<{ align?: 'left' | 'right' }>(), { align: 'right' })

const store = useScheduleStore()
const open = ref(false)
const editing = ref<Notice | null>(null)
const showEditor = ref(false)
const deleting = ref(false)
/** 这条通知的变更历史（时间线 + 撤销） */
const historyOf = ref<Notice | null>(null)

const notices = computed(() => store.notices)
const canEdit = computed(() => !store.readonly)

/** 打开某条通知的变更历史 */
function openHistory(n: Notice): void {
  close() // 先收起下拉，否则弹窗会被下拉挡住
  historyOf.value = n
}

function toggle(): void {
  open.value = !open.value
  if (open.value) void store.loadNotices()
}

function close(): void {
  open.value = false
}

/** 点击外部关闭（与顶栏其它下拉一致：文档级 mousedown，无遮罩） */
function onDocMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('.notice-wrap')) return
  close()
}

onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

// 切换班级后重取（列表只在打开时刷新，这里兜底清空避免显示上个班的通知）
watch(
  () => store.currentClassId,
  () => {
    if (open.value) void store.loadNotices()
  },
)

function openCreate(): void {
  editing.value = null
  showEditor.value = true
  close()
}

function openEdit(n: Notice): void {
  editing.value = n
  showEditor.value = true
  close()
}

function onEditorDone(): void {
  showEditor.value = false
  editing.value = null
  toast(editing.value ? '通知已更新' : '通知已发布', 'success')
}

async function togglePin(n: Notice): Promise<void> {
  try {
    await store.updateNotice(n.id, {
      date: n.date,
      title: n.title,
      body: n.body,
      courseId: n.courseId,
      pinned: !n.pinned,
    })
    toast(n.pinned ? '已取消置顶' : '已置顶', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败，请重试', 'error')
  }
}

function removeNotice(n: Notice): void {
  void confirm({
    title: '删除通知',
    desc: `将删除通知「${n.title}」，此操作可在变更记录中回退。`,
    danger: true,
    confirmText: '删除',
  }).then(async (ok) => {
    if (!ok) return
    deleting.value = true
    try {
      await store.deleteNotice(n.id)
      toast('通知已删除', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
    } finally {
      deleting.value = false
    }
  })
}

/** 关联课程的课程名（无关联则为空） */
function courseNameOf(n: Notice): string {
  if (n.courseId === null) return ''
  return store.courses.find((c) => c.id === n.courseId)?.name ?? ''
}
</script>

<template>
  <div class="notice-wrap">
    <button
      class="btn-icon"
      :class="{ active: open }"
      type="button"
      aria-label="通知"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      <span v-if="notices.length" class="btn-badge">{{ notices.length }}</span>
    </button>

    <div v-if="open" class="notice-menu" :class="`notice-menu--${props.align}`" role="menu" aria-label="班级通知">
      <div class="notice-head">
        <span class="notice-head__title">班级通知</span>
        <button v-if="canEdit" class="notice-new" type="button" @click="openCreate">＋ 发布通知</button>
      </div>

      <div v-if="notices.length" class="notice-list">
        <article v-for="n in notices" :key="n.id" class="notice-item" :class="{ pinned: n.pinned }">
          <div class="notice-item__top">
            <span class="notice-date num">{{ monthDayLabel(n.date) }}</span>
            <span v-if="n.pinned" class="notice-pin">置顶</span>
            <span v-if="courseNameOf(n)" class="notice-course">{{ courseNameOf(n) }}</span>
          </div>
          <h4 class="notice-title">{{ n.title }}</h4>
          <p v-if="n.body" class="notice-body">{{ n.body }}</p>
          <div v-if="canEdit" class="notice-tools">
            <button class="notice-tool" type="button" :disabled="deleting" @click="togglePin(n)">{{ n.pinned ? '取消置顶' : '置顶' }}</button>
            <button class="notice-tool" type="button" @click="openEdit(n)">编辑</button>
            <button class="notice-tool" type="button" @click="openHistory(n)">历史</button>
            <button class="notice-tool notice-tool--danger" type="button" :disabled="deleting" @click="removeNotice(n)">删除</button>
          </div>
          <div v-else class="notice-meta">{{ n.authorName ? `由 ${n.authorName} 发布` : '' }}</div>
        </article>
      </div>
      <div v-else class="notice-empty">
        {{ canEdit ? '还没有通知，点「发布通知」写第一条' : '暂无班级通知' }}
      </div>
    </div>

    <NoticeEditor :open="showEditor" :notice="editing" @close="showEditor = false" @done="onEditorDone" />
    <ChangeHistoryModal
      :open="!!historyOf"
      entity="notice"
      :entity-id="historyOf?.id ?? null"
      :title="historyOf?.title ?? '通知'"
      @close="historyOf = null"
    />
  </div>
</template>

<style scoped>
.notice-wrap {
  position: relative;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-icon:hover {
  background: var(--color-bg-hover);
}

.btn-icon.active {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
}

.btn-icon svg {
  width: 18px;
  height: 18px;
}

.btn-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: var(--color-text-inverse);
  background: var(--color-feedback-warning);
  border-radius: var(--radius-full);
}

.notice-menu {
  position: absolute;
  top: calc(100% + 6px);
  width: min(360px, calc(100vw - 24px));
  max-height: min(70vh, 560px);
  overflow-y: auto;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xs);
  z-index: var(--z-index-modal);
}

.notice-menu--right {
  right: 0;
}

.notice-menu--left {
  left: 0;
}

.notice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-bottom: 1px solid var(--color-border-default);
  margin-bottom: var(--spacing-xs);
}

.notice-head__title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
}

.notice-new {
  font-size: var(--font-size-sm);
  color: var(--color-brand);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.notice-new:hover {
  background: var(--color-brand-subtle);
}

.notice-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notice-item {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  border-left: 2px solid transparent;
}

.notice-item.pinned {
  background: var(--color-brand-subtle);
  border-left-color: var(--color-brand);
}

.notice-item__top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.notice-date {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-brand);
}

.notice-pin {
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-inverse);
  background: var(--color-brand);
  border-radius: var(--radius-full);
  padding: 1px 6px;
}

.notice-course {
  font-size: 10px;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-full);
  padding: 1px 6px;
}

.notice-title {
  margin-top: 2px;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.notice-body {
  margin-top: 2px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.notice-meta {
  margin-top: 2px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.notice-tools {
  display: flex;
  gap: var(--spacing-xs);
  margin-top: 6px;
}

.notice-tool {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
}

.notice-tool:hover {
  background: var(--color-bg-hover);
}

.notice-tool--danger {
  color: var(--color-feedback-error);
  border-color: var(--color-feedback-error);
}

.notice-tool:disabled {
  opacity: 0.5;
}

.notice-empty {
  padding: var(--spacing-lg) var(--spacing-md);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}
</style>
