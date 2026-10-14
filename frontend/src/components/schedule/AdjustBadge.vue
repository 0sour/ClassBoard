<script setup lang="ts">
// ============================================================
// ClassBoard · 调整角标（UI 设计文档 3.6）
//   按类型固定语义色的胶囊：调课（蓝）/ 补课（绿）/ 调休（紫）/ 多次调整（靛蓝）；
//   链式调整（≥2 站）在类型角标旁再挂一个「多次调整」。
//   悬停给出完整说明；可点击时点开统一详情卡（与台账同一张）。
// ============================================================
import { computed } from 'vue'
import type { ResolvedBlock } from '@/types'
import { badgeLabels, movedFromLabel } from '@/utils/calendar'

const props = withDefaults(
  defineProps<{
    block: Pick<
      ResolvedBlock,
      'fromDate' | 'fromPeriods' | 'adjustmentNote' | 'chain' | 'originDate' | 'multiAdjusted'
    > & { source?: string }
    /** 紧凑模式（网格内小角标） */
    compact?: boolean
    /** 可点击：打开统一详情卡 */
    clickable?: boolean
  }>(),
  { compact: false, clickable: false },
)

const emit = defineEmits<{ (e: 'open'): void }>()

const labels = computed(() => badgeLabels(props.block))
const detail = computed(() => movedFromLabel(props.block))

const kindOf = (label: string): string =>
  label === '调课' ? 'move' : label === '补课' ? 'extra' : label === '调休' ? 'shift' : 'multi'
</script>

<template>
  <span v-if="labels.length" class="badges">
    <span
      v-for="label in labels"
      :key="label"
      class="adjust-badge"
      :class="[`badge-${kindOf(label)}`, { compact, clickable }]"
      :title="detail || label"
      :role="clickable ? 'button' : undefined"
      :tabindex="clickable ? 0 : undefined"
      @click.stop="clickable && emit('open')"
      @keydown.enter.stop="clickable && emit('open')"
      >{{ label }}</span
    >
  </span>
</template>

<style scoped>
.badges {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

/* 全胶囊、11px 加粗、按类型固定语义色（颜色在 tokens.css，勿在此硬编码） */
.adjust-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  line-height: 1.5;
  white-space: nowrap;
  flex-shrink: 0;
}

.adjust-badge.compact {
  padding: 0 5px;
  font-size: 10px;
  line-height: 1.35;
}

.adjust-badge.clickable {
  cursor: pointer;
}

.adjust-badge.clickable:hover {
  filter: brightness(0.96);
}

.badge-move {
  color: var(--badge-move-text);
  background: var(--badge-move-bg);
  border-color: var(--badge-move-line);
}

.badge-extra {
  color: var(--badge-extra-text);
  background: var(--badge-extra-bg);
  border-color: var(--badge-extra-line);
}

.badge-shift {
  color: var(--badge-shift-text);
  background: var(--badge-shift-bg);
  border-color: var(--badge-shift-line);
}

.badge-multi {
  color: var(--badge-multi-text);
  background: var(--badge-multi-bg);
  border-color: var(--badge-multi-line);
}
</style>
