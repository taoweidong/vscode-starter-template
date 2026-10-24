import * as vscode from 'vscode'
import { COMMAND } from '../constants'
import type { BuildService } from '../features/build/buildService'
import type { InitService } from '../features/init/initService'
import { findProbeByLabel } from '../tasks/probes'
import type { TaskRunner } from '../tasks/taskRunner'
import { WebviewController } from '../webview/host/webviewController'
import { type CommandRegistrar, notifySuccess, showError, statusIcon } from './shared'

/**
 * 功能页面场景命令分组（C-15 拆分；09 方案阶段 2 后）——组件画廊 /
 * 环境信息 / 环境初始化 / 分支编译出包。
 * 特性配置 / 静态配置两组命令随领域删除；场景与菜单位置对照表见 README。
 */

/** 本组依赖（CommandDeps 中与本组相关的字段，由 index.ts 组装时整体传入）。 */
export interface PageCommandDeps {
  taskRunner: TaskRunner
  outputChannel: vscode.OutputChannel
  initService: InitService
  buildService: BuildService
  /** 扩展上下文：openGallery 打开画廊页面需要（WebviewController.createOrShow 第二参）。 */
  context: vscode.ExtensionContext
  /** 单探针重检（09 方案 §6.1：树节点单击「重新检测此项」的路由目标）。 */
  recheckEnvironmentItem: (label: string) => Promise<void>
}

export function registerPageCommands(register: CommandRegistrar, deps: PageCommandDeps): void {
  const { taskRunner, outputChannel, initService, buildService, context, recheckEnvironmentItem } =
    deps

  /* ---------- 开发用：组件画廊（设计系统视觉验收基准） ---------- */
  register(COMMAND.openGallery, () => {
    WebviewController.createOrShow('gallery', context)
  })

  /* ---------- 启动任务 / 环境信息（环境信息视图标题栏与命令面板） ---------- */
  // 09 方案 §6.1：带 label 参数（树节点单击）→ 单探针重检；无参 → 全量检测
  register(COMMAND.refreshEnvironment, (label?: unknown) => {
    if (typeof label === 'string' && findProbeByLabel(label)) {
      void recheckEnvironmentItem(label)
      return
    }
    void taskRunner.runAll()
  })

  register(COMMAND.showEnvironmentOutput, () => {
    outputChannel.show(true)
  })

  /* ---------- 功能页面：环境初始化（清单 + 单步动作模式） ---------- */
  register(COMMAND.runAllInit, () => {
    void initService.runAll()
  })

  register(COMMAND.runInitStep, async (stepId?: unknown) => {
    if (typeof stepId === 'string') {
      void initService.runStep(stepId)
      return
    }
    // 无参调用（命令面板）：QuickPick 引导选择步骤
    const states = initService.getStates()
    if (!states.length) {
      return
    }
    const picked = await vscode.window.showQuickPick(
      states.map((state) => ({
        label: `${statusIcon(state.status)} ${state.title}`,
        description: state.status === 'idle' ? state.description : state.message,
        id: state.id,
      })),
      { title: '选择要执行的初始化步骤', matchOnDescription: true }
    )
    if (picked) {
      void initService.runStep(picked.id)
    }
  })

  /* ---------- 功能页面：分支编译出包（任务自动化模式） ---------- */
  register(COMMAND.buildBranch, (branch?: unknown) => {
    const target = typeof branch === 'string' && branch ? branch : undefined
    void buildService
      .build(target)
      .then((result) => {
        if (result.status === 'ok') {
          notifySuccess(result.message)
        } else if (result.status === 'warn') {
          // 有结果但带警告（如构建完成但存在告警）：黄条反馈而非红条
          void vscode.window.showWarningMessage(result.message)
        } else if (result.status === 'error') {
          void vscode.window.showErrorMessage(result.message)
        }
      })
      .catch((err) => showError(err))
  })
}
