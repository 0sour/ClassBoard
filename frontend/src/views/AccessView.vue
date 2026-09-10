<script setup lang="ts">
// 登录/注册页（多用户）：用户名+密码+记住我；注册入口受管理员开关控制
import { onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'

const store = useScheduleStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const remember = ref(true)
const busy = ref(false)
const error = ref('')

onMounted(() => {
  void store.refreshSignupEnabled()
})

function switchMode(m: 'login' | 'register'): void {
  mode.value = m
  error.value = ''
}

async function submit(): Promise<void> {
  if (!username.value.trim()) {
    error.value = '请输入用户名'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'login') {
      await store.login(username.value.trim(), password.value, remember.value)
    } else {
      await store.register(username.value.trim(), password.value)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败，请重试'
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
    <div class="access-card" role="dialog" aria-modal="true" :aria-label="mode === 'login' ? '登录' : '注册'">
      <div class="access-brand">
        <span class="access-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 9.5h18" /><path d="M8.5 14h2M13.5 14h2M8.5 17.5h2M13.5 17.5h2" /></svg>
        </span>
        <h1>ClassBoard</h1>
        <p class="access-sub">{{ mode === 'login' ? '登录以查看你的课程表' : '创建新账号' }}</p>
      </div>

      <div class="mode-tabs" role="tablist" aria-label="登录方式">
        <button
          class="mode-tab" :class="{ active: mode === 'login' }" type="button" role="tab"
          :aria-selected="mode === 'login'" @click="switchMode('login')"
        >登录</button>
        <button
          v-if="store.signupEnabled"
          class="mode-tab" :class="{ active: mode === 'register' }" type="button" role="tab"
          :aria-selected="mode === 'register'" @click="switchMode('register')"
        >注册</button>
      </div>

      <label class="field">
        <span class="field__label">用户名</span>
        <input
          v-model="username"
          class="pass-input"
          type="text"
          :class="{ invalid: !!error }"
          placeholder="请输入用户名"
          maxlength="20"
          autocomplete="username"
          :disabled="busy"
          @keydown="onKeydown"
        />
      </label>

      <label class="field">
        <span class="field__label">密码</span>
        <input
          v-model="password"
          class="pass-input"
          type="password"
          :class="{ invalid: !!error }"
          :placeholder="mode === 'login' ? '请输入密码' : '6–64 位密码'"
          maxlength="64"
          autocomplete="current-password"
          :disabled="busy"
          @keydown="onKeydown"
        />
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      </label>

      <label v-if="mode === 'login'" class="remember-row">
        <input v-model="remember" type="checkbox" class="remember-check" />
        <span>记住此设备（30 天内免登录）</span>
      </label>

      <button class="btn-submit" type="button" :disabled="busy" @click="submit">
        {{ busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录' }}
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
  gap: var(--spacing-lg);
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

.access-sub {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.mode-tabs {
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
}

.mode-tab {
  flex: 1;
  padding: 6px 0;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  transition: color var(--motion-duration-normal) var(--motion-easing-standard),
    background-color var(--motion-duration-normal) var(--motion-easing-standard);
}

.mode-tab.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
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

.remember-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.remember-check {
  width: 15px;
  height: 15px;
  accent-color: var(--color-brand);
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
