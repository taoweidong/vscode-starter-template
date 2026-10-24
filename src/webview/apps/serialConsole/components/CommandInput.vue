<script setup lang="ts">
import VButton from '../../../ui/VButton.vue'
import VInput from '../../../ui/VInput.vue'

/**
 * 命令输入行：Enter 发送（IME 组合中忽略，修复 W3 同款）、↑/↓ 遍历历史命令。
 * 未连接时输入可用（便于预先编辑），发送按钮禁用并由宿主兜底校验。
 */
const props = defineProps<{
  modelValue: string
  connected: boolean
  sending?: boolean
  /** MRU 序的历史命令（最新在前），供 ↑/↓ 遍历。 */
  historyCommands: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send', command: string): void
}>()

let historyIndex = -1

function send(): void {
  const command = props.modelValue
  if (command.trim().length === 0 || props.sending) return
  historyIndex = -1
  emit('send', command)
  emit('update:modelValue', '')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    send()
    return
  }
  if (event.key === 'ArrowUp' && props.historyCommands.length > 0) {
    event.preventDefault()
    historyIndex = Math.min(historyIndex + 1, props.historyCommands.length - 1)
    emit('update:modelValue', props.historyCommands[historyIndex] ?? '')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    historyIndex = Math.max(historyIndex - 1, -1)
    emit(
      'update:modelValue',
      historyIndex === -1 ? '' : (props.historyCommands[historyIndex] ?? '')
    )
  }
}
</script>

<template>
  <div class="command-input">
    <VInput
      ref="input"
      :model-value="modelValue"
      placeholder="输入命令，Enter 发送（↑/↓ 选择历史）"
      :disabled="sending"
      aria-label="串口命令输入"
      @update:model-value="emit('update:modelValue', $event)"
      @keydown="onKeydown"
    ></VInput>
    <VButton
      variant="primary"
      icon="send"
      :disabled="!connected || modelValue.trim().length === 0"
      :loading="sending"
      title="发送到串口"
      @click="send"
    >
      发送
    </VButton>
  </div>
</template>

<style scoped>
.command-input {
  display: flex;
  gap: var(--ui-space-2);
  align-items: center;
}
</style>
