import * as path from 'path'
import * as vscode from 'vscode'
import { COMMAND } from '../constants'
import { type Item, PRIORITY_LABELS, type Priority } from '../models/item'
import { applyPatch } from '../domain/itemSchema'
import { ImportWizardPanel } from '../providers/importWizardPanel'
import { ItemFormPanel } from '../providers/itemFormPanel'
import { ItemService, ItemValidationError } from '../services/itemService'
import { JsonFileStore } from '../services/stores/jsonFileStore'
import type { IItemStore } from '../services/stores/itemStore'
import { PRIORITY_ICONS } from '../ui/icons'
import type { TaskRunner } from '../tasks/taskRunner'
import type { InitService, StepStatus } from '../features/init/initService'
import type { BuildService } from '../features/build/buildService'
import type { StaticConfigService } from '../features/staticConfig/staticConfigService'
import { ConfigFormPanel } from '../features/featureConfig/configFormPanel'
import {
  FEATURE_FLAGS,
  getFeatureValue,
  setFeatureValue,
} from '../features/featureConfig/featureFlags'
import { WebviewController } from '../webview/host/webviewController'

// VSCode 命令参数类型在注册期未知（与官方 API 签名一致使用 any[]）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = any[]

/** 命令层依赖集合：新增页面时在此扩展，避免参数列表无限增长。 */
export interface CommandDeps {
  service: ItemService
  /**
   * 动态获取当前数据源（StorageController 可能在 storagePath / 工作区变化后重建 store；
   * 持有旧快照会让 openDataFile 等命令打不开新文件——T4.5 修复）。
   */
  getStore: () => IItemStore
  taskRunner: TaskRunner
  outputChannel: vscode.OutputChannel
  initService: InitService
  staticConfig: StaticConfigService
  buildService: BuildService
}

/**
 * 命令注册中心：所有命令集中在此注册，每个命令对应一种「菜单入口 + 典型场景」。
 * 场景与菜单位置的完整对照表见 README「菜单与右键菜单示例」。
 *
 * view/item/context 传参约定：第一个参数是被右键的树节点元素，
 * 第二个参数是当前多选集合（Ctrl/Shift+点击时非空）——批量命令依赖第二个参数。
 */
export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { service, getStore, taskRunner, outputChannel, initService, staticConfig, buildService } =
    deps
  const register = (commandId: string, callback: (...args: AnyArgs) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, callback))
  }

  /** 成功通知统一入口：遵循「操作成功通知」特性开关。 */
  const notify = (message: string): void => {
    if (getFeatureValue('successNotifications')) {
      void vscode.window.showInformationMessage(message)
    }
  }

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

  /* ---------- 开发用：组件画廊（设计系统视觉验收基准） ---------- */
  register(COMMAND.openGallery, () => {
    WebviewController.createOrShow('gallery', context)
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
      notify(`已快速登记「${created.name}」。`)
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
      notify(`已将选中内容追加到「${fresh.name}」。`)
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
        notify(`已删除 ${removed.length} 个，${missing.length} 个不存在。`)
      } else {
        notify(
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
        notify(`已将 ${names(targets)} 的优先级设为「${PRIORITY_LABELS[priority]}」。`)
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
      notify(`已复制名称「${target.name}」。`)
    }
  })

  register(COMMAND.copyMarkdown, async (arg?: unknown) => {
    const target = toItem(arg) ?? (await pickItem(service, '选择要复制的条目'))
    if (!target) {
      return
    }
    if (await copyToClipboard(toMarkdown(target))) {
      notify('已复制为 Markdown。')
    }
  })

  register(COMMAND.copyJson, async (arg?: unknown) => {
    const target = toItem(arg) ?? (await pickItem(service, '选择要复制的条目'))
    if (!target) {
      return
    }
    if (await copyToClipboard(JSON.stringify(target, null, 2))) {
      notify('已复制 JSON。')
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
      notify(`已克隆为「${copy.name}」。`)
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
            notify(`已克隆为「${copy.name}」。`)
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
            notify(`优先级已设为「${PRIORITY_LABELS[priority]}」。`)
            break
          }
          case 'copyName':
            if (await copyToClipboard(current.name)) {
              notify(`已复制名称「${current.name}」。`)
            }
            break
          case 'copyMarkdown':
            if (await copyToClipboard(toMarkdown(current))) {
              notify('已复制为 Markdown。')
            }
            break
          case 'copyJson':
            if (await copyToClipboard(JSON.stringify(current, null, 2))) {
              notify('已复制 JSON。')
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
              notify(`已删除「${current.name}」。`)
            }
            stayInMenu = false
            break
          }
        }
      } catch (err) {
        showError(err)
      }
      // 操作后重新读取条目（优先级等已变化），菜单继续停留在同一目标上
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

  /* ---------- 启动任务 / 环境信息（环境信息视图标题栏与命令面板） ---------- */
  register(COMMAND.refreshEnvironment, () => {
    void taskRunner.runAll()
  })

  register(COMMAND.showEnvironmentOutput, () => {
    outputChannel.show(true)
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

  /* ---------- 功能页面：环境初始化（清单 + 单步动作模式） ---------- */
  register(COMMAND.runAllInit, () => {
    void initService.runAll()
  })

  register(COMMAND.runInitStep, async (stepId?: unknown) => {
    if (typeof stepId === 'string') {
      void initService.runStep(stepId)
      return
    }
    // 无参调用（命令面板）：QuickPick 引导选择步骤
    const states = initService.getStates()
    if (!states.length) {
      return
    }
    const picked = await vscode.window.showQuickPick(
      states.map((state) => ({
        label: `${statusIcon(state.status)} ${state.title}`,
        description: state.status === 'idle' ? state.description : state.message,
        id: state.id,
      })),
      { title: '选择要执行的初始化步骤', matchOnDescription: true }
    )
    if (picked) {
      void initService.runStep(picked.id)
    }
  })

  /* ---------- 功能页面：特性配置（树视图开关 + Webview 配置页） ---------- */
  register(COMMAND.openFeatureConfigPage, () => {
    ConfigFormPanel.createOrShow()
  })

  register(COMMAND.toggleFeature, async (key?: unknown) => {
    if (typeof key === 'string' && FEATURE_FLAGS.some((flag) => flag.key === key)) {
      void setFeatureValue(key, !getFeatureValue(key))
      return
    }
    // 无参 / 未知 key（命令面板）：QuickPick 引导选择开关
    const picked = await vscode.window.showQuickPick(
      FEATURE_FLAGS.map((flag) => ({
        label: `${getFeatureValue(flag.key) ? '$(check)' : '$(close)'} ${flag.label}`,
        description: flag.description,
        key: flag.key,
      })),
      { title: '选择要切换的特性开关', matchOnDescription: true }
    )
    if (picked) {
      void setFeatureValue(picked.key, !getFeatureValue(picked.key))
    }
  })

  /* ---------- 功能页面：静态配置（只读展示 + 文件联动） ---------- */
  register(COMMAND.openStaticConfigFile, async () => {
    if (!staticConfig.fileUri) {
      void vscode.window.showInformationMessage('未打开工作区，静态配置不可用。')
      return
    }
    await staticConfig.ensureDefault()
    await staticConfig.load()
    await vscode.window.showTextDocument(staticConfig.fileUri)
  })

  /* ---------- 功能页面：分支编译出包（任务自动化模式） ---------- */
  register(COMMAND.buildBranch, (branch?: unknown) => {
    const target = typeof branch === 'string' && branch ? branch : undefined
    void buildService
      .build(target)
      .then((result) => {
        if (result.status === 'ok') {
          notify(result.message)
        } else if (result.status === 'warn') {
          // 有结果但带警告（如构建完成但存在告警）：黄条反馈而非红条
          void vscode.window.showWarningMessage(result.message)
        } else if (result.status === 'error') {
          void vscode.window.showErrorMessage(result.message)
        }
      })
      .catch((err) => showError(err))
  })
}

/* ================= 工具函数 ================= */

/** 内容预览的文件大小上限（1MB）。 */
const PREVIEW_MAX_BYTES = 1024 * 1024

interface MoreActionPick extends vscode.QuickPickItem {
  action: string
}

/** 「更多操作」动态菜单的菜单项：接收当前条目，优先级三项标注当前值。 */
function buildMoreActions(item: Item): MoreActionPick[] {
  // 分组分隔符与树右键菜单的分组（1_crud/2_crud/3_crud）保持同构
  const separator = (label: string): MoreActionPick => ({
    label,
    kind: vscode.QuickPickItemKind.Separator,
    action: '',
  })
  const priorityDetail = (priority: Priority): string | undefined =>
    item.priority === priority ? '当前' : undefined
  return [
    separator('条目操作'),
    { label: '$(edit) 编辑条目', detail: '打开表单，修改全部字段', action: 'edit' },
    { label: '$(copy) 克隆条目', detail: '创建一条「（副本）」', action: 'duplicate' },
    separator('优先级'),
    { label: '$(arrow-up) 设为：高', detail: priorityDetail('high'), action: 'high' },
    { label: '$(dash) 设为：中', detail: priorityDetail('medium'), action: 'medium' },
    { label: '$(arrow-down) 设为：低', detail: priorityDetail('low'), action: 'low' },
    separator('复制'),
    { label: '$(copy) 复制名称', action: 'copyName' },
    { label: '$(markdown) 复制为 Markdown', action: 'copyMarkdown' },
    { label: '$(bracket) 复制为 JSON', action: 'copyJson' },
    separator('危险操作'),
    { label: '$(trash) 删除条目', action: 'delete' },
  ]
}

/** 初始化步骤状态的 QuickPick 图标。 */
function statusIcon(status: StepStatus): string {
  switch (status) {
    case 'done':
      return '$(check)'
    case 'failed':
      return '$(error)'
    case 'running':
      return '$(sync)'
    default:
      return '$(circle-outline)'
  }
}

/** Markdown 行内特殊字符转义（* _ [ ] `）。 */
function escapeMarkdownInline(text: string): string {
  return text.replace(/([*_`[\]])/g, '\\$1')
}

/** 条目 → Markdown 清单行；多行描述的续行缩进两空格以保持列表结构。 */
function toMarkdown(item: Item): string {
  const description = item.description
    ? item.description.split(/\r?\n/).map(escapeMarkdownInline).join('\n  ')
    : ''
  return [
    `- **${escapeMarkdownInline(item.name)}**（${PRIORITY_LABELS[item.priority]}优先级）`,
    item.category ? `  - 分类：${escapeMarkdownInline(item.category)}` : '',
    item.tags.length ? `  - 标签：${item.tags.map(escapeMarkdownInline).join('、')}` : '',
    description ? `  - ${description}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 剪贴板写入：失败弹「复制失败」而非中断（剪贴板可能被其他程序占用）。 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await vscode.env.clipboard.writeText(text)
    return true
  } catch {
    void vscode.window.showErrorMessage('复制失败：剪贴板暂不可用，请稍后重试。')
    return false
  }
}

/**
 * 入参归一化：树「右键菜单」传入的是树节点元素（ItemNode/CategoryNode），
 * 「树条目单击命令」传入的是原始 Item。两种来源统一转换为 Item。
 */
function toItem(arg: unknown): Item | undefined {
  if (!arg || typeof arg !== 'object') {
    return undefined
  }
  const node = arg as { kind?: unknown; item?: Item }
  if (node.kind === 'item' && node.item) {
    return node.item
  }
  if (node.kind === 'category') {
    return undefined
  }
  const maybeItem = arg as Item
  if (typeof maybeItem.id === 'string' && typeof maybeItem.name === 'string') {
    return maybeItem
  }
  return undefined
}

/** 汇总「被右键的条目 + 当前多选集合」，按 id 去重——批量命令的目标集合。 */
function collectTargets(primary: unknown, selected?: unknown[]): Item[] {
  const targets: Item[] = []
  const seen = new Set<string>()
  for (const candidate of [primary, ...(selected ?? [])]) {
    const item = toItem(candidate)
    if (item && !seen.has(item.id)) {
      seen.add(item.id)
      targets.push(item)
    }
  }
  return targets
}

function summarize(items: Item[]): string | undefined {
  if (items.length <= 1) {
    return items[0]?.description || undefined
  }
  return `即将删除：${names(items)}`
}

function names(items: Item[]): string {
  const labels = items.slice(0, 3).map((item) => `「${item.name}」`)
  return items.length <= 3 ? labels.join('、') : `${labels.join('、')} 等 ${items.length} 个`
}

/** 打开「文件登记」表单（资源管理器右键 / 编辑器右键 / 编辑器标题栏共用）；文件夹拒绝。 */
async function openFileForm(service: ItemService, uri: vscode.Uri): Promise<void> {
  try {
    const stat = await vscode.workspace.fs.stat(uri)
    if (stat.type === vscode.FileType.Directory) {
      void vscode.window.showInformationMessage('请选择文件而非文件夹。')
      return
    }
  } catch (err) {
    showError(err)
    return
  }
  ItemFormPanel.createOrShow(service, undefined, {
    name: path.basename(uri.fsPath),
    category: '文件',
    description: uri.fsPath,
    tags: ['文件'],
  })
}

/**
 * 未带参数调用时（如从命令面板触发），用 QuickPick 让用户选择一个条目。
 * 列表用 listAll（忽略当前过滤），过滤中时在标题注明，避免「只看到过滤结果」的困惑。
 */
async function pickItem(service: ItemService, title: string): Promise<Item | undefined> {
  const items = await service.listAll()
  if (!items.length) {
    void vscode.window.showInformationMessage('当前没有条目，请先新增。')
    return undefined
  }
  // 图标与树视图一致：同一优先级在全插件使用同一个 codicon
  const picked = await vscode.window.showQuickPick(
    items.map((item) => ({
      label: item.name,
      description: item.category || '未分类',
      detail: item.description ? item.description.split(/\r?\n/)[0] : undefined,
      iconPath: new vscode.ThemeIcon(PRIORITY_ICONS[item.priority]),
      item,
    })),
    {
      title: service.filtered ? `${title}（当前过滤中，已列出全部条目）` : title,
      matchOnDescription: true,
      matchOnDetail: true,
    }
  )
  return picked?.item
}

function showError(err: unknown): void {
  const message = err instanceof ItemValidationError ? err.message : `操作失败：${String(err)}`
  void vscode.window.showErrorMessage(message)
}
