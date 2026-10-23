import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { findWebviewPage, WEBVIEW_PAGES, type WebviewPageDef, type WebviewPageId } from '../pages'
import { isWebviewMessage, type FieldDef, type HostMessage, type WebviewMessage } from '../protocol'
import {
  loadWebviewManifest,
  resolveEntryAssets,
  webviewRootUri,
  type WebviewAssets,
} from './assetResolver'
import { renderWebviewHtml } from './webviewHtml'

/**
 * 通用 Webview 面板控制器（docs/需求与优化方案/03 §5.2 / 05 S3、S5）。
 *
 * - 每个 pageId 一个实例（模块级注册表）；
 * - 消息先过 protocol.ts 守卫，未知消息记日志不抛错（修复 W7）；
 * - submit 在途幂等，10s 超时自动解锁并回 error（修复 W8 宿主侧）；
 * - dirty 跟踪：切换目标前经模态确认；
 * - 草稿持久化：页面侧经 webview getState/setState 自行保存，宿主只在
 *   serializer 恢复时把持久化状态随 init.extra.persisted 传回（保留恢复入口）；
 * - dispose 幂等：onDidDispose 只清理资源，不再反向 panel.dispose；dispose 标志防重入（修复 P1-17）；
 * - 面板工厂与资源解析可注入，便于单测。
 */

/** Webview 面板的最小结构面（vscode.WebviewPanel 结构兼容，测试可注入桩）。 */
export interface WebviewLike {
  readonly cspSource: string
  html: string
  asWebviewUri(uri: vscode.Uri): vscode.Uri
  postMessage(message: unknown): Thenable<boolean>
  onDidReceiveMessage(listener: (message: unknown) => unknown): vscode.Disposable
}

export interface WebviewPanelLike {
  readonly webview: WebviewLike
  onDidDispose(listener: () => unknown): vscode.Disposable
  reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void
  dispose(): void
}

export type PanelFactory = (viewType: string, title: string) => WebviewPanelLike

/** init 消息的业务载荷（M4 页面接入时由宿主提供 schema 与初值）。 */
export interface WebviewInitPayload {
  schema: FieldDef[]
  value: unknown
  extra?: Record<string, unknown>
}

/** buildInit 的上下文：把序列化器恢复出的持久化状态交给业务层解析目标。 */
export interface BuildInitContext {
  /** serializer 恢复出的 webview 持久化状态（页面经 setState 保存；新建面板为 undefined）。 */
  persistedState: unknown
}

export interface WebviewControllerDeps {
  /** 面板工厂；默认 vscode.window.createWebviewPanel（retainContextWhenHidden 一律 false）。 */
  createPanel?: PanelFactory
  /** 入口资源解析；默认经 manifest（assetResolver），测试注入假实现。 */
  resolveAssets?: (webview: WebviewLike) => Promise<WebviewAssets>
  /** 提交处理器：成功回 submitAck，抛错 / 超时回 error（err.field 为字符串时随 error 下发）。 */
  onSubmit?: (draft: Record<string, unknown>) => Promise<void>
  /** 取消回调（页面点取消 / Esc）。 */
  onCancel?: () => void
  /**
   * init 载荷构造（M4 接入用）；缺省 schema 为空、value 为 null。
   * 可返回 Promise（宿主需要异步取数，如 service.getCategories / 编辑目标回查）。
   */
  buildInit?: (context: BuildInitContext) => WebviewInitPayload | Promise<WebviewInitPayload>
  /**
   * 页面专属消息分发（protocol.ts 中 ready/dirty/submit/cancel 之外的消息，
   * 如批量导入向导的 browseFolder / requestPreview / executeImport / cancelImport）。
   */
  onPageMessage?: (message: WebviewMessage) => void
  /** 诊断日志出口；缺省 console。 */
  log?: (message: string) => void
}

/** 面板 viewType 前缀（与 package.json 声明的面板类型保持同一命名习惯）。 */
const VIEW_TYPE_PREFIX = 'crudStarter.webview'

export function webviewViewType(pageId: WebviewPageId | string): string {
  return `${VIEW_TYPE_PREFIX}.${pageId}`
}

/** 提交在途超时（毫秒）：超时自动解锁并回 error。 */
const SUBMIT_TIMEOUT_MS = 10_000

function safeInspect(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export class WebviewController {
  private static readonly controllers = new Map<string, WebviewController>()

  /** 已存在则 reveal，否则创建新面板并加载入口资源。 */
  static createOrShow(
    pageId: WebviewPageId,
    context: vscode.ExtensionContext,
    deps: WebviewControllerDeps = {}
  ): WebviewController {
    const existing = WebviewController.controllers.get(pageId)
    if (existing && existing.panel) {
      existing.panel.reveal()
      return existing
    }
    const controller = new WebviewController(pageId, context, deps)
    WebviewController.controllers.set(controller.page.id, controller)
    void controller.open()
    return controller
  }

  static get(pageId: WebviewPageId | string): WebviewController | undefined {
    return WebviewController.controllers.get(pageId)
  }

  /**
   * 注册所有页面的面板序列化器（窗口重载后恢复面板：重建 HTML、发 init 带持久化状态）。
   * deps 可传固定依赖，也可传按 pageId 分发的工厂（各页面 onSubmit/buildInit 不同时用工厂）。
   */
  static registerSerializer(
    context: vscode.ExtensionContext,
    deps: WebviewControllerDeps | ((pageId: WebviewPageId) => WebviewControllerDeps) = {}
  ): void {
    for (const page of WEBVIEW_PAGES) {
      const pageDeps = typeof deps === 'function' ? deps(page.id) : deps
      const serializer: vscode.WebviewPanelSerializer = {
        deserializeWebviewPanel: async (
          panel: vscode.WebviewPanel,
          state: unknown
        ): Promise<void> => {
          const controller = new WebviewController(page.id, context, pageDeps)
          WebviewController.controllers.set(controller.page.id, controller)
          await controller.attachPanel(panel, state)
        },
      }
      context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(webviewViewType(page.id), serializer)
      )
    }
  }

  /** 单测专用：清空注册表并丢弃全部面板（不触发真实 dispose 副作用）。 */
  static __resetForTest(): void {
    WebviewController.controllers.clear()
  }

  readonly page: WebviewPageDef
  readonly ready: Promise<void>

  private readonly deps: Required<
    Pick<WebviewControllerDeps, 'createPanel' | 'resolveAssets' | 'log'>
  > &
    WebviewControllerDeps
  private readonly readyResolve: () => void
  private panel: WebviewPanelLike | undefined
  private messageDisposable: vscode.Disposable | undefined
  private disposed = false
  private dirty = false
  private submitting = false
  private submitTimer: ReturnType<typeof setTimeout> | undefined
  private restoredState: unknown

  constructor(
    pageId: WebviewPageId | string,
    context: vscode.ExtensionContext,
    deps: WebviewControllerDeps = {}
  ) {
    const page = findWebviewPage(pageId)
    if (!page) {
      throw new Error(`未注册的 Webview 页面 id：「${pageId}」。请在 src/webview/pages.ts 登记。`)
    }
    this.page = page
    const extensionUri = context.extensionUri
    this.deps = {
      ...deps,
      createPanel:
        deps.createPanel ??
        ((viewType: string, title: string): WebviewPanelLike =>
          vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: [webviewRootUri(extensionUri)],
          })),
      resolveAssets:
        deps.resolveAssets ??
        (async (webview: WebviewLike): Promise<WebviewAssets> => {
          const manifest = await loadWebviewManifest(extensionUri)
          return resolveEntryAssets(webview, manifest, page.id, webviewRootUri(extensionUri))
        }),
      log: deps.log ?? ((message: string): void => console.log(`[webview:${page.id}] ${message}`)),
    }
    let resolveReady!: () => void
    this.ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    this.readyResolve = resolveReady
  }

  get isDirty(): boolean {
    return this.dirty
  }

  /** 切换目标前确认：dirty 时弹模态警告，用户拒绝则返回 false。 */
  async confirmSwitchTarget(action = '切换目标'): Promise<boolean> {
    if (!this.dirty) {
      return true
    }
    const discard = '放弃修改并继续'
    const choice = await vscode.window.showWarningMessage(
      `当前有未保存的修改，${action}将丢失这些修改。`,
      { modal: true },
      discard
    )
    if (choice !== discard) {
      return false
    }
    this.dirty = false
    return true
  }

  reveal(): void {
    this.panel?.reveal()
  }

  /** 编程式关闭面板（幂等；用户直接关面板走 onDidDispose 路径，不会反向 panel.dispose）。 */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const panel = this.panel
    this.releaseResources()
    panel?.dispose()
  }

  private async open(): Promise<void> {
    const panel = this.deps.createPanel(webviewViewType(this.page.id), this.page.title)
    await this.attachPanel(panel, undefined)
  }

  /** 绑定已有面板（serializer 恢复 / createOrShow 创建后调用）。 */
  async attachPanel(panel: WebviewPanelLike, restoredState: unknown): Promise<void> {
    this.panel = panel
    this.restoredState = restoredState
    panel.onDidDispose(() => this.handlePanelDisposed())
    this.messageDisposable?.dispose()
    this.messageDisposable = panel.webview.onDidReceiveMessage((raw) => this.handleMessage(raw))
    try {
      panel.webview.html = await this.renderHtml(panel.webview)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.deps.log(`HTML 外壳生成失败：${reason}`)
      panel.webview.html = WebviewController.renderDiagnosticHtml(this.page.title, reason)
    } finally {
      this.readyResolve()
    }
  }

  private async renderHtml(webview: WebviewLike): Promise<string> {
    const assets = await this.deps.resolveAssets(webview)
    return renderWebviewHtml({
      pageId: this.page.id,
      title: this.page.title,
      scriptUri: assets.scriptUri.toString(),
      styleUris: assets.styleUris.map((uri) => uri.toString()),
      cspSource: webview.cspSource,
      nonce: randomUUID().replace(/-/g, ''),
    })
  }

  /** 每帧 nonce 都重新生成；诊断 HTML 不加载任何脚本。 */
  private static renderDiagnosticHtml(title: string, reason: string): string {
    const escaped = (value: string): string =>
      value.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))
    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><title>${escaped(title)}</title></head>
  <body><pre>页面资源加载失败：${escaped(reason)}</pre></body>
</html>`
  }

  private handleMessage(raw: unknown): void {
    if (!isWebviewMessage(raw)) {
      this.deps.log(`忽略无法识别的 Webview 消息：${safeInspect(raw)}`)
      return
    }
    switch (raw.type) {
      case 'ready':
        void this.postInit()
        break
      case 'dirty':
        this.dirty = raw.dirty
        break
      case 'submit':
        void this.handleSubmit(raw.draft)
        break
      case 'cancel':
        this.dirty = false
        this.deps.onCancel?.()
        break
      default:
        // 页面专属消息（批量导入向导等）：交由业务层的 onPageMessage 分发
        this.deps.onPageMessage?.(raw)
        break
    }
  }

  private postInit(): void {
    const payload = this.deps.buildInit
      ? this.deps.buildInit({ persistedState: this.restoredState })
      : { schema: [], value: null }
    if (payload instanceof Promise) {
      void payload.then(
        (resolved) => this.emitInit(resolved),
        (err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err)
          this.deps.log(`init 载荷构造失败：${reason}`)
          this.post({ type: 'error', message: `页面初始化失败：${reason}` })
        }
      )
    } else {
      this.emitInit(payload)
    }
  }

  /** 组装并下发 init 消息（persisted 恢复状态随 extra 传回，页面自行决定是否恢复草稿）。 */
  private emitInit(payload: WebviewInitPayload): void {
    const extra: Record<string, unknown> = { ...(payload.extra ?? {}) }
    if (this.restoredState !== undefined) {
      // 草稿恢复入口：页面侧自行决定如何消费（持久化由页面经 webview API 完成）。
      extra.persisted = this.restoredState
    }
    const message: Extract<HostMessage, { type: 'init' }> = {
      type: 'init',
      page: this.page.id,
      schema: payload.schema,
      value: payload.value,
    }
    if (Object.keys(extra).length > 0) {
      message.extra = extra
    }
    this.post(message)
  }

  /** 重新下发 init（同一面板切换目标时由宿主面板类调用，页面收到后整体重置状态）。 */
  sendInit(): void {
    this.postInit()
  }

  private async handleSubmit(draft: Record<string, unknown>): Promise<void> {
    if (this.submitting) {
      this.deps.log('提交在途，忽略重复提交')
      return
    }
    this.submitting = true
    const task = this.deps.onSubmit
      ? this.deps.onSubmit(draft)
      : Promise.reject(new Error('该页面未配置提交处理（onSubmit）'))
    // 超时先到也要吞掉后到的 rejection，避免未处理异常告警。
    void task.catch(() => undefined)
    try {
      await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          this.submitTimer = setTimeout(
            () => reject(new Error('提交处理超时（10 秒），已自动解锁')),
            SUBMIT_TIMEOUT_MS
          )
        }),
      ])
      this.post({ type: 'submitAck', ok: true })
    } catch (err) {
      // 业务层可通过给 err 附加 field 字符串属性，让页面把错误定位到具体控件
      const field = (err as { field?: unknown } | null | undefined)?.field
      this.post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        ...(typeof field === 'string' ? { field } : {}),
      })
    } finally {
      if (this.submitTimer) {
        clearTimeout(this.submitTimer)
        this.submitTimer = undefined
      }
      this.submitting = false
    }
  }

  /** 宿主 → 页面：下发协议消息（面板已关闭时静默丢弃）。 */
  post(message: HostMessage): void {
    void this.panel?.webview.postMessage(message)
  }

  /** 用户关闭面板：只清理资源，不反向 panel.dispose（幂等标志防重入）。 */
  private handlePanelDisposed(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.releaseResources()
  }

  private releaseResources(): void {
    this.panel = undefined
    this.dirty = false
    this.submitting = false
    if (this.submitTimer) {
      clearTimeout(this.submitTimer)
      this.submitTimer = undefined
    }
    this.messageDisposable?.dispose()
    this.messageDisposable = undefined
    WebviewController.controllers.delete(this.page.id)
  }
}
