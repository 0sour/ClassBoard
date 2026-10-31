<script setup lang="ts">
// ============================================================
// ClassBoard · 调整详情卡（课表角标与设置台账共用的同一张卡）
//   把一次调整的完整链路摊开：基准日 → 调休移 X → 调课改 Y（终到）
//   每一站都可单独撤销（整日调休站请到台账的规则列表里清除）。
// ============================================================
import { computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { confirm, toast } from '@/utils/ui'
import { dateWithWeekdayLabel, monthDayLabel, type AdjustmentChain } from '@/utils/calendar'
import { periodsLabel } from '@/utils/session'

const props = defineProps<{ open: boolean; chain: AdjustmentChain | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useScheduleStore()

const title = computed(() => props.chain?.courseName ?? '调整详情')

/** 每一站 → 一行文案 */
const steps = computed(() => {
  const c = props.chain
  if (!c) return []
  return c.steps.map((h, i) => {
    if (h.kind === 'shift') {
      return {
        key: `${i}-shift`,
        kind: '调休',
        text: `${monthDayLabel(h.from)} 的课整日移到 ${monthDayLabel(h.to as string)}`,
        note: h.note,
        adjustmentId: null as number | null,
      }
    }
    if (h.kind === 'extra') {
      return {
        key: `${i}-extra`,
        kind: '补课',
        text: `${dateWithWeekdayLabel(h.from)} ${periodsLabel(h.periods)} 加课`,
        note: h.note,
        adjustmentId: h.adjustmentId,
      }
    }
    if (h.kind === 'cancel') {
      return {
        key: `${i}-cancel`,
        kind: '停课',
        text: `${dateWithWeekdayLabel(h.from)} ${periodsLabel(h.periods)} 停课`,
        note: h.note,
        adjustmentId: h.adjustmentId,
      }
    }
    return {
      key: `${i}-move`,
      kind: '调课',
      text: `${monthDayLabel(h.from)} → ${dateWithWeekdayLabel(h.to as string)} ${periodsLabel(h.periods)}`,
      note: h.note,
      adjustmentId: h.adjustmentId,
    }
  })
})

function revertAdjustment(adjustmentId: number, text: string): void {
  void confirm({
    title: '撤销这一站？',
    desc: `将删除调整「${text}」。撤销后这门课回到上一站的位置（可在变更记录中回退）。`,
    danger: true,
    confirmText: '撤销',
  }).then(async (ok) => {
    if (!ok) return
    try {
      await store.deleteAdjustment(adjustmentId)
      toast('已撤销这一站', 'success')
      emit('close')
    } catch (e) {
      toast(e instanceof Error ? e.message : '撤销失败，请重试', 'error')
    }
  })
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open && chain" class="modal-mask" @mousedown.self="emit('close')" @keydown="onKeydown">
        <div class="modal" role="dialog" aria-modal="true" :aria-label="`调整详情 ${title}`">
          <div class="modal-head">
            <h3 class="m-title">{{ title }}</h3>
            <span class="chain-chip">{{ chain.steps.length >= 2 ? '多次调整' : chain.steps[0]?.kind === 'extra' ? '补课' : '调整' }}</span>
            <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="modal-body">
            <!-- 基准 -->
            <div class="step step--base">
              <span class="step-dot"></span>
              <div class="step-main">
                <span class="step-kind">基准课表</span>
                <span class="step-text">
                  {{ dateWithWeekdayLabel(chain.originDate) }} {{ periodsLabel(chain.originPeriods) }}
                </span>
              </div>
            </div>

            <div v-for="s in steps" :key="s.key" class="step">
              <span class="step-dot" :class="`dot-${s.kind === '调课' ? 'move' : s.kind === '补课' ? 'extra' : s.kind === '调休' ? 'shift' : 'cancel'}`"></span>
              <div class="step-main">
                <span class="step-kind" :class="`kind-${s.kind === '调课' ? 'move' : s.kind === '补课' ? 'extra' : s.kind === '调休' ? 'shift' : 'cancel'}`">{{ s.kind }}</span>
                <span class="step-text">{{ s.text }}</span>
                <span v-if="s.note" class="step-note">{{ s.note }}</span>
              </div>
              <button
                v-if="s.adjustmentId !== null && !store.readonly"
                class="step-revert"
                type="button"
                @click="revertAdjustment(s.adjustmentId as number, s.text)"
              >撤销</button>
            </div>

            <div class="final" :class="{ cancelled: chain.cancelled }">
              <template v-if="chain.cancelled">这门课已停课（终态）</template>
              <template v-else-if="chain.final">
                终到：{{ dateWithWeekdayLabel(chain.final.date) }} {{ periodsLabel(chain.final.periods) }}
              </template>
            </div>
            <p v-if="store.readonly" class="hint">
              整日调休（把某一天的课整批移走）与单课调整都由班级负责人在「设置 → 日历台账」里维护；
              课表按调整后的时间上课，每次调整都会记入变更记录。
            </p>
            <p v-else class="hint">
              整日调休（把某一天的课整批移走）在「设置 → 日历台账」的规则列表里清除；
              上面每一站的单课调整可在此直接撤销，撤销后这门课回到上一站的位置。
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(2px);
}

.modal {
  width: min(440px, 100%);
  max-height: min(86vh, 680px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-default);
}

.m-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chain-chip {
  flex: none;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--badge-multi-text);
  background: var(--badge-multi-bg);
  border: 1px solid var(--badge-multi-line);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  flex: none;
}

.modal-close:hover {
  background: var(--color-bg-hover);
}

.modal-close svg {
  width: 18px;
  height: 18px;
}

.modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-lg) var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

/* 时间轴：左侧圆点 + 竖线 */
.step {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding-left: 2px;
}

.step:not(:first-child)::before {
  content: '';
  position: absolute;
  left: 6px;
  top: -14px;
  bottom: 100%;
  width: 1px;
  background: var(--color-border-default);
}

.step-dot {
  width: 11px;
  height: 11px;
  margin-top: 3px;
  border-radius: var(--radius-full);
  border: 2px solid var(--color-border-strong);
  background: var(--color-bg-surface);
  flex: none;
}

.step--base .step-dot {
  border-color: var(--color-text-tertiary);
}

.dot-move { border-color: var(--badge-move-text); background: var(--badge-move-bg); }
.dot-extra { border-color: var(--badge-extra-text); background: var(--badge-extra-bg); }
.dot-shift { border-color: var(--badge-shift-text); background: var(--badge-shift-bg); }
.dot-cancel { border-color: var(--badge-cancel-text); background: var(--badge-cancel-bg); }

.step-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-kind {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-tertiary);
}

.kind-move { color: var(--badge-move-text); }
.kind-extra { color: var(--badge-extra-text); }
.kind-shift { color: var(--badge-shift-text); }
.kind-cancel { color: var(--badge-cancel-text); }

.step-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-body);
}

.step-note {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.step-revert {
  flex: none;
  font-size: var(--font-size-xs);
  color: var(--color-feedback-error);
  border: 1px solid var(--color-feedback-error);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}

.step-revert:hover {
  background: var(--badge-cancel-bg);
}

.final {
  margin-top: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-body);
}

.final.cancelled {
  color: var(--badge-cancel-text);
  background: var(--badge-cancel-bg);
}

.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  line-height: 1.6;
}
</style>
