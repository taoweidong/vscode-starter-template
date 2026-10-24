import { randomUUID } from 'node:crypto'
import * as path from 'path'
import * as vscode from 'vscode'
import type { Item } from '../../models/item'
import { normalizeItemList } from '../../models/itemGuard'
import type { IItemStore } from './itemStore'
import { writeJsonAtomic } from './atomicWrite'

/**
 * 默认数据源：工作区内的 JSON 文件（路径由 crudStarter.storagePath 配置，经白名单校验）。
 * 数据文件可直接提交到 git，也可被手工编辑——修改后插件会通过 FileSystemWatcher 自动刷新。
 *
 * 可靠性契约（M1 / NFR-01）：
 * - save 原子：写同目录临时文件 → 读回比对 → rename 覆盖；任何失败都保证**原文件不变**；
 * - load 只把「解析失败 / 根节点形态不对」视为损坏：**复制**备份（原文件留在原位），
 *   再交由注入的 onCorrupted 决定继续方式；IO 错误（无权限等）不是损坏，直接抛出；
 * - 文件格式为 v2 信封 `{schemaVersion, items}`，旧版顶层数组自动迁移读取。
 */

/** 当前存储格式版本。 */
export const STORAGE_SCHEMA_VERSION = 2

/**
 * 同一文件连续损坏的重试窗口（R-C-3）：窗口内的再次损坏只抛错，
 * 不重复备份、不重复弹恢复模态——「一次明确的事故」不会演变成弹窗风暴 + 磁盘垃圾。
 * 超出窗口（文件可能已被用户修好）才重新走完整恢复流程。
 */
export const CORRUPTION_RETRY_WINDOW_MS = 60_000

/** 损坏事件上下文：原文件、备份文件与原因。 */
export interface StoreCorruptedInfo {
  originalUri: vscode.Uri
  backupUri: vscode.Uri
  reason: string
}

/** 损坏后的用户决策：以空数据继续 / 打开原文件 / 中止。 */
export type CorruptionChoice = 'continue-empty' | 'open-file' | 'abort'

export type OnCorruptedHandler = (info: StoreCorruptedInfo) => Promise<CorruptionChoice>

export type OnWarningHandler = (message: string) => void

export interface JsonFileStoreOptions {
  /** 损坏恢复决策回调（extension.ts 接 showErrorMessage 三选一）；缺省直接抛 StoreCorruptedError。 */
  onCorrupted?: OnCorruptedHandler
  /** 数据修复 / 迁移警告上报（extension.ts 接 outputChannel）。 */
  onWarning?: OnWarningHandler
}

/** 数据文件损坏（已复制备份、原文件未动），交由上层提示用户处理。 */
export class StoreCorruptedError extends Error {
  constructor(readonly info: StoreCorruptedInfo) {
    super(
      `数据文件解析失败：${info.reason}。` +
        `原文件保留在原位，已复制备份到 ${path.basename(info.backupUri.fsPath)}。`
    )
    this.name = 'StoreCorruptedError'
  }
}

export class JsonFileStore implements IItemStore {
  /** 上次损坏恢复的记录（时间戳 + 上下文）：窗口内连续损坏只处理一次（R-C-3）。 */
  private lastCorruption: { at: number; info: StoreCorruptedInfo } | undefined

  constructor(
    public readonly fileUri: vscode.Uri,
    private readonly options: JsonFileStoreOptions = {}
  ) {}

  async load(): Promise<Item[]> {
    let text: string
    try {
      const raw = await vscode.workspace.fs.readFile(this.fileUri)
      text = Buffer.from(raw).toString('utf8')
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        return [] // 首次使用：文件尚不存在，视为空数据
      }
      throw err // IO 错误（无权限 / 文件被占用等）不是损坏，直接上抛
    }
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1) // 剥离 BOM，避免 JSON.parse 失败被误判为损坏
    }

    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (err) {
      return this.recoverFromCorruption(err instanceof Error ? err.message : String(err))
    }

    if (Array.isArray(data)) {
      // v1 顶层数组：兼容读取，下次保存自动迁移为 v2 信封
      this.options.onWarning?.('数据文件为旧版数组格式，已兼容读取，下次保存自动迁移为 v2 格式。')
      return normalizeItemList(data, this.options.onWarning)
    }
    if (isEnvelopeLike(data)) {
      const envelope = data as { schemaVersion?: unknown; items: unknown[] }
      if (
        envelope.schemaVersion !== undefined &&
        envelope.schemaVersion !== STORAGE_SCHEMA_VERSION
      ) {
        this.options.onWarning?.(
          `数据文件 schemaVersion=${String(envelope.schemaVersion)} 与当前版本 ${STORAGE_SCHEMA_VERSION} 不一致，已尽力按 items 读取。`
        )
      }
      return normalizeItemList(envelope.items, this.options.onWarning)
    }
    return this.recoverFromCorruption('根节点既不是数组，也不是含 items 数组的对象')
  }

  async save(items: Item[]): Promise<void> {
    // 原子写实现抽取至 atomicWrite.ts（与服务器数据文件共用），可靠性契约不变
    await writeJsonAtomic(this.fileUri, { schemaVersion: STORAGE_SCHEMA_VERSION, items })
  }

  /**
   * 损坏恢复（P0-01）：复制备份（不移走原文件）→ 交上层决策。
   * 只有用户明确选择「以空数据继续」才返回 []；其余情况抛 StoreCorruptedError，
   * 确保不会把损坏文件静默当成空数据覆盖掉。
   *
   * 终态缓存（R-C-3）：窗口内的连续损坏复用上次上下文直接抛错——
   * 不重复 copy 备份、不重复调 onCorrupted（用户 abort 后不再弹窗风暴）。
   */
  private async recoverFromCorruption(reason: string): Promise<Item[]> {
    const now = Date.now()
    if (this.lastCorruption && now - this.lastCorruption.at < CORRUPTION_RETRY_WINDOW_MS) {
      throw new StoreCorruptedError(this.lastCorruption.info)
    }
    const dirUri = vscode.Uri.joinPath(this.fileUri, '..')
    // 随机后缀：同毫秒二次损坏也不会覆盖前一份备份（R-C-19）
    const backupUri = vscode.Uri.joinPath(
      dirUri,
      `${path.basename(this.fileUri.fsPath)}.corrupt-${now}-${randomUUID().slice(0, 8)}.bak`
    )
    // 备份失败必须显式抛错（错误带原文件路径，便于用户定位处理；静默继续等于放弃用户数据）
    try {
      await vscode.workspace.fs.copy(this.fileUri, backupUri)
    } catch (err) {
      throw new Error(
        `数据文件损坏且备份失败：无法将 ${this.fileUri.fsPath} 复制为 ${backupUri.fsPath}` +
          `（${err instanceof Error ? err.message : String(err)}）。` +
          `原文件保留在原位，请手动保存副本后再处理。`,
        { cause: err }
      )
    }

    const info: StoreCorruptedInfo = { originalUri: this.fileUri, backupUri, reason }
    const handler = this.options.onCorrupted
    this.lastCorruption = { at: now, info }
    if (!handler) {
      throw new StoreCorruptedError(info)
    }
    const choice = await handler(info)
    if (choice === 'continue-empty') {
      return []
    }
    if (choice === 'open-file') {
      await vscode.window.showTextDocument(this.fileUri)
    }
    throw new StoreCorruptedError(info)
  }
}

/** 形态判定：对象且带 items 数组（schemaVersion 可缺省，兼容手工编辑）。 */
function isEnvelopeLike(data: unknown): data is { items: unknown[] } {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { items?: unknown }).items)
  )
}
