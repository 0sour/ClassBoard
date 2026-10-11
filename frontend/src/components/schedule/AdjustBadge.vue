<script setup lang="ts">
// ============================================================
// ClassBoard · 「调课 / 补课」角标
// 凡是显示课程块的地方都带上它：让用户一眼看出这门课是调整过来的。
// 悬停/长按显示完整说明（由哪个日期的哪一节调来）。
// ============================================================
import { computed } from 'vue'
import type { ResolvedBlock } from '@/types'
import { movedFromLabel, sourceBadge } from '@/utils/calendar'

const props = defineProps<{
  block: Pick<ResolvedBlock, 'fromDate' | 'fromPeriods' | 'adjustmentNote'> & { source?: ResolvedBlock['source'] }
  /** 紧凑模式（网格内小角标） */
  compact?: boolean
}>()

const label = computed(() => sourceBadge(props.block.source))
const detail = computed(() => movedFromLabel(props.block))
</script>

<template>
  <span v-if="label" class="adjust-badge" :class="{ compact }" :title="detail || label">{{ label }}</span>
</template>

<style scoped>
.adjust-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  font-size: var(--font-size-xs);
  line-height: 1.4;
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.adjust-badge.compact {
  padding: 0 3px;
  font-size: 10px;
  line-height: 1.2;
}
</style>
