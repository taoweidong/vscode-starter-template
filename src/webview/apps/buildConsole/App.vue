<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SchemaForm from '../../components/SchemaForm.vue'
import { schemaDefaults, toFormFields } from '../../components/fieldAdapter'
import type { FormField } from '../../formSchema'
import { isHostMessage, type BuildTaskWire } from '../../protocol'
import { useVsCodeApi } from '../../shared/useVsCodeApi'
import AppShell from '../../ui/AppShell.vue'
import VBadge from '../../ui/VBadge.vue'
import VButton from '../../ui/VButton.vue'
import VEmptyState from '../../ui/VEmptyState.vue'
import VToolbar from '../../ui/VToolbar.vue'

/**
 * 分支编译弹框（v2.0）：SchemaForm 填写 → 提交（宿主经打桩/真实 HTTP 接口创建任务）
 * → 轮询任务列表展示。表单 schema 由宿主 init 下发（BUILD_FIELD_DEFS 派生）；
 * 提交走通用 submit 生命周期（submitAck 解锁 / error 定位字段）。
 */

/** 轮询间隔（页面在前景时每 3s 拉一次任务列表）。 */
const POLL_INTERVAL_MS = 3000

const vscode = useVsCodeApi()

let pollTimer: ReturnType<typeof setInterval> | undefined

const fields = ref<FormField[]>([])
const draft = ref<Record<string, unknown>>({})
const errors = ref<Record<string, string>>({})
const tasks = ref<BuildTaskWire[]>([])
const initialized = ref(false)
const submitting = ref(false)
const feedback = ref('')

const runningCount = computed(
  () => tasks.value.filter((task) => task.status === 'queued' || task.status === 'running').length
)

const STATUS_META: Record<BuildTaskWire['status'], { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'muted' },
  running: { label: '构建中', cls: 'running' },
  success: { label: '成功', cls: 'success' },
  failed: { label: '失败', cls: 'failed' },
}

const BUILD_TYPE_LABEL: Record<string, string> = {
  full: '完整',
  incremental: '增量',
}

function post(message: unknown): void {
  vscode.postMessage(message)
}

function requestList(): void {
  post({ type: 'buildListRequest' })
}

function onSubmit(): void {
  if (submitting.value) {
    return
  }
  errors.value = {}
  feedback.value = ''
  submitting.value = true
  post({ type: 'submit', draft: { ...draft.value } })
}

function refresh(): void {
  requestList()
}

function formatTime(iso: string | undefined): string {
  if (!iso) {
    return ''
  }
  return new Date(iso).toLocaleTimeString()
}

function onMessage(event: MessageEvent): void {
  const data: unknown = event.data
  if (!isHostMessage(data)) {
    return
  }
  switch (data.type) {
    case 'init': {
      fields.value = toFormFields(data.schema)
      const seed = (data.value ?? {}) as Record<string, unknown>
      draft.value = { ...schemaDefaults(fields.value), ...seed }
      initialized.value = true
      requestList()
      break
    }
    case 'buildList':
      tasks.value = data.tasks
      break
    case 'submitAck':
      submitting.value = false
      feedback.value = ''
      requestList()
      break
    case 'error':
      submitting.value = false
      feedback.value = data.message
      if (data.field) {
        errors.value = { [data.field]: data.message }
      }
      break
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  post({ type: 'ready' })
  // init 尚未到达时也先拉一次列表（恢复面板场景 init 会再次触发）
  pollTimer = setInterval(() => {
    if (initialized.value) {
      requestList()
    }
  }, POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  if (pollTimer !== undefined) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
})
</script>

<template>
  <AppShell
    title="分支编译"
    subtitle="填写信息提交构建任务，列表实时展示任务状态（HTTP 接口当前为打桩模拟）"
    width="form"
  >
    <VToolbar label="分支编译操作">
      <template v-if="runningCount > 0">
        <VBadge :label="`${runningCount} 个进行中`"></VBadge>
      </template>
      <VButton variant="secondary" icon="refresh" :disabled="!initialized" @click="refresh">
        刷新
      </VButton>
    </VToolbar>

    <!-- 表单区：SchemaForm 由宿主 init 的 schema 驱动（BUILD_FIELD_DEFS 派生） -->
    <section v-if="initialized" class="build-form" aria-label="构建任务表单">
      <SchemaForm
        v-model="draft"
        :schema="fields"
        :errors="errors"
        :disabled="submitting"
        aria-label="构建任务表单"
        @submit="onSubmit"
      ></SchemaForm>
      <p v-if="feedback" class="build-form__feedback" role="alert">{{ feedback }}</p>
      <div class="build-form__actions">
        <VButton
          variant="primary"
          icon="send"
          :loading="submitting"
          :disabled="submitting"
          @click="onSubmit"
        >
          提交构建
        </VButton>
      </div>
    </section>

    <!-- 任务列表区 -->
    <section class="build-list" aria-label="构建任务列表">
      <h2 class="build-list__title">构建任务</h2>
      <VEmptyState
        v-if="tasks.length === 0"
        title="暂无构建任务"
        description="填写上方表单提交第一个构建任务（当前为打桩模拟，接口返回模拟数据）。"
        icon="info"
      ></VEmptyState>
      <ul v-else class="build-list__items">
        <li v-for="task in tasks" :key="task.id" class="build-task">
          <div class="build-task__head">
            <span class="build-task__branch">{{ task.branch }}</span>
            <VBadge :label="BUILD_TYPE_LABEL[task.buildType] ?? task.buildType"></VBadge>
            <span
              class="build-task__status"
              :class="`build-task__status--${STATUS_META[task.status].cls}`"
            >
              {{ STATUS_META[task.status].label }}
              <span v-if="task.status === 'running'"> {{ task.progress }}%</span>
            </span>
          </div>
          <p v-if="task.message" class="build-task__message">{{ task.message }}</p>
          <p class="build-task__meta">
            <template v-if="task.notes">备注：{{ task.notes }} · </template>
            提交于 {{ formatTime(task.createdAt)
            }}<template v-if="task.finishedAt">
              · 结束于 {{ formatTime(task.finishedAt) }}</template
            >
          </p>
        </li>
      </ul>
    </section>
  </AppShell>
</template>

<style scoped>
.build-form {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-3);
  margin-block-end: var(--ui-space-4);
}

.build-form__feedback {
  margin: 0;
  color: var(--ui-error);
  font-size: var(--ui-badge-size);
}

.build-form__actions {
  display: flex;
  justify-content: flex-end;
}

.build-list__title {
  margin-block: var(--ui-space-3) var(--ui-space-2);
  font-size: var(--ui-badge-size);
  font-weight: 600;
  color: var(--ui-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.build-list__items {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.build-task {
  padding: var(--ui-space-3);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-surface);
}

.build-task__head {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
}

.build-task__branch {
  font-weight: 600;
}

.build-task__status {
  margin-inline-start: auto;
  font-size: var(--ui-badge-size);
}

.build-task__status--running {
  color: var(--ui-link);
}

.build-task__status--success {
  color: var(--ui-link-active);
}

.build-task__status--failed {
  color: var(--ui-error);
}

.build-task__status--muted {
  color: var(--ui-fg-muted);
}

.build-task__message {
  margin: var(--ui-space-2) 0 0;
  font-size: var(--ui-badge-size);
}

.build-task__meta {
  margin: var(--ui-space-2) 0 0;
  font-size: var(--ui-badge-size);
  color: var(--ui-fg-muted);
}
</style>
