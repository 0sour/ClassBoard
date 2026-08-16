// ============================================================
// ClassBoard · 路由
// 视图：/week 周课表（桌面默认）、/day 今天（移动默认）、
//       /matters 事项（考试/实验/作业）、/settings 设置
// ============================================================
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/week' },
    {
      path: '/week',
      name: 'week',
      component: () => import('@/views/WeekView.vue'),
      meta: { title: '周课表', tab: 'week' },
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
  ],
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · ClassBoard` : 'ClassBoard · 课程表'
})

export default router
