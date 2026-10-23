<script setup lang="ts">
import VTextarea from '../../ui/VTextarea.vue'
import type { FormField } from '../../formSchema'

/** textarea 字段：多行输入（VTextarea，可纵向缩放）。 */
defineProps<{
  field: FormField
  modelValue?: unknown
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
</script>

<template>
  <VTextarea
    :model-value="asText(modelValue)"
    :placeholder="field.placeholder"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  ></VTextarea>
</template>
