import { describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { registerCommands, type CommandDeps } from '../../extension/commands'
import { notifySuccess } from '../../extension/commands/shared'
import { COMMAND } from '../../extension/constants'
import { __resetStubs, __stubs, createExtensionContextStub } from './stubs/vscode'

/**
 * 命令层单测（09 方案阶段 2 后）：
 * - 锁定 registerCommands 的注册完整性（与 COMMAND 常量一一对应，
 *   门禁第 ⑥ 步静态校验的单测镜像）；
 * - notifySuccess（特性开关退场后一律提示，S 列表）。
 */

describe('notifySuccess（特性开关退场后：一律提示）', () => {
  it('直接弹「已…」信息条', () => {
    __resetStubs()
    notifySuccess('已删除「A」。')
    expect(
      __stubs.recorded.some(
        (entry) =>
          entry.kind === 'showInformationMessage' &&
          (entry.args[0] as { message: string }).message === '已删除「A」。'
      )
    ).toBe(true)
  })
})

describe('registerCommands（注册完整性）', () => {
  it('注册键与 COMMAND 常量一一对应（16 个：12 保留 + 4 草稿箱）', () => {
    __resetStubs()
    const context = createExtensionContextStub()
    registerCommands(context as unknown as vscode.ExtensionContext, {} as CommandDeps)
    const registered = [...__stubs.registeredCommands.keys()]
    expect(registered.slice().sort()).toEqual(Object.values(COMMAND).slice().sort())
    expect(registered).toHaveLength(Object.keys(COMMAND).length)
  })
})
