// ============================================================
// ClassBoard · 作业 / 考试的图片与附件
//   元数据（attachment）与文件内容（blob，内容寻址）分表存放：
//   - blob 以 sha256 为主键、不随删除清理 → 撤销 / 整班回退 / 导出导入都能按哈希接回内容；
//   - attachment 行随所属考试 / 作业级联删除；各类快照只带元数据，变更记录因此保持很小。
// ============================================================
import { createHash } from 'node:crypto'
import { db } from './db.js'

/** 单文件上限 20 MB（与备份文件同一量级） */
export const ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024
/** 每条作业 / 考试最多挂 10 个附件（含图片） */
export const ATTACHMENTS_PER_MATTER = 10

/** 可内联展示的图片类型；其余一律按附件下载（SVG / HTML 内联有脚本风险） */
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'])

export function isInlineImage(mime) {
  return INLINE_IMAGE.has(String(mime ?? '').toLowerCase())
}

/** 文件名清洗：去掉路径与控制字符（上传、下载头共用） */
export function safeName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  // 控制字符是要主动剔掉的（文件名里不该出现），这里不是笔误
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
  return clean || 'file'
}

/**
 * multipart 文件名的编码修正：浏览器按 UTF-8 发文件名，而 busboy/multer 按 latin1 解出来，
 * 中文名会变成「é¢˜ç›®」样。含 0x80–0xFF 字符时按 latin1→utf8 还原（纯 ASCII 名不受影响）。
 */
export function fixUploadName(raw) {
  const s = String(raw ?? '')
  if (!/[\u0080-\u00ff]/.test(s)) return safeName(s)
  const restored = Buffer.from(s, 'latin1').toString('utf8')
  // 还原后若出现替换符（说明原本就不是 UTF-8），退回原样清洗
  return safeName(restored.includes('\uFFFD') ? s : restored)
}

function rowOf(id) {
  return db.prepare('SELECT * FROM attachment WHERE id = ?').get(id)
}

/** 附件行 → API 对象（kind 由 mime 派生：image = 直接显示，file = 下载） */
export function toAttachment(row) {
  return {
    id: row.id,
    examId: row.exam_id,
    homeworkId: row.homework_id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    kind: isInlineImage(row.mime) ? 'image' : 'file',
    createdAt: row.created_at,
  }
}

/** 某条作业 / 考试的附件列表（按上传先后） */
export function attachmentsOf(kind, matterId) {
  const col = kind === 'exam' ? 'exam_id' : 'homework_id'
  return db.prepare(`SELECT * FROM attachment WHERE ${col} = ? ORDER BY id ASC`).all(matterId).map(toAttachment)
}

/** 一批作业 / 考试的附件（学期子树与整班快照用；两张表都空时直接返回空数组） */
export function attachmentsOfMatters(examIds = [], homeworkIds = []) {
  const clauses = []
  const params = []
  if (examIds.length) {
    clauses.push(`exam_id IN (${examIds.map(() => '?').join(',')})`)
    params.push(...examIds)
  }
  if (homeworkIds.length) {
    clauses.push(`homework_id IN (${homeworkIds.map(() => '?').join(',')})`)
    params.push(...homeworkIds)
  }
  if (!clauses.length) return []
  return db
    .prepare(`SELECT * FROM attachment WHERE ${clauses.join(' OR ')} ORDER BY id ASC`)
    .all(...params)
    .map(toAttachment)
}

/** 内容指纹（上传、导入校验共用） */
export function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 内容入池（内容寻址，重复内容只存一份）；返回 sha256 */
export function saveBlob(buffer) {
  const sha256 = sha256Of(buffer)
  db.prepare('INSERT OR IGNORE INTO blob (sha256, data, created_at) VALUES (?, ?, ?)').run(
    sha256,
    buffer,
    new Date().toISOString(),
  )
  return sha256
}

export function loadBlob(sha256) {
  return db.prepare('SELECT data FROM blob WHERE sha256 = ?').get(sha256)?.data ?? null
}

export function hasBlob(sha256) {
  return !!db.prepare('SELECT 1 FROM blob WHERE sha256 = ?').get(sha256)
}

/**
 * 插入元数据行（上传、撤销恢复、导入共用；id 可不指定 = 自增）。
 * 调用方负责确认 sha256 对应的内容已在 blob 池里。
 */
export function insertAttachment({
  id = null,
  examId = null,
  homeworkId = null,
  name,
  mime = '',
  size = 0,
  sha256,
  userId = null,
  createdAt = null,
}) {
  const info = db
    .prepare(
      `INSERT INTO attachment (id, exam_id, homework_id, name, mime, size, sha256, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, examId, homeworkId, name, mime, size, sha256, userId, createdAt ?? new Date().toISOString())
  return toAttachment(rowOf(id ?? info.lastInsertRowid))
}

/** 某条作业 / 考试是否还有附件（删除前的存在性检查用不到，但导入校验要） */
export function attachmentCount(kind, matterId) {
  const col = kind === 'exam' ? 'exam_id' : 'homework_id'
  return db.prepare(`SELECT COUNT(*) AS c FROM attachment WHERE ${col} = ?`).get(matterId).c
}
