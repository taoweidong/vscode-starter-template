import * as vscode from 'vscode'
import { COMMAND } from '../constants'
import type { DraftBoxService } from '../features/drafts/draftBoxService'
import type { CommandRegistrar } from './shared'

/**
 * 草稿箱场景命令分组（09 方案 §3.5：右键示例的新载体）。
 *
 * 8 条右键入口 → 4 个命令：
 * - editor/context 4：draftSelection（选中文本）/ appendDraftSelection（追加到最近草稿）/
 *   draftFile（当前文件，无选区时可见；选区存在时也提供第 4 入口）；
 * - explorer/context 3：draftFile（单文件 / 多选批量）/ draftFolder（文件夹汇总）；
 * - editor/title 1：draftFile（当前文件）。
 *
 * 教学价值在「宿主如何拿到上下文」：编辑器侧读 activeEditor 选区，
 * 资源管理器侧收 (uri, uris[]) 两参（单选 / 多选），写入统一走 DraftBoxService。
 */

export interface DraftCommandDeps {
  drafts: DraftBoxService
}

/** 当前编辑器的选区与来源文件名（任一缺失返回 undefined）。 */
function currentSelection(): { text: string; source: string } | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    return undefined
  }
  const text = editor.document.getText(editor.selection)
  if (!text.trim()) {
    return undefined
  }
  return { text, source: editor.document.fileName.split(/[\\/]/).pop() || '编辑器' }
}

/** 当前编辑器的文件 URI（未打开文件时 undefined）。 */
function currentFileUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri
}

/** 入参归一化为 Uri（资源管理器右键传入；其他来源可能传任意值）。 */
function toUri(value: unknown): vscode.Uri | undefined {
  return value instanceof vscode.Uri ? value : undefined
}

/** 草稿箱不可用（未打开工作区）的统一提示。 */
function unavailable(): void {
  void vscode.window.showInformationMessage('未打开工作区，草稿箱不可用。')
}

function notifyCount(count: number): void {
  void vscode.window.showInformationMessage(`草稿箱：现有 ${count} 条草稿（${STORAGE_HINT}）`)
}

const STORAGE_HINT = '数据文件 .vscode/ext-starter.drafts.json'

export function registerDraftCommands(register: CommandRegistrar, deps: DraftCommandDeps): void {
  const { drafts } = deps

  register(COMMAND.draftSelection, () => {
    if (!drafts.fileUri) {
      unavailable()
      return
    }
    const selection = currentSelection()
    if (!selection) {
      void vscode.window.showInformationMessage('编辑器中没有选中文本。')
      return
    }
    void drafts.addSelection(selection.text, selection.source).then(notifyCount)
  })

  register(COMMAND.appendDraftSelection, () => {
    if (!drafts.fileUri) {
      unavailable()
      return
    }
    const selection = currentSelection()
    if (!selection) {
      void vscode.window.showInformationMessage('编辑器中没有选中文本。')
      return
    }
    void drafts.appendToLatest(selection.text, selection.source).then((appended) => {
      void vscode.window.showInformationMessage(
        appended ? `已追加到「${drafts.list()[0]?.title ?? ''}」。` : '草稿箱为空，已登记为新草稿。'
      )
    })
  })

  register(COMMAND.draftFile, (uri?: unknown, uris?: unknown[]) => {
    if (!drafts.fileUri) {
      unavailable()
      return
    }
    // 多选批量（explorer/context 传入 [uri, uris[]]）；单选 / 编辑器侧单文件
    const batch = Array.isArray(uris) ? uris.map(toUri).filter((u): u is vscode.Uri => !!u) : []
    const single = toUri(uri) ?? currentFileUri()
    if (batch.length > 1) {
      void drafts.addFiles(batch).then(notifyCount)
      return
    }
    if (!single) {
      void vscode.window.showInformationMessage('没有可登记的文件。')
      return
    }
    void drafts
      .addFile(single)
      .then(notifyCount)
      .catch((err: unknown) => {
        void vscode.window.showInformationMessage(
          err instanceof Error ? err.message : '登记失败：文件不可访问。'
        )
      })
  })

  register(COMMAND.draftFolder, (uri?: unknown) => {
    if (!drafts.fileUri) {
      unavailable()
      return
    }
    const target = toUri(uri)
    if (!target) {
      void vscode.window.showInformationMessage('请从资源管理器对文件夹右键调用。')
      return
    }
    void drafts
      .addFolder(target)
      .then(notifyCount)
      .catch((err: unknown) => {
        void vscode.window.showInformationMessage(
          err instanceof Error ? err.message : '登记失败：文件夹不可访问。'
        )
      })
  })
}
