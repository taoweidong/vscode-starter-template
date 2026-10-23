import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import type { Item } from '../../models/item'
import {
  JsonFileStore,
  StoreCorruptedError,
  type StoreCorruptedInfo,
} from '../../services/stores/jsonFileStore'
import { MementoStore } from '../../services/stores/mementoStore'
import { FileSystemError as StubFileSystemError, __stubs, createMementoStub } from './stubs/vscode'

/** 构造完整条目（避开 normalize 补默认值的干扰）。 */
function fullItem(id: string, name: string): Item {
  return {
    id,
    name,
    category: '测试',
    description: '',
    priority: 'medium',
    tags: ['t'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** T1.2 / T1.3（P0-01 / P0-02 / P1-04）：原子写 + 损坏恢复 + v2 信封 + 加载校验。 */
describe('JsonFileStore', () => {
  let dir: string
  let fileUri: vscode.Uri

  beforeEach(() => {
    dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-json-store-'))
    fileUri = vscode.Uri.file(nodePath.join(dir, 'items.json'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    nodeFs.rmSync(dir, { recursive: true, force: true })
  })

  const writeRaw = (content: string): void => {
    nodeFs.mkdirSync(nodePath.dirname(fileUri.fsPath), { recursive: true })
    nodeFs.writeFileSync(fileUri.fsPath, content, 'utf8')
  }

  const readRaw = (): string => nodeFs.readFileSync(fileUri.fsPath, 'utf8')

  const listDir = (): string[] => nodeFs.readdirSync(dir)

  // ---------------- 基础读写与信封格式 ----------------

  it('文件不存在返回空数组', async () => {
    const store = new JsonFileStore(fileUri)
    expect(await store.load()).toEqual([])
  })

  it('save 写出 v2 信封 {schemaVersion:2, items}，save→load 往返一致', async () => {
    const store = new JsonFileStore(fileUri)
    const items = [fullItem('1', '甲'), fullItem('2', '乙')]
    await store.save(items)
    const envelope = JSON.parse(readRaw()) as { schemaVersion: number; items: Item[] }
    expect(envelope.schemaVersion).toBe(2)
    expect(envelope.items).toEqual(items)
    expect(await store.load()).toEqual(items)
  })

  it('save 成功后目录中不残留临时文件', async () => {
    const store = new JsonFileStore(fileUri)
    await store.save([fullItem('1', '甲')])
    expect(listDir().filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('目录不存在时 save 自动创建目录', async () => {
    const nested = vscode.Uri.file(nodePath.join(dir, 'a', 'b', 'items.json'))
    const store = new JsonFileStore(nested)
    await store.save([fullItem('1', '甲')])
    expect(nodeFs.existsSync(nested.fsPath)).toBe(true)
  })

  // ---------------- 兼容旧格式 / BOM / 坏条目 ----------------

  it('v1 顶层数组自动迁移并可读，onWarning 提示迁移', async () => {
    const warnings: string[] = []
    writeRaw(JSON.stringify([{ name: '旧格式条目' }]))
    const store = new JsonFileStore(fileUri, { onWarning: (m) => warnings.push(m) })
    const items = await store.load()
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('旧格式条目')
    expect(items[0].priority).toBe('medium') // normalize 补默认
    expect(warnings.some((w) => w.includes('迁移') || w.includes('旧版'))).toBe(true)
  })

  it('无 schemaVersion 的 {items:[...]} 对象同样可读', async () => {
    writeRaw(JSON.stringify({ items: [fullItem('1', '甲')] }))
    const store = new JsonFileStore(fileUri)
    expect(await store.load()).toEqual([fullItem('1', '甲')])
  })

  it('BOM 前缀被剥离后正常解析', async () => {
    writeRaw(`\uFEFF${JSON.stringify([fullItem('1', '甲')])}`)
    const store = new JsonFileStore(fileUri)
    expect(await store.load()).toEqual([fullItem('1', '甲')])
  })

  it('坏条目跳过并经 onWarning 上报，不进结果集；重复 id 保留首个', async () => {
    const warnings: string[] = []
    writeRaw(JSON.stringify([fullItem('1', '甲'), null, fullItem('1', '重复id'), { name: 42 }]))
    const store = new JsonFileStore(fileUri, { onWarning: (m) => warnings.push(m) })
    const items = await store.load()
    expect(items.map((i) => i.name)).toEqual(['甲'])
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  // ---------------- 损坏恢复（P0-01：原文件必须留在原地） ----------------

  it('解析失败：复制 .bak 备份、原文件保留原位、continue-empty 返回空数组', async () => {
    writeRaw('{corrupt')
    const store = new JsonFileStore(fileUri, { onCorrupted: async () => 'continue-empty' })
    expect(await store.load()).toEqual([])
    expect(readRaw()).toBe('{corrupt') // 原文件未被动过
    const backup = listDir().find(
      (name) => name.startsWith('items.json.corrupt-') && name.endsWith('.bak')
    )
    expect(backup).toBeTruthy()
    expect(nodeFs.readFileSync(nodePath.join(dir, backup!), 'utf8')).toBe('{corrupt')
  })

  it('合法但非数组的 JSON（如误指向 settings.json）同样走损坏流程', async () => {
    writeRaw('{"editor.fontSize": 14}')
    const infos: StoreCorruptedInfo[] = []
    const store = new JsonFileStore(fileUri, {
      onCorrupted: async (info) => {
        infos.push(info)
        return 'continue-empty'
      },
    })
    expect(await store.load()).toEqual([])
    expect(readRaw()).toBe('{"editor.fontSize": 14}')
    expect(listDir().some((name) => name.endsWith('.bak'))).toBe(true)
    expect(infos[0].originalUri.fsPath).toBe(fileUri.fsPath)
    expect(infos[0].backupUri.fsPath.endsWith('.bak')).toBe(true)
    expect(infos[0].reason).toBeTruthy()
  })

  it('未注入 onCorrupted：抛 StoreCorruptedError（含 originalUri/backupUri），原文件与备份都在', async () => {
    writeRaw('not json at all')
    const store = new JsonFileStore(fileUri)
    const err = await store.load().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StoreCorruptedError)
    expect((err as StoreCorruptedError).info.originalUri.fsPath).toBe(fileUri.fsPath)
    expect((err as StoreCorruptedError).info.backupUri.fsPath.endsWith('.bak')).toBe(true)
    expect(readRaw()).toBe('not json at all')
    expect(listDir().some((name) => name.endsWith('.bak'))).toBe(true)
  })

  it('open-file：打开原文件（showTextDocument）后仍抛 StoreCorruptedError（不得静默当空数据）', async () => {
    writeRaw('][')
    const store = new JsonFileStore(fileUri, { onCorrupted: async () => 'open-file' })
    await expect(store.load()).rejects.toBeInstanceOf(StoreCorruptedError)
    expect(__stubs.recorded.some((entry) => entry.kind === 'showTextDocument')).toBe(true)
  })

  it('abort：直接抛 StoreCorruptedError', async () => {
    writeRaw('][')
    const store = new JsonFileStore(fileUri, { onCorrupted: async () => 'abort' })
    await expect(store.load()).rejects.toBeInstanceOf(StoreCorruptedError)
    expect(readRaw()).toBe('][')
  })

  it('备份 copy 失败必须抛错（禁止静默返回空数组）', async () => {
    writeRaw('{corrupt')
    const copySpy = vi
      .spyOn(vscode.workspace.fs, 'copy')
      .mockRejectedValue(new StubFileSystemError('disk error', 'Unknown'))
    const store = new JsonFileStore(fileUri, { onCorrupted: async () => 'continue-empty' })
    await expect(store.load()).rejects.toThrow()
    copySpy.mockRestore()
    expect(readRaw()).toBe('{corrupt')
  })

  it('IO 错误（NoPermissions）不视为损坏：直接抛出且不产生备份', async () => {
    writeRaw('[]')
    const readSpy = vi
      .spyOn(vscode.workspace.fs, 'readFile')
      .mockRejectedValue(new StubFileSystemError(fileUri.fsPath, 'NoPermissions'))
    const store = new JsonFileStore(fileUri, { onCorrupted: async () => 'continue-empty' })
    await expect(store.load()).rejects.toMatchObject({ code: 'NoPermissions' })
    readSpy.mockRestore()
    expect(listDir().some((name) => name.endsWith('.bak'))).toBe(false)
  })

  // ---------------- 原子写（P0-02） ----------------

  it('rename 失败：save 抛错、原文件内容不变、临时文件被清理', async () => {
    writeRaw(JSON.stringify({ schemaVersion: 2, items: [fullItem('old', '旧')] }))
    const before = readRaw()
    const renameSpy = vi
      .spyOn(vscode.workspace.fs, 'rename')
      .mockRejectedValue(new Error('rename blocked'))
    const store = new JsonFileStore(fileUri)
    await expect(store.save([fullItem('new', '新')])).rejects.toThrow('rename blocked')
    renameSpy.mockRestore()
    expect(readRaw()).toBe(before)
    expect(listDir().filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('临时文件读回校验失败：save 抛错、原文件不变、临时文件被清理', async () => {
    writeRaw(JSON.stringify({ schemaVersion: 2, items: [fullItem('old', '旧')] }))
    const before = readRaw()
    const originalRead = vscode.workspace.fs.readFile
    const readSpy = vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri) => {
      // 只篡改对临时文件的读回校验，其他读取保持原样
      if (uri.fsPath.includes('.tmp-')) {
        return new Uint8Array(Buffer.from('garbage'))
      }
      return originalRead(uri)
    })
    const store = new JsonFileStore(fileUri)
    await expect(store.save([fullItem('new', '新')])).rejects.toThrow()
    readSpy.mockRestore()
    expect(readRaw()).toBe(before)
    expect(listDir().filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('写临时文件失败：save 抛错且原文件不变', async () => {
    writeRaw(JSON.stringify({ schemaVersion: 2, items: [fullItem('old', '旧')] }))
    const before = readRaw()
    const writeSpy = vi
      .spyOn(vscode.workspace.fs, 'writeFile')
      .mockRejectedValue(new Error('disk full'))
    const store = new JsonFileStore(fileUri)
    await expect(store.save([fullItem('new', '新')])).rejects.toThrow('disk full')
    writeSpy.mockRestore()
    expect(readRaw()).toBe(before)
  })
})

/** T1.3：MementoStore 同样走 normalize。 */
describe('MementoStore normalize', () => {
  it('load 时逐条 normalize：坏条目跳过、缺失补默认', async () => {
    const warnings: string[] = []
    const raw: unknown[] = [fullItem('1', '完整'), { name: '缺字段' }, 'garbage']
    const backing = createMementoStub({ k: raw })
    const store = new MementoStore(backing as unknown as vscode.Memento, 'k', {
      onWarning: (message) => warnings.push(message),
    })
    const items = await store.load()
    expect(items).toHaveLength(2)
    expect(items[1].priority).toBe('medium')
    expect(items[1].tags).toEqual([])
    expect(items[1].id).toBeTruthy()
    expect(warnings.some((w) => w.includes('3'))).toBe(true) // 坏条目上报带序号
  })

  it('存量值非数组时按空数据处理', async () => {
    const backing = createMementoStub({ k: { nope: true } })
    const store = new MementoStore(backing as unknown as vscode.Memento, 'k')
    expect(await store.load()).toEqual([])
  })

  it('save→load 往返一致', async () => {
    const backing = createMementoStub()
    const store = new MementoStore(backing as unknown as vscode.Memento, 'k')
    await store.save([fullItem('1', '甲')])
    expect(await store.load()).toEqual([fullItem('1', '甲')])
  })
})
