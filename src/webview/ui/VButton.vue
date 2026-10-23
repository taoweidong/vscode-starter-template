<script setup lang="ts">
import { iconClass, type IconName } from './iconNames'

/**
 * 按钮（docs/需求与优化方案/04 §4.1）。
 * 三变体：primary（主操作，布局时放右侧）/ secondary（默认）/ icon（22×22 图标按钮）。
 * loading 时禁用交互并显示旋转 spinner；主按钮在右由使用方布局保证。
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'icon'
    disabled?: boolean
    loading?: boolean
    /** 图标语义名（任意变体可带，icon 变体必填） */
    icon?: IconName
    /** icon 变体的可访问名称（渲染为 title / aria-label） */
    title?: string
  }>(),
  { variant: 'secondary', disabled: false, loading: false }
)
</script>

<template>
  <button
    type="button"
    class="v-button"
    :class="[`v-button--${variant}`, { 'v-button--loading': loading }]"
    :disabled="disabled || loading"
    :title="title"
    :aria-label="variant === 'icon' ? title : undefined"
    :aria-busy="loading || undefined"
  >
    <span
      v-if="loading"
      class="v-button__spinner"
      :class="iconClass('loading')"
      aria-hidden="true"
    ></span>
    <span v-else-if="icon" :class="iconClass(icon)" aria-hidden="true"></span>
    <span v-if="$slots.default && variant !== 'icon'" class="v-button__label"><slot></slot></span>
  </button>
</template>

<style scoped>
.v-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 72px;
  height: 26px;
  padding: 4px var(--ui-btn-pad-x);
  border: 1px solid transparent;
  border-radius: 2px;
  font-family: var(--ui-font);
  font-size: var(--ui-font-size);
  line-height: 1;
  cursor: pointer;
  transition:
    background-color var(--ui-motion),
    border-color var(--ui-motion),
    color var(--ui-motion);
}

.v-button:focus-visible {
  outline: 1px solid var(--ui-focus);
  outline-offset: 1px;
}

.v-button:disabled {
  cursor: default;
}

.v-button--primary {
  background: var(--ui-btn-bg);
  color: var(--ui-btn-fg);
}

.v-button--primary:hover:not(:disabled) {
  background: var(--ui-btn-bg-hover);
}

.v-button--secondary {
  background: var(--ui-btn2-bg);
  color: var(--ui-btn2-fg);
}

.v-button--secondary:hover:not(:disabled) {
  background: var(--ui-btn2-hover);
}

.v-button--icon {
  min-width: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  color: var(--ui-fg);
}

.v-button--icon:hover:not(:disabled) {
  background: var(--ui-surface-hover);
}

.v-button:disabled {
  color: var(--ui-fg-disabled);
}

.v-button--primary:disabled {
  background: var(--ui-btn2-bg);
  color: var(--ui-fg-disabled);
}

.v-button__spinner {
  animation: v-button-spin 1s linear infinite;
}

@keyframes v-button-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .v-button__spinner {
    animation: none;
  }
}
</style>
