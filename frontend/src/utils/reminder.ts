// ============================================================
// ClassBoard · 提醒引擎（技术设计文档 3.3.2）
// 页面打开时基于 /api/schedule 当日课程与提醒设置注册定时检查，
// 到点调用 Notification API（未授权则只入站内铃铛，铃铛数据由 store 提供）。
// 页面关闭后定时器随页面销毁，无服务端推送。
// ============================================================
import { useScheduleStore } from '@/stores/schedule'

/** 已触发过的提醒 key（课程 id + 日期 + 类型），避免重复通知 */
const fired = new Set<string>()

let timer: number | null = null

function notify(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.svg' })
    }
  } catch {
    // 通知失败时静默（站内铃铛仍可见）
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 计算课程开始时间（YYYY-MM-DDTHH:mm） */
function courseStart(courseDate: Date, startTime: string): Date {
  const d = new Date(courseDate)
  const [h, m] = startTime.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

/** 检查并触发一次提醒 */
function check(store: ReturnType<typeof useScheduleStore>): void {
  if (!store.remote || !store.settings) return

  const today = store.today
  const wd = ((today.getDay() + 6) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
  const dateKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

  // 课程提醒（普通课 / 实验课分流）
  const reminders = [
    { enabled: store.settings.reminder.enabled, config: store.settings.reminder, type: 'course' as const },
    { enabled: store.settings.labReminder.enabled, config: store.settings.labReminder, type: 'lab' as const },
  ]

  for (const c of store.coursesByWeekday[wd]) {
    const cfg = c.type === 'lab' ? reminders[1] : reminders[0]
    if (!cfg.enabled) continue
    const period = store.periods[c.startPeriod - 1]
    if (!period) continue
    const start = courseStart(today, period.startTime)
    const advance = (cfg.config.advanceMinutes ?? 10) * 60000
    const triggerAt = start.getTime() - advance
    const now = Date.now()
    if (now >= triggerAt && now < start.getTime()) {
      const key = `${dateKey}:${cfg.type}:${c.id}`
      if (!fired.has(key)) {
        fired.add(key)
        notify(`课程提醒：${c.name}`, `${period.startTime} 上课 · ${c.location || '未填地点'}`)
      }
    }
  }

  // 作业截止提醒：截止前 advanceDays 天内每天提示一次
  const hw = store.settings.homeworkReminder
  if (hw.enabled) {
    const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    for (const h of store.homework) {
      if (h.done) continue
      const due = new Date(h.dueAt.replace('T', ' ')).getTime()
      const daysLeft = Math.ceil((due - todayMs) / 86400000)
      if (daysLeft >= 0 && daysLeft <= hw.advanceDays) {
        const key = `${dateKey}:hw:${h.id}:${daysLeft}`
        if (!fired.has(key)) {
          fired.add(key)
          notify(`作业截止提醒：${h.name}`, `${daysLeft === 0 ? '今天' : `${daysLeft} 天后`}截止`)
        }
      }
    }
  }
}

/** 启动提醒引擎（App 挂载时调用一次；页面生命周期内每 30s 检查） */
export function startReminderEngine(): () => void {
  // C-6: 清理旧 timer 避免并发，清空 fired 允许重新触发
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  fired.clear()

  const store = useScheduleStore()
  check(store)
  timer = window.setInterval(() => check(store), 30000)
  return () => {
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}
