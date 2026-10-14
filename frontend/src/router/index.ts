// ============================================================
// ClassBoard · 路由
//   公开面（无需登录，只读）：/ 班级选择面板、/class/:id 班级课表
//   后台（需登录且已通过审核）：/week /day /settings
//   /login 后台登录面板（内含不显眼的注册入口与待审核提示）
// ============================================================
import { createRouter, createWebHistory } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'classes',
      component: () => import('@/views/PublicClassesView.vue'),
      meta: { title: '班级课表', public: true },
    },
    {
      path: '/class/:id',
      name: 'public-class',
      component: () => import('@/views/PublicClassView.vue'),
      meta: { title: '班级课表', public: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: '后台登录', bare: true },
    },
    {
      path: '/week',
      name: 'week',
      component: () => import('@/views/WeekView.vue'),
      meta: { title: '周课表', tab: 'week', requiresAuth: true },
    },
    {
      path: '/day',
      name: 'day',
      component: () => import('@/views/DayView.vue'),
      meta: { title: '今天', tab: 'day', requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: '设置', tab: 'settings', requiresAuth: true },
    },
    // 兜底：未知路径回班级选择面板
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/** 后台路由守卫：未登录 → 后台登录页；待审核 / 已拒绝 → 登录页看状态 */
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true
  const store = useScheduleStore()
  await store.ensureReady()
  // 从公开班级页切回后台：退出只读模式并按登录态重新加载
  if (store.readonly) {
    store.clearPublicMode()
    await store.bootstrap()
  }
  if (!store.authenticated) {
    return { name: 'login', query: { next: to.fullPath } }
  }
  const user = store.currentUser
  if (user && user.role !== 'admin' && user.status && user.status !== 'active') {
    return { name: 'login' }
  }
  return true
})

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '班级课表'
  document.title = `${title} · ClassBoard`
})

export default router
