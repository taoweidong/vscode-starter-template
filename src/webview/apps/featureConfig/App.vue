<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isHostMessage, type HostMessage } from '../../protocol'
import { useVsCodeApi } from '../../shared/useVsCodeApi'
import { schemaDefaults, toFormFields } from '../../components/fieldAdapter'
import type { FormField } from '../../formSchema'
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
 */
const api = useVsCodeApi()

const schema = ref<FormField[]>([])
const value = ref<Record<string, unknown>>({})
const baseline = ref<Record<string, unknown>>({})
const hostError = ref('')
const submitting = ref(false)
const initialized = ref(false)
const formRef = ref<{ validate?: () => boolean } | null>(null)

const dirty = computed(() => JSON.stringify(value.value) !== JSON.stringify(baseline.value))

function post(message: unknown): void {
  api.postMessage(message)
}

function onHostMessage(event: MessageEvent): void {
  const message = event.data
  if (!isHostMessage(message)) {
    return
  }
  switch (message.type) {
    case 'init':
      schema.value = toFormFields(message.schema)
      value.value = {
        ...schemaDefaults(schema.value),
        ...(message.value as Record<string, unknown>),
      }
      baseline.value = { ...value.value }
      hostError.value = ''
      submitting.value = false
      initialized.value = true
      break
    case 'submitAck':
      submitting.value = false
      hostError.value = ''
      baseline.value = { ...value.value }
      post({ type: 'dirty', dirty: false })
      break
    case 'error':
      // 部分开关保存失败：宿主列出失败项，面板保持打开供用户重试
      submitting.value = false
      hostError.value = message.message
      break
    default:
      break
  }
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
  const form = formRef.value as { validate?: () => boolean } | null
  if (form?.validate && !form.validate()) {
    return
  }
  onSubmit()
}

function onCancel(): void {
  post({ type: 'cancel' })
}

onMounted(() => {
  window.addEventListener('message', onHostMessage)
  post({ type: 'ready' })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onHostMessage)
})
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
      @submit="onSubmit"
      @cancel="onCancel"
    ></SchemaForm>

    <p v-if="hostError" class="feature-config__error" role="alert">{{ hostError }}</p>

    <template #actions>
      <VButton variant="secondary" :disabled="submitting" @click="onCancel">取消</VButton>
      <VButton variant="primary" icon="save" :loading="submitting" @click="requestSubmit"
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
