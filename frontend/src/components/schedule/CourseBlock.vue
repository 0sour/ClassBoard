<script setup lang="ts">
import { computed } from 'vue'
import type { Course } from '@/types'

const props = defineProps<{
  course: Course
  conflict?: boolean
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
    :class="{ lab: course.type === 'lab', conflict }"
    :aria-label="`${course.name}，${course.location}`"
    @click="emit('open', course)"
  >
    <span v-if="course.type === 'lab'" class="lab-tag">实验</span>
    <span v-if="conflict" class="conflict-dot" aria-hidden="true"></span>
    <span class="c-name">{{ course.name }}</span>
    <span class="c-loc">{{ course.location }}</span>
  </button>
</template>

<style scoped>
.course {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--spacing-2xs);
  padding: var(--spacing-sm) var(--spacing-sm);
  background: var(--cbg);
  border: 1px solid var(--cline);
  border-radius: var(--radius-sm);
  text-align: left;
  overflow: hidden;
  transition: box-shadow var(--motion-duration-normal) var(--motion-easing-standard),
    transform var(--motion-duration-normal) var(--motion-easing-standard);
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
  font-size: 10px;
  line-height: 1;
  color: var(--course-3-text);
  background: var(--color-white);
  border: 1px solid var(--course-3-line);
  border-radius: 4px;
  padding: 1px 4px;
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

.course.conflict .c-name {
  padding-right: 12px;
}

.course.lab .lab-tag {
  display: block;
}
</style>
