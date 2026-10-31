<script setup lang="ts">
import { useScheduleStore } from '@/stores/schedule'
import WeekPicker from './WeekPicker.vue'

const store = useScheduleStore()

/** 跳转到指定周 */
function goToWeek(n: number): void {
  store.goToWeek(n)
}
</script>

<template>
  <div class="weeknav">
    <button class="wn-btn" type="button" @click="store.prevWeek()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      <span>上一周</span>
    </button>

    <!-- 点击标题弹出周选择器（快速跳任意周） -->
    <div class="wn-picker-wrap">
      <WeekPicker :current-week="store.weekNumber" @select="goToWeek">
        <div class="wn-title">
          <span class="wn-dates">{{ store.weekTitle }}</span>
          <span class="wn-week" v-if="store.weekNumber !== null">
            第 {{ store.weekNumber }} 周
          </span>
          <span class="wn-odd" v-if="store.weekNumber !== null">
            {{ store.isOdd ? '单周' : '双周' }}
          </span>
          <span class="wn-holiday" v-if="store.weekNumber === 0">未开学</span>
          <span class="wn-holiday" v-else-if="store.weekNumber === null">假期</span>
        </div>
      </WeekPicker>
    </div>

    <div class="wn-right">
      <button class="wn-btn" type="button" @click="store.nextWeek()">
        <span>下一周</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <button class="wn-btn" type="button" @click="store.goNow()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        <span>回到本周</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.weeknav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-md) 0;
}

.wn-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 var(--spacing-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-md);
  color: var(--color-text-body);
  white-space: nowrap;
  cursor: pointer;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.wn-btn:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-hover);
}

.wn-btn svg {
  width: 14px;
  height: 14px;
}

/* 标题容器：绝对居中，包住周选择触发器 */
.wn-picker-wrap {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  min-width: 9.5em; /* 桌面占位宽，防止左右按钮跳动（原 .wn-title 同款） */
}

.wn-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  height: 34px;
  padding: 0 var(--spacing-md);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* 悬停提示可点击 */
.wn-title:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-default);
  cursor: pointer;
}

.wn-dates {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.wn-week {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-secondary);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-full);
  padding: 2px 8px;
  white-space: nowrap;
}

.wn-odd {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-brand);
  background: var(--color-brand-subtle);
  border-radius: var(--radius-full);
  padding: 2px 8px;
  white-space: nowrap;
}

.wn-holiday {
  font-size: var(--font-size-sm);
  color: var(--color-feedback-warning);
  font-weight: var(--font-weight-medium);
}

.wn-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

@media (max-width: 767px) {
  .weeknav {
    flex-wrap: wrap;
    gap: var(--spacing-sm);
  }

  .wn-picker-wrap {
    position: static;
    transform: none;
    order: -1;
    width: 100%;
    justify-content: center;
  }

  .wn-title {
    justify-content: center;
  }

  .wn-right .wn-btn:last-child span {
    display: none;
  }

  .wn-right .wn-btn:last-child {
    padding: 0 10px;
  }
}
</style>
