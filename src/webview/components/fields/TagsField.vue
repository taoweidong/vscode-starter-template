<script setup lang="ts">
import { ref, watch } from 'vue'
import VBadge from '../../ui/VBadge.vue'
import VInput from '../../ui/VInput.vue'
import type { FormField } from '../../formSchema'
import { joinTags, parseTags } from '../tagsInput'

/**
 * tags 字段：单行输入 + 实时解析（04 §4.10）。
 * 输入框维护原始文本，按分隔符（, ，; ；、）解析为标签数组向父级抛出；
 * 外部值变化（编辑回填 / 草稿恢复）时同步回显，避免覆盖用户正在输入的文本。
 */
const props = defineProps<{
  field: FormField
  modelValue?: unknown
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>()

const text = ref(joinTags(props.modelValue))
const tags = ref<string[]>(parseTags(text.value))

watch(
  () => props.modelValue,
  (value) => {
    const joined = joinTags(value)
    if (joined !== text.value) {
      text.value = joined
      tags.value = parseTags(joined)
    }
  }
)

function onInput(value: string): void {
  text.value = value
  tags.value = parseTags(value)
  emit('update:modelValue', [...tags.value])
}
</script>

<template>
  <div class="tags-field">
    <VInput
      :model-value="text"
      :placeholder="field.placeholder"
      :disabled="disabled"
      @update:model-value="onInput"
    ></VInput>
    <div v-if="tags.length" class="tags-field__badges" aria-hidden="true">
      <VBadge v-for="tag in tags" :key="tag" :label="tag"></VBadge>
    </div>
  </div>
</template>

<style scoped>
.tags-field {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.tags-field__badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-space-1);
}
</style>
