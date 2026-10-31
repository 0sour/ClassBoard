// ============================================================
// 变更记录展示文案：标题 / 对象 / 字段差异 / 能否撤销
// ============================================================
import { describe, it, expect } from 'vitest'
import { canRevert, changeRows, changeSubject, changeTimeLabel, changeTitle, isClassState } from './changes'
import type { ChangeRecord } from '@/types'

type Rec = Pick<ChangeRecord, 'entity' | 'action' | 'entityId' | 'before' | 'after'>

const rec = (over: Omit<Rec, 'entityId'> & { entityId?: number }): Rec => ({ entityId: 1, ...over })

const courseSnap = (name: string, color = 'course-1') => ({
  id: 7,
  semesterId: 2,
  type: 'course',
  name,
  teacher: '张老师',
  location: 'C5科教中心217',
  color,
  remark: '',
  sessions: [{ id: 9, weekday: 2, location: 'C5科教中心217', periods: [5, 6], weeks: [1, 2] }],
})

describe('变更记录文案', () => {
  it('标题按「实体 + 动作」给专门说法', () => {
    expect(changeTitle(rec({ entity: 'course', action: 'update', before: courseSnap('A'), after: courseSnap('B') }))).toBe('修改课程')
    expect(changeTitle(rec({ entity: 'calendar', action: 'set', before: null, after: null }))).toBe('设置日历规则')
    expect(changeTitle(rec({ entity: 'class_state', action: 'import_overwrite', before: null, after: null }))).toBe('覆盖导入课表')
    expect(changeTitle(rec({ entity: 'member', action: 'join', before: null, after: null }))).toBe('加入班级')
    // 没配过的组合退回「动作 + 实体」
    expect(changeTitle(rec({ entity: 'period', action: 'clear', before: null, after: null }))).toBe('清除节次')
  })

  it('附件：标题有专门说法、副标题取文件名、可单条撤销', () => {
    const att = { id: 3, examId: null, homeworkId: 5, name: '题目.png', mime: 'image/png', size: 2048, sha256: 'a'.repeat(64), kind: 'image' }
    expect(changeTitle(rec({ entity: 'attachment', action: 'create', before: null, after: att }))).toBe('上传附件')
    expect(changeTitle(rec({ entity: 'attachment', action: 'delete', before: att, after: null }))).toBe('删除附件')
    expect(changeSubject(rec({ entity: 'attachment', action: 'create', before: null, after: att }))).toBe('题目.png')
    expect(canRevert(rec({ entity: 'attachment', action: 'delete', before: att, after: null }))).toBe(true)
  })

  it('作业 / 考试的附件变化不摊进字段差异（附件有自己的记录）', () => {
    const hw = (attachments: unknown[]) => ({ id: 5, semesterId: 2, courseId: null, name: '第三章习题', dueAt: '2026-10-20T22:00', remark: '', attachments })
    const rows = changeRows(
      rec({ entity: 'homework', action: 'update', before: hw([]), after: hw([{ id: 3, name: '题目.png' }]) }),
    )
    expect(rows).toEqual([])
  })

  it('副标题取对象名字；整班快照取「学校 · 班级」', () => {
    expect(changeSubject(rec({ entity: 'course', action: 'update', before: courseSnap('A'), after: courseSnap('B') }))).toBe('B')
    expect(changeSubject(rec({ entity: 'notice', action: 'update', before: { title: '旧' }, after: { title: '新' } }))).toBe('新')
    expect(
      changeSubject(rec({ entity: 'class_state', action: 'delete', before: { school: '示例大学', name: '示例2301', semesters: [] }, after: null })),
    ).toBe('示例大学 · 示例2301')
  })

  it('改课程：只列真正变了的字段，值翻成人话', () => {
    const rows = changeRows(rec({ entity: 'course', action: 'update', before: courseSnap('数字信号处理'), after: courseSnap('数字信号处理（改）', 'course-3') }))
    expect(rows.map((r) => r.label)).toEqual(['课程名', '配色'])
    expect(rows[0]).toEqual({ label: '课程名', from: '数字信号处理', to: '数字信号处理（改）' })
    expect(rows[1]).toEqual({ label: '配色', from: 'course-1', to: 'course-3' })
  })

  it('改节次 / 日期 / 类型都翻成中文，空值显示「（空）」', () => {
    const rows = changeRows(
      rec({
        entity: 'period',
        action: 'update',
        before: { id: 3, index: 1, startTime: '08:00', endTime: '08:45' },
        after: { id: 3, index: 1, startTime: '08:05', endTime: '08:45' },
      }),
    )
    expect(rows).toEqual([{ label: '开始', from: '08:00', to: '08:05' }])

    const semi = changeRows(
      rec({
        entity: 'semester',
        action: 'update',
        before: { id: 2, name: '旧名', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 7 },
        after: { id: 2, name: '新名', startDate: '2026-09-01', endDate: '2027-01-15', weekStartDay: 1 },
      }),
    )
    expect(semi.map((r) => `${r.label}:${r.from}→${r.to}`)).toEqual(['学期名:旧名→新名', '每周起始日:周日→周一'])

    const adj = changeRows(
      rec({
        entity: 'adjustment',
        action: 'update',
        before: { id: 5, kind: 'move', date: '2026-10-17', fromPeriods: [3, 4], toDate: '2026-10-13', periods: [5, 6] },
        after: { id: 5, kind: 'cancel', date: '2026-10-17', fromPeriods: [3, 4], toDate: null, periods: [] },
      }),
    )
    expect(adj.map((r) => `${r.label}:${r.from}→${r.to}`)).toEqual(['类型:调课→停课', '调到:10月13日（周二）→（空）', '新节次:第 5–6 节→（空）'])
  })

  it('新增 / 删除只给一行', () => {
    expect(changeRows(rec({ entity: 'homework', action: 'create', before: null, after: { id: 1, name: '作业一' } }))).toEqual([
      { label: '新增', from: '—', to: '作业一' },
    ])
    expect(changeRows(rec({ entity: 'exam', action: 'delete', before: { id: 2, name: '期中' }, after: null }))).toEqual([
      { label: '删除', from: '期中', to: '—' },
    ])
  })

  it('整班级操作只给概要；日历记录报规则条数', () => {
    const stateA = { id: 2, school: '示例大学', name: '示例2301', semesters: [], courses: [], adjustments: [] }
    const stateB = { id: 2, school: '示例大学', name: '示例2301', semesters: [{}], courses: [{}, {}], adjustments: [{}] }
    expect(isClassState(stateB)).toBe(true)
    expect(changeRows(rec({ entity: 'class_state', action: 'import_overwrite', before: stateA, after: stateB }))).toEqual([
      { label: '班级数据', from: '0 个学期 / 0 门课 / 0 条调整', to: '1 个学期 / 2 门课 / 1 条调整' },
    ])

    const withRules = (n: number, otherSemester = 0) => ({
      ...stateA,
      dayRules: [
        ...Array.from({ length: n }, () => ({ semesterId: 2 })),
        ...Array.from({ length: otherSemester }, () => ({ semesterId: 9 })),
      ],
    })
    const rows = changeRows(rec({ entity: 'calendar', action: 'set', entityId: 2, before: withRules(1, 3), after: withRules(2, 3) }))
    expect(rows).toEqual([{ label: '本学期的日历规则', from: '1 条', to: '2 条' }])
  })

  it('可撤销判定：整班级操作与回退记录不给撤销按钮', () => {
    expect(canRevert(rec({ entity: 'course', action: 'update', before: {}, after: {} }))).toBe(true)
    expect(canRevert(rec({ entity: 'calendar', action: 'set', before: null, after: null }))).toBe(true)
    expect(canRevert(rec({ entity: 'class_state', action: 'delete', before: null, after: null }))).toBe(false)
    expect(canRevert(rec({ entity: 'user', action: 'approve', before: null, after: null }))).toBe(false)
    expect(canRevert(rec({ entity: 'course', action: 'revert', before: null, after: null }))).toBe(false)
  })

  it('审计字段不进 diff；调整 / 考试用关联课程名当副标题', () => {
    const rows = changeRows(
      rec({
        entity: 'class',
        action: 'update',
        entityId: 2,
        before: { id: 2, school: '', name: 'admin', major: '', city: '', current_semester_id: 4, created_by: 2, created_at: 'T1', updated_at: 'T1' },
        after: { id: 2, school: '示例大学', name: '示例2301', major: '', city: '示例市', current_semester_id: 4, created_by: 2, created_at: 'T1', updated_at: 'T2' },
      }),
    )
    expect(rows.map((r) => r.label)).toEqual(['学校', '班级名', '城市'])

    const opts = { courseName: (id: number) => (id === 158 ? '微电子器件基础' : '') }
    const adj = rec({ entity: 'adjustment', action: 'update', entityId: 5, before: { id: 5, courseId: 158, note: '旧' }, after: { id: 5, courseId: 158, note: '新' } })
    expect(changeSubject(adj, opts)).toBe('微电子器件基础')
    expect(changeRows(adj, opts)).toEqual([{ label: '备注', from: '旧', to: '新' }])

    const exam = rec({ entity: 'exam', action: 'create', before: null, after: { id: 3, courseId: 158, name: '期中考试' } })
    expect(changeRows(exam, opts)).toEqual([{ label: '新增', from: '—', to: '期中考试' }])
    const examNoName = rec({ entity: 'exam', action: 'update', entityId: 3, before: { id: 3, courseId: null }, after: { id: 3, courseId: 158 } })
    expect(changeRows(examNoName, opts)).toEqual([{ label: '关联课程', from: '（空）', to: '微电子器件基础' }])
    expect(changeRows(examNoName, {})).toEqual([{ label: '关联课程', from: '（空）', to: '课程 #158' }])
  })

  it('时间文案：今天只显示时分', () => {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const iso = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T09:05:00`
    expect(changeTimeLabel(iso)).toBe('今天 09:05')
    expect(changeTimeLabel('2026-10-12T15:30:00')).toContain('10月12日')
  })
})
