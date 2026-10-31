// ============================================================
// ClassBoard · 变更记录的展示文案（纯函数，时间线 / 课程历史 / 通知历史共用）
//   「改了哪些字段」在这里翻译成人话：字段名 → 中文标签，值 → 可读文案。
//   整班级操作（删学期 / 导入 / 日历 / 删班）before/after 存的是整班快照，
//   这里只给概要，绝不把整份快照摊在界面上。
// ============================================================
import type { ChangeRecord } from '@/types'
import { periodsLabel } from './session'
import { dateWithWeekdayLabel, monthDayLabel } from './calendar'

/** 动作 → 中文（按实体在下面覆盖更精确的说法） */
const ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
  set: '设置',
  clear: '清除',
  join: '加入',
  leave: '退出',
  approve: '通过申请',
  reject: '拒绝申请',
  reset_password: '重置密码',
  import_append: '追加导入',
  import_overwrite: '覆盖导入',
  revert: '撤销',
  rollback: '整班回退',
  delete_orphan_class: '删除无人的班级',
}

const ENTITY_LABELS: Record<string, string> = {
  class: '班级资料',
  class_state: '班级整体',
  member: '负责人',
  semester: '学期',
  period: '节次',
  course: '课程',
  exam: '考试',
  homework: '作业',
  attachment: '附件',
  adjustment: '单课调整',
  notice: '通知',
  calendar: '学期日历',
  day_rule: '日历规则',
  user: '账号',
}

/** 少数「实体 + 动作」组合有专门说法 */
const SPECIAL_TITLES: Record<string, string> = {
  'class:create': '创建班级',
  'class:update': '修改班级资料',
  'course:create': '新增课程',
  'course:update': '修改课程',
  'course:delete': '删除课程',
  'semester:create': '新建学期',
  'semester:update': '修改学期',
  'semester:delete': '删除学期',
  'period:create': '添加节次',
  'period:update': '修改节次时间',
  'exam:create': '发布考试',
  'homework:create': '发布作业',
  'attachment:create': '上传附件',
  'attachment:delete': '删除附件',
  'adjustment:create': '登记调整',
  'adjustment:update': '修改调整',
  'adjustment:delete': '撤销调整',
  'notice:create': '发布通知',
  'notice:update': '修改通知',
  'notice:delete': '删除通知',
  'calendar:set': '设置日历规则',
  'calendar:clear': '清除日历规则',
  'member:join': '加入班级',
  'member:leave': '退出班级',
  'class_state:leave': '退出班级',
  'class_state:delete': '删除班级',
  'class_state:import_append': '追加导入课表',
  'class_state:import_overwrite': '覆盖导入课表',
  'class_state:rollback': '整班回退',
  'class_state:delete_orphan_class': '删除无人的班级',
  'user:approve': '通过注册申请',
  'user:reject': '拒绝注册申请',
  'user:create': '新建账号',
  'user:update': '修改账号',
  'user:reset_password': '重置密码',
  'user:delete': '删除账号',
  'class:revert': '撤销',
  'course:revert': '撤销',
  'notice:revert': '撤销',
  'calendar:revert': '撤销',
}

/** 实体 → 字段标签 */
const FIELD_LABELS: Record<string, Record<string, string>> = {
  course: { name: '课程名', type: '类型', teacher: '教师', location: '地点', color: '配色', remark: '备注', sessions: '上课时间' },
  semester: { name: '学期名', startDate: '起始日', endDate: '结束日', weekStartDay: '每周起始日' },
  period: { index: '第几节', startTime: '开始', endTime: '结束' },
  exam: { name: '考试名', datetime: '时间', location: '地点', courseId: '关联课程', remark: '备注' },
  homework: { name: '作业名', dueAt: '截止时间', courseId: '关联课程', remark: '备注' },
  adjustment: { kind: '类型', date: '原日期', fromPeriods: '原节次', toDate: '调到', periods: '新节次', location: '地点', note: '备注' },
  notice: { title: '标题', date: '日期', body: '正文', pinned: '置顶', courseId: '关联课程' },
  class: { school: '学校', name: '班级名', major: '专业', city: '城市', current_semester_id: '当前学期' },
  day_rule: { date: '原日期', kind: '类型', toDate: '移到的日子', note: '备注' },
  user: { username: '用户名', role: '角色', status: '状态', disabled: '禁用', review_note: '审核理由' },
  attachment: { name: '文件名', mime: '类型', size: '大小' },
  member: { userId: '账号' },
}

/** 这些键不进 diff：主键 / 外键归属 / 审计时间戳（记录里是数据库原样行） */
const SKIP_KEYS = new Set([
  'id',
  'class_id',
  'semester_id',
  'current_semester_id',
  'author_id',
  'created_by',
  'created_at',
  'updated_at',
  'createdAt',
  'updatedAt',
  'revert_of',
  'refs',
  // 作业 / 考试的附件变化有自己的记录，不摊进对象的字段差异里
  'attachments',
])

/** 关联课程的展示：给了查名函数就显示课名（没有就只显示编号） */
export interface DiffOptions {
  courseName?: (id: number) => string
}

/** 值 → 可读文案（null / 空串 显示成「（空）」） */
function valueText(key: string, v: unknown, opts: DiffOptions): string {
  if (v === null || v === undefined || v === '') return '（空）'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (Array.isArray(v)) {
    if (!v.length) return '（空）'
    if (v.every((x) => typeof x === 'number')) return periodsLabel(v as number[])
    return `${v.length} 项`
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    // 上课时间组：周几 + 节次 + 地点
    if ('weekday' in obj && 'periods' in obj) {
      const wd = ['一', '二', '三', '四', '五', '六', '日'][Number(obj.weekday) - 1] ?? '?'
      const loc = obj.location ? ` · ${obj.location}` : ''
      return `周${wd} ${periodsLabel((obj.periods as number[]) ?? [])}${loc}`
    }
    const count = Object.keys(obj).length
    return count ? `（${count} 项）` : '（空）'
  }
  if (key === 'date' || key === 'toDate' || key === 'startDate' || key === 'endDate') {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dateWithWeekdayLabel(v) : String(v)
  }
  if (key === 'weekStartDay') return v === 7 ? '周日' : '周一'
  if (key === 'kind') {
    return (
      { cancel: '停课', move: '调课', extra: '补课', shift: '调休', holiday: '放假' }[String(v)] ?? String(v)
    )
  }
  if (key === 'type') return v === 'lab' ? '实验课' : '理论课'
  if (key === 'courseId') {
    const id = Number(v)
    const name = opts.courseName?.(id)
    return name ? `${name}` : `课程 #${id}`
  }
  if (key === 'role') return v === 'admin' ? '管理员' : '班级负责人'
  if (key === 'status') return { pending: '待审核', active: '正常', rejected: '已拒绝' }[String(v)] ?? String(v)
  return String(v)
}

/** 是不是整班快照（整班级操作的记录里 before / after 都是这个） */
export function isClassState(v: unknown): boolean {
  return !!v && typeof v === 'object' && Array.isArray((v as { semesters?: unknown }).semesters)
}

export interface DiffRow {
  label: string
  from: string
  to: string
}

/** 记录标题：'修改课程'；撤销 / 回退记录带上「被撤销的那条」是什么 */
export function changeTitle(
  c: Pick<ChangeRecord, 'entity' | 'action' | 'before' | 'after'>,
  opts: { targetTitle?: string } = {},
): string {
  if (c.action === 'revert') return opts.targetTitle ? `撤销：${opts.targetTitle}` : '撤销'
  if (c.action === 'rollback') return opts.targetTitle ? `整班回退到：${opts.targetTitle}` : '整班回退'
  const special = SPECIAL_TITLES[`${c.entity}:${c.action}`]
  if (special) return special
  const entity = ENTITY_LABELS[c.entity] ?? c.entity
  const action = ACTION_LABELS[c.action] ?? c.action
  return `${action}${entity}`
}

/** 记录副标题：对象名字（课程名 / 标题 / 学期名…） */
export function changeSubject(
  c: Pick<ChangeRecord, 'entity' | 'action' | 'before' | 'after'>,
  opts: DiffOptions = {},
): string {
  // 撤销 / 回退记录的标题已经点明了对象，副标题不再重复班级名
  if (c.action === 'revert' || c.action === 'rollback') return ''
  const snap = (c.after ?? c.before) as Record<string, unknown> | null
  if (!snap || typeof snap !== 'object') return ''
  if (isClassState(snap)) {
    const s = snap as { school?: string; name?: string }
    return s.school && s.name ? `${s.school} · ${s.name}` : ''
  }
  const name = snap.name ?? snap.title ?? snap.username
  if (typeof name === 'string') return name
  // 调整 / 考试 / 作业没有自己的名字：用关联课程名当副标题
  const cid = snap.courseId ?? snap.course_id
  if (typeof cid === 'number') return opts.courseName?.(cid) ?? `课程 #${cid}`
  return ''
}

/** 字段级差异：整班快照只给概要，普通实体逐字段列 */
export function changeRows(
  c: Pick<ChangeRecord, 'entity' | 'entityId' | 'action' | 'before' | 'after'>,
  opts: DiffOptions = {},
): DiffRow[] {
  // 撤销 / 回退：before → after 是整班快照，对用户没意义，不给展开
  if (c.action === 'revert' || c.action === 'rollback') return []
  const before = (c.before ?? null) as Record<string, unknown> | null
  const after = (c.after ?? null) as Record<string, unknown> | null

  // 整班级操作：before / after 是整班快照 → 只报概要，不摊开
  if (isClassState(before) || isClassState(after)) {
    if (c.entity === 'calendar') {
      const countRules = (s: unknown): number => {
        if (!s || typeof s !== 'object') return 0
        const rules = (s as { dayRules?: { semesterId?: number }[] }).dayRules ?? []
        return rules.filter((r) => (r.semesterId ?? null) === (c.entityId ?? null)).length
      }
      return [{ label: '本学期的日历规则', from: `${countRules(before)} 条`, to: `${countRules(after)} 条` }]
    }
    const brief = (s: unknown): string => {
      if (!s || typeof s !== 'object') return '（不存在）'
      const o = s as { semesters?: unknown[]; courses?: unknown[]; adjustments?: unknown[] }
      return `${o.semesters?.length ?? 0} 个学期 / ${o.courses?.length ?? 0} 门课 / ${o.adjustments?.length ?? 0} 条调整`
    }
    return [{ label: '班级数据', from: brief(before), to: brief(after) }]
  }

  if (c.action === 'create') {
    return [{ label: '新增', from: '—', to: changeSubject(c, opts) || '（已创建）' }]
  }
  if (c.action === 'delete' || (before && !after)) {
    return [{ label: '删除', from: changeSubject(c, opts) || '（已删除）', to: '—' }]
  }
  if (!before || !after) return []

  const labels = FIELD_LABELS[c.entity] ?? {}
  const rows: DiffRow[] = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (SKIP_KEYS.has(key)) continue
    const a = before[key]
    const b = after[key]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    rows.push({ label: labels[key] ?? key, from: valueText(key, a, opts), to: valueText(key, b, opts) })
  }
  return rows
}

/** 这条记录能不能单条撤销（整班级操作只能整班回退） */
export function canRevert(c: Pick<ChangeRecord, 'entity' | 'action'>): boolean {
  if (c.action === 'revert' || c.action === 'rollback') return false
  return [
    'class',
    'member',
    'semester',
    'period',
    'course',
    'exam',
    'homework',
    'adjustment',
    'notice',
    'day_rule',
    'calendar',
    'attachment',
  ].includes(c.entity)
}

/** '10月14日 19:20' */
export function changeTimeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  if (sameDay) return `今天 ${hm}`
  return `${monthDayLabel(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)} ${hm}`
}
