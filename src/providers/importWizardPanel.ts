import * as vscode from 'vscode'
import type { ItemDraft } from '../models/item'
import type { ItemService } from '../services/itemService'
import type {
  HostMessage,
  ImportPreviewFile,
  ImportResult,
  WebviewMessage,
} from '../webview/protocol'
import { WebviewController, type WebviewControllerDeps } from '../webview/host/webviewController'

/**
 * 批量导入向导面板（M4-T4.4，新页面）。
 *
 * 三步向导的宿主侧：
 * - browseFolder → vscode.window.showOpenDialog（仅文件夹），回 selectFolder；
 * - requestPreview → readDirectory 扫描（仅文件、上限 50），
 *   与现有条目按名称去重标注 exists，回 importPreview；
 * - executeImport → 分批 service.createMany（每批 ≤20，便于进度展示），
 *   每批完成回 importProgress；结束回 importDone（成功 N / 跳过 M / 失败 K + 明细）；
 * - cancelImport → 取消标志置位：当前批次完成后停止，已完成部分保留。
 */
export class ImportWizardPanel {
  /** 单次预览 / 导入的文件上限（防止误操作生成海量条目）。 */
  static readonly MAX_FILES = 50
  /** 每批写入的文件数（createMany 单批大小，便于进度展示）。 */
  static readonly BATCH_SIZE = 20

  private static context: vscode.ExtensionContext | undefined
  private static current: ImportWizardPanel | undefined

  /** extension.ts 组装时注入扩展上下文（面板资源解析基准）。 */
  static configure(context: vscode.ExtensionContext): void {
    ImportWizardPanel.context = context
  }

  /**
   * 打开（或复用）批量导入向导；presetFolder 预填来源文件夹（资源管理器右键进入）。
   * @param extraDeps 测试注入的面板依赖（createPanel / resolveAssets 等），生产不传
   */
  static createOrShow(
    service: ItemService,
    presetFolder?: string,
    extraDeps?: Partial<WebviewControllerDeps>
  ): void {
    const context = ImportWizardPanel.context
    if (!context) {
      void vscode.window.showErrorMessage(
        '批量导入面板未完成装配（缺少扩展上下文），请重新加载窗口。'
      )
      return
    }
    const existing = ImportWizardPanel.current
    if (existing && existing.isActive()) {
      existing.controller?.reveal()
      existing.presetFolder = presetFolder ?? existing.presetFolder
      existing.controller?.sendInit()
      return
    }
    ImportWizardPanel.current = new ImportWizardPanel(context, service, presetFolder, extraDeps)
  }

  private controller: WebviewController | undefined
  private presetFolder: string | undefined
  private cancelRequested = false
  private running = false

  private constructor(
    context: vscode.ExtensionContext,
    service: ItemService,
    presetFolder?: string,
    extraDeps?: Partial<WebviewControllerDeps>
  ) {
    this.presetFolder = presetFolder
    const baseDeps = createImportWizardDeps(service, {
      getPresetFolder: () => this.presetFolder,
      onCancel: () => this.close(),
      getCancelRequested: () => this.cancelRequested,
      setCancelRequested: (value: boolean) => {
        this.cancelRequested = value
      },
      isRunning: () => this.running,
      setRunning: (value: boolean) => {
        this.running = value
      },
    })
    this.controller = WebviewController.createOrShow(
      'importWizard',
      context,
      extraDeps ? { ...baseDeps, ...extraDeps } : baseDeps
    )
  }

  private isActive(): boolean {
    return (
      this.controller !== undefined && WebviewController.get('importWizard') === this.controller
    )
  }

  private close(): void {
    if (ImportWizardPanel.current === this) {
      ImportWizardPanel.current = undefined
    }
    this.controller?.dispose()
    this.controller = undefined
  }
}

/** createImportWizardDeps 的运行时状态钩子（面板实例 / 序列化恢复面板共用）。 */
export interface ImportWizardRuntime {
  getPresetFolder: () => string | undefined
  onCancel: () => void
  getCancelRequested: () => boolean
  setCancelRequested: (value: boolean) => void
  isRunning: () => boolean
  setRunning: (value: boolean) => void
}

/** 批量导入向导的宿主依赖工厂（页面消息分发见类注释）。 */
export function createImportWizardDeps(
  service: ItemService,
  runtime: ImportWizardRuntime
): WebviewControllerDeps {
  return {
    buildInit: () => {
      const preset = runtime.getPresetFolder()
      return {
        schema: [],
        value: null,
        extra: preset ? { presetFolder: preset } : {},
      }
    },
    onPageMessage: (message: WebviewMessage) => {
      switch (message.type) {
        case 'browseFolder':
          void browseFolder()
          break
        case 'requestPreview':
          void previewFolder(message.folder)
          break
        case 'executeImport':
          void executeImport(message.files)
          break
        case 'cancelImport':
          // 当前批次完成后停止；不在执行中则视作页面重置（无副作用）
          runtime.setCancelRequested(true)
          break
        default:
          break // ready/dirty/submit/cancel 由控制器处理
      }
    },
    onCancel: () => runtime.onCancel(),
  }

  async function post(message: HostMessage): Promise<void> {
    WebviewController.get('importWizard')?.post(message)
  }

  async function browseFolder(): Promise<void> {
    const picks = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '选择文件夹',
    })
    await post({ type: 'selectFolder', folder: picks && picks.length > 0 ? picks[0].fsPath : null })
  }

  async function previewFolder(folder: string): Promise<void> {
    try {
      const folderUri = vscode.Uri.file(folder)
      const entries = await vscode.workspace.fs.readDirectory(folderUri)
      const files = entries
        // 符号链接到文件时 readDirectory 返回 File|SymbolicLink（位或），位运算判定避免漏扫
        .filter(([, fileType]) => (fileType & vscode.FileType.File) !== 0)
        .map(([name]) => ({ name, uri: vscode.Uri.joinPath(folderUri, name) }))
        .slice(0, ImportWizardPanel.MAX_FILES)
      if (files.length === 0) {
        await post({ type: 'error', message: '该文件夹下没有文件。' })
        return
      }
      // 与现有条目按名称去重：同名文件标注「已存在」，页面默认不勾选
      const existingNames = new Set((await service.listAll()).map((item) => item.name))
      const preview: ImportPreviewFile[] = files.map((file) => ({
        name: file.name,
        path: file.uri.fsPath,
        exists: existingNames.has(file.name),
      }))
      await post({ type: 'importPreview', files: preview })
    } catch (err) {
      await post({ type: 'error', message: `读取文件夹失败：${reasonOf(err)}` })
    }
  }

  async function executeImport(files: ImportPreviewFile[]): Promise<void> {
    if (runtime.isRunning()) {
      return // 在途中重复触发直接忽略
    }
    runtime.setRunning(true)
    runtime.setCancelRequested(false)
    let created = 0
    let skipped = 0
    let failed = 0
    const failures: { name: string; reason: string }[] = []

    // 已存在的同名文件：无论是否勾选都按跳过统计（去重语义）
    const pending = files.filter((file) => {
      if (file.exists) {
        skipped += 1
        return false
      }
      return true
    })
    const total = files.length

    for (let index = 0; index < pending.length; index += ImportWizardPanel.BATCH_SIZE) {
      if (runtime.getCancelRequested()) {
        break // 取消即停：已完成批次保留
      }
      const batch = pending.slice(index, index + ImportWizardPanel.BATCH_SIZE)
      const drafts: ItemDraft[] = batch.map((file) => ({
        name: file.name,
        category: '文件',
        description: file.path,
        priority: 'medium',
        tags: ['文件', '批量'],
      }))
      try {
        const items = await service.createMany(drafts)
        created += items.length
      } catch (err) {
        const reason = reasonOf(err)
        failed += batch.length
        failures.push(...batch.map((file) => ({ name: file.name, reason })))
      }
      await post({ type: 'importProgress', done: skipped + created + failed, total })
    }

    runtime.setRunning(false)
    const result: ImportResult = {
      created,
      skipped,
      failed,
      cancelled: runtime.getCancelRequested(),
      ...(failures.length > 0 ? { failures } : {}),
    }
    await post({ type: 'importDone', result })
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
