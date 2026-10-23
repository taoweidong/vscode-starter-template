import * as path from 'path'
import * as vscode from 'vscode'
import { COMMAND } from '../constants'
import { applyPatch } from '../domain/itemSchema'
import { ImportWizardPanel } from '../providers/importWizardPanel'
import { ItemFormPanel } from '../providers/itemFormPanel'
import { type ItemService } from '../services/itemService'
import {
  type CommandRegistrar,
  notifySuccess,
  openFileForm,
  pickItem,
  PREVIEW_MAX_BYTES,
  showError,
} from './shared'

/**
 * 编辑器 / 资源管理器选区与文件场景命令分组（C-15 拆分）——
 * 从选中文本新增、从文件 / 文件夹登记、批量导入向导。
 * 场景与菜单位置的完整对照表见 README「菜单与右键菜单示例」。
 */

/** 本组依赖（CommandDeps 中与本组相关的字段，由 index.ts 组装时整体传入）。 */
export interface SelectionCommandDeps {
  service: ItemService
}

export function registerSelectionCommands(
  register: CommandRegistrar,
  deps: SelectionCommandDeps
): void {
  const { service } = deps

  /* ---------- 场景：从选中文本新增（编辑器右键菜单 / Alt+S） ----------
     典型场景：选中一段 TODO、报错信息或需求描述 → 右键 → 一键变条目，表单自动预填 */
  register(COMMAND.newItemFromSelection, () => {
    const editor = vscode.window.activeTextEditor
    const text = editor ? editor.document.getText(editor.selection).trim() : ''
    if (!text) {
      void vscode.window.showInformationMessage('请先在编辑器中选中一段文本，再运行本命令。')
      return
    }
    ItemFormPanel.createOrShow(service, undefined, {
      name: text.split(/\r?\n/)[0].slice(0, 50),
      description: text,
      category: '来自编辑器',
      tags: ['选区'],
    })
  })

  /* ---------- 场景：从文件新增（资源管理器右键 / 编辑器标题栏图标） ----------
     典型场景：把待重构的文件登记成条目，描述里记录完整路径 */
  register(COMMAND.newItemFromFile, async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (!target) {
      void vscode.window.showInformationMessage(
        '未找到可用的文件：请在资源管理器中右键文件，或先打开一个文件。'
      )
      return
    }
    await openFileForm(service, target)
  })

  /* ---------- 场景：登记文件并摘录内容（资源管理器右键） ----------
     典型场景：登记配置文件/脚本时，把前 20 行内容一并带进描述，方便日后回看 */
  register(COMMAND.newItemFromFilePreview, async (uri?: vscode.Uri) => {
    if (!uri) {
      void vscode.window.showInformationMessage('请在资源管理器中右键一个文件。')
      return
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.type === vscode.FileType.Directory) {
        void vscode.window.showInformationMessage('请选择文件而非文件夹。')
        return
      }
      if (stat.size > PREVIEW_MAX_BYTES) {
        void vscode.window.showInformationMessage(
          '二进制或过大文件：内容预览仅支持不超过 1MB 的文本文件。'
        )
        return
      }
      const raw = await vscode.workspace.fs.readFile(uri)
      if (Buffer.from(raw.slice(0, 1024)).includes(0)) {
        void vscode.window.showInformationMessage('二进制或过大文件：无法预览非文本内容。')
        return
      }
      const preview = Buffer.from(raw).toString('utf8').split(/\r?\n/).slice(0, 20).join('\n')
      ItemFormPanel.createOrShow(service, undefined, {
        name: path.basename(uri.fsPath),
        category: '文件',
        description: `${uri.fsPath}\n\n—— 内容预览（前 20 行）——\n${preview}`,
        tags: ['文件', '含内容'],
      })
    } catch (err) {
      showError(err)
    }
  })

  /* ---------- 场景：文件夹批量登记（资源管理器右键） ----------
     语义升级（M4-T4.4）：不再静默批量创建，改为打开批量导入向导并预填该文件夹，
     用户在向导中预览去重、勾选并执行（命令 ID / 菜单位置不变）。 */
  register(COMMAND.newItemsFromFolder, (uri?: vscode.Uri) => {
    if (!uri) {
      void vscode.window.showInformationMessage('请在资源管理器中右键一个文件夹。')
      return
    }
    ImportWizardPanel.createOrShow(service, uri.fsPath)
  })

  /* ---------- 场景：批量导入向导（itemsView 标题栏 + 命令面板） ---------- */
  register(COMMAND.openImportWizard, () => {
    ImportWizardPanel.createOrShow(service)
  })

  /* ---------- 场景：从选中文本快速新增（编辑器右键） ----------
     与「从选中文本新增条目」的区别：跳过表单静默创建，适合一口气登记多条 */
  register(COMMAND.quickAddFromSelection, async () => {
    const editor = vscode.window.activeTextEditor
    const text = editor ? editor.document.getText(editor.selection).trim() : ''
    if (!text) {
      void vscode.window.showInformationMessage('请先在编辑器中选中一段文本，再运行本命令。')
      return
    }
    try {
      const created = await service.create({
        name: text.split(/\r?\n/)[0].slice(0, 50),
        category: '来自编辑器',
        description: text,
        priority: 'medium',
        tags: ['选区', '快速'],
      })
      notifySuccess(`已快速登记「${created.name}」。`)
    } catch (err) {
      showError(err)
    }
  })

  /* ---------- 场景：选中内容追加到已有条目（编辑器右键） ----------
     典型场景：条目已存在，后续在代码里看到相关线索，选中右键直接补进描述 */
  register(COMMAND.appendSelectionToItem, async () => {
    const editor = vscode.window.activeTextEditor
    const text = editor ? editor.document.getText(editor.selection).trim() : ''
    if (!text) {
      void vscode.window.showInformationMessage('请先在编辑器中选中一段文本，再运行本命令。')
      return
    }
    const target = await pickItem(service, '选择要追加内容的条目')
    if (!target) {
      return
    }
    try {
      // 操作前取最新数据（树节点可能是旧快照——外部修改不应被覆盖，P1-05）
      const fresh = await service.get(target.id)
      if (!fresh) {
        void vscode.window.showInformationMessage('条目不存在，可能已被删除。')
        return
      }
      const stamp = new Date().toLocaleString()
      const description = fresh.description
        ? `${fresh.description}\n\n—— 追加于 ${stamp} ——\n${text}`
        : text
      // 以最新条目为底做局部合并（领域层 toDraft 单一来源，扩展字段不丢）
      await service.update(fresh.id, applyPatch(fresh, { description }))
      notifySuccess(`已将选中内容追加到「${fresh.name}」。`)
    } catch (err) {
      showError(err)
    }
  })

  /* ---------- 场景：登记当前文件（编辑器内容右键，无选区时出现） ---------- */
  register(COMMAND.addCurrentFileToItems, () => {
    const uri = vscode.window.activeTextEditor?.document.uri
    if (!uri) {
      void vscode.window.showInformationMessage('当前没有打开的文件。')
      return
    }
    void openFileForm(service, uri)
  })
}
