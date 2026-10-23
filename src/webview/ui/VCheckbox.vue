<script setup lang="ts">
import { computed, inject } from 'vue'
import { VFORM_FIELD_KEY, type VFormFieldContext } from './formFieldContext'

/**
 * 复选框（docs/需求与优化方案/04 §4.4）：15px 方框、label 间距 8px、文字 600 字重。
 * 包在 VFormField 内时可省略 label（由字段容器的 label 经 htmlFor 关联），
 * 控件自动获得 id / aria-describedby（与 VInput 一致的可访问性上下文）。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    /** 复选框文字；包在 VFormField 内（label 已由容器渲染）时可传空串省略 */
    label?: string
    disabled?: boolean
    /** 覆盖 VFormField 生成的控件 id（一般无需传） */
    id?: string
  }>(),
  { modelValue: false, label: '', disabled: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const field = inject<VFormFieldContext | null>(VFORM_FIELD_KEY, null)
const controlId = computed(() => props.id ?? field?.controlId.value ?? undefined)

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="v-checkbox" :class="{ 'v-checkbox--disabled': disabled }">
    <input
      :id="controlId"
      class="v-checkbox__input"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :aria-describedby="field?.describedBy.value"
      @change="onChange"
    />
    <span v-if="label" class="v-checkbox__label">{{ label }}</span>
  </label>
</template>

<style scoped>
.v-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.v-checkbox__input {
  width: 15px;
  height: 15px;
  box-sizing: border-box;
  margin: 0;
  border: 1px solid var(--ui-check-border);
  border-radius: 2px;
  background: var(--ui-check-bg);
  color: var(--ui-check-fg);
  accent-color: var(--vscode-checkbox-select-background, var(--ui-focus));
  cursor: inherit;
}

.v-checkbox__input:focus-visible {
  outline: 1px solid var(--ui-focus);
  outline-offset: 1px;
}

.v-checkbox__label {
  font-weight: 600;
  color: var(--ui-fg);
}

.v-checkbox--disabled {
  cursor: default;
}

.v-checkbox--disabled .v-checkbox__label {
  color: var(--ui-fg-disabled);
}
</style>
