import * as vscode from 'vscode'
import { COMMAND } from '../constants'
import type { SerialConsoleController } from '../features/serialConsole/serialConsoleController'
import { SerialConsolePanel } from '../features/serialConsole/serialConsolePanel'
import type { SerialServerNode } from '../features/serialConsole/serialServersTreeProvider'
import { getFeatureValue } from '../features/featureConfig/featureFlags'
import type { CommandRegistrar } from './shared'

/**
 * 串口控制台场景命令分组——打开控制台 / 新增 / 编辑 / 连接 / 删除 / 刷新。
 *
 * 服务器的新增与编辑在控制台页面内完成（页面持有表单），命令只负责
 * 打开页面并（可能）预选目标；删除在树侧落库（controller.deleteServer）。
 */
export interface SerialConsoleCommandDeps {
  controller: SerialConsoleController
  /** 扩展上下文：SerialConsolePanel.configure 已由 extension.ts 完成，此处仅类型完备。 */
  context: vscode.ExtensionContext
}

export function registerSerialConsoleCommands(
  register: CommandRegistrar,
  deps: SerialConsoleCommandDeps
): void {
  const { controller } = deps

  /** 特性开关关闭时命令给出可操作提示（开关位于特性配置页 / 设置）。 */
  const guard =
    <TArgs extends unknown[]>(run: (...args: TArgs) => unknown): ((...args: TArgs) => unknown) =>
    (...args: TArgs) => {
      if (!getFeatureValue('serialConsole')) {
        void vscode.window.showInformationMessage(
          '串口控制台功能已关闭：可在「特性配置」或设置（crudStarter.features.serialConsole）中开启。'
        )
        return
      }
      return run(...args)
    }

  const openPanel = (initialServerId?: string): void => {
    SerialConsolePanel.createOrShow(controller.services(), initialServerId)
  }

  register(
    COMMAND.openSerialConsole,
    guard(() => openPanel())
  )

  register(
    COMMAND.addSerialServer,
    guard(() => openPanel())
  )

  register(
    COMMAND.editSerialServer,
    guard((node?: SerialServerNode) => openPanel(node?.server.id))
  )

  register(
    COMMAND.connectSerialServer,
    guard((node?: SerialServerNode) => openPanel(node?.server.id))
  )

  register(
    COMMAND.deleteSerialServer,
    guard(async (node?: SerialServerNode) => {
      const server = node?.server
      if (!server) {
        return
      }
      if (getFeatureValue('confirmDelete')) {
        const choice = await vscode.window.showWarningMessage(
          `确定删除服务器「${server.name}」（${server.serialPath}）？已保存的登录密码将一并清除。`,
          { modal: true },
          '删除'
        )
        if (choice !== '删除') {
          return
        }
      }
      const result = await controller.deleteServer(server.id)
      if (result === 'missing') {
        void vscode.window.showWarningMessage('服务器不存在（可能已被删除），列表已刷新。')
      }
    })
  )

  register(
    COMMAND.refreshSerialServers,
    guard(() => controller.treeProvider.refresh())
  )
}
