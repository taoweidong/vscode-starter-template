import * as vscode from 'vscode'
import { registerCommands } from './commands'
import { CONFIG, VIEW } from './constants'
import { BuildService, DEFAULT_DIRTY_IGNORES } from './features/build/buildService'
import { BuildTreeProvider } from './features/build/buildTreeProvider'
import { DraftBoxService } from './features/drafts/draftBoxService'
import { InitService } from './features/init/initService'
import { InitTreeProvider } from './features/init/initTreeProvider'
import { createInitSteps } from './features/init/initSteps'
import { SerialConsoleController } from './features/serialConsole/serialConsoleController'
import { SerialConsolePanel } from './features/serialConsole/serialConsolePanel'
import { EnvironmentTreeProvider } from './providers/environmentTreeProvider'
import { TaskRunner } from './tasks/taskRunner'
import { TASKS } from './tasks/taskRegistry'
import { WebviewController, type WebviewControllerDeps } from './webview/host/webviewController'
import type { WebviewPageId } from './webview/pages'

/**
 * 插件入口：只做「组装」——各功能视图、命令、启动任务。
 * 各层职责见 README 的架构说明。
 *
 * 09 方案阶段 2：条目 CRUD / 特性配置 / 静态配置三链路删除
 * （C14：本文件的存储装配、selfDataIgnorePrefix、静态配置 watcher、
 * ItemFormPanel / ConfigFormPanel / ImportWizardPanel 接线一并清理）。
 */
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('CRUD Starter')
  context.subscriptions.push(outputChannel)

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

  // ---------- 功能页面：环境初始化 / 分支编译 ----------
  // 环境快照复用（P1-12）：初始化的 envSnapshot 步骤优先复用启动任务已缓存的结果
  const initService = new InitService(
    createInitSteps({ getEnvironmentSnapshot: () => taskRunner.lastResults.at(-1) }),
    outputChannel
  )
  context.subscriptions.push(initService)
  const initProvider = new InitTreeProvider(() => initService.getStates())
  context.subscriptions.push(
    initService.onDidChangeItems(() => initProvider.refresh()),
    vscode.window.createTreeView(VIEW.initViewId, { treeDataProvider: initProvider })
  )

  // B1（09 §6.3）：storagePath 配置删除后自数据文件路径不再可变，
  // 忽略前缀退化为静态清单（B2 串口数据文件 + B3 草稿箱数据文件，字面量无 glob）
  const buildService = new BuildService(
    outputChannel,
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    { getDirtyIgnorePrefixes: () => DEFAULT_DIRTY_IGNORES }
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

  // ---------- 草稿箱（右键示例载体，09 §3.5） ----------
  const drafts = new DraftBoxService(() => vscode.workspace.workspaceFolders?.[0]?.uri)
  context.subscriptions.push(drafts)
  void drafts.load()

  // ---------- Webview 页面装配（M4）：面板上下文 + 序列化器（窗口重载恢复） ----------
  SerialConsolePanel.configure(context)
  WebviewController.registerSerializer(context, (pageId: WebviewPageId): WebviewControllerDeps => {
    switch (pageId) {
      case 'serialConsole':
        // 复用控制器的面板依赖：共享串口链路与状态，恢复面板功能完整
        return serialConsole.panelDepsOrCreate()
      default:
        return {} // gallery 无宿主侧业务
    }
  })

  registerCommands(context, {
    taskRunner,
    outputChannel,
    initService,
    buildService,
    serialConsole,
    drafts,
  })
}

export function deactivate(): void {
  // 所有资源已通过 context.subscriptions 统一释放
}
