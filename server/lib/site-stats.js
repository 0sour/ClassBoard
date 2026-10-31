// ============================================================
// ClassBoard · 站点访问统计（可选功能）
//   独立 data/stats.db，只存「每天访问次数」一行，不碰 classboard.db。
//   不记录 IP / UA / 访客标识；关闭时前端不请求，这里也不会建库。
// ============================================================
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DATA_DIR } from './db.js'

const STATS_FILE = resolve(DATA_DIR, 'stats.db')

/** 服务器时区固定按中国日期切分（容器默认 UTC 会在 0–8 点算错天） */
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

function withDb(fn) {
  let db = null
  try {
    db = new Database(STATS_FILE)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 2000')
    db.exec(`
      CREATE TABLE IF NOT EXISTS visit_day (
        day    TEXT PRIMARY KEY,
        visits INTEGER NOT NULL DEFAULT 0
      )
    `)
    return fn(db)
  } finally {
    db?.close()
  }
}

/** 记录一次访问（同一浏览器同一天由前端去重）并返回 { today, total } */
export function recordVisit() {
  const day = todayStr()
  return withDb((db) => {
    db.prepare(
      `INSERT INTO visit_day (day, visits) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET visits = visits + 1`,
    ).run(day)
    return readCounts(db, day)
  })
}

/** 只读统计；统计库不存在时返回 0，不创建文件 */
export function readStats() {
  if (!existsSync(STATS_FILE)) return { today: 0, total: 0 }
  const day = todayStr()
  try {
    return withDb((db) => readCounts(db, day))
  } catch {
    return { today: 0, total: 0 }
  }
}

function readCounts(db, day) {
  const today = db.prepare('SELECT visits FROM visit_day WHERE day = ?').get(day)?.visits ?? 0
  const total = db.prepare('SELECT COALESCE(SUM(visits), 0) AS n FROM visit_day').get().n
  return { today, total }
}
