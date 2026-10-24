import * as vscode from 'vscode'
import type { StepStatus } from '../features/init/initService'

/**
 * 命令层共享工具：被各场景分组（pageCommands / serialConsoleCommands /
 * draftCommands）复用的纯函数与用户反馈入口。
 * 09 方案阶段 2：条目相关的 10 个符号（buildMoreActions / toMarkdown / toItem /
 * collectTargets / summarize / names / openFileForm / pickItem / MoreActionPick /
 * PREVIEW_MAX_BYTES）已随条目领域删除。
 */

// VSCode 命令参数类型在注册期未知（与官方 API 签名一致使用 any[]）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyArgs = any[]

/**
 * 命令注册闭包契约：由 index.ts 持有 ExtensionContext 创建
 * （context.subscriptions.push(registerCommand(...))），以参数形式分发给各分组。
 */
export type CommandRegistrar = (commandId: string, callback: (...args: AnyArgs) => unknown) => void

/** 初始化步骤状态的 QuickPick 图标。 */
export function statusIcon(status: StepStatus): string {
  switch (status) {
    case 'done':
      return '$(check)'
    case 'failed':
      return '$(error)'
    case 'running':
      return '$(sync)'
    default:
      return '$(circle-outline)'
  }
}

/**
 * 成功通知统一入口（09 §3.4：successNotifications 特性开关随体系退场，
 * S 列表定论——成功操作一律提示）。
 */
export function notifySuccess(message: string): void {
  void vscode.window.showInformationMessage(message)
}

/** 错误统一呈现：Error 取 message，其他值加「操作失败：」前缀。 */
export function showError(err: unknown): void {
  const message = err instanceof Error ? err.message : `操作失败：${String(err)}`
  void vscode.window.showErrorMessage(message)
}
