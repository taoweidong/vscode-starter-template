import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { migrateLegacyKeys } from '../../extension/services/legacyMigration'
import { __resetStubs, __setConfig, __stubs, createExtensionContextStub } from './stubs/vscode'

/**
 * 旧命名一次性迁移（09 方案阶段 5.4，v1.0.0 破坏性变更）：
 * - 配置 crudStarter.features.serialConsole → extStarter.serialConsoleEnabled（分作用域）；
 * - Memento crudStarter.serialServers / .serialCommandHistory → extStarter.*；
 * - Secret 密码的惰性搬迁在 serialConsolePanel 侧（SecretStorage 无法枚举）。
 * 幂等：无旧键时零动作。
 */

const makeContext = (): ReturnType<typeof createExtensionContextStub> =>
  createExtensionContextStub()

const configUpdates = (): { section: string; key: string; value: unknown }[] =>
  __stubs.recorded
    .filter((entry) => entry.kind === 'configUpdate')
    .map((entry) => entry.args[0] as { section: string; key: string; value: unknown })

describe('migrateLegacyKeys（阶段 5.4）', () => {
  beforeEach(() => {
    __resetStubs()
  })

  it('配置旧键（全局）→ 新键搬迁 + 旧键清理', async () => {
    __setConfig('crudStarter', 'features.serialConsole', false)
    expect(await migrateLegacyKeys(makeContext() as never)).toBe(true)
    const updates = configUpdates()
    expect(updates).toContainEqual({
      section: 'extStarter',
      key: 'serialConsoleEnabled',
      value: false,
    })
    expect(updates).toContainEqual({
      section: 'crudStarter',
      key: 'features.serialConsole',
      value: undefined,
    })
  })

  it('Memento 旧键 → 新键搬迁 + 旧键删除；无旧键时幂等（返回 false）', async () => {
    const context = makeContext()
    await context.globalState.update('crudStarter.serialServers', [{ id: 'srv-1' }])
    await context.globalState.update('crudStarter.serialCommandHistory', ['show version'])
    expect(await migrateLegacyKeys(context as never)).toBe(true)
    expect(context.globalState.get('extStarter.serialServers')).toEqual([{ id: 'srv-1' }])
    expect(context.globalState.get('extStarter.serialCommandHistory')).toEqual(['show version'])
    expect(context.globalState.get('crudStarter.serialServers')).toBeUndefined()

    // 第二次运行：旧键已清空，零动作
    expect(await migrateLegacyKeys(context as never)).toBe(false)
  })

  it('全新安装（无任何旧键）：零动作', async () => {
    expect(await migrateLegacyKeys(makeContext() as never)).toBe(false)
    expect(configUpdates()).toEqual([])
  })

  it('新键已有值时：旧键仅清理、不覆盖新值', async () => {
    __setConfig('extStarter', 'serialConsoleEnabled', true)
    __setConfig('crudStarter', 'features.serialConsole', false)
    await migrateLegacyKeys(makeContext() as never)
    const updates = configUpdates()
    expect(updates).not.toContainEqual(
      expect.objectContaining({ key: 'serialConsoleEnabled', value: false })
    )
    // 旧键仍被清理（避免残留半套配置）
    expect(updates).toContainEqual(
      expect.objectContaining({ section: 'crudStarter', value: undefined })
    )
  })

  it('工作区作用域的旧键同样搬迁（写回 Workspace 层）', async () => {
    await vscode.workspace
      .getConfiguration('crudStarter')
      .update('features.serialConsole', false, vscode.ConfigurationTarget.Workspace)
    await migrateLegacyKeys(makeContext() as never)
    const updates = configUpdates()
    expect(updates).toContainEqual({
      section: 'extStarter',
      key: 'serialConsoleEnabled',
      value: false,
    })
    // 工作区层新键可读（合并语义：工作区优先）
    expect(
      vscode.workspace.getConfiguration('extStarter').get<boolean>('serialConsoleEnabled')
    ).toBe(false)
  })
})
