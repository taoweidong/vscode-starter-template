# CRUD Starter

一个 **VSCode 插件初始化项目（模板）**：提供界面化的增删改查（CRUD）操作，架构分层清晰、数据源可替换，适合作为「管理某类数据」的插件起点（例如任务清单、接口集合、代码片段库、链接收藏等），克隆后改一改数据模型就能变成你自己的插件。

> 📚 **详细操作指导**（环境准备 / 克隆代码 / 调试步骤 / 二次开发，含 8 张示意图）：
> 见 [`docs/操作指导/`](https://github.com/taoweidong/vscode-starter-template/blob/main/docs/操作指导/README.md)；AI 编码代理请先读 [`agent.md`](https://github.com/taoweidong/vscode-starter-template/blob/main/agent.md)。
>
> 🎯 **需求与优化方案**（需求细化 / 缺陷分析 / 技术选型 / 设计系统 / 路线图）：
> 见 [`docs/需求与优化方案/`](https://github.com/taoweidong/vscode-starter-template/blob/main/docs/需求与优化方案/README.md——已确认技术方向：
> TypeScript 全量化 + Webview 页面 Vue 3 + VSCode 原生设计系统 + 全量单元测试协议 + 一键打包离线 .vsix。

## 功能一览

| 操作       | 入口                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 查（列表） | 侧边栏树视图：按分类分组、优先级图标、悬停详情；标题栏 🔍 支持关键字过滤（名称/分类/描述/标签）                                                                           |
| 增         | 视图标题栏 ＋ 按钮，或命令面板 `CRUD Starter: 新增条目`，弹出 Webview 表单                                                                                                |
| 改         | 单击树条目 / 右键「编辑条目」，弹出表单并自动回填                                                                                                                         |
| 删         | 右键「删除条目」，带模态二次确认                                                                                                                                          |
| 克隆       | 右键「克隆条目」，一键复制                                                                                                                                                |
| 其他       | 刷新列表、打开数据文件；数据文件被手工修改后自动刷新                                                                                                                      |
| 环境信息   | 激活时自动执行环境检测脚本（Python/Node/npm/Git/系统/VSCode），结果在侧边栏「环境信息」视图与输出通道展示，标题栏 ↻ 可重新执行                                            |
| 环境初始化 | 步骤清单式页面：检查工作区 / 初始化数据文件 / 生成静态配置 / 创建产物目录 / 写入环境快照；单击执行单步，或标题栏「全部初始化」                                            |
| 特性配置   | 开关列表单击即切换（删除确认 / 成功通知 / 优先级图标 / 视图徽标 / 自动刷新），全部真实影响插件行为；标题栏可打开 Schema 表单批量编辑                                      |
| 静态配置   | 只读展示工作区 `.vscode/crud-starter.config.json`（环境初始化生成默认模板），文件修改后自动刷新                                                                           |
| 分支编译   | 展示当前分支与分支清单，单击分支执行 `npm run package` 编译出包（切换分支前检查工作区干净），检测到 vsce 时输出 `.vsix`                                                   |
| 串口控制台 | 侧边栏「串口服务器」树视图 + 独立控制台页面：录入串口服务器（串口参数/自动登录，密码加密存储）、连接后下发命令、实时输出流、历史命令自动去重（MRU）；关闭面板自动断开串口 |

表单面板特点：**Vue 3 组件化**（`SchemaForm` 由领域 Schema 驱动，字段渲染 / 校验 / 回填零特例），
视觉走自研的 VSCode 原生设计系统（语义令牌 + 基础组件，详见
[`docs/需求与优化方案/04-VSCode原生设计系统.md`](https://github.com/taoweidong/vscode-starter-template/blob/main/docs/需求与优化方案/04-VSCode原生设计系统.md)），
自动适配深浅色与高对比度主题、严格 CSP、`Esc` 取消 / `Ctrl+Enter` 保存、草稿自动恢复。

## 菜单与右键菜单示例（典型场景）

项目演示了 VSCode 全部常用菜单位置，每个入口对应一个典型业务场景：

| 菜单位置              | 入口 / 触发方式                                                                                   | 典型场景                                                                                  | 对应命令                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 视图标题栏            | 侧边栏面板右上角 ＋ / 🔍 / 刷新                                                                   | 日常新增、关键字过滤、手动刷新                                                            | `newItem` `filterItems` `refresh`                                                              |
| 树条目右键菜单        | 右键任意条目（或 Ctrl/Shift 多选后右键）                                                          | 编辑 / 克隆 / 删除，**多选后批量删除**                                                    | `editItem` `duplicateItem` `deleteItem`                                                        |
| 子菜单「设置优先级」  | 树条目右键 → 设置优先级 → 高/中/低                                                                | 多选条目后一键统一优先级                                                                  | `setPriorityHigh/Medium/Low`                                                                   |
| 子菜单「复制…」       | 树条目右键 → 复制…                                                                                | 把条目复制成 名称 / Markdown / JSON，粘贴进周报或 issue                                   | `copyName` `copyMarkdown` `copyJson`                                                           |
| 动态菜单「更多操作…」 | 树条目右键 → 更多操作…                                                                            | 用 QuickPick 实现的**可编程菜单**：菜单项可随数据动态增减，操作后菜单保持打开，`Esc` 退出 | `moreActions`                                                                                  |
| 编辑器右键菜单        | 选中一段文本 → 右键（多条目：新增条目 / 快速新增 / 追加到条目）；无选区时右键显示「登记当前文件」 | 选中 TODO 一键变条目；连续登记多条跳过表单；给已有条目补充线索；登记当前文件              | `newItemFromSelection` `quickAddFromSelection` `appendSelectionToItem` `addCurrentFileToItems` |
| 资源管理器右键菜单    | 右键文件：添加为条目 / 登记并摘录内容（前 20 行进描述）；右键文件夹：内容批量登记（上限 50 个）   | 待重构文件登记、配置文件连内容一起留档、整个目录批量导入                                  | `newItemFromFile` `newItemFromFilePreview` `newItemsFromFolder`                                |
| 编辑器标题栏          | 打开的文件页签右上角图标按钮                                                                      | 对当前打开的文件做同样的登记                                                              | `newItemFromFile`                                                                              |
| 命令面板              | `Ctrl+Shift+P` 输入 "CRUD Starter"                                                                | 无鼠标操作路径；未传参的命令会用 QuickPick 让你先选条目                                   | 全部命令                                                                                       |
| 快捷键                | `Alt+N` 新增；选中文本后 `Alt+S` 快速入条目                                                       | 键盘党快速入口（可在键盘快捷方式中修改/移除）                                             | `newItem` `newItemFromSelection`                                                               |

### 菜单开发要点（示例中的关键模式）

1. **右键菜单传参约定**：`view/item/context` 菜单的命令会收到两个参数——被右键的**树节点元素**和**当前多选集合**：

   ```ts
   register(COMMAND.deleteItem, async (arg?: unknown, selected?: unknown[]) => {
     const targets = collectTargets(arg, selected); // 归一化 + 去重 → 批量目标
     ...
   });
   ```

   注意树条目的 `TreeItem.command`（单击触发）传的是原始 `Item`，而右键菜单传的是树节点（`ItemNode`），两者用 `toItem()` 归一化，这是树视图命令最常见的坑。

2. **子菜单**：在 `package.json` 的 `contributes.submenus` 声明，再把它挂进 `contributes.menus["view/item/context"]`（`"submenu": "extStarter.priorityMenu"`），子菜单自己的菜单项在 `menus["extStarter.priorityMenu"]` 里声明。

3. **按上下文显示**：`when` 子句控制菜单出现时机——树条目菜单用 `viewItem == crudItem`（对应 `TreeItem.contextValue`），编辑器选区菜单用 `editorTextFocus && editorHasSelection`。

4. **动态菜单**：静态菜单满足不了时（菜单项要显示当前值、要随状态增减），用 `showQuickPick` 自己画菜单，见 `moreActions` 命令——这是插件开发中「模拟菜单」的标准做法。

5. **批量操作**：树视图需 `createTreeView(id, { canSelectMany: true })`，命令的第二个参数才是多选集合。

## UI 风格约定

扩展的 UI 目标是「像 VSCode 团队自己出品的一样」，后续增改界面时请遵守以下约定：

| 约定           | 做法                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 颜色零硬编码   | 只使用 `--vscode-*` 主题令牌（输入框、按钮、错误、焦点色等），自动适配深浅色与高对比度主题                                                                                                 |
| 单一字体与字阶 | 只用 `--vscode-font-family`；标题 1.3em/600，正文 13px，提示 0.9em                                                                                                                         |
| 图标语言统一   | codicon 全局唯一映射（见 `src/ui/icons.ts`）：同一优先级在树视图、QuickPick、tooltip 中是同一个图标；新增图标先加进映射表                                                                  |
| 布局刻度       | 间距只用 4/8/12/16/24；表单单栏 560px 居中；控件高度 26px、圆角 2px                                                                                                                        |
| 主按钮在右     | 确认键（保存/删除）在右侧、次要在左侧，与 VSCode 模态对话框一致                                                                                                                            |
| 动效克制       | 仅 0.1s 的 hover/focus 过渡，无阴影、无渐变、无入场动画                                                                                                                                    |
| 反馈闭环       | 成功用「已…」toast（已新增/已更新/已删除/已复制），失败给可修正的行内提示；确认弹窗按钮动词与操作同名                                                                                      |
| 键盘可达       | 表单 `Esc` 取消、`Ctrl+Enter` 保存、打开即聚焦首字段；QuickPick/输入框均有 `Esc` 退出约定                                                                                                  |
| 设计系统基线   | 全部令牌 / 组件规格与状态矩阵见 [04 · VSCode 原生设计系统](https://github.com/taoweidong/vscode-starter-template/blob/main/docs/需求与优化方案/04-VSCode原生设计系统.md)，画廊页可实时巡检 |

## 快速开始

环境要求：Node.js ≥ 20.19（开发工具链）、VSCode ≥ 1.85。

```bash
npm install
npm run gate      # 一键式质量门禁：lint/格式→类型→双构建→静态一致性→单测(覆盖率)→集成（推荐先跑）
```

然后**用 VSCode 打开本项目文件夹，按 `F5`** 即可启动调试窗口：

> AI 编码代理请先阅读根目录的 `agent.md`——其中包含单元测试与质量门禁的强制协议。

调试窗口中的体验路径：

1. 活动栏出现「CRUD Starter」图标，点击进入侧边栏（共 6 个视图）；
2. 点击标题栏 ＋ 新增条目，体验表单界面；
3. 数据默认保存在工作区的 `.vscode/crud-starter-items.json`（路径可用设置 `extStarter.storagePath` 修改，仅允许工作区内相对路径）。

其他常用脚本：

```bash
npm run compile       # 类型检查（tsc + vue-tsc）+ 宿主构建 + Webview 构建
npm run watch         # 宿主构建监听模式（调试时配合使用）
npm run package       # 生产构建（宿主 + Webview）
npm run test:unit     # 快速单元测试（Vitest，不启动 VSCode，秒级）
npm test              # 仅运行宿主集成测试（首次会自动下载测试用 VSCode，耗时较长）
npm run test:e2e      # Webview 页面测试（Playwright + Edge，需先构建 Webview）
npm run lint          # ESLint 检查（eslint .）
npm run format:check  # Prettier 格式检查（format 可一键修复）
npm run package:vsix  # 一键打包离线 .vsix（内置 vsce，免全局安装）
```

## 目录结构与架构

```
vscode-starter-template/
├── package.json                  # 插件清单：命令、视图、菜单、配置（与 src/constants.ts 对应）
├── vite.config.ts                # Webview（Vue 3）构建：多入口 + manifest
├── vitest.config.ts              # 单元 / 组件测试（Vitest + vscode 测试桩）
├── scripts/                      # 构建与门禁脚本（build-extension.ts / gate.ts，TypeScript）
├── media/icon.svg                # 活动栏图标
└── src/
    ├── extension.ts              # 入口：组装数据源 → 服务 → 视图 → 命令
    ├── constants.ts              # 命令/视图/配置 ID 的单一来源
    ├── models/
    │   ├── item.ts               # 数据模型 Item / ItemDraft（加字段的类型提示，可选）
    │   └── itemGuard.ts          # 加载守卫：坏条目隔离、默认值补齐、重复 id 处理
    ├── domain/
    │   └── itemSchema.ts         # ★ 领域 Schema 单一来源：字段定义驱动校验与表单（加字段从这开始）
    ├── services/
    │   ├── itemService.ts        # 业务层：校验、清洗、时间戳、过滤、批量 API、变更事件
    │   ├── storageController.ts  # 存储生命周期：工作区/配置变化时重建 store 与 watcher
    │   ├── storagePath.ts        # storagePath 白名单校验（拒绝对路径 / .. / glob）
    │   └── stores/
    │       ├── itemStore.ts      # ★ IItemStore 数据源接口（可替换点）
    │       ├── jsonFileStore.ts  #   默认实现：工作区 JSON 文件（原子写 + 损坏恢复）
    │       └── mementoStore.ts   #   兜底实现：未打开工作区时用全局存储
    ├── providers/
    │   ├── itemsTreeDataProvider.ts  # 侧边栏树视图（查）
    │   ├── itemFormPanel.ts          # Webview 表单面板（增/改，单例）
    │   └── environmentTreeProvider.ts # 「环境信息」视图（启动任务结果展示）
    ├── features/                     # 功能页面（每个目录 = 一种 UI 模式示例）
    │   ├── init/                     #   环境初始化：清单 + 单步动作
    │   ├── featureConfig/            #   特性配置：设置读写 + 树开关 + Schema 表单页
    │   ├── staticConfig/             #   静态配置：只读展示 + 文件联动
    │   ├── build/                    #   分支编译出包：任务自动化 + 进度
    │   └── serialConsole/            #   串口控制台：服务器存储 / 命令历史 / 串口链路 / 面板与树视图
    ├── webview/                       # Webview 页面框架（Vue 3，详见 docs/需求与优化方案/03）
    │   ├── pages.ts                   # ★ 页面注册表（新增页面在此登记）
    │   ├── protocol.ts                # 宿主 ↔ 页面消息协议与运行时守卫
    │   ├── formSchema.ts              # 表单字段 Schema（由领域 Schema 派生：ITEM_FIELD_DEFS / SERVER_FIELD_DEFS）
    │   ├── host/                      # 宿主侧：面板控制器 / HTML 外壳 / 资源解析
    │   ├── ui/                        # VSCode 原生设计系统（语义令牌 + 基础组件）
    │   ├── components/                # SchemaForm + 五类字段组件（领域 Schema 驱动）
    │   └── apps/                      # 页面（itemForm / featureConfig / importWizard / gallery / serialConsole）
    ├── tasks/
    │   ├── types.ts                  # StartupTask / TaskResult 接口（扩展点）
    │   ├── taskRegistry.ts           # ★ 启动任务注册表（新增任务只改这里）
    │   ├── taskRunner.ts             # 调度器：顺序执行、异常降级、事件通知
    │   └── environmentTask.ts        # 内置任务：环境检测（Python/Node/npm/Git…）
    ├── ui/
    │   └── icons.ts                  # codicon 全局映射（图标语言统一）
    └── test/                         # 集成测试（mocha + @vscode/test-electron）
```

数据流（单向）：

```
树视图 / 表单 / 命令
        │  调用
        ▼
   ItemService（校验 + 业务规则，发 onDidChangeItems 事件）
        │  读写
        ▼
   IItemStore（可替换的数据源）
        ▲
        └── FileSystemWatcher：文件被外部修改 → service.reload() → 视图自动刷新
```

## 如何扩展

### 1. 给数据模型和表单加字段（领域 Schema 单一来源）

以加一个「负责人 owner」文本字段为例，只需一处：

1. `src/domain/itemSchema.ts`：在 `ITEM_FIELD_DEFS` 中加一行
   `{ key: 'owner', type: 'text', label: '负责人', placeholder: '选填' }`；
2. 完成。表单渲染（`FORM_SCHEMA` 自动派生）、取值、回填、校验、克隆、批量操作全部自动跟随；
   若想要更强的类型提示，可选地在 `src/models/item.ts` 的 `Item` / `ItemDraft` 补上 `owner: string`。

字段类型支持 `text` / `textarea` / `select` / `tags` / `boolean`；要加新控件类型，
在 `src/webview/components/fields/` 加一个字段组件并在 `SchemaForm` 注册分发。
未在字段表中声明的 string / number / boolean 字段也会被透传保留（不会被白名单丢弃）；
若需要迁移旧数据，在 `JsonFileStore.load()` 返回前补默认值即可。

### 2. 新增一个命令

1. `src/constants.ts` 的 `COMMAND` 中加 ID；
2. `package.json` 的 `contributes.commands`（需要按钮就同时配 `menus`）加声明；
3. `src/commands/index.ts` 中 `register(COMMAND.xxx, async () => { ... })` 写实现。

### 3. 更换数据源（接 API / 数据库）

实现 `IItemStore` 的 `load()` / `save()` 两个方法即可，例如接 REST API：

```ts
export class ApiStore implements IItemStore {
  constructor(private readonly baseUrl: string) {}
  async load(): Promise<Item[]> {
    const res = await fetch(`${this.baseUrl}/items`)
    return res.json() as Promise<Item[]>
  }
  async save(items: Item[]): Promise<void> {
    await fetch(`${this.baseUrl}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    })
  }
}
```

然后在 `src/extension.ts` 的 `createStore()` 中返回 `new ApiStore(...)`。业务层、树视图、表单完全不用改。

> 提示：若数据量大，建议同时把 `ItemService` 的「读-改-全量写」改为按 ID 增删改。
> 「打开数据文件」等命令通过 `getStore()` 动态获取当前数据源实例（StorageController 在
> 工作区 / 配置变化时原地重建 store，命令引用不失效），换源后无需改动命令层。

### 4. 新增启动任务（环境检测 / 动作类脚本）

启动任务在插件激活时由 `TaskRunner` 自动调度，结果自动出现在「环境信息」视图：

1. 在 `src/tasks/` 下新建任务文件，实现 `StartupTask` 接口（`id` / `title` / `run(): Promise<TaskResult>`）；
2. 在 `src/tasks/taskRegistry.ts` 的 `TASKS` 数组中加一项。

内置的 `environmentTask`（环境检测）是完整示例：用 `execCapture()` 探测命令版本，逐项产出
`TaskItem`（label/description/status）。后续「动作类」任务（如同步数据、初始化配置、执行构建）只需
在 `run()` 里执行相应动作并返回结果摘要——调度、异常降级、输出通道、树视图展示全部自动生效。
若不想在启动时自动执行，把结果写入 `package.json` 的 `extStarter.runStartupTasks` 配置判断即可
（框架已内置该开关）。

### 5. 打包发布

```bash
npm run package:vsix   # 一键：类型检查 + 生产构建 + vsce package --no-dependencies，产出 .vsix
```

- vsce（`@vscode/vsce`）已内置在 devDependencies，**无需全局安装**；
- 产物为仓库根目录的 `<name>-<version>.vsix`（已被 `.gitignore` 排除）；
- 离线验证：扩展面板 `…` → `从 VSIX 安装…` → 选择生成的 .vsix，逐个打开功能页面确认可用。

发布到市场（需 publisher 账号 + PAT）：

```bash
npx vsce publish
```

发布前记得：修改 `package.json` 的 `publisher` 与 `repository`（LICENSE / 图标 / categories 等
元数据已随模板就绪）。

## 说明与已知限制

- 「读-改-全量写」的存储模型适合个人规模数据（数百条以内）；数据量大或多人协作时请实现自己的 `IItemStore`。
- 未打开任何工作区时，数据退回 VSCode 全局存储（`MementoStore`），「打开数据文件」命令会给出提示。
- `npm test` / 完整 `npm run gate` 首次运行会下载独立的测试版 VS Code（实测约 1GB，
  缓存在 `.vscode-test/` 复用；只要类型检查时用 `npm run check-types` 即可）。
- Webview 页面基于 Vue 3（runtime-only，经 Vite 构建），但**未引入通用 UI 框架 / toolkit**——
  组件为自研的 VSCode 原生设计系统；扩展宿主（Node 侧）运行时依赖仅 `serialport`
  （串口控制台功能，N-API 预编译跨平台，经 `.vscodeignore` 否定项随 vsix 分发；
  设计详见 `docs/superpowers/specs/2026-10-24-serial-command-console-design.md`）。
- 串口命令历史为全局共享（跨服务器复用）：trim 后精确去重、MRU 置顶、上限 200 条；
  登录密码只存 VSCode SecretStorage，数据文件与日志零明文。
- 发布元数据已就绪：LICENSE（MIT）、128×128 图标（`media/icon.png`，可用
  `npx tsx scripts/generate-icon.ts` 从 SVG 重新生成）、`categories` / `homepage` / `bugs`。
