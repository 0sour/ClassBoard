<script setup lang="ts">
// ============================================================
// ClassBoard · 班级选择面板（公开首页，无需登录）
//   列出全部班级（可按学校 / 班级名搜索），点击进入该班课表（只读）
// ============================================================
import { onMounted, ref } from 'vue'
import { api, type PublicClassBrief } from '@/api/client'

const classes = ref<PublicClassBrief[]>([])
const keyword = ref('')
const loading = ref(true)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    classes.value = await api.listPublicClasses(keyword.value.trim())
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="public-page">
    <header class="pub-header">
      <div class="brand">
        <span class="brand-mark">CB</span>
        <b>ClassBoard</b>
      </div>
      <div class="pub-actions">
        <span class="pub-sub">班级课表</span>
        <router-link class="link" to="/login">后台登录</router-link>
      </div>
    </header>

    <main class="pub-main">
      <div class="hero">
        <h1>选择你的班级</h1>
        <p>课表由各班级负责人维护，无需登录即可查看。</p>
      </div>

      <div class="search">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索学校或班级名，如「24集成2」"
          @input="load"
        />
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="empty">加载中…</p>
      <p v-else-if="!classes.length" class="empty">还没有班级课表{{ keyword ? '符合这个搜索' : '' }}</p>

      <ul v-else class="class-list">
        <li v-for="c in classes" :key="c.id">
          <router-link class="class-card" :to="{ name: 'public-class', params: { id: c.id } }">
            <span class="c-name">{{ c.name }}</span>
            <span class="c-meta">
              {{ c.school || '未填写学校' }}<template v-if="c.major"> · {{ c.major }}</template>
            </span>
            <span class="c-count">{{ c.semesterCount }} 个学期</span>
          </router-link>
        </li>
      </ul>
    </main>
  </div>
</template>

<style scoped>
.public-page {
  min-height: 100dvh;
  background: var(--color-bg-page);
}

.pub-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  height: var(--topbar-h, 56px);
  padding: 0 var(--spacing-lg);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border-default);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
}

.pub-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.pub-sub {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.link {
  font-size: var(--font-size-sm);
  color: var(--color-brand);
  text-decoration: none;
}

.pub-main {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--spacing-xl) var(--spacing-lg) var(--spacing-2xl);
}

.hero h1 {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.hero p {
  margin-top: 6px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.search {
  margin: var(--spacing-lg) 0;
}

.search input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  background: var(--color-bg-surface);
}

.search input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.class-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--spacing-md);
  list-style: none;
}

.class-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--spacing-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  text-decoration: none;
  transition: box-shadow var(--motion-duration-fast) var(--motion-easing-standard);
}

.class-card:hover {
  box-shadow: var(--shadow-hover);
}

.c-name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.c-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.c-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.empty {
  padding: var(--spacing-2xl) 0;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.error {
  padding: var(--spacing-md) 0;
  font-size: var(--font-size-sm);
  color: var(--color-feedback-error);
}
</style>
