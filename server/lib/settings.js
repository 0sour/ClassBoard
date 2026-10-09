// ============================================================
// ClassBoard · 设置模块（user_setting 表 key-value，按用户隔离）
// ============================================================
import { db } from './db.js'

export const DEFAULT_SETTINGS = {
  showOddEvenFilter: true,
  reminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
  labReminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
  homeworkReminder: { enabled: false, advanceDays: 2 },
  weather: { enabled: false, apiKey: '', location: '' },
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

/** 天气设置全局共享：存 admin 名下，所有用户读取同一份（普通用户不配置 API Key） */
function getAdminId() {
  return db.prepare("SELECT id FROM user WHERE role = 'admin' ORDER BY id LIMIT 1").get()?.id ?? null
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
    reminder: { ...DEFAULT_SETTINGS.reminder, ...readJson(userId, 'reminder', {}) },
    labReminder: { ...DEFAULT_SETTINGS.labReminder, ...readJson(userId, 'lab_reminder', {}) },
    homeworkReminder: { ...DEFAULT_SETTINGS.homeworkReminder, ...readJson(userId, 'homework_reminder', {}) },
    weather: maskSecrets ? { ...weather, apiKey: maskApiKey(weather.apiKey) } : weather,
  }
}

export function writeSettings(userId, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const storeKey = {
      showOddEvenFilter: 'show_odd_even_filter',
      reminder: 'reminder',
      labReminder: 'lab_reminder',
      homeworkReminder: 'homework_reminder',
      weather: 'weather',
    }[key]
    if (storeKey) {
      // 天气设置全局共享：写入 admin 名下
      const targetUserId = storeKey === 'weather' ? getAdminId() ?? userId : userId
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
    ins.run(admin.id, 'reminder', JSON.stringify(DEFAULT_SETTINGS.reminder))
    ins.run(admin.id, 'lab_reminder', JSON.stringify(DEFAULT_SETTINGS.labReminder))
    ins.run(admin.id, 'homework_reminder', JSON.stringify(DEFAULT_SETTINGS.homeworkReminder))
    ins.run(admin.id, 'weather', JSON.stringify(DEFAULT_SETTINGS.weather))
  }
}
