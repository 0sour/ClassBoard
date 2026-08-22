// ============================================================
// ClassBoard · 天气代理路由
// 服务端转发和风天气（QWeather）请求，隐藏 API key，30 分钟缓存
// 免费版接口：实时 / 3 天预报 / 实时空气 / 天气预警（按城市 ID）
// ============================================================
import { Router } from 'express'
import { readSettings } from '../lib/settings.js'
import { badRequest, wrap } from '../lib/errors.js'

export const weatherRouter = Router()

const QWEATHER_BASE = 'https://devapi.qweather.com/v7'
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 分钟
const cache = new Map() // location -> { ts, data }

/** 按城市名解析城市 ID（和风城市搜索接口，带 24h 缓存） */
async function resolveLocationId(cityName, apiKey) {
  const key = `loc:${cityName}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < 24 * 3600 * 1000) return hit.data
  const url = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(cityName)}&key=${apiKey}`
  const res = await fetch(url)
  const body = await res.json()
  if (body.code !== '200' || !body.location?.length) return null
  const id = body.location[0].id
  cache.set(key, { ts: Date.now(), data: id })
  return id
}

/** 拉取 QWeather 接口（带缓存） */
async function fetchQWeather(path, apiKey, cacheKey, ttl = CACHE_TTL_MS) {
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < ttl) return hit.data
  const url = `${QWEATHER_BASE}${path}&key=${apiKey}`
  const res = await fetch(url)
  const body = await res.json()
  if (body.code !== '200') return null
  cache.set(cacheKey, { ts: Date.now(), data: body })
  return body
}

weatherRouter.get(
  '/',
  wrap(async (req, res) => {
    const { weather } = readSettings()
    if (!weather.enabled || !weather.apiKey || !weather.location) {
      throw badRequest('天气功能未启用，请在设置页配置')
    }
    const cityId = await resolveLocationId(weather.location, weather.apiKey)
    if (!cityId) throw badRequest('城市解析失败，请检查设置中的城市名称')

    const [now, daily, air, warning] = await Promise.all([
      fetchQWeather(`/weather/now?location=${cityId}`, weather.apiKey, `now:${cityId}`),
      fetchQWeather(`/weather/3d?location=${cityId}`, weather.apiKey, `daily:${cityId}`),
      fetchQWeather(`/air/now?location=${cityId}`, weather.apiKey, `air:${cityId}`),
      fetchQWeather(`/warning/now?location=${cityId}`, weather.apiKey, `warn:${cityId}`, 10 * 60 * 1000),
    ])

    if (!now) throw badRequest('实时天气获取失败，请检查 API Key 与网络')
    res.json({
      city: weather.location,
      now: now.now,
      daily: daily?.daily ?? [],
      air: air?.now ?? null,
      warning: warning?.warning ?? [],
      updatedAt: new Date().toISOString(),
    })
  }),
)
