<script setup lang="ts">
// 模板市场：模板浏览/搜索/一键导入 + 管理员管理（创建/编辑/删除/另存为模板）
// 与周课表/今天并排的独立页面
import { computed, onMounted, reactive, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import AppSelect from '@/components/common/AppSelect.vue'
import { api, type TemplateInfo } from '@/api/client'
import type { ImportRow } from '@/utils/pdf'
import { confirm, toast } from '@/utils/ui'

const store = useScheduleStore()

const templates = ref<TemplateInfo[]>([])
const loading = ref(false)
const keyword = ref('')
/** 类型 Tab：course=课程模板（勾选批量导入）/ unit=组合模板（一键导入） */
const kindTab = ref<'course' | 'unit'>('course')
/** 课程模板勾选（批量导入） */
const selectedIds = ref<Set<number>>(new Set())

// 导入流程状态
const importing = ref<TemplateInfo | null>(null)
const importSemesterId = ref<number | null>(null)
const importMode = ref<'dedupe' | 'append' | 'overwrite'>('dedupe')
const importBusy = ref(false)
const importError = ref('')
const importResult = ref<{ count: number; skipped: number } | null>(null)

// 预览状态
const previewing = ref<TemplateInfo | null>(null)

/** 打开预览弹窗 */
function openPreview(t: TemplateInfo): void {
  previewing.value = t
}

/** 从预览进入导入 */
function previewToImport(): void {
  if (!previewing.value) return
  const t = previewing.value
  previewing.value = null
  openImport(t)
}

/** 切换类型 Tab 时清空勾选 */
function switchKind(k: 'course' | 'unit'): void {
  kindTab.value = k
  selectedIds.value = new Set()
}

/** 勾选/取消课程模板 */
function toggleSelect(t: TemplateInfo): void {
  const next = new Set(selectedIds.value)
  if (next.has(t.id)) next.delete(t.id)
  else next.add(t.id)
  selectedIds.value = next
}

/** 全选/取消当前过滤列表 */
function toggleSelectAll(): void {
  const visible = filteredTemplates.value
  const allSelected = visible.every((t) => selectedIds.value.has(t.id))
  const next = new Set(selectedIds.value)
  if (allSelected) for (const t of visible) next.delete(t.id)
  else for (const t of visible) next.add(t.id)
  selectedIds.value = next
}

/** 批量导入所选课程模板 */
function openBatchImport(): void {
  if (selectedIds.value.size === 0) return
  importing.value = null
  importSemesterId.value = store.currentSemesterId
  importMode.value = 'dedupe'
  importError.value = ''
  importResult.value = null
  batchImporting.value = true
}

const batchImporting = ref(false)

async function doBatchImport(): Promise<void> {
  if (selectedIds.value.size === 0 || importSemesterId.value === null) return
  importBusy.value = true
  importError.value = ''
  try {
    const res = await api.importTemplate(0, {
      semesterId: importSemesterId.value,
      mode: importMode.value,
      templateIds: [...selectedIds.value],
    })
    importResult.value = { count: res.count, skipped: res.skipped }
    selectedIds.value = new Set()
    batchImporting.value = false
    await store.refreshSchedule()
    await store.loadCourses()
    await load()
  } catch (e) {
    importError.value = e instanceof Error ? e.message : '导入失败，请重试'
  } finally {
    importBusy.value = false
  }
}

// 管理员编辑状态（course=单门课程行 / unit=引用课程模板 id 列表）
const showEditor = ref(false)
const editingId = ref<number | null>(null)
const editingKind = ref<'course' | 'unit'>('course')
const form = reactive({ name: '', category: '', description: '' })
const formError = ref('')
const formBusy = ref(false)
const rows = ref<ImportRow[]>([])
const unitIds = ref<number[]>([])
const showRowEditor = ref(false)
const rowEditingIndex = ref<number | null>(null)
const rowForm = reactive({
  name: '',
  type: 'course' as 'course' | 'lab',
  teacher: '',
  location: '',
  weekday: 1 as number,
  startPeriod: 1,
  endPeriod: 2,
  weekType: 'all' as ImportRow['weekType'],
  weekList: [] as number[],
  remark: '',
})
const rowError = ref('')
const showSaveFromSemester = ref(false)
const saveFromSemesterId = ref<number | null>(null)
const saveFromName = ref('')
const saveFromBusy = ref(false)

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

const filteredTemplates = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return templates.value.filter((t) => {
    if (t.kind !== kindTab.value) return false
    if (kw && !t.name.toLowerCase().includes(kw) && !t.description.toLowerCase().includes(kw)) return false
    return true
  })
})

// ================= 导入 =================
function openImport(t: TemplateInfo): void {
  importing.value = t
  importSemesterId.value = store.currentSemesterId
  importMode.value = 'dedupe'
  importError.value = ''
  importResult.value = null
}

async function doImport(): Promise<void> {
  if (!importing.value || importSemesterId.value === null) return
  importBusy.value = true
  importError.value = ''
  try {
    const res = await api.importTemplate(importing.value.id, {
      semesterId: importSemesterId.value,
      mode: importMode.value,
    })
    importResult.value = { count: res.count, skipped: res.skipped }
    await store.refreshSchedule()
    await store.loadCourses()
    await load()
  } catch (e) {
    importError.value = e instanceof Error ? e.message : '导入失败，请重试'
  } finally {
    importBusy.value = false
  }
}

const CATEGORIES = ['理论课', '实验课', '混合', '学期', '节次']
const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const MAX_WEEKS = 30

const weekdayOptions = WEEKDAY_LABELS.map((label, i) => ({ value: i + 1, label }))
const periodOptions = computed(() =>
  store.periods.map((p) => ({ value: p.index, label: `第 ${p.index} 节 ${p.startTime}–${p.endTime}` })),
)
const weekChips = computed(() => Array.from({ length: MAX_WEEKS }, (_, i) => i + 1))

function weekLabelOf(r: ImportRow): string {
  if (r.weekType === 'all') return '每周'
  if (r.weekType === 'odd') return '单周'
  if (r.weekType === 'even') return '双周'
  return r.weekList?.length ? `第 ${r.weekList.join(',')} 周` : '每周'
}

function openCreate(kind: 'course' | 'unit'): void {
  editingId.value = null
  editingKind.value = kind
  Object.assign(form, { name: '', category: '', description: '' })
  rows.value = []
  unitIds.value = []
  formError.value = ''
  showEditor.value = true
}

function openEdit(t: TemplateInfo): void {
  editingId.value = t.id
  editingKind.value = t.kind
  Object.assign(form, { name: t.name, category: t.category, description: t.description })
  if (t.kind === 'course') {
    rows.value = (t.content as ImportRow[]).map((r) => ({ ...r, weekList: r.weekList ? [...r.weekList] : null }))
    unitIds.value = []
  } else {
    rows.value = []
    unitIds.value = [...(t.content as number[])]
  }
  formError.value = ''
  showEditor.value = true
}

/** 组合模板：可引用的课程模板列表 */
const courseTemplates = computed(() => templates.value.filter((t) => t.kind === 'course'))

/** 组合模板：勾选/取消引用的课程模板 */
function toggleUnitRef(id: number): void {
  const i = unitIds.value.indexOf(id)
  if (i >= 0) unitIds.value.splice(i, 1)
  else unitIds.value.push(id)
}

/** 打开课程行编辑表单（新增或编辑） */
function openRowEditor(index: number | null): void {
  rowEditingIndex.value = index
  rowError.value = ''
  if (index === null) {
    Object.assign(rowForm, {
      name: '', type: 'course' as const, teacher: '', location: '',
      weekday: 1, startPeriod: 1, endPeriod: 2, weekType: 'all' as const, weekList: [], remark: '',
    })
  } else {
    const r = rows.value[index]
    Object.assign(rowForm, {
      name: r.name, type: r.type, teacher: r.teacher, location: r.location,
      weekday: r.weekday, startPeriod: r.startPeriod, endPeriod: r.endPeriod,
      weekType: r.weekType, weekList: r.weekList ? [...r.weekList] : [], remark: r.remark,
    })
  }
  showRowEditor.value = true
}

function toggleRowWeek(w: number): void {
  const i = rowForm.weekList.indexOf(w)
  if (i >= 0) rowForm.weekList.splice(i, 1)
  else rowForm.weekList.push(w)
}

function saveRow(): void {
  rowError.value = ''
  if (!rowForm.name.trim()) {
    rowError.value = '请填写课程名称'
    return
  }
  if (rowForm.startPeriod > rowForm.endPeriod) {
    rowError.value = '结束节次不能早于起始节次'
    return
  }
  if (rowForm.weekType === 'custom' && rowForm.weekList.length === 0) {
    rowError.value = '请选择至少一个周次'
    return
  }
  const row: ImportRow = {
    name: rowForm.name.trim(),
    type: rowForm.type,
    teacher: rowForm.teacher.trim(),
    location: rowForm.location.trim(),
    weekType: rowForm.weekType,
    weekList: rowForm.weekType === 'custom' ? [...rowForm.weekList].sort((a, b) => a - b) : null,
    weekday: rowForm.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    startPeriod: rowForm.startPeriod,
    endPeriod: rowForm.endPeriod,
    remark: rowForm.remark.trim(),
  }
  if (rowEditingIndex.value === null) rows.value.push(row)
  else rows.value[rowEditingIndex.value] = row
  showRowEditor.value = false
}

function removeRow(i: number): void {
  rows.value.splice(i, 1)
}

async function save(): Promise<void> {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = '请填写模板名称'
    return
  }
  if (editingKind.value === 'course' && rows.value.length === 0) {
    formError.value = '请至少添加一门课程'
    return
  }
  if (editingKind.value === 'unit' && unitIds.value.length === 0) {
    formError.value = '请至少勾选一门课程模板'
    return
  }
  formBusy.value = true
  try {
    const body = {
      kind: editingKind.value,
      name: form.name.trim(),
      category: form.category,
      description: form.description,
      content: editingKind.value === 'course' ? rows.value : unitIds.value,
    }
    if (editingId.value === null) {
      await api.createTemplate(body)
      toast(editingKind.value === 'course' ? '课程模板已创建' : '组合模板已创建', 'success')
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
      kind: 'unit',
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

/** 预览：模板课程行 → 按星期分组（预览弹窗与导入弹窗共用；unit 展开引用） */
const previewByWeekday = computed(() => {
  const t = previewing.value ?? importing.value
  if (!t) return []
  const rows = t.kind === 'course' ? (t.content as ImportRow[]) : []
  const map: Record<number, ImportRow[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
  for (const r of rows) map[r.weekday]?.push(r)
  return [1, 2, 3, 4, 5, 6, 7].map((wd) => ({ weekday: wd, rows: map[wd] }))
})

/** 周课表网格预览：7 天 × 12 节，同一格堆叠显示该时段全部课程（含周次标签） */
const GRID_PERIODS = 12

/** 某天某节显示的课程：仅起始于该节的课（跨行课只在起始节显示，非起始节跳过） */
function coursesAt(weekday: number, period: number): ImportRow[] {
  const day = previewByWeekday.value.find((d) => d.weekday === weekday)
  if (!day) return []
  return day.rows.filter((r) => r.startPeriod === period)
}

/** 该位置是否跳过渲染：无起始课（被跨行课覆盖的中间/结束节次，由起始格显示） */
function shouldSkip(weekday: number, period: number): boolean {
  return coursesAt(weekday, period).length === 0
}

/** 起始节次格的跨行范围：仅单门跨行课程时合并；多门课堆叠不跨行 */
function spanOf(weekday: number, period: number): { start: number; end: number } | null {
  const courses = coursesAt(weekday, period)
  if (courses.length !== 1) return null
  const c = courses[0]
  if (c.endPeriod <= c.startPeriod) return null
  return { start: c.startPeriod, end: c.endPeriod }
}

/** 周次标签（网格内显示） */
function weekTag(r: ImportRow): string {
  if (r.weekType === 'all') return '每周'
  if (r.weekType === 'odd') return '单周'
  if (r.weekType === 'even') return '双周'
  return r.weekList?.length ? `第${r.weekList.join(',')}周` : ''
}

function weekLabel(r: ImportRow): string {
  if (r.weekType === 'all') return '每周'
  if (r.weekType === 'odd') return '单周'
  if (r.weekType === 'even') return '双周'
  return r.weekList ? `第${r.weekList.join(',')}周` : '每周'
}
</script>

<template>
  <div class="page templates-view">
    <div class="tpl-head">
      <div class="tpl-head-main">
        <h2 class="tpl-title">模板市场</h2>
        <p class="tpl-sub">班级共享课程模板，一键导入到你的课表</p>
      </div>
      <div v-if="store.currentUser?.role === 'admin'" class="tpl-admin-actions">
        <button class="btn-mini" type="button" @click="openSaveFromSemester">从学期另存</button>
        <button class="btn-mini" type="button" @click="openCreate('course')">＋ 新建课程模板</button>
        <button class="btn-add" type="button" @click="openCreate('unit')">＋ 新建组合模板</button>
      </div>
    </div>

    <!-- 类型 Tab：课程模板（勾选批量导入）/ 组合模板（一键导入） -->
    <div class="tpl-kind-tabs reveal" role="tablist" aria-label="模板类型">
      <button
        class="tpl-kind-tab" :class="{ active: kindTab === 'course' }" type="button" role="tab"
        :aria-selected="kindTab === 'course'" @click="switchKind('course')"
      >课程模板<span class="tpl-kind-count">{{ templates.filter((t) => t.kind === 'course').length }}</span></button>
      <button
        class="tpl-kind-tab" :class="{ active: kindTab === 'unit' }" type="button" role="tab"
        :aria-selected="kindTab === 'unit'" @click="switchKind('unit')"
      >组合模板<span class="tpl-kind-count">{{ templates.filter((t) => t.kind === 'unit').length }}</span></button>
    </div>

    <!-- 工具栏：搜索 -->
    <div class="tpl-toolbar reveal">
      <input v-model="keyword" class="tpl-search" type="search" placeholder="搜索模板名称…" aria-label="搜索模板" />
    </div>

    <!-- 课程模板：全选 + 批量导入栏 -->
    <div v-if="kindTab === 'course' && filteredTemplates.length" class="tpl-batch-bar reveal">
      <label class="tpl-batch-all">
        <input type="checkbox" :checked="filteredTemplates.every((t) => selectedIds.has(t.id))" @change="toggleSelectAll" />
        <span>全选当前列表</span>
      </label>
      <span class="tpl-batch-count num">已选 {{ selectedIds.size }} 门</span>
      <button class="btn-mini btn-mini--primary" type="button" :disabled="selectedIds.size === 0" @click="openBatchImport">
        批量导入所选
      </button>
    </div>

    <!-- 模板卡片网格 -->
    <div v-if="loading" class="tpl-empty reveal">加载中…</div>
    <div v-else-if="!filteredTemplates.length" class="tpl-empty reveal">
      <p>暂无{{ kindTab === 'course' ? '课程' : '组合' }}模板</p>
      <p v-if="store.currentUser?.role === 'admin'" class="tpl-empty-hint">
        {{ kindTab === 'course' ? '点击右上角"新建课程模板"创建单门课程模板' : '点击右上角"新建组合模板"，从课程模板勾选组成' }}
      </p>
      <p v-else class="tpl-empty-hint">请联系管理员创建班级课程模板</p>
    </div>
    <div v-else class="tpl-grid reveal">
      <div v-for="t in filteredTemplates" :key="t.id" class="tpl-card" :class="{ selected: selectedIds.has(t.id) }" role="button" tabindex="0" :aria-label="`预览模板 ${t.name}`" @click="openPreview(t)" @keydown.enter="openPreview(t)">
        <div class="tpl-card__head">
          <span v-if="kindTab === 'course'" class="tpl-check" @click.stop="toggleSelect(t)">
            <input type="checkbox" :checked="selectedIds.has(t.id)" :aria-label="`选择 ${t.name}`" @change="toggleSelect(t)" />
          </span>
          <span class="tpl-card__name">{{ t.name }}</span>
          <span v-if="t.category" class="chip">{{ t.category }}</span>
        </div>
        <p v-if="t.description" class="tpl-card__desc">{{ t.description }}</p>
        <div class="tpl-card__meta num">
          {{ t.content.length }} 门课 · v{{ t.version }}
          <span v-if="t.importCount" class="tpl-card__used">已导入 {{ t.importCount }} 次</span>
        </div>
        <div class="tpl-card__actions" @click.stop>
          <button class="btn-mini btn-mini--primary" type="button" @click="openImport(t)">一键导入</button>
          <template v-if="store.currentUser?.role === 'admin'">
            <button class="btn-mini" type="button" @click="openEdit(t)">编辑</button>
            <button class="btn-mini btn-mini--danger" type="button" @click="remove(t)">删除</button>
          </template>
        </div>
      </div>
    </div>

    <!-- 模板预览弹窗 -->
    <div v-if="previewing" class="modal-mask" @mousedown.self="previewing = null">
      <div class="modal tpl-preview-modal" role="dialog" aria-modal="true" :aria-label="`预览模板 ${previewing.name}`">
        <div class="tpl-preview-head">
          <div class="tpl-preview-head-main">
            <h3 class="modal-title">{{ previewing.name }}</h3>
            <span class="tpl-preview-meta num">
              <span v-if="previewing.category" class="chip">{{ previewing.category }}</span>
              {{ previewing.content.length }} 门课 · v{{ previewing.version }}
              <span v-if="previewing.importCount" class="tpl-card__used">已导入 {{ previewing.importCount }} 次</span>
            </span>
            <span v-if="previewing.description" class="tpl-preview-desc">{{ previewing.description }}</span>
          </div>
          <button class="tpl-close" type="button" aria-label="关闭" @click="previewing = null">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <!-- 周课表网格预览：7 天 × 12 节，同格堆叠显示不同周次的课程 -->
        <div class="tpl-grid-preview" aria-label="课程预览网格">
          <div class="tpl-grid-preview__grid">
            <div class="tpl-grid-preview__head p-h">节次</div>
            <div v-for="wd in 7" :key="'h' + wd" class="tpl-grid-preview__head">{{ WEEKDAY_LABELS[wd - 1] }}</div>
            <template v-for="p in GRID_PERIODS" :key="'r' + p">
              <div class="tpl-grid-preview__period">{{ p }}</div>
              <template v-for="wd in 7" :key="'c' + wd + '-' + p">
                <div
                  v-if="!shouldSkip(wd, p)"
                  class="tpl-grid-preview__cell"
                  :class="{ 'has-course': coursesAt(wd, p).length > 0 }"
                  :style="{
                    gridColumn: String(wd + 1),
                    ...(spanOf(wd, p) ? { gridRow: `${spanOf(wd, p)!.start + 1} / ${spanOf(wd, p)!.end + 2}` } : {}),
                  }"
                >
                  <div
                    v-for="r in coursesAt(wd, p)"
                    :key="`${r.name}-${r.startPeriod}`"
                    class="tpl-grid-preview__course"
                    :class="{ 'is-lab': r.type === 'lab' }"
                  >
                    <span class="tpl-grid-preview__cname">{{ r.name }}</span>
                    <span v-if="weekTag(r)" class="tpl-grid-preview__cweek num">{{ weekTag(r) }}</span>
                  </div>
                </div>
              </template>
            </template>
          </div>
        </div>

        <div class="edit-actions">
          <button class="btn-mini" type="button" @click="previewing = null">关闭</button>
          <button class="btn-mini btn-mini--primary" type="button" @click="previewToImport">一键导入</button>
        </div>
      </div>
    </div>

    <!-- 导入弹窗（单模板 / 批量） -->
    <div v-if="importing || batchImporting" class="modal-mask" @mousedown.self="importing = null; batchImporting = false">
      <div class="modal tpl-import-modal" role="dialog" aria-modal="true" :aria-label="batchImporting ? '批量导入课程模板' : `导入模板 ${importing?.name}`">
        <h3 class="modal-title">{{ batchImporting ? `批量导入所选课程模板（${selectedIds.size} 门）` : `导入「${importing?.name}」` }}</h3>

        <!-- 预览（单模板） -->
        <div v-if="!batchImporting" class="tpl-preview">
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

        <!-- 确认 -->
        <template v-if="!importResult">
          <label class="field">
            <span class="field__label">目标学期</span>
            <div class="select-wrap">
              <AppSelect
                :model-value="importSemesterId"
                :options="semesterOptions"
                aria-label="目标学期"
                @update:model-value="(v: string | number | null) => importSemesterId = v === null ? null : Number(v)"
              />
            </div>
          </label>
          <fieldset class="tpl-mode">
            <legend class="field__label">导入方式</legend>
            <label class="tpl-mode-item">
              <input v-model="importMode" type="radio" value="dedupe" name="tpl-mode" />
              <span class="tpl-mode-main">
                <span class="tpl-mode-title">去重追加（推荐）</span>
                <span class="tpl-mode-desc">同名同时间的课程自动跳过，重复导入不产生重复课</span>
              </span>
            </label>
            <label class="tpl-mode-item">
              <input v-model="importMode" type="radio" value="append" name="tpl-mode" />
              <span class="tpl-mode-main">
                <span class="tpl-mode-title">追加</span>
                <span class="tpl-mode-desc">全部导入，与现有课程共存（可能产生重复）</span>
              </span>
            </label>
            <label class="tpl-mode-item">
              <input v-model="importMode" type="radio" value="overwrite" name="tpl-mode" />
              <span class="tpl-mode-main">
                <span class="tpl-mode-title">覆盖</span>
                <span class="tpl-mode-desc">清空目标学期全部课程后导入（考试/作业关联置空）</span>
              </span>
            </label>
          </fieldset>
          <p v-if="importMode === 'overwrite'" class="tpl-warn">⚠ 覆盖将删除目标学期现有全部课程，此操作不可撤销！</p>
          <p v-if="importError" class="edit-error" role="alert">{{ importError }}</p>
          <div class="edit-actions">
            <button class="btn-mini" type="button" :disabled="importBusy" @click="importing = null; batchImporting = false">取消</button>
            <button class="btn-mini btn-mini--primary" type="button" :disabled="importBusy || importSemesterId === null" @click="batchImporting ? doBatchImport() : doImport()">
              {{ importBusy ? '导入中…' : '确认导入' }}
            </button>
          </div>
        </template>

        <!-- 结果 -->
        <template v-else>
          <div class="tpl-result">
            <div class="tpl-result-icon">✓</div>
            <p class="tpl-result-title">导入完成</p>
            <p class="tpl-result-desc">
              成功导入 <b>{{ importResult.count }}</b> 门课程
              <template v-if="importResult.skipped">，跳过 <b>{{ importResult.skipped }}</b> 门重复课程</template>
            </p>
          </div>
          <div class="edit-actions">
            <button class="btn-mini" type="button" @click="importing = null">关闭</button>
            <button class="btn-mini btn-mini--primary" type="button" @click="importing = null; importResult = null">再导入一个</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 创建/编辑弹窗（admin；course=课程行编辑器 / unit=勾选课程模板） -->
    <div v-if="showEditor" class="modal-mask" @mousedown.self="showEditor = false">
      <div class="modal tpl-editor" role="dialog" aria-modal="true" :aria-label="editingId === null ? '新建模板' : '编辑模板'">
        <h3 class="modal-title">{{ editingId === null ? (editingKind === 'course' ? '新建课程模板' : '新建组合模板') : '编辑模板' }}</h3>
        <div class="tpl-editor-fields">
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
        </div>

        <!-- course：课程行列表 -->
        <template v-if="editingKind === 'course'">
          <div class="tpl-rows-head">
            <span class="field__label">课程列表（{{ rows.length }} 门）</span>
            <button class="btn-mini btn-mini--primary" type="button" @click="openRowEditor(null)">＋ 添加课程</button>
          </div>
          <div v-if="rows.length" class="tpl-rows">
            <div v-for="(r, i) in rows" :key="i" class="tpl-row">
              <div class="tpl-row-main">
                <span class="tpl-row-name">
                  {{ r.name }}
                  <span class="chip" :class="r.type === 'lab' ? 'chip--lab' : ''">{{ r.type === 'lab' ? '实验' : '理论' }}</span>
                </span>
                <span class="tpl-row-meta num">
                  {{ WEEKDAY_LABELS[r.weekday - 1] }} · 第 {{ r.startPeriod }}{{ r.endPeriod > r.startPeriod ? `–${r.endPeriod}` : '' }} 节 · {{ weekLabelOf(r) }}
                  <template v-if="r.teacher || r.location"> · {{ r.teacher }}{{ r.location ? ` / ${r.location}` : '' }}</template>
                </span>
              </div>
              <button class="btn-mini" type="button" @click="openRowEditor(i)">编辑</button>
              <button class="btn-mini btn-mini--danger" type="button" @click="removeRow(i)">删除</button>
            </div>
          </div>
          <div v-else class="tpl-rows-empty">还没有课程，点击"添加课程"开始</div>
        </template>

        <!-- unit：勾选课程模板组成 -->
        <template v-else>
          <div class="tpl-rows-head">
            <span class="field__label">包含课程模板（{{ unitIds.length }} 门）</span>
            <span class="tpl-unit-hint">从下方课程模板勾选，管理员修改课程模板后组合自动生效</span>
          </div>
          <div v-if="courseTemplates.length" class="tpl-unit-list">
            <label v-for="ct in courseTemplates" :key="ct.id" class="tpl-unit-item" :class="{ checked: unitIds.includes(ct.id) }">
              <input type="checkbox" :checked="unitIds.includes(ct.id)" @change="toggleUnitRef(ct.id)" />
              <span class="tpl-unit-main">
                <span class="tpl-unit-name">{{ ct.name }}</span>
                <span class="tpl-unit-meta num">{{ (ct.content as ImportRow[])[0]?.name }} · {{ WEEKDAY_LABELS[((ct.content as ImportRow[])[0]?.weekday ?? 1) - 1] }} 第 {{ (ct.content as ImportRow[])[0]?.startPeriod }} 节</span>
              </span>
            </label>
          </div>
          <div v-else class="tpl-rows-empty">还没有课程模板，请先在"课程模板"页创建</div>
        </template>

        <p v-if="formError" class="edit-error" role="alert">{{ formError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="formBusy" @click="showEditor = false">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="formBusy" @click="save">
            {{ formBusy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 课程行编辑弹窗（图形化表单） -->
    <div v-if="showRowEditor" class="modal-mask" @mousedown.self="showRowEditor = false">
      <div class="modal tpl-row-modal" role="dialog" aria-modal="true" :aria-label="rowEditingIndex === null ? '添加课程' : '编辑课程'">
        <h3 class="modal-title">{{ rowEditingIndex === null ? '添加课程' : '编辑课程' }}</h3>
        <label class="field">
          <span class="field__label">课程名称</span>
          <input v-model="rowForm.name" class="date-input" type="text" placeholder="如：数字信号处理" maxlength="50" />
        </label>
        <fieldset class="field">
          <legend class="field__label">课程类型</legend>
          <div class="seg">
            <label class="seg-item" :class="{ checked: rowForm.type === 'course' }">
              <input v-model="rowForm.type" type="radio" value="course" name="row-type" />
              <span class="seg-item__dot"></span>
              <span>理论课</span>
            </label>
            <label class="seg-item" :class="{ checked: rowForm.type === 'lab' }">
              <input v-model="rowForm.type" type="radio" value="lab" name="row-type" />
              <span class="seg-item__dot"></span>
              <span>实验课</span>
            </label>
          </div>
        </fieldset>
        <div class="tpl-row-grid">
          <label class="field">
            <span class="field__label">教师</span>
            <input v-model="rowForm.teacher" class="date-input" type="text" placeholder="选填" maxlength="30" />
          </label>
          <label class="field">
            <span class="field__label">地点</span>
            <input v-model="rowForm.location" class="date-input" type="text" placeholder="选填" maxlength="50" />
          </label>
          <label class="field">
            <span class="field__label">星期</span>
            <div class="select-wrap">
              <AppSelect
                :model-value="rowForm.weekday"
                :options="weekdayOptions"
                aria-label="星期"
                @update:model-value="(v: string | number | null) => rowForm.weekday = v === null ? 1 : Number(v)"
              />
            </div>
          </label>
          <label class="field">
            <span class="field__label">节次</span>
            <div class="tpl-period-pair">
              <div class="select-wrap">
                <AppSelect
                  :model-value="rowForm.startPeriod"
                  :options="periodOptions"
                  aria-label="起始节次"
                  @update:model-value="(v: string | number | null) => rowForm.startPeriod = v === null ? 1 : Number(v)"
                />
              </div>
              <span class="tpl-period-dash">–</span>
              <div class="select-wrap">
                <AppSelect
                  :model-value="rowForm.endPeriod"
                  :options="periodOptions"
                  aria-label="结束节次"
                  @update:model-value="(v: string | number | null) => rowForm.endPeriod = v === null ? 1 : Number(v)"
                />
              </div>
            </div>
          </label>
        </div>
        <fieldset class="field">
          <legend class="field__label">周次规则</legend>
          <div class="seg">
            <label class="seg-item" :class="{ checked: rowForm.weekType === 'all' }">
              <input v-model="rowForm.weekType" type="radio" value="all" name="row-week" />
              <span class="seg-item__dot"></span>
              <span>每周</span>
            </label>
            <label class="seg-item" :class="{ checked: rowForm.weekType === 'odd' }">
              <input v-model="rowForm.weekType" type="radio" value="odd" name="row-week" />
              <span class="seg-item__dot"></span>
              <span>单周</span>
            </label>
            <label class="seg-item" :class="{ checked: rowForm.weekType === 'even' }">
              <input v-model="rowForm.weekType" type="radio" value="even" name="row-week" />
              <span class="seg-item__dot"></span>
              <span>双周</span>
            </label>
            <label class="seg-item" :class="{ checked: rowForm.weekType === 'custom' }">
              <input v-model="rowForm.weekType" type="radio" value="custom" name="row-week" />
              <span class="seg-item__dot"></span>
              <span>自定义</span>
            </label>
          </div>
        </fieldset>
        <div v-if="rowForm.weekType === 'custom'" class="field">
          <span class="field__label">选择周次（可多选）</span>
          <div class="week-chips">
            <button
              v-for="w in weekChips"
              :key="w"
              class="week-chip"
              :class="{ active: rowForm.weekList.includes(w) }"
              type="button"
              @click="toggleRowWeek(w)"
            >{{ w }}</button>
          </div>
        </div>
        <p v-if="rowError" class="edit-error" role="alert">{{ rowError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" @click="showRowEditor = false">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" @click="saveRow">确定</button>
        </div>
      </div>
    </div>

    <!-- 从学期另存弹窗（admin） -->
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
.templates-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--spacing-lg);
}

.tpl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.tpl-title {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.tpl-sub {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.tpl-admin-actions {
  display: flex;
  gap: var(--spacing-sm);
  flex: none;
}

.tpl-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
}

/* 类型 Tab */
.tpl-kind-tabs {
  display: flex;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border-default);
}

.tpl-kind-tab {
  padding: 6px 16px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.tpl-kind-tab:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-body);
}

.tpl-kind-tab.active {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.tpl-kind-count {
  font-size: 10px;
  margin-left: 4px;
  opacity: 0.7;
}

/* 批量导入栏 */
.tpl-batch-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  margin-bottom: var(--spacing-md);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}

.tpl-batch-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
  cursor: pointer;
}

.tpl-batch-all input {
  accent-color: var(--color-brand);
}

.tpl-batch-count {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

/* 课程模板勾选 */
.tpl-check {
  display: flex;
  align-items: center;
  flex: none;
}

.tpl-check input {
  width: 15px;
  height: 15px;
  accent-color: var(--color-brand);
  cursor: pointer;
}

.tpl-card.selected {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

/* 组合模板：勾选课程模板列表 */
.tpl-unit-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-unit-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-height: 260px;
  overflow-y: auto;
}

.tpl-unit-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.tpl-unit-item:hover {
  background: var(--color-bg-hover);
}

.tpl-unit-item.checked {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.tpl-unit-item input {
  accent-color: var(--color-brand);
}

.tpl-unit-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tpl-unit-name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.tpl-unit-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-cats {
  display: flex;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
}

.tpl-cat {
  padding: 5px 14px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
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
  height: 36px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-md);
  max-width: 360px;
}

.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-md);
}

.tpl-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: box-shadow var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard),
    border-color var(--motion-duration-normal) var(--motion-easing-standard);
}

.tpl-card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
  border-color: var(--color-border-strong);
}

.tpl-card:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.tpl-card__head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.tpl-card__name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tpl-card__desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  min-height: 1.4em;
}

.tpl-card__meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-card__used {
  color: var(--color-brand);
  margin-left: 6px;
}

.tpl-card__actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: auto;
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--color-border-default);
}

.tpl-empty {
  padding: var(--spacing-2xl) 0;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.tpl-empty-hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

/* 弹窗 */
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  padding: var(--spacing-lg);
}

.modal {
  width: min(400px, 100%);
  max-height: 85vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  background: var(--color-bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xl);
}

.tpl-import-modal {
  width: min(520px, 100%);
}

/* 预览弹窗 */
.tpl-preview-modal {
  width: min(720px, 100%);
}

.tpl-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.tpl-preview-head-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.tpl-preview-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  flex-wrap: wrap;
}

.tpl-preview-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.tpl-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  flex: none;
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.tpl-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-body);
}

.tpl-close svg {
  width: 16px;
  height: 16px;
}

.modal-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

/* 周课表网格预览 */
.tpl-grid-preview {
  overflow-x: auto;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  max-height: 320px;
  overflow-y: auto;
}

.tpl-grid-preview__grid {
  display: grid;
  grid-template-columns: 36px repeat(7, minmax(72px, 1fr));
  grid-template-rows: auto repeat(12, minmax(30px, auto));
  min-width: 620px;
}

.tpl-grid-preview__head {
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-align: center;
  border-bottom: 1px solid var(--color-border-default);
}

.tpl-grid-preview__period {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
}

.tpl-grid-preview__cell {
  min-height: 30px;
  padding: 2px;
  border-bottom: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tpl-grid-preview__course {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-brand-line);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-size: 10px;
  line-height: 1.3;
  text-align: center;
}

.tpl-grid-preview__course.is-lab {
  border-color: var(--course-3-line);
  background: var(--course-3-bg);
  color: var(--course-3-text);
}

.tpl-grid-preview__cname {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tpl-grid-preview__cweek {
  font-size: 9px;
  opacity: 0.75;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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

.tpl-editor {
  width: min(560px, 100%);
}

.tpl-editor-fields {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.tpl-rows-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.tpl-rows {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-height: 260px;
  overflow-y: auto;
}

.tpl-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  background: var(--color-bg-page);
  border-radius: var(--radius-sm);
}

.tpl-row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tpl-row-name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
  display: flex;
  align-items: center;
  gap: 6px;
}

.tpl-row-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-rows-empty {
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
}

.chip--lab {
  color: var(--course-3-text);
  background: var(--course-3-bg);
  border: 1px solid var(--course-3-line);
}

.tpl-row-modal {
  width: min(480px, 100%);
}

.tpl-row-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-sm);
}

.tpl-period-pair {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tpl-period-dash {
  color: var(--color-text-tertiary);
  flex: none;
}

.week-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.week-chip {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.week-chip.active {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-bold);
}

.seg {
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
}

.seg-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  cursor: pointer;
}

.seg-item.checked {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.seg-item input {
  display: none;
}

.seg-item__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--color-border-strong);
}

.seg-item.checked .seg-item__dot {
  background: var(--color-brand);
  border-color: var(--color-brand);
}
</style>
