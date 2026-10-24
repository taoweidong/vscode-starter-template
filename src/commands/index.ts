import * as vscode from 'vscode'
import type { BuildService } from '../features/build/buildService'
import type { DraftBoxService } from '../features/drafts/draftBoxService'
import type { InitService } from '../features/init/initService'
import type { SerialConsoleController } from '../features/serialConsole/serialConsoleController'
import type { TaskRunner } from '../tasks/taskRunner'
import { registerDraftCommands } from './draftCommands'
import { registerPageCommands } from './pageCommands'
import { registerSerialConsoleCommands } from './serialConsoleCommands'
import type { CommandRegistrar } from './shared'

/** 命令层依赖集合：新增功能时在此扩展，避免参数列表无限增长。 */
export interface CommandDeps {
  taskRunner: TaskRunner
  outputChannel: vscode.OutputChannel
  initService: InitService
  buildService: BuildService
  /** 串口命令控制台（树视图 + 面板 + 历史的扩展级组装单元） */
  serialConsole: SerialConsoleController
  /** 草稿箱（右键示例载体，09 方案 §3.5） */
  drafts: DraftBoxService
}

/**
 * 命令注册中心：所有命令集中在此注册，每个命令对应一种「菜单入口 + 典型场景」。
 * 场景与菜单位置的完整对照表见 README。
 *
 * 具体命令按场景维度下沉到分组文件（pageCommands 功能页面 /
 * serialConsoleCommands 串口 / draftCommands 草稿箱），共享工具在 shared.ts；
 * 本文件只保留组装逻辑与持有 ExtensionContext 的 register 闭包。
 * 命令注册键与清单的闭合由门禁第 ⑥ 步静态校验。
 */
export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const register: CommandRegistrar = (commandId, callback) => {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, callback))
  }
  registerPageCommands(register, { ...deps, context })
  registerSerialConsoleCommands(register, { controller: deps.serialConsole, context })
  registerDraftCommands(register, { drafts: deps.drafts })
}
