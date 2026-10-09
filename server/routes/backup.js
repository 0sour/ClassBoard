// ============================================================
// ClassBoard · 备份路由
// 导出：version 4（课程为「组 + sessions」结构）；天气 API Key 脱敏
// 恢复：仅 admin；只清理该用户自己的数据（user_id 过滤）；校验失败逐行报错整批回滚
// 兼容：version 2 / 3 旧备份由转换器无损升级
// ============================================================
import { Router } from 'express'
import multer from 'multer'
import {
  db,
  DATA_DIR,
  replaceCourseSessions,
  toCoursesWithSessions,
  toExam,
  toHomework,
  toPeriod,
  toSemester,
  getCurrentSemesterId,
  setCurrentSemesterId,
  clearCurrentSemesterId,
} from '../lib/db.js'
import { badFile, tooLarge, wrap } from '../lib/errors.js'
import { isMaskedApiKey, readSettings } from '../lib/settings.js'
import { requireAdmin } from '../lib/access.js'
import { createSnapshot } from '../lib/snapshot.js'
import { expandWeeks, periodRange, semesterWeekCount, MAX_PERIODS, MAX_WEEKS } from '../lib/weekspan.js'
import { isValidColor } from '../lib/colors.js'

export const backupRouter = Router()

export const BACKUP_VERSION = 4

const COURSE_TYPES = ['course', 'lab']
function vStr(v, mx) { return typeof v === 'string' && v.trim().length > 0 && (mx ? v.length <= mx : true) }
function vNum(v, mn, mx) { return typeof v === 'number' && Number.isInteger(v) && v >= (mn ?? 0) && (mx ? v <= mx : true) }
function vDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}($|T\d{2}:\d{2})$/.test(v) }
function vTime(v) { return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) }
function vWeekday(v) { return vNum(v, 1, 7) }
function vSem(s) { if (!s) return false; return vNum(s.id, 1) && vStr(s.name, 50) && vDate(s.startDate) && vDate(s.endDate) && vWeekday(s.weekStartDay) }
function vPeriod(p) { if (!p) return false; return vNum(p.id, 1) && vNum(p.semesterId, 1) && vNum(p.index, 1, 30) && vTime(p.startTime) && vTime(p.endTime) }
function vExam(e) { if (!e) return false; return vNum(e.id, 1) && vNum(e.semesterId, 1) && vStr(e.name, 50) && vDate(e.datetime) && (e.courseId === null || vNum(e.courseId, 1)) }
function vHw(h) { if (!h) return false; return vNum(h.id, 1) && vNum(h.semesterId, 1) && vStr(h.name, 50) && vDate(h.dueAt) && (h.courseId === null || vNum(h.courseId, 1)) && (typeof h.done === 'boolean' || typeof h.done === 'number') }

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

backupRouter.get(
  '/',
  wrap(async (req, res) => {
    const uid = req.user.id
    // 导出统一走脱敏（readSettings 自带 maskSecrets）
    const settings = readSettings(uid, { maskSecrets: true })
    const payload = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      semesters: db.prepare('SELECT * FROM semester WHERE user_id = ? ORDER BY id ASC').all(uid).map(toSemester),
      periods: db.prepare('SELECT * FROM period_template WHERE user_id = ? ORDER BY semester_id ASC, period_index ASC').all(uid).map(toPeriod),
      courses: toCoursesWithSessions(
        db.prepare('SELECT * FROM course WHERE user_id = ? ORDER BY id ASC').all(uid),
      ),
      exams: db.prepare('SELECT * FROM exam WHERE user_id = ? ORDER BY id ASC').all(uid).map(toExam),
      homework: db.prepare('SELECT * FROM homework WHERE user_id = ? ORDER BY id ASC').all(uid).map(toHomework),
      // readSettings 已按 maskSecrets 脱敏天气 API Key（恢复时保留本地已有配置）
      settings,
      // 当前学期指向：随备份带走，还原后优先恢复到同一学期
      currentSemesterId: getCurrentSemesterId(uid),
      // 模板全局共享（admin 维护），随备份导出
      templates: db.prepare('SELECT * FROM template ORDER BY id ASC').all().map((t) => ({
        id: t.id,
        kind: t.kind,
        name: t.name,
        category: t.category,
        description: t.description,
        version: t.version,
        content: JSON.parse(t.content),
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    }
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

backupRouter.post(
  '/restore',
  requireAdmin,
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
    if (![2, 3, BACKUP_VERSION].includes(data.version) || !Array.isArray(data.semesters) || !Array.isArray(data.courses)) {
      throw badFile('备份文件版本或结构无法识别')
    }

    const uid = req.user.id
    const legacy = data.version < BACKUP_VERSION

    // 恢复会清空该用户全部数据：先做一致性快照
    const snapshot = await createSnapshot(db, DATA_DIR, 'backup-restore')

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
    if (problems.length) {
      throw badFile(`备份文件存在 ${problems.length} 条无法识别的数据，已中止恢复（未改动任何数据）`, problems.slice(0, 20))
    }

    // 快照与备份的学期集合应一致（避免悬空外键）
    const semIds = new Set((data.semesters ?? []).map((s) => s.id))
    const dangling = courseRows.filter((c) => !semIds.has(c.semesterId))
    if (dangling.length) {
      throw badFile(`备份文件不完整：${dangling.length} 门课程引用了不存在的学期，已中止恢复`)
    }

    const restore = db.transaction(() => {
      // 只清理该用户自己的数据（历史缺陷：无 user_id 过滤会清空其他用户）
      db.prepare('DELETE FROM homework WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM exam WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM course WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM period_template WHERE user_id = ?').run(uid)
      db.prepare('DELETE FROM semester WHERE user_id = ?').run(uid)

      const insSem = db.prepare(
        'INSERT INTO semester (id, name, start_date, end_date, week_start_day, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const s of data.semesters ?? []) {
        insSem.run(s.id, s.name, s.startDate, s.endDate, s.weekStartDay, new Date().toISOString(), uid)
      }
      const insPeriod = db.prepare(
        'INSERT INTO period_template (id, semester_id, user_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
      )
      for (const p of data.periods ?? []) {
        insPeriod.run(p.id, p.semesterId, uid, p.index, p.startTime, p.endTime)
      }
      const insCourse = db.prepare(
        `INSERT INTO course (id, semester_id, user_id, type, name, teacher, location, color, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const c of courseRows) {
        insCourse.run(
          c.id, c.semesterId, uid, c.type, c.name, c.teacher ?? '', c.location ?? '',
          isValidColor(c.color) ? c.color : 'course-1', c.remark ?? '',
        )
        replaceCourseSessions(c.id, c.sessions)
      }
      const insExam = db.prepare(
        'INSERT INTO exam (id, semester_id, user_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const e of data.exams ?? []) {
        insExam.run(e.id, e.semesterId, uid, e.courseId ?? null, e.name, e.datetime, e.location ?? '', e.remark ?? '')
      }
      const insHw = db.prepare(
        'INSERT INTO homework (id, semester_id, user_id, course_id, name, due_at, done, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const h of data.homework ?? []) {
        insHw.run(h.id, h.semesterId, uid, h.courseId ?? null, h.name, h.dueAt, h.done ? 1 : 0, h.remark ?? '')
      }

      // 设置（不恢复口令哈希；API Key 若为脱敏值则保留本地现有配置）
      const sets = data.settings ?? {}
      const insSetting = db.prepare(
        'INSERT OR REPLACE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)',
      )
      insSetting.run(uid, 'show_odd_even_filter', JSON.stringify(sets.showOddEvenFilter ?? true))
      insSetting.run(uid, 'reminder', JSON.stringify(sets.reminder ?? { enabled: false, mode: 'every', advanceMinutes: 10 }))
      insSetting.run(uid, 'lab_reminder', JSON.stringify(sets.labReminder ?? { enabled: false, mode: 'every', advanceMinutes: 10 }))
      insSetting.run(uid, 'homework_reminder', JSON.stringify(sets.homeworkReminder ?? { enabled: false, advanceDays: 2 }))
      const incomingWeather = sets.weather ?? null
      if (incomingWeather) {
        const current = readSettings(uid).weather ?? {}
        const apiKey = isMaskedApiKey(incomingWeather.apiKey) ? current.apiKey : incomingWeather.apiKey
        insSetting.run(uid, 'weather', JSON.stringify({ ...incomingWeather, apiKey: apiKey ?? '' }))
      }

      // 当前学期指向：还原清空了旧学期，原指向的 id 可能已不存在（悬空 → 课表空白）。
      // 优先用备份携带的指向（v4 备份），否则沿用本地原指向；两者都失效时落到第一个学期。
      const semIdsOrdered = (data.semesters ?? []).map((s) => s.id)
      const previousCurrent = getCurrentSemesterId(uid)
      const incoming = Number.isInteger(data.currentSemesterId) ? data.currentSemesterId : null
      const nextCurrent = semIdsOrdered.includes(incoming)
        ? incoming
        : semIdsOrdered.includes(previousCurrent)
          ? previousCurrent
          : (semIdsOrdered[0] ?? null)
      if (nextCurrent === null) clearCurrentSemesterId(uid)
      else setCurrentSemesterId(uid, nextCurrent)

      // 模板（全局共享；仅 admin 恢复时写入）
      if (Array.isArray(data.templates)) {
        db.prepare('DELETE FROM template').run()
        const insTpl = db.prepare(
          'INSERT INTO template (id, kind, name, category, description, version, content, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        for (const t of data.templates) {
          if (!t || !t.name) continue
          const kind = ['course', 'unit', 'semester'].includes(t.kind) ? t.kind : 'unit'
          // semester 模板内容是对象；course/unit 是数组——按 kind 分别校验，不再一律降级为 unit
          const content = t.content
          if (!Array.isArray(content) && !(content && typeof content === 'object')) continue
          const stored = kind === 'semester' ? JSON.stringify(content) : JSON.stringify(
            Array.isArray(content)
              ? content.map((row) =>
                  row && typeof row === 'object' && !Array.isArray(row.sessions) && ('weekType' in row || 'weekday' in row)
                    ? (() => {
                        const { weekType, weekList, weekday, startPeriod, endPeriod, ...meta } = row
                        const weeks = expandWeeks(weekType ?? 'all', weekList ?? null, 30)
                        const periods = periodRange(startPeriod, endPeriod)
                        return {
                          ...meta,
                          sessions: weeks.length && periods.length
                            ? [{ weekday, location: row.location ?? '', periods, weeks }]
                            : [],
                        }
                      })()
                    : row,
                )
              : content,
          )
          insTpl.run(
            t.id, kind, t.name, t.category ?? '', t.description ?? '', t.version ?? 1,
            stored, uid, t.createdAt ?? new Date().toISOString(), t.updatedAt ?? new Date().toISOString(),
          )
        }
      }
    })
    restore()

    res.json({
      restored: {
        version: BACKUP_VERSION,
        upgradedFrom: legacy ? data.version : null,
        semesters: (data.semesters ?? []).length,
        courses: courseRows.length,
        exams: (data.exams ?? []).length,
        homework: (data.homework ?? []).length,
        snapshot,
      },
    })
  }),
)

