<script setup lang="ts">
// 设置页（规范 3.6）：学期管理 / 节次时间模板 / 提醒设置 / 数据管理 / 访问口令 / 外观
import { computed, reactive, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import AppSelect, { type AppSelectOption } from '@/components/common/AppSelect.vue'
import { confirm, toast } from '@/utils/ui'
import type { Semester } from '@/types'

const store = useScheduleStore()

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

// ================= 节次时间模板 =================
const periodBusy = ref(false)
const periodError = ref('')
const newPeriod = reactive({ startTime: '08:00', endTime: '08:45' })

async function addPeriod(): Promise<void> {
  periodError.value = ''
  if (!newPeriod.startTime || !newPeriod.endTime) {
    periodError.value = '请填写起止时间'
    return
  }
  if (newPeriod.endTime <= newPeriod.startTime) {
    periodError.value = '结束时间须晚于开始时间'
    return
  }
  periodBusy.value = true
  try {
    await store.addPeriod({ startTime: newPeriod.startTime, endTime: newPeriod.endTime })
    toast('节次已添加', 'success')
    newPeriod.startTime = ''
    newPeriod.endTime = ''
  } catch (e) {
    periodError.value = e instanceof Error ? e.message : '添加失败，请重试'
  } finally {
    periodBusy.value = false
  }
}

async function removePeriod(index: number): Promise<void> {
  const ok = await confirm({
    title: '删除节次',
    desc: `将删除第 ${index} 节（${store.periods[index - 1]?.startTime}–${store.periods[index - 1]?.endTime}），其余节次自动重排。`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await store.deletePeriod(store.periods[index - 1].id)
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

// ================= 访问口令 =================
const passphrase = ref('')
const passBusy = ref(false)
const passError = ref('')

async function toggleAccess(): Promise<void> {
  passError.value = ''
  const target = !store.settings.accessEnabled
  if (target) {
    if (passphrase.value.length < 4 || passphrase.value.length > 20) {
      passError.value = '口令长度须为 4–20 位'
      return
    }
  } else {
    if (!passphrase.value) {
      passError.value = '请输入当前口令以关闭'
      return
    }
  }
  passBusy.value = true
  try {
    if (target) {
      await store.enableAccess(passphrase.value)
      toast('访问口令已开启', 'success')
    } else {
      await store.disableAccess(passphrase.value)
      toast('访问口令已关闭', 'success')
    }
    passphrase.value = ''
  } catch (e) {
    passError.value = e instanceof Error ? e.message : '操作失败，请重试'
  } finally {
    passBusy.value = false
  }
}
</script>

<template>
  <div class="page settings-view">
    <h2 class="settings-head reveal">设置</h2>

    <!-- 学期管理 -->
    <div class="panel reveal">
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
            <input v-model="newSemester.startDate" class="date-input" type="date" />
          </label>
          <label class="edit-field">
            <span class="edit-field__label">结束日期</span>
            <input v-model="newSemester.endDate" class="date-input" type="date" />
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
                <input v-model="editStart" class="date-input" type="date" aria-label="开始日期" />
              </label>
              <label class="edit-field">
                <span class="edit-field__label">结束日期</span>
                <input v-model="editEnd" class="date-input" type="date" aria-label="结束日期" />
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

    <!-- 节次时间模板 -->
    <div class="panel reveal">
      <div class="panel-head">
        <h3>节次时间模板</h3>
        <span class="panel-note">行数可增删，修改后课表即时生效</span>
      </div>
      <div v-for="p in store.periods" :key="p.id" class="row">
        <span class="row-title num">第 {{ p.index }} 节</span>
        <span class="row-meta num">{{ p.startTime }} – {{ p.endTime }}</span>
        <button class="btn-mini btn-mini--danger" type="button" aria-label="删除第 {{ p.index }} 节" @click="removePeriod(p.index)">删除</button>
      </div>
      <div class="period-add">
        <label class="edit-field">
          <span class="edit-field__label">开始</span>
          <input v-model="newPeriod.startTime" class="date-input" type="time" />
        </label>
        <label class="edit-field">
          <span class="edit-field__label">结束</span>
          <input v-model="newPeriod.endTime" class="date-input" type="time" />
        </label>
        <button class="btn-mini" type="button" :disabled="periodBusy" @click="addPeriod">{{ periodBusy ? '添加中…' : '＋ 添加节次' }}</button>
      </div>
      <p v-if="periodError" class="edit-error" role="alert">{{ periodError }}</p>
    </div>

    <!-- 单双周过滤 -->
    <div class="panel reveal">
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
    <div class="panel reveal">
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

    <!-- 数据管理 -->
    <div class="panel reveal">
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

    <!-- 访问口令 -->
    <div class="panel reveal">
      <div class="panel-head">
        <h3>访问口令</h3>
        <span class="panel-note">可选的单用户轻量防护；口令以哈希存储，无找回机制</span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">启用访问口令</span>
          <span class="row-meta">{{ store.settings.accessEnabled ? '已开启：未认证会话进入应用前需输入口令' : '已关闭' }}</span>
        </span>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          aria-label="启用访问口令"
          :checked="store.settings.accessEnabled"
          @change="toggleAccess"
        />
      </div>
      <div v-if="!store.settings.accessEnabled || true" class="sub-row">
        <label class="edit-field edit-field--grow">
          <span class="edit-field__label">{{ store.settings.accessEnabled ? '输入当前口令以关闭' : '设置口令（4–20 位）' }}</span>
          <input v-model="passphrase" class="date-input" type="password" :placeholder="store.settings.accessEnabled ? '当前口令' : '4–20 位口令'" maxlength="20" />
        </label>
      </div>
      <p v-if="passError" class="edit-error" role="alert">{{ passError }}</p>
    </div>

    <!-- 外观 -->
    <div class="panel reveal">
      <div class="row">
        <span class="row-main">
          <span class="row-title">外观</span>
          <span class="row-meta">固定清新浅色极简（本期无主题切换）</span>
        </span>
      </div>
    </div>
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

.period-add {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--color-border-default);
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
