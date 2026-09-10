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
import { api, type SessionInfo, type UserInfo } from '@/api/client'
import TemplateAdmin from '@/components/settings/TemplateAdmin.vue'
import type { Period, Semester } from '@/types'

const store = useScheduleStore()
const route = useRoute()
const router = useRouter()

// ================= Tab 导航 =================
type TabKey = 'semester' | 'period' | 'reminder' | 'weather' | 'data' | 'account' | 'users' | 'templates'

const TABS: { key: TabKey; label: string; adminOnly?: boolean }[] = [
  { key: 'semester', label: '学期' },
  { key: 'period', label: '节次' },
  { key: 'reminder', label: '提醒' },
  { key: 'weather', label: '天气' },
  { key: 'data', label: '数据' },
  { key: 'account', label: '账号' },
  { key: 'users', label: '用户管理', adminOnly: true },
  { key: 'templates', label: '课程模板', adminOnly: true },
]

const activeTab = ref<TabKey>('semester')

onMounted(() => {
  const t = route.query.tab as TabKey | undefined
  if (t && TABS.some((x) => x.key === t)) activeTab.value = t
  void loadSessions()
  if (store.currentUser?.role === 'admin') void loadUsers()
})

function switchTab(t: TabKey): void {
  activeTab.value = t
  void router.replace({ query: { ...route.query, tab: t } })
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

const reminderModeOptions: AppSelectOption[] = [
  { value: 'every', label: '每节课提醒' },
  { value: 'first', label: '仅当天首课提醒' },
]

const advanceMinutesOptions: AppSelectOption[] = [
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
]

const advanceDaysOptions: AppSelectOption[] = [
  { value: 1, label: '1 天' },
  { value: 2, label: '2 天' },
  { value: 3, label: '3 天' },
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
  const ok = await confirm({
    title: '删除节次',
    desc: `将删除第 ${index} 节（${p.startTime}–${p.endTime}），其余节次自动重排。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await store.deletePeriod(p.id)
    toast('节次已删除', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败，请重试', 'error')
  }
}

// ================= 提醒设置 =================
const reminderBusy = ref(false)

const notificationState = computed(() => {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
})

async function requestNotificationPermission(): Promise<void> {
  if (!('Notification' in window)) return
  const perm = await Notification.requestPermission()
  toast(perm === 'granted' ? '通知已授权' : '通知未授权，提醒将仅在站内展示', perm === 'granted' ? 'success' : 'warning')
}

async function saveReminderSettings(): Promise<void> {
  reminderBusy.value = true
  try {
    await store.updateSettings({
      reminder: store.settings.reminder,
      labReminder: store.settings.labReminder,
      homeworkReminder: store.settings.homeworkReminder,
    })
    toast('提醒设置已保存', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请重试', 'error')
  } finally {
    reminderBusy.value = false
  }
}

// ================= 单双周过滤 =================
async function toggleOddEven(v: boolean): Promise<void> {
  await store.setShowOddEvenFilter(v)
}

// ================= 天气（和风天气） =================
const weatherBusy = ref(false)
const showWeatherKey = ref(false)

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

async function exportBackup(): Promise<void> {
  backupBusy.value = true
  try {
    await apiExport()
    toast('已导出备份文件', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败，请重试', 'error')
  } finally {
    backupBusy.value = false
  }
}

async function apiExport(): Promise<void> {
  const { api } = await import('@/api/client')
  await api.exportBackup()
}

function pickRestoreFile(): void {
  restoreInput.value?.click()
}

async function onRestoreFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const ok = await confirm({
    title: '导入备份',
    desc: '将用备份文件覆盖当前全部数据（学期、课程、考试、作业与设置），此操作不可撤销。建议先导出当前数据作为安全网。',
    danger: true,
    confirmText: '覆盖导入',
  })
  if (!ok) return
  backupBusy.value = true
  try {
    const { api } = await import('@/api/client')
    const res = await api.restoreBackup(file)
    await store.bootstrap()
    toast(`恢复完成：${res.restored.semesters} 个学期 / ${res.restored.courses} 门课程`, 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : '恢复失败，请重试', 'error')
  } finally {
    backupBusy.value = false
  }
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

// ================= 用户管理（admin） =================
const users = ref<UserInfo[]>([])
const signupBusy = ref(false)
const showNewUser = ref(false)
const newUser = reactive({ username: '', password: '', role: 'user' as 'admin' | 'user' })
const newUserError = ref('')
const newUserBusy = ref(false)
const resetTarget = ref<UserInfo | null>(null)
const resetPassword = ref('')
const resetBusy = ref(false)
const resetError = ref('')
const deleteTarget = ref<UserInfo | null>(null)
const deleteTransfer = ref<string>('')
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
  Object.assign(newUser, { username: '', password: '', role: 'user' as const })
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
  const next = u.role === 'admin' ? 'user' : 'admin'
  const ok = await confirm({
    title: next === 'admin' ? '设为管理员' : '取消管理员',
    desc: next === 'admin'
      ? `将「${u.username}」设为管理员（拥有全部权限与用户管理能力）。`
      : `将「${u.username}」降为普通用户。`,
    danger: next !== 'admin',
    confirmText: next === 'admin' ? '设为管理员' : '降为普通用户',
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
  deleteTransfer.value = ''
  deleteError.value = ''
}

async function submitDelete(): Promise<void> {
  if (!deleteTarget.value) return
  deleteError.value = ''
  deleteBusy.value = true
  try {
    const transferTo = deleteTransfer.value === '' ? null : Number(deleteTransfer.value)
    await api.deleteUser(deleteTarget.value.id, transferTo)
    deleteTarget.value = null
    await loadUsers()
    toast('用户已删除', 'success')
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

    <!-- 单双周过滤 -->
    <div v-show="activeTab === 'reminder'" class="panel reveal">
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

    <!-- 提醒设置 -->
    <div v-show="activeTab === 'reminder'" class="panel reveal">
      <div class="panel-head">
        <h3>提醒</h3>
        <span class="panel-note">默认关闭；页面未打开时不产生提醒</span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">课程提醒</span>
          <span class="row-meta">上课前 N 分钟浏览器通知 + 站内铃铛</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="课程提醒"
          :checked="store.settings.reminder.enabled"
          @change="store.settings.reminder.enabled = ($event.target as HTMLInputElement).checked"
        />
      </div>
      <div v-if="store.settings.reminder.enabled" class="sub-row">
        <label class="edit-field">
          <span class="edit-field__label">提醒时机</span>
          <div class="select-wrap">
            <AppSelect v-model="store.settings.reminder.mode" :options="reminderModeOptions" aria-label="提醒时机" />
          </div>
        </label>
        <label class="edit-field">
          <span class="edit-field__label">提前分钟数</span>
          <div class="select-wrap">
            <AppSelect v-model="store.settings.reminder.advanceMinutes" :options="advanceMinutesOptions" aria-label="提前分钟数" />
          </div>
        </label>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">实验课提醒</span>
          <span class="row-meta">仅对课程类型=实验课的课程生效，与课程提醒互不影响</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="实验课提醒"
          :checked="store.settings.labReminder.enabled"
          @change="store.settings.labReminder.enabled = ($event.target as HTMLInputElement).checked"
        />
      </div>
      <div v-if="store.settings.labReminder.enabled" class="sub-row">
        <label class="edit-field">
          <span class="edit-field__label">提醒时机</span>
          <div class="select-wrap">
            <AppSelect v-model="store.settings.labReminder.mode" :options="reminderModeOptions" aria-label="实验课提醒时机" />
          </div>
        </label>
        <label class="edit-field">
          <span class="edit-field__label">提前分钟数</span>
          <div class="select-wrap">
            <AppSelect v-model="store.settings.labReminder.advanceMinutes" :options="advanceMinutesOptions" aria-label="实验课提前分钟数" />
          </div>
        </label>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">作业截止提醒</span>
          <span class="row-meta">截止前 N 天在站内铃铛提示</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="作业截止提醒"
          :checked="store.settings.homeworkReminder.enabled"
          @change="store.settings.homeworkReminder.enabled = ($event.target as HTMLInputElement).checked"
        />
      </div>
      <div v-if="store.settings.homeworkReminder.enabled" class="sub-row">
        <label class="edit-field">
          <span class="edit-field__label">提前天数</span>
          <div class="select-wrap">
            <AppSelect v-model="store.settings.homeworkReminder.advanceDays" :options="advanceDaysOptions" aria-label="提前天数" />
          </div>
        </label>
      </div>
      <div class="row row--wrap">
        <span class="row-main">
          <span class="row-title">浏览器通知授权</span>
          <span class="row-meta">
            {{ notificationState === 'granted' ? '已授权' : notificationState === 'denied' ? '已拒绝（需在浏览器设置中开启）' : notificationState === 'unsupported' ? '当前浏览器不支持通知' : '未授权' }}
          </span>
        </span>
        <button v-if="notificationState === 'default'" class="btn-mini" type="button" @click="requestNotificationPermission">授权通知</button>
      </div>
      <div class="edit-actions">
        <button class="btn-mini btn-mini--primary" type="button" :disabled="reminderBusy" @click="saveReminderSettings">
          {{ reminderBusy ? '保存中…' : '保存提醒设置' }}
        </button>
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

    <!-- 数据管理 -->
    <div v-show="activeTab === 'data'" class="panel reveal">
      <div class="panel-head">
        <h3>数据管理</h3>
        <span class="panel-note">导出 JSON 备份 / 导入 JSON 恢复</span>
      </div>
      <div class="row row--wrap">
        <span class="row-main">
          <span class="row-title">导出备份</span>
          <span class="row-meta">导出全部学期、课程、考试、作业与设置为 JSON 文件</span>
        </span>
        <button class="btn-mini" type="button" :disabled="backupBusy" @click="exportBackup">{{ backupBusy ? '处理中…' : '导出 JSON' }}</button>
      </div>
      <div class="row row--wrap">
        <span class="row-main">
          <span class="row-title">导入恢复</span>
          <span class="row-meta">用备份文件覆盖当前全部数据（建议先导出当前数据）</span>
        </span>
        <button class="btn-mini btn-mini--danger" type="button" :disabled="backupBusy" @click="pickRestoreFile">{{ backupBusy ? '处理中…' : '导入 JSON' }}</button>
        <input ref="restoreInput" class="hidden-input" type="file" accept=".json,application/json" @change="onRestoreFile" />
      </div>
    </div>

    <!-- 账号（个人信息 / 修改密码 / 已登录设备） -->
    <div v-show="activeTab === 'account'" class="panel reveal">
      <div class="panel-head">
        <h3>账号</h3>
        <span class="panel-note">{{ store.currentUser?.username }} · {{ store.currentUser?.role === 'admin' ? '管理员' : '普通用户' }}</span>
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

    <!-- 用户管理（admin 专属） -->
    <div v-show="activeTab === 'users'" class="panel reveal">
      <div class="panel-head">
        <h3>用户管理</h3>
        <button class="btn-add" type="button" @click="openNewUser">＋ 创建用户</button>
      </div>

      <div class="row row--wrap">
        <span class="row-main">
          <span class="row-title">开放注册</span>
          <span class="row-meta">{{ store.signupEnabled ? '已开放：登录页显示注册入口，任何人可注册普通用户' : '已关闭：仅管理员可创建账号' }}</span>
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
              <AppSelect v-model="newUser.role" :options="[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]" aria-label="角色" />
            </div>
          </label>
        </div>
        <p v-if="newUserError" class="edit-error" role="alert">{{ newUserError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="newUserBusy" @click="createUser">{{ newUserBusy ? '创建中…' : '创建' }}</button>
          <button class="btn-mini" type="button" :disabled="newUserBusy" @click="showNewUser = false">取消</button>
        </div>
      </div>

      <div v-for="u in users" :key="u.id" class="row">
        <span class="row-main">
          <span class="row-title">
            {{ u.username }}
            <span v-if="u.role === 'admin'" class="chip">管理员</span>
            <span v-if="u.disabled" class="chip chip--danger">已禁用</span>
            <span v-if="u.id === store.currentUser?.id" class="chip">当前</span>
          </span>
          <span class="row-meta num">创建于 {{ formatTime(u.createdAt) }} · 最后登录 {{ formatTime(u.lastLoginAt) }}</span>
        </span>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini" type="button" @click="toggleUserRole(u)">
          {{ u.role === 'admin' ? '降为普通' : '设为管理员' }}
        </button>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini" type="button" @click="toggleUserDisabled(u)">
          {{ u.disabled ? '启用' : '禁用' }}
        </button>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini" type="button" @click="openReset(u)">重置密码</button>
        <button v-if="u.id !== store.currentUser?.id" class="btn-mini btn-mini--danger" type="button" @click="openDelete(u)">删除</button>
      </div>
    </div>

    <!-- 课程模板（admin 专属） -->
    <div v-show="activeTab === 'templates'" class="panel reveal">
      <TemplateAdmin />
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

    <!-- 删除用户弹窗（数据归属选择） -->
    <div v-if="deleteTarget" class="modal-mask" @mousedown.self="deleteTarget = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="删除用户">
        <h3 class="modal-title">删除用户「{{ deleteTarget.username }}」</h3>
        <p class="modal-desc">该用户的学期、课程、考试、作业数据将如何处理？</p>
        <label class="field">
          <span class="field__label">数据归属</span>
          <div class="select-wrap">
            <AppSelect
              :model-value="deleteTransfer"
              :options="[{ value: '', label: '一并删除该用户全部数据' }, ...users.filter((x) => x.id !== deleteTarget!.id).map((x) => ({ value: String(x.id), label: `转移给 ${x.username}` }))]"
              aria-label="数据归属"
              @update:model-value="(v: string | number | null) => deleteTransfer = v === null ? '' : String(v)"
            />
          </div>
        </label>
        <p v-if="deleteError" class="edit-error" role="alert">{{ deleteError }}</p>
        <div class="edit-actions">
          <button class="btn-mini" type="button" :disabled="deleteBusy" @click="deleteTarget = null">取消</button>
          <button class="btn-mini btn-mini--danger" type="button" :disabled="deleteBusy" @click="submitDelete">
            {{ deleteBusy ? '删除中…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 外观 -->
    <div v-show="activeTab === 'semester'" class="panel reveal" style="display: none"></div>
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

/* Tab 导航 */
.settings-tabs {
  display: flex;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-lg);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border-default);
  overflow-x: auto;
  scrollbar-width: none;
}

.settings-tabs::-webkit-scrollbar {
  display: none;
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

/* 弹窗（重置密码 / 删除用户） */
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

.modal-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.chip--danger {
  color: var(--color-feedback-error);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-danger-line, #fecaca);
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

.panel-note {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
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

.chip {
  font-size: var(--font-size-xs);
  color: var(--color-text-inverse);
  background: var(--color-brand);
  border-radius: var(--radius-full);
  padding: 2px 10px;
}

.btn-mini {
  padding: 4px 14px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-brand);
  background: var(--color-bg-surface);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-mini:hover {
  background: var(--color-bg-hover);
}

.btn-mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-mini--primary {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--color-text-inverse);
}

.btn-mini--primary:hover {
  background: var(--color-brand-hover);
}

.btn-mini--danger {
  color: var(--color-feedback-error);
}

.btn-add {
  padding: 4px 14px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-brand);
  background: var(--color-bg-surface);
}

.btn-add:hover {
  background: var(--color-brand-subtle);
}

.edit-fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  margin-top: var(--spacing-sm);
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
  height: 34px;
  min-width: 220px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  font-size: var(--font-size-sm);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-brand);
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

.date-input {
  height: 34px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  color: var(--color-text-body);
  font-size: var(--font-size-sm);
}

.date-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

.edit-error {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}

.edit-actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
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

.select-wrap {
  min-width: 150px;
}
</style>
