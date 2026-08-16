// ============================================================
// ClassBoard · Mock 数据（前端联调用）
// 课程数据基于真实样本《严子辰(2026-2027-1)课表.pdf》解析
// 学期起始日动态计算：演示时「今天」处于第 5 周
// ============================================================
import type { Course, Homework, Period, Semester } from '@/types'

/** 构建演示学期：起始日 = 今天所在周周一往前推 4 周，持续 17 周 */
export function createMockSemester(): Semester {
  const today = new Date()
  const js = today.getDay()
  const diff = js === 0 ? -6 : 1 - js
  const monday = new Date(today)
  monday.setDate(today.getDate() + diff - 28) // 前 4 周 -> 今天在第 5 周
  const start = new Date(monday)
  const end = new Date(monday)
  end.setDate(monday.getDate() + 17 * 7 - 1)
  const fmt = (d: Date): string => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return {
    id: 1,
    name: '2026-2027 学年第 1 学期',
    startDate: fmt(start),
    endDate: fmt(end),
    weekStartDay: 1,
  }
}

export const MOCK_SEMESTER: Semester = createMockSemester()

export const MOCK_PERIODS: Period[] = [
  { id: 1, semesterId: 1, index: 1, startTime: '08:00', endTime: '08:45' },
  { id: 2, semesterId: 1, index: 2, startTime: '08:55', endTime: '09:40' },
  { id: 3, semesterId: 1, index: 3, startTime: '10:00', endTime: '10:45' },
  { id: 4, semesterId: 1, index: 4, startTime: '10:55', endTime: '11:40' },
  { id: 5, semesterId: 1, index: 5, startTime: '14:00', endTime: '14:45' },
  { id: 6, semesterId: 1, index: 6, startTime: '14:55', endTime: '15:40' },
  { id: 7, semesterId: 1, index: 7, startTime: '16:00', endTime: '16:45' },
  { id: 8, semesterId: 1, index: 8, startTime: '16:55', endTime: '17:40' },
  { id: 9, semesterId: 1, index: 9, startTime: '19:00', endTime: '19:45' },
  { id: 10, semesterId: 1, index: 10, startTime: '19:55', endTime: '20:40' },
  { id: 11, semesterId: 1, index: 11, startTime: '20:50', endTime: '21:35' },
  { id: 12, semesterId: 1, index: 12, startTime: '21:45', endTime: '22:30' },
]

/** 工具：展开周次规则字符串为 weekType + weekList */
export function expandWeeks(spec: string): { weekType: 'all' | 'odd' | 'even' | 'custom'; weekList: number[] | null } {
  const s = spec.trim()
  const isOdd = s.endsWith('(单)')
  const isEven = s.endsWith('(双)')
  const clean = s.replace(/[周(单)(双)周]/g, '')
  const ranges = clean.split(',')
  const list: number[] = []
  for (const r of ranges) {
    if (r.includes('-')) {
      const [a, b] = r.split('-').map(Number)
      for (let i = a; i <= b; i++) list.push(i)
    } else if (r) {
      list.push(Number(r))
    }
  }
  if (isOdd) return { weekType: 'odd', weekList: null }
  if (isEven) return { weekType: 'even', weekList: null }
  const full = list.length === 16 && list[0] === 1 && list[15] === 16
  if (full) return { weekType: 'all', weekList: null }
  return { weekType: 'custom', weekList: list }
}

export const MOCK_COURSES: Course[] = [
  {
    id: 1, semesterId: 1, type: 'course', name: '马克思主义基本原理', teacher: '焦鑫',
    location: 'C5科教中心231', color: 'course-1', ...expandWeeks('1-15周(单)'),
    weekday: 3, startPeriod: 1, endPeriod: 2, remark: '讲课 48 学时 / 周学时 3 / 学分 3.0',
  },
  {
    id: 2, semesterId: 1, type: 'course', name: '马克思主义基本原理', teacher: '焦鑫',
    location: 'C5科教中心231', color: 'course-1', ...expandWeeks('1-16周'),
    weekday: 1, startPeriod: 3, endPeriod: 4, remark: '讲课 48 学时 / 周学时 3 / 学分 3.0',
  },
  {
    id: 3, semesterId: 1, type: 'lab', name: '微电子器件基础', teacher: '曹英男',
    location: 'C3敏学楼501', color: 'course-4', ...expandWeeks('1-10周,12周,15周'),
    weekday: 3, startPeriod: 3, endPeriod: 4, remark: '讲课 24 学时 + 实验 8 学时 / 周学时 2 / 学分 2',
  },
  {
    id: 4, semesterId: 1, type: 'course', name: '模拟集成电路设计', teacher: '骆晨',
    location: 'C3敏学楼110', color: 'course-7', ...expandWeeks('1-16周'),
    weekday: 3, startPeriod: 3, endPeriod: 4, remark: '讲课 48 学时 / 周学时 3 / 学分 3',
  },
  {
    id: 5, semesterId: 1, type: 'course', name: '模拟集成电路设计', teacher: '骆晨',
    location: 'C3敏学楼512', color: 'course-7', ...expandWeeks('1-8周'),
    weekday: 1, startPeriod: 5, endPeriod: 6, remark: '讲课 48 学时 / 周学时 3 / 学分 3',
  },
  {
    id: 6, semesterId: 1, type: 'course', name: '数字信号处理', teacher: '陈俊如',
    location: 'C5科教中心217', color: 'course-2', ...expandWeeks('1-16周'),
    weekday: 2, startPeriod: 5, endPeriod: 6, remark: '讲课 40 学时 + 实验 8 学时 / 周学时 3 / 学分 3',
  },
  {
    id: 7, semesterId: 1, type: 'course', name: '数字信号处理', teacher: '陈俊如',
    location: 'C5科教中心217', color: 'course-2', ...expandWeeks('1-7周(单)'),
    weekday: 4, startPeriod: 5, endPeriod: 6, remark: '讲课 40 学时 + 实验 8 学时 / 周学时 3 / 学分 3',
  },
  {
    id: 8, semesterId: 1, type: 'lab', name: '集成电路工艺', teacher: '黄瑞',
    location: 'C1勤学楼205', color: 'course-6', ...expandWeeks('1-8周,10-16周(双)'),
    weekday: 5, startPeriod: 5, endPeriod: 6, remark: '讲课 24 学时 + 实验 8 学时 / 周学时 2 / 学分 2',
  },
  {
    id: 9, semesterId: 1, type: 'course', name: '工程项目管理与经济决策', teacher: '汤思达',
    location: 'D4思泉楼305', color: 'course-3', ...expandWeeks('6-13周'),
    weekday: 1, startPeriod: 7, endPeriod: 8, remark: '讲课 16 学时 / 周学时 1 / 学分 1',
  },
  {
    id: 10, semesterId: 1, type: 'lab', name: 'Matlab工程应用', teacher: '陈俊如',
    location: 'C1勤学楼105', color: 'course-5', ...expandWeeks('1-15周(单)'),
    weekday: 5, startPeriod: 7, endPeriod: 8, remark: '讲课 16 学时 + 实验 16 学时 / 周学时 2 / 学分 2',
  },
  {
    id: 11, semesterId: 1, type: 'course', name: '人文地理学', teacher: '朱红霞',
    location: 'C5科教中心229', color: 'course-8', ...expandWeeks('1-16周'),
    weekday: 2, startPeriod: 9, endPeriod: 10, remark: '讲课 32 学时 / 周学时 2 / 学分 2',
  },
]

export const MOCK_HOMEWORK: Homework[] = [
  {
    id: 1, semesterId: 1, courseId: 6, name: '数字信号处理第 3 章习题',
    dueAt: '2026-09-18T23:59', done: false, remark: '课后习题 1-8 题',
  },
  {
    id: 2, semesterId: 1, courseId: 4, name: '模拟集成电路设计实验报告',
    dueAt: '2026-09-25T23:59', done: false, remark: '实验 2：差分放大器仿真',
  },
]

/** 样本中的实践课程与其他课程（PDF 第 2 页汇总行） */
export const MOCK_PRACTICE = [
  { name: '集成电路设计综合实践', teacher: '徐馨', weeks: '共16周 / 1-16周' },
  { name: '劳动实践（劳动教育）', teacher: '华云飞', weeks: '共16周 / 1-16周' },
  { name: '形势与政策', teacher: '崔锦文', weeks: '共4周 / 7-10周' },
]
