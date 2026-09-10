<script setup lang="ts">
// 管理员模板管理：模板列表 / 创建 / 编辑 / 删除 / 从学期另存为模板
import { computed, onMounted, reactive, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { api, type TemplateInfo } from '@/api/client'
import type { ImportRow } from '@/utils/pdf'
import { confirm, toast } from '@/utils/ui'

const store = useScheduleStore()

const templates = ref<TemplateInfo[]>([])
const loading = ref(false)
const showEditor = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({ name: '', category: '', description: '', content: '' as string })
const formError = ref('')
const formBusy = ref(false)
const showSaveFromSemester = ref(false)
const saveFromSemesterId = ref<number | null>(null)
const saveFromName = ref('')
const saveFromBusy = ref(false)

const CATEGORIES = ['理论课', '实验课', '混合', '学期', '节次']

onMounted(() => void load())

async function load(): Promise<void> {
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

function openCreate(): void {
  editingId.value = null
  Object.assign(form, { name: '', category: '', description: '', content: '' })
  formError.value = ''
  showEditor.value = true
}

function openEdit(t: TemplateInfo): void {
  editingId.value = t.id
  Object.assign(form, {
    name: t.name,
    category: t.category,
    description: t.description,
    content: JSON.stringify(t.content, null, 1),
  })
  formError.value = ''
  showEditor.value = true
}

function parseContent(): ImportRow[] | null {
  try {
    const arr = JSON.parse(form.content)
    if (!Array.isArray(arr) || arr.length === 0) {
      formError.value = '课程内容须为非空 JSON 数组'
      return null
    }
    return arr
  } catch {
    formError.value = '课程内容不是合法 JSON'
    return null
  }
}

async function save(): Promise<void> {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = '请填写模板名称'
    return
  }
  const content = parseContent()
  if (!content) return
  formBusy.value = true
  try {
    const body = { name: form.name.trim(), category: form.category, description: form.description, content }
    if (editingId.value === null) {
      await api.createTemplate(body)
      toast('模板已创建', 'success')
    } else {
      await api.updateTemplate(editingId.value, body)
      toast('模板已更新（版本 +1）', 'success')
    }
    showEditor.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    formBusy.value = false
  }
}

async function remove(t: TemplateInfo): Promise<void> {
  const ok = await confirm({
    title: '删除模板',
    desc: `将删除模板「${t.name}」。已导入该模板的课程不受影响（快照复制）。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await api.deleteTemplate(t.id)
    await load()
    toast('模板已删除', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
  }
}

/** 从学期另存为模板：把某学期全部课程存为模板 */
function openSaveFromSemester(): void {
  saveFromSemesterId.value = store.currentSemesterId
  saveFromName.value = ''
  showSaveFromSemester.value = true
}

async function saveFromSemester(): Promise<void> {
  if (saveFromSemesterId.value === null) return
  if (!saveFromName.value.trim()) {
    toast('请填写模板名称', 'error')
    return
  }
  saveFromBusy.value = true
  try {
    const list = await api.listCourses(saveFromSemesterId.value)
    if (!list.length) {
      toast('该学期没有课程', 'error')
      return
    }
    const content: ImportRow[] = list.map((c) => ({
      name: c.name,
      type: c.type,
      teacher: c.teacher,
      location: c.location,
      weekType: c.weekType,
      weekList: c.weekList,
      weekday: c.weekday,
      startPeriod: c.startPeriod,
      endPeriod: c.endPeriod,
      remark: c.remark,
    }))
    await api.createTemplate({
      name: saveFromName.value.trim(),
      category: '混合',
      description: `从学期「${store.semesters.find((s) => s.id === saveFromSemesterId.value)?.name ?? ''}」另存`,
      content,
    })
    showSaveFromSemester.value = false
    await load()
    toast(`已保存为模板（${content.length} 门课）`, 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请重试', 'error')
  } finally {
    saveFromBusy.value = false
  }
}

const semesterOptions = computed(() =>
  store.semesters.map((s) => ({ value: s.id, label: s.name })),
)
</script>

<template>
  <div class="tpl-admin">
    <div class="panel-head">
      <h3>课程模板</h3>
      <div class="tpl-admin-actions">
        <button class="btn-mini" type="button" @click="openSaveFromSemester">从学期另存</button>
        <button class="btn-add" type="button" @click="openCreate">＋ 新建模板</button>
      </div>
    </div>
    <p class="panel-note">模板全局共享：所有用户可在"导入课程 → 从模板导入"中一键使用；编辑后版本 +1，已导入用户不受影响</p>

    <div v-if="loading" class="sp-empty">加载中…</div>
    <div v-else-if="!templates.length" class="sp-empty">暂无模板，点击"新建模板"创建</div>
    <div v-else class="tpl-admin-list">
      <div v-for="t in templates" :key="t.id" class="tpl-admin-item">
        <div class="tpl-admin-main">
          <span class="tpl-admin-name">
            {{ t.name }}
            <span class="chip">{{ t.category || '未分类' }}</span>
            <span class="chip">v{{ t.version }}</span>
          </span>
          <span class="tpl-admin-meta num">
            {{ t.content.length }} 门课 · 已导入 {{ t.importCount ?? 0 }} 次
            <template v-if="t.lastImportedAt"> · 最近 {{ t.lastImportedAt.slice(0, 10) }}</template>
          </span>
          <span v-if="t.description" class="tpl-admin-desc">{{ t.description }}</span>
        </div>
        <button class="btn-mini" type="button" @click="openEdit(t)">编辑</button>
        <button class="btn-mini btn-mini--danger" type="button" @click="remove(t)">删除</button>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <div v-if="showEditor" class="modal-mask" @mousedown.self="showEditor = false">
      <div class="modal tpl-editor" role="dialog" aria-modal="true" :aria-label="editingId === null ? '新建模板' : '编辑模板'">
        <h3 class="modal-title">{{ editingId === null ? '新建模板' : '编辑模板' }}</h3>
        <label class="field">
          <span class="field__label">模板名称</span>
          <input v-model="form.name" class="date-input" type="text" placeholder="如：24集成2基础课程" maxlength="50" />
        </label>
        <label class="field">
          <span class="field__label">分类</span>
          <div class="select-wrap">
            <AppSelect
              :model-value="form.category"
              :options="[{ value: '', label: '未分类' }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]"
              aria-label="分类"
              @update:model-value="(v: string | number | null) => form.category = v === null ? '' : String(v)"
            />
          </div>
        </label>
        <label class="field">
          <span class="field__label">描述（选填）</span>
          <input v-model="form.description" class="date-input" type="text" placeholder="适用班级/学期说明" maxlength="200" />
        </label>
        <label class="field">
          <span class="field__label">课程内容（JSON 数组）</span>
          <textarea
            v-model="form.content"
            class="tpl-json"
            rows="10"
            spellcheck="false"
            placeholder='[{"name":"课程名","type":"course","teacher":"","location":"","weekType":"all","weekList":null,"weekday":1,"startPeriod":1,"endPeriod":2,"remark":""}]'
          ></textarea>
          <span class="field__hint">字段：name / type(course|lab) / teacher / location / weekType(all|odd|even|custom) / weekList / weekday(1-7) / startPeriod / endPeriod / remark</span>
        </label>
        <p v-if="formError" class="edit-error" role="alert">{{ formError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="formBusy" @click="showEditor = false">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="formBusy" @click="save">
            {{ formBusy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 从学期另存弹窗 -->
    <div v-if="showSaveFromSemester" class="modal-mask" @mousedown.self="showSaveFromSemester = false">
      <div class="modal" role="dialog" aria-modal="true" aria-label="从学期另存为模板">
        <h3 class="modal-title">从学期另存为模板</h3>
        <label class="field">
          <span class="field__label">来源学期</span>
          <div class="select-wrap">
            <AppSelect
              :model-value="saveFromSemesterId"
              :options="semesterOptions"
              aria-label="来源学期"
              @update:model-value="(v: string | number | null) => saveFromSemesterId = v === null ? null : Number(v)"
            />
          </div>
        </label>
        <label class="field">
          <span class="field__label">模板名称</span>
          <input v-model="saveFromName" class="date-input" type="text" placeholder="如：24集成2基础课程" maxlength="50" />
        </label>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="saveFromBusy" @click="showSaveFromSemester = false">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="saveFromBusy" @click="saveFromSemester">
            {{ saveFromBusy ? '保存中…' : '另存为模板' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpl-admin-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.tpl-admin-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.tpl-admin-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
}

.tpl-admin-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.tpl-admin-name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tpl-admin-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-admin-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.tpl-editor {
  width: min(520px, 100%);
  max-height: 85vh;
  overflow-y: auto;
}

.tpl-json {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: var(--color-text-body);
  resize: vertical;
}

.field__hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.42);
  padding: var(--spacing-lg);
}

.modal {
  width: min(400px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  background: var(--color-bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xl);
}

.modal-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}
</style>
