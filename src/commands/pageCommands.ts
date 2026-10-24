import * as vscode from 'vscode'
import { COMMAND } from '../constants'
import { ConfigFormPanel } from '../features/featureConfig/configFormPanel'
import {
  FEATURE_FLAGS,
  getFeatureValue,
  setFeatureValue,
} from '../features/featureConfig/featureFlags'
import type { BuildService } from '../features/build/buildService'
import type { InitService } from '../features/init/initService'
import type { StaticConfigService } from '../features/staticConfig/staticConfigService'
import type { TaskRunner } from '../tasks/taskRunner'
import { WebviewController } from '../webview/host/webviewController'
import { type CommandRegistrar, notifySuccess, showError, statusIcon } from './shared'

/**
 * 功能页面场景命令分组（C-15 拆分）——组件画廊 / 环境信息 / 环境初始化 /
 * 特性配置 / 静态配置 / 分支编译出包。
 * 场景与菜单位置的完整对照表见 README「菜单与右键菜单示例」。
 */

/** 本组依赖（CommandDeps 中与本组相关的字段，由 index.ts 组装时整体传入）。 */
export interface PageCommandDeps {
  taskRunner: TaskRunner
  outputChannel: vscode.OutputChannel
  initService: InitService
  staticConfig: StaticConfigService
  buildService: BuildService
  /** 扩展上下文：openGallery 打开画廊页面需要（WebviewController.createOrShow 第二参）。 */
  context: vscode.ExtensionContext
}

export function registerPageCommands(register: CommandRegistrar, deps: PageCommandDeps): void {
  const { taskRunner, outputChannel, initService, staticConfig, buildService, context } = deps

  /* ---------- 开发用：组件画廊（设计系统视觉验收基准） ---------- */
  register(COMMAND.openGallery, () => {
    WebviewController.createOrShow('gallery', context)
  })

  /* ---------- 启动任务 / 环境信息（环境信息视图标题栏与命令面板） ---------- */
  register(COMMAND.refreshEnvironment, () => {
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

  /* ---------- 功能页面：特性配置（树视图开关 + Webview 配置页） ---------- */
  register(COMMAND.openFeatureConfigPage, () => {
    ConfigFormPanel.createOrShow()
  })

  register(COMMAND.toggleFeature, async (key?: unknown) => {
    if (typeof key === 'string' && FEATURE_FLAGS.some((flag) => flag.key === key)) {
      void setFeatureValue(key, !getFeatureValue(key))
      return
    }
    // 无参 / 未知 key（命令面板）：QuickPick 引导选择开关
    const picked = await vscode.window.showQuickPick(
      FEATURE_FLAGS.map((flag) => ({
        label: `${getFeatureValue(flag.key) ? '$(check)' : '$(close)'} ${flag.label}`,
        description: flag.description,
        key: flag.key,
      })),
      { title: '选择要切换的特性开关', matchOnDescription: true }
    )
    if (picked) {
      void setFeatureValue(picked.key, !getFeatureValue(picked.key))
    }
  })

  /* ---------- 功能页面：静态配置（只读展示 + 文件联动） ---------- */
  register(COMMAND.openStaticConfigFile, async () => {
    if (!staticConfig.fileUri) {
      void vscode.window.showInformationMessage('未打开工作区，静态配置不可用。')
      return
    }
    try {
      await staticConfig.ensureDefault()
      await staticConfig.load()
      await vscode.window.showTextDocument(staticConfig.fileUri)
    } catch (err) {
      // R-C-17：ensureDefault / load / showTextDocument 任一失败都经 showError 统一呈现，
      // 不与全库「命令不裸 reject」的模式脱节
      showError(err)
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
