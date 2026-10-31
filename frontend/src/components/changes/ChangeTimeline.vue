<script setup lang="ts">
// ============================================================
// ClassBoard · 变更记录时间线（设置页面板与各对象「历史」弹窗共用）
//   列表：谁 / 什么时候 / 动了什么（字段级 diff）/ 撤销 / 回退到这里
//   撤销：只对该对象的一条记录生效；之后又被改过 → 服务端 409，把冲突列出来
//   回退：整班回到某条记录那一刻（会丢掉其后的改动，先列给你看）
// ============================================================
import { computed, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { api } from '@/api/client'
import { confirm, toast } from '@/utils/ui'
import { canRevert, changeRows, changeSubject, changeTimeLabel, changeTitle } from '@/utils/changes'
import type { ChangeRecord } from '@/types'

const props = withDefaults(
  defineProps<{
    /** 数据源：班级时间线（className 展示）或全站时间线（管理员） */
    scope?: 'class' | 'site'
    /** 固定筛选（对象「历史」入口用）：只列这个实体的记录 */
    entity?: string
    entityId?: number
    /** 紧凑模式（弹窗内）：不显示筛选条与回退 */
    compact?: boolean
  }>(),
  { scope: 'class', entity: '', entityId: undefined, compact: false },
)

const store = useScheduleStore()

/** 撤销 / 回退记录：找出被它撤销的那条，标题里点明 */
function targetTitleOf(row: ChangeRecord): string | undefined {
  if (!row.revertOf) return undefined
  const target = rows.value.find((r) => r.id === row.revertOf)
  if (!target) return undefined
  const subject = changeSubject(target, diffOpts)
  return subject ? `${changeTitle(target)}（${subject}）` : changeTitle(target)
}

/** 关联课程 id → 课名（调整 / 考试 / 作业这些记录自己不带名字） */
const diffOpts = { courseName: (id: number) => store.courses.find((c) => c.id === id)?.name ?? '' }

const rows = ref<ChangeRecord[]>([])
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const errorText = ref('')

/** 筛选（班级视角：实体 + 只看我；全站视角：班级 + 操作人） */
const filterEntity = ref('')
const filterMine = ref(false)
const filterClassId = ref<number | null>(null)
const filterActor = ref('')
/** 全站视角的班级下拉（接口随列表一起返回） */
const siteClasses = ref<{ id: number; name: string }[]>([])

const ENTITY_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'course', label: '课程' },
  { value: 'adjustment', label: '单课调整' },
  { value: 'calendar', label: '学期日历' },
  { value: 'semester', label: '学期' },
  { value: 'period', label: '节次' },
  { value: 'exam', label: '考试' },
  { value: 'homework', label: '作业' },
  { value: 'attachment', label: '附件' },
  { value: 'notice', label: '通知' },
  { value: 'class', label: '班级资料' },
  { value: 'member', label: '负责人' },
  { value: 'class_state', label: '整班操作' },
]

const PAGE = 50

function queryOf(cursor?: number) {
  if (props.scope === 'site') {
    return {
      classId: filterClassId.value ?? undefined,
      actor: filterActor.value.trim() || undefined,
      entity: filterEntity.value || undefined,
      before: cursor,
      limit: PAGE,
    }
  }
  return {
    entity: props.entity || filterEntity.value || undefined,
    entityId: props.entityId,
    actorId: filterMine.value ? (store.currentUser?.id ?? undefined) : undefined,
    before: cursor,
    limit: PAGE,
  }
}

async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''
  try {
    if (props.scope === 'site') {
      const data = await api.listAllChanges(queryOf())
      rows.value = data.changes
      siteClasses.value = data.classes ?? []
    } else {
      const classId = store.currentClassId
      if (!classId) {
        rows.value = []
        total.value = 0
        return
      }
      const data = await api.listChanges(classId, queryOf())
      rows.value = data.changes
      total.value = data.total ?? data.changes.length
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '读取变更记录失败'
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  const cursor = rows.value[rows.value.length - 1]?.id
  if (!cursor) return
  loadingMore.value = true
  try {
    if (props.scope === 'site') {
      const data = await api.listAllChanges(queryOf(cursor))
      rows.value = [...rows.value, ...data.changes]
    } else {
      const data = await api.listChanges(store.currentClassId as number, queryOf(cursor))
      rows.value = [...rows.value, ...data.changes]
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '加载失败', 'error')
  } finally {
    loadingMore.value = false
  }
}

watch(
  () => [props.scope, props.entity, props.entityId, store.currentClassId, filterEntity.value, filterMine.value, filterClassId.value, filterActor.value],
  () => void load(),
  { immediate: true },
)

/** 冲突记录（服务端 409 返回的明细） */
const conflictsOf = ref<Record<number, ChangeRecord[]>>({})

async function revert(row: ChangeRecord): Promise<void> {
  const ok = await confirm({
    title: '撤销这一条？',
    desc: `${changeTitle(row)}：${changeSubject(row) || ''}——会把该对象恢复成这条记录改动之前的样子，并留下一条「撤销」记录。`,
    danger: true,
    confirmText: '撤销',
  })
  if (!ok) return
  try {
    await api.revertChange(row.id)
    delete conflictsOf.value[row.id]
    toast('已撤销这一条', 'success')
    await store.refreshSchedule()
    await load()
  } catch (e) {
    const err = e as Error & { payload?: { conflicts?: ChangeRecord[] } }
    const conflicts = err.payload?.conflicts
    if (conflicts?.length) {
      conflictsOf.value = { ...conflictsOf.value, [row.id]: conflicts }
      toast('这条之后同一对象又被改过，撤销会盖掉它——先看清下面列出的记录', 'error')
    } else {
      toast(err.message || '撤销失败，请重试', 'error')
    }
  }
}

async function rollback(row: ChangeRecord): Promise<void> {
  const classId = store.currentClassId
  if (!classId) return
  const ok = await confirm({
    title: `整班回退到「${changeTimeLabel(row.createdAt)} 的${changeTitle(row)}」？`,
    desc: '班级会回到那一刻的样子：学期、课表、日历、调整、通知都一起回退；这之后的所有改动会被丢掉（记录仍保留），随后留一条「整班回退」。',
    danger: true,
    confirmText: '回退到这里',
  })
  if (!ok) return
  try {
    const res = await api.rollbackClass(classId, row.id)
    toast(res.discarded ? `已回退，丢掉其后 ${res.discarded} 条改动` : '已回退到这一刻', 'success')
    await store.refreshSchedule()
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '回退失败，请重试', 'error')
  }
}

/** 行展开（看字段级差异） */
const openRows = ref<Set<number>>(new Set())
function toggle(id: number): void {
  const next = new Set(openRows.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openRows.value = next
}

const hasMore = computed(() => props.scope === 'class' && rows.value.length < total.value)

defineExpose({ reload: load })
</script>

<template>
  <div class="timeline">
    <!-- 筛选：全站视角多一个班级与操作人；对象历史（compact）不带筛选 -->
    <div v-if="!compact && scope === 'class'" class="filters">
      <div class="seg">
        <button
          v-for="opt in ENTITY_OPTIONS"
          :key="opt.value"
          class="seg-item"
          :class="{ active: filterEntity === opt.value }"
          type="button"
          @click="filterEntity = opt.value"
        >{{ opt.label }}</button>
      </div>
      <label class="mine">
        <input v-model="filterMine" type="checkbox" class="checkbox" />
        只看我
      </label>
    </div>
    <div v-else-if="scope === 'site'" class="filters filters--site">
      <select v-model="filterClassId" class="mini-input">
        <option :value="null">全部班级</option>
        <option v-for="c in siteClasses" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model="filterActor" class="mini-input" type="text" placeholder="操作人用户名" maxlength="20" />
      <div class="seg">
        <button
          v-for="opt in ENTITY_OPTIONS"
          :key="opt.value"
          class="seg-item"
          :class="{ active: filterEntity === opt.value }"
          type="button"
          @click="filterEntity = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <p v-if="loading" class="tl-note">读取中…</p>
    <p v-else-if="errorText" class="tl-note tl-note--error" role="alert">{{ errorText }}</p>
    <p v-else-if="!rows.length" class="tl-note">还没有变更记录。</p>

    <ol v-else class="tl-list">
      <li v-for="row in rows" :key="row.id" class="tl-item">
        <span class="tl-dot" :class="`dot-${row.entity === 'class_state' ? 'state' : row.action === 'delete' ? 'danger' : 'normal'}`"></span>
        <div class="tl-main">
          <div class="tl-head">
            <button class="tl-title" type="button" @click="toggle(row.id)">
              {{ changeTitle(row, { targetTitle: targetTitleOf(row) }) }}
              <span v-if="changeSubject(row, diffOpts)" class="tl-subject">{{ changeSubject(row, diffOpts) }}</span>
              <span class="tl-caret" :class="{ open: openRows.has(row.id) }">▾</span>
            </button>
            <span class="tl-meta">
              {{ row.actorName }} · {{ changeTimeLabel(row.createdAt) }}
              <template v-if="scope === 'site' && row.className"> · {{ row.className }}</template>
            </span>
          </div>

          <div v-if="openRows.has(row.id)" class="tl-diff">
            <div v-for="(r, i) in changeRows(row, diffOpts)" :key="i" class="diff-row">
              <span class="diff-label">{{ r.label }}</span>
              <span class="diff-from">{{ r.from }}</span>
              <span class="diff-arrow">→</span>
              <span class="diff-to">{{ r.to }}</span>
            </div>
            <p v-if="!changeRows(row, diffOpts).length" class="tl-hint">这条记录没有可列出的字段变化。</p>
          </div>

          <div v-if="conflictsOf[row.id]?.length" class="tl-conflict" role="alert">
            这条之后，同一个对象又被改过，撤销会盖掉下面这些改动：
            <ul>
              <li v-for="c in conflictsOf[row.id]" :key="c.id">
                {{ changeTimeLabel(c.createdAt) }} {{ c.actorName }} {{ changeTitle(c) }}
              </li>
            </ul>
            <span class="tl-hint">可以按时间从新到旧一条条撤销；或者用「回退到这里」整体回到某个时刻。</span>
          </div>

          <div class="tl-actions">
            <button v-if="canRevert(row)" class="btn-mini" type="button" @click="revert(row)">撤销</button>
            <button v-if="scope === 'class' && !compact" class="btn-mini" type="button" @click="rollback(row)">回退到这里</button>
          </div>
        </div>
      </li>
    </ol>

    <div v-if="hasMore" class="tl-more">
      <button class="btn-mini" type="button" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '加载中…' : `加载更多（还有 ${total - rows.length} 条）` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.filters {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex-wrap: wrap;
}

.filters--site {
  gap: var(--spacing-sm);
}

.mini-input {
  height: 32px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
  background: var(--color-bg-surface);
}

.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}

.seg-item {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.seg-item.active {
  background: var(--color-bg-surface);
  color: var(--color-brand);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-card);
}

.mine {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.checkbox {
  accent-color: var(--color-brand);
}

.tl-note {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  padding: var(--spacing-md) 0;
}

.tl-note--error {
  color: var(--color-feedback-error);
}

.tl-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.tl-item {
  position: relative;
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-default);
}

.tl-item:first-child {
  border-top: none;
}

.tl-dot {
  flex: none;
  width: 9px;
  height: 9px;
  margin-top: 6px;
  border-radius: var(--radius-full);
  border: 2px solid var(--color-border-strong);
  background: var(--color-bg-surface);
}

.dot-normal {
  border-color: var(--color-brand);
}

.dot-danger {
  border-color: var(--badge-cancel-text);
  background: var(--badge-cancel-bg);
}

.dot-state {
  border-color: var(--badge-multi-text);
  background: var(--badge-multi-bg);
}

.tl-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.tl-head {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.tl-title {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  text-align: left;
}

.tl-subject {
  font-weight: var(--font-weight-regular);
  color: var(--color-text-body);
}

.tl-caret {
  font-size: 10px;
  color: var(--color-text-tertiary);
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.tl-caret.open {
  transform: rotate(180deg);
}

.tl-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tl-diff {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
}

.diff-row {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  flex-wrap: wrap;
}

.diff-label {
  flex: none;
  min-width: 4.5em;
  color: var(--color-text-tertiary);
}

.diff-from {
  color: var(--color-text-tertiary);
  text-decoration: line-through;
}

.diff-arrow {
  color: var(--color-text-tertiary);
}

.diff-to {
  color: var(--color-text-body);
  font-weight: var(--font-weight-medium);
}

.tl-conflict {
  font-size: var(--font-size-sm);
  color: var(--badge-cancel-text);
  background: var(--badge-cancel-bg);
  border: 1px solid var(--badge-cancel-line);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tl-conflict ul {
  margin: 0;
  padding-left: 1.2em;
}

.tl-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.tl-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.tl-more {
  display: flex;
  justify-content: center;
  padding-top: var(--spacing-xs);
}
</style>
