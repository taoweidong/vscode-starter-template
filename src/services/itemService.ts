import * as vscode from 'vscode'
import { createId, type Item, type ItemDraft } from '../models/item'
import { applyPatch, cloneDraft, coerceDraft } from '../domain/itemSchema'
import type { IItemStore } from './stores/itemStore'

/** 业务校验失败（区别于 IO 异常，界面会按「可修正错误」提示）。 */
export class ItemValidationError extends Error {}

/** reload 选项：silent=true 时只失效缓存、不广播变更事件。 */
export interface ReloadOptions {
  silent?: boolean
}

/**
 * 业务服务层：所有 CRUD 操作的入口。
 * 职责：输入校验、字段清洗、时间戳与 ID 生成、过滤、变更事件通知。
 * 持久化委托给 IItemStore，本层不关心数据存在哪里。
 *
 * 并发与缓存契约（T1.4 / NFR-02）：
 * - 首次并发加载只读一次存储（loadPromise 单飞）；
 * - 所有写操作经串行队列（enqueue 链式 Promise），后写不会覆盖先写；
 * - persist 采用「构造 next → save 成功 → 才提交缓存并 fire」：失败时缓存整体失效，
 *   下次操作从存储重读，杜绝脏缓存导致的重复 / 幻影数据；
 * - reload 带 generation 计数，过期加载结果不落缓存；
 * - 缓存以 { items, searchTexts } 快照同源维护（R-C-1）：过滤按下标索引
 *   搜索文本，两数组必须同世代——过期结果也整体返回，调用方自洽不错配。
 *
 * 批量契约（T5.2）：createMany / updateMany / removeMany 均为
 * 「单次读盘（队列内 ensureLoaded）→ 单次写盘 → 单次变更事件」的事务语义，
 * 批量导入 / 批量改优先级等场景不再产生 N 次写盘与 N 次刷新。
 */

/** 条目快照：items 与按下标对齐的搜索文本同源同生命周期（R-C-1）。 */
interface SearchSnapshot {
  items: Item[]
  searchTexts: string[]
}

/**
 * 模块级纯函数：构造与 items 按下标对齐的搜索文本（小写拼接）。
 * 过滤只做 includes；扩展字段不在搜索范围（与既有行为一致）。
 */
export function buildSearchTexts(items: Item[]): string[] {
  return items.map((item) =>
    [item.name, item.category, item.description, item.tags.join(' ')].join(' ').toLowerCase()
  )
}

export class ItemService {
  private store: IItemStore
  /** 数据缓存快照（items + 平行搜索文本），undefined 表示尚未加载 / 已失效。 */
  private snapshot: SearchSnapshot | undefined
  private filter = ''
  /** 首载单飞：并发 ensureLoaded 共享同一次 load。 */
  private loadPromise: Promise<SearchSnapshot> | undefined
  /** 写操作串行队列的尾指针。 */
  private writeQueue: Promise<unknown> = Promise.resolve()
  /** reload 世代号：每次失效缓存 +1，晚到的旧 load 结果据此丢弃。 */
  private reloadGeneration = 0
  /** 最近一次持久化成功的时间戳（watcher 据此抑制自身保存触发的事件）。 */
  private lastPersistAtValue: number | undefined

  private readonly _onDidChangeItems = new vscode.EventEmitter<void>()
  /** 数据发生变化（或过滤条件变化）后触发，树视图订阅它实现自动刷新。 */
  readonly onDidChangeItems = this._onDidChangeItems.event

  constructor(store: IItemStore) {
    this.store = store
  }

  /** 最近一次成功写盘的时间（毫秒时间戳）；尚未写过为 undefined。 */
  get lastPersistAt(): number | undefined {
    return this.lastPersistAtValue
  }

  /** 更换数据源（如 storagePath / 工作区变化后由 StorageController 调用）：缓存随之失效。 */
  replaceStore(store: IItemStore): void {
    this.store = store
    this.invalidate()
  }

  // ---------------- 查（R） ----------------

  /** 列出条目（自动应用当前过滤关键字）。 */
  async list(): Promise<Item[]> {
    const { items, searchTexts } = await this.ensureLoaded()
    const keyword = this.filter.trim().toLowerCase()
    if (!keyword) {
      return [...items]
    }
    // 过滤只用本快照内的搜索文本：过期结果整体返回，两数组按下标不错配（R-C-1）
    return items.filter((_, index) => searchTexts[index]?.includes(keyword) ?? false)
  }

  /** 列出全部条目（忽略当前过滤——供选择器等需要完整集合的场景）。 */
  async listAll(): Promise<Item[]> {
    const { items } = await this.ensureLoaded()
    return [...items]
  }

  async get(id: string): Promise<Item | undefined> {
    return (await this.ensureLoaded()).items.find((item) => item.id === id)
  }

  /** 已有的分类列表（供表单 datalist 提示）。 */
  async getCategories(): Promise<string[]> {
    const categories = new Set(
      (await this.ensureLoaded()).items.map((item) => item.category).filter(Boolean)
    )
    return [...categories].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }

  getFilter(): string {
    return this.filter
  }

  get filtered(): boolean {
    return this.filter.trim().length > 0
  }

  setFilter(keyword: string): void {
    this.filter = keyword ?? ''
    this._onDidChangeItems.fire()
  }

  // ---------------- 增（C）改（U）删（D） ----------------

  async create(draft: ItemDraft): Promise<Item> {
    return this.enqueue(async () => {
      const input = this.validate(draft)
      const items = (await this.ensureLoaded()).items
      const now = new Date().toISOString()
      const item: Item = { id: createId(), ...input, createdAt: now, updatedAt: now }
      await this.persist([...items, item])
      return item
    })
  }

  /**
   * 批量新增（T5.2）：**事务语义**——先对全部 draft 做 coerceDraft，
   * 任一校验失败则整体失败（不进写队列、不落盘）；全部合法才单次读盘、单次写盘、单次事件。
   */
  async createMany(drafts: ItemDraft[]): Promise<Item[]> {
    // 先全量校验（队列外 fail-fast）：任一失败直接抛 ItemValidationError，不触发任何写
    const inputs = drafts.map((draft) => this.validate(draft))
    return this.enqueue(async () => {
      const items = (await this.ensureLoaded()).items
      const now = new Date().toISOString()
      const created: Item[] = inputs.map((input) => ({
        id: createId(),
        ...input,
        createdAt: now,
        updatedAt: now,
      }))
      await this.persist([...items, ...created])
      return created
    })
  }

  async update(id: string, draft: ItemDraft): Promise<Item> {
    return this.enqueue(async () => {
      const input = this.validate(draft)
      const items = (await this.ensureLoaded()).items
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) {
        throw new ItemValidationError('条目不存在，可能已被删除。')
      }
      // {...item, ...input}：以条目当前值为底合并——input 未携带的扩展字段保留（P0-04）
      const updated: Item = { ...items[index], ...input, updatedAt: new Date().toISOString() }
      await this.persist(items.map((item, i) => (i === index ? updated : item)))
      return updated
    })
  }

  /**
   * 批量更新（T5.2）：按 id 取**最新条目**（队列内一次 ensureLoaded，外部修改不被旧快照覆盖，
   * 关闭 P1-05 的批量形态）+ patch 局部合并；单次写盘、单次事件；
   * 任一 id 不存在或合并后校验失败 → 抛 ItemValidationError，整体不落盘（事务）。
   */
  async updateMany(updates: { id: string; patch: Partial<ItemDraft> }[]): Promise<Item[]> {
    return this.enqueue(async () => {
      const items = (await this.ensureLoaded()).items
      const next = [...items]
      const results: Item[] = []
      const indexById = new Map(items.map((item, index) => [item.id, index] as const))
      const now = new Date().toISOString()
      for (const { id, patch } of updates) {
        const index = indexById.get(id)
        const current = index !== undefined ? next[index] : undefined
        if (!current) {
          throw new ItemValidationError(`条目不存在（id：${id}），可能已被删除。`)
        }
        // applyPatch 以条目当前值（含扩展字段）为底，patch 只覆盖出现的字段
        const input = this.validate(applyPatch(current, patch))
        const updated: Item = { ...current, ...input, updatedAt: now }
        next[index!] = updated
        results.push(updated)
      }
      await this.persist(next)
      return results
    })
  }

  async remove(id: string): Promise<Item | undefined> {
    return this.enqueue(async () => {
      const items = (await this.ensureLoaded()).items
      const target = items.find((item) => item.id === id)
      if (!target) {
        return undefined
      }
      await this.persist(items.filter((item) => item.id !== id))
      return target
    })
  }

  /**
   * 批量删除（T5.2）：单次读盘、单次写盘、单次事件；
   * 返回实际删除的条目与未找到的 id（不因个别缺失而整体失败）。
   * 全部未命中时不写盘、不发事件（无数据变化）。
   */
  async removeMany(ids: string[]): Promise<{ removed: Item[]; missing: string[] }> {
    return this.enqueue(async () => {
      const items = (await this.ensureLoaded()).items
      const existingIds = new Set(items.map((item) => item.id))
      const requested = [...new Set(ids)] // 输入去重，missing 按首次出现顺序报告
      const missing = requested.filter((id) => !existingIds.has(id))
      const removedIds = new Set(requested.filter((id) => existingIds.has(id)))
      const removed = items.filter((item) => removedIds.has(item.id))
      if (removed.length === 0) {
        return { removed, missing } // 全部未命中：无数据变化，不写盘不发事件
      }
      await this.persist(items.filter((item) => !removedIds.has(item.id)))
      return { removed, missing }
    })
  }

  async duplicate(id: string): Promise<Item> {
    return this.enqueue(async () => {
      const items = (await this.ensureLoaded()).items
      const source = items.find((item) => item.id === id)
      if (!source) {
        throw new ItemValidationError('条目不存在，可能已被删除。')
      }
      // cloneDraft 与 toDraft 同源：全字段（含扩展字段）复制，仅改名称（P0-04）
      const input = this.validate({ ...cloneDraft(source), name: `${source.name}（副本）` })
      const now = new Date().toISOString()
      const item: Item = { id: createId(), ...input, createdAt: now, updatedAt: now }
      await this.persist([...items, item])
      return item
    })
  }

  /**
   * 存储被外部修改（如手工编辑 JSON 文件）后调用：丢弃缓存并刷新视图。
   * silent=true 只失效缓存不广播（文件被删除等「空不可信」场景，避免树被刷成空列表）。
   */
  reload(options: ReloadOptions = {}): void {
    this.invalidate()
    if (!options.silent) {
      this._onDidChangeItems.fire()
    }
  }

  // ---------------- 内部 ----------------

  /**
   * 领域校验（T5.1 / P0-04）：统一走 src/domain/itemSchema.ts 的 coerceDraft，
   * 按字段定义表动态清洗；未知字段（string / number / boolean）透传保留。
   * 失败抛 ItemValidationError（携带 field），消息自带字段中文名，可直接展示。
   */
  private validate(draft: ItemDraft): ItemDraft {
    const result = coerceDraft(draft)
    if (!result.ok) {
      // field 透传：页面据此把错误定位到具体控件（webviewController 经 err.field 下发）
      throw Object.assign(new ItemValidationError(result.message), { field: result.field })
    }
    return result.draft
  }

  /** 缓存失效：世代号 +1，丢弃缓存快照与在途单飞。 */
  private invalidate(): void {
    this.reloadGeneration += 1
    this.snapshot = undefined
    this.loadPromise = undefined
  }

  private async ensureLoaded(): Promise<SearchSnapshot> {
    if (this.snapshot) {
      return this.snapshot
    }
    if (!this.loadPromise) {
      const generation = this.reloadGeneration
      this.loadPromise = this.store.load().then(
        (items) => {
          this.loadPromise = undefined
          // 快照整体构造：过期结果（期间发生过 reload / replaceStore）不落缓存，
          // 但 items 与 searchTexts 仍同源返回给本次调用方（R-C-1）
          const next: SearchSnapshot = { items, searchTexts: buildSearchTexts(items) }
          if (generation === this.reloadGeneration) {
            this.snapshot = next
          }
          return next
        },
        (err) => {
          this.loadPromise = undefined
          throw err
        }
      )
    }
    return this.loadPromise
  }

  /** 写操作统一入队：链式 Promise 保证串行，前序失败不断链。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation)
    this.writeQueue = result.catch(() => undefined)
    return result
  }

  /**
   * 提交写入：save 成功才更新缓存快照并广播；失败则整体失效缓存（下次操作重新 load）。
   * 注意 items 必须是新构造的数组（不可原地修改缓存）。
   */
  private async persist(next: Item[]): Promise<void> {
    try {
      await this.store.save(next)
    } catch (err) {
      this.invalidate()
      throw err
    }
    // 缓存快照与搜索文本同源更新（R-C-1）：写后立即可按新值过滤
    this.snapshot = { items: next, searchTexts: buildSearchTexts(next) }
    this.lastPersistAtValue = Date.now()
    this._onDidChangeItems.fire()
  }
}
