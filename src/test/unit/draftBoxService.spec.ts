import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { STORAGE } from '../../extension/constants'
import { DraftBoxService } from '../../extension/features/drafts/draftBoxService'
import { __resetStubs } from './stubs/vscode'

/**
 * 草稿箱服务（09 方案 §3.5：右键示例新载体）：
 * - 落盘 .vscode/crud-starter.drafts.json（B3：路径与脏检查忽略清单同源）；
 * - 原子写经 writeJsonAtomic；损坏文件按空数据继续；
 * - 上限 100 条防无限增长；追加 / 文件 / 文件夹三种登记形态。
 */

let rootDir: string
let service: DraftBoxService

beforeEach(() => {
  __resetStubs()
  rootDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-drafts-'))
  service = new DraftBoxService(() => vscode.Uri.file(rootDir))
})

afterEach(() => {
  nodeFs.rmSync(rootDir, { recursive: true, force: true })
})

const draftsFile = (): string => nodePath.join(rootDir, STORAGE.draftsFileName)

describe('DraftBoxService：登记与持久化', () => {
  it('addSelection：标题取选中文本摘要，落盘可被 load 复原', async () => {
    const count = await service.addSelection('修复登录超时的问题', 'auth.ts')
    expect(count).toBe(1)
    const persisted = JSON.parse(nodeFs.readFileSync(draftsFile(), 'utf8')) as {
      schemaVersion: number
      entries: { kind: string; title: string; detail: string }[]
    }
    expect(persisted.schemaVersion).toBe(1)
    expect(persisted.entries[0]).toMatchObject({
      kind: 'selection',
      title: '修复登录超时的问题',
      detail: '来源：auth.ts',
    })
    const reloaded = new DraftBoxService(() => vscode.Uri.file(rootDir))
    expect(await reloaded.load()).toBe(1)
    expect(reloaded.list()[0]?.title).toBe('修复登录超时的问题')
  })

  it('长选中文本摘要截断为 40 字符 + 省略号', async () => {
    await service.addSelection('x'.repeat(100), 'a.ts')
    expect(service.list()[0]?.title).toBe(`${'x'.repeat(40)}…`)
  })

  it('appendToLatest：追加到最近一条的 detail；空箱时降级新增', async () => {
    await service.addSelection('第一条', 'a.ts')
    const appended = await service.appendToLatest('补充内容', 'b.ts')
    expect(appended).toBe(true)
    expect(service.list()[0]?.detail).toContain('补充内容')
    expect(service.list()[0]?.detail).toContain('来自：b.ts')

    const empty = new DraftBoxService(() => vscode.Uri.file(rootDir))
    expect(await empty.appendToLatest('孤本', 'c.ts')).toBe(false)
    expect(empty.list()).toHaveLength(1)
  })

  it('addFile：登记文件名与绝对路径；目录抛错', async () => {
    const file = nodePath.join(rootDir, 'demo.md')
    nodeFs.writeFileSync(file, '# demo', 'utf8')
    await service.addFile(vscode.Uri.file(file))
    expect(service.list()[0]).toMatchObject({ kind: 'file', title: 'demo.md', detail: file })
    await expect(service.addFile(vscode.Uri.file(rootDir))).rejects.toThrow('请选择文件而非文件夹')
  })

  it('addFolder：登记目录清单汇总（排序、限流）；空目录抛错；文件抛错', async () => {
    nodeFs.mkdirSync(nodePath.join(rootDir, 'docs'))
    nodeFs.writeFileSync(nodePath.join(rootDir, 'docs', 'b.md'), 'b', 'utf8')
    nodeFs.writeFileSync(nodePath.join(rootDir, 'docs', 'a.md'), 'a', 'utf8')
    await service.addFolder(vscode.Uri.file(nodePath.join(rootDir, 'docs')))
    expect(service.list()[0]).toMatchObject({
      kind: 'folder',
      title: 'docs',
      detail: 'a.md、b.md',
    })

    nodeFs.mkdirSync(nodePath.join(rootDir, 'empty'))
    await expect(
      service.addFolder(vscode.Uri.file(nodePath.join(rootDir, 'empty')))
    ).rejects.toThrow('没有文件')
    await expect(
      service.addFolder(vscode.Uri.file(nodePath.join(rootDir, 'docs', 'a.md')))
    ).rejects.toThrow('请选择文件夹')
  })

  it('上限 100 条：超出后丢最旧', async () => {
    for (let i = 0; i < 105; i++) {
      await service.addSelection(`草稿 ${i}`, 'a.ts')
    }
    expect(service.list()).toHaveLength(100)
    expect(service.list()[0]?.title).toBe('草稿 104')
    expect(service.list()[99]?.title).toBe('草稿 5')
  })
})

describe('DraftBoxService：容错', () => {
  it('未打开工作区：fileUri 为 undefined，load 返回 0', async () => {
    const noRoot = new DraftBoxService(() => undefined)
    expect(noRoot.fileUri).toBeUndefined()
    expect(await noRoot.load()).toBe(0)
  })

  it('数据文件损坏：按空数据继续、原文件不动', async () => {
    nodeFs.mkdirSync(nodePath.join(rootDir, '.vscode'), { recursive: true })
    nodeFs.writeFileSync(draftsFile(), '{broken json', 'utf8')
    const broken = new DraftBoxService(() => vscode.Uri.file(rootDir))
    expect(await broken.load()).toBe(0)
    expect(nodeFs.readFileSync(draftsFile(), 'utf8')).toBe('{broken json')
  })

  it('load 过滤非法条目（缺 id / title 的元素被丢弃）', async () => {
    nodeFs.mkdirSync(nodePath.join(rootDir, '.vscode'), { recursive: true })
    nodeFs.writeFileSync(
      draftsFile(),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          { id: 'ok', kind: 'file', title: 'ok.md', detail: '', createdAt: 1 },
          { kind: 'file', title: '缺 id', detail: '', createdAt: 2 },
          'not-an-object',
        ],
      }),
      'utf8'
    )
    const partial = new DraftBoxService(() => vscode.Uri.file(rootDir))
    expect(await partial.load()).toBe(1)
    expect(partial.list()[0]?.title).toBe('ok.md')
  })
})
