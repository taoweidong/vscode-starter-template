<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { HostMessage } from '../../protocol'
import { useVsCodeApi } from '../../shared/useVsCodeApi'
import { schemaDefaults, toFormFields } from '../../components/fieldAdapter'
import type { FormField } from '../../formSchema'
import { useFormPage } from '../../composables/useFormPage'
import { stableStringify } from '../../shared/stableStringify'
import SchemaForm from '../../components/SchemaForm.vue'
import AppShell from '../../ui/AppShell.vue'
import VButton from '../../ui/VButton.vue'

/**
 * 条目表单页（M4-T4.2）：新增 / 预填新增 / 编辑三模式共用。
 *
 * - init 消息携带 {schema, value, extra:{mode, itemId, categories}}；
 * - 草稿持久化：输入防抖 500ms 经 vscode.setState 保存 {draft, mode, itemId}；
 *   init 时若持久化草稿与当前目标匹配（同 mode/itemId）则恢复并提示；
 * - dirty 上报：值与初始值出现差异时 postMessage {type:'dirty'}；
 * - 保存成功（submitAck）后清除草稿并复位 dirty（面板由宿主关闭）；
 * - 键盘（SchemaForm 内）：Esc 取消、Ctrl+Enter 提交、IME 组合中忽略。
 *
 * 宿主消息监听 / ready 上报 / init·submitAck·error 分发由 useFormPage 编排，
 * 本页只保留差异逻辑：草稿恢复、categories/datalist、draft 防抖与卸载清理。
 */

type FormMode = 'create' | 'edit'

/** SchemaForm 暴露面（defineExpose 的类型化引用，替代结构断言）。 */
interface SchemaFormInstance {
  validate: () => boolean
  focusFirst: () => void
}

interface PersistedDraft {
  draft: Record<string, unknown>
  mode: string
  itemId?: string
}

const DRAFT_DEBOUNCE_MS = 500

const api = useVsCodeApi()

const schema = ref<FormField[]>([])
const categories = ref<string[]>([])
const mode = ref<FormMode>('create')
const itemId = ref<string | undefined>(undefined)
const value = ref<Record<string, unknown>>({})
/** 干净基线：dirty = 当前值 ≠ 基线 */
const baseline = ref<Record<string, unknown>>({})
const fieldErrors = ref<Record<string, string>>({})
const restoredFromDraft = ref(false)

const formRef = ref<SchemaFormInstance | null>(null)

let draftTimer: ReturnType<typeof setTimeout> | undefined

const title = computed(() => (mode.value === 'edit' ? '编辑条目' : '新增条目'))
const subtitle = computed(() =>
  mode.value === 'edit'
    ? '修改字段后点击「保存」即可更新该条目。'
    : '填写后点击「保存」，数据将写入当前工作区的存储。'
)
const dirty = computed(() => stableStringify(value.value) !== stableStringify(baseline.value))
/** 有 datalist 声明的字段（分类建议）：页面持有 datalist 元素，输入建议来自 init 的 categories。 */
const datalistFields = computed(() =>
  schema.value.filter((field) => typeof field.datalist === 'string')
)

const { initialized, submitting, hostError } = useFormPage({
  onInit: applyInit,
  onSubmitAck: () => {
    api.setState({}) // 保存成功：清除持久化草稿
    baseline.value = { ...value.value }
    post({ type: 'dirty', dirty: false })
  },
  onError: (message) => {
    if (message.field) {
      fieldErrors.value = { ...fieldErrors.value, [message.field]: message.message }
    } else {
      hostError.value = message.message
    }
  },
  onUnmount: () => {
    if (draftTimer) {
      clearTimeout(draftTimer)
    }
  },
})

function post(message: unknown): void {
  api.postMessage(message)
}

function applyInit(message: Extract<HostMessage, { type: 'init' }>): void {
  const extra = (message.extra ?? {}) as {
    mode?: unknown
    itemId?: unknown
    categories?: unknown
    persisted?: unknown
  }
  schema.value = toFormFields(message.schema)
  categories.value = Array.isArray(extra.categories) ? extra.categories.map(String) : []
  mode.value = extra.mode === 'edit' ? 'edit' : 'create'
  itemId.value = typeof extra.itemId === 'string' ? extra.itemId : undefined
  fieldErrors.value = {}
  hostError.value = ''
  submitting.value = false
  restoredFromDraft.value = false

  // 初始值 = schema 默认值 ⊕ 宿主初值（编辑回填 / 预填新增）；基线始终是「干净」初值
  const clean: Record<string, unknown> = {
    ...schemaDefaults(schema.value),
    ...(message.value as Record<string, unknown>),
  }
  let next = clean

  // 草稿恢复：serializer 恢复状态优先，其次页面自身的持久化状态
  const persisted = (extra.persisted ?? api.getState<PersistedDraft | undefined>()) as
    PersistedDraft | undefined
  if (
    persisted &&
    typeof persisted === 'object' &&
    typeof persisted.draft === 'object' &&
    persisted.draft !== null &&
    persisted.mode === mode.value &&
    persisted.itemId === itemId.value
  ) {
    next = { ...clean, ...persisted.draft }
    restoredFromDraft.value = true
  }

  value.value = next
  baseline.value = clean
  // DOM 更新后聚焦第一个控件
  void nextTick(() => formRef.value?.focusFirst())
}

/** 丢弃恢复的草稿，回到干净状态（watch 会随之清除持久化草稿）。 */
function discardDraft(): void {
  restoredFromDraft.value = false
  value.value = { ...baseline.value }
}

watch(
  value,
  () => {
    if (!initialized.value) {
      return
    }
    post({ type: 'dirty', dirty: dirty.value })
    if (draftTimer) {
      clearTimeout(draftTimer)
    }
    if (!dirty.value) {
      api.setState({}) // 回到干净状态：清除持久化草稿
      return
    }
    // 草稿防抖持久化（保存成功 / 丢弃后写入空状态由对应分支处理）
    draftTimer = setTimeout(() => {
      api.setState({ draft: { ...value.value }, mode: mode.value, itemId: itemId.value })
    }, DRAFT_DEBOUNCE_MS)
  },
  { deep: true }
)

function onSubmit(): void {
  if (submitting.value) {
    return
  }
  submitting.value = true
  hostError.value = ''
  fieldErrors.value = {}
  post({ type: 'submit', draft: { ...value.value } })
}

/** 保存按钮入口：先过 SchemaForm 的 required 校验（错误显示在对应控件），再提交。 */
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

/** 宿主字段错误随输入清除（SchemaForm 的 clearError 通知，C-10）。 */
function onClearError(key: string): void {
  const next = { ...fieldErrors.value }
  delete next[key]
  fieldErrors.value = next
}
</script>

<template>
  <AppShell :title="title" :subtitle="subtitle" width="form">
    <p v-if="restoredFromDraft" class="item-form__restored" role="status">
      已恢复未保存的草稿。
      <button type="button" class="item-form__discard" @click="discardDraft">丢弃草稿</button>
    </p>

    <SchemaForm
      ref="formRef"
      v-model="value"
      :schema="schema"
      :errors="fieldErrors"
      :disabled="submitting"
      :aria-label="title"
      @submit="onSubmit"
      @cancel="onCancel"
      @clear-error="onClearError"
    ></SchemaForm>

    <p v-if="hostError" class="item-form__error" role="alert">{{ hostError }}</p>

    <!-- 分类输入建议：datalist 元素与输入框分置，经 schema 的 datalist id 关联 -->
    <datalist v-for="field in datalistFields" :id="field.datalist" :key="field.key">
      <option v-for="category in categories" :key="category" :value="category"></option>
    </datalist>

    <template #actions>
      <VButton variant="secondary" :disabled="submitting" @click="onCancel">取消</VButton>
      <VButton variant="primary" icon="save" :loading="submitting" @click="requestSubmit"
        >保存</VButton
      >
    </template>
  </AppShell>
</template>

<style scoped>
.item-form__restored {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  margin: 0 0 var(--ui-space-3);
  padding: var(--ui-space-2) var(--ui-space-3);
  border: 1px solid var(--ui-border);
  border-radius: 2px;
  background: var(--ui-surface);
  color: var(--ui-fg-muted);
  font-size: 0.9em;
}

.item-form__discard {
  padding: 0;
  border: none;
  background: none;
  color: var(--ui-link);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.item-form__error {
  margin: var(--ui-space-2) 0 0;
  color: var(--ui-error);
  font-size: 0.9em;
}
</style>
