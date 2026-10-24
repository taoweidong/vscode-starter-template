import * as vscode from 'vscode'
import { STORAGE } from '../../constants'
import { writeJsonAtomic } from '../../services/stores/atomicWrite'

/**
 * 草稿箱服务（09 方案 §3.5：右键示例的新载体）。
 *
 * 条目领域删除后，「宿主如何拿到编辑器 / 资源管理器上下文并写入工作区存储」这条
 * 教学链路由草稿箱承担：8 条右键入口（editor/context 4 + explorer/context 3 +
 * editor/title 1）全部落到 `.vscode/ext-starter.drafts.json`（B3：该路径须字面量
 * 进 DEFAULT_DIRTY_IGNORES 与 .gitignore，否则重演「用过一次 → 分支编译自阻断」）。
 *
 * 可靠性对齐 serverStore：原子写（writeJsonAtomic）、损坏文件按空数据继续、
 * 上限裁剪（100 条）防无限增长。
 */

export type DraftKind = 'selection' | 'file' | 'folder'

export interface DraftEntry {
  id: string
  kind: DraftKind
  /** 展示标题（选中文本摘要 / 文件名 / 文件夹名） */
  title: string
  /** 补充信息（来源文件、路径、批量清单等） */
  detail: string
  createdAt: number
}

const DRAFTS_SCHEMA_VERSION = 1
/** 草稿上限：超出后丢弃最旧的（unshift 到头部、尾部裁剪）。 */
const MAX_DRAFTS = 100
/** 文件夹批量登记时列目录的文件数上限（防超大目录拖垮命令）。 */
const FOLDER_BATCH_LIMIT = 50
/** 选中文本的标题摘要长度。 */
const TITLE_LIMIT = 40

function nextDraftId(): string {
  // 经 globalThis.crypto 而非 node:crypto：与串口侧 models.ts 同理，避免在
  // Webview 可达的模块里引入 Node 内建依赖
  return (globalThis.crypto as { randomUUID(): string }).randomUUID()
}

function summarizeText(text: string): string {
  const singleLine = text.split(/\r?\n/).join(' ').trim()
  return singleLine.length > TITLE_LIMIT ? `${singleLine.slice(0, TITLE_LIMIT)}…` : singleLine
}

export class DraftBoxService implements vscode.Disposable {
  private entries: DraftEntry[] = []

  private readonly _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChange = this._onDidChange.event

  constructor(private readonly getWorkspaceRoot: () => vscode.Uri | undefined) {}

  /** 数据文件 URI；未打开工作区时为 undefined（草稿功能整体不可用）。 */
  get fileUri(): vscode.Uri | undefined {
    const root = this.getWorkspaceRoot()
    return root ? vscode.Uri.joinPath(root, STORAGE.draftsFileName) : undefined
  }

  /**
   * 从工作区加载数据。文件不存在 / 解析失败一律按空数据继续
   * （损坏文件保持原样不动，用户可自行修复），返回加载条数。
   */
  async load(): Promise<number> {
    this.entries = []
    const uri = this.fileUri
    if (!uri) {
      return 0
    }
    try {
      const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
      const parsed = JSON.parse(raw) as { entries?: unknown }
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries.filter(
          (entry): entry is DraftEntry =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as DraftEntry).id === 'string' &&
            typeof (entry as DraftEntry).title === 'string'
        )
      }
    } catch {
      // 缺失 / 损坏：按空数据继续，原文件保持不动
    }
    this._onDidChange.fire()
    return this.entries.length
  }

  /** 当前草稿（最新在前）。 */
  list(): readonly DraftEntry[] {
    return [...this.entries]
  }

  /** 登记一条选中文本（source 为来源文件名或 '编辑器'）。 */
  async addSelection(text: string, source: string): Promise<number> {
    const trimmed = text.trim()
    if (!trimmed) {
      return this.entries.length
    }
    return this.push({
      id: nextDraftId(),
      kind: 'selection',
      title: summarizeText(trimmed),
      detail: `来源：${source}`,
      createdAt: Date.now(),
    })
  }

  /**
   * 追加选中文本到最近一条草稿（detail 追加一段）。没有草稿时降级为新增。
   * 返回是否发生了追加（false = 降级新增或空文本无操作）。
   */
  async appendToLatest(text: string, source: string): Promise<boolean> {
    const trimmed = text.trim()
    if (!trimmed) {
      return false
    }
    const latest = this.entries[0]
    if (!latest) {
      await this.addSelection(trimmed, source)
      return false
    }
    latest.detail = `${latest.detail}\n${summarizeText(trimmed)}（来自：${source}）`
    await this.persist()
    this._onDidChange.fire()
    return true
  }

  /** 登记单个文件（拒绝目录）。 */
  async addFile(uri: vscode.Uri): Promise<number> {
    const stat = await vscode.workspace.fs.stat(uri)
    if (stat.type === vscode.FileType.Directory) {
      throw new Error('请选择文件而非文件夹。')
    }
    return this.push({
      id: nextDraftId(),
      kind: 'file',
      title: uri.path.split('/').pop() || uri.fsPath,
      detail: uri.fsPath,
      createdAt: Date.now(),
    })
  }

  /** 批量登记文件（资源管理器多选）。目录项会被跳过。 */
  async addFiles(uris: readonly vscode.Uri[]): Promise<number> {
    for (const uri of uris) {
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.type !== vscode.FileType.Directory) {
        await this.addFile(uri)
      }
    }
    return this.entries.length
  }

  /**
   * 登记文件夹内容为一条汇总草稿（不递归；限 FOLDER_BATCH_LIMIT 个文件）。
   * 空文件夹抛错（右键入口对空文件夹给出可操作提示）。
   */
  async addFolder(uri: vscode.Uri): Promise<number> {
    const stat = await vscode.workspace.fs.stat(uri)
    if (stat.type !== vscode.FileType.Directory) {
      throw new Error('请选择文件夹。')
    }
    const children = await vscode.workspace.fs.readDirectory(uri)
    const files = children
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .sort()
    if (files.length === 0) {
      throw new Error('文件夹内没有文件，无可登记内容。')
    }
    const listed = files.slice(0, FOLDER_BATCH_LIMIT)
    const overflow = files.length > FOLDER_BATCH_LIMIT ? ` 等 ${files.length} 个文件` : ''
    return this.push({
      id: nextDraftId(),
      kind: 'folder',
      title: uri.path.split('/').pop() || uri.fsPath,
      detail: `${listed.join('、')}${overflow}`,
      createdAt: Date.now(),
    })
  }

  dispose(): void {
    this._onDidChange.dispose()
  }

  /** 头部插入 + 上限裁剪 + 原子落盘。返回当前条数。 */
  private async push(entry: DraftEntry): Promise<number> {
    this.entries.unshift(entry)
    if (this.entries.length > MAX_DRAFTS) {
      this.entries.length = MAX_DRAFTS
    }
    await this.persist()
    this._onDidChange.fire()
    return this.entries.length
  }

  private async persist(): Promise<void> {
    const uri = this.fileUri
    if (!uri) {
      return
    }
    await writeJsonAtomic(uri, { schemaVersion: DRAFTS_SCHEMA_VERSION, entries: this.entries })
  }
}
