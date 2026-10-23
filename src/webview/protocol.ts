/**
 * Webview 与扩展宿主之间的消息协议（docs/需求与优化方案/03 §5.5）。
 *
 * - 宿主侧 `panel.webview.onDidReceiveMessage` / 页面侧 `window.addEventListener('message')`
 *   收到任何消息都必须先过 `isWebviewMessage` / `isHostMessage` 运行时守卫（修复 W7）；
 * - 宿主与 Webview 共享本文件：禁止 import vscode / DOM / Node 专属 API；
 * - 守卫逐字段窄化：null、缺字段、未知 type 一律拒绝，未知消息只记日志不抛错；
 * - 向后兼容地扩展：新增消息只追加联合分支与守卫 case，不改既有分支形状。
 */

/** init 消息携带的表单字段描述（结构最小集；完整 Schema 由领域层提供，M5-T5.1 接入）。 */
export interface FieldDef {
  key: string
  label: string
  type: string
  /** 允许附加上位置元数据（placeholder / hint / options 等） */
  [extra: string]: unknown
}

/** 批量导入：预览文件条目（宿主扫描文件夹后下发；执行时原样回传）。 */
export interface ImportPreviewFile {
  /** 文件名（去重比对与条目名称都用它） */
  name: string
  /** 文件绝对路径（写入条目描述） */
  path: string
  /** 与现有条目同名：页面标注「已存在」并默认不勾选，执行时按跳过统计 */
  exists: boolean
}

/** 批量导入：执行结果汇总（成功 N / 跳过 M / 失败 K + 明细）。 */
export interface ImportResult {
  created: number
  skipped: number
  failed: number
  /** 用户中途取消（已完成的部分保留） */
  cancelled: boolean
  /** 失败明细（文件名 + 原因） */
  failures?: { name: string; reason: string }[]
}

/** 宿主 → Webview */
export type HostMessage =
  | {
      type: 'init'
      page: string
      schema: FieldDef[]
      value: unknown
      extra?: Record<string, unknown>
    }
  | { type: 'submitAck'; ok: true }
  | { type: 'error'; message: string; field?: string }
  /** 「浏览…」应答：用户选中的文件夹；取消为 null */
  | { type: 'selectFolder'; folder: string | null }
  /** 预览应答：文件夹扫描结果（已按名称去重标注、上限 50） */
  | { type: 'importPreview'; files: ImportPreviewFile[] }
  /** 执行进度（done 为已完成个数） */
  | { type: 'importProgress'; done: number; total: number }
  /** 执行结束（成功 / 取消 / 部分失败都走本消息） */
  | { type: 'importDone'; result: ImportResult }

/** Webview → 宿主 */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'dirty'; dirty: boolean }
  | { type: 'submit'; draft: Record<string, unknown> }
  | { type: 'cancel' }
  /** 请求宿主弹出文件夹选择框（showOpenDialog） */
  | { type: 'browseFolder' }
  /** 请求宿主扫描文件夹并回预览 */
  | { type: 'requestPreview'; folder: string }
  /** 开始执行导入（files 为预览列表的勾选子集） */
  | { type: 'executeImport'; files: ImportPreviewFile[] }
  /** 取消执行（已完成批次保留） */
  | { type: 'cancelImport' }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFieldDef(v: unknown): v is FieldDef {
  return (
    isPlainObject(v) &&
    typeof v.key === 'string' &&
    typeof v.label === 'string' &&
    typeof v.type === 'string'
  )
}

function isImportPreviewFile(v: unknown): v is ImportPreviewFile {
  return (
    isPlainObject(v) &&
    typeof v.name === 'string' &&
    typeof v.path === 'string' &&
    typeof v.exists === 'boolean'
  )
}

function isImportFileList(v: unknown): v is ImportPreviewFile[] {
  return Array.isArray(v) && v.every(isImportPreviewFile)
}

function isImportFailureList(v: unknown): v is { name: string; reason: string }[] {
  return (
    Array.isArray(v) &&
    v.every(
      (entry) =>
        isPlainObject(entry) && typeof entry.name === 'string' && typeof entry.reason === 'string'
    )
  )
}

/** 宿主收到消息时先过本守卫，再按 type 分发。 */
export function isWebviewMessage(v: unknown): v is WebviewMessage {
  if (!isPlainObject(v)) {
    return false
  }
  switch (v.type) {
    case 'ready':
      return true
    case 'dirty':
      return typeof v.dirty === 'boolean'
    case 'submit':
      return isPlainObject(v.draft)
    case 'cancel':
      return true
    case 'browseFolder':
      return true
    case 'requestPreview':
      return typeof v.folder === 'string'
    case 'executeImport':
      return isImportFileList(v.files)
    case 'cancelImport':
      return true
    default:
      return false
  }
}

/** 页面侧收到消息时先过本守卫，再按 type 分发。 */
export function isHostMessage(v: unknown): v is HostMessage {
  if (!isPlainObject(v)) {
    return false
  }
  switch (v.type) {
    case 'init':
      return (
        typeof v.page === 'string' &&
        Array.isArray(v.schema) &&
        v.schema.every(isFieldDef) &&
        v.value !== undefined &&
        (v.extra === undefined || isPlainObject(v.extra))
      )
    case 'submitAck':
      return v.ok === true
    case 'error':
      return typeof v.message === 'string' && (v.field === undefined || typeof v.field === 'string')
    case 'selectFolder':
      return typeof v.folder === 'string' || v.folder === null
    case 'importPreview':
      return isImportFileList(v.files)
    case 'importProgress':
      return typeof v.done === 'number' && typeof v.total === 'number'
    case 'importDone':
      return (
        isPlainObject(v.result) &&
        typeof v.result.created === 'number' &&
        typeof v.result.skipped === 'number' &&
        typeof v.result.failed === 'number' &&
        typeof v.result.cancelled === 'boolean' &&
        (v.result.failures === undefined || isImportFailureList(v.result.failures))
      )
    default:
      return false
  }
}
