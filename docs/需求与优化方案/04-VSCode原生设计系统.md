# 04 · VSCode 原生设计系统

> 目标：让 Vue 3 组件在视觉与交互上**尽可能与 VSCode 宿主原生界面一致**（NFR-11）。
> 原则：组件只消费**语义令牌**；语义令牌唯一职责是映射 `--vscode-*` 主题变量。
> 本文档是组件实现与视觉验收的**唯一基准**；实现任务见 [05](05-优化方案与路线图.md) M3。

## 1. 设计原则

1. **融入宿主**：不做独立品牌视觉；颜色 / 字体 / 间距 / 控件尺寸对齐 VSCode 惯例；
2. **令牌驱动**：组件内禁止出现 `#hex` / `rgb()` / `hsl()`；高对比度主题因此自动可用；
3. **状态完整**：每个交互控件覆盖 默认 / hover / focus / active / disabled / invalid（+ loading，如适用）；
4. **动效克制**：仅 0.1s 颜色 / 边框过渡；尊重 `prefers-reduced-motion`；无阴影、无渐变、无入场动画；
5. **键盘优先**：所有操作可键盘完成；焦点环始终可见；
6. **反馈闭环**：成功「已…」、失败可修正（行内 + 字段定位）、危险操作动词与按钮同名。

## 2. 语义令牌表（`src/webview/ui/tokens.css`）

组件**只允许**使用左列 `--ui-*`；右列为映射来源（含必要回退）。

| 语义令牌                                                | 映射 `--vscode-*`                                                 | 用途                          |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| `--ui-fg`                                               | `foreground`                                                      | 正文文字                      |
| `--ui-fg-muted`                                         | `descriptionForeground`                                           | 次要文字 / 提示               |
| `--ui-fg-disabled`                                      | `disabledForeground`                                              | 禁用文字                      |
| `--ui-bg`                                               | `editor-background`                                               | 页面背景（body 透明继承亦可） |
| `--ui-surface`                                          | `editorWidget-background`（回退 `editor-background`）             | 卡片 / 分组面板               |
| `--ui-surface-hover`                                    | `list-hoverBackground`                                            | 列表 / 工具栏项 hover         |
| `--ui-surface-selected`                                 | `list-activeSelectionBackground`                                  | 选中态                        |
| `--ui-fg-selected`                                      | `list-activeSelectionForeground`                                  | 选中文字                      |
| `--ui-border`                                           | `widget-border`（回退 `panel-border`）                            | 分隔线 / 卡片描边             |
| `--ui-input-bg`                                         | `input-background`                                                | 输入控件背景                  |
| `--ui-input-fg`                                         | `input-foreground`                                                | 输入文字                      |
| `--ui-input-border`                                     | `input-border`（可 `transparent`）                                | 输入描边                      |
| `--ui-input-placeholder`                                | `input-placeholderForeground`                                     | 占位符                        |
| `--ui-btn-bg`                                           | `button-background`                                               | 主按钮                        |
| `--ui-btn-fg`                                           | `button-foreground`                                               | 主按钮文字                    |
| `--ui-btn-bg-hover`                                     | `button-hoverBackground`                                          | 主按钮 hover                  |
| `--ui-btn2-bg` / `--ui-btn2-fg` / `--ui-btn2-hover`     | `button-secondaryBackground` / `-Foreground` / `-HoverBackground` | 次按钮                        |
| `--ui-focus`                                            | `focusBorder`                                                     | 焦点环                        |
| `--ui-error`                                            | `errorForeground`                                                 | 错误文字 / 必填星号           |
| `--ui-error-border` / `--ui-error-bg`                   | `inputValidation-errorBorder` / `-errorBackground`                | 校验错误态                    |
| `--ui-check-bg` / `--ui-check-border` / `--ui-check-fg` | `checkbox-background` / `checkbox-border` / `checkbox-foreground` | 复选框                        |
| `--ui-badge-bg` / `--ui-badge-fg`                       | `badge-background` / `badge-foreground`                           | 计数徽标                      |
| `--ui-link` / `--ui-link-active`                        | `textLink-foreground` / `textLink-activeForeground`               | 链接                          |
| `--ui-kbd-border` / `--ui-kbd-bg` / `--ui-kbd-fg`       | `keybindingLabel-border` / `-background` / `-foreground`          | 键帽提示                      |
| `--ui-font`                                             | `font-family`                                                     | 全局字体                      |
| `--ui-font-size`                                        | `font-size`（回退 13px）                                          | 正文字号                      |
| `--ui-motion`                                           | `0.1s ease`（常量）                                               | 过渡                          |

> 令牌文件是**唯一**允许出现颜色回退值（如 `rgba(128,128,128,.35)`）的地方；现状 `formHtml.ts:187,190` 的散落 rgba 在迁移时收敛至此。

## 3. 基础规格（尺寸 / 字阶 / 间距）

| 项       | 值                                                                    |
| -------- | --------------------------------------------------------------------- |
| 控件高度 | 26px（checkbox 15px；textarea 最小 76px、可纵向缩放）                 |
| 圆角     | 2px（键帽 3px）                                                       |
| 正文字号 | `--ui-font-size`（13px）；行高 1.5                                    |
| 标题     | 1.3em / 600；提示文字 0.9em（`--ui-fg-muted`）                        |
| 间距刻度 | 4 / 8 / 12 / 16 / 24（禁止 5/6/10/14/18/20/28 等杂值）                |
| 焦点     | `outline: 1px solid var(--ui-focus)`，输入框 offset -1、按钮 offset 1 |
| 过渡     | `border-color var(--ui-motion), background-color var(--ui-motion)`    |
| 内边距   | 输入 `4px 8px`；按钮 `4px 14px`（min-width 72px）                     |

## 4. 组件清单与规格

命名前缀 `V`（`VButton`…），位于 `src/webview/ui/`；每个组件必须登记进**组件画廊**并附带状态矩阵用例。

### 4.1 VButton

- Props：`variant: 'primary' | 'secondary' | 'icon'`、`disabled`、`loading`（loading 时禁用 + spinner codicon）。
- 规则：主按钮在右；icon 变体 22×22、无文字；hover 仅变色。
- 验收：三变体 × {默认 / hover / focus / disabled / loading}。

### 4.2 VInput / VTextarea

- Props：`modelValue`、`placeholder`、`invalid`、`disabled`、`maxlength`。
- 规则：背景 / 文字 / 占位符走输入令牌；`invalid` 时描边与焦点环切 `--ui-error-border`。
- 验收：{默认 / focus / invalid / disabled}；placeholder 对比度。

### 4.3 VSelect（ADR-08 分两阶段）

- 一阶段：原生 `<select>` + 输入令牌（功能与基础视觉一致）；
- 二阶段（仅当画廊验收不达标）：自研 listbox（键盘 ↑↓/Enter/Esc、`role="listbox"/"option"`、`aria-activedescendant`）或引入 VSCode Elements 包装。
- 验收：键盘全程可达；选中态 / hover / focus。

### 4.4 VCheckbox

- 15px；`accent-color: var(--vscode-checkbox-select-background, var(--ui-focus))`；label 布局 `gap: 8px`、600 字重。

### 4.5 VFormField（表单语义容器）

- 结构：`<label>`（必填星号 `--ui-error`）+ 控件 + `hint`（0.9em muted）+ 错误行（`role="alert"`）。
- 可访问性：错误时控件 `aria-invalid="true"`、`aria-describedby` 指向错误 / 提示节点 id。
- 这是 SchemaForm 每个字段的强制包装。

### 4.6 VToolbar

- 横排 `gap: 8px`；图标按钮 hover 背景 `--ui-surface-hover`；分隔符 1px `--ui-border`。

### 4.7 VEmptyState / VLoading

- EmptyState：居中、muted 文案 + 一个主行动按钮；
- Loading：`sync~spin` codicon 旋转（`@media (prefers-reduced-motion: reduce)` 时停止旋转、改为静态文字）。

### 4.8 VBadge

- `--ui-badge-bg/fg`，最小宽度、圆角 2px，用于过滤匹配计数等。

### 4.9 VTable（M4 后按需，复杂页用）

- 表头 600 / muted；行 hover `--ui-surface-hover`；选中 `--ui-surface-selected` + `--ui-fg-selected`；行高 26px；支持空态与加载态插槽。

### 4.10 SchemaForm + 字段组件（`src/webview/components/`）

- `SchemaForm.vue`：props `schema: FieldDef[]`、`modelValue`、`errors: Record<string, string>`；按 `field.type` 从注册表取字段组件（text / textarea / select / tags / boolean）；
- 字段组件全部包在 `VFormField` 内；tags 输入解析分隔符 `, ，;；、`（沿用现状语义）；
- 键盘：`Esc` 取消、`Ctrl+Enter` 提交、`event.isComposing` 时忽略（修复 W3）；打开聚焦首字段；
- 提交在途禁用按钮，超时 10s 自动恢复并提示（修复 W8）。

### 4.11 AppShell（页面骨架）

- header（标题 1.3em + 副标题 muted + 底部 1px 分隔）+ 内容区 + actions（右对齐）；
- 表单页内容宽 560px 居中；向导 / 设置页 720–960px。

## 5. 布局模式

| 页面类型           | 宽度           | 结构                                                |
| ------------------ | -------------- | --------------------------------------------------- |
| 表单页（条目表单） | 560px 单栏居中 | AppShell + SchemaForm + actions（取消/保存）        |
| 设置页（特性配置） | 720px          | 分组卡片（`--ui-surface` + 1px 边框）+ 开关列表     |
| 向导页（批量导入） | 960px          | 步骤条（muted 当前高亮）+ 内容 + 上一步/下一步/执行 |
| 画廊页（开发）     | 全宽           | 组件 × 状态 × 主题区块网格                          |

## 6. 图标策略（ADR-13）

- 统一 `@vscode/codicons` 字体：`<span class="codicon codicon-add">`；CSP `font-src ${cspSource}`；
- 语义图标映射集中在 `src/webview/ui/iconNames.ts`（对齐宿主侧 `src/ui/icons.ts` 的同一概念同名图标，修复 E8「图标散落」）；
- 禁止在组件内手写 `$(xxx)` 字面量或引入其他图标库。

## 7. 主题与对比度矩阵（视觉验收范围）

每个组件必须通过以下矩阵（画廊页逐一勾选）：

| 维度 | 取值                                                         |
| ---- | ------------------------------------------------------------ |
| 主题 | Dark+ / Light+ / High Contrast                               |
| 状态 | 默认 / hover / focus / active / disabled / invalid / loading |
| 缩放 | 100% / 150%（VSCode 窗口缩放）                               |
| 动效 | 开启 / `prefers-reduced-motion`                              |

硬性检查项：焦点环在三种主题下均可见；错误态不依赖单一颜色（有文字 + 图标）；深浅色下占位符对比度可读。

## 8. 组件画廊（`gallery` 页面）

- 入口：开发命令 `CRUD Starter: 打开组件画廊`（`package.json` 注册，`when` 可加开发约束说明）；
- 内容：每个组件一节，渲染全部状态；顶部主题说明（跟随宿主主题切换实时变化）；
- 用途：M3 验收基准 + 后续 Playwright 截图回归的拍摄对象（可选，见 05-M6）。

## 9. 样式门禁规则（进入 `scripts/gate.ts`，M3-T3.4）

1. `src/webview/**`（除 `ui/tokens.css`）禁止 `#[0-9a-fA-F]{3,8}\b`、`rgb(`、`hsl(`；
2. 禁止 `v-html`、`innerHTML`（`dangerously`）赋值；
3. 禁止 import Element Plus / Vuetify / Ant Design / Tailwind（导入白名单：`vue`、`@vscode/codicons`、项目内模块）;
4. 间距值白名单（4/8/12/16/24，`padding/margin/gap` 上下文）——超出需在令牌文件登记新刻度；
5. `dist/webview/**` 产物扫描：无 `eval(`、`new Function(`、`unsafe-eval`、`unsafe-inline`。

## 10. 与现有 README「UI 风格约定」的衔接

- 现约定（颜色零硬编码 / 单一字体 / 图标统一 / 布局刻度 / 主按钮右 / 动效克制 / 反馈闭环 / 键盘可达）**全部保留**并升级为本文档的可执行规格；
- 修订点：提示文字 0.9em 与间距刻度从「口头约定」变为门禁规则；`media/icon.svg` 的硬编码色作为活动栏图标例外在 README 标注（VSCode 不主题化该图标）；
- M4 完成后同步改写 README 该节为「见 docs/需求与优化方案/04」（并保留速览表）。
