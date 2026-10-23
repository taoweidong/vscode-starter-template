import type * as vscode from 'vscode'
import { Uri } from '../../stubs/vscode'
import type { WebviewLike, WebviewPanelLike } from '../../../../webview/host/webviewController'

/**
 * 面板桩（与 webviewController.spec 同一套手法）：
 * postMessage 录制到 posted；__emit 模拟页面发消息；__close 模拟用户关面板。
 */
export interface FakePanel {
  viewType: string
  title: string
  revealCalls: number
  disposeCalls: number
  posted: unknown[]
  webview: {
    html: string
    cspSource: string
    postMessage(message: unknown): Promise<boolean>
    asWebviewUri(uri: unknown): unknown
    onDidReceiveMessage(listener: (message: unknown) => unknown): { dispose(): void }
    __emit(message: unknown): void
  }
  onDidDispose(listener: () => void): { dispose(): void }
  reveal(): void
  dispose(): void
  __close(): void
}

export function createFakePanel(viewType: string, title: string): FakePanel {
  const disposeListeners = new Set<() => void>()
  const messageListeners = new Set<(message: unknown) => unknown>()
  const panel: FakePanel = {
    viewType,
    title,
    revealCalls: 0,
    disposeCalls: 0,
    posted: [],
    webview: {
      html: '',
      cspSource: 'vscode-webview-view:',
      postMessage(message: unknown): Promise<boolean> {
        panel.posted.push(message)
        return Promise.resolve(true)
      },
      asWebviewUri(uri: unknown): unknown {
        return uri
      },
      onDidReceiveMessage(listener: (message: unknown) => unknown): { dispose(): void } {
        messageListeners.add(listener)
        return {
          dispose(): void {
            messageListeners.delete(listener)
          },
        }
      },
      __emit(message: unknown): void {
        for (const listener of [...messageListeners]) {
          listener(message)
        }
      },
    },
    onDidDispose(listener: () => void): { dispose(): void } {
      disposeListeners.add(listener)
      return {
        dispose(): void {
          disposeListeners.delete(listener)
        },
      }
    },
    reveal(): void {
      panel.revealCalls += 1
    },
    dispose(): void {
      panel.disposeCalls += 1
      for (const listener of [...disposeListeners]) {
        listener()
      }
    },
    __close(): void {
      for (const listener of [...disposeListeners]) {
        listener()
      }
    },
  }
  return panel
}

/** 注入用面板依赖（createPanel + resolveAssets），返回 { deps, panels }。 */
export function makePanelDeps() {
  const panels: FakePanel[] = []
  const deps = {
    createPanel(viewType: string, title: string): WebviewPanelLike {
      const panel = createFakePanel(viewType, title)
      panels.push(panel)
      return panel as unknown as WebviewPanelLike
    },
    async resolveAssets(
      _webview: WebviewLike
    ): Promise<{ scriptUri: vscode.Uri; styleUris: vscode.Uri[] }> {
      return { scriptUri: Uri.file('/assets/entry-1.js') as unknown as vscode.Uri, styleUris: [] }
    },
    log(): void {
      /* 静默 */
    },
  }
  return { deps, panels }
}

/** 取面板已 postMessage 的消息中指定 type 的最后一条。 */
export function lastPosted(panel: FakePanel, type: string): Record<string, unknown> | undefined {
  const found = panel.posted
    .filter((message) => (message as { type?: string })?.type === type)
    .at(-1) as Record<string, unknown> | undefined
  return found
}
