<script setup lang="ts">
import { iconClass } from './iconNames'

/**
 * 加载指示（docs/需求与优化方案/04 §4.7）：codicon sync 旋转；
 * prefers-reduced-motion 时停止旋转、以静态文字表达（文字始终渲染）。
 */
withDefaults(
  defineProps<{
    /** 朗读 / 展示的加载文案 */
    label?: string
  }>(),
  { label: '加载中…' }
)
</script>

<template>
  <div class="v-loading" role="status" :aria-label="label">
    <span class="v-loading__icon" :class="iconClass('loading')" aria-hidden="true"></span>
    <span class="v-loading__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.v-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-fg-muted);
}

.v-loading__icon {
  animation: v-loading-spin 1s linear infinite;
}

.v-loading__label {
  font-size: 0.9em;
}

@keyframes v-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .v-loading__icon {
    animation: none;
  }
}
</style>
