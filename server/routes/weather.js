// ============================================================
// ClassBoard · 天气路由（管理员配置城市；班级城市走 /api/public/classes/:id/weather）
// ============================================================
import { Router } from 'express'
import { readSettings } from '../lib/settings.js'
import { readWeatherForCity, searchCities } from '../lib/weather.js'
import { badRequest, wrap } from '../lib/errors.js'

export const weatherRouter = Router()

weatherRouter.get(
  '/',
  wrap(async (req, res) => {
    const { weather } = readSettings()
    if (!weather.enabled || !weather.apiKey || !weather.location) {
      throw badRequest('天气功能未启用，请在设置页配置')
    }
    const data = await readWeatherForCity(weather.location)
    if (!data) throw badRequest('实时天气获取失败，请检查 API Key 与网络')
    res.json(data)
  }),
)

/** 城市搜索（设置页与班级资料的下拉用） */
weatherRouter.get(
  '/cities',
  wrap(async (req, res) => {
    const { weather } = readSettings()
    if (!weather.enabled || !weather.apiKey) throw badRequest('天气功能未启用，请在设置页配置')
    const list = await searchCities(req.query.q)
    res.json(list ?? [])
  }),
)
