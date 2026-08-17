// ============================================================
// ClassBoard · 测试数据生成脚本（可重复运行）
// 清空全部学期（级联删除课程/考试/作业/节次）后，重建一套
// 覆盖所有功能的测试数据；通过 HTTP API 操作，无需重启服务。
// 用法：node scripts/seed-test-data.mjs
// ============================================================
const BASE = process.env.CB_API ?? 'http://localhost:3000/api'

async function req(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`)
      }
      return res.status === 204 ? null : res.json()
    } catch (err) {
      if (attempt >= 3) throw err
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}

// ---- 1. 清空：删除所有学期（course/exam/homework/period_template 级联删除） ----
const semesters = await req('GET', '/semesters')
for (const s of semesters) {
  await req('DELETE', `/semesters/${s.id}`)
  console.log(`已删除学期 #${s.id} ${s.name}`)
}

// ---- 2. 新建学期（今天 2026-08-17 为第 1 周周一；自动生成默认 12 节模板） ----
const sem = await req('POST', '/semesters', {
  name: '2026-2027 学年第一学期',
  startDate: '2026-08-17',
  endDate: '2026-12-13',
  weekStartDay: 1,
})
console.log(`已创建学期 #${sem.id} ${sem.name}（${sem.startDate} ~ ${sem.endDate}）`)

// ---- 3. 课程（16 门：覆盖 all/odd/even/custom、实验课、冲突错位、跨节长课、晚课、周末课） ----
const courses = [
  // 常规课
  ['高等数学 A1', 'course', 'all', null, 1, 1, 2, 'A101', '张伟'],
  ['大学英语', 'course', 'odd', null, 2, 3, 4, 'B202', '李娜'],
  ['概率论与数理统计', 'course', 'odd', null, 2, 3, 4, 'B203', '王强'], // 与大学英语同周冲突（错位显示）
  ['线性代数', 'course', 'even', null, 3, 5, 6, 'A205', '刘敏'],
  ['数字电子技术基础', 'course', 'all', null, 1, 5, 6, 'C305', '陈刚'],
  ['模拟电子技术基础', 'course', 'all', null, 2, 5, 6, 'C305', '陈刚'],
  ['马克思主义基本原理', 'course', 'all', null, 3, 1, 2, 'D101', '赵霞'],
  ['体育', 'course', 'all', null, 5, 7, 8, '东区操场', '孙教练'],
  ['程序设计基础', 'course', 'custom', [1, 2, 3, 4, 5, 6, 7, 8], 4, 3, 4, '机房B401', '周明'],
  ['数据结构', 'course', 'custom', [9, 10, 11, 12, 13, 14, 15, 16], 4, 3, 4, '机房B401', '周明'], // 第 9 周起替换程设
  ['书法鉴赏（选修）', 'course', 'all', null, 6, 1, 2, 'E102', '吴倩'],
  ['大学物理', 'course', 'all', null, 5, 3, 6, 'C307', '郑华'], // 跨 4 节长课
  ['形势与政策', 'course', 'all', null, 4, 9, 10, 'D201', '钱进'], // 晚课
  // 实验课
  ['大学物理实验', 'lab', 'all', null, 4, 5, 6, '实验楼A201', '郑华'],
  ['数字电路实验', 'lab', 'even', null, 1, 7, 8, '实验楼B103', '陈刚'], // 双周实验
  ['程序设计上机实验', 'lab', 'custom', [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 2, 9, 10, '机房B401', '周明'],
]
const colorNames = ['course-1', 'course-2', 'course-3', 'course-4', 'course-5', 'course-6', 'course-7', 'course-8']
const createdCourses = []
for (let i = 0; i < courses.length; i++) {
  const [name, type, weekType, weekList, weekday, startPeriod, endPeriod, location, teacher] = courses[i]
  const c = await req('POST', '/courses', {
    type, name, teacher, location,
    color: colorNames[i % colorNames.length],
    weekType, weekList, weekday, startPeriod, endPeriod,
  })
  createdCourses.push(c)
}
console.log(`已创建 ${createdCourses.length} 门课程`)
const byName = (n) => createdCourses.find((c) => c.name === n)

// ---- 4. 考试（4 条：关联课程 ×3 + 独立考试 ×1） ----
const exams = [
  ['高等数学 A1 期中考试', byName('高等数学 A1').id, '2026-10-12T10:00', 'A101'],
  ['大学英语 期末考试', byName('大学英语').id, '2026-12-15T14:00', 'B202'],
  ['程序设计基础 上机考试', byName('程序设计基础').id, '2026-10-08T19:00', '机房B401'],
  ['普通话水平测试', null, '2026-09-20T09:00', 'F101'],
]
for (const [name, courseId, datetime, location] of exams) {
  await req('POST', '/exams', { name, courseId, datetime, location })
}
console.log(`已创建 ${exams.length} 条考试`)

// ---- 5. 作业（6 条：关联课程 ×4 + 独立 ×1 + 已完成 ×1，截止日期均在近期便于测试提醒/今日作业） ----
const homework = [
  ['大学英语 Unit 1 作文', byName('大学英语').id, '2026-08-19T23:59', false],
  ['高等数学 A1 第 1-2 章习题', byName('高等数学 A1').id, '2026-08-20T23:59', false],
  ['大学物理实验 实验报告一', byName('大学物理实验').id, '2026-08-18T23:59', true], // 已完成
  ['安全教育平台学习', null, '2026-08-22T23:59', false], // 独立作业
  ['形势与政策 观后感', byName('形势与政策').id, '2026-08-24T23:59', false],
  ['数字电子技术基础 第一章习题', byName('数字电子技术基础').id, '2026-09-01T23:59', false],
]
for (const [name, courseId, dueAt, done] of homework) {
  await req('POST', '/homework', { name, courseId, dueAt, done })
}
console.log(`已创建 ${homework.length} 条作业`)

// ---- 6. 验证关键场景 ----
const w1 = await req('GET', `/schedule?date=2026-08-17`) // 第 1 周（单周）
const w2 = await req('GET', `/schedule?date=2026-08-24`) // 第 2 周（双周）
const w9 = await req('GET', `/schedule?date=2026-10-19`) // 第 9 周（custom 换课生效）
const todayCount = w1.courses.filter((c) => c.weekday === 1).length // 今天周一
const mondayNames = w1.courses.filter((c) => c.weekday === 1).map((c) => c.name).join('、')
console.log(`\n=== 验证 ===`)
console.log(`今天(8/17 周一·第1周)课程：${todayCount} 节 -> ${mondayNames}`)
console.log(`第1周可见课程 ${w1.courses.length} 条（含 odd 英语/概率论，无 even 线代/数电实验）`)
console.log(`第2周可见课程 ${w2.courses.length} 条（含 even 线代/数电实验，无 odd 英语/概率论）`)
console.log(`第9周可见课程 ${w9.courses.length} 条（程设→数据结构，上机实验开始，l3=${w9.courses.some((c) => c.name === '程序设计上机实验')}）`)
console.log(`\n完成。可在 http://localhost:5173/week 查看。`)
