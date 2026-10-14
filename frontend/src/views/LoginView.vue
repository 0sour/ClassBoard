<script setup lang="ts">
// ============================================================
// ClassBoard · 后台登录面板（班级负责人 / 管理员入口）
//   注册入口刻意不显眼：折叠在底部「申请成为班级负责人」里
//   注册需提交 学校 / 专业 / 班级名，等待管理员审核；待审核与已拒绝在登录后显示状态
// ============================================================
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'

const store = useScheduleStore()
const route = useRoute()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const remember = ref(false)
const school = ref('')
const major = ref('')
const className = ref('')
const error = ref('')
const busy = ref(false)
const showRegister = ref(false)

const pendingUser = computed(() => {
  const u = store.currentUser
  if (!u || u.role === 'admin' || !u.status || u.status === 'active') return null
  return u
})

onMounted(async () => {
  await store.ensureReady()
  await store.refreshSignupEnabled()
  // 已登录且已通过：直接进后台
  if (store.authenticated && !pendingUser.value) {
    const next = typeof route.query.next === 'string' ? route.query.next : '/week'
    void router.replace(next)
  }
})

async function onLogin(): Promise<void> {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名与密码'
    return
  }
  busy.value = true
  try {
    await store.login(username.value.trim(), password.value, remember.value)
    const u = store.currentUser
    if (u && u.role !== 'admin' && u.status && u.status !== 'active') return // 显示待审核状态
    const next = typeof route.query.next === 'string' ? route.query.next : '/week'
    void router.replace(next)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败，请重试'
  } finally {
    busy.value = false
  }
}

async function onRegister(): Promise<void> {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名与密码'
    return
  }
  if (!school.value.trim() || !className.value.trim()) {
    error.value = '请填写学校与班级名（用于管理员审核）'
    return
  }
  busy.value = true
  try {
    await store.register({
      username: username.value.trim(),
      password: password.value,
      school: school.value.trim(),
      major: major.value.trim(),
      className: className.value.trim(),
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '注册失败，请重试'
  } finally {
    busy.value = false
  }
}

async function onLogout(): Promise<void> {
  await store.logout()
  error.value = ''
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <span class="brand-mark">CB</span>
        <div class="brand-text">
          <b>ClassBoard</b>
          <span>班级课表平台 · 后台</span>
        </div>
      </div>

      <!-- 待审核 / 已拒绝：登录后只看到这一屏 -->
      <div v-if="pendingUser" class="pending">
        <h3>{{ pendingUser.status === 'rejected' ? '账号申请未通过' : '账号待审核，请等待管理员处理' }}</h3>
        <p v-if="pendingUser.reviewNote" class="pending-note">原因：{{ pendingUser.reviewNote }}</p>
        <p class="pending-meta">
          {{ pendingUser.username }} · {{ pendingUser.school || '—' }} · {{ pendingUser.claimedClass || '—' }}
        </p>
        <div class="row-actions">
          <button class="btn" type="button" @click="onLogout">退出登录</button>
        </div>
      </div>

      <template v-else>
        <h2 class="title">{{ mode === 'login' ? '登录' : '申请班级负责人账号' }}</h2>

        <label class="field">
          <span>用户名</span>
          <input v-model="username" type="text" maxlength="20" autocomplete="username" @keydown.enter="mode === 'login' && onLogin()" />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" type="password" maxlength="64" autocomplete="current-password" @keydown.enter="mode === 'login' && onLogin()" />
        </label>

        <template v-if="mode === 'register'">
          <label class="field">
            <span>学校</span>
            <input v-model="school" type="text" maxlength="40" placeholder="如：无锡学院" />
          </label>
          <label class="field">
            <span>专业</span>
            <input v-model="major" type="text" maxlength="40" placeholder="如：集成电路设计与集成系统" />
          </label>
          <label class="field">
            <span>班级名</span>
            <input v-model="className" type="text" maxlength="40" placeholder="如：24集成2" @keydown.enter="onRegister()" />
          </label>
          <p class="hint">提交后需管理员审核通过，才能创建 / 管理班级课表。</p>
        </template>

        <label v-if="mode === 'login'" class="check">
          <input v-model="remember" type="checkbox" />
          <span>记住此设备（30 天内免登录）</span>
        </label>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <button class="btn btn-primary" type="button" :disabled="busy" @click="mode === 'login' ? onLogin() : onRegister()">
          {{ busy ? '处理中…' : mode === 'login' ? '登录' : '提交申请' }}
        </button>

        <div class="foot">
          <router-link class="link" to="/">← 返回班级课表</router-link>
          <button
            v-if="store.signupEnabled"
            class="link link-quiet"
            type="button"
            @click="showRegister = !showRegister"
          >申请成为班级负责人</button>
        </div>
        <div v-if="showRegister" class="register-switch">
          <button class="link" type="button" @click="mode = mode === 'login' ? 'register' : 'login'; error = ''">
            {{ mode === 'login' ? '→ 填写申请信息' : '← 返回登录' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  background: var(--color-bg-page);
}

.login-card {
  width: min(380px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-xl);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.brand-text span {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.field input {
  padding: 8px 10px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.field input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

.error {
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}

.btn {
  padding: 9px 14px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  background: var(--color-bg-surface);
}

.btn-primary {
  border-color: var(--color-brand);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-weight: var(--font-weight-medium);
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.register-switch {
  text-align: right;
}

.link {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-xs);
  color: var(--color-brand);
  cursor: pointer;
  text-decoration: none;
}

.link-quiet {
  color: var(--color-text-tertiary);
}

.pending {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.pending h3 {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.pending-note {
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}

.pending-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.row-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
