// ============================================================
// ClassBoard · 附件路由（作业 / 考试的图片与文件）
//   上传：POST /api/attachments（multipart：file + examId | homeworkId）
//   删除：DELETE /api/attachments/:id
//   下载：GET /api/public/attachments/:id（公开——附件跟随所在对象的可见性）
//   全部写操作记入 change_log；内容存 blob 池（内容寻址，撤销可原样接回）
// ============================================================
import { Router } from 'express'
import multer from 'multer'
import { db } from '../lib/db.js'
import { memberSemester } from '../lib/classes.js'
import { recordChange, entitySnapshot } from '../lib/changes.js'
import { badRequest, notFound, tooLarge, wrap } from '../lib/errors.js'
import {
  ATTACHMENTS_PER_MATTER,
  ATTACHMENT_MAX_SIZE,
  attachmentCount,
  fixUploadName,
  insertAttachment,
  saveBlob,
} from '../lib/attachments.js'

export const attachmentsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_SIZE, files: 1 },
})

/** multer 的报错转成统一信封（超大 → 413，其余 → 400） */
function uploadOne(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next()
    if (err.name === 'MulterError') {
      if (err.code === 'LIMIT_FILE_SIZE') return next(tooLarge())
      return next(badRequest('上传内容无法识别：' + err.message))
    }
    next(err)
  })
}

/** 解析目标对象（examId / homeworkId 二选一）并校验调用者是该班的负责人 */
function targetMatter(req) {
  const examId = Number(req.body?.examId ?? req.query?.examId ?? NaN)
  const homeworkId = Number(req.body?.homeworkId ?? req.query?.homeworkId ?? NaN)
  const hasExam = Number.isInteger(examId) && examId > 0
  const hasHw = Number.isInteger(homeworkId) && homeworkId > 0
  if (hasExam && hasHw) throw badRequest('一次只能挂到一个对象上（examId 与 homeworkId 二选一）')
  if (!hasExam && !hasHw) throw badRequest('缺少 examId 或 homeworkId')
  if (hasExam) {
    const row = db.prepare('SELECT * FROM exam WHERE id = ?').get(examId)
    const sem = row ? memberSemester(row.semester_id, req.user.id) : null
    if (!row || !sem) throw notFound('考试不存在')
    return { kind: 'exam', id: row.id, classId: sem.class_id }
  }
  const row = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId)
  const sem = row ? memberSemester(row.semester_id, req.user.id) : null
  if (!row || !sem) throw notFound('作业不存在')
  return { kind: 'homework', id: row.id, classId: sem.class_id }
}

attachmentsRouter.post(
  '/',
  uploadOne,
  wrap(async (req, res) => {
    const matter = targetMatter(req)
    const file = req.file
    if (!file?.buffer?.length) throw badRequest('缺少上传文件（字段名 file）')
    if (file.size > ATTACHMENT_MAX_SIZE) throw tooLarge()
    if (attachmentCount(matter.kind, matter.id) >= ATTACHMENTS_PER_MATTER) {
      throw badRequest(`每条最多 ${ATTACHMENTS_PER_MATTER} 个附件，请先删掉不用的再传`)
    }
    const sha256 = saveBlob(file.buffer)
    const att = insertAttachment({
      [matter.kind === 'exam' ? 'examId' : 'homeworkId']: matter.id,
      name: fixUploadName(file.originalname),
      mime: String(file.mimetype ?? ''),
      size: file.size,
      sha256,
      userId: req.user.id,
    })
    recordChange({
      classId: matter.classId,
      actorId: req.user.id,
      action: 'create',
      entity: 'attachment',
      entityId: att.id,
      after: entitySnapshot('attachment', att.id),
    })
    res.status(201).json(att)
  }),
)

attachmentsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM attachment WHERE id = ?').get(id)
    if (!row) throw notFound('附件不存在')
    // 归属校验：附件所挂的作业/考试必须属于调用者管理的班级
    const sem = row.exam_id
      ? (() => {
          const e = db.prepare('SELECT semester_id FROM exam WHERE id = ?').get(row.exam_id)
          return e ? memberSemester(e.semester_id, req.user.id) : null
        })()
      : (() => {
          const h = db.prepare('SELECT semester_id FROM homework WHERE id = ?').get(row.homework_id)
          return h ? memberSemester(h.semester_id, req.user.id) : null
        })()
    if (!sem) throw notFound('附件不存在')
    const before = entitySnapshot('attachment', id)
    db.prepare('DELETE FROM attachment WHERE id = ?').run(id)
    recordChange({
      classId: sem.class_id,
      actorId: req.user.id,
      action: 'delete',
      entity: 'attachment',
      entityId: id,
      before,
    })
    res.status(204).end()
  }),
)
