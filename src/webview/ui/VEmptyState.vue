<script setup lang="ts">
import { iconClass, type IconName } from './iconNames'

/**
 * 空态（docs/需求与优化方案/04 §4.7）：居中、muted 文案 + 一个主行动按钮（action 插槽）。
 */
defineProps<{
  /** 主文案（简短说明当前为空的内容） */
  title: string
  /** muted 说明文字 */
  description?: string
  icon?: IconName
}>()
</script>

<template>
  <div class="v-empty-state">
    <span
      v-if="icon"
      class="v-empty-state__icon"
      :class="iconClass(icon)"
      aria-hidden="true"
    ></span>
    <p class="v-empty-state__title">{{ title }}</p>
    <p v-if="description" class="v-empty-state__description">{{ description }}</p>
    <div v-if="$slots.action" class="v-empty-state__action">
      <slot name="action"></slot>
    </div>
  </div>
</template>

<style scoped>
.v-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ui-space-2);
  padding: var(--ui-space-6) var(--ui-space-4);
  text-align: center;
}

.v-empty-state__icon {
  font-size: var(--ui-empty-icon-size); /* R-U-4 */
  color: var(--ui-fg-muted);
}

.v-empty-state__title {
  margin: 0;
  color: var(--ui-fg);
}

.v-empty-state__description {
  margin: 0;
  font-size: 0.9em;
  color: var(--ui-fg-muted);
}

.v-empty-state__action {
  margin-top: var(--ui-space-2);
}
</style>
