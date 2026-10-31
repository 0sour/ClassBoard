<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import AppSelect from '@/components/common/AppSelect.vue'
import ImportWizard from '@/components/import/ImportWizard.vue'
import CourseEditor from '@/components/course/CourseEditor.vue'
import NoticeCenter from '@/components/notice/NoticeCenter.vue'

const route = useRoute()
const router = useRouter()
const store = useScheduleStore()

const isDesktop = ref(window.innerWidth >= 768)

onMounted(() => {
  const handleResize = () => {
    isDesktop.value = window.innerWidth >= 768
  }
  window.addEventListener('resize', handleResize)
  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
  })
})

const pageTitle = computed(() => (route.meta.title as string) ?? 'ClassBoard')

const isWeek = computed(() => route.name === 'week')
const isDay = computed(() => route.name === 'day')

function switchView(name: 'week' | 'day'): void {
  router.push({ name })
}

const showImportDropdown = ref(false)
const showImportWizard = ref(false)
const showCourseEditor = ref(false)
const showUserMenu = ref(false)

/** 退出登录 */
function onLogout(): void {
  showUserMenu.value = false
  void store.logout().then(() => router.push({ name: 'login' }))
}

/** 点击外部关闭导入下拉（与提醒菜单一致：文档级 mousedown 监听，无遮罩，见 UI 4.9 约定） */
function onDocMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('.import-wrap')) return
  showImportDropdown.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

function onImport(mode: 'pdf' | 'manual'): void {
  showImportDropdown.value = false
  if (mode === 'pdf') showImportWizard.value = true
  else showCourseEditor.value = true
}

/** 学期选项（自研 AppSelect，替代原生 select） */
const semesterOptions = computed(() =>
  store.semesters.map((s) => ({ value: s.id, label: s.name })),
)

function setSemester(v: string | number | null): void {
  if (v === null) return
  store.setSemester(Number(v))
}

/** 班级切换（负责人可同时管理多个班级；同级权限相同） */
const classOptions = computed(() =>
  store.classes.map((c) => ({ value: c.id, label: c.name })),
)

function setClass(v: string | number | null): void {
  if (v === null) return
  void store.selectClass(Number(v))
}

const isSettings = computed(() => route.name === 'settings')
</script>

<template>
  <header class="topbar">
    <!-- 品牌（桌面） -->
    <div class="brand" v-if="isDesktop">
      <svg class="logo" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <path d="M8 2v4M16 2v4M3 9.5h18" />
        <path d="M8.5 14h2M13.5 14h2M8.5 17.5h2M13.5 17.5h2" />
      </svg>
      <span>ClassBoard</span>
    </div>

    <!-- 页面标题（移动） -->
    <div class="page-title" v-else>{{ pageTitle }}</div>

    <!-- 桌面分段控件：周课表 / 今天（等宽按钮，激活块原地淡入淡出，无位移） -->
    <div class="seg" role="tablist" aria-label="视图切换" v-if="isDesktop">
      <button
        class="seg-btn"
        :class="{ active: isWeek }"
        type="button"
        role="tab"
        :aria-selected="isWeek"
        @click="switchView('week')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>
        <span>周课表</span>
      </button>
      <button
        class="seg-btn"
        :class="{ active: isDay }"
        type="button"
        role="tab"
        :aria-selected="isDay"
        @click="switchView('day')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
        <span>今天</span>
      </button>
    </div>

    <div class="top-actions">
      <!-- 班级切换（班级 → 多个学期 → 课表；多个班级时切换当前班级） -->
      <AppSelect
        v-if="store.classes.length"
        class="class-select"
        :model-value="store.currentClassId"
        :options="classOptions"
        aria-label="切换班级"
        @update:model-value="setClass"
      />

      <!-- 学期切换（自研 AppSelect，面板风格与 UI 一致；移动端限宽省略） -->
      <AppSelect
        class="semester-select"
        :model-value="store.currentSemesterId"
        :options="semesterOptions"
        aria-label="切换学期"
        @update:model-value="setSemester"
      />

      <!-- 导入课程下拉（移动端仅图标，文字隐藏） -->
      <div class="import-wrap">
        <button
          class="btn-import"
          type="button"
          aria-label="导入课程"
          aria-haspopup="menu"
          :aria-expanded="showImportDropdown"
          @click="showImportDropdown = !showImportDropdown"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
          <span class="btn-import__label">导入课程</span>
        </button>
        <div class="import-menu" v-if="showImportDropdown" role="menu">
          <button type="button" role="menuitem" @click="onImport('pdf')">从 PDF 导入</button>
          <button type="button" role="menuitem" @click="onImport('manual')">手动录入</button>
        </div>
      </div>

      <!-- 通知中心（负责人手写通知；角标 = 通知总数）与设置 -->
      <NoticeCenter />

      <!-- 用户菜单：用户名 + 登出 -->
      <div class="user-wrap">
        <button
          class="user-btn"
          type="button"
          aria-label="用户菜单"
          aria-haspopup="menu"
          :aria-expanded="showUserMenu"
          @click="showUserMenu = !showUserMenu"
        >
          <span class="user-avatar">{{ store.currentUser?.username?.slice(0, 1).toUpperCase() ?? '?' }}</span>
          <span v-if="isDesktop" class="user-name">{{ store.currentUser?.username }}</span>
        </button>
        <div class="user-menu" v-if="showUserMenu" role="menu" aria-label="用户">
          <div class="user-menu__head">
            <span class="user-menu__name">{{ store.currentUser?.username }}</span>
            <span class="user-menu__role">{{ store.currentUser?.role === 'admin' ? '管理员' : '班级负责人' }}</span>
          </div>
          <button type="button" role="menuitem" @click="$router.push('/settings?tab=account')">账号设置</button>
          <button type="button" role="menuitem" @click="onLogout">退出登录</button>
        </div>
        <div class="menu-backdrop" v-if="showUserMenu" @click="showUserMenu = false"></div>
      </div>
      <button
        class="btn-icon"
        :class="{ active: isSettings }"
        type="button"
        aria-label="设置"
        @click="$router.push('/settings')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </button>
    </div>
  </header>

  <!-- PDF 导入三步向导 -->
  <ImportWizard :open="showImportWizard" @close="showImportWizard = false" @done="showImportWizard = false" />

  <!-- 手动录入课程 -->
  <CourseEditor :open="showCourseEditor" @close="showCourseEditor = false" @done="showCourseEditor = false" />
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-index-sticky);
  height: var(--topbar-h-mobile);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: 0 var(--spacing-lg);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border-default);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-heavy);
  white-space: nowrap;
}

.logo {
  color: var(--color-brand);
}

.page-title {
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  white-space: nowrap;
  /* 窄屏标题过长时截断，避免把右侧操作区推出屏幕 */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.seg {
  width: fit-content;
  display: flex;
  gap: 2px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  padding: 3px;
  margin-inline: auto;
}

/* 按钮等宽：激活字重变化不影响按钮宽度，托盘总宽恒定，切换时不会左右移动 */
.seg-btn {
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

.seg-btn svg {
  width: 16px;
  height: 16px;
}

.seg-btn.active {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.top-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-left: auto;
  /* 不可被压缩：右侧图标优先留在屏幕内（内部元素按断点收缩） */
  flex: none;
}

.import-wrap {
  position: relative;
}

.btn-import {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  height: 34px;
  padding: 0 var(--spacing-lg);
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-btn);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-import:hover {
  background: var(--color-brand-hover);
}

.btn-import svg {
  width: 15px;
  height: 15px;
}

/* 移动端：导入按钮仅图标（文字隐藏），学期选择限宽省略；事项入口隐藏（底部 Tab 已有） */
.btn-import__label {
  display: inline;
}

/* 中等宽度（<1024px）：品牌与导入收为图标、学期选择可收缩，
   否则 768–1023px（平板竖屏）下品牌 + 分段控件 + 操作区总宽超出视口、设置图标被挤出屏幕 */
@media (max-width: 1023px) {
  .brand span {
    display: none;
  }

  .btn-import {
    width: 34px;
    padding: 0;
    justify-content: center;
  }

  .btn-import__label {
    display: none;
  }

  .seg-btn {
    min-width: 88px;
    padding: 6px 8px;
  }

  .semester-select {
    flex: 0 1 140px;
    min-width: 72px;
    max-width: 140px;
  }

  .class-select {
    flex: 0 1 130px;
    min-width: 72px;
    max-width: 130px;
  }
}

@media (max-width: 767px) {
  .semester-select {
    /* 可收缩的弹性宽度：窄屏时学期名先省略，标题与右侧图标保持完整 */
    flex: 0 1 110px;
    min-width: 56px;
    max-width: 110px;
  }

  /* 移动端顶栏放不下班级选择器：改在「设置 → 班级」里切换（那里有完整班级列表） */
  .class-select {
    display: none;
  }
}

/* 更窄机型（≤360pt，如 iPhone SE 1 代）：学期选择与内边距进一步收窄，保证顶栏不溢出 */
@media (max-width: 360px) {
  .topbar {
    padding: 0 var(--spacing-sm);
  }

  .semester-select {
    flex-basis: 72px;
    min-width: 44px;
    max-width: 72px;
  }
}

/* 移动端顶栏：标题与操作区共用一行，压缩间距给操作区留足空间 */
@media (max-width: 767px) {
  .topbar {
    gap: var(--spacing-sm);
    padding: 0 var(--spacing-md);
  }

  .top-actions {
    gap: var(--spacing-2xs);
  }

  /* 标题保持完整（页面标识比学期名更重要）：不可压缩，超出部分由学期选择器先让位 */
  .page-title {
    flex: none;
  }
}

.import-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 140px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xs);
  z-index: var(--z-index-modal);
}

.import-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
  color: var(--color-text-body);
}

.import-menu button:hover {
  background: var(--color-bg-hover);
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.btn-icon:hover {
  background: var(--color-bg-hover);
}

/* 页面级激活反馈：当前所在页（设置）或提醒下拉展开时高亮 */
.btn-icon.active {
  background: var(--color-brand-subtle);
  color: var(--color-brand);
}

.btn-icon svg {
  width: 18px;
  height: 18px;
}

/* 点击外部关闭下拉 */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-index-modal) - 1);
}

/* ============ 用户菜单 ============ */
.user-wrap {
  position: relative;
}

.user-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.user-btn:hover {
  background: var(--color-bg-hover);
}

.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-brand);
  color: var(--color-text-inverse);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
}

.user-name {
  font-size: var(--font-size-md);
  color: var(--color-text-body);
  max-width: 80px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.user-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 200px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  padding: var(--spacing-xs);
  z-index: var(--z-index-modal);
}

.user-menu__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border-bottom: 1px solid var(--color-border-default);
  margin-bottom: var(--spacing-xs);
}

.user-menu__name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.user-menu__role {
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  border-radius: var(--radius-full);
  padding: 2px 7px;
}

.user-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
  color: var(--color-text-body);
}

.user-menu button:hover {
  background: var(--color-bg-hover);
}

@media (min-width: 768px) {
  .topbar {
    height: var(--topbar-h);
  }
}
</style>
