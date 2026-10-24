import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type * as vscode from 'vscode'
import { createExtensionContextStub, __resetStubs, __stubs, Uri } from '../stubs/vscode'
import {
  WebviewController,
  webviewViewType,
  type WebviewLike,
  type WebviewPanelLike,
} from '../../../webview/host/webviewController'

/**
 * WebviewController（05 T2.4）：
 * 守卫过滤 / submit 在途幂等与超时 / dirty 确认 / 幂等 dispose / 单例 reveal。
 */

interface FakePanel {
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

function createFakePanel(viewType: string, title: string): FakePanel {
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

function makeDeps() {
  const panels: FakePanel[] = []
  const logs: string[] = []
  const deps = {
    createPanel(viewType: string, title: string): WebviewPanelLike {
      const panel = createFakePanel(viewType, title)
      panels.push(panel)
      return panel as unknown as WebviewPanelLike
    },
    async resolveAssets(
      _webview: WebviewLike
    ): Promise<{ scriptUri: vscode.Uri; styleUris: vscode.Uri[] }> {
      return {
        scriptUri: stubUri('/assets/gallery-1.js'),
        styleUris: [stubUri('/assets/tokens-2.css')],
      }
    },
    log(message: string): void {
      logs.push(message)
    },
  }
  return { deps, panels, logs }
}

/** 运行时 'vscode' 经 vitest alias 指向测试桩；类型层用 unknown 断言桥接桩与 @types/vscode。 */
const context = createExtensionContextStub() as unknown as vscode.ExtensionContext
const stubUri = (path: string) => Uri.file(path) as unknown as vscode.Uri

beforeEach(() => {
  __resetStubs()
  WebviewController.__resetForTest()
})

afterEach(() => {
  WebviewController.__resetForTest()
})

describe('createOrShow / 单例', () => {
  it('创建面板并写入 HTML 外壳（data-page / 脚本 / 样式 / CSP）', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    expect(panels).toHaveLength(1)
    expect(panels[0].viewType).toBe(webviewViewType('gallery'))
    expect(panels[0].title).toBe('组件画廊（开发）')
    const html = panels[0].webview.html
    expect(html).toContain('data-page="gallery"')
    expect(html).toContain('gallery-1.js')
    expect(html).toContain('tokens-2.css')
    expect(html).toContain('script-src')
  })

  it('已存在则 reveal，不重复创建', async () => {
    const { deps, panels } = makeDeps()
    const first = WebviewController.createOrShow('gallery', context, deps)
    await first.ready
    const second = WebviewController.createOrShow('gallery', context, deps)
    expect(second).toBe(first)
    expect(panels).toHaveLength(1)
    expect(panels[0].revealCalls).toBe(1)
  })

  it('未注册的 pageId 抛清晰错误', () => {
    expect(() => new WebviewController('nope', context, {})).toThrow(/未注册的 Webview 页面 id/)
  })

  it('资源解析失败时写入诊断 HTML 并记日志（不抛出）', async () => {
    const { deps, panels, logs } = makeDeps()
    deps.resolveAssets = async (): Promise<{ scriptUri: vscode.Uri; styleUris: vscode.Uri[] }> => {
      throw new Error('manifest 缺失')
    }
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    expect(panels[0].webview.html).toContain('页面资源加载失败')
    expect(logs.some((line) => line.includes('manifest 缺失'))).toBe(true)
  })
})

describe('消息分发（protocol 守卫）', () => {
  it('伪造消息（null / 空对象 / 未知 type）不抛错、不产生回复', async () => {
    const { deps, panels, logs } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    panels[0].posted.length = 0
    for (const junk of [
      null,
      undefined,
      {},
      { type: 'hack' },
      { type: 'dirty', dirty: 'yes' },
      42,
    ]) {
      panels[0].webview.__emit(junk)
    }
    expect(panels[0].posted).toHaveLength(0)
    expect(logs.some((line) => line.includes('忽略无法识别'))).toBe(true)
    expect(controller.isDirty).toBe(false)
  })

  it('ready → 回 init（page / 空 schema / null value）', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    panels[0].posted.length = 0
    panels[0].webview.__emit({ type: 'ready' })
    expect(panels[0].posted).toEqual([{ type: 'init', page: 'gallery', schema: [], value: null }])
  })

  it('恢复面板时持久化状态随 init.extra.persisted 传回（草稿恢复入口）', async () => {
    const { deps } = makeDeps()
    const controller = new WebviewController('gallery', context, deps)
    const panel = createFakePanel(webviewViewType('gallery'), '组件画廊（开发）')
    await controller.attachPanel(panel as unknown as WebviewPanelLike, { draft: { name: '任务A' } })
    panel.webview.__emit({ type: 'ready' })
    expect(panel.posted).toEqual([
      {
        type: 'init',
        page: 'gallery',
        schema: [],
        value: null,
        extra: { persisted: { draft: { name: '任务A' } } },
      },
    ])
  })

  it('dirty 上报更新 isDirty', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    expect(controller.isDirty).toBe(true)
    panels[0].webview.__emit({ type: 'dirty', dirty: false })
    expect(controller.isDirty).toBe(false)
  })
})

describe('dirty 确认（switchTarget）', () => {
  it('非 dirty 直接放行（不弹窗）', async () => {
    const { deps } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    await expect(controller.confirmSwitchTarget()).resolves.toBe(true)
    expect(__stubs.recorded.filter((r) => r.kind === 'showWarningMessage')).toHaveLength(0)
  })

  it('dirty 时模态确认：确认丢弃 → true 并清 dirty', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    __stubs.dialogQueue.push('放弃修改并继续')
    await expect(controller.confirmSwitchTarget()).resolves.toBe(true)
    const warning = __stubs.recorded.find((r) => r.kind === 'showWarningMessage')
    expect(warning).toBeDefined()
    // 模态 + 中文确认项
    const payload = warning?.args[0] as { message: string; items: unknown[] }
    expect(payload.items.some((item) => (item as { modal?: boolean }).modal === true)).toBe(true)
    expect(controller.isDirty).toBe(false)
  })

  it('dirty 时模态确认：用户取消 → false 且 dirty 保留', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    __stubs.dialogQueue.push(undefined)
    await expect(controller.confirmSwitchTarget()).resolves.toBe(false)
    expect(controller.isDirty).toBe(true)
  })
})

describe('cancel 路径 dirty 确认（U-1：Esc / 点取消）', () => {
  it('dirty=false 时 cancel 直接触发 onCancel，不弹确认', async () => {
    const { deps, panels } = makeDeps()
    const onCancel = vi.fn()
    const controller = WebviewController.createOrShow('gallery', context, { ...deps, onCancel })
    await controller.ready
    panels[0].webview.__emit({ type: 'cancel' })
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    expect(__stubs.recorded.filter((r) => r.kind === 'showWarningMessage')).toHaveLength(0)
    expect(controller.isDirty).toBe(false)
  })

  it('dirty=true 时弹模态确认，选「放弃修改并关闭」→ onCancel 触发', async () => {
    const { deps, panels } = makeDeps()
    const onCancel = vi.fn()
    const controller = WebviewController.createOrShow('gallery', context, { ...deps, onCancel })
    await controller.ready
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    __stubs.dialogQueue.push('放弃修改并关闭')
    panels[0].webview.__emit({ type: 'cancel' })
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    const warning = __stubs.recorded.find((r) => r.kind === 'showWarningMessage')
    expect(warning).toBeDefined()
    const payload = warning?.args[0] as { message: string; items: unknown[] }
    expect(payload.message).toContain('未保存的修改')
    // 模态 + 中文确认项
    expect(payload.items.some((item) => (item as { modal?: boolean }).modal === true)).toBe(true)
    expect(controller.isDirty).toBe(false)
  })

  it('dirty=true 时关闭确认弹窗（undefined）→ onCancel 不触发、面板保持打开', async () => {
    const { deps, panels } = makeDeps()
    const onCancel = vi.fn()
    const controller = WebviewController.createOrShow('gallery', context, { ...deps, onCancel })
    await controller.ready
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    __stubs.dialogQueue.push(undefined)
    panels[0].webview.__emit({ type: 'cancel' })
    // 排空微任务：等待 handleCancel 的模态确认流程走完（弹窗应答 undefined → 直接 return）
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onCancel).not.toHaveBeenCalled()
    expect(panels[0].disposeCalls).toBe(0)
    expect(controller.isDirty).toBe(true)
  })
})

describe('R-U-9 协议健壮性（cancel 重入 / init 同步抛错）', () => {
  it('连点 cancel（dirty 确认在途）只弹一次模态、onCancel 只触发一次', async () => {
    const { deps, panels } = makeDeps()
    const onCancel = vi.fn()
    const controller = WebviewController.createOrShow('gallery', context, { ...deps, onCancel })
    await controller.ready
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    __stubs.dialogQueue.push('放弃修改并关闭')
    panels[0].webview.__emit({ type: 'cancel' })
    panels[0].webview.__emit({ type: 'cancel' }) // 确认在途期间的第二次触发（连点 / 连按 Esc）
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(__stubs.recorded.filter((entry) => entry.kind === 'showWarningMessage')).toHaveLength(1)
    controller.dispose()
  })

  it('同步 buildInit 抛错：下发 error 而非炸掉 onDidReceiveMessage 监听器', async () => {
    const { deps, panels, logs } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, {
      ...deps,
      buildInit: () => {
        throw new Error('schema 读取失败')
      },
    })
    await controller.ready
    panels[0].posted.length = 0
    expect(() => panels[0].webview.__emit({ type: 'ready' })).not.toThrow()
    await vi.waitFor(() => {
      expect(panels[0].posted).toEqual([
        { type: 'error', message: '页面初始化失败：schema 读取失败' },
      ])
    })
    expect(logs.some((line) => line.includes('init 载荷构造失败'))).toBe(true)
    // 监听器仍然存活：后续消息照常处理（同步抛错不再是「炸掉整个面板消息通道」）
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    expect(controller.isDirty).toBe(true)
    controller.dispose()
  })
})

describe('submit 幂等与超时', () => {
  it('成功回 submitAck；失败回 error', async () => {
    const { deps, panels } = makeDeps()
    const onSubmit = vi.fn(async (draft: Record<string, unknown>) => {
      if (draft['boom'] === 1) {
        throw new Error('名称不能为空')
      }
    })
    const controller = WebviewController.createOrShow('gallery', context, { ...deps, onSubmit })
    await controller.ready

    panels[0].webview.__emit({ type: 'submit', draft: { name: '任务A' } })
    await vi.waitFor(() => {
      expect(panels[0].posted).toEqual([{ type: 'submitAck', ok: true }])
    })

    panels[0].posted.length = 0
    panels[0].webview.__emit({ type: 'submit', draft: { boom: 1 } })
    await vi.waitFor(() => {
      expect(panels[0].posted).toEqual([{ type: 'error', message: '名称不能为空' }])
    })
  })

  it('在途时忽略重复提交（onSubmit 只被调用一次）', async () => {
    vi.useFakeTimers()
    try {
      const { deps, panels } = makeDeps()
      const onSubmit = vi.fn(() => new Promise<void>(() => undefined))
      const controller = WebviewController.createOrShow('gallery', context, { ...deps, onSubmit })
      await controller.ready

      panels[0].webview.__emit({ type: 'submit', draft: {} })
      await vi.advanceTimersByTimeAsync(100)
      panels[0].webview.__emit({ type: 'submit', draft: {} })
      await vi.advanceTimersByTimeAsync(100)
      expect(onSubmit).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R-C-10 提交超时：不抢发 error、不永久锁死；任务随后成功时如实下发 submitAck', async () => {
    vi.useFakeTimers()
    try {
      const { deps, panels } = makeDeps()
      let settle: (() => void) | undefined
      const onSubmit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve
          })
      )
      const controller = WebviewController.createOrShow('gallery', context, { ...deps, onSubmit })
      await controller.ready

      panels[0].webview.__emit({ type: 'submit', draft: {} })
      await vi.advanceTimersByTimeAsync(100)
      panels[0].posted.length = 0

      // 10s 超时：不抢发 error（避免「超时」与「已保存」并存误导用户）
      await vi.advanceTimersByTimeAsync(10_000)
      expect(panels[0].posted).toEqual([])

      // 但也不永久锁死提交：超时即解锁，用户可重试
      panels[0].webview.__emit({ type: 'submit', draft: {} })
      await vi.advanceTimersByTimeAsync(100)
      expect(onSubmit).toHaveBeenCalledTimes(2)

      // 迟到的成功如实下发 submitAck（面板据此关闭并提示成功，而非无响应）
      settle!()
      await vi.advanceTimersByTimeAsync(100)
      expect(panels[0].posted).toEqual([{ type: 'submitAck', ok: true }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('未配置 onSubmit 时回明确 error', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    panels[0].webview.__emit({ type: 'submit', draft: {} })
    await vi.waitFor(() => {
      expect(panels[0].posted).toEqual([
        { type: 'error', message: expect.stringContaining('未配置提交处理') },
      ])
    })
  })
})

describe('dispose 幂等', () => {
  it('编程式 dispose 只关一次面板，重复调用无副作用', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    controller.dispose()
    controller.dispose()
    expect(panels[0].disposeCalls).toBe(1)
    expect(WebviewController.get('gallery')).toBeUndefined()
  })

  it('用户关闭面板：只清理资源，不反向调用 panel.dispose', async () => {
    const { deps, panels } = makeDeps()
    const controller = WebviewController.createOrShow('gallery', context, deps)
    await controller.ready
    panels[0].__close()
    expect(panels[0].disposeCalls).toBe(0)
    expect(WebviewController.get('gallery')).toBeUndefined()
    expect(controller.isDirty).toBe(false)

    // 关闭后再次 createOrShow 创建新面板
    const again = WebviewController.createOrShow('gallery', context, deps)
    await again.ready
    expect(panels).toHaveLength(2)
  })
})
