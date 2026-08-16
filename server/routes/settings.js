// ============================================================
// ClassBoard · 设置路由（技术文档 4.3.7 #33-#34）
// ============================================================
import { Router } from 'express'
import { wrap } from '../lib/errors.js'
import { isAccessEnabled, readSettings, writeSettings } from '../lib/settings.js'
import { validateSettingsPatch } from '../lib/validate.js'

export const settingsRouter = Router()

settingsRouter.get(
  '/',
  wrap(async (req, res) => {
    res.json({ ...readSettings(), accessEnabled: isAccessEnabled() })
  }),
)

settingsRouter.put(
  '/',
  wrap(async (req, res) => {
    const patch = validateSettingsPatch(req.body ?? {})
    const settings = writeSettings(patch)
    res.json(settings)
  }),
)
