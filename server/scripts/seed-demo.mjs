// ============================================================
// ClassBoard · 示例数据（用于 README 截图 / 本地演示，绝不含真实数据）
//   用法：
//     CLASSBOARD_DATA_DIR=/path/to/demo node scripts/seed-demo.mjs --yes
//   说明：
//     * 只在「目标库为空（class 表没有任何行）」时写入，避免误伤真实数据
//     * 生成：示例账号 demo/demo123456（管理员）、班级「示例大学 · 示例 2301」、
//       一个学期 + 12 节模板 + 10 门课（含实验课与单双周）+ 国庆调休 + 停课/调课/补课
//       + 一条「调休 → 调课 → 再调课」的链式调整 + 通知 / 考试 / 作业
//     * 数据全部虚构；学期日期对齐真实日历（2026-09-07 开学，今天 10-14 为第 6 周），
//       这样课表截图有「本周/今天」的自然上下文
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const dataDir = process.env.CLASSBOARD_DATA_DIR
if (!dataDir) {
  console.error('[中止] 需要显式指定 CLASSBOARD_DATA_DIR（示例数据也只写进专门的目录）')
  process.exit(1)
}
if (!process.argv.includes('--yes')) {
  console.error('[中止] 传入 --yes 确认写入：会在空目录里建库；目录里已有数据的库会被拒绝')
  process.exit(1)
}

mkdirSync(dataDir, { recursive: true })
const { db } = await import('../lib/db.js')
const { hashPassword } = await import('../lib/access.js')

// ---- 安全闸门：目标库必须没有任何班级 ----
const existing = db.prepare('SELECT COUNT(*) AS c FROM class').get().c
if (existing > 0) {
  console.error(`[中止] ${resolve(dataDir)} 里已有 ${existing} 个班级——拒绝写入（这是保护真实数据的闸门）`)
  process.exit(1)
}

const now = new Date().toISOString()

const seed = db.transaction(() => {
  // ---- 账号：demo / demo123456（管理员，便于演示全部功能）----
  // 清掉空库自动建出的占位账号，只留 demo
  db.prepare('DELETE FROM user').run()
  db.prepare('DELETE FROM session').run()
  const demoId = db
    .prepare(
      `INSERT INTO user (username, password_hash, role, status, school, major, claimed_class, created_at)
       VALUES (?, ?, 'admin', 'active', '示例大学', '计算机科学与技术', '示例 2301', ?)`,
    )
    .run('demo', hashPassword('demo123456'), now).lastInsertRowid

  // ---- 班级 ----
  const classId = db
    .prepare(
      `INSERT INTO class (school, name, major, city, created_by, created_at, updated_at)
       VALUES ('示例大学', '示例 2301', '计算机科学与技术', '北京', ?, ?, ?)`,
    )
    .run(demoId, now, now).lastInsertRowid
  db.prepare('INSERT INTO class_member (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(classId, demoId, now)

  // ---- 学期（2026-09-07 开学；今天 10-14 在第 6 周）+ 12 节模板 ----
  const semId = db
    .prepare(
      `INSERT INTO semester (class_id, name, start_date, end_date, week_start_day, updated_at)
       VALUES (?, '2026-2027 学年第一学期', '2026-09-07', '2027-01-15', 1, ?)`,
    )
    .run(classId, now).lastInsertRowid
  db.prepare('UPDATE class SET current_semester_id = ? WHERE id = ?').run(semId, classId)

  const periodTimes = [
    ['08:00', '08:45'], ['08:55', '09:40'], ['10:10', '10:55'], ['11:05', '11:50'],
    ['13:45', '14:30'], ['14:40', '15:25'], ['15:55', '16:40'], ['16:50', '17:35'],
    ['18:45', '19:30'], ['19:40', '20:25'], ['20:35', '21:20'], ['21:45', '22:30'],
  ]
  const insPeriod = db.prepare(
    'INSERT INTO period_template (semester_id, period_index, start_time, end_time) VALUES (?, ?, ?, ?)',
  )
  periodTimes.forEach(([s, e], i) => insPeriod.run(semId, i + 1, s, e))

  // ---- 课程（全部虚构；含实验课与单双周）----
  const insCourse = db.prepare(
    'INSERT INTO course (semester_id, type, name, teacher, location, color, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insSession = db.prepare('INSERT INTO course_session (course_id, weekday, location) VALUES (?, ?, ?)')
  const insSlot = db.prepare('INSERT INTO course_slot (session_id, period, week) VALUES (?, ?, ?)')

  /** weeks: [起, 止] 闭区间；oddOnly/evenOnly 过滤奇偶周 */
  const addCourse = ({ type = 'course', name, teacher, location, color, remark = '', sessions }) => {
    const cid = insCourse.run(semId, type, name, teacher, location, color, remark).lastInsertRowid
    for (const s of sessions) {
      const sid = insSession.run(cid, s.weekday, s.location ?? location).lastInsertRowid
      let weeks = []
      for (let w = s.weeks[0]; w <= s.weeks[1]; w++) weeks.push(w)
      if (s.oddOnly) weeks = weeks.filter((w) => w % 2 === 1)
      if (s.evenOnly) weeks = weeks.filter((w) => w % 2 === 0)
      for (const p of s.periods) for (const w of weeks) insSlot.run(sid, p, w)
    }
    return cid
  }

  const cMath = addCourse({ name: '高等数学（上）', teacher: '张明', location: '一教 A201', color: 'course-1', sessions: [{ weekday: 1, periods: [1, 2], weeks: [1, 16] }] })
  const cEnglish = addCourse({ name: '大学英语（三）', teacher: '李静', location: '文科楼 302', color: 'course-2', sessions: [{ weekday: 2, periods: [3, 4], weeks: [1, 16] }] })
  const cLinear = addCourse({ name: '线性代数', teacher: '王强', location: '一教 A305', color: 'course-3', sessions: [{ weekday: 3, periods: [3, 4], weeks: [1, 16] }] })
  const cProg = addCourse({ name: '程序设计基础', teacher: '陈晨', location: '机房 B101', color: 'course-4', sessions: [{ weekday: 3, periods: [7, 8], weeks: [1, 16], evenOnly: true }] })
  const cDs = addCourse({ name: '数据结构', teacher: '刘芳', location: '二教 208', color: 'course-5', remark: '周一讲理论，周四上机（前 8 周）', sessions: [
    { weekday: 1, periods: [5, 6], weeks: [1, 16] },
    { weekday: 4, periods: [5, 6], weeks: [1, 8] },
  ] })
  addCourse({ type: 'lab', name: '数据结构实验', teacher: '刘芳', location: '机房 B205', color: 'course-6', remark: '第 11–14 周，每次 2 学时', sessions: [{ weekday: 4, periods: [9, 10], weeks: [11, 14] }] })
  const cNet = addCourse({ name: '计算机网络', teacher: '赵磊', location: '二教 401', color: 'course-7', sessions: [{ weekday: 5, periods: [1, 2], weeks: [1, 16] }] })
  const cPhys = addCourse({ name: '大学物理', teacher: '孙华', location: '理科楼 110', color: 'course-8', sessions: [{ weekday: 2, periods: [7, 8], weeks: [1, 16] }] })
  addCourse({ name: '体育（网球）', teacher: '周勇', location: '体育馆', color: 'course-1', sessions: [{ weekday: 5, periods: [5, 6], weeks: [1, 16] }] })
  addCourse({ name: '思想道德与法治', teacher: '吴敏', location: '一教 A101', color: 'course-2', sessions: [{ weekday: 3, periods: [9, 10], weeks: [1, 16], oddOnly: true }] })

  // ---- 学期日历：国庆放假 + 整日移课（10月9日 → 10月17日）----
  const insRule = db.prepare(
    'INSERT INTO semester_day_rule (semester_id, date, kind, to_date, note) VALUES (?, ?, ?, ?, ?)',
  )
  for (let d = 1; d <= 7; d++) insRule.run(semId, `2026-10-0${d}`, 'holiday', null, '国庆节')
  insRule.run(semId, '2026-10-09', 'shift', '2026-10-17', '国庆调休')

  // ---- 单课调整：停课 / 调课（今天）/ 补课 + 一条「两跳」链式调课 ----
  const insAdj = db.prepare(
    `INSERT INTO course_adjustment (course_id, date, kind, from_weekday, from_periods, to_date, periods, location, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
  )
  insAdj.run(cNet, '2026-10-16', 'cancel', 5, '[1,2]', null, '[]', '全校课程调整', now)
  insAdj.run(cLinear, '2026-10-14', 'move', 3, '[3,4]', '2026-10-16', '[7,8]', '教师培训', now)
  insAdj.run(cPhys, '2026-10-17', 'extra', null, '[]', null, '[9,10]', '国庆假期补课', now)
  insAdj.run(cDs, '2026-10-15', 'move', 4, '[5,6]', '2026-10-17', '[3,4]', '实验室占用', now)
  insAdj.run(cDs, '2026-10-17', 'move', 6, '[3,4]', '2026-10-18', '[1,2]', '再顺延一天', now)

  // ---- 通知（置顶一条 + 两条常规）----
  const insNotice = db.prepare(
    `INSERT INTO notice (class_id, date, title, body, course_id, pinned, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insNotice.run(classId, '2026-10-09', '国庆调休：10月9日（周五）的课移到 10月17日（周六）',
    '按学校统一安排，10月9日的课程调整至 10月17日（周六）原节次补上，课表已同步更新。', null, 1, demoId, now, now)
  insNotice.run(classId, '2026-10-12', '本周三《线性代数》时间调整',
    '因教师培训，10月14日（周三）第 3–4 节的《线性代数》调至 10月16日（周五）第 7–8 节。', cLinear, 0, demoId, now, now)
  insNotice.run(classId, '2026-10-13', '《数据结构》实验报告提交提醒',
    '第 1 次实验报告请于下周一前提交到实验平台，逾期不计分。', cDs, 0, demoId, now, now)

  // ---- 考试与作业 ----
  const insExam = db.prepare(
    'INSERT INTO exam (semester_id, course_id, name, datetime, location, remark) VALUES (?, ?, ?, ?, ?, ?)',
  )
  insExam.run(semId, cMath, '高等数学（上）· 期中考试', '2026-11-05T09:00', '一教 A201', '闭卷')
  insExam.run(semId, cEnglish, '大学英语（三）· 期中考试', '2026-11-12T14:00', '文科楼 302', '含听力')

  const insHw = db.prepare('INSERT INTO homework (semester_id, course_id, name, due_at, remark) VALUES (?, ?, ?, ?, ?)')
  insHw.run(semId, cDs, '习题 3.1–3.5', '2026-10-16T23:59', '第 3 章课后题')
  insHw.run(semId, cEnglish, '作文：My Hometown', '2026-10-18T20:00', '不少于 200 词')
  insHw.run(semId, cProg, '实验报告（第 1 次）', '2026-10-19T12:00', '提交到实验平台')

  // ---- 设置：保留单双周过滤 ----
  db.prepare("INSERT OR REPLACE INTO user_setting (user_id, key, value) VALUES (?, 'show_odd_even_filter', 'true')").run(demoId)
})

seed()

// 报告
const counts = {
  classes: db.prepare('SELECT COUNT(*) AS c FROM class').get().c,
  users: db.prepare('SELECT COUNT(*) AS c FROM user').get().c,
  courses: db.prepare('SELECT COUNT(*) AS c FROM course').get().c,
  slots: db.prepare('SELECT COUNT(*) AS c FROM course_slot').get().c,
  rules: db.prepare('SELECT COUNT(*) AS c FROM semester_day_rule').get().c,
  adjustments: db.prepare('SELECT COUNT(*) AS c FROM course_adjustment').get().c,
  notices: db.prepare('SELECT COUNT(*) AS c FROM notice').get().c,
  exams: db.prepare('SELECT COUNT(*) AS c FROM exam').get().c,
  homework: db.prepare('SELECT COUNT(*) AS c FROM homework').get().c,
}
writeFileSync(resolve(dataDir, 'seed-demo.log'), JSON.stringify({ dataDir, counts }, null, 2))
console.log('[完成] 示例数据已写入：', resolve(dataDir))
console.log(JSON.stringify(counts))
console.log('账号：demo / demo123456（管理员）')
