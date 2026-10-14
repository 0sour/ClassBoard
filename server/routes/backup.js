// ============================================================
// ClassBoard · 备份路由（班级版）
// 导出：version 6——账号所属的全部班级及其学期/课表/日历/调整/通知；天气 API Key 脱敏
// 恢复：任一负责人可恢复；带 classId 则覆盖该班（须为成员），不带则新建一个班级承接
// 兼容：version 2/3 旧课程结构由转换器无损升级；version 4 缺日历与调整字段按空处理；
//        version 5 及更旧没有班级字段，统一落到目标班级
// ============================================================
import { Router } from 'express'
import multer from 'multer'
import {
  db,
  DATA_DIR,
  replaceCourseSessions,
  toAdjustment,
  toCoursesWithSessions,
  toDayRule,
  toExam,
  toHomework,
  toNotice,
  toPeriod,
  toSemester,
} from '../lib/db.js'
import { AppError, badFile, tooLarge, wrap } from '../lib/errors.js'
import { isMaskedApiKey, readSettings } from '../lib/settings.js'
import { requireActive } from '../lib/access.js'
import { createSnapshot } from '../lib/snapshot.js'
import { createClass, classIdsOfUser, memberClass } from '../lib/classes.js'
import { recordChange, classStateSnapshot } from '../lib/changes.js'
import { expandWeeks, periodRange, semesterWeekCount, MAX_PERIODS, MAX_WEEKS } from '../lib/weekspan.js'
import { isValidColor } from '../lib/colors.js'
import { ADJUSTMENT_KINDS } from '../lib/validate.js'

export const backupRouter = Router()

export const BACKUP_VERSION = 6

/** 引入日历与单课调整的版本（更早的备份缺少这两个数据集） */
const CALENDAR_VERSION = 5

const COURSE_TYPES = ['course', 'lab']
function vStr(v, mx) { return typeof v === 'string' && v.trim().length > 0 && (mx ? v.length <= mx : true) }
function vNum(v, mn, mx) { return typeof v === 'number' && Number.isInteger(v) && v >= (mn ?? 0) && (mx ? v <= mx : true) }
function vDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}($|T\d{2}:\d{2})$/.test(v) }
function vTime(v) { return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) }
function vWeekday(v) { return vNum(v, 1, 7) }
function vIntArray(v, mx) { return Array.isArray(v) && v.every((n) => vNum(n, 1, mx)) }
function vSem(s) { if (!s) return false; return vNum(s.id, 1) && vStr(s.name, 50) && vDate(s.startDate) && vDate(s.endDate) && vWeekday(s.weekStartDay) }
function vPeriod(p) { if (!p) return false; return vNum(p.id, 1) && vNum(p.semesterId, 1) && vNum(p.index, 1, 30) && vTime(p.startTime) && vTime(p.endTime) }
function vExam(e) { if (!e) return false; return vNum(e.id, 1) && vNum(e.semesterId, 1) && vStr(e.name, 50) && vDate(e.datetime) && (e.courseId === null || vNum(e.courseId, 1)) }
// 作业：P2 起没有个人完成态；旧备份里的 done 字段读取时忽略（向后兼容）
function vHw(h) { if (!h) return false; return vNum(h.id, 1) && vNum(h.semesterId, 1) && vStr(h.name, 50) && vDate(h.dueAt) && (h.courseId === null || vNum(h.courseId, 1)) }
/** 学期日历规则：放假（holiday）/ 整日移课（shift，带 toDate） */
function vDayRule(r) {
  if (!r) return false
  if (!vNum(r.semesterId, 1) || !vDate(r.date)) return false
  if (!['holiday', 'shift'].includes(r.kind)) return false
  if (r.kind === 'shift' && !(typeof r.toDate === 'string' && vDate(r.toDate))) return false
  return r.note === undefined || r.note === null || typeof r.note === 'string'
}
/** 单课调整：停课 / 调课 / 补课（fromPeriods / periods 为逐项整数数组） */
function vAdjustment(a) {
  if (!a) return false
  if (!vNum(a.courseId, 1) || !vDate(a.date)) return false
  if (!ADJUSTMENT_KINDS.includes(a.kind)) return false
  if (a.fromWeekday !== null && a.fromWeekday !== undefined && !vWeekday(a.fromWeekday)) return false
  if (a.fromPeriods !== undefined && !vIntArray(a.fromPeriods, MAX_PERIODS)) return false
  if (a.toDate !== null && a.toDate !== undefined && !vDate(a.toDate)) return false
  if (a.periods !== undefined && !vIntArray(a.periods, MAX_PERIODS)) return false
  if (a.kind === 'move' && !a.toDate) return false
  if (a.kind !== 'cancel' && !(Array.isArray(a.periods) && a.periods.length)) return false
  return true
}
/** 通知：日期 + 标题必填 */
function vNotice(n) {
  if (!n) return false
  return vDate(n.date) && vStr(n.title, 100) && (n.body === undefined || typeof n.body === 'string')
}

/** 新结构课程行校验：元数据 + sessions（节次/周次逐项数组） */
function vCourseV4(c) {
  if (!c) return false
  if (!vNum(c.id, 1) || !vNum(c.semesterId, 1)) return false
  if (!COURSE_TYPES.includes(c.type)) return false
  if (!vStr(c.name, 50)) return false
  if (!Array.isArray(c.sessions)) return false
  for (const s of c.sessions) {
    if (!s || !vWeekday(s.weekday)) return false
    if (!Array.isArray(s.periods) || !s.periods.length) return false
    if (!Array.isArray(s.weeks) || !s.weeks.length) return false
    if (s.periods.some((p) => !vNum(p, 1, MAX_PERIODS))) return false
    if (s.weeks.some((w) => !vNum(w, 1, MAX_WEEKS))) return false
  }
  return true
}

/** 旧结构课程行校验（v2/v3 备份） */
function vCourseLegacy(c) {
  if (!c) return false
  return vNum(c.id, 1) && vNum(c.semesterId, 1) && COURSE_TYPES.includes(c.type) && vStr(c.name, 50)
    && vWeekday(c.weekday) && vNum(c.startPeriod, 1, MAX_PERIODS) && vNum(c.endPeriod, 1, MAX_PERIODS) && c.startPeriod <= c.endPeriod
}

/** 旧备份课程行 → 新结构（无损） */
function upgradeLegacyCourse(c, maxWeeks) {
  const weeks = expandWeeks(c.weekType ?? 'all', c.weekList ?? null, maxWeeks)
  const periods = periodRange(c.startPeriod, c.endPeriod)
  return {
    id: c.id,
    semesterId: c.semesterId,
    type: c.type,
    name: c.name,
    teacher: c.teacher ?? '',
    location: c.location ?? '',
    color: c.color ?? 'course-1',
    remark: c.remark ?? '',
    sessions: weeks.length && periods.length
      ? [{ weekday: c.weekday, location: c.location ?? '', periods, weeks }]
      : [],
  }
}

/**
 * 整站导出（仅管理员）：所有班级的完整数据 + 所有账号（含口令哈希）。
 * 文件里带 `includesPasswordHashes: true` 与 warning 文案，别随手分享。
 * 天气 API Key 仍然脱敏（不把密钥写进可下载文件；恢复后重新填一次）。
 */
backupRouter.get(
  '/site',
  wrap(async (req, res) => {
    if (req.user.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '仅管理员可整站导出')
    const classIds = db.prepare('SELECT id FROM class ORDER BY id ASC').all().map((r) => r.id)
    const payload = buildExportPayload(classIds, null)
    payload.kind = 'site'
    payload.includesPasswordHashes = true
    payload.warning = '整站导出：包含全部账号（含口令哈希，可直接用于重建登录）与全部班级数据，仅管理员可见，请妥善保管'
    payload.users = db
      .prepare('SELECT * FROM user ORDER BY id ASC')
      .all()
      .map((u) => ({
        id: u.id,
        username: u.username,
        passwordHash: u.password_hash,
        role: u.role,
        status: u.status,
        school: u.school ?? '',
        major: u.major ?? '',
        claimedClass: u.claimed_class ?? '',
        disabled: !!u.disabled,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at ?? null,
      }))
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="classboard-site-backup-${stamp}.json"`)
    res.send(JSON.stringify(payload, null, 2))
  }),
)

/**
 * 组装导出负载：给定班级集合（uid 为 null = 整站导出，不带「我的设置」）。
 * 账号导出与整站导出共用同一份班级数据结构。
 */
function buildExportPayload(classIds, uid) {
  const classes = classIds.map((id) => {
    const row = db.prepare('SELECT * FROM class WHERE id = ?').get(id)
    return { id: row.id, school: row.school, name: row.name, major: row.major, city: row.city }
  })
  const semRows = classIds.length
    ? db
        .prepare(
          `SELECT * FROM semester WHERE class_id IN (${classIds.map(() => '?').join(',')})
            ORDER BY class_id ASC, id ASC`,
        )
        .all(...classIds)
    : []
  const semIds = semRows.map((s) => s.id)
  const inSems = (sql) => (semIds.length ? db.prepare(sql).all(...semIds) : [])
  const courseRows = semIds.length
    ? inSems(`SELECT * FROM course WHERE semester_id IN (${semIds.map(() => '?').join(',')}) ORDER BY id ASC`)
    : []
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // 带 id：导入时按班级分组（P5 前导出的 v6 文件没有 id，导入按「全部归一个班」处理）
    classes,
    semesters: semRows.map(toSemester),
    periods: semIds.length
      ? inSems(
          `SELECT * FROM period_template WHERE semester_id IN (${semIds.map(() => '?').join(',')})
            ORDER BY semester_id ASC, period_index ASC`,
        ).map(toPeriod)
      : [],
    courses: toCoursesWithSessions(courseRows),
    exams: semIds.length
      ? inSems(`SELECT * FROM exam WHERE semester_id IN (${semIds.map(() => '?').join(',')}) ORDER BY id ASC`).map(toExam)
      : [],
    homework: semIds.length
      ? inSems(`SELECT * FROM homework WHERE semester_id IN (${semIds.map(() => '?').join(',')}) ORDER BY id ASC`).map(toHomework)
      : [],
    calendar: semIds.length
      ? inSems(
          `SELECT * FROM semester_day_rule WHERE semester_id IN (${semIds.map(() => '?').join(',')})
            ORDER BY semester_id ASC, date ASC`,
        ).map(toDayRule)
      : [],
    adjustments: courseRows.length
      ? db
          .prepare(
            `SELECT * FROM course_adjustment WHERE course_id IN (${courseRows.map(() => '?').join(',')})
              ORDER BY course_id ASC, date ASC, id ASC`,
          )
          .all(...courseRows.map((c) => c.id))
          .map(toAdjustment)
      : [],
    notices: classIds.length
      ? db
          .prepare(
            `SELECT n.*, u.username AS author_name FROM notice n LEFT JOIN user u ON u.id = n.author_id
              WHERE n.class_id IN (${classIds.map(() => '?').join(',')})
              ORDER BY n.class_id ASC, n.id ASC`,
          )
          .all(...classIds)
          .map(toNotice)
      : [],
    // readSettings 已按 maskSecrets 脱敏天气 API Key（恢复时保留本地已有配置）
    settings: uid == null ? null : readSettings(uid, { maskSecrets: true }),
  }
}

/** 按账号导出：我名下全部班级（含学期 / 课表 / 日历 / 调整 / 通知；天气密钥脱敏） */
backupRouter.get(
  '/',
  wrap(async (req, res) => {
    const uid = req.user.id
    const payload = buildExportPayload(classIdsOfUser(uid), uid)
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="classboard-backup-${stamp}.json"`)
    res.send(JSON.stringify(payload, null, 2))
  }),
)


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

/**
 * 恢复备份。
 * form: file（必填）、classId（可选；不填则新建一个班级承接）
 * 覆盖语义：清空目标班级的全部数据后按备份重建（同级放行：共管班级也可覆盖）。
 */
backupRouter.post(
  '/restore',
  requireActive,
  upload.single('file'),
  wrap(async (req, res) => {
    const file = req.file
    if (!file) throw badFile('缺少上传文件')
    if (file.size > 20 * 1024 * 1024) throw tooLarge()
    let data
    try {
      data = JSON.parse(file.buffer.toString('utf8'))
    } catch {
      throw badFile('备份文件格式不符（须为 JSON）')
    }
    if (
      ![2, 3, 4, 5, BACKUP_VERSION].includes(data.version) ||
      !Array.isArray(data.semesters) ||
      !Array.isArray(data.courses)
    ) {
      throw badFile('备份文件版本或结构无法识别')
    }

    const uid = req.user.id
    // v2/v3 的课程是旧「一行一时间」结构；v4 起为「组 + sessions」；v5 起附带日历与调整；v6 起带班级
    const legacy = data.version < 4
    const hasCalendar = data.version >= CALENDAR_VERSION

    // ---- 备份里的班级分组 ----
    // v6 且带 id 的按 classId 分；更旧的备份 / 没带 id 的全部归一组（落到同一个班）
    const classGroups = (() => {
      const declared = Array.isArray(data.classes) ? data.classes : []
      const withIds = declared.filter((c) => c && Number.isInteger(c.id))
      if (!withIds.length) {
        return [
          {
            school: String(declared[0]?.school ?? ''),
            name: String(declared[0]?.name ?? data.semesters?.[0]?.name ?? '导入的班级'),
            semIds: (data.semesters ?? []).map((x) => x.id),
          },
        ]
      }
      return withIds.map((c) => ({
        school: String(c.school ?? ''),
        name: String(c.name ?? ''),
        semIds: (data.semesters ?? []).filter((x) => x.classId === c.id).map((x) => x.id),
      })).filter((g) => g.semIds.length)
    })()
    if (!classGroups.length) throw badFile('备份里没有任何学期数据')

    const rawClassId = req.body?.classId ?? req.query?.classId
    const overwrite = rawClassId !== undefined && rawClassId !== '' && rawClassId !== 'null'
    const formSchool = String(req.body?.school ?? '').trim()
    const formName = String(req.body?.name ?? '').trim()
    const checkName = (school, name) => {
      if (school.length < 2 || school.length > 40) throw badFile('学校名长度须为 2–40（导入新班级时要填）')
      if (name.length < 2 || name.length > 40) throw badFile('班级名长度须为 2–40（导入新班级时要填）')
    }

    // ---- 目标班级：覆盖模式（显式 classId）或「作为新班级」模式 ----
    const targets = [] // [{ class: row, group }]
    if (overwrite) {
      if (classGroups.length > 1) {
        throw badFile(
          `这份备份含 ${classGroups.length} 个班级，覆盖导入会把它们合并成一个班。请改用「作为新班级」逐个导入`,
        )
      }
      const cls = memberClass(Number(rawClassId), uid)
      if (!cls) throw badFile('目标班级不存在或你不是该班负责人')
      targets.push({ class: cls, group: { ...classGroups[0], created: false }, created: false })
    } else {
      for (const [i, group] of classGroups.entries()) {
        // 单班备份用表单填的学校 + 班级名；多班备份用备份里各自的名字
        const useForm = classGroups.length === 1 && (formSchool || formName)
        const school = useForm ? formSchool : group.school
        const name = useForm ? formName : group.name
        checkName(school || '未填学校', name || `导入的班级${i + 1}`)
        let result = createClass({
          school: school || '未填学校',
          name: name || `导入的班级${i + 1}`,
          major: '',
          city: '',
          userId: uid,
        })
        // 多班备份没法逐个改名：重名时自动加后缀（单班备份仍提示用户自己改或用覆盖）
        if (!result.created && classGroups.length > 1) {
          const base = name || `导入的班级${i + 1}`
          for (let n = 1; n <= 9 && !result.created; n++) {
            result = createClass({ school: school || '未填学校', name: `${base}（导入${n > 1 ? n : ''}）`, major: '', city: '', userId: uid })
          }
        }
        if (!result.created) {
          throw badFile(`「${school || '未填学校'} · ${name}」已存在：可改个班级名，或选「覆盖已有班级」`)
        }
        targets.push({ class: result.class, group: { ...group, created: true }, created: true })
      }
    }
    const targetClass = targets[0].class
    const createdClass = targets[0].created

    // 恢复会清空目标班级的数据：先做一致性快照
    const snapshot = await createSnapshot(db, DATA_DIR, 'backup-restore')
    const beforeState = classStateSnapshot(targetClass.id)

    // 逐项校验：任何一条不通过就整批拒绝（不再静默丢弃）
    const problems = []
    for (const s of data.semesters ?? []) if (!vSem(s)) problems.push(`学期数据无效：${JSON.stringify(s).slice(0, 80)}`)
    for (const p of data.periods ?? []) if (!vPeriod(p)) problems.push(`节次数据无效：${JSON.stringify(p).slice(0, 80)}`)
    const maxWeeksBySem = new Map()
    for (const s of data.semesters ?? []) {
      if (vSem(s)) maxWeeksBySem.set(s.id, semesterWeekCount(s.startDate, s.endDate, s.weekStartDay))
    }

    const courseRows = []
    for (const c of data.courses ?? []) {
      if (legacy) {
        if (!vCourseLegacy(c)) { problems.push(`课程数据无效：${JSON.stringify(c).slice(0, 80)}`); continue }
        courseRows.push(upgradeLegacyCourse(c, maxWeeksBySem.get(c.semesterId) ?? 16))
      } else {
        if (!vCourseV4(c)) { problems.push(`课程数据无效：${JSON.stringify(c).slice(0, 80)}`); continue }
        courseRows.push(c)
      }
    }
    for (const e of data.exams ?? []) if (!vExam(e)) problems.push(`考试数据无效：${JSON.stringify(e).slice(0, 80)}`)
    for (const h of data.homework ?? []) if (!vHw(h)) problems.push(`作业数据无效：${JSON.stringify(h).slice(0, 80)}`)

    // 学期日历与单课调整（v4 及更旧备份没有这两个数据集，按空处理）
    const ruleRows = hasCalendar ? (data.calendar ?? []) : []
    const adjRows = hasCalendar ? (data.adjustments ?? []) : []
    for (const r of ruleRows) if (!vDayRule(r)) problems.push(`日历规则无效：${JSON.stringify(r).slice(0, 80)}`)
    for (const a of adjRows) if (!vAdjustment(a)) problems.push(`调整记录无效：${JSON.stringify(a).slice(0, 80)}`)
    const noticeRows = Array.isArray(data.notices) ? data.notices : []
    for (const n of noticeRows) if (!vNotice(n)) problems.push(`通知数据无效：${JSON.stringify(n).slice(0, 80)}`)
    if (problems.length) {
      throw badFile(`备份文件存在 ${problems.length} 条无法识别的数据，已中止恢复（未改动任何数据）`, problems.slice(0, 20))
    }

    // 快照与备份的学期集合应一致（避免悬空外键）
    const semIds = new Set((data.semesters ?? []).map((s) => s.id))
    const dangling = courseRows.filter((c) => !semIds.has(c.semesterId))
    if (dangling.length) {
      throw badFile(`备份文件不完整：${dangling.length} 门课程引用了不存在的学期，已中止恢复`)
    }
    // 日历 / 调整 / 通知的引用同样必须落在备份集合内
    const courseIdSet = new Set(courseRows.map((c) => c.id))
    const badRules = ruleRows.filter((r) => !semIds.has(r.semesterId))
    if (badRules.length) {
      throw badFile(`备份文件不完整：${badRules.length} 条日历规则引用了不存在的学期，已中止恢复`)
    }
    const badAdjust = adjRows.filter((a) => !courseIdSet.has(a.courseId))
    if (badAdjust.length) {
      throw badFile(`备份文件不完整：${badAdjust.length} 条调整记录引用了不存在的课程，已中止恢复`)
    }
    // 每个学期的课表数据都要有归属（分组后不能漏）
    const groupedSemIds = new Set(targets.flatMap((t) => t.group.semIds))
    const ungrouped = courseRows.filter((c) => !groupedSemIds.has(c.semesterId))
    if (ungrouped.length) {
      throw badFile(`备份文件不完整：${ungrouped.length} 门课程所属的学期不在任何班级分组里，已中止恢复`)
    }

    const classId = targetClass.id
    /**
     * 备份里的学期 id 是否被**别的班**占用（占用就必须重编主键）。
     * 目标班自己的行稍后会被清掉，不算占用——覆盖导入因此能沿用原 id。
     */
    const idsTaken = (semIdsToCheck, targetId) => {
      if (!semIdsToCheck.length) return false
      return !!db
        .prepare(
          `SELECT 1 FROM semester WHERE class_id <> ? AND id IN (${semIdsToCheck.map(() => '?').join(',')}) LIMIT 1`,
        )
        .get(targetId, ...semIdsToCheck)
    }

    /** 把一个班级分组的学期数据（含派生表）写进目标班级 */
    const insertGroup = (cls, group) => {
      const gSemIds = new Set(group.semIds)
      const gSems = (data.semesters ?? []).filter((x) => gSemIds.has(x.id))
      const gPeriods = (data.periods ?? []).filter((p) => gSemIds.has(p.semesterId))
      const gCourses = courseRows.filter((c) => gSemIds.has(c.semesterId))
      const gCourseIds = new Set(gCourses.map((c) => c.id))
      const gExams = (data.exams ?? []).filter((e) => gSemIds.has(e.semesterId))
      const gHw = (data.homework ?? []).filter((h) => gSemIds.has(h.semesterId))
      const gRules = ruleRows.filter((r) => gSemIds.has(r.semesterId))
      const gAdj = adjRows.filter((a) => gCourseIds.has(a.courseId))
      const gNotices = noticeRows.filter(
        (n) => n.semesterId === undefined || n.classId === undefined || gSemIds.has(n.semesterId) || n.classId === cls.id,
      )
      // 新班（或备份里的 id 已被占用）→ 重编 id，避免与现有数据撞主键
      const remap = group.created === true || idsTaken([...gSemIds], cls.id)
      writeGroupInto(cls, group, {
        semIds: gSemIds,
        sems: gSems,
        periods: gPeriods,
        courses: gCourses,
        courseIds: gCourseIds,
        exams: gExams,
        homework: gHw,
        rules: gRules,
        adjustments: gAdj,
        notices: gNotices,
        remap,
      })
    }

    const restore = db.transaction(() => {
      for (const t of targets) insertGroup(t.class, t.group)
      writeUserSettings(uid, data.settings ?? {})
    })
    restore()
    recordChange({
      classId,
      actorId: uid,
      action: 'restore',
      entity: 'class_state',
      entityId: classId,
      before: beforeState,
      after: classStateSnapshot(classId),
    })
    for (const t of targets.slice(1)) {
      recordChange({
        classId: t.class.id,
        actorId: uid,
        action: 'restore',
        entity: 'class_state',
        entityId: t.class.id,
        before: null,
        after: classStateSnapshot(t.class.id),
      })
    }

    res.json({
      restored: {
        version: BACKUP_VERSION,
        upgradedFrom: legacy ? data.version : null,
        classId,
        createdClass,
        classes: targets.map((t) => ({ id: t.class.id, school: t.class.school, name: t.class.name, created: t.created })),
        semesters: (data.semesters ?? []).length,
        courses: courseRows.length,
        exams: (data.exams ?? []).length,
        homework: (data.homework ?? []).length,
        calendar: ruleRows.length,
        adjustments: adjRows.length,
        notices: noticeRows.length,
        snapshot,
      },
    })
  }),
)

/**
 * 把一个班级分组的数据写进目标班级（先清空该班，再逐表插入；id 沿用备份里的）。
 * 调用方负责事务。
 */
function writeGroupInto(cls, group, g) {
  const classId = cls.id
  // 只清理目标班级的数据（其余班级不受影响）
  db.prepare('DELETE FROM semester WHERE class_id = ?').run(classId)
  db.prepare('DELETE FROM notice WHERE class_id = ?').run(classId)

  // remap = true：不沿用备份里的 id，交给 SQLite 分配（导入到新班 / id 已被占用）
  const semMap = new Map()
  const insSem = db.prepare(
    'INSERT INTO semester (id, class_id, name, start_date, end_date, week_start_day, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  for (const s of g.sems) {
    const info = insSem.run(
      g.remap ? null : s.id,
      classId,
      s.name,
      s.startDate,
      s.endDate,
      s.weekStartDay,
      new Date().toISOString(),
    )
    semMap.set(s.id, g.remap ? Number(info.lastInsertRowid) : s.id)
  }
  const insPeriod = db.prepare(
    'INSERT INTO period_template (id, semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
  )
  for (const p of g.periods) {
    insPeriod.run(g.remap ? null : p.id, semMap.get(p.semesterId), p.index, p.startTime, p.endTime)
  }
  const insCourse = db.prepare(
    `INSERT INTO course (id, semester_id, type, name, teacher, location, color, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const courseMap = new Map()
  for (const c of g.courses) {
    const info = insCourse.run(
      g.remap ? null : c.id,
      semMap.get(c.semesterId),
      c.type,
      c.name,
      c.teacher ?? '',
      c.location ?? '',
      isValidColor(c.color) ? c.color : 'course-1',
      c.remark ?? '',
    )
    const newId = g.remap ? Number(info.lastInsertRowid) : c.id
    courseMap.set(c.id, newId)
    replaceCourseSessions(newId, c.sessions)
  }
  const insExam = db.prepare(
    'INSERT INTO exam (id, semester_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  for (const e of g.exams) {
    insExam.run(
      g.remap ? null : e.id,
      semMap.get(e.semesterId),
      e.courseId != null ? (courseMap.get(e.courseId) ?? null) : null,
      e.name,
      e.datetime,
      e.location ?? '',
      e.remark ?? '',
    )
  }
  const insHw = db.prepare(
    'INSERT INTO homework (id, semester_id, course_id, name, due_at, remark) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const h of g.homework) {
    insHw.run(
      g.remap ? null : h.id,
      semMap.get(h.semesterId),
      h.courseId != null ? (courseMap.get(h.courseId) ?? null) : null,
      h.name,
      h.dueAt,
      h.remark ?? '',
    )
  }

  // 学期日历：放假（逐日一行）/ 整日移课（某日 → 某日）
  const insRule = db.prepare(
    `INSERT OR REPLACE INTO semester_day_rule (semester_id, date, kind, to_date, note)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (const r of g.rules) {
    insRule.run(semMap.get(r.semesterId), r.date, r.kind, r.kind === 'shift' ? r.toDate : null, r.note ?? '')
  }

  // 单课调整：id 不沿用（无外部引用，交由 SQLite 分配以避免跨班主键冲突）
  const insAdj = db.prepare(
    `INSERT INTO course_adjustment
       (course_id, date, kind, from_weekday, from_periods, to_date, periods, location, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const a of g.adjustments) {
    insAdj.run(
      courseMap.get(a.courseId),
      a.date,
      a.kind,
      a.fromWeekday ?? null,
      JSON.stringify(a.fromPeriods ?? []),
      a.toDate ?? null,
      JSON.stringify(a.periods ?? []),
      a.location ?? '',
      a.note ?? '',
      a.createdAt ?? new Date().toISOString(),
    )
  }

  // 通知：作者置空（原作者可能不在本机；作者名只是展示用）
  const insNotice = db.prepare(
    `INSERT INTO notice (class_id, date, title, body, course_id, pinned, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const n of g.notices) {
    const courseOk = n.courseId != null && g.courseIds.has(n.courseId)
    insNotice.run(
      classId,
      n.date,
      n.title,
      n.body ?? '',
      courseOk ? (courseMap.get(n.courseId) ?? null) : null,
      n.pinned ? 1 : 0,
      null,
      n.createdAt ?? new Date().toISOString(),
      n.updatedAt ?? new Date().toISOString(),
    )
  }

  // 班级当前学期：优先沿用原指向（若仍在导入集合内），否则落到本组第一个学期
  const semIdsOrdered = g.sems.map((x) => semMap.get(x.id))
  const prevCurrent = g.remap ? null : cls.current_semester_id
  const nextCurrent = semIdsOrdered.includes(prevCurrent) ? prevCurrent : (semIdsOrdered[0] ?? null)
  db.prepare('UPDATE class SET current_semester_id = ?, updated_at = ? WHERE id = ?').run(
    nextCurrent,
    new Date().toISOString(),
    classId,
  )
}

/** 用户级设置：只写显示开关与天气（个人提醒 P2 已下线，不再恢复那三组键） */
function writeUserSettings(uid, sets) {
  const insSetting = db.prepare('INSERT OR REPLACE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)')
  insSetting.run(uid, 'show_odd_even_filter', JSON.stringify(sets.showOddEvenFilter ?? true))
  const incomingWeather = sets.weather ?? null
  if (incomingWeather) {
    const current = readSettings(uid).weather ?? {}
    const apiKey = isMaskedApiKey(incomingWeather.apiKey) ? current.apiKey : incomingWeather.apiKey
    insSetting.run(uid, 'weather', JSON.stringify({ ...incomingWeather, apiKey: apiKey ?? '' }))
  }
}
