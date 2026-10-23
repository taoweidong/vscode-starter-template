<script setup lang="ts">
import VSelect from '../../ui/VSelect.vue'
import type { FormField } from '../../formSchema'

/** select 字段：原生下拉（VSelect）；选项来自 schema 的 options 声明。 */
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
  <VSelect
    :model-value="asText(modelValue)"
    :options="field.options ?? []"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  ></VSelect>
</template>
