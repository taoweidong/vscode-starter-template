<script setup lang="ts">
import VInput from '../../ui/VInput.vue'
import type { FormField } from '../../formSchema'

/**
 * text 字段：单行输入（VInput）。schema 的 datalist 属性透传为输入框的 list，
 * 供页面渲染分类建议（datalist 元素由页面持有）。
 */
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
  <VInput
    :model-value="asText(modelValue)"
    :placeholder="field.placeholder"
    :list="typeof field.datalist === 'string' ? field.datalist : undefined"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  ></VInput>
</template>
