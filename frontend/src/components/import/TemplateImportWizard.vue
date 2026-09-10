<script setup lang="ts">
// 模板导入向导：选模板 → 预览 → 确认（学期+模式）→ 结果
// 模板 = 管理员维护的课程集合，导入为复制快照，用户可自由微调
import { computed, onMounted, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import AppSelect from '@/components/common/AppSelect.vue'
import { api, type TemplateInfo } from '@/api/client'
import type { ImportRow } from '@/utils/pdf'
import { toast } from '@/utils/ui'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useScheduleStore()

const step = ref<1 | 2 | 3 | 4>(1)
const templates = ref<TemplateInfo[]>([])
const loading = ref(false)
const selected = ref<TemplateInfo | null>(null)
const category = ref('')
const keyword = ref('')
const targetSemesterId = ref<number | null>(null)
const mode = ref<'append' | 'dedupe' | 'overwrite'>('dedupe')
const importing = ref(false)
const result = ref<{ count: number; skipped: number } | null>(null)

const CATEGORIES = ['理论课', '实验课', '混合', '学期', '节次'] as const

onMounted(() => {
  if (props.open) void loadTemplates()
})

/** 打开时重新加载 */
watch(
  () => props.open,
  (v) => {
    if (v) {
      step.value = 1
      selected.value = null
      result.value = null
      targetSemesterId.value = store.currentSemesterId
      void loadTemplates()
    }
  },
)

async function loadTemplates(): Promise<void> {
  loading.value = true
  try {
    const res = await api.listTemplates()
    templates.value = res.templates
  } catch {
    templates.value = []
  } finally {
    loading.value = false
  }
}

const filteredTemplates = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return templates.value.filter((t) => {
    if (category.value && t.category !== category.value) return false
    if (kw && !t.name.toLowerCase().includes(kw) && !t.description.toLowerCase().includes(kw)) return false
    return true
  })
})

const categoryCounts = computed(() => {
  const map: Record<string, number> = {}
  for (const t of templates.value) map[t.category] = (map[t.category] ?? 0) + 1
  return map
})

function pickTemplate(t: TemplateInfo): void {
  selected.value = t
  step.value = 2
}

function back(): void {
  if (step.value > 1) step.value = (step.value - 1) as 1 | 2 | 3
}

async function doImport(): Promise<void> {
  if (!selected.value || targetSemesterId.value === null) return
  importing.value = true
  try {
    const res = await api.importTemplate(selected.value.id, {
      semesterId: targetSemesterId.value,
      mode: mode.value,
    })
    result.value = { count: res.count, skipped: res.skipped }
    step.value = 4
    await store.refreshSchedule()
    await store.loadCourses()
  } catch (e) {
    toast(e instanceof Error ? e.message : '导入失败，请重试', 'error')
  } finally {
    importing.value = false
  }
}

/** 预览：模板课程行 → 按星期分组的节次块 */
const previewByWeekday = computed(() => {
  if (!selected.value) return []
  const map: Record<number, ImportRow[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
  for (const r of selected.value.content) map[r.weekday]?.push(r)
  return [1, 2, 3, 4, 5, 6, 7].map((wd) => ({ weekday: wd, rows: map[wd] }))
})

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function weekLabel(r: ImportRow): string {
  if (r.weekType === 'all') return '每周'
  if (r.weekType === 'odd') return '单周'
  if (r.weekType === 'even') return '双周'
  return r.weekList ? `第${r.weekList.join(',')}周` : '每周'
}

function close(): void {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="tpl-mask" @mousedown.self="close">
        <div class="tpl-panel" role="dialog" aria-modal="true" aria-label="从模板导入">
          <div class="tpl-head">
            <h3>从模板导入</h3>
            <button class="tpl-close" type="button" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <!-- 步骤指示 -->
          <div class="tpl-steps">
            <span :class="{ active: step >= 1 }">1 选择模板</span>
            <span :class="{ active: step >= 2 }">2 预览</span>
            <span :class="{ active: step >= 3 }">3 确认</span>
            <span :class="{ active: step >= 4 }">4 完成</span>
          </div>

          <!-- 步骤 1：模板列表 -->
          <div v-if="step === 1" class="tpl-body">
            <div class="tpl-toolbar">
              <div class="tpl-cats">
                <button class="tpl-cat" :class="{ active: category === '' }" type="button" @click="category = ''">全部</button>
                <button
                  v-for="c in CATEGORIES"
                  :key="c"
                  class="tpl-cat"
                  :class="{ active: category === c }"
                  type="button"
                  @click="category = category === c ? '' : c"
                >
                  {{ c }}<span v-if="categoryCounts[c]" class="tpl-cat-count">{{ categoryCounts[c] }}</span>
                </button>
              </div>
              <input v-model="keyword" class="tpl-search" type="search" placeholder="搜索模板名称…" aria-label="搜索模板" />
            </div>
            <div v-if="loading" class="tpl-empty">加载中…</div>
            <div v-else-if="!filteredTemplates.length" class="tpl-empty">暂无模板，请联系管理员创建</div>
            <div v-else class="tpl-list">
              <button
                v-for="t in filteredTemplates"
                :key="t.id"
                class="tpl-card"
                type="button"
                @click="pickTemplate(t)"
              >
                <span class="tpl-card__name">{{ t.name }}</span>
                <span class="tpl-card__meta">
                  {{ t.category || '未分类' }} · {{ t.content.length }} 门课 · v{{ t.version }}
                  <span v-if="t.importCount" class="tpl-card__used">已导入 {{ t.importCount }} 次</span>
                </span>
                <span v-if="t.description" class="tpl-card__desc">{{ t.description }}</span>
              </button>
            </div>
          </div>

          <!-- 步骤 2：预览 -->
          <div v-else-if="step === 2" class="tpl-body">
            <div class="tpl-preview-head">
              <span class="tpl-preview-title">{{ selected?.name }}（{{ selected?.content.length }} 门课）</span>
              <button class="btn-mini" type="button" @click="back">返回</button>
            </div>
            <div class="tpl-preview">
              <div v-for="(d, i) in previewByWeekday" :key="d.weekday" class="tpl-preview-day">
                <span class="tpl-preview-wd">{{ WEEKDAY_LABELS[i] }}</span>
                <div v-if="d.rows.length" class="tpl-preview-rows">
                  <div v-for="r in d.rows" :key="`${r.name}-${r.startPeriod}`" class="tpl-preview-row">
                    <span class="tpl-preview-name">{{ r.name }}</span>
                    <span class="tpl-preview-meta num">第 {{ r.startPeriod }}{{ r.endPeriod > r.startPeriod ? `–${r.endPeriod}` : '' }} 节 · {{ weekLabel(r) }}</span>
                  </div>
                </div>
                <div v-else class="tpl-preview-empty">—</div>
              </div>
            </div>
            <div class="tpl-actions">
              <button class="btn-mini" type="button" @click="back">上一步</button>
              <button class="btn-mini btn-mini--primary" type="button" @click="step = 3">下一步</button>
            </div>
          </div>

          <!-- 步骤 3：确认 -->
          <div v-else-if="step === 3" class="tpl-body">
            <div class="tpl-confirm">
              <label class="edit-field">
                <span class="edit-field__label">目标学期</span>
                <div class="select-wrap">
                  <AppSelect
                    :model-value="targetSemesterId"
                    :options="store.semesters.map((s) => ({ value: s.id, label: s.name }))"
                    aria-label="目标学期"
                    @update:model-value="(v: string | number | null) => targetSemesterId = v === null ? null : Number(v)"
                  />
                </div>
              </label>
              <fieldset class="tpl-mode">
                <legend class="edit-field__label">导入方式</legend>
                <label class="tpl-mode-item">
                  <input v-model="mode" type="radio" value="dedupe" name="tpl-mode" />
                  <span class="tpl-mode-main">
                    <span class="tpl-mode-title">去重追加（推荐）</span>
                    <span class="tpl-mode-desc">同名同时间的课程自动跳过，重复导入不产生重复课</span>
                  </span>
                </label>
                <label class="tpl-mode-item">
                  <input v-model="mode" type="radio" value="append" name="tpl-mode" />
                  <span class="tpl-mode-main">
                    <span class="tpl-mode-title">追加</span>
                    <span class="tpl-mode-desc">全部导入，与现有课程共存（可能产生重复）</span>
                  </span>
                </label>
                <label class="tpl-mode-item">
                  <input v-model="mode" type="radio" value="overwrite" name="tpl-mode" />
                  <span class="tpl-mode-main">
                    <span class="tpl-mode-title">覆盖</span>
                    <span class="tpl-mode-desc">清空目标学期全部课程后导入（考试/作业关联置空）</span>
                  </span>
                </label>
              </fieldset>
              <p v-if="mode === 'overwrite'" class="tpl-warn">⚠ 覆盖将删除目标学期现有全部课程，此操作不可撤销！</p>
            </div>
            <div class="tpl-actions">
              <button class="btn-mini" type="button" :disabled="importing" @click="back">上一步</button>
              <button class="btn-mini btn-mini--primary" type="button" :disabled="importing || targetSemesterId === null" @click="doImport">
                {{ importing ? '导入中…' : '确认导入' }}
              </button>
            </div>
          </div>

          <!-- 步骤 4：结果 -->
          <div v-else class="tpl-body">
            <div class="tpl-result">
              <div class="tpl-result-icon">✓</div>
              <p class="tpl-result-title">导入完成</p>
              <p class="tpl-result-desc">
                成功导入 <b>{{ result?.count }}</b> 门课程
                <template v-if="result?.skipped">，跳过 <b>{{ result.skipped }}</b> 门重复课程</template>
              </p>
            </div>
            <div class="tpl-actions">
              <button class="btn-mini" type="button" @click="close">关闭</button>
              <button class="btn-mini btn-mini--primary" type="button" @click="step = 1; selected = null">再导入一个模板</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tpl-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  padding: var(--spacing-lg);
}

.tpl-panel {
  width: min(560px, 100%);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

.tpl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-lg) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
}

.tpl-head h3 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.tpl-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
}

.tpl-close:hover {
  background: var(--color-bg-hover);
}

.tpl-close svg {
  width: 16px;
  height: 16px;
}

.tpl-steps {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-steps span.active {
  color: var(--color-brand);
  font-weight: var(--font-weight-bold);
}

.tpl-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-lg) var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.tpl-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.tpl-cats {
  display: flex;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
}

.tpl-cat {
  padding: 4px 12px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
}

.tpl-cat.active {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.tpl-cat-count {
  font-size: 10px;
  margin-left: 3px;
  opacity: 0.7;
}

.tpl-search {
  height: 34px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-md);
}

.tpl-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.tpl-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  text-align: left;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.tpl-card:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-hover);
}

.tpl-card__name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.tpl-card__meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-card__used {
  color: var(--color-brand);
  margin-left: 6px;
}

.tpl-card__desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.tpl-empty {
  padding: var(--spacing-2xl) 0;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.tpl-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tpl-preview-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.tpl-preview {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.tpl-preview-day {
  display: flex;
  gap: var(--spacing-sm);
  align-items: flex-start;
}

.tpl-preview-wd {
  flex: none;
  width: 40px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-secondary);
  padding-top: 4px;
}

.tpl-preview-rows {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tpl-preview-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 4px 8px;
  background: var(--color-bg-page);
  border-radius: var(--radius-sm);
}

.tpl-preview-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tpl-preview-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  flex: none;
}

.tpl-preview-empty {
  flex: 1;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  padding-top: 4px;
}

.tpl-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--color-border-default);
}

.tpl-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.tpl-mode {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  border: none;
  padding: 0;
}

.tpl-mode-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.tpl-mode-item:has(input:checked) {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.tpl-mode-item input {
  margin-top: 3px;
  accent-color: var(--color-brand);
}

.tpl-mode-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tpl-mode-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.tpl-mode-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-warn {
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid var(--color-danger-line, #fecaca);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
}

.tpl-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xl) 0;
}

.tpl-result-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-size: 24px;
  font-weight: var(--font-weight-heavy);
}

.tpl-result-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.tpl-result-desc {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
}

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
</style>
