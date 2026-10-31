// ============================================================
// ClassBoard · 设置模块（user_setting 表 key-value，按用户隔离）
//   P2 起不再有个人提醒（浏览器课堂/实验/作业提醒已下线）
// ============================================================
import { db } from './db.js'

export const DEFAULT_SETTINGS = {
  showOddEvenFilter: true,
  weather: { enabled: false, apiKey: '', location: '' },
}

/** 站点页脚（开源默认全空；各部署在自己的后台填自己的备案号 / 文案） */
export const DEFAULT_SITE = {
  footerText: '',
  icp: '',
  policeIcp: '',
  showVisits: false,
}

function readJson(userId, key, fallback) {
  const row = db
    .prepare('SELECT value FROM user_setting WHERE user_id = ? AND key = ?')
    .get(userId, key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value)
  } catch {
    return fallback
  }
}

/** 全局设置（天气 / 站点页脚）存 admin 名下，所有用户读取同一份 */
function getAdminId() {
  return db.prepare("SELECT id FROM user WHERE role = 'admin' ORDER BY id LIMIT 1").get()?.id ?? null
}

/** 站点页脚设置（公开信息：无密钥，可安全下发给未登录访客） */
export function readSiteSettings() {
  const adminId = getAdminId()
  const raw = adminId ? readJson(adminId, 'site', {}) : {}
  return { ...DEFAULT_SITE, ...raw }
}

/** API Key 脱敏（保留末 4 位便于识别，非 admin 只读到此值） */
export function maskApiKey(key) {
  const s = String(key ?? '')
  if (!s) return ''
  if (s.length <= 4) return '****'
  return `${'*'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`
}

/** 值是否为脱敏后的 Key（以 * 开头） */
export function isMaskedApiKey(key) {
  return /^\*+/.test(String(key ?? ''))
}

/**
 * 读取设置。
 * @param options.maskSecrets 为 true 时脱敏天气 API Key（供非 admin 的接口响应使用）
 */
export function readSettings(userId, { maskSecrets = false } = {}) {
  // 天气设置全局共享：读取 admin 名下的配置（所有用户共享同一份）
  const weatherUserId = getAdminId() ?? userId
  const weather = { ...DEFAULT_SETTINGS.weather, ...readJson(weatherUserId, 'weather', {}) }
  return {
    showOddEvenFilter: readJson(userId, 'show_odd_even_filter', DEFAULT_SETTINGS.showOddEvenFilter),
    weather: maskSecrets ? { ...weather, apiKey: maskApiKey(weather.apiKey) } : weather,
    site: readSiteSettings(),
  }
}

export function writeSettings(userId, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const storeKey = {
      showOddEvenFilter: 'show_odd_even_filter',
      weather: 'weather',
      site: 'site',
    }[key]
    if (storeKey) {
      // 天气 / 站点页脚为全站共享：写入 admin 名下
      const targetUserId = storeKey === 'weather' || storeKey === 'site' ? getAdminId() ?? userId : userId
      let stored = value
      if (storeKey === 'weather') {
        // 客户端回传的可能是脱敏值（非 admin 只拿得到脱敏 Key）：保留库中已有的真实 Key
        const current = readJson(targetUserId, 'weather', {})
        const incomingKey = value?.apiKey
        stored = {
          ...value,
          apiKey: isMaskedApiKey(incomingKey) ? (current.apiKey ?? '') : (incomingKey ?? ''),
        }
      }
      db.prepare(
        'INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
      ).run(targetUserId, storeKey, JSON.stringify(stored))
    }
  }
  return readSettings(userId)
}

/** 幂等：首次启动（无任何用户设置）时写入默认设置 */
export function ensureDefaultSettings() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM user_setting').get().n
  if (count === 0) {
    const admin = db.prepare("SELECT id FROM user WHERE role = 'admin' ORDER BY id LIMIT 1").get()
    if (!admin) return
    const ins = db.prepare(
      'INSERT OR IGNORE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)',
    )
    ins.run(admin.id, 'show_odd_even_filter', JSON.stringify(DEFAULT_SETTINGS.showOddEvenFilter))
    ins.run(admin.id, 'weather', JSON.stringify(DEFAULT_SETTINGS.weather))
    ins.run(admin.id, 'site', JSON.stringify(DEFAULT_SITE))
  }
}
