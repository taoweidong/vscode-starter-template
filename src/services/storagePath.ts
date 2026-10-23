import * as path from 'path'
import * as vscode from 'vscode'
import { STORAGE } from '../constants'

/**
 * T1.1（P0-03）：crudStarter.storagePath 配置的白名单校验。
 *
 * 该配置可被工作区设置覆盖（恶意仓库可在 .vscode/settings.json 里写入任意值），
 * 因此拼接到工作区根目录之前必须先过白名单：
 * - 只允许相对路径（拒绝 POSIX / Windows 盘符 / UNC 绝对路径）；
 * - 规范化后不得包含 `..` 段（不得逃逸工作区）；
 * - 拒绝 NUL 与 glob 字符（配置值还会被传给 FileSystemWatcher 当 glob 用）；
 * - 必须以 .json 结尾；
 * - `Uri.joinPath` 之后的结果必须仍位于工作区根目录内（双保险，防分隔符/大小写差异）。
 */

/** 解析结果：成功给出目标 Uri；失败给出中文原因（可直接用于警告提示）。 */
export type StorageUriResolution = { ok: true; uri: vscode.Uri } | { ok: false; reason: string }

/** glob 字符（配置值会被传给 RelativePattern，出现即拒绝）。 */
const GLOB_CHARS = /[*?[\]]/

/** Windows 盘符前缀（C:\ 或 C:/，含裸盘符 C:xxx）。 */
const WINDOWS_DRIVE = /^[a-zA-Z]:/

/**
 * 把经白名单校验的相对配置解析为目标文件 Uri。
 * 不做任何 IO；非法输入一律返回 { ok: false, reason } 而不是抛错。
 */
export function resolveStorageUri(root: vscode.Uri, configured: string): StorageUriResolution {
  const raw = (configured ?? '').trim()
  if (!raw) {
    return { ok: false, reason: '路径为空' }
  }
  if (raw.includes('\0')) {
    return { ok: false, reason: '路径包含 NUL 字符' }
  }
  if (GLOB_CHARS.test(raw)) {
    return { ok: false, reason: '路径包含通配符字符（* ? [ ]）' }
  }
  if (
    path.posix.isAbsolute(raw) ||
    raw.startsWith('//') ||
    raw.startsWith('\\\\') ||
    WINDOWS_DRIVE.test(raw)
  ) {
    return { ok: false, reason: '不允许使用绝对路径，请填写工作区内的相对路径' }
  }
  if (!raw.toLowerCase().endsWith('.json')) {
    return { ok: false, reason: '数据文件必须以 .json 结尾' }
  }
  // 规范化（拼接 a/../b 这类段）后逐段检查，杜绝 .. 逃逸
  const segments = path
    .normalize(raw)
    .split(/[\\/]+/)
    .filter(Boolean)
  if (segments.some((segment) => segment === '..')) {
    return { ok: false, reason: '路径不允许包含 ..（不能逃逸出工作区）' }
  }
  const uri = vscode.Uri.joinPath(root, ...segments)
  if (!isInsideRoot(root, uri)) {
    return { ok: false, reason: '规范化后路径不在工作区内' }
  }
  return { ok: true, uri }
}

/**
 * 宽松版：非法配置回退到默认路径（STORAGE.defaultFileName）。
 * 供激活 / 初始化等「不能中断」的路径使用；usedDefault=true 时 reason 说明回退原因。
 */
export function resolveStorageUriOrDefault(
  root: vscode.Uri,
  configured: string
): { uri: vscode.Uri; usedDefault: boolean; reason?: string } {
  const result = resolveStorageUri(root, configured)
  if (result.ok) {
    return { uri: result.uri, usedDefault: false }
  }
  return {
    uri: vscode.Uri.joinPath(root, STORAGE.defaultFileName),
    usedDefault: true,
    reason: result.reason,
  }
}

/** 计算 uri 相对 root 的 POSIX 风格路径（供 RelativePattern / 日志展示使用）。 */
export function storageRelativePath(root: vscode.Uri, uri: vscode.Uri): string {
  return path
    .relative(root.fsPath, uri.fsPath)
    .split(/[\\/]+/)
    .join('/')
}

/** target 是否仍位于 root 目录内（Windows 下大小写不敏感、分隔符双兼容）。 */
function isInsideRoot(root: vscode.Uri, target: vscode.Uri): boolean {
  const caseInsensitive = path.sep === '\\' || /^[a-zA-Z]:/.test(root.fsPath)
  const normalizeCase = (value: string): string => (caseInsensitive ? value.toLowerCase() : value)
  const relative = path.relative(normalizeCase(root.fsPath), normalizeCase(target.fsPath))
  if (!relative || relative === '..') {
    return false // 与根重合（是目录不是数据文件）或直连父目录
  }
  return relative.split(/[\\/]+/).every((segment) => segment !== '..')
}
