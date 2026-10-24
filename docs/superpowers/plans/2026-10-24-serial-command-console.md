# 串口服务器命令控制台 实现计划

> 依据 superpowers:writing-plans 方法论产出。执行者须配合 superpowers:test-driven-development 子技能（RED→GREEN→REFACTOR）。
> 步骤复选框 `- [ ]` 供执行时勾选。

- **Goal**：在本扩展中新增串口服务器管理 + 串口命令控制台（COM 通道），含服务器录入、命令下发、去重历史、实时输出、独立树视图与控制台页面。
- **Architecture**：镜像模板既有分层——models / store（双实现）/ service / treeProvider / panel（onPageMessage 编排）/ protocol（只追加分支）/ apps\<pageId>（Vue 页面）。串口经 `SerialPortFactory` 抽象注入，单测不触原生模块。
- **Tech Stack**：TypeScript（宿主 CommonJS + Webview ESNext）、Vue 3、serialport ^12.0.0（N-API prebuild）、Vitest + @vscode/test-electron + Playwright。
- **Spec**：`docs/superpowers/specs/2026-10-24-serial-command-console-design.md`（执行者须同时读规格与本计划）。
- **前置已完成（T1）**：superpowers 技能已安装至 `~/.zcode/skills/`；本计划与规格文档已提交。

## Global Constraints

- `src/webview/protocol.ts` 守卫覆盖率必须保持 100%（vitest 阈值既有约定）。
- 消息协议只追加联合分支与守卫 case，不改既有分支形状（protocol.ts:8 注释约定）。
- constants.ts COMMAND ↔ package.json contributes ↔ src/commands/ 注册三处闭合（scripts/checks/manifest.ts 强制）。
- FEATURE_FLAGS ↔ `crudStarter.features.*` 配置双向一致（含默认值）。
- Webview 组件只消费 `--ui-*` 语义令牌；图标只经 iconNames.ts 语义名引用。
- 密码只进 SecretStorage（key `crudStarter.serialServer.<id>.password`），任何日志/输出通道不得打印。
- 每任务独立提交；提交前该任务全部测试通过。

## Review Focus（易错点与测试归属）

1. **历史去重边界**（空白命令、纯空白 trim 后为空不入库、重复命令 MRU 置顶、上限淘汰）→ T3 单测。
2. **连接状态机竞态**（连接中断开、连接失败后再次连接、重复 connect、dispose 清理）→ T4 单测。
3. **守卫窄化错误**（新增分支漏字段/多余字段误收）→ T5 协议守卫表驱动测试。
4. **表单泛化回归**（itemForm 的 FORM_SCHEMA 输出与泛化前逐字节一致）→ T6 回归测试。
5. **密码剥离**（保存路径中 password 不出现在 store 载荷/日志；编辑留空不覆盖）→ T7 单测（stub SecretStorage 断言调用）。

---

## T2 数据模型 + SerialServerStore

**Files**

- Create `src/features/serialConsole/models.ts`（SerialServer/SerialServerDraft + 类型守卫）
- Create `src/services/stores/atomicWrite.ts`（从 jsonFileStore.ts 抽取原子写：临时文件→读回比对→rename）
- Modify `src/services/stores/jsonFileStore.ts`（改用共享 atomicWrite，行为不变）
- Create `src/features/serialConsole/serverStore.ts`（IServerStore + jsonFile 实现 `.vscode/serial-servers.json` 信封 v1 + Memento 兜底）
- Test `src/test/unit/features/serialConsole/serverStore.spec.ts`、`src/test/unit/services/stores/atomicWrite.spec.ts`

**Interfaces（Produces）**

- `createServerStores(context, workspaceRoot?): { load(): Promise<SerialServer[]>; save(servers: SerialServer[]): Promise<void>; onDidChange(cb): Disposable }`
- `writeJsonAtomic(filePath: string, data: unknown): Promise<void>`

**Steps**

- [ ] 测试先行：atomicWrite（覆盖/新建/写失败保留原文件）→ 红
- [ ] 实现 atomicWrite 并让 jsonFileStore 复用，跑既有 jsonFileStore 测试确认绿
- [ ] 测试先行：serverStore（空载/保存往返/信封版本/损坏文件回退空+错误回调）→ 红
- [ ] 实现 serverStore → 绿 → 提交

## T3 CommandHistoryService

**Files**

- Create `src/features/serialConsole/commandHistoryService.ts`
- Test `src/test/unit/features/serialConsole/commandHistoryService.spec.ts`

**Interfaces（Produces）**

- `createCommandHistoryService(memento: Memento): { record(cmd): Promise<HistoryEntry[]>; list(): Promise<HistoryEntry[]>; remove(id): Promise<HistoryEntry[]>; clear(): Promise<void> }`
- `HistoryEntry { id: string; command: string; lastUsedAt: number; useCount: number }`

**Steps**

- [ ] 测试先行：空白不入库 / 新命令置顶 / 重复 MRU 置顶+useCount+1 / 上限 200 淘汰最旧 / remove / clear → 红
- [ ] 实现 → 绿 → 提交

## T4 SerialPortFactory + SerialLinkService

**Files**

- Create `src/features/serialConsole/serialPortFactory.ts`（接口 + 惰性 require 生产实现 + FakeFactory 导出供测试）
- Create `src/features/serialConsole/serialLinkService.ts`
- Test `src/test/unit/features/serialConsole/serialLinkService.spec.ts`

**Interfaces（Produces）**

- `interface SerialPortLike { write(data: string): void; close(cb?): void; on(event, cb): void }`
- `interface SerialPortFactory { list(): Promise<{ path: string }[]>; open(opts): Promise<SerialPortLike> }`
- `createSerialLinkService(factory, hooks: { onData(text,seq), onState(state,error?) }): { connect(server): Promise<void>; send(cmd): void; disconnect(): void; state(): LinkState }`

**Steps**

- [ ] 测试先行（FakeFactory）：open 成功→connected / open 拒绝→error 且可重连 / data 批处理合并（fake timers）/ send 追加 lineEnding / close 幂等 / 连接中 disconnect → 红
- [ ] 实现 → 绿 → 提交

## T5 协议扩展

**Files**

- Modify `src/webview/protocol.ts`（追加 §设计 5.4 分支 + 守卫 case）
- Test 修改 `src/test/unit/webview/protocol.spec.ts`（表驱动：合法/缺字段/多字段/类型错）

**Steps**

- [ ] 测试先行：新增 15 个分支的守卫正反例 → 红
- [ ] 实现分支与守卫 → 绿，覆盖率 100% → 提交

## T6 SERVER_FIELD_DEFS + deriveFormSchema 泛化

**Files**

- Create `src/features/serialConsole/serverSchema.ts`（SERVER_FIELD_DEFS：name/serialPath/baudRate/dataBits/stopBits/parity/flowControl/lineEnding/autoLogin/username/password/description）
- Modify `src/webview/formSchema.ts`（`deriveFormSchema(defs)` 参数化；导出保持 FORM_SCHEMA 兼容）
- Test `src/test/unit/webview/formSchema.spec.ts`（追加：item 输出回归快照 + server 派生）

**Steps**

- [ ] 测试先行：item 派生结果与现输出一致（回归锁定）→ 红（泛化前无法注入 defs）
- [ ] 泛化 + server 派生 → 绿 → 提交

## T7 serialConsolePanel 消息编排

**Files**

- Create `src/features/serialConsole/serialConsolePanel.ts`（configure/open；onPageMessage 处理 10 类页面消息；保存剥离密码→SecretStorage；自动登录时序）
- Create `src/features/serialConsole/serialConsoleController.ts`（面板+链路+历史+store 的组装与生命周期）
- Test `src/test/unit/features/serialConsole/serialConsolePanel.spec.ts`（fakePanel + stub SecretStorage/Memento）

**Steps**

- [ ] 测试先行：serversRequest→serialServers / save（密码剥离、留空保持）/ delete / connect→state 推送 / send→link+history.record / dispose 断开 → 红
- [ ] 实现 → 绿 → 提交

## T8 树视图 + 命令 + 清单 + feature flag

**Files**

- Create `src/features/serialConsole/serialServersTreeProvider.ts`
- Create `src/commands/serialConsoleCommands.ts`
- Modify `src/constants.ts`（COMMAND 6 项 / VIEW.serialServersViewId / STORAGE 2 key / FEATURES）
- Modify `src/features/featureConfig/featureFlags.ts`（serialConsole: true）
- Modify `package.json`（commands/views/menus/configuration）
- Modify `src/extension.ts`（组装 + serializer）
- Modify `src/commands/index.ts`（挂载新命令组）
- Test `src/test/unit/features/serialConsole/serialServersTreeProvider.spec.ts`、命令注册单测

**Steps**

- [ ] 测试先行：树 provider（空态/列表/状态徽标 contextValue）→ 红
- [ ] 实现 provider + 命令组 + 清单 + extension 组装 → 绿
- [ ] `npx tsx scripts/checks/manifest.ts`（或跑 gate 静态步）通过 → 提交

## T9 Webview 页面骨架 + 服务器管理 UI

**Files**

- Modify `src/webview/pages.ts`（+serialConsole）
- Create `src/webview/apps/serialConsole/main.ts`、`App.vue`
- Create `src/webview/composables/useConsolePage.ts`（消息监听/请求封装）
- Create `src/webview/components/ServerList.vue`、`ServerForm.vue`（复用 SchemaForm）
- Modify `src/webview/ui/iconNames.ts`（server/plug/send 等）
- Test `src/test/unit/webview/serialConsoleApp.spec.ts`（appTestUtils）

**Steps**

- [ ] 测试先行：init 渲染服务器列表 / 表单校验错误显示 / 保存消息载荷正确 / 检测串口 chips 填充 → 红
- [ ] 实现 → 绿 → 提交

## T10 控制台 UI

**Files**

- Create `src/webview/apps/serialConsole/components/ConsoleOutput.vue`（流式/自动滚动可暂停/5000 行裁剪/清空）
- Create `src/webview/apps/serialConsole/components/CommandInput.vue`（Enter 发送/↑↓ 历史）
- Modify `App.vue`（右栏组装 + serialData/serialState 消费）

**Steps**

- [ ] 测试先行：serialData 追加渲染 / 暂停滚动开关 / 清空 / 状态条随 serialState 变化 / 发送触发 serialSend 且本地回显 → 红
- [ ] 实现 → 绿 → 提交

## T11 历史命令 UI

**Files**

- Create `src/webview/apps/serialConsole/components/HistoryPanel.vue`（搜索/MRU 列表/单击填入/双击发送/删除/清空）

**Steps**

- [ ] 测试先行：列表按 lastUsedAt 排序 / 搜索过滤 / 单击 emit fill / 双击 emit send / 删除与清空消息 → 红
- [ ] 实现 → 绿 → 提交

## T12 打包链路适配

**Files**

- Modify `package.json`（dependencies.serialport ^12.0.0；package:vsix 去 --no-dependencies）
- Modify `scripts/build-extension.ts`（external + serialport）
- Modify `.vscodeignore`（node_modules 否定项）
- Modify `scripts/gate.ts`（第 9 步：vsce ls 去 flag、must-have + *.node、vsix 体积预算）

**Steps**

- [ ] `npm install serialport@^12.0.0` 并确认 prebuild 落盘（node_modules/@serialport/bindings-cpp/prebuilds）
- [ ] 构建宿主 bundle 体积仍 < 150KB
- [ ] `vsce ls` 清单核对 serialport 运行时文件在列；gate 第 9 步更新后通过 → 提交

## T13 E2E + 门禁 + 文档

**Files**

- Create `tests/e2e/serialConsole.spec.ts`（harness 伪造宿主：init/serialData 流/发送/历史交互）
- Modify `README.md`（架构图与功能清单 + serialport 依赖说明）

**Steps**

- [ ] E2E 用例（页面加载/发送回流/历史去重展示）绿
- [ ] `npm run gate -- --with-e2e` 10 步全绿
- [ ] README 更新 → 最终提交
