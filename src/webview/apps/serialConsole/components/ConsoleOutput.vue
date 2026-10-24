<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import VButton from '../../../ui/VButton.vue'
import VEmptyState from '../../../ui/VEmptyState.vue'

/**
 * 控制台输出区：流式追加（自动滚动，可暂停）+ 清空。
 * - 新数据到达且未暂停时滚动到底部；用户向上滚动即自动暂停，
 *   点「滚动到底」恢复跟随；
 * - 块级渲染（每块是宿主一次批处理输出或本地回显），echo 块弱化显示。
 */
export interface OutputBlock {
  seq: number
  text: string
  kind?: 'echo'
}

const props = defineProps<{
  blocks: OutputBlock[]
}>()

const emit = defineEmits<{
  (e: 'clear'): void
}>()

const scrollRef = useTemplateRef<HTMLElement>('scroll')
const paused = ref(false)

function isNearBottom(): boolean {
  const el = scrollRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

function onScroll(): void {
  paused.value = !isNearBottom()
}

function scrollToBottom(): void {
  paused.value = false
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => props.blocks.length,
  () => {
    if (paused.value) return
    void nextTick(() => {
      const el = scrollRef.value
      if (el) el.scrollTop = el.scrollHeight
    })
  }
)
</script>

<template>
  <div class="console-output">
    <div class="console-output__toolbar">
      <VButton
        variant="secondary"
        :icon="paused ? 'arrowDown' : 'chevronDown'"
        :title="paused ? '滚动到底部并恢复跟随' : '输出滚动中'"
        @click="scrollToBottom"
      >
        {{ paused ? '已暂停，滚动到底' : '跟随输出' }}
      </VButton>
      <VButton
        variant="secondary"
        icon="clearAll"
        title="清空输出"
        :disabled="blocks.length === 0"
        @click="emit('clear')"
      >
        清空
      </VButton>
    </div>
    <div
      ref="scroll"
      class="console-output__scroll"
      role="log"
      aria-label="串口输出"
      aria-live="polite"
      @scroll="onScroll"
    >
      <VEmptyState
        v-if="blocks.length === 0"
        title="暂无输出"
        description="连接服务器并下发命令后，串口输出将实时显示在这里"
        icon="terminal"
      />
      <pre
        v-for="block in blocks"
        :key="block.seq"
        class="console-output__block"
        :class="{ 'console-output__block--echo': block.kind === 'echo' }"
        >{{ block.text }}</pre>
    </div>
  </div>
</template>

<style scoped>
.console-output {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  gap: var(--ui-space-2);
}

.console-output__toolbar {
  display: flex;
  gap: var(--ui-space-2);
}

.console-output__scroll {
  flex: 1;
  min-height: 160px;
  overflow: auto;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  border-radius: 2px;
  padding: var(--ui-space-2);
}

.console-output__block {
  margin: 0;
  font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
  font-size: var(--vscode-editor-font-size, 12px);
  color: var(--ui-fg);
  white-space: pre-wrap;
  word-break: break-all;
}

.console-output__block--echo {
  color: var(--ui-fg-muted);
}
</style>
