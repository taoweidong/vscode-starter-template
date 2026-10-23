import * as vscode from 'vscode'
import type { Item } from '../../models/item'
import { normalizeItemList } from '../../models/itemGuard'
import type { IItemStore } from './itemStore'

/** MementoStore 的可注入选项。 */
export interface MementoStoreOptions {
  /** 数据修复警告上报（与 JsonFileStore.onWarning 语义一致）。 */
  onWarning?: (message: string) => void
}

/**
 * 备用数据源：VSCode 全局存储（globalState）。
 * 当用户没有打开任何工作区时没有文件可写，改用 Memento 持久化，保证插件在空窗口也能用。
 * load 时同样走 normalizeItemList：坏条目跳过 + 默认值补齐（T1.3）。
 */
export class MementoStore implements IItemStore {
  constructor(
    private readonly memento: vscode.Memento,
    private readonly key: string,
    private readonly options: MementoStoreOptions = {}
  ) {}

  async load(): Promise<Item[]> {
    const raw = this.memento.get<unknown>(this.key, [])
    if (!Array.isArray(raw)) {
      this.options.onWarning?.('全局存储中的条目数据不是数组，已按空数据处理。')
      return []
    }
    return normalizeItemList(raw, this.options.onWarning)
  }

  async save(items: Item[]): Promise<void> {
    await this.memento.update(this.key, items)
  }
}
