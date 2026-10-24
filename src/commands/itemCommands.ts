import * as vscode from 'vscode'
import { COMMAND } from '../constants'
import { PRIORITY_LABELS, type Priority } from '../models/item'
import { applyPatch } from '../domain/itemSchema'
import { ItemFormPanel } from '../providers/itemFormPanel'
import { type ItemService } from '../services/itemService'
import { JsonFileStore } from '../services/stores/jsonFileStore'
import type { IItemStore } from '../services/stores/itemStore'
import { getFeatureValue } from '../features/featureConfig/featureFlags'
import {
  buildMoreActions,
  collectTargets,
  copyToClipboard,
  type CommandRegistrar,
  names,
  notifySuccess,
  pickItem,
  showError,
  summarize,
  toItem,
  toMarkdown,
} from './shared'

/**
 * 条目场景命令分组（C-15 拆分）：树视图 / 右键菜单上的条目级操作——
 * 新增 / 编辑 / 克隆 / 删除 / 优先级 / 复制 / 更多操作 / 过滤 / 刷新 / 打开数据文件。
 * 场景与菜单位置的完整对照表见 README「菜单与右键菜单示例」。
 */

/** 本组依赖（CommandDeps 中与本组相关的字段，由 index.ts 组装时整体传入）。 */
export interface ItemCommandDeps {
  service: ItemService
  getStore: () => IItemStore
}

export function registerItemCommands(register: CommandRegistrar, deps: ItemCommandDeps): void {
  const { service, getStore } = deps

  /* ---------- 场景：常规新增 / 编辑（视图标题栏 ＋、树单击、树右键、Alt+N） ---------- */
  register(COMMAND.newItem, () => {
    ItemFormPanel.createOrShow(service)
  })

  register(COMMAND.editItem, async (arg?: unknown) => {
    const target = toItem(arg) ?? (await pickItem(service, '选择要编辑的条目'))
    if (target) {
      ItemFormPanel.createOrShow(service, target)
    }
  })

  /* ---------- 场景：删除（树右键，支持 Ctrl/Shift 多选批量删除） ---------- */
  register(COMMAND.deleteItem, async (arg?: unknown, selected?: unknown[]) => {
    const targets = collectTargets(arg, selected)
    if (!targets.length) {
      const picked = await pickItem(service, '选择要删除的条目')
      if (picked) {
        targets.push(picked)
      }
    }
    if (!targets.length) {
      return
    }
    // 「删除前确认」开关关闭时跳过模态确认（演示特性开关真实生效）
    const confirmed = getFeatureValue('confirmDelete')
      ? await vscode.window.showWarningMessage(
          targets.length > 1
            ? `确定删除选中的 ${targets.length} 个条目？`
            : `确定删除「${targets[0].name}」？`,
          { modal: true, detail: summarize(targets) },
          '删除'
        )
      : '删除'
    if (confirmed !== '删除') {
      return
    }
    try {
      // 批量删除单次写盘（M5 契约）；结果区分已删除 / 不存在
      const { removed, missing } = await service.removeMany(targets.map((target) => target.id))
      if (removed.length === 0) {
        void vscode.window.showInformationMessage('条目不存在，可能已被删除。')
        return
      }
      if (missing.length > 0) {
        notifySuccess(`已删除 ${removed.length} 个，${missing.length} 个不存在。`)
      } else {
        notifySuccess(
          removed.length === 1
            ? `已删除「${removed[0].name}」。`
            : `已删除 ${removed.length} 个条目。`
        )
      }
    } catch (err) {
      showError(err)
    }
  })

  /* ---------- 场景：设置优先级（树右键「设置优先级」子菜单，支持批量） ---------- */
  const changePriority =
    (priority: Priority) =>
    async (arg?: unknown, selected?: unknown[]): Promise<void> => {
      const targets = collectTargets(arg, selected)
      if (!targets.length) {
        const picked = await pickItem(service, '选择要调整优先级的条目')
        if (picked) {
          targets.push(picked)
        }
      }
      if (!targets.length) {
        return
      }
      try {
        // 批量更新单次写盘（M5 契约）：只传 id + 优先级补丁，不携带旧快照字段
        await service.updateMany(targets.map((target) => ({ id: target.id, patch: { priority } })))
        notifySuccess(`已将 ${names(targets)} 的优先级设为「${PRIORITY_LABELS[priority]}」。`)
      } catch (err) {
        showError(err)
      }
    }
  register(COMMAND.setPriorityHigh, changePriority('high'))
  register(COMMAND.setPriorityMedium, changePriority('medium'))
  register(COMMAND.setPriorityLow, changePriority('low'))

  /* ---------- 场景：复制分享（树右键「复制…」子菜单） ----------
     典型场景：把条目复制成名称 / Markdown 清单 / JSON，粘贴到周报或 issue 里 */
  register(COMMAND.copyName, async (arg?: unknown) => {
    const target = toItem(arg) ?? (await pickItem(service, '选择要复制的条目'))
    if (!target) {
      return
    }
    if (await copyToClipboard(target.name)) {
      notifySuccess(`已复制名称「${target.name}」。`)
    }
  })

  register(COMMAND.copyMarkdown, async (arg?: unknown) => {
    const target = toItem(arg) ?? (await pickItem(service, '选择要复制的条目'))
    if (!target) {
      return
    }
    if (await copyToClipboard(toMarkdown(target))) {
      notifySuccess('已复制为 Markdown。')
    }
  })

  register(COMMAND.copyJson, async (arg?: unknown) => {
    const target = toItem(arg) ?? (await pickItem(service, '选择要复制的条目'))
    if (!target) {
      return
    }
    if (await copyToClipboard(JSON.stringify(target, null, 2))) {
      notifySuccess('已复制 JSON。')
    }
  })

  /* ---------- 场景：克隆 ---------- */
  register(COMMAND.duplicateItem, async (arg?: unknown) => {
    const target = toItem(arg) ?? (await pickItem(service, '选择要克隆的条目'))
    if (!target) {
      return
    }
    try {
      const copy = await service.duplicate(target.id)
      notifySuccess(`已克隆为「${copy.name}」。`)
    } catch (err) {
      showError(err)
    }
  })

  /* ---------- 场景：动态菜单（QuickPick 模拟） ----------
     package.json 只能声明静态菜单；菜单项需要随数据动态变化（如显示当前值）时，
     用 QuickPick 实现「可编程菜单」——本例操作后菜单保持打开，按 Esc 退出。 */
  register(COMMAND.moreActions, async (arg?: unknown) => {
    let current = toItem(arg) ?? (await pickItem(service, '选择要操作的条目'))
    while (current) {
      const picked = await vscode.window.showQuickPick(buildMoreActions(current), {
        title: `「${current.name}」— 更多操作（按 Esc 关闭菜单）`,
      })
      if (!picked || !picked.action) {
        return
      }
      let stayInMenu = true
      try {
        switch (picked.action) {
          case 'edit':
            ItemFormPanel.createOrShow(service, current)
            stayInMenu = false
            break
          case 'duplicate': {
            const copy = await service.duplicate(current.id)
            notifySuccess(`已克隆为「${copy.name}」。`)
            stayInMenu = false
            break
          }
          case 'high':
          case 'medium':
          case 'low': {
            const priority = picked.action as Priority
            // 操作前取最新数据，以最新条目为底打优先级补丁（不用树节点旧快照）
            const fresh = await service.get(current.id)
            if (!fresh) {
              void vscode.window.showInformationMessage('条目不存在，可能已被删除。')
              stayInMenu = false
              break
            }
            await service.update(fresh.id, applyPatch(fresh, { priority }))
            notifySuccess(`优先级已设为「${PRIORITY_LABELS[priority]}」。`)
            break
          }
          case 'copyName':
            if (await copyToClipboard(current.name)) {
              notifySuccess(`已复制名称「${current.name}」。`)
            }
            break
          case 'copyMarkdown':
            if (await copyToClipboard(toMarkdown(current))) {
              notifySuccess('已复制为 Markdown。')
            }
            break
          case 'copyJson':
            if (await copyToClipboard(JSON.stringify(current, null, 2))) {
              notifySuccess('已复制 JSON。')
            }
            break
          case 'delete': {
            // 删除确认与其他删除入口统一走「删除前确认」开关
            const confirmed = getFeatureValue('confirmDelete')
              ? await vscode.window.showWarningMessage(
                  `确定删除「${current.name}」？`,
                  { modal: true },
                  '删除'
                )
              : '删除'
            if (confirmed === '删除') {
              await service.remove(current.id)
              notifySuccess(`已删除「${current.name}」。`)
            }
            stayInMenu = false
            break
          }
        }
      } catch (err) {
        showError(err)
      }
      // 操作后重新读取条目（优先级等已变化）：stayInMenu 时菜单继续停留在同一目标上；
      // 否则（编辑 / 克隆 / 删除等会转移焦点的操作）置 undefined 退出菜单循环（R-C-18）
      current = stayInMenu ? await service.get(current.id) : undefined
    }
  })

  /* ---------- 场景：过滤 / 刷新 / 打开数据文件（视图标题栏与命令面板） ---------- */
  register(COMMAND.filterItems, async () => {
    const keyword = await vscode.window.showInputBox({
      title: '过滤条目',
      prompt: '输入关键字（名称/分类/描述/标签）；留空并回车即可清除过滤。',
      value: service.getFilter(),
    })
    if (keyword === undefined) {
      return // 用户按了 Esc
    }
    service.setFilter(keyword)
  })

  register(COMMAND.refresh, () => {
    service.reload()
  })

  register(COMMAND.openDataFile, async () => {
    // 动态取当前数据源（storagePath / 工作区变化后 store 会重建，旧快照会指向旧文件）
    const store = getStore()
    if (!(store instanceof JsonFileStore)) {
      void vscode.window.showInformationMessage('当前数据源不是工作区文件，没有可打开的数据文件。')
      return
    }
    try {
      await vscode.workspace.fs.stat(store.fileUri)
    } catch {
      const choice = await vscode.window.showInformationMessage(
        '数据文件尚未创建（新增第一条数据后自动生成）。',
        '去新增条目'
      )
      if (choice) {
        await vscode.commands.executeCommand(COMMAND.newItem)
      }
      return
    }
    try {
      await vscode.window.showTextDocument(store.fileUri)
    } catch (err) {
      void vscode.window.showErrorMessage(
        `打开数据文件失败：${err instanceof Error ? err.message : String(err)}`
      )
    }
  })
}
