<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVsCodeApi } from '../../shared/useVsCodeApi'
import { schemaDefaults, toFormFields } from '../../components/fieldAdapter'
import type { FormField } from '../../formSchema'
import { useFormPage } from '../../composables/useFormPage'
import { stableStringify } from '../../shared/stableStringify'
import SchemaForm from '../../components/SchemaForm.vue'
import AppShell from '../../ui/AppShell.vue'
import VButton from '../../ui/VButton.vue'

/**
 * 特性配置页（M4-T4.3）：boolean 开关列表（SchemaForm 复用）+ 保存 / 取消。
 *
 * - init 回显 getFeatureValues() 的当前开关状态；
 * - 保存（submit）→ 宿主逐项 setFeatureValue（allSettled 语义）：
 *   全部成功由宿主关闭面板；部分失败回 error 消息（列出失败开关），面板保持打开；
 * - dirty 上报与条目表单一致；本页无草稿持久化（开关改动即时可见，取消即还原）。
 *
 * 宿主消息监听 / ready 上报 / init·submitAck·error 分发由 useFormPage 编排。
 */

/** SchemaForm 暴露面（defineExpose 的类型化引用，替代结构断言）。 */
interface SchemaFormInstance {
  validate: () => boolean
  focusFirst: () => void
}

const api = useVsCodeApi()

const schema = ref<FormField[]>([])
const value = ref<Record<string, unknown>>({})
const baseline = ref<Record<string, unknown>>({})
const formRef = ref<SchemaFormInstance | null>(null)

const dirty = computed(() => stableStringify(value.value) !== stableStringify(baseline.value))

const { initialized, submitting, hostError } = useFormPage({
  onInit: (message) => {
    schema.value = toFormFields(message.schema)
    value.value = {
      ...schemaDefaults(schema.value),
      ...(message.value as Record<string, unknown>),
    }
    baseline.value = { ...value.value }
    hostError.value = ''
    submitting.value = false
  },
  onSubmitAck: () => {
    baseline.value = { ...value.value }
    post({ type: 'dirty', dirty: false })
  },
  onError: (message) => {
    // 部分开关保存失败：宿主列出失败项，面板保持打开供用户重试
    hostError.value = message.message
  },
})

function post(message: unknown): void {
  api.postMessage(message)
}

watch(
  value,
  () => {
    if (initialized.value) {
      post({ type: 'dirty', dirty: dirty.value })
    }
  },
  { deep: true }
)

function onSubmit(): void {
  if (submitting.value) {
    return
  }
  submitting.value = true
  hostError.value = ''
  post({ type: 'submit', draft: { ...value.value } })
}

/** 保存按钮入口：先过 SchemaForm 校验（当前均为 boolean 开关，恒通过）。 */
function requestSubmit(): void {
  if (submitting.value) {
    return
  }
  if (formRef.value && !formRef.value.validate()) {
    return
  }
  onSubmit()
}

function onCancel(): void {
  post({ type: 'cancel' })
}
</script>

<template>
  <AppShell
    title="特性配置"
    subtitle="开关保存后立即写入 VSCode 设置（crudStarter.features.*），并实时影响插件行为。"
    width="settings"
  >
    <SchemaForm
      ref="formRef"
      v-model="value"
      :schema="schema"
      :disabled="submitting"
      :aria-label="'特性配置'"
      @submit="onSubmit"
      @cancel="onCancel"
    ></SchemaForm>

    <p v-if="hostError" class="feature-config__error" role="alert">{{ hostError }}</p>

    <template #actions>
      <!-- R-U-5：init 到达前禁用保存/取消——空 schema 恒过校验，会把空草稿提交到宿主 -->
      <VButton variant="secondary" :disabled="!initialized || submitting" @click="onCancel"
        >取消</VButton
      >
      <VButton
        variant="primary"
        icon="save"
        :loading="submitting"
        :disabled="!initialized || submitting"
        @click="requestSubmit"
        >保存</VButton
      >
    </template>
  </AppShell>
</template>

<style scoped>
.feature-config__error {
  margin: var(--ui-space-2) 0 0;
  color: var(--ui-error);
  font-size: 0.9em;
}
</style>
