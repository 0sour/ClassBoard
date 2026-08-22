// ============================================================
// ClassBoard · 设置模块（setting 表 key-value，见技术文档 3.2.9）
// ============================================================
import { db, getSetting, setSetting, deleteSetting } from './db.js'

export const DEFAULT_SETTINGS = {
  showOddEvenFilter: true,
  reminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
  labReminder: { enabled: false, mode: 'every', advanceMinutes: 10 },
  homeworkReminder: { enabled: false, advanceDays: 2 },
  weather: { enabled: false, apiKey: '', location: '' },
}

function readJson(key, fallback) {
  const raw = getSetting(key)
  if (raw === undefined) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function readSettings() {
  return {
    showOddEvenFilter: readJson('show_odd_even_filter', DEFAULT_SETTINGS.showOddEvenFilter),
    reminder: { ...DEFAULT_SETTINGS.reminder, ...readJson('reminder', {}) },
    labReminder: { ...DEFAULT_SETTINGS.labReminder, ...readJson('lab_reminder', {}) },
    homeworkReminder: { ...DEFAULT_SETTINGS.homeworkReminder, ...readJson('homework_reminder', {}) },
    weather: { ...DEFAULT_SETTINGS.weather, ...readJson('weather', {}) },
  }
}

export function writeSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const storeKey = {
      showOddEvenFilter: 'show_odd_even_filter',
      reminder: 'reminder',
      labReminder: 'lab_reminder',
      homeworkReminder: 'homework_reminder',
      weather: 'weather',
    }[key]
    if (storeKey) setSetting(storeKey, JSON.stringify(value))
  }
  return readSettings()
}

/** 口令是否已开启 */
export function isAccessEnabled() {
  return getSetting('access_hash') !== undefined
}

/** 读取口令哈希（scrypt，格式：salt:hash 以 16 进制存储） */
export function getAccessHash() {
  return getSetting('access_hash')
}

export function setAccessHash(value) {
  setSetting('access_hash', value)
}

export function clearAccessHash() {
  deleteSetting('access_hash')
}

/** 幂等：仅首次启动时写入默认设置 */
export function ensureDefaultSettings() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM setting').get().n
  if (count === 0) {
    setSetting('show_odd_even_filter', JSON.stringify(DEFAULT_SETTINGS.showOddEvenFilter))
    setSetting('reminder', JSON.stringify(DEFAULT_SETTINGS.reminder))
    setSetting('lab_reminder', JSON.stringify(DEFAULT_SETTINGS.labReminder))
    setSetting('homework_reminder', JSON.stringify(DEFAULT_SETTINGS.homeworkReminder))
    setSetting('weather', JSON.stringify(DEFAULT_SETTINGS.weather))
  }
}
