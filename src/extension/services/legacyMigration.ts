import * as vscode from 'vscode'
import { CONFIG } from '../constants'

/**
 * 旧版命名一次性迁移（09 方案 §5.2 阶段 5.4：crudStarter → extStarter，v1.0.0 破坏性变更）。
 *
 * 范围（v2.1 审视定论：条目领域已删除，仅串口侧有迁移对象）：
 * - 配置项：crudStarter.features.serialConsole → extStarter.serialConsoleEnabled（值不变）；
 * - Memento：crudStarter.serialServers / .serialCommandHistory → extStarter.*；
 * - SecretStorage 密码：不在此迁移（无法枚举），由 serialConsolePanel 读取时
 *   「新键未命中 → 读旧键 → 写新键删旧键」惰性搬迁。
 *
 * 幂等：旧键不存在 / 新键已有值时跳过。迁移发生时向用户提示一次。
 */

/** 旧前缀（v0.7.0 及更早）。改名后本文件是全仓唯一保留旧字面量的位置。 */
const LEGACY_SECTION = 'crudStarter'
const LEGACY_CONFIG_KEY = 'features.serialConsole'
const LEGACY_MEMENTO_KEYS: readonly [string, string][] = [
  ['crudStarter.serialServers', 'extStarter.serialServers'],
  ['crudStarter.serialCommandHistory', 'extStarter.serialCommandHistory'],
]

export async function migrateLegacyKeys(context: vscode.ExtensionContext): Promise<boolean> {
  let migrated = false

  // ---- 配置项（全局与工作区两个作用域分别搬迁） ----
  const legacyConfig = vscode.workspace.getConfiguration(LEGACY_SECTION)
  const currentConfig = vscode.workspace.getConfiguration(CONFIG.section)
  const legacyInspect = legacyConfig.inspect<boolean>(LEGACY_CONFIG_KEY)
  const targets: [boolean | undefined, vscode.ConfigurationTarget][] = [
    [legacyInspect?.globalValue, vscode.ConfigurationTarget.Global],
    [legacyInspect?.workspaceValue, vscode.ConfigurationTarget.Workspace],
  ]
  for (const [legacyValue, target] of targets) {
    if (legacyValue === undefined) {
      continue
    }
    const existing = currentConfig.inspect<boolean>('serialConsoleEnabled')
    const hasNew =
      target === vscode.ConfigurationTarget.Global
        ? existing?.globalValue
        : existing?.workspaceValue
    if (hasNew === undefined) {
      await currentConfig.update('serialConsoleEnabled', legacyValue, target)
    }
    // 无论是否搬迁，旧键都清掉（新键已有值时旧值作废，避免残留半套配置）
    await legacyConfig.update(LEGACY_CONFIG_KEY, undefined, target)
    migrated = true
  }

  // ---- Memento（globalState） ----
  for (const [legacyKey, newKey] of LEGACY_MEMENTO_KEYS) {
    const legacy = context.globalState.get<unknown>(legacyKey)
    if (legacy === undefined) {
      continue
    }
    if (context.globalState.get(newKey) === undefined) {
      await context.globalState.update(newKey, legacy)
    }
    await context.globalState.update(legacyKey, undefined)
    migrated = true
  }

  return migrated
}
