<script setup lang="ts">
/**
 * 页面骨架（docs/需求与优化方案/04 §4.11 / §5 布局模式）：
 * header（标题 1.3em/600 + 副标题 muted + 底部 1px 分隔）+ 内容区 + actions（右对齐）。
 * width 变体：form 560px / settings 720px / wizard 960px / full 全宽。
 */
withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    width?: 'form' | 'settings' | 'wizard' | 'full'
  }>(),
  { width: 'form' }
)
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <div class="app-shell__heading">
        <h1 class="app-shell__title">{{ title }}</h1>
        <p v-if="subtitle" class="app-shell__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="app-shell__actions">
        <slot name="actions"></slot>
      </div>
    </header>
    <main class="app-shell__main" :class="`app-shell__main--${width}`">
      <slot></slot>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
}

.app-shell__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ui-space-4);
  padding: var(--ui-space-4) var(--ui-space-6) var(--ui-space-3);
  border-bottom: 1px solid var(--ui-border);
}

.app-shell__heading {
  min-width: 0;
}

.app-shell__title {
  margin: 0;
  font-size: 1.3em;
  font-weight: 600;
  color: var(--ui-fg);
}

.app-shell__subtitle {
  margin: var(--ui-space-1) 0 0;
  font-size: 0.9em;
  color: var(--ui-fg-muted);
}

.app-shell__actions {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  margin-left: auto;
}

.app-shell__main {
  box-sizing: border-box;
  width: 100%;
  padding: var(--ui-space-4) var(--ui-space-6) var(--ui-space-6);
}

@media (max-width: 400px) {
  .app-shell__main {
    padding: var(--ui-space-4) var(--ui-space-3) var(--ui-space-6);
  }
}

.app-shell__main--form {
  max-width: 560px;
  margin: 0 auto;
}

.app-shell__main--settings {
  max-width: 720px;
  margin: 0 auto;
}

.app-shell__main--wizard {
  max-width: 960px;
  margin: 0 auto;
}

.app-shell__main--full {
  max-width: none;
}
</style>
