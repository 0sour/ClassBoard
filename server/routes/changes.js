// ============================================================
// ClassBoard · 变更记录路由
//   列表：班级视角（负责人）/ 全站视角（管理员，class_id 为 NULL 的平台级记录也一并可见）
//   撤销：单条记录 → 逆操作（实体级）；其后又被改过 → 409 冲突并列出明细，不强制
//   回退：整班回到某条记录的 after 状态（先清后建，另记一条 rollback）
// ============================================================
import { Router } from 'express'
import { db } from '../lib/db.js'
import { classIdsOfUser, memberClass } from '../lib/classes.js'
import { classStateSnapshot, entitySnapshot, recordChange } from '../lib/changes.js'
import { REVERTIBLE, restoreEntity, restoreStateAt } from '../lib/restore.js'
import { AppError, badRequest, notFound, wrap } from '../lib/errors.js'

export const changesRouter = Router()

function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function rowToChange(row) {
  return {
    id: row.id,
    classId: row.class_id,
    className: row.class_name ?? '',
    actorId: row.actor_id,
    actorName: row.actor_name ?? '（已删除的账号）',
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    before: parseJson(row.before),
    after: parseJson(row.after),
    revertOf: row.revert_of,
    createdAt: row.created_at,
  }
}

/** 这条记录改完的样子，和现在的实体对得上吗？（对得上 = 那一下还生效，撤销会盖掉它） */
function stillInEffect(row) {
  const after = parseJson(row.after)
  if (after == null) return true // 删除类记录：实体现在不存在才算生效，交给下面的比对
  const now = row.entity === 'calendar' ? null : entitySnapshot(row.entity, row.entity_id)
  return subsetEqual(now, after)
}

/** now 是否「包含」after 记下的那些字段（记录里的快照可能比现在少几个键，按子集比） */
function subsetEqual(now, want) {
  if (want === null || typeof want !== 'object') return now === want
  if (Array.isArray(want)) {
    if (!Array.isArray(now) || now.length !== want.length) return false
    return want.every((v, i) => subsetEqual(now[i], v))
  }
  if (now == null || typeof now !== 'object') return false
  return Object.entries(want).every(([k, v]) => subsetEqual(now[k], v))
}

const SELECT_CHANGE = `
  SELECT c.*, u.username AS actor_name, cl.name AS class_name, cl.school AS class_school
    FROM change_log c
    LEFT JOIN user u ON u.id = c.actor_id
    LEFT JOIN class cl ON cl.id = c.class_id
`

/** 公共筛选：实体 / 记录 id / 操作人 / 是否只看可撤销 */
function buildFilters(query, where, params) {
  if (query.entity) {
    where.push('c.entity = ?')
    params.push(String(query.entity))
  }
  if (query.entityId !== undefined && query.entityId !== '') {
    where.push('c.entity_id = ?')
    params.push(Number(query.entityId))
  }
  if (query.action) {
    where.push('c.action = ?')
    params.push(String(query.action))
  }
  if (query.actorId !== undefined && query.actorId !== '') {
    where.push('c.actor_id = ?')
    params.push(Number(query.actorId))
  }
  if (query.before !== undefined && query.before !== '') {
    where.push('c.id < ?') // 加载更多：传当前最旧一条的 id
    params.push(Number(query.before))
  }
}

function limitOf(query) {
  const n = Number(query.limit ?? 50)
  if (!Number.isFinite(n)) return 50
  return Math.max(1, Math.min(200, Math.floor(n)))
}

/** 班级变更记录（负责人） */
changesRouter.get(
  '/classes/:id/changes',
  wrap(async (req, res) => {
    const cls = memberClass(Number(req.params.id), req.user.id)
    if (!cls) throw notFound('班级不存在')
    const where = ['c.class_id = ?']
    const params = [cls.id]
    buildFilters(req.query, where, params)
    const rows = db
      .prepare(`${SELECT_CHANGE} WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ?`)
      .all(...params, limitOf(req.query))
    // 总数按同一套筛选算（否则「加载更多」的数字对不上筛选结果）
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM change_log c WHERE ${where.join(' AND ')}`)
      .get(...params).n
    res.json({ total, changes: rows.map(rowToChange) })
  }),
)

/** 全站变更记录（管理员；含平台级记录 class_id = NULL） */
changesRouter.get(
  '/changes',
  wrap(async (req, res) => {
    if (req.user.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '仅管理员可查看全站变更记录')
    const where = []
    const params = []
    if (req.query.classId) {
      where.push('c.class_id = ?')
      params.push(Number(req.query.classId))
    }
    if (req.query.platform === '1') where.push('c.class_id IS NULL')
    if (req.query.actor) {
      where.push('u.username LIKE ?')
      params.push(`%${String(req.query.actor)}%`)
    }
    buildFilters(req.query, where, params)
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const rows = db
      .prepare(`${SELECT_CHANGE} ${clause} ORDER BY c.id DESC LIMIT ?`)
      .all(...params, limitOf(req.query))
    const classes = db
      .prepare('SELECT id, school, name FROM class ORDER BY school ASC, name ASC')
      .all()
      .map((c) => ({ id: c.id, name: `${c.school} · ${c.name}` }))
    res.json({ classes, changes: rows.map(rowToChange) })
  }),
)

/** 可见性：这条记录属于哪个班？管理员看得到平台级记录，负责人只能看自己班的 */
function visibleClassId(change, user) {
  if (change.class_id != null) {
    if (!classIdsOfUser(user.id).includes(change.class_id)) throw notFound('变更记录不存在')
    return change.class_id
  }
  if (user.role !== 'admin') throw notFound('变更记录不存在')
  return null
}

/** 单条撤销：把该记录涉及的实体恢复成它的 before */
changesRouter.post(
  '/changes/:id/revert',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    const change = db.prepare('SELECT * FROM change_log WHERE id = ?').get(id)
    if (!change) throw notFound('变更记录不存在')
    visibleClassId(change, req.user)
    if (!REVERTIBLE.has(change.entity)) {
      throw badRequest('这类记录改动的是整个班级，不支持单条撤销；请用「回退到这里」（整班回退）')
    }

    // 冲突：此后又被改过（同实体 + 同实体 id）→ 409 列出明细，不强制
    // 冲突 = 之后动过同一个对象、而且那一下「到现在还生效」。
    // 不看记录本身而看现状：用户先撤销了后一步再往回撤上一步时，
    // 后一条改动其实已经被撤销掉了（现在是它的 before），不该再拦人。
    const laterRows = db
      .prepare(
        `SELECT c.*, u.username AS actor_name FROM change_log c LEFT JOIN user u ON u.id = c.actor_id
          WHERE c.id > ? AND c.entity = ? AND IFNULL(c.entity_id, -1) = IFNULL(?, -1)
            AND c.action NOT IN ('revert', 'rollback')
            AND (c.class_id IS ? OR c.class_id = ?)
          ORDER BY c.id ASC`,
      )
      .all(id, change.entity, change.entity_id, change.class_id, change.class_id)
    const later = laterRows.filter((r) => stillInEffect(r))
    if (later.length) {
      return res.status(409).json({
        code: 'CHANGE_CONFLICT',
        message: '这条记录之后，同一对象又被改过，撤销会覆盖后来的改动',
        conflicts: later.map(rowToChange),
      })
    }

    const before = parseJson(change.before)
    const beforeState = change.class_id != null ? classStateSnapshot(change.class_id) : null
    const apply = db.transaction(() => {
      restoreEntity({
        entity: change.entity,
        entityId: change.entity_id,
        classId: change.class_id,
        before,
      })
    })
    try {
      apply()
    } catch (e) {
      if (e?.status) throw e
      if (String(e?.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
        throw badRequest(`撤销失败：${e.message}（多半是唯一键被占用，请先撤销后来的记录）`)
      }
      throw e
    }
    recordChange({
      classId: change.class_id,
      actorId: req.user.id,
      action: 'revert',
      entity: change.entity,
      entityId: change.entity_id,
      before: beforeState,
      after: change.class_id != null ? classStateSnapshot(change.class_id) : null,
      revertOf: change.id,
    })
    res.json({ ok: true, reverted: change.id })
  }),
)

/**
 * 整班回退：回到某条记录的 after 状态。
 * body: { changeId } —— 用哪条记录的「改完」状态作为目标；也可以传 { before: true } 回到它改之前。
 */
changesRouter.post(
  '/classes/:id/rollback',
  wrap(async (req, res) => {
    const cls = memberClass(Number(req.params.id), req.user.id)
    if (!cls) throw notFound('班级不存在')
    const changeId = Number(req.body?.changeId)
    if (!Number.isInteger(changeId)) throw badRequest('请选择要回退到的那条记录')
    const change = db.prepare('SELECT * FROM change_log WHERE id = ?').get(changeId)
    if (!change || change.class_id !== cls.id) throw notFound('变更记录不存在')

    const exclusive = req.body?.before === true
    const discarded = db
      .prepare('SELECT COUNT(*) AS n FROM change_log WHERE class_id = ? AND id > ?')
      .get(cls.id, exclusive ? changeId - 1 : changeId).n
    const before = classStateSnapshot(cls.id)
    const apply = db.transaction(() => {
      restoreStateAt(cls.id, changeId, { exclusive })
    })
    apply()
    recordChange({
      classId: cls.id,
      actorId: req.user.id,
      action: 'rollback',
      entity: 'class_state',
      entityId: cls.id,
      before,
      after: classStateSnapshot(cls.id),
      revertOf: changeId,
    })
    res.json({ ok: true, rolledBackTo: changeId, discarded })
  }),
)
