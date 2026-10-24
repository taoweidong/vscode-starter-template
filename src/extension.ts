import * as path from 'path'
import * as vscode from 'vscode'
import { registerCommands } from './commands'
import { CONFIG, VIEW } from './constants'
import { BuildService, DEFAULT_DIRTY_IGNORES } from './features/build/buildService'
import { BuildTreeProvider } from './features/build/buildTreeProvider'
import { createFeatureConfigDeps, ConfigFormPanel } from './features/featureConfig/configFormPanel'
import { FeatureConfigTreeProvider } from './features/featureConfig/featureConfigTreeProvider'
import { getFeatureValue } from './features/featureConfig/featureFlags'
import { InitService } from './features/init/initService'
import { InitTreeProvider } from './features/init/initTreeProvider'
import { createInitSteps } from './features/init/initSteps'
import { StaticConfigService } from './features/staticConfig/staticConfigService'
import { StaticConfigTreeProvider } from './features/staticConfig/staticConfigTreeProvider'
import { SerialConsoleController } from './features/serialConsole/serialConsoleController'
import { SerialConsolePanel } from './features/serialConsole/serialConsolePanel'
import { ImportWizardPanel } from './providers/importWizardPanel'
import { createItemFormSerializerDeps, ItemFormPanel } from './providers/itemFormPanel'
import type { TreeNode } from './providers/itemsTreeDataProvider'
import { ItemsTreeDataProvider } from './providers/itemsTreeDataProvider'
import { EnvironmentTreeProvider } from './providers/environmentTreeProvider'
import { StorageController } from './services/storageController'
import type { ItemService } from './services/itemService'
import { storageRelativePath } from './services/storagePath'
import { JsonFileStore } from './services/stores/jsonFileStore'
import { TaskRunner } from './tasks/taskRunner'
import { TASKS } from './tasks/taskRegistry'
import { WebviewController, type WebviewControllerDeps } from './webview/host/webviewController'
import type { WebviewPageId } from './webview/pages'

/**
 * 插件入口：只做「组装」——数据源、服务、各功能视图、命令、启动任务。
 * 各层职责见 README 的架构说明；store / watcher 的创建与生命周期由 StorageController 统一管理，
 * 想更换数据源实现 IItemStore 后在 StorageController.createStore() 中替换即可。
 */
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('CRUD Starter')
  context.subscriptions.push(outputChannel)

  // ---------- 条目 CRUD ----------
  const storage = new StorageController({
    globalState: context.globalState,
    onWarning: (message) => outputChannel.appendLine(`[storage] ${message}`),
    onCorrupted: async (info) => {
      const choice = await vscode.window.showErrorMessage(
        `CRUD Starter：数据文件解析失败（${info.reason}）。` +
          `原文件保留未改动，已复制备份：${path.basename(info.backupUri.fsPath)}。`,
        '以空数据继续',
        '打开原文件'
      )
      if (choice === '以空数据继续') {
        return 'continue-empty'
      }
      if (choice === '打开原文件') {
        return 'open-file'
      }
      return 'abort' // 关闭弹窗等情形：不拿空数据冒险
    },
    shouldAutoReload: () => getFeatureValue('autoRefreshOnExternalChange'),
  })
  context.subscriptions.push(storage)
  const service = storage.service
  const treeProvider = new ItemsTreeDataProvider(service)
  const treeView = vscode.window.createTreeView(VIEW.itemsViewId, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    // 允许 Ctrl/Shift 多选条目——右键批量命令（批量删除/批量设优先级）依赖它
    canSelectMany: true,
  })
  context.subscriptions.push(treeView)
  context.subscriptions.push(
    service.onDidChangeItems(() => {
      void updateViewStatus(treeView, service)
    })
  )
  void updateViewStatus(treeView, service)

  // ---------- 启动任务（环境信息） ----------
  const taskRunner = new TaskRunner(TASKS, outputChannel)
  context.subscriptions.push(taskRunner)
  const envProvider = new EnvironmentTreeProvider(taskRunner)
  context.subscriptions.push(
    vscode.window.createTreeView(VIEW.envViewId, { treeDataProvider: envProvider })
  )
  if (
    vscode.workspace.getConfiguration(CONFIG.section).get<boolean>(CONFIG.runStartupTasks, true)
  ) {
    // runAll 不 await——探测走子进程，不能阻塞激活流程
    void taskRunner.runAll()
  }

  // ---------- 功能页面：环境初始化 / 特性配置 / 静态配置 / 分支编译 ----------
  const staticConfig = new StaticConfigService(
    outputChannel,
    () => vscode.workspace.workspaceFolders?.[0]?.uri
  )
  context.subscriptions.push(staticConfig)
  void staticConfig.load()

  // 环境快照复用（P1-12）：初始化的 envSnapshot 步骤优先复用启动任务已缓存的结果
  const initService = new InitService(
    createInitSteps({ getEnvironmentSnapshot: () => taskRunner.lastResults.at(-1) }),
    outputChannel,
    staticConfig
  )
  context.subscriptions.push(initService)
  const initProvider = new InitTreeProvider(() => initService.getStates())
  context.subscriptions.push(
    initService.onDidChangeItems(() => initProvider.refresh()),
    vscode.window.createTreeView(VIEW.initViewId, { treeDataProvider: initProvider })
  )

  const featureProvider = new FeatureConfigTreeProvider()
  context.subscriptions.push(
    vscode.window.createTreeView(VIEW.featureConfigViewId, { treeDataProvider: featureProvider }),
    // 开关写在全局设置里，设置变化时刷新树视图的开关状态；
    // 开关即时影响条目树行为（徽标 / 通知等，P1-07）：一并刷新条目树与视图状态
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG.section}.${CONFIG.featuresSection}`)) {
        featureProvider.refresh()
        treeProvider.refresh()
        void updateViewStatus(treeView, service)
      }
    })
  )

  // R-C-22：第二个参数接通解析失败原因——配置文件 JSON 坏了要显示错误态节点，
  // 而不是和「尚未生成」混为同一个「暂无静态配置」
  const staticProvider = new StaticConfigTreeProvider(
    () => staticConfig.getSections(),
    () => staticConfig.getError()
  )
  context.subscriptions.push(
    staticConfig.onDidChangeItems(() => staticProvider.refresh()),
    vscode.window.createTreeView(VIEW.staticConfigViewId, { treeDataProvider: staticProvider })
  )

  /**
   * 插件自身数据文件的相对路径（R-C-4 忽略前缀的动态来源）：
   * 数据源为 Memento（无工作区）时没有文件，返回空数组。
   */
  function selfDataIgnorePrefix(): readonly string[] {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri
    const store = storage.currentStore
    if (!root || !(store instanceof JsonFileStore)) {
      return []
    }
    return [storageRelativePath(root, store.fileUri)]
  }

  const buildService = new BuildService(
    outputChannel,
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    {
      // R-C-4：忽略前缀动态求值——数据文件路径跟随 crudStarter.storagePath 配置，
      // 工作区 / 配置变化后 store 会重建，组装期快照会让自定义路径用户被脏检查自阻断
      getDirtyIgnorePrefixes: () => [...DEFAULT_DIRTY_IGNORES, ...selfDataIgnorePrefix()],
    }
  )
  context.subscriptions.push(buildService)
  const buildProvider = new BuildTreeProvider(buildService, () => buildService.getGitInfo())
  context.subscriptions.push(
    buildService.onDidChangeItems(() => buildProvider.refresh()),
    vscode.window.createTreeView(VIEW.buildViewId, { treeDataProvider: buildProvider })
  )

  // ---------- 串口命令控制台：控制器（共享链路/状态）+ 树视图 ----------
  const serialConsole = new SerialConsoleController(context, outputChannel)
  context.subscriptions.push(serialConsole)
  context.subscriptions.push(
    vscode.window.createTreeView(VIEW.serialServersViewId, {
      treeDataProvider: serialConsole.treeProvider,
    })
  )

  // ---------- 静态配置的外部修改监听（数据文件 watcher 由 StorageController 管理） ----------
  const staticWatcher = createStaticConfigWatcher(context, staticConfig)
  if (staticWatcher) {
    context.subscriptions.push(staticWatcher)
  }

  // ---------- Webview 页面装配（M4）：面板上下文 + 序列化器（窗口重载恢复） ----------
  ItemFormPanel.configure(context)
  ConfigFormPanel.configure(context)
  ImportWizardPanel.configure(context)
  SerialConsolePanel.configure(context)
  WebviewController.registerSerializer(context, (pageId: WebviewPageId): WebviewControllerDeps => {
    switch (pageId) {
      case 'itemForm':
        return createItemFormSerializerDeps(service)
      case 'featureConfig':
        // 恢复面板没有实例：保存成功 / 取消后经控制器注册表关闭
        return createFeatureConfigDeps({
          onSaved: () => WebviewController.get('featureConfig')?.dispose(),
          onCancel: () => WebviewController.get('featureConfig')?.dispose(),
        })
      case 'importWizard':
        return {
          buildInit: () => ({ schema: [], value: null, extra: {} }),
          onCancel: () => WebviewController.get('importWizard')?.dispose(),
        }
      case 'serialConsole':
        // 复用控制器的面板依赖：共享串口链路与状态，恢复面板功能完整
        return serialConsole.panelDepsOrCreate()
      default:
        return {} // gallery 无宿主侧业务
    }
  })

  registerCommands(context, {
    service,
    getStore: () => storage.currentStore,
    taskRunner,
    outputChannel,
    initService,
    staticConfig,
    buildService,
    serialConsole,
  })
}

export function deactivate(): void {
  // 所有资源已通过 context.subscriptions 统一释放
}

function createStaticConfigWatcher(
  context: vscode.ExtensionContext,
  staticConfig: StaticConfigService
): vscode.FileSystemWatcher | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri
  if (!root) {
    return undefined
  }
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, '.vscode/crud-starter.config.json')
  )
  const reload = (): void => {
    if (getFeatureValue('autoRefreshOnExternalChange')) {
      void staticConfig.load()
    }
  }
  watcher.onDidChange(reload, null, context.subscriptions)
  watcher.onDidCreate(reload, null, context.subscriptions)
  watcher.onDidDelete(reload, null, context.subscriptions)
  return watcher
}

/**
 * 根据当前数据更新视图的空状态提示与过滤徽标。
 * 已知限制：连续 onDidChangeItems 触发并发 list() 时，后完成的先赋值可能留下旧计数一瞬间；
 * 数据同源、窗口极小，暂不处理（评审结论：列为已知限制）。
 */
async function updateViewStatus(
  treeView: vscode.TreeView<TreeNode>,
  service: ItemService
): Promise<void> {
  const items = await service.list()
  treeView.message = items.length
    ? undefined
    : '暂无条目：点击右上角 ＋ 新增，或从命令面板运行「CRUD Starter: 新增条目」。'
  treeView.badge =
    service.filtered && getFeatureValue('showViewBadges')
      ? {
          value: items.length,
          tooltip: `过滤「${service.getFilter().trim()}」：匹配 ${items.length} 条`,
        }
      : undefined
}
