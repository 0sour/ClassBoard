// ============================================================
// ClassBoard · 班级路由（负责人侧）
//   创建（学校 + 班级名，同名即同一个班）、同名加入、资料、退出、删除
//   同级规则：一个班可有多名负责人，彼此权限相同；最后一人退出即删班
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import {
  classMembers,
  classSummary,
  createClass,
  findClassByKey,
  joinClass,
  leaveClass,
  listClassesOfUser,
  memberClass,
} from '../lib/classes.js'
import { recordChange, entitySnapshot, classStateSnapshot } from '../lib/changes.js'
import { badRequest, notFound, wrap } from '../lib/errors.js'

export const classesRouter = Router()

/** 我的班级 */
classesRouter.get(
  '/',
  wrap(async (req, res) => {
    res.json(listClassesOfUser(req.user.id))
  }),
)

/** 公开可查的班级（按学校 + 班级名精确匹配，用于「同名即加入」前确认） */
classesRouter.get(
  '/lookup',
  wrap(async (req, res) => {
    const school = String(req.query.school ?? '').trim()
    const name = String(req.query.name ?? '').trim()
    if (!school || !name) throw badRequest('请填写学校与班级名')
    const row = findClassByKey(school, name)
    if (!row) return res.json({ found: false })
    res.json({ found: true, class: classSummary(row) })
  }),
)

classesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const cls = memberClass(Number(req.params.id), req.user.id)
    if (!cls) throw notFound('班级不存在')
    res.json({ ...classSummary(cls), members: classMembers(cls.id) })
  }),
)

/** 建班；学校 + 班级名 已存在时回 409 + 已存在的班级，供前端询问「加入该班」 */
classesRouter.post(
  '/',
  wrap(async (req, res) => {
    const school = String(req.body?.school ?? '').trim()
    const name = String(req.body?.name ?? '').trim()
    const major = String(req.body?.major ?? '').trim()
    const city = String(req.body?.city ?? '').trim()
    const issues = []
    if (school.length < 2 || school.length > 40) issues.push({ field: 'school', message: '学校名长度须为 2–40' })
    if (name.length < 2 || name.length > 40) issues.push({ field: 'name', message: '班级名长度须为 2–40' })
    if (major.length > 40) issues.push({ field: 'major', message: '专业长度须 ≤ 40' })
    if (city.length > 40) issues.push({ field: 'city', message: '城市长度须 ≤ 40' })
    if (issues.length) throw badRequest('班级信息校验失败', issues)

    const result = createClass({ school, name, major, city, userId: req.user.id })
    if (!result.created) {
      return res.status(409).json({
        code: 'CLASS_EXISTS',
        message: `「${school} · ${name}」已存在，可加入成为共同负责人`,
        class: classSummary(result.class),
      })
    }
    const cls = result.class
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'create',
      entity: 'class',
      entityId: cls.id,
      // 整班快照（此刻是空班）：新班从这里起每一步都有可回退的起点
      after: classStateSnapshot(cls.id),
    })
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'join',
      entity: 'member',
      entityId: req.user.id,
      after: { userId: req.user.id, username: req.user.username },
    })
    res.status(201).json(classSummary(cls))
  }),
)

/** 加入已有班级（同名即加入：负责人之间默认同级） */
classesRouter.post(
  '/:id/join',
  wrap(async (req, res) => {
    const cls = db.prepare('SELECT * FROM class WHERE id = ?').get(Number(req.params.id))
    if (!cls) throw notFound('班级不存在')
    if (!joinClass(cls.id, req.user.id)) throw notFound('班级不存在')
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'join',
      entity: 'member',
      entityId: req.user.id,
      after: { userId: req.user.id, username: req.user.username },
    })
    res.json({ ...classSummary(cls), members: classMembers(cls.id) })
  }),
)

/** 修改班级资料（任一负责人可改） */
classesRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const cls = memberClass(Number(req.params.id), req.user.id)
    if (!cls) throw notFound('班级不存在')
    const school = String(req.body?.school ?? cls.school).trim()
    const name = String(req.body?.name ?? cls.name).trim()
    const major = String(req.body?.major ?? cls.major).trim()
    const city = String(req.body?.city ?? cls.city).trim()
    const issues = []
    if (school.length < 2 || school.length > 40) issues.push({ field: 'school', message: '学校名长度须为 2–40' })
    if (name.length < 2 || name.length > 40) issues.push({ field: 'name', message: '班级名长度须为 2–40' })
    if (issues.length) throw badRequest('班级信息校验失败', issues)
    const dup = findClassByKey(school, name)
    if (dup && dup.id !== cls.id) {
      return res.status(409).json({
        code: 'CLASS_EXISTS',
        message: `「${school} · ${name}」已存在`,
        class: classSummary(dup),
      })
    }
    const before = entitySnapshot('class', cls.id)
    db.prepare('UPDATE class SET school = ?, name = ?, major = ?, city = ?, updated_at = ? WHERE id = ?').run(
      school,
      name,
      major,
      city,
      new Date().toISOString(),
      cls.id,
    )
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'update',
      entity: 'class',
      entityId: cls.id,
      before,
      after: entitySnapshot('class', cls.id),
    })
    res.json({ ...classSummary(db.prepare('SELECT * FROM class WHERE id = ?').get(cls.id)), members: classMembers(cls.id) })
  }),
)

/** 退出班级；最后一人退出即删班（连同数据，可在变更记录里回退） */
classesRouter.delete(
  '/:id/members/me',
  wrap(async (req, res) => {
    const cls = memberClass(Number(req.params.id), req.user.id)
    if (!cls) throw notFound('班级不存在')
    const beforeState = classStateSnapshot(cls.id)
    const { deleted } = leaveClass(cls.id, req.user.id)
    if (deleted) {
      recordChange({
        classId: null,
        actorId: req.user.id,
        action: 'leave',
        entity: 'class_state',
        entityId: cls.id,
        before: beforeState,
      })
    } else {
      recordChange({
        classId: cls.id,
        actorId: req.user.id,
        action: 'leave',
        entity: 'member',
        entityId: req.user.id,
        before: { userId: req.user.id, username: req.user.username },
      })
    }
    res.json({ deleted })
  }),
)

/** 删除班级（任一负责人可删；连同全部数据） */
classesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const cls = memberClass(Number(req.params.id), req.user.id)
    if (!cls) throw notFound('班级不存在')
    const beforeState = classStateSnapshot(cls.id)
    db.prepare('DELETE FROM class WHERE id = ?').run(cls.id)
    recordChange({
      classId: null,
      actorId: req.user.id,
      action: 'delete',
      entity: 'class_state',
      entityId: cls.id,
      before: beforeState,
    })
    res.json({ deleted: true })
  }),
)
