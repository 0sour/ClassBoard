<script setup lang="ts">
// ============================================================
// ClassBoard · Skeleton 骨架屏（UI 设计文档 4.4）
// 三形态：grid（周课表网格）/ card（列表卡片）/ line（详情字段行）
// 浅底 bg-subtle 呼吸占位，容器 aria-busy="true"
// ============================================================

defineProps<{
  /** 形态：grid=周课表网格 / card=列表卡片 / line=详情行 */
  variant: 'grid' | 'card' | 'line'
  /** card/line 形态的条数 */
  count?: number
  /** grid 形态的节次行数 */
  rows?: number
}>()

const GRID_COLS = ['一', '二', '三', '四', '五', '六', '日']
</script>

<template>
  <div
    class="sk"
    :class="`sk--${variant}`"
    role="status"
    aria-busy="true"
    aria-label="加载中"
  >
    <!-- 周课表网格骨架 -->
    <template v-if="variant === 'grid'">
      <div class="sk-grid">
        <div class="sk-grid__corner sk-block"></div>
        <div v-for="c in GRID_COLS" :key="c" class="sk-grid__head">
          <span class="sk-block"></span>
        </div>
        <template v-for="r in rows ?? 12" :key="'r' + r">
          <div class="sk-grid__time sk-block"></div>
          <div v-for="c in GRID_COLS" :key="c + r" class="sk-grid__cell">
            <span class="sk-block" :style="{ width: `${(r * 17) % 70 + 30}%` }"></span>
          </div>
        </template>
      </div>
    </template>

    <!-- 列表卡片骨架 -->
    <template v-else-if="variant === 'card'">
      <div v-for="i in count ?? 3" :key="i" class="sk-card">
        <span class="sk-block sk-circle"></span>
        <span class="sk-card__lines">
          <span class="sk-block" :style="{ width: `${60 + (i * 17) % 30}%` }"></span>
          <span class="sk-block" style="width: 40%"></span>
        </span>
      </div>
    </template>

    <!-- 详情字段行骨架 -->
    <template v-else>
      <div v-for="i in count ?? 4" :key="i" class="sk-line">
        <span class="sk-block" :style="{ width: `${(i * 23) % 25 + 18}%` }"></span>
        <span class="sk-block" :style="{ width: `${(i * 31) % 35 + 40}%` }"></span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sk {
  width: 100%;
}

/* 呼吸占位（对齐设计语言动效） */
.sk-block {
  display: block;
  height: 12px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  animation: breathe 1.5s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

/* ===== grid：周课表网格 ===== */
.sk-grid {
  display: grid;
  grid-template-columns: var(--tc-w) repeat(7, minmax(0, 1fr));
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--color-bg-surface);
}

.sk-grid__corner {
  height: 44px;
  border-radius: 0;
  border-bottom: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
}

.sk-grid__head {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  border-bottom: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
}

.sk-grid__head .sk-block {
  width: 56%;
  height: 10px;
}

.sk-grid__time {
  height: 36px;
  border-radius: 0;
  border-right: 1px solid var(--color-border-default);
  border-bottom: 1px solid var(--color-border-default);
}

.sk-grid__cell {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
}

.sk-grid__cell .sk-block {
  height: 14px;
}

/* ===== card：列表卡片 ===== */
.sk-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  margin-bottom: var(--spacing-md);
}

.sk-circle {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: var(--radius-sm);
}

.sk-card__lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

/* ===== line：详情字段行 ===== */
.sk-line {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  padding: var(--spacing-sm) 0;
}

@media (prefers-reduced-motion: reduce) {
  .sk-block {
    animation: none;
  }
}
</style>
