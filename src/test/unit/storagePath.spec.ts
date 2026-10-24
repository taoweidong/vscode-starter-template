import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { STORAGE } from '../../constants'
import {
  resolveStorageUri,
  resolveStorageUriOrDefault,
  storageRelativePath,
} from '../../services/storagePath'

/** T1.1（P0-03）：storagePath 白名单全矩阵。 */
describe('resolveStorageUri 路径白名单', () => {
  let rootDir: string
  let root: vscode.Uri

  beforeEach(() => {
    rootDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-path-test-'))
    root = vscode.Uri.file(rootDir)
  })

  afterEach(() => {
    nodeFs.rmSync(rootDir, { recursive: true, force: true })
  })

  describe('合法相对路径', () => {
    it.each([
      ['默认值 .vscode/crud-starter-items.json', STORAGE.defaultFileName],
      ['工作区内相对路径', 'data/items.json'],
      ['多级相对路径', '.vscode/nested/deep/items.json'],
      ['当前目录前缀', './items.json'],
      ['规范化后仍在工作区内（a/../b.json）', 'a/../b.json'],
      ['Windows 分隔符', '.vscode\\items.json'],
      ['大写后缀', 'ITEMS.JSON'],
    ])('%s', (_name, configured) => {
      const result = resolveStorageUri(root, configured)
      expect(result.ok).toBe(true)
      if (result.ok) {
        // 解析结果必须位于工作区根目录内
        const relative = nodePath.relative(rootDir, result.uri.fsPath)
        expect(relative.startsWith('..')).toBe(false)
        expect(nodePath.isAbsolute(relative)).toBe(false)
      }
    })

    it('默认值解析到 root/.vscode/crud-starter-items.json', () => {
      const result = resolveStorageUri(root, STORAGE.defaultFileName)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.uri.fsPath).toBe(vscode.Uri.joinPath(root, STORAGE.defaultFileName).fsPath)
      }
    })
  })

  describe('非法路径全部拒绝', () => {
    it.each([
      ['空字符串', ''],
      ['纯空白', '   '],
      ['null 值', null as unknown as string],
      ['undefined', undefined as unknown as string],
      ['POSIX 绝对路径', '/etc/passwd.json'],
      ['Windows 盘符绝对路径（反斜杠）', 'C:\\data\\items.json'],
      ['Windows 盘符绝对路径（正斜杠）', 'c:/data/items.json'],
      ['裸盘符前缀', 'C:items.json'],
      ['UNC 路径', '\\\\server\\share\\items.json'],
      ['网络路径（//）', '//server/share/items.json'],
      ['父目录逃逸（../x.json）', '../x.json'],
      ['父目录逃逸（嵌套 a/../../x.json）', 'a/../../x.json'],
      ['父目录逃逸（Windows 分隔符 ..\\..\\x.json）', '..\\..\\x.json'],
      ['仅父目录', '..'],
      ['NUL 字符', 'a\0b.json'],
      ['glob 星号', 'a*.json'],
      ['glob 问号', 'a?.json'],
      ['glob 方括号', '[a].json'],
      ['glob 方括号（闭合）', 'a[b].json'],
      // R-C-20：保留设备名按「首个点之前」判定，带扩展名同样不可用
      ['Windows 保留设备名（con.json）', 'con.json'],
      ['Windows 保留设备名（大写 NUL.json）', 'NUL.json'],
      ['Windows 保留设备名（data/com1.json）', 'data/com1.json'],
      ['Windows 保留设备名（data/lpt9.json）', 'data/lpt9.json'],
      ['非 .json 后缀（.txt）', 'data/items.txt'],
      ['无后缀', 'data/items'],
      ['目录结尾的 .json（非文件后缀语义）', 'data.json/'],
    ])('%s', (_name, configured) => {
      const result = resolveStorageUri(root, configured)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(typeof result.reason).toBe('string')
        expect(result.reason.length).toBeGreaterThan(0)
      }
    })
  })

  it('默认值 resolveStorageUriOrDefault 不触发回退', () => {
    const result = resolveStorageUriOrDefault(root, STORAGE.defaultFileName)
    expect(result.usedDefault).toBe(false)
    expect(result.reason).toBeUndefined()
    expect(result.uri.fsPath).toBe(vscode.Uri.joinPath(root, STORAGE.defaultFileName).fsPath)
  })

  it('非法配置 resolveStorageUriOrDefault 回退默认路径并给出原因', () => {
    const result = resolveStorageUriOrDefault(root, '../escape.json')
    expect(result.usedDefault).toBe(true)
    expect(result.reason).toBeTruthy()
    expect(result.uri.fsPath).toBe(vscode.Uri.joinPath(root, STORAGE.defaultFileName).fsPath)
  })

  it('storageRelativePath 输出 POSIX 风格相对路径', () => {
    const resolved = resolveStorageUri(root, STORAGE.defaultFileName)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(storageRelativePath(root, resolved.uri)).toBe(STORAGE.defaultFileName)
    }
  })
})
