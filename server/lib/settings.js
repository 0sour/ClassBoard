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

export function readSettings(userId) {
  return {
    showOddEvenFilter: readJson(userId, 'show_odd_even_filter', DEFAULT_SETTINGS.showOddEvenFilter),
    reminder: { ...DEFAULT_SETTINGS.reminder, ...readJson(userId, 'reminder', {}) },
    labReminder: { ...DEFAULT_SETTINGS.labReminder, ...readJson(userId, 'lab_reminder', {}) },
    homeworkReminder: { ...DEFAULT_SETTINGS.homeworkReminder, ...readJson(userId, 'homework_reminder', {}) },
    weather: { ...DEFAULT_SETTINGS.weather, ...readJson(userId, 'weather', {}) },
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
      db.prepare(
        'INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
      ).run(userId, storeKey, JSON.stringify(value))
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
