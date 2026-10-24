import * as vscode from 'vscode'
import { STORAGE } from '../../constants'

/**
 * 串口命令历史条目（全局共享，跨服务器复用）。
 * 「自动去重」语义：trim 后精确匹配，重复发送移到列表顶部（MRU）并累计 useCount。
 */
export interface HistoryEntry {
  id: string
  command: string
  /** 最近一次发送时间（epoch ms），列表按其降序即 MRU 序。 */
  lastUsedAt: number
  /** 累计发送次数。 */
  useCount: number
}

/** 历史上限：超出按 lastUsedAt 淘汰最旧。 */
export const HISTORY_LIMIT = 200

export interface CommandHistoryService {
  /**
   * 记录一次发送。空白命令（trim 后为空）不入库。
   * @returns 记录后的完整列表（MRU 序）
   */
  record(command: string): Promise<HistoryEntry[]>
  /** 当前列表（MRU 序）；对存储中的坏条目做防御过滤。 */
  list(): Promise<HistoryEntry[]>
  /** 删除指定条目（未知 id 无变化）。 */
  remove(id: string): Promise<HistoryEntry[]>
  /** 清空历史。 */
  clear(): Promise<void>
}

export interface CommandHistoryOptions {
  /** 可注入时钟（测试用），缺省 Date.now。 */
  now?: () => number
  /** 存储键（测试用），缺省 STORAGE.serialCommandHistoryKey。 */
  key?: string
}

export function createCommandHistoryService(
  memento: vscode.Memento,
  options: CommandHistoryOptions = {}
): CommandHistoryService {
  const now = options.now ?? (() => Date.now())
  const key = options.key ?? STORAGE.serialCommandHistoryKey

  /** 读取并防御过滤：非对象 / command 非非空字符串的条目丢弃。 */
  const load = async (): Promise<HistoryEntry[]> => {
    const raw = memento.get<unknown>(key, [])
    if (!Array.isArray(raw)) return []
    const entries: HistoryEntry[] = []
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as Record<string, unknown>
      if (typeof record.command !== 'string' || record.command.length === 0) continue
      entries.push({
        id: typeof record.id === 'string' ? record.id : globalThis.crypto.randomUUID(),
        command: record.command,
        lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : 0,
        useCount: typeof record.useCount === 'number' ? record.useCount : 1,
      })
    }
    return entries
  }

  const save = async (entries: HistoryEntry[]): Promise<void> => {
    await memento.update(key, entries)
  }

  return {
    async record(command: string): Promise<HistoryEntry[]> {
      const trimmed = command.trim()
      const entries = await load()
      if (trimmed.length === 0) return entries
      const existing = entries.find((entry) => entry.command === trimmed)
      if (existing) {
        existing.lastUsedAt = now()
        existing.useCount += 1
        // MRU：移到顶部
        const rest = entries.filter((entry) => entry !== existing)
        const updated = [existing, ...rest].slice(0, HISTORY_LIMIT)
        await save(updated)
        return updated
      }
      const entry: HistoryEntry = {
        id: globalThis.crypto.randomUUID(),
        command: trimmed,
        lastUsedAt: now(),
        useCount: 1,
      }
      const updated = [entry, ...entries].slice(0, HISTORY_LIMIT)
      await save(updated)
      return updated
    },

    list: load,

    async remove(id: string): Promise<HistoryEntry[]> {
      const entries = await load()
      const updated = entries.filter((entry) => entry.id !== id)
      if (updated.length !== entries.length) await save(updated)
      return updated
    },

    async clear(): Promise<void> {
      await save([])
    },
  }
}
