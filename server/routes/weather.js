// ============================================================
// ClassBoard · 天气代理路由
// 服务端转发和风天气（QWeather）请求，隐藏 API key，30 分钟缓存
// 免费版接口：实时 / 3 天预报 / 实时空气 / 天气预警（按城市 ID）
// 日出日落：Open-Meteo（免费无需 key），按城市经纬度查询
// ============================================================
import { Router } from 'express'
import { readSettings } from '../lib/settings.js'
import { badRequest, wrap } from '../lib/errors.js'

export const weatherRouter = Router()

const QWEATHER_BASE = 'https://devapi.qweather.com/v7'
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 分钟
const cache = new Map() // key -> { ts, data }

/** 按城市名解析城市信息（和风城市搜索接口，带 24h 缓存） */
async function resolveLocationInfo(cityName, apiKey) {
  const key = `loc:${cityName}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < 24 * 3600 * 1000) return hit.data
  const url = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(cityName)}&key=${apiKey}`
  const res = await fetch(url)
  const body = await res.json()
  if (body.code !== '200' || !body.location?.length) return null
  const loc = body.location[0]
  const info = { id: loc.id, lat: loc.lat, lon: loc.lon }
  cache.set(key, { ts: Date.now(), data: info })
  return info
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

/** 日出日落（Open-Meteo，免费无需 key；返回今天 HH:mm 或 null） */
async function fetchSunTimes(lat, lon) {
  if (!lat || !lon) return null
  const cacheKey = `sun:${lat},${lon}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto`
    const res = await fetch(url)
    const body = await res.json()
    const sunrise = body?.daily?.sunrise?.[0]
    const sunset = body?.daily?.sunset?.[0]
    if (!sunrise || !sunset) return null
    const data = {
      sunrise: sunrise.slice(11, 16),
      sunset: sunset.slice(11, 16),
    }
    cache.set(cacheKey, { ts: Date.now(), data })
    return data
  } catch {
    return null
  }
}

weatherRouter.get(
  '/',
  wrap(async (req, res) => {
    const { weather } = readSettings()
    if (!weather.enabled || !weather.apiKey || !weather.location) {
      throw badRequest('天气功能未启用，请在设置页配置')
    }
    const loc = await resolveLocationInfo(weather.location, weather.apiKey)
    if (!loc) throw badRequest('城市解析失败，请检查设置中的城市名称')

    const [now, daily, air, warning, sun] = await Promise.all([
      fetchQWeather(`/weather/now?location=${loc.id}`, weather.apiKey, `now:${loc.id}`),
      // 7 天预报（免费版支持）：前端取未来 3 天展示
      fetchQWeather(`/weather/7d?location=${loc.id}`, weather.apiKey, `daily7:${loc.id}`),
      fetchQWeather(`/air/now?location=${loc.id}`, weather.apiKey, `air:${loc.id}`),
      fetchQWeather(`/warning/now?location=${loc.id}`, weather.apiKey, `warn:${loc.id}`, 10 * 60 * 1000),
      fetchSunTimes(loc.lat, loc.lon),
    ])

    if (!now) throw badRequest('实时天气获取失败，请检查 API Key 与网络')
    res.json({
      city: weather.location,
      now: now.now,
      daily: daily?.daily ?? [],
      air: air?.now ?? null,
      warning: warning?.warning ?? [],
      sun,
      updatedAt: new Date().toISOString(),
    })
  }),
)

/** 城市搜索（设置页下拉用）：QWeather 城市搜索接口，24h 缓存 */
weatherRouter.get(
  '/cities',
  wrap(async (req, res) => {
    const { weather } = readSettings()
    const q = String(req.query.q ?? '').trim()
    if (!weather.enabled || !weather.apiKey) throw badRequest('天气功能未启用，请在设置页配置')
    if (!q || q.length < 1) return res.json([])
    const cacheKey = `cities:${q}`
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.ts < 24 * 3600 * 1000) return res.json(hit.data)
    const url = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(q)}&key=${weather.apiKey}&number=8`
    const body = await (await fetch(url)).json()
    if (body.code !== '200') return res.json([])
    const list = (body.location ?? []).map((l) => ({
      name: l.name,
      adm1: l.adm1,
      adm2: l.adm2,
      id: l.id,
    }))
    cache.set(cacheKey, { ts: Date.now(), data: list })
    res.json(list)
  }),
)
