/** 视图相关标识（与 package.json 的 contributes 保持一致，单一来源）。 */
export const VIEW = {
  /** ActivityBar 视图容器 ID */
  containerId: 'crudStarter',
  /** 条目树视图 ID */
  itemsViewId: 'crudStarter.itemsView',
  /** 环境信息树视图 ID */
  envViewId: 'crudStarter.envView',
  /** 环境初始化视图 ID */
  initViewId: 'crudStarter.initView',
  /** 特性配置视图 ID */
  featureConfigViewId: 'crudStarter.featureConfigView',
  /** 静态配置视图 ID */
  staticConfigViewId: 'crudStarter.staticConfigView',
  /** 分支编译视图 ID */
  buildViewId: 'crudStarter.buildView',
  /** 串口服务器树视图 ID */
  serialServersViewId: 'crudStarter.serialServersView',
  /** 树条目的 contextValue（用于菜单 when 条件） */
  itemContextValue: 'crudItem',
  /** 串口服务器树条目的 contextValue（未连接） */
  serialServerContextValue: 'serialServer',
  /** 串口服务器树条目的 contextValue（已连接，图标/菜单可区分） */
  serialServerConnectedContextValue: 'serialServerConnected',
} as const

/** 命令 ID（与 package.json 的 contributes 保持一致）。 */
export const COMMAND = {
  // 基础增删改查
  newItem: 'crudStarter.newItem',
  editItem: 'crudStarter.editItem',
  duplicateItem: 'crudStarter.duplicateItem',
  deleteItem: 'crudStarter.deleteItem',
  filterItems: 'crudStarter.filterItems',
  refresh: 'crudStarter.refresh',
  openDataFile: 'crudStarter.openDataFile',

  // 菜单/右键菜单示例命令
  /** 编辑器右键：从选中文本新增 */
  newItemFromSelection: 'crudStarter.newItemFromSelection',
  /** 资源管理器右键 / 编辑器标题栏：从文件新增 */
  newItemFromFile: 'crudStarter.newItemFromFile',
  /** 编辑器右键：从选中文本快速新增（跳过表单，静默创建） */
  quickAddFromSelection: 'crudStarter.quickAddFromSelection',
  /** 编辑器右键：将选中内容追加到已有条目 */
  appendSelectionToItem: 'crudStarter.appendSelectionToItem',
  /** 编辑器右键：登记当前打开的文件 */
  addCurrentFileToItems: 'crudStarter.addCurrentFileToItems',
  /** 资源管理器右键：将文件夹内容批量登记为条目 */
  newItemsFromFolder: 'crudStarter.newItemsFromFolder',
  /** 资源管理器右键：登记文件并摘录内容预览 */
  newItemFromFilePreview: 'crudStarter.newItemFromFilePreview',
  /** 树条目右键 → 设置优先级（子菜单） */
  setPriorityHigh: 'crudStarter.setPriorityHigh',
  setPriorityMedium: 'crudStarter.setPriorityMedium',
  setPriorityLow: 'crudStarter.setPriorityLow',
  /** 树条目右键 → 复制…（子菜单） */
  copyName: 'crudStarter.copyName',
  copyMarkdown: 'crudStarter.copyMarkdown',
  copyJson: 'crudStarter.copyJson',
  /** 树条目右键 → 更多操作（QuickPick 动态菜单） */
  moreActions: 'crudStarter.moreActions',

  // 启动任务 / 环境信息
  /** 环境信息视图标题栏：重新执行启动任务 */
  refreshEnvironment: 'crudStarter.refreshEnvironment',
  /** 打开启动任务的输出通道 */
  showEnvironmentOutput: 'crudStarter.showEnvironmentOutput',

  // 功能页面（环境初始化 / 特性配置 / 静态配置 / 分支编译）
  /** 环境初始化：执行全部步骤 */
  runAllInit: 'crudStarter.runAllInit',
  /** 环境初始化：执行单个步骤（树条目单击 / inline 按钮） */
  runInitStep: 'crudStarter.runInitStep',
  /** 特性配置：打开 Webview 配置页面 */
  openFeatureConfigPage: 'crudStarter.openFeatureConfigPage',
  /** 特性配置：切换单个开关（树条目单击） */
  toggleFeature: 'crudStarter.toggleFeature',
  /** 静态配置：打开配置文件（不存在则先生成默认模板） */
  openStaticConfigFile: 'crudStarter.openStaticConfigFile',
  /** 分支编译：选择分支并编译出包（树条目单击 / inline 按钮 / 标题栏） */
  buildBranch: 'crudStarter.buildBranch',

  // Webview 页面（Vue 3）
  /** 打开批量导入向导（多步骤页面：选择来源 → 预览 → 执行 → 结果） */
  openImportWizard: 'crudStarter.openImportWizard',
  /** 打开组件画廊（开发用：设计系统视觉验收基准） */
  openGallery: 'crudStarter.openGallery',

  // 串口命令控制台
  /** 打开串口控制台页面（命令面板 / 视图标题栏） */
  openSerialConsole: 'crudStarter.openSerialConsole',
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
} as const

/** 配置项键名（对应设置里的 crudStarter.*）。 */
export const CONFIG = {
  section: 'crudStarter',
  storagePath: 'storagePath',
  /** 激活时是否自动执行启动任务 */
  runStartupTasks: 'runStartupTasks',
  /** 特性开关所在的子段落（crudStarter.features.*） */
  featuresSection: 'features',
} as const

/** 存储相关常量。 */
export const STORAGE = {
  /** 默认 JSON 数据文件（相对工作区根目录） */
  defaultFileName: '.vscode/crud-starter-items.json',
  /** 未打开工作区时，globalState 的存储键 */
  mementoKey: 'crudStarter.items',
  /** 串口服务器：未打开工作区时，globalState 的存储键 */
  serialServersMementoKey: 'crudStarter.serialServers',
  /** 串口命令历史（全局共享、自动去重）：globalState 的存储键 */
  serialCommandHistoryKey: 'crudStarter.serialCommandHistory',
  /** 串口服务器登录密码的 SecretStorage 键前缀（完整键为 `<前缀><服务器id>.password`） */
  serialServerSecretPrefix: 'crudStarter.serialServer.',
} as const
