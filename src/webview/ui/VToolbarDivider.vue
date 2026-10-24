<script setup lang="ts">
/**
 * 工具栏分隔符（docs/需求与优化方案/04 §4.6）：1px --ui-border。
 */
</script>

<template>
  <span class="v-toolbar-divider" role="separator" aria-orientation="vertical"></span>
</template>

<style scoped>
.v-toolbar-divider {
  display: inline-block;
  width: var(--ui-hairline); /* R-U-4：发丝线宽登记为令牌 */
  height: var(--ui-toolbar-divider-height); /* R-U-4 */
  background: var(--ui-border);
}
</style>
