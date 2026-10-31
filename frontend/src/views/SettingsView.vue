<script setup lang="ts">
// 设置页（多用户版）：Tab 分区 = 学期 / 节次 / 提醒 / 天气 / 数据 / 账号 / 用户管理（admin）
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import CitySearchSelect from '@/components/common/CitySearchSelect.vue'
import TimePicker from '@/components/common/TimePicker.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import { confirm, toast } from '@/utils/ui'
import { api, type ClassInfo, type ClassMemberInfo, type SessionInfo, type UserInfo } from '@/api/client'
import {
  adjustmentLabel,
  dateWithWeekdayLabel,
  explainAdjustment,
  groupDayRules,
  monthDayLabel,
  rangeLabel,
  weekdayLabel,
  weekdayOfDateStr,
  type AdjustmentChain,
} from '@/utils/calendar'
import AdjustEditor from '@/components/schedule/AdjustEditor.vue'
import ChangeTimeline from '@/components/changes/ChangeTimeline.vue'
import AdjustDetail from '@/components/schedule/AdjustDetail.vue'
import type { CourseAdjustment, Period, Semester } from '@/types'

const store = useScheduleStore()
const route = useRoute()
const router = useRouter()

// ================= Tab 导航 =================
type TabKey = 'class' | 'semester' | 'period' | 'calendar' | 'changes' | 'display' | 'weather' | 'site' | 'data' | 'account' | 'approvals' | 'users'

const TABS: { key: TabKey; label: string; adminOnly?: boolean }[] = [
  { key: 'class', label: '班级' },
  { key: 'semester', label: '学期' },
  { key: 'period', label: '节次' },
  { key: 'calendar', label: '日历' },
  { key: 'changes', label: '变更记录' },
  { key: 'display', label: '显示' },
  // 天气 / 站点页脚为全站共享配置（存管理员名下），仅管理员可修改
  { key: 'weather', label: '天气', adminOnly: true },
  { key: 'site', label: '站点', adminOnly: true },
  { key: 'data', label: '数据' },
  { key: 'account', label: '账号' },
  { key: 'approvals', label: '审批', adminOnly: true },
  { key: 'users', label: '用户管理', adminOnly: true },
]

const activeTab = ref<TabKey>('class')

onMounted(() => {
  const t = route.query.tab as TabKey | undefined
  if (t && TABS.some((x) => x.key === t)) activeTab.value = t
  void loadSessions()
  void loadClassDetail()
  if (store.currentUser?.role === 'admin') {
    void loadUsers()
    void loadApprovals()
  }
})

function switchTab(t: TabKey): void {
  activeTab.value = t
  void router.replace({ query: { ...route.query, tab: t } })
  if (t === 'class') void loadClassDetail()
  if (t === 'approvals') void loadApprovals()
}

const visibleTabs = computed(() => TABS.filter((t) => !t.adminOnly || store.currentUser?.role === 'admin'))

// ================= 学期管理 =================
const editingId = ref<number | null>(null)
const editStart = ref('')
const editEnd = ref('')
const saveBusy = ref(false)
const editError = ref('')

const showNewSemester = ref(false)
const newSemester = reactive({ name: '', startDate: '', endDate: '', weekStartDay: 1 as 1 | 7 })
const newBusy = ref(false)
const newError = ref('')

const weekStartOptions: AppSelectOption[] = [
  { value: 1, label: '周一' },
  { value: 7, label: '周日' },
]

function startEdit(s: Semester): void {
  editingId.value = s.id
  editStart.value = s.startDate
  editEnd.value = s.endDate
  editError.value = ''
}

function cancelEdit(): void {
  editingId.value = null
  editError.value = ''
}

async function saveEdit(s: Semester): Promise<void> {
  if (!editStart.value || !editEnd.value) {
    editError.value = '请填写开始与结束日期'
    return
  }
  if (editEnd.value < editStart.value) {
    editError.value = '结束日期不能早于开始日期'
    return
  }
  saveBusy.value = true
  editError.value = ''
  try {
    await store.updateSemester(s.id, {
      name: s.name,
      startDate: editStart.value,
      endDate: editEnd.value,
      weekStartDay: s.weekStartDay,
    })
    editingId.value = null
    toast('学期已保存', 'success')
  } catch (e) {
    editError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    saveBusy.value = false
  }
}

function openNewSemester(): void {
  Object.assign(newSemester, { name: '', startDate: '', endDate: '', weekStartDay: 1 as 1 | 7 })
  newError.value = ''
  showNewSemester.value = true
}

async function createSemester(): Promise<void> {
  newError.value = ''
  const name = newSemester.name.trim()
  if (!name) {
    newError.value = '请填写学期名称'
    return
  }
  if (!newSemester.startDate || !newSemester.endDate) {
    newError.value = '请填写开始与结束日期'
    return
  }
  if (newSemester.endDate < newSemester.startDate) {
    newError.value = '结束日期不能早于开始日期'
    return
  }
  newBusy.value = true
  try {
    await store.createSemester({
      name,
      startDate: newSemester.startDate,
      endDate: newSemester.endDate,
      weekStartDay: newSemester.weekStartDay,
    })
    showNewSemester.value = false
    toast('学期已创建', 'success')
  } catch (e) {
    newError.value = e instanceof Error ? e.message : '创建失败，请重试'
  } finally {
    newBusy.value = false
  }
}

async function removeSemester(s: Semester): Promise<void> {
  const isCurrent = s.id === store.currentSemesterId
  const ok = await confirm({
    title: '删除学期',
    desc: `将删除学期「${s.name}」及其全部课程、考试、作业与节次模板，此操作不可撤销。${isCurrent ? '删除后自动切换到剩余学期。' : ''}`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await store.deleteSemester(s.id)
    toast('学期已删除', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
  }
}

// ================= 节次时间模板（卡片网格 + 行内编辑 + 时间冲突校验） =================
const periodBusy = ref(false)
const periodError = ref('')
const showNewPeriodCard = ref(false)
const newPeriod = reactive({ startTime: '', endTime: '' })

/** 竖排双列分组：左列前半节次、右列后半节次（如 12 节 → 左 1-6、右 7-12） */
const periodColumns = computed(() => {
  const list = store.periods
  const mid = Math.ceil(list.length / 2)
  return [list.slice(0, mid), list.slice(mid)]
})

// 编辑态（含新建卡片：editingId=null 表示新建）
const periodEditingId = ref<number | null>(null)
const periodEditStart = ref('')
const periodEditEnd = ref('')
const periodEditError = ref('')
const periodEditBusy = ref(false)

/** 时间冲突检测：排除自身（相邻节次允许首尾相接，endA == startB 不算冲突） */
function findPeriodConflict(start: string, end: string, excludeId?: number | null): Period | undefined {
  return store.periods.find(
    (o) => o.id !== excludeId && o.startTime < end && start < o.endTime,
  )
}

/** 校验起止时间，返回错误信息（空串通过） */
function validatePeriodTime(start: string, end: string): string {
  if (!start || !end) return '请填写起止时间'
  if (end <= start) return '结束时间须晚于开始时间'
  return ''
}

function openNewPeriodCard(): void {
  newPeriod.startTime = ''
  newPeriod.endTime = ''
  periodError.value = ''
  showNewPeriodCard.value = true
}

function cancelNewPeriod(): void {
  showNewPeriodCard.value = false
  periodError.value = ''
}

async function submitNewPeriod(): Promise<void> {
  periodError.value = ''
  const msg = validatePeriodTime(newPeriod.startTime, newPeriod.endTime)
  if (msg) {
    periodError.value = msg
    return
  }
  const conflict = findPeriodConflict(newPeriod.startTime, newPeriod.endTime)
  if (conflict) {
    periodError.value = `与第 ${conflict.index} 节（${conflict.startTime}–${conflict.endTime}）时间冲突`
    return
  }
  periodBusy.value = true
  try {
    await store.addPeriod({ startTime: newPeriod.startTime, endTime: newPeriod.endTime })
    toast('节次已添加', 'success')
    showNewPeriodCard.value = false
    newPeriod.startTime = ''
    newPeriod.endTime = ''
  } catch (e) {
    periodError.value = e instanceof Error ? e.message : '添加失败，请重试'
  } finally {
    periodBusy.value = false
  }
}

function startPeriodEdit(p: (typeof store.periods)[number]): void {
  periodEditingId.value = p.id
  periodEditStart.value = p.startTime
  periodEditEnd.value = p.endTime
  periodEditError.value = ''
}

async function savePeriodEdit(): Promise<void> {
  if (periodEditingId.value === null) return
  periodEditError.value = ''
  const msg = validatePeriodTime(periodEditStart.value, periodEditEnd.value)
  if (msg) {
    periodEditError.value = msg
    return
  }
  const conflict = findPeriodConflict(periodEditStart.value, periodEditEnd.value, periodEditingId.value)
  if (conflict) {
    periodEditError.value = `与第 ${conflict.index} 节（${conflict.startTime}–${conflict.endTime}）时间冲突`
    return
  }
  periodEditBusy.value = true
  try {
    await store.updatePeriod(periodEditingId.value, {
      startTime: periodEditStart.value,
      endTime: periodEditEnd.value,
    })
    periodEditingId.value = null
    toast('节次时间已更新', 'success')
  } catch (e) {
    periodEditError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    periodEditBusy.value = false
  }
}

function cancelPeriodEdit(): void {
  periodEditingId.value = null
  periodEditError.value = ''
}

async function removePeriod(index: number): Promise<void> {
  const p = store.periods[index - 1]
  if (!p) return
  // 该节次上仍有课程时，删除会一并移除这些上课时间并让后续节次前移
  const affected = store.courses.filter((c) =>
    c.sessions.some((s) => s.periods.includes(index)),
  ).length
  const ok = await confirm({
    title: '删除节次',
    desc: affected
      ? `将删除第 ${index} 节（${p.startTime}–${p.endTime}），其余节次自动重排。有 ${affected} 门课在该节次上课，其这一节的上课时间会一并移除。`
      : `将删除第 ${index} 节（${p.startTime}–${p.endTime}），其余节次自动重排。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    const res = await store.deletePeriod(p.id)
    toast(
      res.affectedCourses
        ? `节次已删除，同时移除了 ${res.affectedCourses} 门课在该节次的上课时间`
        : '节次已删除',
      'success',
    )
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
  }
}

// ================= 学期日历（放假 / 整日移课） =================
// 放假：该日不上课；移课：把某一天的课整批移到另一天（源日显示调休、目标日显示源日当天的课）。
// 移课不假设课表每周重复，故按「某日 → 某日」录入，而非「按周几课表」。
const calFrom = ref('')
const calTo = ref('')
const calKind = ref<'holiday' | 'shift'>('holiday')
const calNote = ref('')
const calBusy = ref(false)
const calError = ref('')

const calKindOptions: AppSelectOption[] = [
  { value: 'holiday', label: '放假（该日不上课）' },
  { value: 'shift', label: '调休（把某天的课移到另一天）' },
]

/** 已录入的规则：放假按区间合并，移课一行一对 */
const calendarRanges = computed(() => groupDayRules(store.dayRules))

async function submitCalendarRange(): Promise<void> {
  calError.value = ''
  if (!calFrom.value || !calTo.value) {
    calError.value = calKind.value === 'shift' ? '请选择原上课日与移到哪天' : '请选择起止日期'
    return
  }
  if (calKind.value === 'holiday' && calTo.value < calFrom.value) {
    calError.value = '结束日期不能早于起始日期'
    return
  }
  if (calKind.value === 'shift' && calFrom.value === calTo.value) {
    calError.value = '「移到哪天」不能与原上课日相同'
    return
  }
  calBusy.value = true
  try {
    await store.setCalendarRange({
      from: calFrom.value,
      to: calTo.value,
      kind: calKind.value,
      note: calNote.value,
    })
    toast(
      calKind.value === 'holiday'
        ? '已设为放假'
        : `已把 ${dateWithWeekdayLabel(calFrom.value)} 的课移到 ${dateWithWeekdayLabel(calTo.value)}`,
      'success',
    )
    calFrom.value = ''
    calTo.value = ''
    calNote.value = ''
  } catch (e) {
    calError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    calBusy.value = false
  }
}

/** 日期 → 「周X」（列表文案用） */
function weekdayLabelOf(dateStr: string | null): string {
  return dateStr ? weekdayLabel(weekdayOfDateStr(dateStr)) : ''
}

async function removeCalendarRange(from: string, to: string): Promise<void> {
  const ok = await confirm({
    title: `清除 ${rangeLabel({ from, to })} 的日历规则？`,
    desc: '清除后该区间恢复为正常上课（按真实星期）。',
    danger: true,
    confirmText: '清除',
  })
  if (!ok) return
  try {
    await store.setCalendarRange({ from, to, kind: 'clear' })
    toast('已清除', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '清除失败，请重试', 'error')
  }
}

async function clearWholeCalendar(): Promise<void> {
  const sem = store.currentSemester
  if (!sem) return
  const ok = await confirm({
    title: '清空本学期全部日历规则？',
    desc: '放假与调休设置会被全部清除，课程与调整不受影响。',
    danger: true,
    confirmText: '清空',
  })
  if (!ok) return
  try {
    await store.setCalendarRange({ from: sem.startDate, to: sem.endDate, kind: 'clear' })
    toast('已清空本学期日历', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '清空失败，请重试', 'error')
  }
}

// ================= 单课调整台账（停课 / 调课 / 补课） =================
// 与课表角标共用同一张详情卡：列表点「链路」看 A→B→C 的每一站，也可在此登记与撤销。
const showAdjustEditor = ref(false)

/** 台账列表：本学期全部单课调整，新的在上 */
const ledgerAdjustments = computed(() =>
  [...store.adjustments]
    .filter((a) => store.courses.some((c) => c.id === a.courseId))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)),
)

function courseNameOf(courseId: number): string {
  return store.courses.find((c) => c.id === courseId)?.name ?? '（课程已删除）'
}

const kindChip: Record<CourseAdjustment['kind'], { text: string; cls: string }> = {
  cancel: { text: '停课', cls: 'chip-cancel' },
  move: { text: '调课', cls: 'chip-move' },
  extra: { text: '补课', cls: 'chip-extra' },
}

/** 链路：走解析层算整条链（含调休与后续移动），与课表角标点开的是同一条 */
const adjustChain = ref<AdjustmentChain | null>(null)

function openChain(a: CourseAdjustment): void {
  const chain = explainAdjustment(a, store.resolveCtx)
  if (!chain) {
    toast('这条调整当前没有生效（原日期这天没有这门课）', 'error')
    return
  }
  adjustChain.value = chain
}

async function removeAdjustment(a: CourseAdjustment): Promise<void> {
  const ok = await confirm({
    title: '撤销这条调整？',
    desc: `${adjustmentLabel(a)}——撤销后该课回到上一站的位置（可在变更记录中回退）。`,
    danger: true,
    confirmText: '撤销',
  })
  if (!ok) return
  try {
    await store.deleteAdjustment(a.id)
    toast('已撤销调整', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '撤销失败，请重试', 'error')
  }
}

// ================= 变更记录（时间线 / 撤销 / 整班回退） =================
/** 管理员可切全站视角；负责人只看得到自己班的 */
const changeScope = ref<'class' | 'site'>('class')

// ================= 单双周过滤 =================
async function toggleOddEven(v: boolean): Promise<void> {
  await store.setShowOddEvenFilter(v)
}

// ================= 天气（和风天气） =================
const weatherBusy = ref(false)
const showWeatherKey = ref(false)

// ================= 站点页脚（全站共享，管理员） =================
const siteBusy = ref(false)

async function saveSiteSettings(): Promise<void> {
  siteBusy.value = true
  try {
    await store.updateSettings({ site: store.settings.site })
    toast('站点设置已保存', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请重试', 'error')
  } finally {
    siteBusy.value = false
  }
}

async function saveWeatherSettings(): Promise<void> {
  weatherBusy.value = true
  try {
    await store.updateSettings({ weather: store.settings.weather })
    toast('天气设置已保存', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请重试', 'error')
  } finally {
    weatherBusy.value = false
  }
}

// ================= 数据备份 =================
const backupBusy = ref(false)
const restoreInput = ref<HTMLInputElement | null>(null)

async function exportBackup(scope: 'account' | 'site' = 'account'): Promise<void> {
  backupBusy.value = true
  try {
    const { api } = await import('@/api/client')
    await api.exportBackup(scope)
    toast(scope === 'site' ? '已导出整站备份' : '已导出备份文件', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败，请重试', 'error')
  } finally {
    backupBusy.value = false
  }
}

// ================= 导入恢复（两种模式） =================
/** 待导入的文件 + 模式选择 */
const restoreFile = ref<File | null>(null)
const restoreMode = ref<'new' | 'overwrite'>('new')
const restoreSchool = ref('')
const restoreName = ref('')
const restoreTargetClassId = ref<number | null>(null)
const restoreError = ref('')
/** 可覆盖的班级（我名下的） */
const restoreClassOptions = computed<AppSelectOption[]>(() =>
  store.classes.map((c) => ({ value: c.id, label: `${c.school} · ${c.name}` })),
)

function openRestoreDialog(file: File): void {
  restoreFile.value = file
  restoreMode.value = 'new'
  restoreSchool.value = store.currentClass?.school ?? ''
  restoreName.value = ''
  restoreTargetClassId.value = store.currentClassId ?? null
  restoreError.value = ''
}

async function submitRestore(): Promise<void> {
  const file = restoreFile.value
  if (!file) return
  restoreError.value = ''
  if (restoreMode.value === 'new') {
    if (restoreSchool.value.trim().length < 2 || restoreName.value.trim().length < 2) {
      restoreError.value = '请填写学校与班级名（各 2–40 字）'
      return
    }
  } else if (!restoreTargetClassId.value) {
    restoreError.value = '请选择要覆盖的班级'
    return
  }
  const ok = await confirm({
    title: restoreMode.value === 'new' ? '导入为新班级？' : '覆盖导入？',
    desc:
      restoreMode.value === 'new'
        ? '备份会作为一个新班级导入，不影响现有班级。'
        : '所选班级的数据会被清空后按备份重建（其余班级不受影响）。此操作会记入变更记录，可用整班回退撤销。',
    danger: restoreMode.value === 'overwrite',
    confirmText: '导入',
  })
  if (!ok) return
  backupBusy.value = true
  try {
    const { api } = await import('@/api/client')
    const res = await api.restoreBackup(
      file,
      restoreMode.value === 'new'
        ? { school: restoreSchool.value.trim(), name: restoreName.value.trim() }
        : { classId: restoreTargetClassId.value },
    )
    const r = res.restored as { semesters: number; courses: number; classes?: unknown[] }
    await store.bootstrap()
    toast(
      `恢复完成：${r.semesters} 个学期 / ${r.courses} 门课程` +
        (Array.isArray(r.classes) && r.classes.length > 1 ? `（${r.classes.length} 个班级）` : ''),
      'success',
    )
    restoreFile.value = null
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : '恢复失败，请重试'
  } finally {
    backupBusy.value = false
  }
}

function pickRestoreFile(): void {
  restoreInput.value?.click()
}

/** 选好文件后先问「导入到哪里」（新建班 / 覆盖已有班） */
function onRestoreFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  openRestoreDialog(file)
}

// ================= 账号（个人信息 / 已登录设备） =================
const sessions = ref<SessionInfo[]>([])
const sessionsBusy = ref(false)
const changePass = reactive({ old: '', next: '' })
const changePassBusy = ref(false)
const changePassError = ref('')

async function loadSessions(): Promise<void> {
  try {
    const res = await api.listSessions()
    sessions.value = res.sessions
  } catch {
    sessions.value = []
  }
}

async function revokeSession(id: number): Promise<void> {
  const ok = await confirm({
    title: '撤销设备',
    desc: '该设备将被登出，且此账号在所有设备上的"记住我"状态一并撤销。',
    danger: true,
    confirmText: '撤销',
  })
  if (!ok) return
  try {
    await api.revokeSession(id)
    await loadSessions()
    toast('已撤销该设备', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '撤销失败，请重试', 'error')
  }
}

async function changePassword(): Promise<void> {
  changePassError.value = ''
  if (!changePass.old || !changePass.next) {
    changePassError.value = '请填写旧密码与新密码'
    return
  }
  if (changePass.next.length < 6) {
    changePassError.value = '新密码长度须为 6–64 位'
    return
  }
  changePassBusy.value = true
  try {
    // 校验旧密码：用登录接口验证（成功后重新登录）
    await api.login(store.currentUser!.username, changePass.old, false)
    // 管理员重置自己的密码（走用户管理接口）
    await api.resetUserPassword(store.currentUser!.id, changePass.next)
    changePass.old = ''
    changePass.next = ''
    toast('密码已修改，请重新登录', 'success')
    await store.logout()
  } catch (e) {
    changePassError.value = e instanceof Error ? e.message : '修改失败，请重试'
  } finally {
    changePassBusy.value = false
  }
}

// ================= 班级资料（负责人侧：学校 / 班级名 / 专业 / 城市 + 成员） =================
const classForm = reactive({ school: '', name: '', major: '', city: '' })
const classBusy = ref(false)
const classError = ref('')
const classMembers = ref<ClassMemberInfo[]>([])
const showNewClass = ref(false)
const newClass = reactive({ school: '', name: '', major: '', city: '' })
const newClassBusy = ref(false)
const newClassError = ref('')
/** 同名班级已存在：确认「加入成为共同负责人」 */
const joinTarget = ref<ClassInfo | null>(null)
const joinBusy = ref(false)

async function loadClassDetail(): Promise<void> {
  const id = store.currentClassId
  if (id === null) {
    classMembers.value = []
    return
  }
  try {
    const info = await api.getClass(id)
    Object.assign(classForm, { school: info.school, name: info.name, major: info.major, city: info.city })
    classMembers.value = info.members
  } catch {
    classMembers.value = []
  }
}

/** 本地同步班级改动（顶栏切换器的标签 / 天气城市即刻生效，不整表重拉） */
function patchLocalClass(info: ClassInfo): void {
  const cls = store.classes.find((c) => c.id === info.id)
  if (cls) Object.assign(cls, info)
}

async function saveClass(): Promise<void> {
  const id = store.currentClassId
  if (id === null) return
  classError.value = ''
  if (classForm.school.trim().length < 2 || classForm.name.trim().length < 2) {
    classError.value = '请填写学校与班级名'
    return
  }
  classBusy.value = true
  try {
    const info = await api.updateClass(id, {
      school: classForm.school.trim(),
      name: classForm.name.trim(),
      major: classForm.major.trim(),
      city: classForm.city.trim(),
    })
    patchLocalClass(info)
    classMembers.value = info.members
    toast('班级资料已保存', 'success')
    await store.refreshWeather()
  } catch (e) {
    classError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    classBusy.value = false
  }
}

function openNewClass(): void {
  Object.assign(newClass, { school: '', name: '', major: '', city: '' })
  newClassError.value = ''
  showNewClass.value = true
}

async function createClass(): Promise<void> {
  newClassError.value = ''
  if (newClass.school.trim().length < 2 || newClass.name.trim().length < 2) {
    newClassError.value = '请填写学校与班级名（2–40 字）'
    return
  }
  newClassBusy.value = true
  try {
    const created = await api.createClass({
      school: newClass.school.trim(),
      name: newClass.name.trim(),
      major: newClass.major.trim(),
      city: newClass.city.trim(),
    })
    showNewClass.value = false
    await store.bootstrap()
    await store.selectClass(created.id)
    await loadClassDetail()
    toast(`班级「${created.name}」已创建`, 'success')
  } catch (e) {
    // 同名班级已存在：询问是否加入成为共同负责人
    const err = e as Error & { code?: string; payload?: { class?: ClassInfo } }
    if (err.code === 'CLASS_EXISTS' && err.payload?.class) {
      showNewClass.value = false
      joinTarget.value = err.payload.class
      return
    }
    newClassError.value = e instanceof Error ? e.message : '创建失败，请重试'
  } finally {
    newClassBusy.value = false
  }
}

async function joinExistingClass(): Promise<void> {
  if (!joinTarget.value) return
  joinBusy.value = true
  try {
    const id = joinTarget.value.id
    await api.joinClass(id)
    joinTarget.value = null
    await store.bootstrap()
    await store.selectClass(id)
    await loadClassDetail()
    toast('已加入班级，与现有负责人同级', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '加入失败，请重试', 'error')
  } finally {
    joinBusy.value = false
  }
}

/** 切换当前班级（移动端顶栏放不下切换器时的主要入口） */
async function switchClass(id: number): Promise<void> {
  await store.selectClass(id)
  await loadClassDetail()
}

async function leaveCurrentClass(): Promise<void> {
  const id = store.currentClassId
  if (id === null) return
  const isLast = classMembers.value.length <= 1
  const ok = await confirm({
    title: '退出班级',
    desc: isLast
      ? `你是「${classForm.name}」唯一的负责人，退出将连同该班级的全部课表数据一并删除（可回退）。`
      : `退出后「${classForm.name}」由其他负责人继续管理，你不再拥有修改权限。`,
    danger: true,
    confirmText: '退出',
  })
  if (!ok) return
  try {
    await api.leaveClass(id)
    await store.bootstrap()
    await loadClassDetail()
    toast('已退出班级', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '退出失败，请重试', 'error')
  }
}

async function deleteCurrentClass(): Promise<void> {
  const id = store.currentClassId
  if (id === null) return
  const ok = await confirm({
    title: '删除班级',
    desc: `将删除班级「${classForm.name}」及其全部学期、课程、考试、作业数据。此操作会记入变更记录（可回退）。`,
    danger: true,
    confirmText: '删除班级',
  })
  if (!ok) return
  try {
    await api.deleteClass(id)
    await store.bootstrap()
    await loadClassDetail()
    toast('班级已删除', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
  }
}

// ================= 注册审批（admin） =================
const approvals = ref<UserInfo[]>([])
const approvalsBusy = ref(false)
const rejectTarget = ref<UserInfo | null>(null)
const rejectNote = ref('')
const rejectBusy = ref(false)

async function loadApprovals(): Promise<void> {
  if (store.currentUser?.role !== 'admin') return
  try {
    approvals.value = await api.listApprovals('pending')
  } catch {
    approvals.value = []
  }
}

async function approveUser(u: UserInfo): Promise<void> {
  approvalsBusy.value = true
  try {
    await api.approveUser(u.id)
    await loadApprovals()
    await loadUsers()
    toast(`已通过「${u.username}」的申请`, 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败，请重试', 'error')
  } finally {
    approvalsBusy.value = false
  }
}

function openReject(u: UserInfo): void {
  rejectTarget.value = u
  rejectNote.value = ''
}

async function submitReject(): Promise<void> {
  if (!rejectTarget.value) return
  const target = rejectTarget.value
  rejectBusy.value = true
  try {
    await api.rejectUser(target.id, rejectNote.value.trim())
    rejectTarget.value = null
    await loadApprovals()
    await loadUsers()
    toast('已拒绝该申请', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败，请重试', 'error')
  } finally {
    rejectBusy.value = false
  }
}

// ================= 用户管理（admin） =================
const users = ref<UserInfo[]>([])
const signupBusy = ref(false)
const showNewUser = ref(false)
const newUser = reactive({ username: '', password: '', role: 'leader' as 'admin' | 'leader' })
const newUserError = ref('')
const newUserBusy = ref(false)
const resetTarget = ref<UserInfo | null>(null)
const resetPassword = ref('')
const resetBusy = ref(false)
const resetError = ref('')
const deleteTarget = ref<UserInfo | null>(null)
const deleteBusy = ref(false)
const deleteError = ref('')

async function loadUsers(): Promise<void> {
  try {
    const res = await api.listUsers()
    users.value = res.users
  } catch {
    users.value = []
  }
}

async function toggleSignup(): Promise<void> {
  signupBusy.value = true
  try {
    const res = await api.setSignupEnabled(!store.signupEnabled)
    store.signupEnabled = res.enabled
    toast(res.enabled ? '已开放注册' : '已关闭注册', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败，请重试', 'error')
  } finally {
    signupBusy.value = false
  }
}

function openNewUser(): void {
  Object.assign(newUser, { username: '', password: '', role: 'leader' as const })
  newUserError.value = ''
  showNewUser.value = true
}

async function createUser(): Promise<void> {
  newUserError.value = ''
  if (!/^[\w\u4e00-\u9fa5-]{2,20}$/.test(newUser.username.trim())) {
    newUserError.value = '用户名须为 2-20 位字母/数字/中文/下划线/连字符'
    return
  }
  if (newUser.password.length < 6) {
    newUserError.value = '密码长度须为 6–64 位'
    return
  }
  newUserBusy.value = true
  try {
    await api.createUser({ username: newUser.username.trim(), password: newUser.password, role: newUser.role })
    showNewUser.value = false
    await loadUsers()
    toast('用户已创建', 'success')
  } catch (e) {
    newUserError.value = e instanceof Error ? e.message : '创建失败，请重试'
  } finally {
    newUserBusy.value = false
  }
}

async function toggleUserDisabled(u: UserInfo): Promise<void> {
  const ok = await confirm({
    title: u.disabled ? '启用用户' : '禁用用户',
    desc: u.disabled
      ? `将恢复用户「${u.username}」的登录权限。`
      : `将禁用用户「${u.username}」，其全部会话立即失效，数据保留。`,
    danger: !u.disabled,
    confirmText: u.disabled ? '启用' : '禁用',
  })
  if (!ok) return
  try {
    await api.updateUser(u.id, { disabled: !u.disabled })
    await loadUsers()
    toast(u.disabled ? '已启用' : '已禁用', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败，请重试', 'error')
  }
}

async function toggleUserRole(u: UserInfo): Promise<void> {
  const next = u.role === 'admin' ? 'leader' : 'admin'
  const ok = await confirm({
    title: next === 'admin' ? '设为管理员' : '取消管理员',
    desc: next === 'admin'
      ? `将「${u.username}」设为管理员（拥有全站管理、审批与用户管理能力）。`
      : `将「${u.username}」降为班级负责人（仅拥有自己班级的权限）。`,
    danger: next !== 'admin',
    confirmText: next === 'admin' ? '设为管理员' : '降为负责人',
  })
  if (!ok) return
  try {
    await api.updateUser(u.id, { role: next })
    await loadUsers()
    toast('角色已更新', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败，请重试', 'error')
  }
}

function openReset(u: UserInfo): void {
  resetTarget.value = u
  resetPassword.value = ''
  resetError.value = ''
}

async function submitReset(): Promise<void> {
  if (!resetTarget.value) return
  resetError.value = ''
  if (resetPassword.value.length < 6) {
    resetError.value = '密码长度须为 6–64 位'
    return
  }
  resetBusy.value = true
  try {
    const target = resetTarget.value
    if (!target) return
    await api.resetUserPassword(target.id, resetPassword.value)
    resetTarget.value = null
    toast(`已重置「${target.username}」的密码`, 'success')
  } catch (e) {
    resetError.value = e instanceof Error ? e.message : '重置失败，请重试'
  } finally {
    resetBusy.value = false
  }
}

function openDelete(u: UserInfo): void {
  deleteTarget.value = u
  deleteError.value = ''
}

async function submitDelete(): Promise<void> {
  if (!deleteTarget.value) return
  deleteError.value = ''
  deleteBusy.value = true
  try {
    const target = deleteTarget.value
    await api.deleteUser(target.id)
    deleteTarget.value = null
    await loadUsers()
    toast('账号已删除', 'success')
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : '删除失败，请重试'
  } finally {
    deleteBusy.value = false
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div class="page settings-view">
    <h2 class="settings-head reveal">设置</h2>

    <!-- Tab 导航（桌面横向滚动 / 移动可滑动） -->
    <nav class="settings-tabs reveal" role="tablist" aria-label="设置分区">
      <button
        v-for="t in visibleTabs"
        :key="t.key"
        class="settings-tab"
        :class="{ active: activeTab === t.key }"
        type="button"
        role="tab"
        :aria-selected="activeTab === t.key"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- 班级资料（班级 → 多个学期 → 课表；同级负责人可共同修改） -->
    <div v-show="activeTab === 'class'" class="panel reveal">
      <div class="panel-head">
        <h3>我的班级</h3>
        <button v-if="!showNewClass" class="btn-add" type="button" @click="openNewClass">＋ 新建班级</button>
      </div>

      <template v-if="store.currentClass">
        <p class="panel-note panel-note--block">
          学校 + 班级名是班级的唯一标识；同名班级由多位负责人共同管理，权限完全同级。
        </p>

        <!-- 我名下的班级（多班负责人可在此切换；移动端顶栏不显示切换器） -->
        <template v-if="store.classes.length > 1">
          <div class="row row--wrap">
            <span class="row-main">
              <span class="row-title">我名下的班级（{{ store.classes.length }}）</span>
              <span class="row-meta">切换后顶栏周课表 / 今天的班级随之切换</span>
            </span>
          </div>
          <div v-for="c in store.classes" :key="c.id" class="row">
            <span class="row-main">
              <span class="row-title">
                {{ c.name }}
                <span v-if="c.id === store.currentClassId" class="chip">当前</span>
              </span>
              <span class="row-meta">{{ c.school || '未填写学校' }} · {{ c.semesterCount }} 个学期</span>
            </span>
            <button v-if="c.id !== store.currentClassId" class="btn-mini" type="button" @click="switchClass(c.id)">切换</button>
          </div>
        </template>

        <div class="edit-fields">
          <label class="edit-field">
            <span class="edit-field__label">学校</span>
            <input v-model="classForm.school" class="date-input" type="text" maxlength="40" placeholder="如：示例大学" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">班级名</span>
            <input v-model="classForm.name" class="date-input" type="text" maxlength="40" placeholder="如：示例2301" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">专业</span>
            <input v-model="classForm.major" class="date-input" type="text" maxlength="40" placeholder="如：计算机科学与技术" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">城市（天气）</span>
            <CitySearchSelect
              :model-value="classForm.city"
              placeholder="输入城市名搜索，如「示例市」"
              aria-label="班级城市"
              @update:model-value="(v: string) => classForm.city = v"
            />
          </label>
        </div>
        <p v-if="classError" class="edit-error" role="alert">{{ classError }}</p>
        <div class="edit-actions">
          <button class="btn-mini btn-mini--primary" type="button" :disabled="classBusy" @click="saveClass">
            {{ classBusy ? '保存中…' : '保存班级资料' }}
          </button>
        </div>

        <div class="row row--wrap" style="margin-top: var(--spacing-lg)">
          <span class="row-main">
            <span class="row-title">负责人（{{ classMembers.length }}）</span>
            <span class="row-meta">同级成员均可修改该班级的课表、通知与数据</span>
          </span>
        </div>
        <div v-for="m in classMembers" :key="m.id" class="row">
          <span class="row-main">
            <span class="row-title">
              {{ m.username }}
              <span v-if="m.role === 'admin'" class="chip">管理员</span>
              <span v-if="m.id === store.currentUser?.id" class="chip">我</span>
            </span>
            <span class="row-meta num">加入于 {{ formatTime(m.joinedAt) }}</span>
          </span>
        </div>

        <div class="edit-actions" style="margin-top: var(--spacing-lg); justify-content: flex-start; gap: var(--spacing-sm)">
          <button class="btn-mini" type="button" @click="leaveCurrentClass">退出班级</button>
          <button class="btn-mini btn-mini--danger" type="button" @click="deleteCurrentClass">删除班级</button>
        </div>
      </template>

      <template v-else>
        <p class="panel-note panel-note--block">
          还没有班级。创建一个班级即可开始维护课表（负责人可同时管理多个班级）。
        </p>
      </template>

      <!-- 新建班级 -->
      <div v-if="showNewClass" class="new-semester" style="margin-top: var(--spacing-lg)">
        <div class="edit-fields">
          <label class="edit-field">
            <span class="edit-field__label">学校</span>
            <input v-model="newClass.school" class="date-input" type="text" maxlength="40" placeholder="如：示例大学" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">班级名</span>
            <input v-model="newClass.name" class="date-input" type="text" maxlength="40" placeholder="如：示例2301" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">专业（可选）</span>
            <input v-model="newClass.major" class="date-input" type="text" maxlength="40" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">城市（可选，天气用）</span>
            <CitySearchSelect
              :model-value="newClass.city"
              placeholder="输入城市名搜索"
              aria-label="班级城市"
              @update:model-value="(v: string) => newClass.city = v"
            />
          </label>
        </div>
        <p class="panel-note panel-note--block">学校 + 班级名相同 = 同一个班；若已存在，会询问你是否加入成为共同负责人。</p>
        <p v-if="newClassError" class="edit-error" role="alert">{{ newClassError }}</p>
        <div class="edit-actions">
          <button class="btn-mini btn-mini--primary" type="button" :disabled="newClassBusy" @click="createClass">
            {{ newClassBusy ? '创建中…' : '创建班级' }}
          </button>
          <button class="btn-mini" type="button" :disabled="newClassBusy" @click="showNewClass = false">取消</button>
        </div>
      </div>
    </div>

    <!-- 学期管理 -->
    <div v-show="activeTab === 'semester'" class="panel reveal">
      <div class="panel-head">
        <h3>学期</h3>
        <button class="btn-add" type="button" @click="openNewSemester">＋ 新建学期</button>
      </div>
      <div v-if="showNewSemester" class="new-semester">
        <div class="edit-fields">
          <label class="edit-field">
            <span class="edit-field__label">学期名称</span>
            <input v-model="newSemester.name" class="date-input" type="text" placeholder="如：2026 秋季学期" maxlength="50" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">开始日期</span>
            <DatePicker v-model="newSemester.startDate" size="sm" aria-label="开始日期" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">结束日期</span>
            <DatePicker v-model="newSemester.endDate" size="sm" aria-label="结束日期" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">每周起始日</span>
            <div class="select-wrap">
              <AppSelect v-model="newSemester.weekStartDay" :options="weekStartOptions" aria-label="每周起始日" />
            </div>
          </label>
        </div>
        <p v-if="newError" class="edit-error" role="alert">{{ newError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="newBusy" @click="createSemester">{{ newBusy ? '创建中…' : '创建' }}</button>
          <button class="btn-mini" type="button" :disabled="newBusy" @click="showNewSemester = false">取消</button>
        </div>
      </div>
      <div v-for="s in store.semesters" :key="s.id" class="row">
        <template v-if="editingId === s.id">
          <div class="row-main">
            <span class="row-title">{{ s.name }}</span>
            <div class="edit-fields">
              <label class="edit-field">
                <span class="edit-field__label">开始日期</span>
                <DatePicker v-model="editStart" size="sm" aria-label="开始日期" />
              </label>
              <label class="edit-field">
                <span class="edit-field__label">结束日期</span>
                <DatePicker v-model="editEnd" size="sm" aria-label="结束日期" />
              </label>
            </div>
            <p v-if="editError" class="edit-error" role="alert">{{ editError }}</p>
          </div>
          <button class="btn-mini" type="button" :disabled="saveBusy" @click="saveEdit(s)">
            {{ saveBusy ? '保存中…' : '保存' }}
          </button>
          <button class="btn-mini" type="button" :disabled="saveBusy" @click="cancelEdit">取消</button>
        </template>
        <template v-else>
          <span class="row-main">
            <span class="row-title">{{ s.name }}</span>
            <span class="row-meta num">{{ s.startDate }} – {{ s.endDate }}</span>
          </span>
          <span v-if="s.id === store.currentSemesterId" class="chip">当前</span>
          <button v-else class="btn-mini" type="button" @click="store.setSemester(s.id)">切换</button>
          <button class="btn-mini" type="button" @click="startEdit(s)">编辑</button>
          <button class="btn-mini btn-mini--danger" type="button" @click="removeSemester(s)">删除</button>
        </template>
      </div>
    </div>

    <!-- 节次时间模板（竖排双列卡片：左列前半节次、右列后半节次） -->
    <div v-show="activeTab === 'period'" class="panel reveal">
      <div class="panel-head">
        <h3>节次时间模板</h3>
        <button class="btn-mini" type="button" @click="openNewPeriodCard">＋ 添加节次</button>
      </div>
      <p class="panel-note panel-note--block">悬停卡片显示编辑/删除；修改时间保存时自动校验与其他节次的冲突</p>

      <div class="period-cols">
        <div v-for="(col, ci) in periodColumns" :key="ci" class="period-col">
          <div
            v-for="p in col"
            :key="p.id"
            class="period-card"
            :class="{ editing: periodEditingId === p.id }"
          >
            <!-- 编辑态 -->
            <template v-if="periodEditingId === p.id">
              <div class="p-card-head">
                <span class="p-idx">第 {{ p.index }} 节</span>
              </div>
              <div class="p-edit-row">
                <TimePicker v-model="periodEditStart" size="sm" aria-label="开始时间" />
                <span class="p-dash">–</span>
                <TimePicker v-model="periodEditEnd" size="sm" aria-label="结束时间" />
              </div>
              <p v-if="periodEditError" class="p-error" role="alert">{{ periodEditError }}</p>
              <div class="p-actions">
                <button class="btn-mini" type="button" :disabled="periodEditBusy" @click="cancelPeriodEdit">取消</button>
                <button class="btn-mini btn-mini--primary" type="button" :disabled="periodEditBusy" @click="savePeriodEdit">
                  {{ periodEditBusy ? '保存中…' : '保存' }}
                </button>
              </div>
            </template>

            <!-- 展示态 -->
            <template v-else>
              <div class="p-card-head">
                <span class="p-idx">第 {{ p.index }} 节</span>
                <div class="p-tools">
                  <button class="p-tool" type="button" :aria-label="`编辑第 ${p.index} 节`" @click="startPeriodEdit(p)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                  </button>
                  <button class="p-tool p-tool--danger" type="button" :aria-label="`删除第 ${p.index} 节`" @click="removePeriod(p.index)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                  </button>
                </div>
              </div>
              <div class="p-time num">{{ p.startTime }} – {{ p.endTime }}</div>
            </template>
          </div>

          <!-- 新建节次卡片（在每列末尾展开） -->
          <div v-if="showNewPeriodCard && ci === periodColumns.length - 1" class="period-card period-card--new editing">
            <div class="p-card-head">
              <span class="p-idx">新节次</span>
            </div>
            <div class="p-edit-row">
              <TimePicker v-model="newPeriod.startTime" size="sm" aria-label="开始时间" />
              <span class="p-dash">–</span>
              <TimePicker v-model="newPeriod.endTime" size="sm" aria-label="结束时间" />
            </div>
            <p v-if="periodError" class="p-error" role="alert">{{ periodError }}</p>
            <div class="p-actions">
              <button class="btn-mini" type="button" :disabled="periodBusy" @click="cancelNewPeriod">取消</button>
              <button class="btn-mini btn-mini--primary" type="button" :disabled="periodBusy" @click="submitNewPeriod">
                {{ periodBusy ? '添加中…' : '添加' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 日历台账：整日规则（放假 / 调休）+ 单课调整（停课 / 调课 / 补课），同一页管全 -->
    <div v-show="activeTab === 'calendar'" class="panel reveal">
      <div class="panel-head">
        <h3>学期日历 · 放假与调休</h3>
        <button
          v-if="store.dayRules.length"
          class="btn-mini btn-mini--danger"
          type="button"
          @click="clearWholeCalendar"
        >清空本学期</button>
      </div>
      <p class="panel-note panel-note--block">
        放假：该日不上课，可按区间录入。调休：把某一天的课整批移到另一天（如把 9月29日 的课移到 10月10日）——
        源日显示为调休、目标日显示源日当天的课；不假设课表每周重复，实验课等跳周课程也会原样搬走。
      </p>

      <div class="cal-form">
        <label class="edit-field">
          <span class="edit-field__label">{{ calKind === 'shift' ? '原上课日' : '起始日期' }}</span>
          <DatePicker v-model="calFrom" size="sm" aria-label="起始日期" />
        </label>
        <label class="edit-field">
          <span class="edit-field__label">{{ calKind === 'shift' ? '移到哪天' : '结束日期' }}</span>
          <DatePicker v-model="calTo" size="sm" aria-label="结束日期" />
        </label>
        <label class="edit-field">
          <span class="edit-field__label">类型</span>
          <div class="select-wrap">
            <AppSelect v-model="calKind" :options="calKindOptions" aria-label="日历类型" />
          </div>
        </label>
        <label class="edit-field">
          <span class="edit-field__label">备注（可选）</span>
          <input v-model="calNote" class="date-input" type="text" placeholder="如：国庆节" maxlength="100" />
        </label>
        <button class="btn-mini btn-mini--primary" type="button" :disabled="calBusy" @click="submitCalendarRange">
          {{ calBusy ? '保存中…' : '添加' }}
        </button>
      </div>
      <p v-if="calError" class="edit-error" role="alert">{{ calError }}</p>

      <div v-if="!calendarRanges.length" class="panel-note panel-note--block">
        本学期还没有日历规则。学期范围内的日期才可录入。
      </div>
      <div v-for="r in calendarRanges" :key="`${r.kind}:${r.from}:${r.toDate ?? ''}`" class="row">
        <span class="row-main">
          <span class="row-title">
            <template v-if="r.kind === 'holiday'">
              {{ rangeLabel(r) }}
              <span class="chip">放假</span>
            </template>
            <template v-else>
              {{ monthDayLabel(r.from) }} <span class="chip">调休</span> → {{ r.toDate ? monthDayLabel(r.toDate) : '' }}
            </template>
          </span>
          <span class="row-meta">
            {{ r.kind === 'holiday' ? `${r.dates.length} 天` : `移课${r.toDate ? `（${weekdayLabelOf(r.from)} → ${weekdayLabelOf(r.toDate)}）` : ''}` }}<span v-if="r.note"> · {{ r.note }}</span>
          </span>
        </span>
        <button class="btn-mini btn-mini--danger" type="button" @click="removeCalendarRange(r.from, r.to)">清除</button>
      </div>

    <!-- 单课调整台账：停课 / 调课 / 补课（与课表角标的详情卡同源） -->
      <div class="ledger-head">
        <h3>单课调整</h3>
        <button class="btn-mini btn-mini--primary" type="button" @click="showAdjustEditor = true">＋ 登记调整</button>
      </div>
      <p class="panel-note panel-note--block">
        停课、调课、补课都写在这份台账里（不改基准课表，随时可撤销）。「链路」摊开这门课从基准日到终到日的每一站；
        与课表上角标点开的是同一张卡。
      </p>
      <div v-if="!ledgerAdjustments.length" class="panel-note panel-note--block">本学期还没有单课调整。</div>
      <div v-for="a in ledgerAdjustments" :key="a.id" class="row">
        <span class="row-main">
          <span class="row-title">
            <span class="chip" :class="kindChip[a.kind].cls">{{ kindChip[a.kind].text }}</span>
            {{ courseNameOf(a.courseId) }}
          </span>
          <span class="row-meta">{{ adjustmentLabel(a) }}<span v-if="a.note"> · {{ a.note }}</span></span>
        </span>
        <button class="btn-mini" type="button" @click="openChain(a)">链路</button>
        <button class="btn-mini btn-mini--danger" type="button" @click="removeAdjustment(a)">撤销</button>
      </div>
    </div>

      <!-- 变更记录：谁在什么时候动了什么（字段级 diff），可单条撤销或整班回退 -->
    <div v-show="activeTab === 'changes'" class="panel reveal">
      <div class="panel-head">
        <h3>变更记录</h3>
        <div v-if="store.currentUser?.role === 'admin'" class="seg-view">
          <button class="seg-view__item" :class="{ active: changeScope === 'class' }" type="button" @click="changeScope = 'class'">
            本班
          </button>
          <button class="seg-view__item" :class="{ active: changeScope === 'site' }" type="button" @click="changeScope = 'site'">
            全站
          </button>
        </div>
      </div>
      <p class="panel-note panel-note--block">
        每一次写操作都在这里留一条记录（谁 / 什么时候 / 改了什么），撤销=把对象恢复成改动之前的样子并追加一条「撤销」记录；
        想整体回到某个时刻用「回退到这里」，它会把班级数据一起回退到那一刻。
      </p>
      <ChangeTimeline :scope="changeScope" />
    </div>

    <!-- 显示：周课表显示选项（个人提醒功能已下线，P2 起由负责人通过通知中心发布消息） -->
    <div v-show="activeTab === 'display'" class="panel reveal">
      <div class="panel-head">
        <h3>显示</h3>
      </div>
      <p class="panel-note panel-note--block">
        浏览器上课 / 实验 / 作业提醒已下线：需要通知同学时，用顶栏铃铛发布班级通知。
      </p>
      <div class="row">
        <span class="row-main">
          <span class="row-title">单双周过滤</span>
          <span class="row-meta">开启后当前周只显示单周/双周对应课程与全部周课程</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="单双周过滤"
          :checked="store.showOddEvenFilter"
          @change="toggleOddEven(($event.target as HTMLInputElement).checked)"
        />
      </div>
    </div>

    <!-- 天气设置（和风天气；API Key 全局共享，仅管理员可配置） -->
    <div v-show="activeTab === 'weather'" class="panel reveal">
      <div class="panel-head">
        <h3>天气</h3>
        <span class="panel-note">默认关闭；启用后在周课表侧栏与今日页显示实时天气</span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">显示天气</span>
          <span class="row-meta">桌面周课表侧栏 + 移动端今日页显示天气卡片</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="显示天气"
          :checked="store.settings.weather.enabled"
          @change="store.settings.weather.enabled = ($event.target as HTMLInputElement).checked"
        />
      </div>
      <div v-if="store.settings.weather.enabled" class="sub-row">
        <label class="edit-field">
          <span class="edit-field__label">城市</span>
          <CitySearchSelect
            :model-value="store.settings.weather.location"
            placeholder="输入城市名搜索，如「杭州」"
            aria-label="天气城市"
            @update:model-value="(v: string) => store.settings.weather.location = v"
          />
        </label>
        <label v-if="store.currentUser?.role === 'admin'" class="edit-field">
          <span class="edit-field__label">和风天气 API Key</span>
          <span class="key-input-wrap">
            <input
              class="text-input key-input"
              :type="showWeatherKey ? 'text' : 'password'"
              placeholder="免费版即可（devapi.qweather.com）"
              aria-label="和风天气 API Key"
              v-model="store.settings.weather.apiKey"
            />
            <button
              class="key-eye"
              type="button"
              :aria-label="showWeatherKey ? '隐藏 API Key' : '显示 API Key'"
              @click="showWeatherKey = !showWeatherKey"
            >
              <svg v-if="!showWeatherKey" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><path d="M2 2l20 20" /></svg>
            </button>
          </span>
        </label>
        <p v-if="store.currentUser?.role !== 'admin'" class="weather-hint">天气由管理员统一配置，所有用户共享同一份天气设置。</p>
        <p v-else class="weather-hint">数据经本机服务端代理获取（隐藏 Key），30 分钟缓存；免费版包含实时天气、3 天预报、空气与预警。申请地址：https://dev.qweather.com</p>
      </div>
      <div v-if="store.settings.weather.enabled" class="edit-actions">
        <button class="btn-mini btn-mini--primary" type="button" :disabled="weatherBusy" @click="saveWeatherSettings">
          {{ weatherBusy ? '保存中…' : '保存天气设置' }}
        </button>
      </div>
    </div>

    <!-- 站点页脚（开源默认全空：各部署填自己的备案号与文案） -->
    <div v-show="activeTab === 'site'" class="panel reveal">
      <div class="panel-head">
        <h3>站点页脚</h3>
        <span class="panel-note">公开页与登录页底部；仓库默认全空，不会带出任何人的备案信息</span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">显示访问统计</span>
          <span class="row-meta">本机统计（不记录 IP / 访客身份）；关闭时不请求、不写库</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="显示访问统计"
          :checked="store.settings.site.showVisits"
          @change="store.settings.site.showVisits = ($event.target as HTMLInputElement).checked"
        />
      </div>
      <div class="sub-row">
        <label class="edit-field">
          <span class="edit-field__label">页脚文案</span>
          <input
            v-model="store.settings.site.footerText"
            class="text-input"
            type="text"
            maxlength="200"
            placeholder="选填，如：由示例 2301 班维护"
          />
        </label>
        <label class="edit-field">
          <span class="edit-field__label">ICP 备案号</span>
          <input
            v-model="store.settings.site.icp"
            class="text-input"
            type="text"
            maxlength="50"
            placeholder="选填，如：苏ICP备2026XXXXXX号-1"
          />
        </label>
        <label class="edit-field">
          <span class="edit-field__label">公安备案号</span>
          <input
            v-model="store.settings.site.policeIcp"
            class="text-input"
            type="text"
            maxlength="80"
            placeholder="选填，如：苏公网安备 3202XXXXXXXXXX号"
          />
        </label>
        <p class="weather-hint">
          页脚固定显示「Powered by ClassBoard」并链接到 GitHub 仓库；备案号留空则不显示，填写后自动链接到工信部备案系统。
        </p>
      </div>
      <div class="edit-actions">
        <button class="btn-mini btn-mini--primary" type="button" :disabled="siteBusy" @click="saveSiteSettings">
          {{ siteBusy ? '保存中…' : '保存站点设置' }}
        </button>
      </div>
    </div>

    <!-- 数据管理 -->
    <div v-show="activeTab === 'data'" class="panel reveal">
      <div class="panel-head">
        <h3>数据管理</h3>
        <span class="panel-note">导出 JSON 备份 / 导入 JSON 恢复</span>
      </div>
      <div class="row row--wrap">
        <span class="row-main">
          <span class="row-title">导出备份（按账号）</span>
          <span class="row-meta">你名下全部班级：学期、课表、日历、单课调整、通知；天气密钥脱敏写入</span>
        </span>
        <button class="btn-mini" type="button" :disabled="backupBusy" @click="exportBackup('account')">{{ backupBusy ? '处理中…' : '导出 JSON' }}</button>
      </div>
      <div v-if="store.currentUser?.role === 'admin'" class="row row--wrap">
        <span class="row-main">
          <span class="row-title">整站导出（管理员）</span>
          <span class="row-meta">全部班级 + 全部账号（含口令哈希，可直接重建登录）；仅管理员可导出，请妥善保管</span>
        </span>
        <button class="btn-mini btn-mini--danger" type="button" :disabled="backupBusy" @click="exportBackup('site')">{{ backupBusy ? '处理中…' : '导出整站 JSON' }}</button>
      </div>
      <div class="row row--wrap">
        <span class="row-main">
          <span class="row-title">导入恢复</span>
          <span class="row-meta">两种模式：作为新班级导入，或覆盖已有班级；旧版（v2–v5）备份自动翻译成班级结构</span>
        </span>
        <button class="btn-mini" type="button" :disabled="backupBusy" @click="pickRestoreFile">{{ backupBusy ? '处理中…' : '导入 JSON' }}</button>
        <input ref="restoreInput" class="hidden-input" type="file" accept=".json,application/json" @change="onRestoreFile" />
      </div>
    </div>

    <!-- 账号（个人信息 / 修改密码 / 已登录设备） -->
    <div v-show="activeTab === 'account'" class="panel reveal">
      <div class="panel-head">
        <h3>账号</h3>
        <span class="panel-note">{{ store.currentUser?.username }} · {{ store.currentUser?.role === 'admin' ? '管理员' : '班级负责人' }}</span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">修改密码</span>
          <span class="row-meta">修改后所有设备将退出登录</span>
        </span>
      </div>
      <div class="sub-row">
        <label class="edit-field">
          <span class="edit-field__label">当前密码</span>
          <input v-model="changePass.old" class="date-input" type="password" placeholder="当前密码" maxlength="64" />
        </label>
        <label class="edit-field">
          <span class="edit-field__label">新密码</span>
          <input v-model="changePass.next" class="date-input" type="password" placeholder="6–64 位新密码" maxlength="64" />
        </label>
      </div>
      <p v-if="changePassError" class="edit-error" role="alert">{{ changePassError }}</p>
      <div class="edit-actions">
        <button class="btn-mini btn-mini--primary" type="button" :disabled="changePassBusy" @click="changePassword">
          {{ changePassBusy ? '修改中…' : '修改密码' }}
        </button>
      </div>

      <div class="row row--wrap" style="margin-top: var(--spacing-lg)">
        <span class="row-main">
          <span class="row-title">已登录设备</span>
          <span class="row-meta">撤销设备会同时清除此账号在所有设备上的"记住我"状态</span>
        </span>
      </div>
      <div v-for="s in sessions" :key="s.id" class="row">
        <span class="row-main">
          <span class="row-title">{{ s.deviceName || '未知设备' }}</span>
          <span class="row-meta num">{{ s.ip || '—' }} · 最近活动 {{ formatTime(s.lastUsedAt) }} · {{ s.type === 'remember' ? '记住我' : '会话' }}</span>
        </span>
        <button class="btn-mini btn-mini--danger" type="button" :disabled="sessionsBusy" @click="revokeSession(s.id)">撤销</button>
      </div>
      <div v-if="!sessions.length" class="sp-empty">暂无会话记录</div>
    </div>

    <!-- 注册审批（admin 专属） -->
    <div v-show="activeTab === 'approvals'" class="panel reveal">
      <div class="panel-head">
        <h3>负责人注册审批</h3>
        <button class="btn-mini" type="button" @click="loadApprovals">刷新</button>
      </div>
      <p class="panel-note panel-note--block">
        负责人账号注册后需在此通过审核，才能创建 / 加入班级；拒绝时可填理由，申请人登录后可见。
      </p>
      <div v-for="u in approvals" :key="u.id" class="row row--wrap">
        <span class="row-main">
          <span class="row-title">{{ u.username }}</span>
          <span class="row-meta">
            学校：{{ u.school || '—' }} · 专业：{{ u.major || '—' }} · 班级：{{ u.claimedClass || '—' }}
          </span>
          <span class="row-meta num">申请于 {{ formatTime(u.createdAt) }}</span>
        </span>
        <button class="btn-mini btn-mini--primary" type="button" :disabled="approvalsBusy" @click="approveUser(u)">通过</button>
        <button class="btn-mini btn-mini--danger" type="button" :disabled="approvalsBusy" @click="openReject(u)">拒绝</button>
      </div>
      <div v-if="!approvals.length" class="sp-empty">暂无待审核的注册申请</div>
    </div>

    <!-- 用户管理（admin 专属） -->
    <div v-show="activeTab === 'users'" class="panel reveal">
      <div class="panel-head">
        <h3>用户管理</h3>
        <button class="btn-add" type="button" @click="openNewUser">＋ 创建用户</button>
      </div>

      <div class="row row--wrap">
        <span class="row-main">
          <span class="row-title">开放注册</span>
          <span class="row-meta">{{ store.signupEnabled ? '已开放：登录页显示「申请成为班级负责人」入口，注册后需在此审批' : '已关闭：仅管理员可创建账号' }}</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="开放注册"
          :checked="store.signupEnabled"
          :disabled="signupBusy"
          @change="toggleSignup"
        />
      </div>

      <div v-if="showNewUser" class="new-semester">
        <div class="edit-fields">
          <label class="edit-field">
            <span class="edit-field__label">用户名</span>
            <input v-model="newUser.username" class="date-input" type="text" placeholder="2-20 位字母/数字/中文" maxlength="20" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">密码</span>
            <input v-model="newUser.password" class="date-input" type="password" placeholder="6–64 位" maxlength="64" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">角色</span>
            <div class="select-wrap">
              <AppSelect v-model="newUser.role" :options="[{ value: 'leader', label: '班级负责人' }, { value: 'admin', label: '管理员' }]" aria-label="角色" />
            </div>
          </label>
        </div>
        <p v-if="newUserError" class="edit-error" role="alert">{{ newUserError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="newUserBusy" @click="createUser">{{ newUserBusy ? '创建中…' : '创建' }}</button>
          <button class="btn-mini" type="button" :disabled="newUserBusy" @click="showNewUser = false">取消</button>
        </div>
      </div>

      <div v-for="u in users" :key="u.id" class="row row--wrap">
        <span class="row-main">
          <span class="row-title">
            {{ u.username }}
            <span v-if="u.role === 'admin'" class="chip">管理员</span>
            <span v-else class="chip">负责人</span>
            <span v-if="u.status === 'pending'" class="chip">待审核</span>
            <span v-if="u.status === 'rejected'" class="chip chip--danger">已拒绝</span>
            <span v-if="u.disabled" class="chip chip--danger">已禁用</span>
            <span v-if="u.id === store.currentUser?.id" class="chip">当前</span>
          </span>
          <span class="row-meta num">创建于 {{ formatTime(u.createdAt) }} · 最后登录 {{ formatTime(u.lastLoginAt) }}</span>
        </span>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini" type="button" @click="toggleUserRole(u)">
          {{ u.role === 'admin' ? '降为负责人' : '设为管理员' }}
        </button>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini" type="button" @click="toggleUserDisabled(u)">
          {{ u.disabled ? '启用' : '禁用' }}
        </button>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini" type="button" @click="openReset(u)">重置密码</button>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini btn-mini--danger" type="button" @click="openDelete(u)">删除</button>
      </div>
    </div>

    <!-- 重置密码弹窗 -->
    <div v-if="resetTarget" class="modal-mask" @mousedown.self="resetTarget = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="重置密码">
        <h3 class="modal-title">重置「{{ resetTarget.username }}」的密码</h3>
        <label class="field">
          <span class="field__label">新密码（6–64 位）</span>
          <input v-model="resetPassword" class="date-input" type="password" maxlength="64" />
        </label>
        <p v-if="resetError" class="edit-error" role="alert">{{ resetError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="resetBusy" @click="resetTarget = null">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="resetBusy" @click="submitReset">
            {{ resetBusy ? '重置中…' : '确认重置' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 拒绝申请（可填理由） -->
    <div v-if="rejectTarget" class="modal-mask" @mousedown.self="rejectTarget = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="拒绝申请">
        <h3 class="modal-title">拒绝「{{ rejectTarget.username }}」的申请</h3>
        <label class="field">
          <span class="field__label">理由（可选，申请人登录后可见）</span>
          <input v-model="rejectNote" class="date-input" type="text" maxlength="100" placeholder="如：班级信息不完整" />
        </label>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="rejectBusy" @click="rejectTarget = null">取消</button>
          <button class="btn-mini btn-mini--danger" type="button" :disabled="rejectBusy" @click="submitReject">
            {{ rejectBusy ? '提交中…' : '确认拒绝' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 同名班级已存在：加入成为共同负责人 -->
    <div v-if="joinTarget" class="modal-mask" @mousedown.self="joinTarget = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="加入班级">
        <h3 class="modal-title">班级已存在</h3>
        <p class="modal-desc">
          「{{ joinTarget.school }} · {{ joinTarget.name }}」已由其他负责人创建。加入后你与该班现有负责人权限完全同级，可共同维护课表。
        </p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="joinBusy" @click="joinTarget = null">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="joinBusy" @click="joinExistingClass">
            {{ joinBusy ? '加入中…' : '加入该班级' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除账号弹窗 -->
    <div v-if="deleteTarget" class="modal-mask" @mousedown.self="deleteTarget = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="删除账号">
        <h3 class="modal-title">删除账号「{{ deleteTarget.username }}」</h3>
        <p class="modal-desc">
          该账号将退出其全部班级；若某个班因此没有负责人，将连同该班数据一并删除。
          此操作会记入变更记录（可回退）。
        </p>
        <p v-if="deleteError" class="edit-error" role="alert">{{ deleteError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="deleteBusy" @click="deleteTarget = null">取消</button>
          <button class="btn-mini btn-mini--danger" type="button" :disabled="deleteBusy" @click="submitDelete">
            {{ deleteBusy ? '删除中…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 导入恢复：选模式（新班 / 覆盖） -->
    <div v-if="restoreFile" class="modal-mask" @mousedown.self="restoreFile = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="导入备份">
        <h3 class="modal-title">导入备份</h3>
        <p class="modal-desc">{{ restoreFile.name }}</p>
        <div class="restore-modes">
          <label class="restore-mode" :class="{ active: restoreMode === 'new' }">
            <input v-model="restoreMode" type="radio" value="new" />
            <span>
              <b>作为新班级</b>
              <em>新建一个班承接这份备份，现有班级不受影响</em>
            </span>
          </label>
          <label class="restore-mode" :class="{ active: restoreMode === 'overwrite' }">
            <input v-model="restoreMode" type="radio" value="overwrite" />
            <span>
              <b>覆盖已有班级</b>
              <em>清空所选班级后按备份重建（会记入变更记录，可整班回退）</em>
            </span>
          </label>
        </div>
        <div v-if="restoreMode === 'new'" class="edit-fields">
          <label class="edit-field">
            <span class="edit-field__label">学校</span>
            <input v-model="restoreSchool" class="date-input" type="text" placeholder="如：示例大学" maxlength="40" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">班级名</span>
            <input v-model="restoreName" class="date-input" type="text" placeholder="如：物联网 2301" maxlength="40" />
          </label>
        </div>
        <div v-else class="edit-fields">
          <label class="edit-field edit-field--wide">
            <span class="edit-field__label">覆盖哪个班</span>
            <div class="select-wrap">
              <AppSelect v-model="restoreTargetClassId" :options="restoreClassOptions" aria-label="覆盖哪个班" />
            </div>
          </label>
        </div>
        <p class="panel-note panel-note--block">
          多班备份选「作为新班级」时会按备份里的班级逐个新建（重名自动加「（导入）」后缀）。
        </p>
        <p v-if="restoreError" class="edit-error" role="alert">{{ restoreError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="backupBusy" @click="restoreFile = null">取消</button>
          <button class="btn-mini btn-mini--primary" type="button" :disabled="backupBusy" @click="submitRestore">
            {{ backupBusy ? '导入中…' : '开始导入' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 单课调整：登记弹窗 + 详情卡（与课表角标同一张） -->
    <AdjustEditor
      :open="showAdjustEditor"
      @close="showAdjustEditor = false"
      @done="showAdjustEditor = false; toast('已登记调整', 'success')"
    />
    <AdjustDetail :open="!!adjustChain" :chain="adjustChain" @close="adjustChain = null" />
  </div>
</template>

<style scoped>
.page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--spacing-lg);
}

.settings-head {
  font-size: var(--font-size-2xl);
  margin-bottom: var(--spacing-lg);
}

/* Tab 导航：11 个页签，窄窗口自动换行（此前单行 + 隐藏滚动条会把右侧页签裁掉且无法滚动） */
.settings-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-lg);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border-default);
}

.settings-tab {
  flex: none;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.settings-tab:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-body);
}

.settings-tab.active {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

/* 弹窗（重置密码 / 删除用户）——基础样式在全局 style.css */

.chip--danger {
  color: var(--color-feedback-error);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-danger-line, #fecaca);
}

/* 单课调整台账：类型胶囊沿用角标语义色（UI 设计文档 3.6） */
.chip-cancel {
  color: var(--badge-cancel-text);
  background: var(--badge-cancel-bg);
  border: 1px solid var(--badge-cancel-line);
}

.chip-move {
  color: var(--badge-move-text);
  background: var(--badge-move-bg);
  border: 1px solid var(--badge-move-line);
}

.chip-extra {
  color: var(--badge-extra-text);
  background: var(--badge-extra-bg);
  border: 1px solid var(--badge-extra-line);
}

/* 导入恢复：模式选择 */
.restore-modes {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin: var(--spacing-md) 0;
}

.restore-mode {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.restore-mode.active {
  border-color: var(--color-brand);
  background: var(--color-brand-subtle);
}

.restore-mode input {
  margin-top: 3px;
  accent-color: var(--color-brand);
}

.restore-mode b {
  display: block;
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
}

.restore-mode em {
  font-style: normal;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

/* 变更记录视角切换（管理员） */
.seg-view {
  display: flex;
  gap: 3px;
  padding: 3px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}

.seg-view__item {
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.seg-view__item.active {
  background: var(--color-bg-surface);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.ledger-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-top: var(--spacing-xl);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--color-border-default);
}

.ledger-head h3 {
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  font-weight: var(--font-weight-medium);
}

.panel {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-lg);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.panel h3 {
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  font-weight: var(--font-weight-medium);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
}

.row:first-of-type {
  border-top: none;
}

.row--wrap {
  flex-wrap: wrap;
}

.row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.row-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.row-meta {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.sub-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0 var(--spacing-sm) var(--spacing-xl);
  border-top: 1px solid var(--color-border-default);
}

.edit-fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  margin-top: var(--spacing-sm);
}

/* 学期日历录入行：与 edit-fields 同一栅格，底部对齐 */
.cal-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--spacing-md);
  margin: var(--spacing-sm) 0 var(--spacing-md);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--color-border-default);
}

.cal-form .edit-field {
  min-width: 150px;
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.edit-field--grow {
  flex: 1;
  min-width: 200px;
}

.edit-field__label {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

/* 天气设置：文本输入框 + 提示 */
.text-input {
  min-width: 220px;
}

.weather-hint {
  width: 100%;
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  line-height: 1.6;
}

/* API Key 输入：眼睛按钮切换明文/密文 */
.key-input-wrap {
  display: inline-flex;
  align-items: center;
  position: relative;
}

.key-input {
  padding-right: 34px;
}

.key-eye {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.key-eye:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-body);
}

.key-eye svg {
  width: 16px;
  height: 16px;
}

.new-semester {
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  margin-bottom: var(--spacing-sm);
}

.period-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.period-col {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.period-card {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  transition: box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.period-card:hover {
  box-shadow: var(--shadow-hover);
  border-color: var(--color-border-strong);
}

.period-card.editing {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

.period-card--new {
  border-style: dashed;
}

.p-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.p-idx {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.p-time {
  margin-top: 2px;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

/* 悬停才显示的操作图标（触摸屏常显） */
.p-tools {
  display: flex;
  gap: 2px;
}

.p-tool {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.period-card:hover .p-tool,
.p-tool:focus-visible {
  opacity: 1;
}

.p-tool:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text-body);
}

.p-tool--danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-feedback-error);
}

.p-tool svg {
  width: 13px;
  height: 13px;
}

/* 编辑态 */
.p-edit-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}

.time-input {
  width: 92px;
  height: 30px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  font-family: inherit;
  font-size: var(--font-size-md);
  font-variant-numeric: tabular-nums;
}

.time-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

.p-dash {
  color: var(--color-text-tertiary);
}

.p-error {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-xs);
  color: var(--color-feedback-error);
}

.p-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

@media (max-width: 560px) {
  .period-cols {
    grid-template-columns: 1fr;
  }
}

.switch {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  flex: none;
  width: 44px;
  height: 26px;
  margin: 0;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background-color var(--motion-duration-normal) var(--motion-easing-standard);
}

.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: var(--color-white);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-card);
  transition: transform var(--motion-duration-normal) var(--motion-easing-standard);
}

.switch:checked {
  background: var(--color-brand);
}

.switch:checked::after {
  transform: translateX(18px);
}

.hidden-input {
  display: none;
}
</style>
