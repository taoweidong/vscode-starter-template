import * as path from 'path'
import * as vscode from 'vscode'
import { type Item, PRIORITY_LABELS, type Priority } from '../models/item'
import { ItemValidationError, type ItemService } from '../services/itemService'
import { ItemFormPanel } from '../providers/itemFormPanel'
import { escapeMarkdownInline } from '../ui/markdown'
import { PRIORITY_ICONS } from '../ui/icons'
import type { StepStatus } from '../features/init/initService'
import { getFeatureValue } from '../features/featureConfig/featureFlags'

/**
 * 命令层共享工具（C-15 拆分）：被三个场景分组（itemCommands / selectionCommands /
 * pageCommands）复用的纯函数、QuickPick 构建与用户反馈入口。
 * 只依赖被搬运代码原有的模块，不 import 任何分组文件（避免循环依赖）。
 */

// VSCode 命令参数类型在注册期未知（与官方 API 签名一致使用 any[]）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyArgs = any[]

/**
 * 命令注册闭包契约：由 index.ts 持有 ExtensionContext 创建
 * （context.subscriptions.push(registerCommand(...))），以参数形式分发给各分组。
 */
export type CommandRegistrar = (commandId: string, callback: (...args: AnyArgs) => unknown) => void

/** 内容预览的文件大小上限（1MB）。 */
export const PREVIEW_MAX_BYTES = 1024 * 1024

export interface MoreActionPick extends vscode.QuickPickItem {
  action: string
}

/** 「更多操作」动态菜单的菜单项：接收当前条目，优先级三项标注当前值。 */
export function buildMoreActions(item: Item): MoreActionPick[] {
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
export function statusIcon(status: StepStatus): string {
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

/** 条目 → Markdown 清单行；多行描述的续行缩进两空格以保持列表结构。 */
export function toMarkdown(item: Item): string {
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
export async function copyToClipboard(text: string): Promise<boolean> {
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
export function toItem(arg: unknown): Item | undefined {
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
export function collectTargets(primary: unknown, selected?: unknown[]): Item[] {
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

export function summarize(items: Item[]): string | undefined {
  if (items.length <= 1) {
    return items[0]?.description || undefined
  }
  return `即将删除：${names(items)}`
}

export function names(items: Item[]): string {
  const labels = items.slice(0, 3).map((item) => `「${item.name}」`)
  return items.length <= 3 ? labels.join('、') : `${labels.join('、')} 等 ${items.length} 个`
}

/** 打开「文件登记」表单（资源管理器右键 / 编辑器右键 / 编辑器标题栏共用）；文件夹拒绝。 */
export async function openFileForm(service: ItemService, uri: vscode.Uri): Promise<void> {
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
export async function pickItem(service: ItemService, title: string): Promise<Item | undefined> {
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

/**
 * 成功通知统一入口：遵循「操作成功通知」特性开关。
 * 拆分前为 registerCommands 内的闭包（读 successNotifications），行为不变。
 */
export function notifySuccess(message: string): void {
  if (getFeatureValue('successNotifications')) {
    void vscode.window.showInformationMessage(message)
  }
}

export function showError(err: unknown): void {
  const message = err instanceof ItemValidationError ? err.message : `操作失败：${String(err)}`
  void vscode.window.showErrorMessage(message)
}
