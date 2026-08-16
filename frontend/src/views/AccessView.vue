<script setup lang="ts">
// 访问口令页（规范 3.7）：全屏居中卡片，校验失败保留输入并提示
import { ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'

const store = useScheduleStore()

const passphrase = ref('')
const busy = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  if (!passphrase.value) {
    error.value = '请输入口令'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await store.verifyAccess(passphrase.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '口令不正确'
  } finally {
    busy.value = false
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') void submit()
}
</script>

<template>
  <div class="access-page">
    <div class="access-card" role="dialog" aria-modal="true" aria-label="输入访问口令">
      <div class="access-brand">
        <span class="access-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 9.5h18" /><path d="M8.5 14h2M13.5 14h2M8.5 17.5h2M13.5 17.5h2" /></svg>
        </span>
        <h1>ClassBoard</h1>
      </div>

      <label class="field">
        <span class="field__label">访问口令</span>
        <input
          v-model="passphrase"
          class="pass-input"
          type="password"
          :class="{ invalid: !!error }"
          placeholder="请输入口令"
          maxlength="20"
          :disabled="busy"
          @keydown="onKeydown"
        />
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      </label>

      <button class="btn-submit" type="button" :disabled="busy" @click="submit">
        {{ busy ? '校验中…' : '进入应用' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.access-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl);
  background: var(--color-bg-page);
}

.access-card {
  width: min(360px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  padding: var(--spacing-xl);
  background: var(--color-bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-pop);
}

.access-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
}

.access-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  background: var(--color-brand-subtle);
  color: var(--color-brand);
}

.access-logo svg {
  width: 26px;
  height: 26px;
}

.access-brand h1 {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.field__label {
  font-size: var(--font-size-md);
  color: var(--color-text-body);
  font-weight: var(--font-weight-medium);
}

.pass-input {
  height: 40px;
  padding: 0 var(--spacing-md);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-text-body);
  font-size: var(--font-size-md);
}

.pass-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 2px var(--color-brand-subtle);
}

.pass-input.invalid {
  border-color: var(--color-feedback-error);
}

.field-error {
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}

.btn-submit {
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-btn);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-submit:hover {
  background: var(--color-brand-hover);
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
