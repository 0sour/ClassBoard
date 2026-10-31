// ============================================================
// ClassBoard · 全局 UI 反馈（Toast / Confirm）
// 规范：《04-UI设计文档》4.2 Toast 轻提示 / 4.3 确认对话框
// ============================================================
import { reactive } from 'vue'

export type ToastType = 'success' | 'warning' | 'error' | 'info'

export interface ToastItem {
  id: number
  type: ToastType
  msg: string
}

/** Toast 队列（由 ToastHost 组件渲染，页面顶部居中，3s 自动消失） */
export const toastState = reactive<{ list: ToastItem[] }>({ list: [] })

let toastId = 0

export function toast(msg: string, type: ToastType = 'success'): void {
  const id = ++toastId
  toastState.list.push({ id, type, msg })
  window.setTimeout(() => {
    const i = toastState.list.findIndex((t) => t.id === id)
    if (i >= 0) toastState.list.splice(i, 1)
  }, 3000)
}

export interface ConfirmOptions {
  title: string
  desc?: string
  /** 危险操作：确认按钮使用 error 色（删除/覆盖类） */
  danger?: boolean
  confirmText?: string
}

/** Confirm 对话框状态（由 ConfirmHost 组件渲染，Promise 式 API） */
export const confirmState = reactive<{
  open: boolean
  options: ConfirmOptions
  resolve: ((v: boolean) => void) | null
}>({
  open: false,
  options: { title: '' },
  resolve: null,
})

/** 弹出确认对话框，返回用户选择（true=确认） */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  confirmState.options = options
  confirmState.open = true
  return new Promise((resolve) => {
    confirmState.resolve = resolve
  })
}

/** 由 ConfirmHost 调用 */
export function settleConfirm(v: boolean): void {
  confirmState.resolve?.(v)
  confirmState.resolve = null
  confirmState.open = false
}
