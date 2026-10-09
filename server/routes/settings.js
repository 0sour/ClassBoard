// ============================================================
// ClassBoard · 设置路由（技术文档 4.3.7 #33-#34，多用户按 user_id 隔离）
// 天气设置为全站共享（存 admin 名下）：读取对非 admin 脱敏 API Key；
// 写入需 admin 权限。
// ============================================================
import { Router } from 'express'
import { AppError, wrap } from '../lib/errors.js'
import { readSettings, writeSettings } from '../lib/settings.js'
import { validateSettingsPatch } from '../lib/validate.js'

export const settingsRouter = Router()

const isAdmin = (req) => req.user?.role === 'admin'

settingsRouter.get(
  '/',
  wrap(async (req, res) => {
    // 非 admin 不下发明文天气 API Key（共享配置中的敏感字段）
    res.json(readSettings(req.user.id, { maskSecrets: !isAdmin(req) }))
  }),
)

settingsRouter.put(
  '/',
  wrap(async (req, res) => {
    const patch = validateSettingsPatch(req.body ?? {})
    // 天气为全站共享配置：仅 admin 可修改
    if ('weather' in patch && !isAdmin(req)) {
      throw new AppError(403, 'FORBIDDEN', '天气设置为全站共享，仅管理员可修改')
    }
    const settings = writeSettings(req.user.id, patch)
    res.json(isAdmin(req) ? settings : readSettings(req.user.id, { maskSecrets: true }))
  }),
)
