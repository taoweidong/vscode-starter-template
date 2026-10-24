<script setup lang="ts">
import { computed, provide, useId } from 'vue'
import { VFORM_FIELD_KEY, type VFormFieldContext } from './formFieldContext'
import { iconClass } from './iconNames'

/**
 * 表单字段语义容器（docs/需求与优化方案/04 §4.5）：
 * label（必填星号 --ui-error）+ 控件插槽 + hint（0.9em muted）+ 错误行（role="alert"）。
 * 经 provide 向字段控件（VInput/VTextarea/VSelect…）下发 controlId / invalid / describedBy，
 * 控件自动绑定 id / aria-invalid / aria-describedby。SchemaForm 每个字段必须用它包装。
 */
const props = withDefaults(
  defineProps<{
    label: string
    required?: boolean
    hint?: string
    error?: string
    /** 控件 id；不传时自动生成（label 的 htmlFor 与 aria-describedby 都基于它） */
    for?: string
  }>(),
  { required: false }
)

const generatedId = useId()

const controlId = computed(() => props.for ?? generatedId)
const invalid = computed(() => !!props.error)
const describedBy = computed(() => {
  const ids: string[] = []
  // 错误出现时 hint 节点不渲染，describedby 只指向错误节点，避免悬空引用。
  if (props.hint && !props.error) {
    ids.push(`${controlId.value}__hint`)
  }
  if (props.error) {
    ids.push(`${controlId.value}__error`)
  }
  return ids.length > 0 ? ids.join(' ') : undefined
})

provide(VFORM_FIELD_KEY, { controlId, invalid, describedBy } satisfies VFormFieldContext)
</script>

<template>
  <div class="v-form-field" :class="{ 'v-form-field--invalid': invalid }">
    <label class="v-form-field__label" :for="controlId">
      <span>{{ label }}</span>
      <span v-if="required" class="v-form-field__required" aria-hidden="true">*</span>
      <span v-if="required" class="v-visually-hidden">（必填）</span>
    </label>
    <div class="v-form-field__control">
      <slot></slot>
    </div>
    <p v-if="hint && !error" :id="`${controlId}__hint`" class="v-form-field__hint">{{ hint }}</p>
    <p v-if="error" :id="`${controlId}__error`" class="v-form-field__error" role="alert">
      <span :class="iconClass('error')" aria-hidden="true"></span>
      <span>{{ error }}</span>
    </p>
  </div>
</template>

<style scoped>
.v-form-field {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-1);
  margin-bottom: var(--ui-space-3);
}

.v-form-field__label {
  display: inline-flex;
  align-items: center;
  gap: var(--ui-space-1);
  cursor: default;
}

.v-form-field__required {
  color: var(--ui-error);
}

.v-form-field__hint {
  margin: 0;
  font-size: 0.9em;
  color: var(--ui-fg-muted);
}

.v-form-field__error {
  display: flex;
  align-items: center;
  gap: var(--ui-space-1);
  margin: 0;
  font-size: 0.9em;
  color: var(--ui-error);
}

.v-visually-hidden {
  position: absolute;
  width: var(--ui-hairline);
  height: var(--ui-hairline);
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
