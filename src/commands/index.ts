import * as vscode from 'vscode'
import type { BuildService } from '../features/build/buildService'
import type { InitService } from '../features/init/initService'
import type { StaticConfigService } from '../features/staticConfig/staticConfigService'
import { type ItemService } from '../services/itemService'
import type { IItemStore } from '../services/stores/itemStore'
import type { TaskRunner } from '../tasks/taskRunner'
import { registerItemCommands } from './itemCommands'
import { registerPageCommands } from './pageCommands'
import { registerSelectionCommands } from './selectionCommands'
import type { CommandRegistrar } from './shared'

/** 命令层依赖集合：新增页面时在此扩展，避免参数列表无限增长。 */
export interface CommandDeps {
  service: ItemService
  /**
   * 动态获取当前数据源（StorageController 可能在 storagePath / 工作区变化后重建 store；
   * 持有旧快照会让 openDataFile 等命令打不开新文件——T4.5 修复）。
   */
  getStore: () => IItemStore
  taskRunner: TaskRunner
  outputChannel: vscode.OutputChannel
  initService: InitService
  staticConfig: StaticConfigService
  buildService: BuildService
}

/**
 * 命令注册中心：所有命令集中在此注册，每个命令对应一种「菜单入口 + 典型场景」。
 * 场景与菜单位置的完整对照表见 README「菜单与右键菜单示例」。
 *
 * view/item/context 传参约定：第一个参数是被右键的树节点元素，
 * 第二个参数是当前多选集合（Ctrl/Shift+点击时非空）——批量命令依赖第二个参数。
 *
 * C-15 拆分：具体命令按 README「场景」维度下沉到三个分组文件
 * （itemCommands 条目操作 / selectionCommands 选区与文件 / pageCommands 功能页面），
 * 共享工具与反馈入口在 shared.ts；本文件只保留组装逻辑与持有 ExtensionContext 的
 * register 闭包。命令注册键与拆分前逐一对应（门禁第 ⑥ 步静态校验）。
 */
export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const register: CommandRegistrar = (commandId, callback) => {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, callback))
  }
  registerItemCommands(register, deps)
  registerSelectionCommands(register, deps)
  registerPageCommands(register, { ...deps, context })
}
