<script setup lang="ts">
// ============================================================
// ClassBoard · 作业 / 考试详情弹窗
//   点侧栏条目（或课程详情里的关联记录）打开：
//   - 图片直接内联显示，点一下放大看原图
//   - 其他附件提供下载；公开面同样可看可下（跟随所在对象的可见性）
//   - 负责人可在弹窗里上传 / 删除附件（学生只读）
// ============================================================
import { computed, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { attachmentUrl } from '@/api/client'
import { confirm, toast } from '@/utils/ui'
import type { Attachment, Exam, Homework } from '@/types'

const props = defineProps<{ open: boolean; kind: 'exam' | 'homework'; matter: Exam | Homework | null }>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'edit'): void }>()

const store = useScheduleStore()
const canEdit = computed(() => !store.readonly)

/** 从 store 里取实时对象（上传 / 删除后是同一份引用；编辑后被新对象替换也不会看旧数据） */
const matter = computed<Exam | Homework | null>(() => {
  if (!props.matter) return null
  const list = props.kind === 'exam' ? store.exams : store.homework
  return list.find((m) => m.id === props.matter!.id) ?? props.matter
})

const attachments = computed<Attachment[]>(() => matter.value?.attachments ?? [])
const images = computed(() => attachments.value.filter((a) => a.kind === 'image'))
const files = computed(() => attachments.value.filter((a) => a.kind !== 'image'))

const courseName = computed(() => {
  const id = matter.value?.courseId
  if (id === null || id === undefined) return ''
  return store.courses.find((c) => c.id === id)?.name ?? ''
})

const dueStamp = computed(() => {
  const m = matter.value
  if (!m) return ''
  const iso = props.kind === 'homework' ? (m as Homework).dueAt : (m as Exam).datetime
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
})

const location = computed(() => (props.kind === 'exam' ? (matter.value as Exam | null)?.location ?? '' : ''))
const remark = computed(() => matter.value?.remark ?? '')

const preview = ref<Attachment | null>(null)
const busy = ref(false)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  (v) => {
    if (v) return
    preview.value = null
    busy.value = false
    dragOver.value = false
  },
)

function close(): void {
  if (preview.value) {
    preview.value = null
    return
  }
  emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function pickFiles(): void {
  fileInput.value?.click()
}

async function onFiles(list: FileList | null): Promise<void> {
  const m = matter.value
  if (!m || !list?.length || busy.value) return
  busy.value = true
  let ok = 0
  try {
    for (const file of Array.from(list)) {
      try {
        await store.uploadAttachment(props.kind, m.id, file)
        ok += 1
      } catch (e) {
        toast(e instanceof Error ? e.message : `「${file.name}」上传失败`, 'error')
      }
    }
    if (ok) toast(`已上传 ${ok} 个附件`, 'success')
  } finally {
    busy.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  if (!canEdit.value) return
  void onFiles(e.dataTransfer?.files ?? null)
}

function removeOne(a: Attachment): void {
  void confirm({
    title: '删除附件',
    desc: `将删除「${a.name}」，此操作可在变更记录中回退。`,
    danger: true,
    confirmText: '删除',
  }).then(async (ok) => {
    if (!ok) return
    busy.value = true
    try {
      await store.deleteAttachment(a.id)
      if (preview.value?.id === a.id) preview.value = null
      toast('附件已删除', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
    } finally {
      busy.value = false
    }
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open && matter" class="modal-mask" @mousedown.self="close" @keydown="onKeydown">
        <div class="modal" role="dialog" aria-modal="true" :aria-label="kind === 'exam' ? '考试详情' : '作业详情'">
          <div class="modal-head">
            <div class="m-heading">
              <span class="m-kind" :class="kind">{{ kind === 'exam' ? '考试' : '作业' }}</span>
              <h3 class="m-title">{{ matter.name }}</h3>
            </div>
            <button class="modal-close" type="button" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="meta">
              <div class="meta-row">
                <span class="meta-k">{{ kind === 'exam' ? '考试时间' : '截止时间' }}</span>
                <span class="meta-v num">{{ dueStamp }}</span>
              </div>
              <div v-if="courseName" class="meta-row">
                <span class="meta-k">所属课程</span>
                <span class="meta-v">{{ courseName }}</span>
              </div>
              <div v-if="location" class="meta-row">
                <span class="meta-k">地点</span>
                <span class="meta-v">{{ location }}</span>
              </div>
              <div v-if="remark" class="meta-row">
                <span class="meta-k">备注</span>
                <span class="meta-v">{{ remark }}</span>
              </div>
            </div>

            <!-- 图片：直接内联显示 -->
            <div v-if="images.length" class="sec">
              <div class="sec-head">
                <span class="sec-title">图片</span>
                <span class="sec-hint">点图片可放大查看</span>
              </div>
              <div class="img-grid">
                <figure v-for="a in images" :key="a.id" class="img-cell">
                  <button class="img-btn" type="button" :aria-label="`查看 ${a.name}`" @click="preview = a">
                    <img :src="attachmentUrl(a.id)" :alt="a.name" loading="lazy" />
                  </button>
                  <button
                    v-if="canEdit"
                    class="img-del"
                    type="button"
                    :disabled="busy"
                    :aria-label="`删除 ${a.name}`"
                    @click="removeOne(a)"
                  >×</button>
                </figure>
              </div>
            </div>

            <!-- 其它附件：提供下载 -->
            <div v-if="files.length" class="sec">
              <div class="sec-head">
                <span class="sec-title">附件</span>
              </div>
              <ul class="file-list">
                <li v-for="a in files" :key="a.id" class="file-row">
                  <a class="file-main" :href="attachmentUrl(a.id)" :download="a.name" :title="a.name">
                    <span class="file-ic" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
                    </span>
                    <span class="file-name">{{ a.name }}</span>
                    <span class="file-size num">{{ formatSize(a.size) }}</span>
                  </a>
                  <button v-if="canEdit" class="file-del" type="button" :disabled="busy" @click="removeOne(a)">删除</button>
                </li>
              </ul>
            </div>

            <div v-if="!attachments.length" class="empty">
              {{ canEdit ? '还没有图片或附件——上传后图片会直接显示在这里' : '这条记录暂无图片或附件' }}
            </div>

            <!-- 上传区（仅负责人；图片与文件都可，图片随后内联显示） -->
            <div
              v-if="canEdit"
              class="drop"
              :class="{ over: dragOver }"
              @dragover.prevent="dragOver = true"
              @dragleave="dragOver = false"
              @drop.prevent="onDrop"
            >
              <input
                ref="fileInput"
                class="drop-input"
                type="file"
                multiple
                aria-label="选择要上传的图片或附件"
                @change="onFiles(($event.target as HTMLInputElement).files)"
              />
              <button class="drop-btn" type="button" :disabled="busy" @click="pickFiles">
                {{ busy ? '处理中…' : '＋ 上传图片 / 附件' }}
              </button>
              <span class="drop-hint">也可把文件拖到这里；单个不超过 20 MB</span>
            </div>

            <div class="footer">
              <button v-if="canEdit" class="btn btn--ghost" type="button" @click="emit('edit')">编辑</button>
              <button class="btn btn--primary" type="button" @click="emit('close')">关闭</button>
            </div>
          </div>
        </div>

        <!-- 放大预览：点任意处退出 -->
        <Transition name="fade">
          <div v-if="preview" class="lightbox" @click="preview = null">
            <img :src="attachmentUrl(preview.id)" :alt="preview.name" />
            <div class="lightbox-name">{{ preview.name }}</div>
          </div>
        </Transition>
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
  max-height: 85vh;
  overflow: auto;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-lg) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
}

.m-heading {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.m-kind {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--radius-full, 999px);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
}

.m-kind.exam {
  background: #fef3c7;
  color: #92400e;
}

.m-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.modal-close {
  flex: none;
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

.meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle, var(--color-bg-surface));
}

.meta-row {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-md);
  font-size: var(--font-size-sm);
}

.meta-k {
  flex: none;
  width: 62px;
  color: var(--color-text-tertiary);
}

.meta-v {
  color: var(--color-text-body);
  overflow-wrap: anywhere;
}

.sec {
  margin-top: var(--spacing-lg);
}

.sec-head {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.sec-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.sec-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.img-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--spacing-sm);
}

.img-cell {
  position: relative;
  margin: 0;
}

.img-btn {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-hover);
  cursor: zoom-in;
}

.img-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.img-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(17, 24, 39, 0.62);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.img-del:hover {
  background: var(--color-feedback-error, #dc2626);
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
}

.file-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 8px var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  color: var(--color-text-body);
  font-size: var(--font-size-sm);
  text-decoration: none;
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.file-main:hover {
  background: var(--color-bg-hover);
}

.file-ic {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
}

.file-ic svg {
  width: 16px;
  height: 16px;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.file-del {
  flex: none;
  padding: 0 4px;
  font-size: var(--font-size-xs);
  color: var(--color-feedback-error, #dc2626);
}

.file-del:hover {
  text-decoration: underline;
}

.empty {
  margin-top: var(--spacing-lg);
  padding: var(--spacing-lg);
  border: 1px dashed var(--color-border-default);
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
  text-align: center;
}

.drop {
  margin-top: var(--spacing-lg);
  padding: var(--spacing-md);
  border: 1px dashed var(--color-border-default);
  border-radius: var(--radius-md);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm) var(--spacing-md);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.drop.over {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.drop-input {
  display: none;
}

.drop-btn {
  height: 34px;
  padding: 0 var(--spacing-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.drop-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.drop-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.drop-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
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
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
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

.lightbox {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-index-modal) + 1);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xl);
  background: rgba(17, 24, 39, 0.86);
  cursor: zoom-out;
}

.lightbox img {
  max-width: min(1100px, 94vw);
  max-height: 82vh;
  object-fit: contain;
  border-radius: var(--radius-md);
  background: #fff;
}

.lightbox-name {
  color: rgba(255, 255, 255, 0.85);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
  text-align: center;
}

.modal-enter-active,
.modal-leave-active,
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-easing-standard);
}

.modal-enter-active .modal {
  transition: transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.modal-enter-from,
.modal-leave-to,
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.modal-enter-from .modal {
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 560px) {
  .modal-mask {
    padding: var(--spacing-md);
  }

  .meta-k {
    width: 56px;
  }
}
</style>
