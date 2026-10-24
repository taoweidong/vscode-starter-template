/**
 * 视图相关标识（与 package.json 的 contributes 保持一致，单一来源）。
 * 09 方案阶段 2：itemsView / featureConfigView / staticConfigView 三视图随
 * 条目 / 特性配置 / 静态配置领域删除，保留 4 视图。
 */
export const VIEW = {
  /** ActivityBar 视图容器 ID */
  containerId: 'crudStarter',
  /** 环境信息树视图 ID */
  envViewId: 'crudStarter.envView',
  /** 环境初始化视图 ID */
  initViewId: 'crudStarter.initView',
  /** 分支编译视图 ID */
  buildViewId: 'crudStarter.buildView',
  /** 串口服务器树视图 ID */
  serialServersViewId: 'crudStarter.serialServersView',
  /** 串口服务器树条目的 contextValue（未连接） */
  serialServerContextValue: 'serialServer',
  /** 串口服务器树条目的 contextValue（已连接，图标/菜单可区分） */
  serialServerConnectedContextValue: 'serialServerConnected',
} as const

/**
 * 命令 ID（与 package.json 的 contributes 保持一致）。
 * 09 方案阶段 2：37 → 16（保留 12 + 草稿箱 4，§3.3/§3.5）。
 */
export const COMMAND = {
  // 启动任务 / 环境信息
  /** 环境信息视图标题栏：重新执行启动任务 */
  refreshEnvironment: 'crudStarter.refreshEnvironment',
  /** 打开启动任务的输出通道 */
  showEnvironmentOutput: 'crudStarter.showEnvironmentOutput',

  // 环境初始化
  /** 环境初始化：执行全部步骤 */
  runAllInit: 'crudStarter.runAllInit',
  /** 环境初始化：执行单个步骤（树条目单击 / inline 按钮） */
  runInitStep: 'crudStarter.runInitStep',

  // 分支编译
  /** 分支编译：选择分支并编译出包（树条目单击 / inline 按钮 / 标题栏） */
  buildBranch: 'crudStarter.buildBranch',

  // Webview 页面（Vue 3）
  /** 打开组件画廊（开发用：设计系统视觉验收基准） */
  openGallery: 'crudStarter.openGallery',
  /** 打开串口控制台页面（命令面板 / 视图标题栏） */
  openSerialConsole: 'crudStarter.openSerialConsole',

  // 串口命令控制台
  /** 新增串口服务器（打开控制台页面表单） */
  addSerialServer: 'crudStarter.addSerialServer',
  /** 编辑串口服务器（打开控制台页面并预选） */
  editSerialServer: 'crudStarter.editSerialServer',
  /** 删除串口服务器（树右键；模态确认 + 清理密码） */
  deleteSerialServer: 'crudStarter.deleteSerialServer',
  /** 连接串口服务器并打开控制台（树条目单击 / inline 按钮） */
  connectSerialServer: 'crudStarter.connectSerialServer',
  /** 刷新串口服务器树视图 */
  refreshSerialServers: 'crudStarter.refreshSerialServers',

  // 草稿箱（右键示例新载体，09 方案 §3.5；8 条右键入口 = editor/context 4 + explorer/context 3 + editor/title 1）
  /** 编辑器右键：登记选中文本到草稿箱 */
  draftSelection: 'crudStarter.draftSelection',
  /** 编辑器右键：追加选中文本到最近一条草稿 */
  appendDraftSelection: 'crudStarter.appendDraftSelection',
  /** 资源管理器右键 / 编辑器右键与标题栏：登记文件（支持多选批量） */
  draftFile: 'crudStarter.draftFile',
  /** 资源管理器右键：登记文件夹内容为草稿 */
  draftFolder: 'crudStarter.draftFolder',
} as const

/**
 * 配置项键名（对应设置里的 crudStarter.*）。
 * 09 方案阶段 2：storagePath 与 6 个 features.* 特性开关随领域删除，
 * serialConsole 开关平铺为普通配置项（S1），配置 8 → 2。
 */
export const CONFIG = {
  section: 'crudStarter',
  /** 激活时是否自动执行启动任务 */
  runStartupTasks: 'runStartupTasks',
  /** 串口控制台开关（特性开关体系退场后平铺，09 §3.4/S1） */
  serialConsoleEnabled: 'serialConsoleEnabled',
} as const

/**
 * 存储相关常量。
 * 09 方案阶段 2：条目存储键随领域删除，仅保留串口侧；新增草稿箱数据文件。
 */
export const STORAGE = {
  /** 串口服务器：未打开工作区时，globalState 的存储键 */
  serialServersMementoKey: 'crudStarter.serialServers',
  /** 串口命令历史（全局共享、自动去重）：globalState 的存储键 */
  serialCommandHistoryKey: 'crudStarter.serialCommandHistory',
  /** 串口服务器登录密码的 SecretStorage 键前缀（完整键为 `<前缀><服务器id>.password`） */
  serialServerSecretPrefix: 'crudStarter.serialServer.',
  /**
   * 草稿箱数据文件（相对工作区根）。
   * B3：该路径必须以字面量同步进 buildService 的 DEFAULT_DIRTY_IGNORES 与 .gitignore
   * （脏检查匹配无 glob）；阶段 5 改名时三处一起换。
   */
  draftsFileName: '.vscode/crud-starter.drafts.json',
} as const
