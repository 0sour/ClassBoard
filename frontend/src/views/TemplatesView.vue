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
// 课程模板直接编辑表单（借鉴手动导入课程 CourseEditor 的字段布局）
const showCourseForm = ref(false)
/** 录入方式：fixed=固定课表（单行）/ per=每节课调整（多行，按节数导入） */
const courseTab = ref<'fixed' | 'per'>('fixed')
const courseForm = reactive({
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
/** 每节课调整：一个时间段（同一门课的一节课），周次由 weekList 自定义 */
interface CourseSession {
  weekday: number
  startPeriod: number
  endPeriod: number
  location: string
  weekList: number[]
}
const courseSessions = ref<CourseSession[]>([])

function blankCourseSession(): CourseSession {
  return { weekday: 1, startPeriod: 1, endPeriod: 2, location: '', weekList: [] }
}

function addCourseSession(): void {
  courseSessions.value.push(blankCourseSession())
}

function removeCourseSession(i: number): void {
  courseSessions.value.splice(i, 1)
}

function toggleCourseSessionWeek(s: CourseSession, w: number): void {
  const i = s.weekList.indexOf(w)
  if (i >= 0) s.weekList.splice(i, 1)
  else s.weekList.push(w)
}

const courseFormError = ref('')
const courseFormBusy = ref(false)

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

const periodOptions = computed(() =>
  store.periods.map((p) => ({ value: p.index, label: `第 ${p.index} 节 ${p.startTime}–${p.endTime}` })),
)
const weekdayOptions = WEEKDAY_LABELS.map((label, i) => ({ value: i + 1, label }))
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
  if (kind === 'course') {
    // 课程模板：直接打开完整课程表单（借鉴手动导入课程）
    Object.assign(courseForm, {
      name: '', type: 'course' as const, teacher: '', location: '',
      weekday: 1, startPeriod: 1, endPeriod: 2, weekType: 'all' as const, weekList: [], remark: '',
    })
    courseSessions.value = [blankCourseSession()]
    courseTab.value = 'fixed'
    courseFormError.value = ''
    showCourseForm.value = true
  } else {
    showEditor.value = true
  }
}

function openEdit(t: TemplateInfo): void {
  editingId.value = t.id
  editingKind.value = t.kind
  Object.assign(form, { name: t.name, category: t.category, description: t.description })
  if (t.kind === 'course') {
    // 课程模板：直接打开完整课程表单（预填课程数据；多行 → 每节课调整模式）
    const rows = t.content as ImportRow[]
    const first = rows[0]
    Object.assign(courseForm, {
      name: first.name, type: first.type, teacher: first.teacher, location: first.location,
      weekday: first.weekday, startPeriod: first.startPeriod, endPeriod: first.endPeriod,
      weekType: first.weekType, weekList: first.weekList ? [...first.weekList] : [], remark: first.remark,
    })
    if (rows.length > 1) {
      courseTab.value = 'per'
      courseSessions.value = rows.map((r) => ({
        weekday: r.weekday,
        startPeriod: r.startPeriod,
        endPeriod: r.endPeriod,
        location: r.location,
        weekList: r.weekList ? [...r.weekList] : [],
      }))
    } else {
      courseTab.value = 'fixed'
      courseSessions.value = [blankCourseSession()]
    }
    courseFormError.value = ''
    showCourseForm.value = true
  } else {
    rows.value = []
    unitIds.value = [...(t.content as number[])]
    showEditor.value = true
  }
}

/** 保存课程模板（完整表单直接保存；fixed=单行 / per=多行按节数） */
async function saveCourseForm(): Promise<void> {
  courseFormError.value = ''
  if (!courseForm.name.trim()) {
    courseFormError.value = '请填写课程名称'
    return
  }
  let rows: ImportRow[]
  if (courseTab.value === 'per') {
    if (courseSessions.value.length === 0) {
      courseFormError.value = '请至少添加一节课'
      return
    }
    for (const [i, s] of courseSessions.value.entries()) {
      if (s.startPeriod > s.endPeriod) {
        courseFormError.value = `第 ${i + 1} 节课结束节次不能早于起始节次`
        return
      }
      if (s.weekList.length === 0) {
        courseFormError.value = `第 ${i + 1} 节课请至少选择一周`
        return
      }
    }
    // 每个时间段生成一条同名课程记录（周次一律按自定义周次保存）
    rows = courseSessions.value.map((s) => ({
      name: courseForm.name.trim(),
      type: courseForm.type,
      teacher: courseForm.teacher.trim(),
      location: s.location.trim(),
      weekType: 'custom' as const,
      weekList: [...s.weekList].sort((a, b) => a - b),
      weekday: s.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      startPeriod: s.startPeriod,
      endPeriod: s.endPeriod,
      remark: courseForm.remark.trim(),
    }))
  } else {
    if (courseForm.startPeriod > courseForm.endPeriod) {
      courseFormError.value = '结束节次不能早于起始节次'
      return
    }
    if (courseForm.weekType === 'custom' && courseForm.weekList.length === 0) {
      courseFormError.value = '请选择至少一个周次'
      return
    }
    rows = [{
      name: courseForm.name.trim(),
      type: courseForm.type,
      teacher: courseForm.teacher.trim(),
      location: courseForm.location.trim(),
      weekType: courseForm.weekType,
      weekList: courseForm.weekType === 'custom' ? [...courseForm.weekList].sort((a, b) => a - b) : null,
      weekday: courseForm.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      startPeriod: courseForm.startPeriod,
      endPeriod: courseForm.endPeriod,
      remark: courseForm.remark.trim(),
    }]
  }
  courseFormBusy.value = true
  try {
    const body = {
      kind: 'course' as const,
      name: form.name.trim() || courseForm.name.trim(),
      category: form.category,
      description: form.description,
      content: rows,
    }
    if (editingId.value === null) {
      await api.createTemplate(body)
      toast('课程模板已创建', 'success')
    } else {
      await api.updateTemplate(editingId.value, body)
      toast('课程模板已更新（版本 +1）', 'success')
    }
    showCourseForm.value = false
    await load()
  } catch (e) {
    courseFormError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    courseFormBusy.value = false
  }
}

/** 组合模板：可引用的课程模板列表 */
const courseTemplates = computed(() => templates.value.filter((t) => t.kind === 'course'))

/** 组合模板：勾选/取消引用的课程模板 */
function toggleUnitRef(id: number): void {
  const i = unitIds.value.indexOf(id)
  if (i >= 0) unitIds.value.splice(i, 1)
  else unitIds.value.push(id)
}

/** 课程模板表单：自定义周次切换 */
function toggleCourseWeek(w: number): void {
  const i = courseForm.weekList.indexOf(w)
  if (i >= 0) courseForm.weekList.splice(i, 1)
  else courseForm.weekList.push(w)
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

// 从学期勾选课程另存为模板
const showSaveFromSemester = ref(false)
const saveFromSemesterId = ref<number | null>(null)
const saveFromName = ref('')
const saveFromBusy = ref(false)
const saveFromCourses = ref<ImportRow[]>([])
const saveFromSelected = ref<Set<number>>(new Set())
const saveFromLoading = ref(false)

function openSaveFromSemester(): void {
  saveFromSemesterId.value = store.currentSemesterId
  saveFromName.value = ''
  saveFromCourses.value = []
  saveFromSelected.value = new Set()
  showSaveFromSemester.value = true
  void loadSaveFromCourses()
}

/** 加载所选学期的课程列表 */
async function loadSaveFromCourses(): Promise<void> {
  if (saveFromSemesterId.value === null) return
  saveFromLoading.value = true
  try {
    const list = await api.listCourses(saveFromSemesterId.value)
    saveFromCourses.value = list.map((c) => ({
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
  } catch {
    saveFromCourses.value = []
  } finally {
    saveFromLoading.value = false
  }
}

function onSaveFromSemesterChange(): void {
  saveFromSelected.value = new Set()
  void loadSaveFromCourses()
}

function toggleSaveFromCourse(i: number): void {
  const next = new Set(saveFromSelected.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  saveFromSelected.value = next
}

function toggleSaveFromAll(): void {
  const all = saveFromCourses.value.map((_, i) => i)
  const allSelected = all.every((i) => saveFromSelected.value.has(i))
  const next = new Set(saveFromSelected.value)
  if (allSelected) for (const i of all) next.delete(i)
  else for (const i of all) next.add(i)
  saveFromSelected.value = next
}

async function saveFromSemester(): Promise<void> {
  if (saveFromSemesterId.value === null) return
  if (!saveFromName.value.trim()) {
    toast('请填写模板名称', 'error')
    return
  }
  if (saveFromSelected.value.size === 0) {
    toast('请至少勾选一门课程', 'error')
    return
  }
  saveFromBusy.value = true
  try {
    const content = saveFromCourses.value.filter((_, i) => saveFromSelected.value.has(i))
    // 单门课程 → 课程模板；多门课程 → 组合模板
    const kind = content.length === 1 ? 'course' : 'unit'
    await api.createTemplate({
      kind,
      name: saveFromName.value.trim(),
      category: '混合',
      description: `从学期「${store.semesters.find((s) => s.id === saveFromSemesterId.value)?.name ?? ''}」另存`,
      content,
    })
    showSaveFromSemester.value = false
    await load()
    toast(`已保存为${kind === 'course' ? '课程' : '组合'}模板（${content.length} 门课）`, 'success')
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

        <!-- 课程模板：单门课程信息卡片（紧凑展示） -->
        <div v-if="previewing.kind === 'course'" class="tpl-course-preview">
          <div v-for="r in (previewing.content as ImportRow[])" :key="r.name" class="tpl-course-card">
            <div class="tpl-course-card__head">
              <span class="tpl-course-card__name">{{ r.name }}</span>
              <span class="chip" :class="r.type === 'lab' ? 'chip--lab' : ''">{{ r.type === 'lab' ? '实验课' : '理论课' }}</span>
            </div>
            <div class="tpl-course-card__grid">
              <div class="tpl-course-card__item">
                <span class="tpl-course-card__label">星期</span>
                <span class="tpl-course-card__value">{{ WEEKDAY_LABELS[r.weekday - 1] }}</span>
              </div>
              <div class="tpl-course-card__item">
                <span class="tpl-course-card__label">节次</span>
                <span class="tpl-course-card__value num">第 {{ r.startPeriod }}{{ r.endPeriod > r.startPeriod ? `–${r.endPeriod}` : '' }} 节</span>
              </div>
              <div class="tpl-course-card__item">
                <span class="tpl-course-card__label">周次</span>
                <span class="tpl-course-card__value">{{ weekLabelOf(r) }}</span>
              </div>
              <div class="tpl-course-card__item">
                <span class="tpl-course-card__label">教师</span>
                <span class="tpl-course-card__value">{{ r.teacher || '—' }}</span>
              </div>
              <div class="tpl-course-card__item">
                <span class="tpl-course-card__label">地点</span>
                <span class="tpl-course-card__value">{{ r.location || '—' }}</span>
              </div>
              <div v-if="r.remark" class="tpl-course-card__item">
                <span class="tpl-course-card__label">备注</span>
                <span class="tpl-course-card__value">{{ r.remark }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 组合模板：周课表网格预览（7 天 × 12 节，同格堆叠显示不同周次的课程） -->
        <div v-else class="tpl-grid-preview" aria-label="课程预览网格">
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

    <!-- 组合模板编辑弹窗（admin；勾选课程模板组成） -->
    <div v-if="showEditor" class="modal-mask" @mousedown.self="showEditor = false">
      <div class="modal tpl-editor" role="dialog" aria-modal="true" :aria-label="editingId === null ? '新建组合模板' : '编辑组合模板'">
        <h3 class="modal-title">{{ editingId === null ? '新建组合模板' : '编辑组合模板' }}</h3>
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

        <!-- 勾选课程模板组成 -->
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

        <p v-if="formError" class="edit-error" role="alert">{{ formError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="formBusy" @click="showEditor = false">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="formBusy" @click="save">
            {{ formBusy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 课程模板完整表单弹窗（借鉴手动导入课程 CourseEditor 布局） -->
    <div v-if="showCourseForm" class="modal-mask" @mousedown.self="showCourseForm = false">
      <div class="modal tpl-course-modal" role="dialog" aria-modal="true" :aria-label="editingId === null ? '新建课程模板' : '编辑课程模板'">
        <div class="modal-head">
          <h3 class="m-title">{{ editingId === null ? '新建课程模板' : '编辑课程模板' }}</h3>
          <button class="modal-close" type="button" aria-label="关闭" @click="showCourseForm = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <!-- 录入方式 Tab：固定课表 / 每节课调整（与手动添加课程一致） -->
        <div class="editor-tabs" role="tablist" aria-label="录入方式">
          <button
            type="button" role="tab" class="editor-tab"
            :class="{ active: courseTab === 'fixed' }"
            :aria-selected="courseTab === 'fixed'"
            @click="courseTab = 'fixed'"
          >固定课表</button>
          <button
            type="button" role="tab" class="editor-tab"
            :class="{ active: courseTab === 'per' }"
            :aria-selected="courseTab === 'per'"
            @click="courseTab = 'per'"
          >每节课调整</button>
        </div>

        <div class="form-grid">
          <label class="field field--full">
            <span class="field__label">课程名称</span>
            <input v-model="courseForm.name" class="text-input" type="text" placeholder="如：数字信号处理" maxlength="50" />
          </label>

          <fieldset class="field field--full">
            <legend class="field__label">课程类型</legend>
            <div class="seg">
              <label class="seg-item" :class="{ checked: courseForm.type === 'course' }">
                <input v-model="courseForm.type" type="radio" value="course" name="tpl-course-type" />
                <span class="seg-item__dot"></span>
                <span>理论课</span>
              </label>
              <label class="seg-item" :class="{ checked: courseForm.type === 'lab' }">
                <input v-model="courseForm.type" type="radio" value="lab" name="tpl-course-type" />
                <span class="seg-item__dot"></span>
                <span>实验课</span>
              </label>
            </div>
          </fieldset>

          <label class="field field--full">
            <span class="field__label">教师</span>
            <input v-model="courseForm.teacher" class="text-input" type="text" placeholder="选填" maxlength="30" />
          </label>

          <!-- 固定课表：每周重复的时间安排 -->
          <template v-if="courseTab === 'fixed'">
            <label class="field">
              <span class="field__label">上课地点</span>
              <input v-model="courseForm.location" class="text-input" type="text" placeholder="如：C3敏学楼501" maxlength="50" />
            </label>

            <fieldset class="field field--full">
              <legend class="field__label">星期</legend>
              <div class="weekdays" role="radiogroup" aria-label="选择星期">
                <button
                  v-for="(label, i) in WEEKDAY_LABELS"
                  :key="label"
                  class="weekday-chip"
                  type="button"
                  :class="{ checked: courseForm.weekday === i + 1 }"
                  @click="courseForm.weekday = i + 1"
                >{{ label }}</button>
              </div>
            </fieldset>

            <div class="field">
              <span class="field__label">起始节次</span>
              <AppSelect v-model="courseForm.startPeriod" :options="periodOptions" size="md" aria-label="起始节次" />
            </div>
            <div class="field">
              <span class="field__label">结束节次</span>
              <AppSelect v-model="courseForm.endPeriod" :options="periodOptions" size="md" aria-label="结束节次" />
            </div>

            <fieldset class="field field--full">
              <legend class="field__label">周次规则</legend>
              <div class="seg">
                <label class="seg-item" :class="{ checked: courseForm.weekType === 'all' }">
                  <input v-model="courseForm.weekType" type="radio" value="all" name="tpl-week-type" />
                  <span class="seg-item__dot"></span>
                  <span>每周</span>
                </label>
                <label class="seg-item" :class="{ checked: courseForm.weekType === 'odd' }">
                  <input v-model="courseForm.weekType" type="radio" value="odd" name="tpl-week-type" />
                  <span class="seg-item__dot"></span>
                  <span>单周</span>
                </label>
                <label class="seg-item" :class="{ checked: courseForm.weekType === 'even' }">
                  <input v-model="courseForm.weekType" type="radio" value="even" name="tpl-week-type" />
                  <span class="seg-item__dot"></span>
                  <span>双周</span>
                </label>
                <label class="seg-item" :class="{ checked: courseForm.weekType === 'custom' }">
                  <input v-model="courseForm.weekType" type="radio" value="custom" name="tpl-week-type" />
                  <span class="seg-item__dot"></span>
                  <span>自定义</span>
                </label>
              </div>
            </fieldset>

            <div v-if="courseForm.weekType === 'custom'" class="field field--full">
              <span class="field__label">选择周次（1–{{ MAX_WEEKS }} 周）</span>
              <div class="week-custom">
                <button
                  v-for="w in weekChips"
                  :key="w"
                  class="week-chip"
                  type="button"
                  :class="{ checked: courseForm.weekList.includes(w) }"
                  @click="toggleCourseWeek(w)"
                >{{ w }}</button>
              </div>
            </div>
          </template>

          <!-- 每节课调整：每节课独立指定时间与地点（按节数导入） -->
          <template v-else>
            <div class="field field--full">
              <div v-for="(s, i) in courseSessions" :key="i" class="session-card">
                <div class="session-grid">
                  <label class="field">
                    <span class="field__label">星期</span>
                    <AppSelect v-model="s.weekday" :options="weekdayOptions" size="md" :aria-label="`第 ${i + 1} 节课星期`" />
                  </label>
                  <div class="field">
                    <span class="field__label">起始节次</span>
                    <AppSelect v-model="s.startPeriod" :options="periodOptions" size="md" :aria-label="`第 ${i + 1} 节课起始节次`" />
                  </div>
                  <div class="field">
                    <span class="field__label">结束节次</span>
                    <AppSelect v-model="s.endPeriod" :options="periodOptions" size="md" :aria-label="`第 ${i + 1} 节课结束节次`" />
                  </div>
                  <label class="field">
                    <span class="field__label">地点</span>
                    <input v-model="s.location" class="text-input" type="text" placeholder="如：C3敏学楼501" maxlength="50" :aria-label="`第 ${i + 1} 节课地点`" />
                  </label>
                </div>

                <div class="session-weeks">
                  <div class="session-weeks-head">
                    <span class="field__label">选择周次（1–{{ MAX_WEEKS }} 周）</span>
                    <button class="session-del" type="button" :aria-label="`删除第 ${i + 1} 节课`" @click="removeCourseSession(i)">×</button>
                  </div>
                  <div class="week-custom">
                    <button
                      v-for="w in weekChips"
                      :key="w"
                      class="week-chip"
                      type="button"
                      :class="{ checked: s.weekList.includes(w) }"
                      @click="toggleCourseSessionWeek(s, w)"
                    >{{ w }}</button>
                  </div>
                </div>
              </div>

              <button class="btn btn--ghost add-session" type="button" @click="addCourseSession">＋ 添加一节课</button>
            </div>
          </template>
        </div>

        <p v-if="courseFormError" class="edit-error" role="alert">{{ courseFormError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="courseFormBusy" @click="showCourseForm = false">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="courseFormBusy" @click="saveCourseForm">
            {{ courseFormBusy ? '保存中…' : '保存为课程模板' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 从学期勾选课程另存为模板（admin） -->
    <div v-if="showSaveFromSemester" class="modal-mask" @mousedown.self="showSaveFromSemester = false">
      <div class="modal tpl-save-modal" role="dialog" aria-modal="true" aria-label="从学期另存为模板">
        <h3 class="modal-title">从学期另存为模板</h3>
        <label class="field">
          <span class="field__label">来源学期</span>
          <div class="select-wrap">
            <AppSelect
              :model-value="saveFromSemesterId"
              :options="semesterOptions"
              aria-label="来源学期"
              @update:model-value="(v: string | number | null) => { saveFromSemesterId = v === null ? null : Number(v); onSaveFromSemesterChange() }"
            />
          </div>
        </label>
        <label class="field">
          <span class="field__label">模板名称</span>
          <input v-model="saveFromName" class="date-input" type="text" placeholder="如：24集成2基础课程" maxlength="50" />
        </label>

        <!-- 课程勾选列表 -->
        <div class="tpl-save-head">
          <span class="field__label">选择课程（已选 {{ saveFromSelected.size }} / {{ saveFromCourses.length }}）</span>
          <label class="tpl-batch-all">
            <input type="checkbox" :checked="saveFromCourses.length > 0 && saveFromCourses.every((_, i) => saveFromSelected.has(i))" @change="toggleSaveFromAll" />
            <span>全选</span>
          </label>
        </div>
        <div v-if="saveFromLoading" class="tpl-rows-empty">加载中…</div>
        <div v-else-if="!saveFromCourses.length" class="tpl-rows-empty">该学期没有课程</div>
        <div v-else class="tpl-save-list">
          <label v-for="(c, i) in saveFromCourses" :key="i" class="tpl-save-item" :class="{ checked: saveFromSelected.has(i) }">
            <input type="checkbox" :checked="saveFromSelected.has(i)" @change="toggleSaveFromCourse(i)" />
            <span class="tpl-save-main">
              <span class="tpl-save-name">
                {{ c.name }}
                <span class="chip" :class="c.type === 'lab' ? 'chip--lab' : ''">{{ c.type === 'lab' ? '实验' : '理论' }}</span>
              </span>
              <span class="tpl-save-meta num">
                {{ WEEKDAY_LABELS[c.weekday - 1] }} · 第 {{ c.startPeriod }}{{ c.endPeriod > c.startPeriod ? `–${c.endPeriod}` : '' }} 节 · {{ weekLabelOf(c) }}
              </span>
            </span>
          </label>
        </div>

        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="saveFromBusy" @click="showSaveFromSemester = false">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="saveFromBusy || saveFromSelected.size === 0" @click="saveFromSemester">
            {{ saveFromBusy ? '保存中…' : `另存为模板（${saveFromSelected.size} 门）` }}
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

/* 从学期勾选课程另存 */
.tpl-save-modal {
  width: min(520px, 100%);
}

.tpl-save-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.tpl-save-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-height: 280px;
  overflow-y: auto;
}

.tpl-save-item {
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

.tpl-save-item:hover {
  background: var(--color-bg-hover);
}

.tpl-save-item.checked {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.tpl-save-item input {
  accent-color: var(--color-brand);
}

.tpl-save-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tpl-save-name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
  display: flex;
  align-items: center;
  gap: 6px;
}

.tpl-save-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

/* 课程模板完整表单（借鉴手动导入课程 CourseEditor） */
.tpl-course-modal {
  width: min(560px, 100%);
  max-height: 85vh;
  overflow-y: auto;
  /* 自定义滚动条（设计规范：细条 + 圆角 thumb，与课表网格一致） */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.tpl-course-modal::-webkit-scrollbar {
  width: 8px;
}

.tpl-course-modal::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-full);
}

.tpl-course-modal::-webkit-scrollbar-track {
  background: transparent;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
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
  width: 16px;
  height: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-lg) var(--spacing-md);
  margin-top: var(--spacing-md);
}

.field--full {
  grid-column: 1 / -1;
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

.weekdays {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.weekday-chip {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.weekday-chip.checked {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-bold);
}

.week-custom {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* 录入方式 Tab + 每节课调整（与手动添加课程一致） */
.editor-tabs {
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
  margin-top: var(--spacing-md);
}

.editor-tab {
  flex: 1;
  padding: 6px 0;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  transition: color var(--motion-duration-normal) var(--motion-easing-standard),
    background-color var(--motion-duration-normal) var(--motion-easing-standard);
}

.editor-tab.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.session-card {
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-page);
  margin-bottom: var(--spacing-sm);
}

.session-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-sm);
}

.session-weeks {
  margin-top: var(--spacing-sm);
}

.session-weeks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.session-del {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-lg);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.session-del:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-feedback-error);
}

.add-session {
  width: 100%;
  padding: 8px 0;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-brand);
  font-size: var(--font-size-md);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.add-session:hover {
  background: var(--color-brand-subtle);
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

/* 课程模板预览：单门课程信息卡片 */
.tpl-course-preview {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.tpl-course-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: var(--color-bg-page);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
}

.tpl-course-card__head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.tpl-course-card__name {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
}

.tpl-course-card__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-md);
}

.tpl-course-card__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tpl-course-card__label {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tpl-course-card__value {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
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
