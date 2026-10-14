<script setup lang="ts">
// ============================================================
// ClassBoard · 公开班级课表（无需登录，只读）
//   结构与后台周课表完全一致：同一套「周课表 / 今天」+ 右侧栏 + 课表网格，
//   只读由 store.readonly 统一控制（无新增/拖拽/编辑/调整入口）。
//   页面外壳：班级名 + 学期切换 + 后台登录入口。
// ============================================================
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import WeekView from '@/views/WeekView.vue'
import DayView from '@/views/DayView.vue'
import AppSelect from '@/components/common/AppSelect.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import NoticeCenter from '@/components/notice/NoticeCenter.vue'

const route = useRoute()
const store = useScheduleStore()

const loading = ref(true)
const error = ref('')
/** 视图切换：与后台顶栏「周课表 / 今天」一致 */
const tab = ref<'week' | 'day'>('week')

const classId = computed(() => Number(route.params.id))
const classInfo = computed(() => store.publicClass)

const semesterOptions = computed(() =>
  store.semesters.map((s) => ({ value: s.id, label: s.name })),
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    await store.loadPublicClass(classId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '班级不存在或已删除'
  } finally {
    loading.value = false
  }
}

watch(classId, () => void load(), { immediate: true })

function setSemester(v: string | number | null): void {
  if (v === null) return
  void store.setSemester(Number(v))
}
</script>

<template>
  <div class="public-page">
    <header class="pub-header">
      <router-link class="brand" to="/" aria-label="返回班级列表">
        <span class="brand-mark">CB</span>
        <b class="brand-text">ClassBoard</b>
      </router-link>

      <!-- 桌面/平板：视图切换（与后台顶栏分段控件一致） -->
      <div class="pub-seg" role="tablist" aria-label="视图切换">
        <button
          class="pub-seg-btn"
          :class="{ active: tab === 'week' }"
          type="button"
          role="tab"
          :aria-selected="tab === 'week'"
          @click="tab = 'week'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>
          <span>周课表</span>
        </button>
        <button
          class="pub-seg-btn"
          :class="{ active: tab === 'day' }"
          type="button"
          role="tab"
          :aria-selected="tab === 'day'"
          @click="tab = 'day'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
          <span>今天</span>
        </button>
      </div>

      <div class="pub-actions">
        <!-- 班级通知（无需登录；负责人发布后学生在此查看） -->
        <NoticeCenter align="right" />
        <AppSelect
          v-if="store.semesters.length"
          class="semester-select"
          :model-value="store.currentSemesterId"
          :options="semesterOptions"
          aria-label="切换学期"
          @update:model-value="setSemester"
        />
        <router-link class="link" to="/login">后台登录</router-link>
      </div>
    </header>

    <main class="pub-main">
      <p v-if="loading" class="state">
        <Skeleton variant="grid" />
      </p>
      <p v-else-if="error" class="state state--error" role="alert">
        {{ error }}
        <router-link class="link" to="/">← 返回班级列表</router-link>
      </p>

      <template v-else>
        <div class="class-head">
          <h1 class="class-name">
            {{ classInfo?.name }}
            <span v-if="classInfo?.major" class="class-major">{{ classInfo.major }}</span>
          </h1>
          <p class="class-school">
            {{ classInfo?.school }}
            <span class="class-hint">· 课表由班级负责人维护，只读</span>
          </p>
        </div>

        <!-- 与后台周课表 / 今天完全同源同结构（只读由 store.readonly 控制） -->
        <WeekView v-if="tab === 'week'" />
        <DayView v-else />
      </template>
    </main>

    <!-- 移动端：视图切换（与后台底部标签栏同款位置与样式） -->
    <nav class="pub-tabbar" aria-label="视图切换">
      <button
        class="pub-tab"
        :class="{ active: tab === 'week' }"
        type="button"
        :aria-current="tab === 'week' ? 'page' : undefined"
        @click="tab = 'week'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>
        <span>周课表</span>
      </button>
      <button
        class="pub-tab"
        :class="{ active: tab === 'day' }"
        type="button"
        :aria-current="tab === 'day' ? 'page' : undefined"
        @click="tab = 'day'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
        <span>今天</span>
      </button>
    </nav>
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
  z-index: var(--z-index-sticky);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  height: var(--topbar-h-mobile);
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
  text-decoration: none;
  flex: none;
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

/* 桌面分段控件：周课表 / 今天（样式与后台顶栏一致，绝对居中避免左右跳动） */
.pub-seg {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
}

.pub-seg-btn {
  min-width: 104px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  transition: color var(--motion-duration-normal) var(--motion-easing-standard),
    background-color var(--motion-duration-normal) var(--motion-easing-standard),
    box-shadow var(--motion-duration-normal) var(--motion-easing-standard);
}

.pub-seg-btn svg {
  width: 16px;
  height: 16px;
}

.pub-seg-btn.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.pub-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-left: auto;
  flex: none;
}

.semester-select {
  flex: 0 1 180px;
  min-width: 88px;
}

.link {
  font-size: var(--font-size-sm);
  color: var(--color-brand);
  text-decoration: none;
  white-space: nowrap;
}

/* 内容区与后台周课表同宽（WeekView/DayView 自带内边距，这里只负责定位与底部留白） */
.pub-main {
  max-width: 1440px;
  margin: 0 auto;
}

.class-head {
  padding: var(--spacing-lg) var(--spacing-lg) 0;
}

.class-name {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.class-major {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  border-radius: var(--radius-full);
  padding: 2px 10px;
}

.class-school {
  margin-top: 4px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.class-hint {
  color: var(--color-text-tertiary);
}

/* 移动端底部视图切换（同后台标签栏） */
.pub-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-index-sticky);
  display: flex;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border-default);
  padding-bottom: env(safe-area-inset-bottom);
}

.pub-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 0 7px;
  min-height: 48px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

.pub-tab svg {
  width: 20px;
  height: 20px;
}

.pub-tab.active {
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
}

.state {
  padding: var(--spacing-2xl) var(--spacing-lg);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.state--error {
  color: var(--color-feedback-error);
}

@media (min-width: 768px) {
  .pub-header {
    height: var(--topbar-h);
  }

  .pub-tabbar {
    display: none;
  }
}

/* 移动端：顶栏只留品牌图标 + 学期 + 登录入口（视图切换在底部标签栏），
   内容底部留出标签栏高度 */
@media (max-width: 767px) {
  .pub-header {
    gap: var(--spacing-sm);
    padding: 0 var(--spacing-md);
  }

  .brand-text {
    display: none;
  }

  .pub-seg {
    display: none;
  }

  .semester-select {
    flex: 0 1 140px;
    min-width: 72px;
  }

  .pub-main {
    padding-bottom: calc(64px + env(safe-area-inset-bottom));
  }

  .class-head {
    padding: var(--spacing-md) var(--spacing-md) 0;
  }

  .class-name {
    font-size: var(--font-size-xl);
  }
}
</style>
