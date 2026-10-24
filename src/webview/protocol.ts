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

/* ============ 串口命令控制台：协议层线类型（完整模型见 features/serialConsole） ============ */

/** 检测到的本机串口（serialport list() 的最小结构面）。 */
export interface SerialPortBrief {
  path: string
  manufacturer?: string
}

/** 串口服务器在协议层的最小结构面（与 features/serialConsole/models.ts 的 SerialServer 对齐）。 */
export interface SerialServerWire {
  id: string
  name: string
  serialPath: string
  baudRate: number
  dataBits: number
  stopBits: number
  parity: string
  flowControl: string
  lineEnding: string
  autoLogin: boolean
  username: string
  description: string
  createdAt: number
  updatedAt: number
  /** 允许附加上位置元数据（与 FieldDef 同理，透传扩展字段） */
  [extra: string]: unknown
}

/** 串口连接状态（与 features/serialConsole/serialLinkService.ts 的 LinkState 对齐）。 */
export type SerialLinkStateWire = 'connecting' | 'connected' | 'disconnected' | 'error'

/** 命令历史条目（MRU 序，已去重）。 */
export interface CommandHistoryWire {
  id: string
  command: string
  lastUsedAt: number
  useCount: number
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
  /** 检测到的本机串口（页面「检测串口」应答） */
  | { type: 'serialPorts'; ports: SerialPortBrief[] }
  /** 服务器列表全量（init 后增删改均推送最新列表） */
  | { type: 'serialServers'; servers: SerialServerWire[] }
  /** 串口连接状态变化；serverId 为 null 表示无活动连接（如已断开） */
  | { type: 'serialState'; serverId: string | null; state: SerialLinkStateWire; error?: string }
  /** 串口输出批（seq 单调递增；text 为 UTF-8 文本） */
  | { type: 'serialData'; seq: number; text: string }
  /** 命令历史（MRU 序，已去重） */
  | { type: 'commandHistory'; entries: CommandHistoryWire[] }

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
  /** 请求枚举本机串口 */
  | { type: 'serialPortsRequest' }
  /** 请求服务器列表全量 */
  | { type: 'serialServersRequest' }
  /** 保存服务器（新增或编辑；password 单独走 SecretStorage，不进 draft 持久化） */
  | { type: 'serialServerSave'; draft: Record<string, unknown>; password?: string }
  /** 删除服务器（同时清理其 SecretStorage 密码） */
  | { type: 'serialServerDelete'; id: string }
  /** 连接指定服务器 */
  | { type: 'serialConnect'; serverId: string }
  /** 断开当前连接 */
  | { type: 'serialDisconnect' }
  /** 下发命令（宿主追加换行符写入串口） */
  | { type: 'serialSend'; command: string }
  /** 请求命令历史 */
  | { type: 'commandHistoryRequest' }
  /** 删除单条历史 */
  | { type: 'commandHistoryRemove'; id: string }
  /** 清空历史 */
  | { type: 'commandHistoryClear' }

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

function isSerialPortBrief(v: unknown): v is SerialPortBrief {
  return (
    isPlainObject(v) &&
    typeof v.path === 'string' &&
    (v.manufacturer === undefined || typeof v.manufacturer === 'string')
  )
}

function isSerialServerWire(v: unknown): v is SerialServerWire {
  return (
    isPlainObject(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.serialPath === 'string' &&
    typeof v.baudRate === 'number' &&
    typeof v.dataBits === 'number' &&
    typeof v.stopBits === 'number' &&
    typeof v.parity === 'string' &&
    typeof v.flowControl === 'string' &&
    typeof v.lineEnding === 'string' &&
    typeof v.autoLogin === 'boolean' &&
    typeof v.username === 'string' &&
    typeof v.description === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.updatedAt === 'number'
  )
}

function isSerialLinkStateWire(v: unknown): v is SerialLinkStateWire {
  return (
    v === 'connecting' || v === 'connected' || v === 'disconnected' || v === 'error'
  )
}

function isCommandHistoryWire(v: unknown): v is CommandHistoryWire {
  return (
    isPlainObject(v) &&
    typeof v.id === 'string' &&
    typeof v.command === 'string' &&
    typeof v.lastUsedAt === 'number' &&
    typeof v.useCount === 'number'
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
    case 'serialPortsRequest':
      return true
    case 'serialServersRequest':
      return true
    case 'serialServerSave':
      return (
        isPlainObject(v.draft) && (v.password === undefined || typeof v.password === 'string')
      )
    case 'serialServerDelete':
      return typeof v.id === 'string'
    case 'serialConnect':
      return typeof v.serverId === 'string'
    case 'serialDisconnect':
      return true
    case 'serialSend':
      return typeof v.command === 'string'
    case 'commandHistoryRequest':
      return true
    case 'commandHistoryRemove':
      return typeof v.id === 'string'
    case 'commandHistoryClear':
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
    case 'serialPorts':
      return Array.isArray(v.ports) && v.ports.every(isSerialPortBrief)
    case 'serialServers':
      return Array.isArray(v.servers) && v.servers.every(isSerialServerWire)
    case 'serialState':
      return (
        (typeof v.serverId === 'string' || v.serverId === null) &&
        isSerialLinkStateWire(v.state) &&
        (v.error === undefined || typeof v.error === 'string')
      )
    case 'serialData':
      return typeof v.seq === 'number' && typeof v.text === 'string'
    case 'commandHistory':
      return Array.isArray(v.entries) && v.entries.every(isCommandHistoryWire)
    default:
      return false
  }
}
