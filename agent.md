# agent.md — AI 编码代理工作约定

> 本文件是 AI 编码代理在本仓库（vscode-starter-template）工作时的**强制约定**。
> 任何会话中修改代码 / 配置 / 文档之前，先读完本文件再动手。

## 项目概述

- **是什么**：VSCode 插件初始化项目（模板）。示例插件提供界面化增删改查（侧边栏树视图 +
  Webview Schema 表单 + 全套菜单/右键菜单示例），外加四个功能页面（环境初始化 / 特性配置 /
  静态配置 / 分支编译出包）与启动任务框架（环境检测）。
- **技术栈**：TypeScript（strict）+ esbuild 打包 + mocha/@vscode/test-electron 集成测试。
- **仓库**：https://github.com/taoweidong/vscode-starter-template
- **扩展内品牌**：CRUD Starter（视图名 / 命令分类 / 输出通道），与项目名是两层概念，勿混改。

## 一键式质量门禁（强制）

```bash
npm run gate
```

- **协议：每次对话结束前必须执行。** 只要本轮改过代码 / 配置 / 文档，收尾前先跑门禁；
  全部步骤通过后才允许向用户报告「完成」或执行 `git commit` / `git push`。
- 门禁内容（`tsx scripts/gate.ts`，fail-fast，`--fast` 跳过宿主集成测试）：
  ① Lint 与格式检查（eslint / prettier）→ ② 类型检查（tsc strict + vue-tsc）→
  ③ 宿主生产构建（esbuild）→ ④ Webview 构建（vite build）→ ⑤ 测试编译 →
  ⑥ 静态一致性检查（package.json 清单 ↔ src/constants.ts ↔ 视图 when ↔ 命令注册 ↔
  特性开关 ↔ 图标，见 `scripts/checks/manifest.ts`；结构校验、不含项目身份断言）→
  ⑦ 单元测试（Vitest + 覆盖率阈值，不启动 VSCode）→ ⑧ 宿主集成测试（@vscode/test-electron）。
- **首次运行会自动下载测试用 VS Code**（约 1GB，缓存在 `.vscode-test/`，已被 gitignore），
  之后复用缓存，属正常现象。
- 任一步骤失败：修复后重跑；确实无法修复时，必须在交付说明中如实披露失败步骤与原因，
  禁止静默跳过或伪造通过。
- 提交规约：Conventional Commits（feat / fix / chore / test / docs / refactor），
  提交前 `git status` 确认无意外文件；推送直接 `git push origin main`（凭据走 GCM，
  不要把 token 写进任何命令或文件）。

## 单元测试协议（强制）

- **每一轮对话结束前、每一次 `git commit` 之前，必须执行并通过单元测试**，作为门禁协议的前置要求：
  - 日常对话轮次：`npm run test:unit`（Vitest，不下载 VS Code，全量目标 < 30s，当前约 210+ 用例 / 5s）；
  - 提交前 / 收尾前：完整 `npm run gate`（快速迭代可用 `npm run gate -- --fast` 跳过宿主集成测试）。
- **新增代码必须优先补充单元测试**：新增模块 / 命令 / 服务方法 / Webview 组件时，
  随代码一并提交对应测试用例（先写用例再实现）；修复 bug 必须先编写能复现问题的
  测试，再修复并保证用例通过。
- 测试不得跳过、注释或伪造通过；确实无法测试的代码，先重构可测性再交付。
- 单元测试写在 `src/test/unit/**/*.spec.ts`；`vscode` 模块由 `vitest.config.ts` 的
  alias 指向 `src/test/unit/stubs/vscode.ts` 测试桩（含 EventEmitter / window 录制器 /
  workspace.fs / getConfiguration / watcher 桩），只许增量扩展、不得删除已有导出。
- 测试分层、工具与覆盖率阈值见 `docs/需求与优化方案/01-需求细化.md`（NFR-07）与
  `03-技术选型与架构.md`（§6 测试架构）。

## 架构分层（改代码前对照）

```
models（数据模型）→ domain（领域 Schema：字段定义驱动校验与表单）→ services（业务/校验/事件）
    → stores（IItemStore 可替换数据源）
    ↑                                        ↓
providers（树视图 / Webview 面板） ← commands（命令注册，deps 对象注入） ← extension.ts（组装）
tasks/（启动任务框架：StartupTask 注册表 + TaskRunner 调度）
features/（功能页面：init / featureConfig / staticConfig / build，每目录一种 UI 模式示例）
webview/（Vue 3 页面：host 宿主控制器 + components SchemaForm + apps 页面 + ui 设计系统）
```

### 硬性规约

1. **单一来源**：命令 ID / 视图 ID / 配置键只在 `src/constants.ts` 定义，
   `package.json` 的 contributes 必须与之同步（门禁第 ⑥ 步会校验，新增命令三处缺一不可：
   constants → package.json → commands/index.ts 的 `register(COMMAND.xxx`）。
2. **领域 Schema 单一来源**：`src/domain/itemSchema.ts` 驱动校验与表单（`FORM_SCHEMA`
   由 `ITEM_FIELD_DEFS` 派生）；Webview 页面 Vue 3 组件化（`src/webview`），
   禁止在页面硬编码业务字段。
3. **图标语言**：codicon 一律走 `src/ui/icons.ts` 映射表，同一概念全插件同图标。
4. **UI 规约**：颜色只用 `--vscode-*` 主题令牌；主按钮在右；动效仅 0.1s hover/focus；
   成功反馈以「已…」开头并受 `successNotifications` 开关约束（详见 README「UI 风格约定」）。
5. **右键菜单传参**：`view/item/context` 命令第一个参数是树节点元素（需 `toItem()` 归一化），
   第二个参数是多选集合；`TreeItem.command` 传的才是原始对象。
6. **shell 拼接外部输入前必须白名单校验**（先例：分支名 `BRANCH_NAME_PATTERN`）。
7. **测试卫生**：测试创建的临时目录必须在 `finally` 中 `fs.rmSync` 清理。

## 常用命令

| 命令                   | 用途                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `npm run gate`         | 一键式质量门禁（提交 / 收尾必跑；`-- --fast` 跳过宿主集成） |
| `npm run test:unit`    | 快速单元测试（Vitest，不启动 VSCode，日常每轮必跑）         |
| `npm run test:e2e`     | Webview 页面测试（Playwright + Edge，先构建 Webview）       |
| `npm run lint`         | ESLint 检查（flat config，eslint.config.ts）                |
| `npm run format:check` | Prettier 格式检查（`npm run format` 一键修复）              |
| `npm run compile`      | 类型检查（tsc + vue-tsc）+ 宿主构建 + Webview 构建          |
| `npm run watch`        | 宿主构建监听模式（调试时用）                                |
| `npm run package`      | 类型检查 + 生产构建（宿主 + Webview）                       |
| `npm run package:vsix` | 一键打包离线 .vsix（免全局安装 vsce）                       |
| `npm test`             | 仅跑宿主集成测试（需 .vscode-test 缓存）                    |
| `F5`（VSCode）         | 启动扩展开发宿主调试                                        |

## 已知事项

- 集成测试依赖 `.vscode-test/` 缓存；删除后首次门禁/测试会重新下载 VS Code。
- 数据文件与静态配置被外部修改时由 FileSystemWatcher 自动刷新
  （受特性开关 `autoRefreshOnExternalChange` 控制）。
- 发布到市场前：改 `publisher` 与 `repository` 即可（LICENSE / 128×128 图标 / categories
  等元数据已就绪，图标可用 `npx tsx scripts/generate-icon.ts` 从 SVG 重新生成）。
- 未打开工作区时数据退回全局存储（MementoStore），属预期行为。
- CI（`.github/workflows/ci.yml`）：Windows 跑完整门禁 + Playwright e2e；Ubuntu 跑
  `gate -- --fast`（宿主集成需 GUI）。
