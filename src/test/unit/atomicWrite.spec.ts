import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { writeJsonAtomic } from '../../extension/services/stores/atomicWrite'

/** 原子写工具（从 JsonFileStore 抽取，可靠性契约不变：M1 / NFR-01）。 */
describe('writeJsonAtomic', () => {
  let dir: string
  let fileUri: vscode.Uri

  beforeEach(() => {
    dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'atomic-write-'))
    fileUri = vscode.Uri.file(nodePath.join(dir, 'data.json'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    nodeFs.rmSync(dir, { recursive: true, force: true })
  })

  it('写出 2 空格缩进 + 换行结尾的 JSON', async () => {
    await writeJsonAtomic(fileUri, { schemaVersion: 1, items: [{ a: 1 }] })
    expect(nodeFs.readFileSync(fileUri.fsPath, 'utf8')).toBe(
      `${JSON.stringify({ schemaVersion: 1, items: [{ a: 1 }] }, null, 2)}\n`
    )
  })

  it('覆盖已有文件且不残留临时文件', async () => {
    nodeFs.writeFileSync(fileUri.fsPath, '{"old":true}\n', 'utf8')
    await writeJsonAtomic(fileUri, { next: true })
    expect(JSON.parse(nodeFs.readFileSync(fileUri.fsPath, 'utf8'))).toEqual({ next: true })
    expect(nodeFs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('目录不存在时自动创建', async () => {
    const nested = vscode.Uri.file(nodePath.join(dir, 'a', 'b', 'data.json'))
    await writeJsonAtomic(nested, { ok: 1 })
    expect(nodeFs.existsSync(nested.fsPath)).toBe(true)
  })

  it('读回校验失败（写入内容与预期不一致）：抛错、原文件不变、临时文件清理', async () => {
    nodeFs.writeFileSync(fileUri.fsPath, 'original', 'utf8')
    const realWrite = vscode.workspace.fs.writeFile.bind(vscode.workspace.fs)
    vi.spyOn(vscode.workspace.fs, 'writeFile').mockImplementation(async (uri, _content) => {
      // 模拟磁盘满 / 并发改写：落盘内容与预期不一致
      await realWrite(uri, Buffer.from('corrupted', 'utf8'))
    })
    await expect(writeJsonAtomic(fileUri, { a: 1 })).rejects.toThrow('读回校验失败')
    expect(nodeFs.readFileSync(fileUri.fsPath, 'utf8')).toBe('original')
    expect(nodeFs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('写入失败：抛错、原文件保持不变、临时文件被清理', async () => {
    nodeFs.writeFileSync(fileUri.fsPath, 'original', 'utf8')
    vi.spyOn(vscode.workspace.fs, 'writeFile').mockRejectedValue(new Error('disk full'))
    await expect(writeJsonAtomic(fileUri, { a: 1 })).rejects.toThrow('disk full')
    expect(nodeFs.readFileSync(fileUri.fsPath, 'utf8')).toBe('original')
    expect(nodeFs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
  })
})
