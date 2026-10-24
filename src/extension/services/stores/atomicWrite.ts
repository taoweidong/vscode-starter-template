import { randomUUID } from 'node:crypto'
import * as path from 'path'
import * as vscode from 'vscode'

/**
 * JSON 文件原子写（从 JsonFileStore 抽取的共享工具，可靠性契约不变：M1 / NFR-01）。
 *
 * - 序列化为 2 空格缩进 + 换行结尾；
 * - 写同目录临时文件 → 读回比对 → rename 覆盖；任何失败都保证**原文件不变**；
 * - 失败路径清理临时文件后抛出。
 */
export async function writeJsonAtomic(fileUri: vscode.Uri, value: unknown): Promise<void> {
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  const dirUri = vscode.Uri.joinPath(fileUri, '..')
  await vscode.workspace.fs.createDirectory(dirUri)
  const tempUri = vscode.Uri.joinPath(
    dirUri,
    `${path.basename(fileUri.fsPath)}.tmp-${randomUUID()}`
  )
  try {
    await vscode.workspace.fs.writeFile(tempUri, content)
    // 读回比对：确认临时文件完整落盘（磁盘满 / 并发写会在这里暴露）
    const written = Buffer.from(await vscode.workspace.fs.readFile(tempUri))
    if (Buffer.compare(written, content) !== 0) {
      throw new Error('临时文件读回校验失败（磁盘可能已满或被并发改写）')
    }
    // 同目录 rename：目标要么是完整新内容，要么保持原样
    await vscode.workspace.fs.rename(tempUri, fileUri, { overwrite: true })
  } catch (err) {
    // 失败路径：清理临时文件后抛出，原文件未被触碰
    // （Thenable 没有 .catch，用 then 的第二参数吞掉清理失败）
    await vscode.workspace.fs.delete(tempUri).then(undefined, () => undefined)
    throw err
  }
}
