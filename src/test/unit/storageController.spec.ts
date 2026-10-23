import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import {
  __fireConfigurationChange,
  __fireWorkspaceFoldersChanged,
  __resetStubs,
  __setConfig,
  __stubs,
  createMementoStub,
} from './stubs/vscode'
import { JsonFileStore } from '../../services/stores/jsonFileStore'
import { MementoStore } from '../../services/stores/mementoStore'
import { StorageController } from '../../services/storageController'
import type { Item } from '../../models/item'

/** stub watcher 的最小面（含 __fire* 测试入口）。 */
interface StubWatcher {
  onDidChange(cb: () => unknown): unknown
  onDidCreate(cb: () => unknown): unknown
  onDidDelete(cb: () => unknown): unknown
  __fireChange(): void
  __fireCreate(): void
  __fireDelete(): void
  dispose(): void
}

function makeController(): StorageController {
  return new StorageController({
    globalState: createMementoStub(),
    onWarning: () => undefined,
    onCorrupted: async () => 'continue-empty',
  })
}

function draft(name: string): {
  name: string
  category: string
  description: string
  priority: 'medium'
  tags: never[]
} {
  return { name, category: '', description: '', priority: 'medium', tags: [] }
}

/** T1.5 / T1.6（P1-03 / P1-06）：存储生命周期与 watcher 加固。 */
describe('StorageController', () => {
  let rootDir: string
  let watcherCalls: { watcher: StubWatcher; disposed: boolean }[]
  let originalCreateWatcher: typeof vscode.workspace.createFileSystemWatcher

  beforeEach(() => {
    __resetStubs()
    rootDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-controller-'))
    __stubs.workspaceFolders = [{ uri: vscode.Uri.file(rootDir), name: 'root', index: 0 }]
    watcherCalls = []
    originalCreateWatcher = vscode.workspace.createFileSystemWatcher
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockImplementation(((glob: unknown) => {
      const watcher = originalCreateWatcher(glob as vscode.GlobPattern) as unknown as StubWatcher
      const entry = { watcher, disposed: false }
      watcherCalls.push(entry)
      return {
        ...watcher,
        dispose: () => {
          entry.disposed = true
          watcher.dispose()
        },
      } as unknown as StubWatcher
    }) as unknown as typeof vscode.workspace.createFileSystemWatcher)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    nodeFs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('有工作区：创建 JsonFileStore（默认路径）+ watcher；service 读写落到数据文件', async () => {
    const controller = makeController()
    expect(controller.currentStore).toBeInstanceOf(JsonFileStore)
    expect(watcherCalls).toHaveLength(1)
    await controller.service.create(draft('甲'))
    const dataFile = nodePath.join(rootDir, '.vscode', 'crud-starter-items.json')
    expect(nodeFs.existsSync(dataFile)).toBe(true)
    controller.dispose()
  })

  it('无工作区：退回 MementoStore，不创建 watcher', () => {
    __stubs.workspaceFolders = undefined
    const controller = makeController()
    expect(controller.currentStore).toBeInstanceOf(MementoStore)
    expect(watcherCalls).toHaveLength(0)
    controller.dispose()
  })

  it('非法 storagePath：回退默认路径并警告一次（同一非法值不重复提示）', () => {
    __setConfig('crudStarter', 'storagePath', '../escape.json')
    const controller = makeController()
    const warnings = __stubs.recorded.filter((entry) => entry.kind === 'showWarningMessage')
    expect(warnings).toHaveLength(1)
    expect(JSON.stringify(warnings[0].args)).toContain('escape')
    expect(controller.currentStore).toBeInstanceOf(JsonFileStore)
    if (controller.currentStore instanceof JsonFileStore) {
      expect(controller.currentStore.fileUri.fsPath).toBe(
        nodePath.join(rootDir, '.vscode', 'crud-starter-items.json')
      )
    }
    controller.dispose()
  })

  it('storagePath 配置变化：重建 store + watcher，旧 watcher dispose，数据读写切到新位置', async () => {
    const controller = makeController()
    await controller.service.create(draft('旧位置的条目'))
    __setConfig('crudStarter', 'storagePath', 'custom/data.json')
    __fireConfigurationChange('crudStarter.storagePath')
    expect(watcherCalls).toHaveLength(2)
    expect(watcherCalls[0].disposed).toBe(true)
    expect(watcherCalls[1].disposed).toBe(false)
    expect(controller.currentStore).toBeInstanceOf(JsonFileStore)
    if (controller.currentStore instanceof JsonFileStore) {
      expect(controller.currentStore.fileUri.fsPath).toBe(
        nodePath.join(rootDir, 'custom', 'data.json')
      )
    }
    // 缓存已切到新数据源：新写入落新文件，旧文件内容保持不变
    await controller.service.create(draft('新位置的条目'))
    expect(nodeFs.existsSync(nodePath.join(rootDir, 'custom', 'data.json'))).toBe(true)
    const oldEnvelope = JSON.parse(
      nodeFs.readFileSync(nodePath.join(rootDir, '.vscode', 'crud-starter-items.json'), 'utf8')
    ) as { items: Item[] }
    expect(oldEnvelope.items).toHaveLength(1)
    controller.dispose()
  })

  it('工作区变化（空窗口 → 打开文件夹）：从 Memento 重建为 JsonFileStore + watcher', async () => {
    __stubs.workspaceFolders = undefined
    const controller = makeController()
    expect(controller.currentStore).toBeInstanceOf(MementoStore)
    __stubs.workspaceFolders = [{ uri: vscode.Uri.file(rootDir), name: 'root', index: 0 }]
    __fireWorkspaceFoldersChanged()
    expect(controller.currentStore).toBeInstanceOf(JsonFileStore)
    expect(watcherCalls).toHaveLength(1)
    controller.dispose()
  })

  it('与存储无关的配置变化不触发重建', () => {
    const controller = makeController()
    __fireConfigurationChange('crudStarter.features.confirmDelete')
    expect(watcherCalls).toHaveLength(1)
    controller.dispose()
  })

  it('dispose：释放 watcher 并注销配置监听（此后配置变化不再重建）', () => {
    const controller = makeController()
    controller.dispose()
    expect(watcherCalls[0].disposed).toBe(true)
    __setConfig('crudStarter', 'storagePath', 'other.json')
    __fireConfigurationChange('crudStarter.storagePath')
    expect(watcherCalls).toHaveLength(1)
  })

  it('service 实例在重建前后保持不变（命令注册引用不失效）', () => {
    const controller = makeController()
    const before = controller.service
    __setConfig('crudStarter', 'storagePath', 'other.json')
    __fireConfigurationChange('crudStarter.storagePath')
    expect(controller.service).toBe(before)
    controller.dispose()
  })
})

/** T1.5（P1-03）：watcher 防抖、自身保存抑制与 delete 事件语义。 */
describe('StorageController watcher 加固', () => {
  let rootDir: string
  let watcher: StubWatcher
  let controller: StorageController
  let fires: number

  beforeEach(() => {
    vi.useFakeTimers()
    __resetStubs()
    rootDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-watcher-'))
    __stubs.workspaceFolders = [{ uri: vscode.Uri.file(rootDir), name: 'root', index: 0 }]
    let captured: StubWatcher | undefined
    const originalCreate = vscode.workspace.createFileSystemWatcher
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockImplementation(((glob: unknown) => {
      captured = originalCreate(glob as vscode.GlobPattern) as unknown as StubWatcher
      return captured
    }) as unknown as typeof vscode.workspace.createFileSystemWatcher)
    controller = makeController()
    watcher = captured!
    expect(watcher).toBeTruthy()
    fires = 0
    controller.service.onDidChangeItems(() => {
      fires += 1
    })
  })

  afterEach(() => {
    controller.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
    nodeFs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('保存后 500ms 内的变更事件被忽略（自身写入不触发 reload）', async () => {
    const before = fires
    await controller.service.create(draft('甲'))
    expect(fires).toBe(before + 1) // 持久化本身 fire 一次
    watcher.__fireChange() // 自身保存引起的文件事件
    await vi.advanceTimersByTimeAsync(300) // 防抖窗口到期
    expect(fires).toBe(before + 1) // 未触发 reload
  })

  it('保存 600ms 后的外部变更只 reload 一次（防抖合并 + 不再抑制）', async () => {
    await controller.service.create(draft('甲'))
    const before = fires
    // 外部修改：三个事件连发（保存后 600ms，抑制窗口已过）
    await vi.advanceTimersByTimeAsync(600)
    watcher.__fireChange()
    watcher.__fireChange()
    watcher.__fireCreate()
    await vi.advanceTimersByTimeAsync(300)
    expect(fires).toBe(before + 1) // 三次事件合并为一次 reload
    // reload 后重新读到外部写入的内容
    const dataFile = nodePath.join(rootDir, '.vscode', 'crud-starter-items.json')
    const envelope = JSON.parse(nodeFs.readFileSync(dataFile, 'utf8')) as { items: Item[] }
    envelope.items.push({
      id: 'external-1',
      name: '外部条目',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    nodeFs.writeFileSync(dataFile, JSON.stringify(envelope, null, 2), 'utf8')
    watcher.__fireChange()
    await vi.advanceTimersByTimeAsync(300)
    expect((await controller.service.list()).map((item) => item.name)).toContain('外部条目')
  })

  it('delete 事件：只静默失效缓存，不 fire 空列表', async () => {
    await controller.service.create(draft('甲'))
    const before = fires
    watcher.__fireDelete()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fires).toBe(before) // 不广播
  })

  it('外部修改触发 reload 时读取最新文件内容', async () => {
    const dataFile = nodePath.join(rootDir, '.vscode', 'crud-starter-items.json')
    nodeFs.mkdirSync(nodePath.dirname(dataFile), { recursive: true })
    nodeFs.writeFileSync(
      dataFile,
      JSON.stringify(
        {
          schemaVersion: 2,
          items: [
            {
              id: 'ext',
              name: '外部',
              category: '',
              description: '',
              priority: 'medium',
              tags: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    )
    watcher.__fireCreate()
    await vi.advanceTimersByTimeAsync(300)
    expect((await controller.service.list()).map((item) => item.name)).toEqual(['外部'])
  })
})
