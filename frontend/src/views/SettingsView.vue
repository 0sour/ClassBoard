<script setup lang="ts">
import { ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import type { Semester } from '@/types'

const store = useScheduleStore()

/** 行内编辑状态 */
const editingId = ref<number | null>(null)
const editStart = ref('')
const editEnd = ref('')
const saveBusy = ref(false)
const editError = ref('')

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
  } catch (e) {
    editError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    saveBusy.value = false
  }
}
</script>

<template>
  <div class="page settings-view">
    <h2 class="settings-head reveal">设置</h2>

    <div class="panel reveal">
      <h3>学期</h3>
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
        </template>
      </div>
    </div>

    <div class="panel reveal">
      <h3>节次时间模板</h3>
      <div v-for="p in store.periods" :key="p.id" class="row">
        <span class="row-title num">第 {{ p.index }} 节</span>
        <span class="row-meta num">{{ p.startTime }} – {{ p.endTime }}</span>
      </div>
    </div>

    <div class="panel reveal">
      <h3>其他</h3>
      <div class="row">
        <span class="row-main">
          <span class="row-title">外观</span>
          <span class="row-meta">固定清新浅色</span>
        </span>
      </div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">数据备份</span>
          <span class="row-meta">导出 / 导入 JSON（开发中）</span>
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

.panel h3 {
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  font-weight: var(--font-weight-medium);
  margin-bottom: var(--spacing-md);
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

.row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
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
}

.btn-mini:hover {
  background: var(--color-bg-hover);
}

.btn-mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.edit-fields {
  display: flex;
  gap: var(--spacing-md);
  margin-top: var(--spacing-sm);
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
</style>
