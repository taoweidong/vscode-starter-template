<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import AppShell from '../../ui/AppShell.vue'
import VBadge from '../../ui/VBadge.vue'
import VButton from '../../ui/VButton.vue'
import VCheckbox from '../../ui/VCheckbox.vue'
import VEmptyState from '../../ui/VEmptyState.vue'
import VFormField from '../../ui/VFormField.vue'
import VInput from '../../ui/VInput.vue'
import VLoading from '../../ui/VLoading.vue'
import VSelect from '../../ui/VSelect.vue'
import VTextarea from '../../ui/VTextarea.vue'
import VToolbar from '../../ui/VToolbar.vue'
import VToolbarDivider from '../../ui/VToolbarDivider.vue'

/**
 * 组件画廊（docs/需求与优化方案/04 §8）：每个基础组件一节，渲染全部状态。
 * 用途：M3 视觉验收基准（主题跟随宿主实时变化，无需手动切换）。
 */

const demoInput = ref('示例内容')
const demoInvalidInput = ref('')
const demoTextarea = ref('多行内容')
const demoSelect = ref('medium')
const demoChecked = ref(true)
const demoUnchecked = ref(false)
const demoSaveLoading = ref(false)
const demoTimer = ref<number>()

const priorityOptions = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

function fakeSave(): void {
  demoSaveLoading.value = true
  demoTimer.value = window.setTimeout(() => {
    demoSaveLoading.value = false
  }, 1500)
}

onBeforeUnmount(() => {
  if (demoTimer.value !== undefined) {
    clearTimeout(demoTimer.value)
  }
})
</script>

<template>
  <AppShell
    title="组件画廊"
    subtitle="VSCode 原生设计系统验收基准：视觉跟随宿主主题（Dark+ / Light+ / 高对比度）实时切换。"
    width="settings"
  >
    <section class="gallery__section">
      <h2 class="gallery__section-title">按钮 VButton</h2>
      <p class="gallery__section-desc">
        三变体（primary / secondary / icon）；min-width 72px、高 26px、圆角 2px；loading
        时禁用并显示旋转图标；主按钮在右侧布局由使用方保证。
      </p>
      <div class="gallery__grid">
        <div class="gallery__item">
          <span class="gallery__label">默认</span>
          <div class="gallery__row">
            <VButton variant="secondary">取消</VButton>
            <VButton variant="primary">保存</VButton>
          </div>
        </div>
        <div class="gallery__item">
          <span class="gallery__label">带图标</span>
          <div class="gallery__row">
            <VButton variant="secondary" icon="add">新增条目</VButton>
            <VButton variant="primary" icon="save">保存</VButton>
          </div>
        </div>
        <div class="gallery__item">
          <span class="gallery__label">禁用</span>
          <div class="gallery__row">
            <VButton variant="secondary" disabled>取消</VButton>
            <VButton variant="primary" disabled>保存</VButton>
          </div>
        </div>
        <div class="gallery__item">
          <span class="gallery__label">加载中</span>
          <div class="gallery__row">
            <VButton variant="secondary" :loading="demoSaveLoading" @click="fakeSave"
              >点击模拟提交</VButton
            >
            <VButton variant="primary" loading>保存</VButton>
          </div>
        </div>
        <div class="gallery__item">
          <span class="gallery__label">图标按钮 22×22</span>
          <div class="gallery__row">
            <VButton variant="icon" icon="add" title="新增"></VButton>
            <VButton variant="icon" icon="edit" title="编辑"></VButton>
            <VButton variant="icon" icon="copy" title="克隆"></VButton>
            <VButton variant="icon" icon="delete" title="删除"></VButton>
            <VButton variant="icon" icon="refresh" title="刷新"></VButton>
            <VButton variant="icon" icon="search" title="搜索"></VButton>
            <VButton variant="icon" icon="close" title="关闭" disabled></VButton>
          </div>
        </div>
      </div>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">输入 VInput / VTextarea</h2>
      <p class="gallery__section-desc">
        背景 / 文字 / 占位符走输入令牌；invalid 时描边与焦点环切 --ui-error-border；textarea 最小
        76px、可纵向缩放。
      </p>
      <div class="gallery__grid gallery__grid--stack">
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">默认（v-model 双向绑定）</span>
          <VInput v-model="demoInput" placeholder="请输入内容"></VInput>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">占位符</span>
          <VInput placeholder="例如：需求 / 任务 / 笔记"></VInput>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">校验错误态（invalid）</span>
          <VInput v-model="demoInvalidInput" invalid placeholder="名称不能为空"></VInput>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">禁用</span>
          <VInput model-value="禁用状态内容" disabled></VInput>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">maxlength（20 字符）</span>
          <VInput :model-value="demoInput" :maxlength="20" placeholder="最多 20 字"></VInput>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">多行 VTextarea</span>
          <VTextarea v-model="demoTextarea" placeholder="补充说明（可选）"></VTextarea>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">多行错误态</span>
          <VTextarea model-value="" invalid placeholder="描述格式不正确"></VTextarea>
        </div>
      </div>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">选择 VSelect（一阶段：原生 select）</h2>
      <p class="gallery__section-desc">
        原生 select + 输入令牌，键盘全程可达；自研 listbox 视画廊验收结果决定（ADR-08）。
      </p>
      <div class="gallery__grid gallery__grid--stack">
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">默认</span>
          <VSelect v-model="demoSelect" :options="priorityOptions"></VSelect>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">错误态</span>
          <VSelect model-value="" invalid :options="priorityOptions"></VSelect>
        </div>
        <div class="gallery__item gallery__item--wide">
          <span class="gallery__label">禁用</span>
          <VSelect model-value="high" disabled :options="priorityOptions"></VSelect>
        </div>
      </div>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">复选 VCheckbox</h2>
      <p class="gallery__section-desc">
        15px 方框；label 间距 8px、600 字重；accent-color 跟随主题。
      </p>
      <div class="gallery__row gallery__row--block">
        <VCheckbox v-model="demoChecked" label="删除条目时弹出确认框"></VCheckbox>
        <VCheckbox v-model="demoUnchecked" label="操作成功后显示通知"></VCheckbox>
        <VCheckbox :model-value="false" disabled label="禁用状态"></VCheckbox>
        <VCheckbox :model-value="true" disabled label="禁用且选中"></VCheckbox>
      </div>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">表单字段 VFormField</h2>
      <p class="gallery__section-desc">
        label + 必填星号 + hint（0.9em muted）+ 错误行（role="alert"，图标 +
        文字，不依赖单一颜色）；控件自动获得 aria-invalid / aria-describedby。
      </p>
      <div class="gallery__grid gallery__grid--stack">
        <VFormField label="名称" required hint="3–30 个字符，同名会提示冲突">
          <VInput v-model="demoInput" placeholder="请输入条目名称"></VInput>
        </VFormField>
        <VFormField label="名称" required error="名称不能为空">
          <VInput v-model="demoInvalidInput" placeholder="请输入条目名称"></VInput>
        </VFormField>
        <VFormField label="分类" hint="留空归入「未分类」">
          <VInput placeholder="例如：需求 / 任务 / 笔记"></VInput>
        </VFormField>
        <VFormField label="优先级" required error="请选择优先级">
          <VSelect model-value="" :options="priorityOptions"></VSelect>
        </VFormField>
      </div>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">反馈（校验提示对比）</h2>
      <p class="gallery__section-desc">
        hint 与 error 的对比：错误行带 role="alert" 与图标，切换主题 / 高对比度下均可读。
      </p>
      <div class="gallery__grid gallery__grid--stack">
        <VFormField label="标签" hint="多个标签用逗号分隔">
          <VInput placeholder="前端, 待办"></VInput>
        </VFormField>
        <VFormField label="标签" error="标签数量超过上限（10 个）">
          <VInput model-value="a, b, c"></VInput>
        </VFormField>
      </div>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">徽标 VBadge</h2>
      <p class="gallery__section-desc">用于过滤匹配计数等场景；最小宽度、圆角 2px。</p>
      <div class="gallery__row">
        <span class="gallery__label">计数：</span>
        <VBadge :label="3"></VBadge>
        <VBadge :label="12"></VBadge>
        <VBadge :label="128"></VBadge>
        <VBadge label="新"></VBadge>
      </div>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">工具栏 VToolbar</h2>
      <p class="gallery__section-desc">
        横排 gap 8px；图标按钮 hover 背景 --ui-surface-hover；分隔符 1px --ui-border。
      </p>
      <VToolbar label="条目操作">
        <VButton variant="icon" icon="add" title="新增"></VButton>
        <VButton variant="icon" icon="edit" title="编辑"></VButton>
        <VButton variant="icon" icon="copy" title="克隆"></VButton>
        <VToolbarDivider></VToolbarDivider>
        <VButton variant="icon" icon="refresh" title="刷新"></VButton>
        <VButton variant="icon" icon="search" title="搜索"></VButton>
        <VToolbarDivider></VToolbarDivider>
        <VButton variant="icon" icon="delete" title="删除" disabled></VButton>
      </VToolbar>
    </section>

    <section class="gallery__section">
      <h2 class="gallery__section-title">空态与加载</h2>
      <p class="gallery__section-desc">
        空态：居中 muted 文案 + 主行动按钮；加载：codicon 旋转，prefers-reduced-motion
        时停止旋转、保留静态文字。
      </p>
      <div class="gallery__grid gallery__grid--halves">
        <div class="gallery__card">
          <VEmptyState
            title="暂无条目"
            description="从创建第一个条目开始，也可以从选中文本快速新增。"
            icon="info"
          >
          </VEmptyState>
          <div class="gallery__card-footer">
            <VButton variant="secondary" icon="add" disabled>新增条目</VButton>
          </div>
        </div>
        <div class="gallery__card">
          <VEmptyState title="没有匹配的条目" description="换个关键字，或清除当前过滤条件。">
            <template #action>
              <VButton variant="primary">清除过滤</VButton>
            </template>
          </VEmptyState>
        </div>
        <div class="gallery__card">
          <VLoading label="正在加载条目列表…"></VLoading>
        </div>
        <div class="gallery__card">
          <VLoading label="正在保存（提交在途按钮示例）…"></VLoading>
          <div class="gallery__card-footer">
            <VButton variant="secondary" disabled>取消</VButton>
            <VButton variant="primary" loading>保存</VButton>
          </div>
        </div>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
.gallery__section {
  margin-bottom: var(--ui-space-6);
  padding-bottom: var(--ui-space-6);
  border-bottom: 1px solid var(--ui-border);
}

.gallery__section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.gallery__section-title {
  margin: 0 0 var(--ui-space-1);
  font-size: 1.1em;
  font-weight: 600;
  color: var(--ui-fg);
}

.gallery__section-desc {
  margin: 0 0 var(--ui-space-3);
  font-size: 0.9em;
  color: var(--ui-fg-muted);
}

.gallery__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ui-space-4);
}

.gallery__grid--stack {
  grid-template-columns: minmax(0, 1fr);
}

.gallery__grid--halves {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.gallery__item {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.gallery__item--wide {
  max-width: var(--ui-form-max-width);
}

.gallery__label {
  font-size: 0.9em;
  color: var(--ui-fg-muted);
}

.gallery__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ui-space-2);
}

.gallery__row--block {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ui-space-2);
}

.gallery__card {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: var(--ui-space-4);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-surface);
}

.gallery__card-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--ui-space-2);
  margin-top: var(--ui-space-4);
}

/* 窄 Webview（侧边栏拖窄 / 小窗口分屏）：两列画廊网格折单列（U-4） */
@media (max-width: 640px) {
  .gallery__grid,
  .gallery__grid--halves {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
