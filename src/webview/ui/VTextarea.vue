<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { VFORM_FIELD_KEY, type VFormFieldContext } from './formFieldContext'

/**
 * 多行输入框（docs/需求与优化方案/04 §4.2）：最小 76px、可纵向缩放。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    invalid?: boolean
    disabled?: boolean
    maxlength?: number
    id?: string
  }>(),
  { modelValue: '', invalid: false, disabled: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const field = inject<VFormFieldContext | null>(VFORM_FIELD_KEY, null)
const fallbackId = ref('v-textarea')
const controlId = computed(() => props.id ?? field?.controlId.value ?? fallbackId.value)
const isInvalid = computed(() => props.invalid || (field?.invalid.value ?? false))

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <textarea
    :id="controlId"
    class="v-textarea"
    :class="{ 'v-textarea--invalid': isInvalid }"
    :value="modelValue"
    :placeholder="placeholder"
    :maxlength="maxlength"
    :disabled="disabled"
    :aria-invalid="isInvalid || undefined"
    :aria-describedby="field?.describedBy.value"
    @input="onInput"
  ></textarea>
</template>

<style scoped>
.v-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 76px;
  padding: 4px 8px;
  border: 1px solid var(--ui-input-border);
  border-radius: 2px;
  background: var(--ui-input-bg);
  color: var(--ui-input-fg);
  font-family: var(--ui-font);
  font-size: var(--ui-font-size);
  line-height: 1.5;
  resize: vertical;
  transition:
    border-color var(--ui-motion),
    background-color var(--ui-motion);
}

.v-textarea::placeholder {
  color: var(--ui-input-placeholder);
}

.v-textarea:focus {
  outline: 1px solid var(--ui-focus);
  outline-offset: -1px;
}

.v-textarea--invalid {
  border-color: var(--ui-error-border);
}

.v-textarea--invalid:focus {
  outline-color: var(--ui-error-border);
}

.v-textarea:disabled {
  color: var(--ui-fg-disabled);
  cursor: default;
}
</style>
