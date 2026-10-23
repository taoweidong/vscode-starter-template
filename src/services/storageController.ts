import * as vscode from 'vscode'
import { CONFIG, STORAGE } from '../constants'
import { ItemService } from './itemService'
import { resolveStorageUriOrDefault, storageRelativePath } from './storagePath'
import type {
  CorruptionChoice,
  OnCorruptedHandler,
  OnWarningHandler,
  StoreCorruptedInfo,
} from './stores/jsonFileStore'
import { JsonFileStore } from './stores/jsonFileStore'
import { MementoStore } from './stores/mementoStore'
import type { IItemStore } from './stores/itemStore'

/** watcher 防抖窗口：外部修改事件在窗口内合并为一次 reload。 */
const RELOAD_DEBOUNCE_MS = 300
/** 自身保存后该窗口内的变更事件视为自触发，忽略（防止 reload 回环）。 */
const SELF_WRITE_SUPPRESS_MS = 500

/** StorageController 的可注入依赖。 */
export interface StorageControllerOptions {
  /** 空窗口时 MementoStore 使用的 globalState。 */
  globalState: vscode.Memento
  /** 数据修复 / 迁移警告上报（extension.ts 接 outputChannel）。 */
  onWarning?: OnWarningHandler
  /** 数据文件损坏后的用户决策回调（extension.ts 接 showErrorMessage 三选一）。 */
  onCorrupted?: OnCorruptedHandler
  /**
   * 是否允许外部修改自动刷新（默认恒为 true）。
   * extension.ts 注入 getFeatureValue('autoRefreshOnExternalChange') 以尊重特性开关。
   */
  shouldAutoReload?: () => boolean
}

/**
 * T1.6（P1-06）：存储生命周期的唯一管理者。
 *
 * 职责：根据「工作区 + crudStarter.storagePath 配置」创建 / 重建 store 与 watcher，
 * 并把重建结果通过 service.replaceStore 注入（service 实例与命令注册引用保持不变）。
 * 订阅 onDidChangeWorkspaceFolders 与 onDidChangeConfiguration(storagePath) 触发重建。
 *
 * watcher 加固（T1.5 / P1-03）：
 * - 变更事件 300ms 防抖；
 * - 自身保存后 500ms 内的变更事件忽略（依据 service.lastPersistAt）；
 * - 删除事件不把「空」当有效数据：只静默失效缓存（reload({silent:true})），不广播空列表。
 */
export class StorageController implements vscode.Disposable {
  /** 条目服务：实例在整个扩展生命周期内保持不变。 */
  readonly service: ItemService

  private store: IItemStore
  private watcher: vscode.FileSystemWatcher | undefined
  private watcherSubs: vscode.Disposable[] = []
  private readonly subscriptions: vscode.Disposable[] = []
  private reloadTimer: ReturnType<typeof setTimeout> | undefined
  /** 上次触发过「非法配置」提示的配置值：同一非法值只提示一次。 */
  private lastWarnedInvalidPath: string | undefined

  constructor(private readonly options: StorageControllerOptions) {
    this.store = this.createStore()
    this.service = new ItemService(this.store)
    this.attachWatcher()
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.rebuild('工作区变化')),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${CONFIG.section}.${CONFIG.storagePath}`)) {
          this.rebuild('storagePath 配置变化')
        }
      })
    )
  }

  /** 当前数据源（extension.ts 组装命令依赖时取用）。 */
  get currentStore(): IItemStore {
    return this.store
  }

  dispose(): void {
    this.clearReloadTimer()
    this.detachWatcher()
    for (const subscription of this.subscriptions) {
      subscription.dispose()
    }
  }

  // ---------------- 内部：创建 / 重建 ----------------

  private createStore(): IItemStore {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri
    if (!root) {
      return new MementoStore(this.options.globalState, STORAGE.mementoKey, {
        onWarning: this.options.onWarning,
      })
    }
    const configured = this.readConfiguredPath()
    const resolved = resolveStorageUriOrDefault(root, configured)
    if (resolved.usedDefault && resolved.reason) {
      this.warnInvalidPathOnce(configured, resolved.reason)
    }
    return new JsonFileStore(resolved.uri, {
      onWarning: this.options.onWarning,
      onCorrupted: this.options.onCorrupted as OnCorruptedHandler | undefined,
    })
  }

  /** 环境变化时重建 store + watcher；数据位置没变则跳过（避免无谓刷新）。 */
  private rebuild(trigger: string): void {
    const next = this.createStore()
    if (sameStore(this.store, next)) {
      return
    }
    this.clearReloadTimer()
    this.detachWatcher()
    this.store = next
    this.service.replaceStore(next)
    this.attachWatcher()
    this.service.reload() // 通知树视图按新数据源刷新
    void trigger
  }

  private readConfiguredPath(): string {
    return vscode.workspace
      .getConfiguration(CONFIG.section)
      .get<string>(CONFIG.storagePath, STORAGE.defaultFileName)
  }

  /** 非法配置回退默认路径并提示；同一非法值只提示一次（不中断激活）。 */
  private warnInvalidPathOnce(configured: string, reason: string): void {
    if (this.lastWarnedInvalidPath === configured) {
      return
    }
    this.lastWarnedInvalidPath = configured
    void vscode.window.showWarningMessage(
      `CRUD Starter：crudStarter.storagePath 配置值「${configured}」无效（${reason}），` +
        `已回退默认路径 ${STORAGE.defaultFileName}。`
    )
  }

  // ---------------- 内部：watcher ----------------

  private attachWatcher(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri
    if (!(this.store instanceof JsonFileStore) || !root) {
      return // MementoStore（空窗口）没有文件可监听
    }
    const pattern = new vscode.RelativePattern(root, storageRelativePath(root, this.store.fileUri))
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    this.watcher = watcher
    this.watcherSubs.push(
      watcher.onDidChange(() => this.scheduleExternalReload()),
      watcher.onDidCreate(() => this.scheduleExternalReload()),
      // 删除事件单独处理：文件暂失（如 git checkout）时不能把「空」当有效数据广播
      watcher.onDidDelete(() => this.onStorageFileDeleted())
    )
  }

  private detachWatcher(): void {
    for (const subscription of this.watcherSubs) {
      subscription.dispose()
    }
    this.watcherSubs = []
    this.watcher?.dispose()
    this.watcher = undefined
  }

  private shouldAutoReload(): boolean {
    return this.options.shouldAutoReload ? this.options.shouldAutoReload() : true
  }

  /** 外部修改：300ms 防抖合并；自身保存后短窗口内的事件忽略（防 reload 回环）。 */
  private scheduleExternalReload(): void {
    if (!this.shouldAutoReload() || this.reloadTimer) {
      return
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined
      const lastPersistAt = this.service.lastPersistAt
      if (lastPersistAt !== undefined && Date.now() - lastPersistAt < SELF_WRITE_SUPPRESS_MS) {
        return // 自身保存触发的文件事件
      }
      this.service.reload()
    }, RELOAD_DEBOUNCE_MS)
  }

  /** 文件被删除：只静默失效缓存，不把空列表当有效数据广播。 */
  private onStorageFileDeleted(): void {
    if (!this.shouldAutoReload()) {
      return
    }
    this.service.reload({ silent: true })
  }

  private clearReloadTimer(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = undefined
    }
  }
}

/** 两个数据源是否等价（同为 Memento，或同指向同一文件的 JsonFileStore）。 */
function sameStore(a: IItemStore, b: IItemStore): boolean {
  if (a instanceof JsonFileStore && b instanceof JsonFileStore) {
    return a.fileUri.toString() === b.fileUri.toString()
  }
  return a instanceof MementoStore && b instanceof MementoStore
}

export type { CorruptionChoice, StoreCorruptedInfo }
