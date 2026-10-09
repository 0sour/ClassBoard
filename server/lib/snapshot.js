// ============================================================
// ClassBoard · 数据快照（破坏性操作前的自动安全网）
// 直接复制 .db 文件会丢 WAL 中未落盘的数据，必须用 SQLite 一致性备份。
// ============================================================
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/** 快照保留份数（超出后删除最旧的） */
export const SNAPSHOT_KEEP = 10

export function snapshotsDir(dataDir) {
  return join(dataDir, 'snapshots')
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${ms}`
}

/** 快照文件名（reason 只保留字母数字与连字符；毫秒 + 随机后缀避免同秒撞名） */
export function snapshotName(reason) {
  const safe = String(reason ?? 'manual').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24) || 'manual'
  const rand = randomBytes(2).toString('hex')
  return `classboard-${stamp()}-${rand}-${safe}.db`
}

/** 仅保留最近 keep 份，删除其余 */
export function pruneSnapshots(dataDir, keep = SNAPSHOT_KEEP) {
  const dir = snapshotsDir(dataDir)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => /^classboard-.*\.db$/.test(f))
    .map((f) => {
      const full = join(dir, f)
      return { full, mtime: statSync(full).mtimeMs, name: f }
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1))
  const removed = []
  for (const f of files.slice(keep)) {
    try {
      rmSync(f.full, { force: true })
      removed.push(f.full)
    } catch {
      // 删除失败不影响主流程
    }
  }
  return removed
}

/**
 * 创建一致性快照（异步，使用 better-sqlite3 backup API）。
 * @returns 快照文件绝对路径
 */
export async function createSnapshot(db, dataDir, reason, { keep = SNAPSHOT_KEEP } = {}) {
  const dir = snapshotsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, snapshotName(reason))
  await db.backup(dest)
  pruneSnapshots(dataDir, keep)
  return dest
}

/**
 * 同步快照（迁移等模块初始化阶段使用：先 WAL 落盘再整文件复制）。
 * 单进程单连接下 checkpoint(TRUNCATE) 是安全的。
 */
export function createSnapshotSync(db, dataDir, reason, { keep = SNAPSHOT_KEEP } = {}) {
  const dir = snapshotsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, snapshotName(reason))
  db.pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(join(dataDir, 'classboard.db'), dest)
  pruneSnapshots(dataDir, keep)
  return dest
}
