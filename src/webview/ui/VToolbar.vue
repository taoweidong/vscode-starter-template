<script setup lang="ts">
/**
 * 工具栏（docs/需求与优化方案/04 §4.6）：横排 gap 8px；
 * 图标按钮（VButton icon 变体）hover 背景由组件自身处理；
 * 分隔符用 VToolbarDivider。
 */
defineProps<{ /** 可访问名称 */ label?: string }>()
</script>

<template>
  <div class="v-toolbar" role="toolbar" :aria-label="label">
    <slot></slot>
  </div>
</template>

<style scoped>
.v-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
