<script setup lang="ts">
import VCheckbox from '../../ui/VCheckbox.vue'
import type { FormField } from '../../formSchema'

/**
 * boolean 字段：开关（VCheckbox）。包在 VFormField 内时省略自身 label，
 * 由字段容器的 label 经 htmlFor 关联控件（可访问性上下文由 VCheckbox 注入获得）。
 */
defineProps<{
  field: FormField
  modelValue?: unknown
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()
</script>

<template>
  <VCheckbox
    :model-value="modelValue === true"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  ></VCheckbox>
</template>
