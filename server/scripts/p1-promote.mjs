// ============================================================
// ClassBoard · P1 一次性收尾（个人课表 → 班级平台）
//   1) 把保留账号（默认 sour）的班级改名为「无锡学院 · 24集成2」
//   2) 删除其余全部账号及其班级数据（迁移时为每个旧账号各建了一个同名班级）
// 幂等：可重复执行；默认只打印计划，追加 --yes 才真正写入。
// 执行前自动落一份「pre-p1-promote-*.db」永久快照（不受应用内 10 份滚动清理影响）。
//
// 用法（NAS 容器内）：
//   docker compose exec classboard node scripts/p1-promote.mjs           # 预览
//   docker compose exec classboard node scripts/p1-promote.mjs --yes     # 执行
// 可用环境变量覆盖：P1_KEEP_USER / P1_SCHOOL / P1_CLASS_NAME / P1_CITY
// ============================================================
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { db, DATA_DIR } from '../lib/db.js'
import { classStateSnapshot, entitySnapshot, recordChange } from '../lib/changes.js'
import { toUser } from '../lib/access.js'

const KEEP_USER = process.env.P1_KEEP_USER ?? 'sour'
const SCHOOL = process.env.P1_SCHOOL ?? '无锡学院'
const CLASS_NAME = process.env.P1_CLASS_NAME ?? '24集成2'
const CITY = process.env.P1_CITY ?? '无锡'
const APPLY = process.argv.includes('--yes')

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function classStats(classId) {
  const semesterIds = db.prepare('SELECT id FROM semester WHERE class_id = ?').all(classId).map((r) => r.id)
  if (!semesterIds.length) return { semesters: 0, courses: 0, slots: 0 }
  const ph = semesterIds.map(() => '?').join(',')
  const courses = db.prepare(`SELECT id FROM course WHERE semester_id IN (${ph})`).all(...semesterIds).map((r) => r.id)
  const slots = courses.length
    ? db
        .prepare(
          `SELECT COUNT(*) AS n FROM course_slot WHERE session_id IN
            (SELECT id FROM course_session WHERE course_id IN (${courses.map(() => '?').join(',')}))`,
        )
        .get(...courses).n
    : 0
  return { semesters: semesterIds.length, courses: courses.length, slots }
}

/**
 * 被删账号名下需要「继承」给保留账号的全局设置：
 *   天气（API Key 存在第一个管理员名下，删号会一并丢失）
 *   开放注册（注册入口显隐开关，同样是管理员名下）
 * 旧单用户时代的全局 setting 表作为兜底来源。
 */
const INHERIT_KEYS = ['weather', 'allow_signup']

function inheritedSettings() {
  const has = db.prepare('SELECT 1 FROM user_setting WHERE user_id = ? AND key = ?')
  const out = []
  for (const key of INHERIT_KEYS) {
    if (has.get(keep.id, key)) continue
    const row =
      db
        .prepare('SELECT value FROM user_setting WHERE key = ? AND user_id <> ? ORDER BY user_id LIMIT 1')
        .get(key, keep.id) ?? readLegacySetting(key)
    if (row) out.push({ key, value: row.value })
  }
  return out
}

function readLegacySetting(key) {
  try {
    return db.prepare('SELECT value FROM setting WHERE key = ?').get(key) ?? null
  } catch {
    return null // 旧表不存在（全新库）
  }
}

// ---- 计划 ----
const keep = db.prepare('SELECT * FROM user WHERE username = ?').get(KEEP_USER)
if (!keep) {
  console.error(`[中止] 找不到保留账号「${KEEP_USER}」；如需换名请设置环境变量 P1_KEEP_USER`)
  process.exit(1)
}
const keepClass = db
  .prepare('SELECT c.* FROM class c JOIN class_member m ON m.class_id = c.id WHERE m.user_id = ? ORDER BY c.id LIMIT 1')
  .get(keep.id)

const others = db.prepare('SELECT * FROM user WHERE username <> ? ORDER BY id').all(KEEP_USER)

console.log(`[数据目录] ${DATA_DIR}`)
console.log(`[保留账号] ${keep.username}（id=${keep.id}, role=${keep.role}）`)
if (keepClass) {
  console.log(
    `[班级改名] 「${keepClass.school || '（未填学校）'} · ${keepClass.name}」 → 「${SCHOOL} · ${CLASS_NAME}」（城市：${keepClass.city || CITY}）`,
  )
  const s = classStats(keepClass.id)
  console.log(`           保留数据：${s.semesters} 个学期 / ${s.courses} 门课程 / ${s.slots} 个课表格子`)
} else {
  console.log('[班级改名] 该账号名下没有班级，跳过（可在「设置 → 班级」新建）')
}

if (!others.length) {
  console.log('[删除账号] 没有需要删除的账号（已执行过）')
} else {
  console.log(`[删除账号] 将删除 ${others.length} 个账号及其班级数据：`)
  for (const u of others) {
    const classIds = db.prepare('SELECT class_id FROM class_member WHERE user_id = ?').all(u.id).map((r) => r.class_id)
    for (const cid of classIds) {
      const cls = db.prepare('SELECT * FROM class WHERE id = ?').get(cid)
      const members = db.prepare('SELECT COUNT(*) AS n FROM class_member WHERE class_id = ?').get(cid).n
      const s = classStats(cid)
      console.log(
        `  - ${u.username}（id=${u.id}, role=${u.role}）→ 班级「${cls?.name ?? '?'}」` +
          `${members <= 1 ? '，无其他负责人，班级与数据一并删除' : `，仍有 ${members - 1} 位负责人，班级保留`}` +
          `（${s.semesters} 学期 / ${s.courses} 门课程 / ${s.slots} 格子）`,
      )
    }
  }
}

const inherits = inheritedSettings()
if (inherits.length) {
  console.log(`[设置继承] 将把 ${inherits.map((x) => x.key).join(' / ')} 从旧管理员名下复制给「${keep.username}」（否则删号会丢天气 Key 与注册开关）`)
}

if (!APPLY) {
  console.log('\n[预览] 尚未做任何修改。确认无误请追加 --yes 重新执行。')
  process.exit(0)
}

// ---- 执行 ----
const snapDir = join(DATA_DIR, 'snapshots')
mkdirSync(snapDir, { recursive: true })
db.pragma('wal_checkpoint(TRUNCATE)')
const snapPath = join(snapDir, `pre-p1-promote-${stamp()}.db`)
copyFileSync(join(DATA_DIR, 'classboard.db'), snapPath)
console.log(`\n[快照] 已保存 ${snapPath}`)

const summary = db.transaction(() => {
  let renamed = false
  if (keepClass) {    const before = entitySnapshot('class', keepClass.id)
    db.prepare('UPDATE class SET school = ?, name = ?, city = ?, updated_at = ? WHERE id = ?').run(
      SCHOOL,
      CLASS_NAME,
      keepClass.city || CITY,
      new Date().toISOString(),
      keepClass.id,
    )
    recordChange({
      classId: keepClass.id,
      actorId: keep.id,
      action: 'update',
      entity: 'class',
      entityId: keepClass.id,
      before,
      after: entitySnapshot('class', keepClass.id),
    })
    renamed = true
  }

  // 继承旧管理员的全局设置（天气 Key / 注册开关），必须在删除账号之前
  const insSetting = db.prepare('INSERT OR IGNORE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)')
  for (const item of inherits) insSetting.run(keep.id, item.key, item.value)

  let deletedUsers = 0
  let deletedClasses = 0
  for (const u of others) {
    const before = toUser(u)
    const classIds = db.prepare('SELECT class_id FROM class_member WHERE user_id = ?').all(u.id).map((r) => r.class_id)
    const states = new Map(classIds.map((cid) => [cid, classStateSnapshot(cid)]))
    db.prepare('DELETE FROM user WHERE id = ?').run(u.id) // class_member / session / user_setting 级联删除
    deletedUsers += 1
    for (const cid of classIds) {
      const left = db.prepare('SELECT COUNT(*) AS n FROM class_member WHERE class_id = ?').get(cid).n
      if (left === 0) {
        db.prepare('DELETE FROM class WHERE id = ?').run(cid)
        deletedClasses += 1
        recordChange({
          classId: null,
          actorId: keep.id,
          action: 'delete_orphan_class',
          entity: 'class_state',
          entityId: cid,
          before: states.get(cid) ?? null,
        })
      }
    }
    recordChange({
      classId: null,
      actorId: keep.id,
      action: 'delete',
      entity: 'user',
      entityId: u.id,
      before,
    })
  }
  return { renamed, deletedUsers, deletedClasses }
})()

console.log(
  `[完成] ${summary.renamed ? `班级已更名为「${SCHOOL} · ${CLASS_NAME}」` : '未改名'}；` +
    `继承设置 ${inherits.length} 项；删除账号 ${summary.deletedUsers} 个、班级 ${summary.deletedClasses} 个。`,
)
console.log('[提示] 变更已写入 change_log，可在变更记录中查看；如需回退，用上方快照文件替换 classboard.db 后重启容器。')
