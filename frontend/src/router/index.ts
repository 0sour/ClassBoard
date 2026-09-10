// ============================================================
// ClassBoard · 路由
// 视图：/week 周课表（桌面默认）、/day 今天（移动默认）、
//       /matters 事项（考试/实验/作业）、/settings 设置
// ============================================================
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 默认页：手机（<768px）进「今天」，桌面进「周课表」
    {
      path: '/',
      redirect: () => (window.innerWidth < 768 ? '/day' : '/week'),
    },
    {
      path: '/week',
      name: 'week',
      component: () => import('@/views/WeekView.vue'),
      meta: { title: '周课表', tab: 'week' },
    },
    {
      path: '/templates',
      name: 'templates',
      component: () => import('@/views/TemplatesView.vue'),
      meta: { title: '模板市场', tab: 'templates' },
    },
    {
      path: '/day',
      name: 'day',
      component: () => import('@/views/DayView.vue'),
      meta: { title: '今天', tab: 'day' },
    },
    {
      path: '/matters',
      name: 'matters',
      component: () => import('@/views/MattersView.vue'),
      meta: { title: '事项', tab: 'matters' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: '设置', tab: 'settings' },
    },
    // 兜底：未知路径重定向到默认页（手机「今天」/ 桌面「周课表」）
    { path: '/:pathMatch(.*)*', redirect: () => (window.innerWidth < 768 ? '/day' : '/week') },
  ],
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · ClassBoard` : 'ClassBoard · 课程表'
})

export default router
