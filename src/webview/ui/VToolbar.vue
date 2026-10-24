<script setup lang="ts">
/**
 * 工具栏（docs/需求与优化方案/04 §4.6）：横排 gap 8px；
 * 图标按钮（VButton icon 变体）hover 背景由组件自身处理；
 * 分隔符用 VToolbarDivider。
 */
defineProps<{ /** 可访问名称 */ label?: string }>()
</script>

<template>
  <!-- R-U-8：role="toolbar" 会向 SR 承诺「方向键导航」但本组件只支持 Tab，
       角色承诺与交互模型不符——按钮数量少的场景用 group 更贴合 VSCode 习惯。 -->
  <div class="v-toolbar" role="group" :aria-label="label">
    <slot></slot>
  </div>
</template>

<style scoped>
.v-toolbar {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
}
</style>
