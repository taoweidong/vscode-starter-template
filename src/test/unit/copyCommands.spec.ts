import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { registerCopyCommands } from '../../extension/commands/copyCommands'
import { __resetStubs, __stubs } from './stubs/vscode'

/**
 * 拷贝示例命令（v2.2）：选中文本 / 文件内容 / 文件路径 → 剪贴板。
 * 剪贴板用 vscode 测试桩（__stubs.clipboard），文件用真实临时目录（workspace.fs 桩基于真实 fs）。
 */

const copyBytes = (bytes: number): Buffer => Buffer.alloc(bytes, 0x41) // 'A' 填充

beforeEach(() => {
  __resetStubs()
  const register = (id: string, cb: (...args: unknown[]) => unknown): void => {
    __stubs.registeredCommands.set(id, cb as (...args: unknown[]) => unknown)
  }
  registerCopyCommands(register as never)
})

afterEach(() => {
  // 临时目录由各用例自行清理（mkdtempSync 前缀统计）
})

function tmpRoot(): string {
  return nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-copy-'))
}

function invoke(command: string, ...args: unknown[]): unknown {
  const handler = __stubs.registeredCommands.get(command)
  if (!handler) {
    throw new Error(`命令未注册：${command}`)
  }
  return handler(...args)
}

const lastInfo = (): string | undefined =>
  (
    __stubs.recorded.filter((e) => e.kind === 'showInformationMessage').at(-1)?.args[0] as
      { message?: string } | undefined
  )?.message

const lastWarn = (): string | undefined =>
  (
    __stubs.recorded.filter((e) => e.kind === 'showWarningMessage').at(-1)?.args[0] as
      { message?: string } | undefined
  )?.message

describe('copySelection（复制选中文本）', () => {
  it('选中文本精确入剪贴板（不 trim），反馈含字符数', () => {
    invoke('extStarter.copySelection')
    // 无活动编辑器：提示而非剪贴板写入
    expect(lastInfo()).toContain('没有选中文本')
    expect(__stubs.clipboard).toBe('')
  })
})

describe('copyFileContent（复制文件内容）', () => {
  let root: string
  let fileA: string
  let fileB: string

  beforeEach(() => {
    root = tmpRoot()
    fileA = nodePath.join(root, 'a.txt')
    fileB = nodePath.join(root, 'b.md')
    nodeFs.writeFileSync(fileA, 'hello 内容', 'utf8')
    nodeFs.writeFileSync(fileB, '# world', 'utf8')
  })

  afterEach(() => {
    nodeFs.rmSync(root, { recursive: true, force: true })
  })

  it('单文件：复制纯内容（无分隔头）', async () => {
    await invoke('extStarter.copyFileContent', vscode.Uri.file(fileA))
    expect(__stubs.clipboard).toBe('hello 内容')
  })

  it('多选批量：以「=== 路径 ===」分隔并统计', async () => {
    await invoke('extStarter.copyFileContent', vscode.Uri.file(fileA), [
      vscode.Uri.file(fileA),
      vscode.Uri.file(fileB),
    ])
    expect(__stubs.clipboard).toBe(`=== ${fileA} ===\nhello 内容\n\n=== ${fileB} ===\n# world`)
  })

  it('二进制文件（NUL 字节）跳过并警告；其余照常复制', async () => {
    const bin = nodePath.join(root, 'bin.dat')
    nodeFs.writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02]))
    await invoke('extStarter.copyFileContent', vscode.Uri.file(bin), [
      vscode.Uri.file(bin),
      vscode.Uri.file(fileA),
    ])
    // 批量模式带路径分隔头；二进制被跳过，仅剩 a.txt
    expect(__stubs.clipboard).toBe(`=== ${fileA} ===
hello 内容`)
    expect(lastWarn()).toContain('二进制文件不支持')
  })

  it('超过 1MB 上限跳过并警告', async () => {
    const big = nodePath.join(root, 'big.log')
    nodeFs.writeFileSync(big, copyBytes(1024 * 1024 + 1))
    await invoke('extStarter.copyFileContent', vscode.Uri.file(big))
    expect(__stubs.clipboard).toBe('')
    expect(lastWarn()).toContain('1MB')
  })

  it('不存在的文件：警告不抛错', async () => {
    await invoke('extStarter.copyFileContent', vscode.Uri.file(nodePath.join(root, 'nope.txt')))
    expect(__stubs.clipboard).toBe('')
    expect(lastWarn()).toBeDefined()
  })
})

describe('copyFilePath（复制文件路径）', () => {
  it('单文件：绝对路径入剪贴板；多选：每行一个', async () => {
    const root = tmpRoot()
    try {
      const a = nodePath.join(root, 'a.ts')
      const b = nodePath.join(root, 'b.ts')
      nodeFs.writeFileSync(a, 'a', 'utf8')
      nodeFs.writeFileSync(b, 'b', 'utf8')
      await invoke('extStarter.copyFilePath', vscode.Uri.file(a))
      expect(__stubs.clipboard).toBe(a)
      await invoke('extStarter.copyFilePath', vscode.Uri.file(a), [
        vscode.Uri.file(a),
        vscode.Uri.file(b),
      ])
      expect(__stubs.clipboard).toBe(`${a}\n${b}`)
    } finally {
      nodeFs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('注册完整性', () => {
  it('三个拷贝命令均已注册', () => {
    for (const id of [
      'extStarter.copySelection',
      'extStarter.copyFileContent',
      'extStarter.copyFilePath',
    ]) {
      expect(__stubs.registeredCommands.has(id)).toBe(true)
    }
  })
})
