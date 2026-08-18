<script setup lang="ts">
import { computed } from 'vue'
import type { Course } from '@/types'

const props = defineProps<{
  course: Course
  conflict?: boolean
  /** 折叠态（冲突分栏 1/3）：只显示名称；未传为 false，非冲突课程不受影响 */
  collapsed?: boolean
  /** 拖拽进行中：缩小高亮并为长按创建预留层 */
  dragging?: boolean
}>()

const emit = defineEmits<{ (e: 'open', course: Course): void }>()

/** 课程色板三值 CSS 变量（从全局 :root 读取，运行时由 color 名映射） */
const style = computed(() => ({
  '--cbg': `var(--${props.course.color}-bg)`,
  '--cline': `var(--${props.course.color}-line)`,
  '--ctext': `var(--${props.course.color}-text)`,
}))
</script>

<template>
  <button
    class="course"
    type="button"
    :style="style"
    :class="{ lab: course.type === 'lab', conflict, collapsed, dragging }"
    :aria-label="`${course.name}，${course.location}`"
    @click="emit('open', course)"
  >
    <span v-if="course.type === 'lab'" class="lab-tag">实验</span>
    <span v-if="conflict" class="conflict-dot" aria-hidden="true"></span>
    <span class="c-name">{{ course.name }}</span>
    <span v-if="!collapsed" class="c-loc">{{ course.location }}</span>
  </button>
</template>

<style scoped>
.course {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  margin: var(--spacing-2xs);
  padding: var(--spacing-sm) var(--spacing-sm);
  background: var(--cbg);
  border: 1px solid var(--cline);
  border-radius: var(--radius-sm);
  text-align: left;
  overflow: hidden;
  min-width: 0;
  transition: box-shadow var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
}

/* 拖拽进行中：原卡半透明占位（幽灵卡独立跟随），长按阶段允许抬起触摸 */
.course.dragging {
  opacity: 0.4;
  transform: scale(0.97);
  box-shadow: none;
}

.course:active.dragging {
  transform: scale(0.97);
}

/* 冲突分栏折叠态（1/3）：名称居中，地点隐藏 */
.course.collapsed .c-name {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.course:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}

.course:active {
  transform: translateY(0);
}

.c-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--ctext);
  line-height: var(--line-height-tight);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.c-loc {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 实验课标记 */
.lab-tag {
  position: absolute;
  top: 4px;
  right: 4px;
  /* 随课程色板：文字与描边用 --ctext/--cline（已在组件 style 计算中注入），白底分层 */
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  line-height: 1.6;
  color: var(--ctext);
  background: var(--color-white);
  border: 1px solid var(--cline);
  border-radius: var(--radius-full);
  padding: 0 6px;
}

/* 冲突角标 */
.conflict-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-feedback-warning);
}

/* lab + conflict 并存时，冲突圆点移到左上避免与标签重叠 */
.course.lab.conflict .conflict-dot {
  left: 4px;
  right: auto;
}

.course.conflict .c-name {
  padding-right: 12px;
}

.course.lab .lab-tag {
  display: block;
}
</style>
