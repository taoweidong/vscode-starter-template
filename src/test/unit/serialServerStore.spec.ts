import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import type { SerialServer } from '../../features/serialConsole/models'
import {
  JsonServerStore,
  MementoServerStore,
  SERVERS_SCHEMA_VERSION,
  createServerStore,
} from '../../features/serialConsole/serverStore'
import { __resetStubs, __stubs, createMementoStub } from './stubs/vscode'

/** 构造完整服务器条目（避开 normalize 补默认值的干扰）。 */
function fullServer(id: string, name: string, serialPath = 'COM3'): SerialServer {
  return {
    id,
    name,
    serialPath,
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
    lineEnding: 'lf',
    autoLogin: false,
    username: '',
    description: '',
    createdAt: 1_000,
    updatedAt: 1_000,
  }
}

describe('串口服务器存储', () => {
  let dir: string
  let fileUri: vscode.Uri

  beforeEach(() => {
    dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'serial-server-store-'))
    fileUri = vscode.Uri.file(nodePath.join(dir, 'serial-servers.json'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    nodeFs.rmSync(dir, { recursive: true, force: true })
    __resetStubs()
  })

  const writeRaw = (content: string): void => {
    nodeFs.mkdirSync(nodePath.dirname(fileUri.fsPath), { recursive: true })
    nodeFs.writeFileSync(fileUri.fsPath, content, 'utf8')
  }

  const readRaw = (): string => nodeFs.readFileSync(fileUri.fsPath, 'utf8')

  // ---------------- JsonServerStore 基础读写 ----------------

  it('文件不存在返回空数组', async () => {
    const store = new JsonServerStore(fileUri)
    expect(await store.load()).toEqual([])
  })

  it('save 写出 v1 信封 {schemaVersion:1, servers}，save→load 往返一致', async () => {
    const store = new JsonServerStore(fileUri)
    const servers = [fullServer('1', '服务器甲'), fullServer('2', '服务器乙', 'COM4')]
    await store.save(servers)
    const envelope = JSON.parse(readRaw()) as { schemaVersion: number; servers: SerialServer[] }
    expect(envelope.schemaVersion).toBe(SERVERS_SCHEMA_VERSION)
    expect(envelope.servers).toEqual(servers)
    expect(await store.load()).toEqual(servers)
  })

  it('save 成功后目录中不残留临时文件', async () => {
    const store = new JsonServerStore(fileUri)
    await store.save([fullServer('1', '甲')])
    expect(nodeFs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  // ---------------- 加载守卫（镜像 itemGuard 契约） ----------------

  it('坏条目跳过并经 onWarning 上报；缺失参数补默认值；重复 id 保留首个', async () => {
    const warnings: string[] = []
    writeRaw(
      JSON.stringify({
        schemaVersion: 1,
        servers: [
          fullServer('1', '甲'),
          null,
          { id: '2', name: 42, serialPath: 'COM3' },
          { id: '3', name: '缺串口' },
          { id: '1', name: '重复id' },
        ],
      })
    )
    const store = new JsonServerStore(fileUri, { onWarning: (m) => warnings.push(m) })
    const servers = await store.load()
    expect(servers.map((s) => s.id)).toEqual(['1'])
    expect(warnings.length).toBeGreaterThanOrEqual(3)
  })

  it('BOM 前缀被剥离后正常解析', async () => {
    writeRaw(`\uFEFF${JSON.stringify({ schemaVersion: 1, servers: [fullServer('1', '甲')] })}`)
    const store = new JsonServerStore(fileUri)
    expect(await store.load()).toEqual([fullServer('1', '甲')])
  })

  it('顶层数组宽容读取并提示', async () => {
    const warnings: string[] = []
    writeRaw(JSON.stringify([fullServer('1', '甲')]))
    const store = new JsonServerStore(fileUri, { onWarning: (m) => warnings.push(m) })
    expect(await store.load()).toEqual([fullServer('1', '甲')])
    expect(warnings.some((w) => w.includes('数组'))).toBe(true)
  })

  // ---------------- 损坏处理：备份后按空数据继续 ----------------

  it('解析失败：复制 .bak 备份、onWarning 上报、返回空数组', async () => {
    const warnings: string[] = []
    writeRaw('{not valid json')
    const store = new JsonServerStore(fileUri, { onWarning: (m) => warnings.push(m) })
    expect(await store.load()).toEqual([])
    const backups = nodeFs.readdirSync(dir).filter((name) => name.includes('.corrupt-'))
    expect(backups.length).toBe(1)
    expect(nodeFs.readFileSync(nodePath.join(dir, backups[0]), 'utf8')).toBe('{not valid json')
    expect(warnings.some((w) => w.includes('损坏'))).toBe(true)
  })

  it('根节点形态不对：同样备份后按空数据继续', async () => {
    writeRaw('{"foo":1}')
    const store = new JsonServerStore(fileUri)
    expect(await store.load()).toEqual([])
    expect(nodeFs.readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toHaveLength(1)
  })

  it('损坏且备份失败：抛错（不做任何静默覆盖）', async () => {
    writeRaw('{bad')
    vi.spyOn(vscode.workspace.fs, 'copy').mockRejectedValue(new Error('cannot copy'))
    const store = new JsonServerStore(fileUri)
    await expect(store.load()).rejects.toThrow('备份失败')
  })

  // ---------------- MementoServerStore 与装配 ----------------

  it('MementoStore：非数组按空数据 + onWarning；save→load 往返一致', async () => {
    const memento = createMementoStub()
    memento.update('crudStarter.serialServers', 'not-an-array')
    const warnings: string[] = []
    const store = new MementoServerStore(memento, 'crudStarter.serialServers', {
      onWarning: (m) => warnings.push(m),
    })
    expect(await store.load()).toEqual([])
    expect(warnings.length).toBe(1)
    const servers = [fullServer('1', '甲')]
    await store.save(servers)
    expect(await store.load()).toEqual(servers)
  })

  it('createServerStore：有工作区 → JsonServerStore（.vscode/serial-servers.json）', async () => {
    __stubs.workspaceFolders = [{ uri: vscode.Uri.file(dir), name: 'root', index: 0 }]
    const context = { globalState: createMementoStub() } as unknown as vscode.ExtensionContext
    const store = createServerStore(context)
    expect(store).toBeInstanceOf(JsonServerStore)
    expect((store as JsonServerStore).fileUri.fsPath).toBe(
      nodePath.join(dir, '.vscode', 'serial-servers.json')
    )
  })

  it('createServerStore：无工作区 → MementoServerStore', () => {
    __stubs.workspaceFolders = undefined
    const context = { globalState: createMementoStub() } as unknown as vscode.ExtensionContext
    const store = createServerStore(context)
    expect(store).toBeInstanceOf(MementoServerStore)
  })
})
