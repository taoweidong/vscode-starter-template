<script setup lang="ts">
/**
 * 计数徽标（docs/需求与优化方案/04 §4.8）：--ui-badge-bg/fg、最小宽度、圆角 2px。
 * 用于过滤匹配计数等场景。
 */
withDefaults(
  defineProps<{
    /** 徽标内容（数字或短文本）；也可用默认插槽覆盖 */
    label?: string | number
  }>(),
  {}
)
</script>

<template>
  <span class="v-badge">
    <slot>{{ label }}</slot>
  </span>
</template>

<style scoped>
.v-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--ui-badge-bg);
  color: var(--ui-badge-fg);
  font-size: 0.9em;
  line-height: 1;
}
</style>
