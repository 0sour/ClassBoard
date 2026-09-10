// ============================================================
// ClassBoard · 备份路由（技术文档 4.3.6 #31-#32）
// ============================================================
import { Router } from 'express'
import multer from 'multer'
import { db, toCourse, toExam, toHomework, toPeriod, toSemester } from '../lib/db.js'
import { badFile, tooLarge, wrap } from '../lib/errors.js'
import { readSettings } from '../lib/settings.js'

export const backupRouter = Router()

// ============================================================
// 备份恢复字段校验辅助函数（C-2 安全修复）
// ============================================================
const WEEK_TYPES = ["all", "odd", "even", "custom"]
const COURSE_TYPES = ["course", "lab"]
const COURSE_COLORS = ["course-1","course-2","course-3","course-4","course-5","course-6","course-7","course-8"]
function vStr(v,mx){return typeof v==="string"&&v.trim().length>0&&(mx?v.length<=mx:true)}
function vNum(v,mn,mx){return typeof v==="number"&&Number.isInteger(v)&&v>=(mn??0)&&(mx?v<=mx:true)}
function vDate(v){return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}($|T\d{2}:\d{2})$/.test(v)}
function vTime(v){return typeof v==="string"&&/^\d{2}:\d{2}$/.test(v)}
function vWeekday(v){return vNum(v,1,7)}
function vPeriodIdx(v){return vNum(v,1,12)}
function vSem(s){if(!s)return false;return vNum(s.id,1)&&vStr(s.name,50)&&vDate(s.startDate)&&vDate(s.endDate)&&vWeekday(s.weekStartDay)}
function vPeriod(p){if(!p)return false;return vNum(p.id,1)&&vNum(p.semesterId,1)&&vPeriodIdx(p.index)&&vTime(p.startTime)&&vTime(p.endTime)}
function vCourse(c){if(!c)return false;return vNum(c.id,1)&&vNum(c.semesterId,1)&&COURSE_TYPES.includes(c.type)&&vStr(c.name,50)
&&vWeekday(c.weekday)&&vPeriodIdx(c.startPeriod)&&vPeriodIdx(c.endPeriod)&&c.startPeriod<=c.endPeriod}
function vExam(e){if(!e)return false;return vNum(e.id,1)&&vNum(e.semesterId,1)&&vStr(e.name,50)&&vDate(e.datetime)
&&(e.courseId===null||vNum(e.courseId,1))}
function vHw(h){if(!h)return false;return vNum(h.id,1)&&vNum(h.semesterId,1)&&vStr(h.name,50)&&vDate(h.dueAt)
&&(h.courseId===null||vNum(h.courseId,1))&&(typeof h.done==="boolean"||typeof h.done==="number")}

backupRouter.get(
  '/',
  wrap(async (req, res) => {
    const uid = req.user.id
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      semesters: db.prepare('SELECT * FROM semester WHERE user_id = ? ORDER BY id ASC').all(uid).map(toSemester),
      periods: db.prepare('SELECT * FROM period_template WHERE user_id = ? ORDER BY semester_id ASC, period_index ASC').all(uid).map(toPeriod),
      courses: db.prepare('SELECT * FROM course WHERE user_id = ? ORDER BY id ASC').all(uid).map(toCourse),
      exams: db.prepare('SELECT * FROM exam WHERE user_id = ? ORDER BY id ASC').all(uid).map(toExam),
      homework: db.prepare('SELECT * FROM homework WHERE user_id = ? ORDER BY id ASC').all(uid).map(toHomework),
      settings: readSettings(uid),
      // 口令哈希不导出（安全要求）
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
    if (data.version !== 2 || !Array.isArray(data.semesters) || !Array.isArray(data.courses)) {
      throw badFile('备份文件版本或结构无法识别')
    }

    const restore = db.transaction(() => {
      db.exec('PRAGMA foreign_keys = OFF;')
      db.exec('PRAGMA foreign_keys = OFF')
      db.exec('DELETE FROM homework; DELETE FROM exam; DELETE FROM course; DELETE FROM period_template; DELETE FROM semester;')
      // 恢复外键由事务自动管理
      const insSem = db.prepare(
        'INSERT INTO semester (id, name, start_date, end_date, week_start_day, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const s of data.semesters ?? []) {
        if (!vSem(s)) continue
        insSem.run(s.id, s.name, s.startDate, s.endDate, s.weekStartDay, new Date().toISOString(), req.user.id)
      }
      const insPeriod = db.prepare(
        'INSERT INTO period_template (id, semester_id, user_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
      )
      for (const p of data.periods ?? []) {
        if (!vPeriod(p)) continue
        insPeriod.run(p.id, p.semesterId, req.user.id, p.index, p.startTime, p.endTime)
      }
      const insCourse = db.prepare(
        `INSERT INTO course (id, semester_id, user_id, type, name, teacher, location, color, week_type, week_list, weekday, start_period, end_period, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const c of data.courses ?? []) {
        if (!vCourse(c)) continue
        insCourse.run(
          c.id, c.semesterId, req.user.id, c.type, c.name, c.teacher, c.location, c.color, c.weekType,
          c.weekList ? JSON.stringify(c.weekList) : null,
          c.weekday, c.startPeriod, c.endPeriod, c.remark,
        )
      }
      const insExam = db.prepare(
        'INSERT INTO exam (id, semester_id, user_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const e of data.exams ?? []) {
        if (!vExam(e)) continue
        insExam.run(e.id, e.semesterId, req.user.id, e.courseId, e.name, e.datetime, e.location, e.remark)
      }
      const insHw = db.prepare(
        'INSERT INTO homework (id, semester_id, user_id, course_id, name, due_at, done, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const h of data.homework ?? []) {
        if (!vHw(h)) continue
        insHw.run(h.id, h.semesterId, req.user.id, h.courseId, h.name, h.dueAt, h.done ? 1 : 0, h.remark)
      }
      // 恢复设置（不恢复口令哈希）
      const sets = data.settings ?? {}
      const insSetting = db.prepare(
        'INSERT OR REPLACE INTO user_setting (user_id, key, value) VALUES (?, ?, ?)',
      )
      insSetting.run(req.user.id, 'show_odd_even_filter', JSON.stringify(sets.showOddEvenFilter ?? true))
      insSetting.run(req.user.id, 'reminder', JSON.stringify(sets.reminder ?? { enabled: false, mode: 'every', advanceMinutes: 10 }))
      insSetting.run(req.user.id, 'lab_reminder', JSON.stringify(sets.labReminder ?? { enabled: false, mode: 'every', advanceMinutes: 10 }))
      insSetting.run(req.user.id, 'homework_reminder', JSON.stringify(sets.homeworkReminder ?? { enabled: false, advanceDays: 2 }))
    })
    restore()

    res.json({
      restored: {
        semesters: data.semesters?.length ?? 0,
        courses: data.courses?.length ?? 0,
        exams: data.exams?.length ?? 0,
        homework: data.homework?.length ?? 0,
      },
    })
  }),
)
