<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  isHostMessage,
  type HostMessage,
  type ImportPreviewFile,
  type ImportResult,
} from '../../protocol'
import { useVsCodeApi } from '../../shared/useVsCodeApi'
import AppShell from '../../ui/AppShell.vue'
import VBadge from '../../ui/VBadge.vue'
import VButton from '../../ui/VButton.vue'
import VCheckbox from '../../ui/VCheckbox.vue'
import VEmptyState from '../../ui/VEmptyState.vue'
import VInput from '../../ui/VInput.vue'
import VLoading from '../../ui/VLoading.vue'

/**
 * 批量导入向导（M4-T4.4）：三步向导 + 结果页。
 *
 * ① 来源：文件夹路径输入 + 「浏览…」（宿主 showOpenDialog）；
 * ② 预览：宿主扫描（readDirectory + 与现有条目按名称去重），已存在默认不勾选；
 * ③ 执行：分批 createMany（每批 ≤20），进度条 + 取消（取消即停，保留已完成）；
 * ④ 结果：成功 N / 跳过 M / 失败 K + 明细。
 *
 * 步骤条 / 进度条用基础组件 + 语义令牌自绘（04 §5 向导页布局）。
 */

type WizardStep = 'source' | 'preview' | 'executing' | 'result'

interface PreviewRow {
  name: string
  path: string
  exists: boolean
  checked: boolean
}

const STEP_LABELS: { id: WizardStep; label: string }[] = [
  { id: 'source', label: '选择来源' },
  { id: 'preview', label: '预览确认' },
  { id: 'executing', label: '执行导入' },
  { id: 'result', label: '完成' },
]

const api = useVsCodeApi()

const step = ref<WizardStep>('source')
const folder = ref('')
const browsing = ref(false)
const scanning = ref(false)
const rows = ref<PreviewRow[]>([])
const progress = ref({ done: 0, total: 0 })
const result = ref<ImportResult | null>(null)
const hostError = ref('')

const stepIndex = computed(() => STEP_LABELS.findIndex((entry) => entry.id === step.value))
const checkedRows = computed(() => rows.value.filter((row) => row.checked))
const existingCount = computed(() => rows.value.filter((row) => row.exists).length)
const progressPercent = computed(() => {
  const { done, total } = progress.value
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
})

function post(message: unknown): void {
  api.postMessage(message)
}

function onHostMessage(event: MessageEvent): void {
  const message = event.data
  if (!isHostMessage(message)) {
    return
  }
  switch (message.type) {
    case 'init': {
      // extra.presetFolder：资源管理器右键文件夹进入时预填路径
      const extra = (message.extra ?? {}) as { presetFolder?: unknown }
      if (typeof extra.presetFolder === 'string' && extra.presetFolder) {
        folder.value = extra.presetFolder
      }
      break
    }
    case 'selectFolder':
      browsing.value = false
      if (typeof message.folder === 'string') {
        folder.value = message.folder
      }
      break
    case 'importPreview':
      scanning.value = false
      rows.value = message.files.map((file: ImportPreviewFile) => ({
        name: file.name,
        path: file.path,
        exists: file.exists,
        checked: !file.exists, // 默认全选新文件，已存在的默认跳过
      }))
      step.value = 'preview'
      break
    case 'importProgress':
      progress.value = { done: message.done, total: message.total }
      break
    case 'importDone':
      result.value = message.result
      step.value = 'result'
      break
    case 'error':
      browsing.value = false
      scanning.value = false
      hostError.value = message.message
      break
    default:
      break
  }
}

function browse(): void {
  hostError.value = ''
  browsing.value = true
  post({ type: 'browseFolder' })
}

function requestPreview(): void {
  if (!folder.value.trim()) {
    return
  }
  hostError.value = ''
  scanning.value = true
  post({ type: 'requestPreview', folder: folder.value.trim() })
}

function backToSource(): void {
  step.value = 'source'
  rows.value = []
  hostError.value = ''
}

function toggleRow(row: PreviewRow, checked: boolean): void {
  row.checked = checked
}

function startImport(): void {
  const files = checkedRows.value.map((row) => ({
    name: row.name,
    path: row.path,
    exists: row.exists,
  }))
  if (!files.length) {
    return
  }
  hostError.value = ''
  progress.value = { done: 0, total: files.length }
  step.value = 'executing'
  post({ type: 'executeImport', files })
}

function cancelImport(): void {
  post({ type: 'cancelImport' })
}

function restart(): void {
  step.value = 'source'
  rows.value = []
  result.value = null
  progress.value = { done: 0, total: 0 }
  hostError.value = ''
}

function close(): void {
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
    title="批量导入条目"
    subtitle="从文件夹批量登记条目：选择来源 → 预览去重 → 执行导入。"
    width="wizard"
  >
    <!-- 步骤条（自绘：muted，当前高亮） -->
    <ol class="wizard__steps" aria-label="导入步骤">
      <li
        v-for="(entry, index) in STEP_LABELS"
        :key="entry.id"
        class="wizard__step"
        :class="{
          'wizard__step--current': index === stepIndex,
          'wizard__step--done': index < stepIndex,
        }"
        :aria-current="index === stepIndex ? 'step' : undefined"
      >
        <VBadge :label="index + 1"></VBadge>
        <span>{{ entry.label }}</span>
      </li>
    </ol>

    <p v-if="hostError" class="wizard__error" role="alert">{{ hostError }}</p>

    <!-- ① 来源 -->
    <section v-if="step === 'source'" class="wizard__panel">
      <div class="wizard__field">
        <label class="wizard__label" for="wizard-folder">文件夹路径</label>
        <div class="wizard__folder-row">
          <VInput id="wizard-folder" v-model="folder" placeholder="例如：D:\project\docs"></VInput>
          <VButton variant="secondary" :disabled="browsing || scanning" @click="browse"
            >浏览…</VButton
          >
        </div>
        <p class="wizard__hint">
          将该文件夹下的文件（不含子目录）逐个登记为条目，同名条目会自动跳过。
        </p>
        <VLoading v-if="scanning" label="正在扫描文件夹…"></VLoading>
      </div>
    </section>

    <!-- ② 预览 -->
    <section v-else-if="step === 'preview'" class="wizard__panel">
      <p class="wizard__summary">
        「{{ folder }}」共 {{ rows.length }} 个文件：
        <VBadge :label="rows.length - existingCount"></VBadge>
        <span>个新文件将被导入，</span>
        <VBadge :label="existingCount"></VBadge>
        <span>个与现有条目同名（默认跳过）。</span>
        <span v-if="rows.length >= 50">已达单次上限 50 个，其余文件未列出。</span>
      </p>
      <VEmptyState
        v-if="!rows.length"
        title="该文件夹下没有文件"
        description="换一个文件夹，或返回上一步重新选择。"
        icon="info"
      ></VEmptyState>
      <ul v-else class="wizard__files" role="list">
        <li
          v-for="row in rows"
          :key="row.path"
          class="wizard__file"
          :class="{ 'wizard__file--exists': row.exists }"
        >
          <VCheckbox
            :model-value="row.checked"
            :label="row.name"
            @update:model-value="toggleRow(row, $event)"
          ></VCheckbox>
          <span v-if="row.exists" class="wizard__file-mark">已存在，将跳过</span>
          <span class="wizard__file-path" :title="row.path">{{ row.path }}</span>
        </li>
      </ul>
    </section>

    <!-- ③ 执行 -->
    <section v-else-if="step === 'executing'" class="wizard__panel">
      <p class="wizard__summary">
        正在导入 {{ checkedRows.length }} 个文件（已完成 {{ progress.done }} /
        {{ progress.total }}）…
      </p>
      <div
        class="wizard__progress"
        role="progressbar"
        :aria-valuemin="0"
        :aria-valuemax="progress.total"
        :aria-valuenow="progress.done"
      >
        <div class="wizard__progress-fill" :style="{ width: `${progressPercent}%` }"></div>
      </div>
      <p class="wizard__hint">取消会停止后续批次，已完成的导入会保留。</p>
    </section>

    <!-- ④ 结果 -->
    <section v-else class="wizard__panel">
      <p class="wizard__summary">
        <template v-if="result">
          {{ result.cancelled ? '导入已取消（已完成的部分保留）。' : '导入完成。' }}
          成功 <VBadge :label="result.created"></VBadge> / 跳过
          <VBadge :label="result.skipped"></VBadge> / 失败 <VBadge :label="result.failed"></VBadge>
        </template>
      </p>
      <ul v-if="result?.failures?.length" class="wizard__failures">
        <li v-for="failure in result.failures" :key="failure.name">
          <span>{{ failure.name }}</span>
          <span class="wizard__file-path">{{ failure.reason }}</span>
        </li>
      </ul>
    </section>

    <template #actions>
      <template v-if="step === 'source'">
        <VButton variant="primary" :disabled="!folder.trim() || scanning" @click="requestPreview"
          >下一步</VButton
        >
      </template>
      <template v-else-if="step === 'preview'">
        <VButton variant="secondary" @click="backToSource">上一步</VButton>
        <VButton variant="primary" :disabled="!checkedRows.length" @click="startImport"
          >开始导入</VButton
        >
      </template>
      <template v-else-if="step === 'executing'">
        <VButton variant="secondary" @click="cancelImport">取消导入</VButton>
      </template>
      <template v-else>
        <VButton variant="secondary" @click="restart">再次导入</VButton>
        <VButton variant="primary" @click="close">完成</VButton>
      </template>
    </template>
  </AppShell>
</template>

<style scoped>
.wizard__steps {
  display: flex;
  gap: var(--ui-space-6);
  margin: 0 0 var(--ui-space-4);
  padding: 0 0 var(--ui-space-3);
  border-bottom: 1px solid var(--ui-border);
  list-style: none;
}

.wizard__step {
  display: inline-flex;
  align-items: center;
  gap: var(--ui-space-2);
  color: var(--ui-fg-muted);
}

.wizard__step--current {
  color: var(--ui-fg);
  font-weight: 600;
}

.wizard__step--done {
  color: var(--ui-fg);
}

.wizard__panel {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-3);
}

.wizard__field {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
  max-width: 560px;
}

.wizard__label {
  color: var(--ui-fg);
}

.wizard__folder-row {
  display: flex;
  gap: var(--ui-space-2);
}

.wizard__hint {
  margin: 0;
  color: var(--ui-fg-muted);
  font-size: 0.9em;
}

.wizard__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ui-space-1);
  margin: 0;
  color: var(--ui-fg);
}

.wizard__files {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-1);
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--ui-border);
  border-radius: 2px;
  list-style: none;
}

.wizard__file {
  display: grid;
  grid-template-columns: minmax(180px, auto) auto 1fr;
  align-items: center;
  gap: var(--ui-space-2);
  padding: var(--ui-space-1) var(--ui-space-2);
  border-bottom: 1px solid var(--ui-border);
}

.wizard__file:last-child {
  border-bottom: none;
}

.wizard__file--exists {
  background: var(--ui-surface);
}

.wizard__file-mark {
  color: var(--ui-fg-muted);
  font-size: 0.9em;
}

.wizard__file-path {
  overflow: hidden;
  color: var(--ui-fg-muted);
  font-size: 0.9em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wizard__progress {
  box-sizing: border-box;
  height: 8px;
  border: 1px solid var(--ui-border);
  border-radius: 2px;
  background: var(--ui-surface);
  overflow: hidden;
}

.wizard__progress-fill {
  height: 100%;
  background: var(--ui-focus);
  transition: width var(--ui-motion);
}

.wizard__failures {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-1);
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--ui-border);
  list-style: none;
}

.wizard__failures li {
  display: flex;
  align-items: baseline;
  gap: var(--ui-space-2);
  padding-top: var(--ui-space-1);
  color: var(--ui-error);
}

.wizard__error {
  margin: 0;
  color: var(--ui-error);
}
</style>
