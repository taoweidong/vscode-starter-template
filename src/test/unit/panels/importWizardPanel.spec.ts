import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { __resetStubs, __stubs, Uri } from '../stubs/vscode'
import { WebviewController } from '../../../webview/host/webviewController'
import type { Item, ItemDraft } from '../../../models/item'
import type { ItemService } from '../../../services/itemService'
import { ImportWizardPanel } from '../../../providers/importWizardPanel'
import { lastPosted, makePanelDeps } from './support/fakePanel'

/**
 * 批量导入向导宿主面板（M4-T4.4）：浏览选择 / 预览去重 / 分批 createMany + 进度 + 取消。
 * service 用满足签名面的 mock；文件系统走 stub 的真实 node fs（临时目录）。
 */

const context = {
  subscriptions: [],
  extensionUri: Uri.file(process.cwd()),
} as unknown as vscode.ExtensionContext

function makeService(existing: Item[] = []) {
  return {
    listAll: vi.fn(async () => existing),
    createMany: vi.fn(async (drafts: ItemDraft[]) =>
      drafts.map((draft, index) => ({
        id: `batch-${index}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...draft,
      }))
    ),
  } as unknown as ItemService
}

function makeItem(id: string, name: string): Item {
  return {
    id,
    name,
    category: '',
    description: '',
    priority: 'medium',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

let tempDir: string | undefined

beforeEach(() => {
  __resetStubs()
  WebviewController.__resetForTest()
  ImportWizardPanel.configure(context)
})

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('importWizardPanel：init 与浏览选择', () => {
  it('init 携带 presetFolder（资源管理器右键进入）', async () => {
    const { deps, panels } = makePanelDeps()
    ImportWizardPanel.createOrShow(makeService(), 'D:/docs', deps)
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'init')).toMatchObject({
        extra: { presetFolder: 'D:/docs' },
      })
    })
  })

  it('无预填时 init.extra 为空对象', async () => {
    const { deps, panels } = makePanelDeps()
    ImportWizardPanel.createOrShow(makeService(), undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'init')).toBeDefined()
    })
    // 空 extra 会被控制器省略（页面按 extra ?? {} 处理）
    expect(lastPosted(panels[0], 'init')!.extra).toBeUndefined()
  })

  it('browseFolder → showOpenDialog（仅文件夹）→ selectFolder 应答', async () => {
    const { deps, panels } = makePanelDeps()
    ImportWizardPanel.createOrShow(makeService(), undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    __stubs.dialogQueue.push([Uri.file('D:/picked')])
    panels[0].webview.__emit({ type: 'browseFolder' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'selectFolder')).toEqual({
        type: 'selectFolder',
        folder: Uri.file('D:/picked').fsPath,
      })
    })
    const dialog = __stubs.recorded.find((entry) => entry.kind === 'showOpenDialog')
    expect(dialog?.args[0]).toMatchObject({ canSelectFolders: true, canSelectFiles: false })
  })

  it('用户取消选择 → selectFolder.folder 为 null', async () => {
    const { deps, panels } = makePanelDeps()
    ImportWizardPanel.createOrShow(makeService(), undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    __stubs.dialogQueue.push(undefined)
    panels[0].webview.__emit({ type: 'browseFolder' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'selectFolder')).toEqual({ type: 'selectFolder', folder: null })
    })
  })
})

describe('importWizardPanel：预览扫描', () => {
  it('列出文件（不含子目录）、按名称去重标注 exists、上限 50', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crud-wizard-'))
    for (const name of ['a.md', 'b.ts', '已存在.md']) {
      fs.writeFileSync(path.join(tempDir, name), 'x')
    }
    fs.mkdirSync(path.join(tempDir, 'subdir'))

    const { deps, panels } = makePanelDeps()
    ImportWizardPanel.createOrShow(makeService([makeItem('id-1', '已存在.md')]), undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'requestPreview', folder: tempDir })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'importPreview')).toBeDefined()
    })
    const files = lastPosted(panels[0], 'importPreview')!.files as {
      name: string
      exists: boolean
    }[]
    expect(files.map((file) => file.name).sort()).toEqual(['a.md', 'b.ts', '已存在.md'])
    expect(files.find((file) => file.name === '已存在.md')!.exists).toBe(true)
    expect(files.filter((file) => !file.exists)).toHaveLength(2)
  })

  it('空文件夹 / 不存在的路径 → error 消息', async () => {
    const { deps, panels } = makePanelDeps()
    ImportWizardPanel.createOrShow(makeService(), undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'requestPreview', folder: 'Z:/definitely/not/here' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'error')).toMatchObject({
        message: expect.stringContaining('读取文件夹失败'),
      })
    })
  })
})

describe('importWizardPanel：执行导入（分批 + 进度 + 取消）', () => {
  function files(
    count: number,
    existsCount = 0
  ): { name: string; path: string; exists: boolean }[] {
    return Array.from({ length: count }, (_, index) => ({
      name: `file-${index}.md`,
      path: `D:/docs/file-${index}.md`,
      exists: index < existsCount,
    }))
  }

  it('每批 ≤20：25 个新文件 → createMany 两次（20 + 5），进度与结果正确', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    ImportWizardPanel.createOrShow(service, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'executeImport', files: files(25) })

    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'importDone')).toBeDefined()
    })
    expect(service.createMany).toHaveBeenCalledTimes(2)
    const calls = (service.createMany as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (args) => args[0] as ItemDraft[]
    )
    expect(calls[0]).toHaveLength(20)
    expect(calls[1]).toHaveLength(5)
    expect(calls[0][0]).toMatchObject({ category: '文件', tags: ['文件', '批量'] })

    const progress = lastPosted(panels[0], 'importProgress')
    expect(progress).toMatchObject({ done: 25, total: 25 })
    expect(lastPosted(panels[0], 'importDone')!.result).toMatchObject({
      created: 25,
      skipped: 0,
      failed: 0,
      cancelled: false,
    })
  })

  it('已存在文件按跳过统计（不进入 createMany）', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    ImportWizardPanel.createOrShow(service, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'executeImport', files: files(3, 2) })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'importDone')).toBeDefined()
    })
    expect(service.createMany).toHaveBeenCalledTimes(1)
    const calls = (service.createMany as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (args) => args[0] as ItemDraft[]
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(1) // 只有 1 个新文件
    expect(lastPosted(panels[0], 'importDone')!.result).toMatchObject({ created: 1, skipped: 2 })
  })

  it('批次失败计入 failed 并继续后续批次（best effort）', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    ;(service.createMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (drafts: ItemDraft[]) => {
        if (drafts.length === 20) {
          throw new Error('磁盘已满')
        }
        return drafts.map((draft, index) => ({
          id: `x-${index}`,
          createdAt: '',
          updatedAt: '',
          ...draft,
        }))
      }
    )
    ImportWizardPanel.createOrShow(service, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'executeImport', files: files(25) })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'importDone')).toBeDefined()
    })
    expect(service.createMany).toHaveBeenCalledTimes(2)
    const result = lastPosted(panels[0], 'importDone')!.result as {
      created: number
      failed: number
      failures: { name: string; reason: string }[]
    }
    expect(result.created).toBe(5)
    expect(result.failed).toBe(20)
    expect(result.failures[0]).toMatchObject({ reason: '磁盘已满' })
  })

  it('cancelImport：当前批次完成后停止，已完成部分保留', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    let releaseFirst!: () => void
    ;(service.createMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (drafts: ItemDraft[]) => {
        const isFirst =
          (service.createMany as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1
        if (isFirst) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        return drafts.map((draft, index) => ({
          id: `x-${index}`,
          createdAt: '',
          updatedAt: '',
          ...draft,
        }))
      }
    )
    ImportWizardPanel.createOrShow(service, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'executeImport', files: files(25) })

    // 第一批在途时请求取消 → 第一批完成后停止
    await vi.waitFor(() => {
      expect(service.createMany).toHaveBeenCalledTimes(1)
    })
    panels[0].webview.__emit({ type: 'cancelImport' })
    releaseFirst()
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'importDone')).toBeDefined()
    })
    expect(service.createMany).toHaveBeenCalledTimes(1)
    expect(lastPosted(panels[0], 'importDone')!.result).toMatchObject({
      created: 20,
      cancelled: true,
    })
  })

  it('cancel（页面完成按钮）→ 面板关闭', async () => {
    const { deps, panels } = makePanelDeps()
    ImportWizardPanel.createOrShow(makeService(), undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'cancel' })
    expect(panels[0].disposeCalls).toBe(1)
  })
})
