# 串口服务器命令控制台 设计文档

> 依据 superpowers:brainstorming 方法论产出。日期：2026-10-24。状态：已获用户批准（方案评审通过）。

## 1. 意图与为什么

实验室中的服务器通过本机物理串口（USB-Serial / COM 口）进行带外管理。运维人员目前需要在外部终端工具（PuTTY 等）与 VSCode 之间来回切换，且命令历史分散、无法沉淀。

本功能在扩展内提供一站式的串口控制台：**录入服务器（串口）信息 → 连接 → 下发命令 → 实时查看输出**，并自动沉淀去重后的历史命令，供一键复用。

## 2. 目标 / 非目标 / 反目标

**目标**

- FR-1 服务器信息录入：新增/编辑/删除串口服务器条目（名称、串口号、波特率等串口参数），持久化到工作区。
- FR-2 串口命令下发：连接后向串口写入命令（自动追加换行符），UTF-8 文本输出实时回流。
- FR-3 历史命令记录（自动去重）：全局历史，trim 后精确匹配去重，重复发送移至顶部（MRU）并累计次数，上限 200 条。
- FR-4 实时显示结果：控制台页面流式输出，自动滚动（可暂停）、清空、断开。
- FR-5 独立页面与菜单：侧边栏「串口服务器」树视图 + 独立 Webview 控制台页面。

**非目标（本期不做）**

- 多串口并发会话（v1 单活动连接）。
- HEX/二进制视图、日志导出文件。
- 按服务器隔离的历史（采用全局共享 + 搜索过滤）。
- 网络 TCP 串口服务器通道（架构预留传输抽象，便于后续扩展）。

**反目标**

- 密码绝不以明文落盘（只进 SecretStorage），绝不出现在日志/输出通道。
- 不破坏既有 itemStore / 表单 / 门禁链路的任何现有行为。

## 3. 约束

- 遵循模板既有模式：pages.ts 注册表新增页面、protocol.ts 只追加消息分支、constants ↔ package.json ↔ src/commands 三处闭合、featureFlags ↔ 配置双向一致。
- serialport 为项目**首个生产依赖**，引入后必须适配：esbuild external、.vscodeignore 否定项、vsce 打包、门禁第 9 步。
- serialport 锁定 **^12.0.0**：要求 Node ≥ 16，兼容 engines.vscode ^1.85（Node 18 宿主）；13.x 要求 Node ≥ 20，需抬高 VSCode 最低版本，不采用。N-API prebuild 跨 Node 版本 ABI 稳定。
- 单元测试与 CI 不得加载原生模块（传输抽象注入 FakeFactory）。
- Webview 侧禁止 import Node/DOM 之外的宿主 API；协议文件保持两侧共用纯数据。

## 4. 方案（Approaches）

### A1 串口通道（已选：本机物理串口 COM）

| 方案 | 取舍 |
| --- | --- |
| **COM（选定）** | serialport 原生模块 + N-API prebuild；服务器信息=名称+串口参数；需适配打包链路 |
| TCP 串口服务器 | 零原生依赖，但不符合用户现场（设备直连本机串口） |
| 两者都支持 | 传输层抽象可后续再加，本期 YAGNI |

### A2 密码存储（已选：SecretStorage）

| 方案 | 取舍 |
| --- | --- |
| **SecretStorage（选定）** | 系统级加密（DPAPI/Keychain），密码不落工作区文件 |
| 明文 JSON | 便于迁移但密码明文，反目标 |
| 不存凭据 | 每次手输，体验差 |

### A3 界面形态（已选：侧边栏树视图 + 独立控制台页面）

| 方案 | 取舍 |
| --- | --- |
| **树视图 + 控制台页（选定）** | 符合模板模式（树=列表管理，Webview=富交互），服务器随时可见 |
| 单页自包含 | 左栏管理+右栏控制台都在页面内；入口较弱 |
| 仅树视图 + QuickPick | 无实时输出区，不满足 FR-4 |

### A4 服务器增删改位置（设计决策：页内完成）

不另建独立表单面板（如 itemForm），控制台页左栏内完成列表+表单（复用 SchemaForm）；树视图的新增/编辑命令仅负责打开页面并定位。

### A5 历史去重语义（设计决策：全局 MRU）

- `record(command)`：trim → 精确匹配已存在则移至顶部 + useCount+1，否则新建置顶；
- 上限 200，超出按 lastUsedAt 淘汰最旧；页面提供搜索过滤、单条删除、清空。

## 5. 架构设计

### 5.1 数据模型

```
src/features/serialConsole/models.ts
SerialServer {
  id: string(uuid)  name: string(必填)  serialPath: string(必填, 如 COM3)
  baudRate: 115200 | 9600 | ...   dataBits: 8|7|6|5   stopBits: 1|2
  parity: none|even|odd   flowControl: none|hardware   lineEnding: lf|crlf|cr
  autoLogin: boolean(false)   username?: string   description?: string
  createdAt: number   updatedAt: number
}
```

密码不入模型。SecretStorage key：`crudStarter.serialServer.<id>.password`。

### 5.2 存储层

- `serverStore.ts`：`IServerStore { load(); save(servers) }` 双实现，镜像 itemStore 模式：
  - 工作区 `.vscode/serial-servers.json`（信封 `{schemaVersion:1, servers}`，原子写）；
  - 无工作区时 Memento 兜底（key `crudStarter.serialServers`）。
- 从 `jsonFileStore.ts` 抽取共享原子写工具复用；itemStore 行为由既有测试锁定。
- `commandHistoryService.ts`：globalState 持久化（见 A5）。

### 5.3 串口链路（可测试抽象）

```
SerialPortFactory { list(): Promise<PortInfo[]>; open(opts): SerialPortLike }
```

- 生产实现 `createRequire` 惰性 `require('serialport')`，加载失败给出可操作错误（提示平台 prebuild / npm install），不阻断扩展激活。
- `serialLinkService.ts`：单活动连接；状态机 connecting→connected→closed / error；数据 Buffer→UTF-8→30-50ms 批处理（seq 递增）回调；`send(cmd)` 追加 lineEnding；`close()` 幂等；面板 dispose 自动断开。

### 5.4 消息协议（只追加分支与守卫 case）

- Webview→Host：`serialPortsRequest` / `serialServersRequest` / `serialServerSave{draft,password?}` / `serialServerDelete{id}` / `serialConnect{serverId}` / `serialDisconnect` / `serialSend{command}` / `commandHistoryRequest` / `commandHistoryRemove{id}` / `commandHistoryClear`
- Host→Webview：`serialPorts{paths}` / `serialServers{servers}` / `serialState{serverId,state,error?}` / `serialData{seq,text}` / `commandHistory{entries}`
- 表单校验错误复用既有 `error{message,field}`；init.extra 携带 `{servers,history,persisted}`。

### 5.5 宿主侧

- `serialConsolePanel.ts`：仿 importWizardPanel 的页面专属消息编排；保存时剥离 password→SecretStorage（编辑留空=保持不变）；自动登录（可选开关）：连接后延迟 800ms 发 username、再 500ms 发 password。
- `serialServersTreeProvider.ts`：label=名称，description=`COM3 · 115200`，contextValue 随连接状态变化；标题按钮（打开控制台/新增/刷新）；右键（连接并打开控制台/编辑/删除-确认）。
- 新命令 6 个：openSerialConsole / addSerialServer / editSerialServer / deleteSerialServer / connectSerialServer / refreshSerialServers。
- 新特性开关 `crudStarter.features.serialConsole`（默认 true）。

### 5.6 Webview 页面（pageId=serialConsole，AppShell width=full）

```
┌ 左栏（服务器管理）────────┐ ┌ 右栏（控制台）──────────────────────┐
│ 服务器列表（状态徽标/选中）│ │ 工具条：●已连接 COM3·115200｜暂停滚动│清空│断开 │
│ [检测串口] [+ 新增]        │ │ 输出区：monospace 流式滚动（上限5000行）│
│ 服务器表单（SchemaForm 9字段）│ │ 历史面板：搜索+MRU去重列表（次数/时间）│
│  密码字段留空=保持不变     │ │ 命令输入：Enter 发送，↑↓ 历史导航      │
└──────────────────────────┘ └──────────────────────────────────────┘
```

- 表单复用 SchemaForm：`SERVER_FIELD_DEFS`（9 字段）+ `deriveFormSchema(defs)` 泛化（item 表单行为由回归测试锁定）。
- 全部使用 `--ui-*` 语义令牌（自动跟随 VSCode 主题）；新图标经 iconNames.ts 语义映射。
- 页面状态（选中服务器/表单草稿）getState/setState 持久化。

### 5.7 打包链路适配

1. package.json：`"dependencies": {"serialport": "^12.0.0"}`；`package:vsix` 去掉 `--no-dependencies`。
2. `scripts/build-extension.ts`：`external: ['vscode', 'serialport']`。
3. `.vscodeignore`：追加 `!node_modules/serialport/**`、`!node_modules/@serialport/**`、`!node_modules/node-gyp-build/**`。
4. `scripts/gate.ts` 第 9 步：`vsce ls` 去 `--no-dependencies`；must-have 增加 serialport 入口与 `*.node` prebuild；新增 vsix 总体积预算（实测后定，暂 15MB）。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| COM 口被占用/打开失败 | 错误经 serialState.error 透传到页面状态条 |
| 输出洪泛打爆消息通道 | 30-50ms 批处理 + seq + 页面缓冲 5000 行裁剪 |
| CI（Ubuntu）安装原生模块 | prebuild-install 拉取 linux-x64 预编译；单测不加载原生模块 |
| serialport 加载失败 | 惰性 require + 可操作错误提示 + 特性开关可隐藏 |
| 密码泄露 | 只进 SecretStorage；日志与输出通道零打印 |

## 7. 用户已定 vs 留给构建者

- 用户已定：COM 通道、SecretStorage 密码、树视图+独立页面、本期完整交付。
- 构建者决策（已在本文档标明，可否决）：v1 单连接、全局 MRU 历史、页内增删改、UTF-8 文本输出、自动登录时序（800ms/500ms）。
