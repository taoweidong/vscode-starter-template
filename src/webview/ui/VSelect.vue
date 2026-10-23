<script setup lang="ts">
import { computed, inject, useId } from 'vue'
import { VFORM_FIELD_KEY, type VFormFieldContext } from './formFieldContext'

/**
 * 下拉选择（docs/需求与优化方案/04 §4.3，ADR-08 一阶段方案）：
 * 原生 <select> + 输入令牌，保证键盘全程可达；
 * 二阶段（画廊验收不达标时）再评估自研 listbox 或 VSCode Elements。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string
    options: { value: string; label: string }[]
    disabled?: boolean
    invalid?: boolean
    id?: string
  }>(),
  { modelValue: '', disabled: false, invalid: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const field = inject<VFormFieldContext | null>(VFORM_FIELD_KEY, null)
const fallbackId = useId()
const controlId = computed(() => props.id ?? field?.controlId.value ?? fallbackId)
const isInvalid = computed(() => props.invalid || (field?.invalid.value ?? false))

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <select
    :id="controlId"
    class="v-select"
    :class="{ 'v-select--invalid': isInvalid }"
    :value="modelValue"
    :disabled="disabled"
    :aria-invalid="isInvalid || undefined"
    :aria-describedby="field?.describedBy.value"
    @change="onChange"
  >
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>

<style scoped>
.v-select {
  box-sizing: border-box;
  width: 100%;
  height: var(--ui-control-height);
  padding: var(--ui-input-pad-y) var(--ui-input-pad-x);
  border: 1px solid var(--ui-input-border);
  border-radius: var(--ui-radius);
  background: var(--ui-input-bg);
  color: var(--ui-input-fg);
  font-family: var(--ui-font);
  font-size: var(--ui-font-size);
  cursor: pointer;
  transition:
    border-color var(--ui-motion),
    background-color var(--ui-motion);
}

.v-select:focus {
  outline: 1px solid var(--ui-focus);
  outline-offset: -1px;
}

.v-select--invalid {
  border-color: var(--ui-error-border);
}

.v-select--invalid:focus {
  outline-color: var(--ui-error-border);
}

.v-select:disabled {
  color: var(--ui-fg-disabled);
  cursor: default;
}
</style>
