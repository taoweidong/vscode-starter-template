import * as vscode from 'vscode'
import { COMMAND, VIEW } from '../../constants'
import type { BuildApiClient, BuildTask } from './buildApiClient'

/**
 * 「构建任务」树视图（v2.1：分支编译的侧边栏入口）。
 *
 * - 数据与弹框页同源（同一 BuildApiClient：打桩内存表 / 真实 HTTP 接口）；
 * - **可见期轮询**：视图可见时每 3s 拉取列表（onDidChangeVisibility 门控，
 *   隐藏即停——真实接口场景不空转）；标题栏刷新命令手动触发同一路径；
 * - 单击任务条目打开分支编译弹框（TreeItem.command 路由 buildBranch）；
 * - 空态 / 拉取失败以 info 节点呈现（错误保留旧数据不清空）。
 */

export type BuildTaskNode =
  { kind: 'task'; task: BuildTask } | { kind: 'info'; text: string; icon: string }

const STATUS_ICONS: Record<BuildTask['status'], string> = {
  queued: 'clock',
  running: 'sync~spin',
  success: 'check',
  failed: 'error',
}

const STATUS_LABEL: Record<BuildTask['status'], string> = {
  queued: '排队中',
  running: '构建中',
  success: '成功',
  failed: '失败',
}

const POLL_INTERVAL_MS = 3000

export class BuildTasksTreeProvider
  implements vscode.TreeDataProvider<BuildTaskNode>, vscode.Disposable
{
  private tasks: BuildTask[] = []
  private loadError: string | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BuildTaskNode | undefined | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(private readonly api: BuildApiClient) {}

  /** 轮询开关（extension.ts 按视图可见性调用；幂等）。 */
  setPolling(enabled: boolean): void {
    if (enabled && this.pollTimer === undefined) {
      void this.refresh()
      this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS)
    } else if (!enabled && this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  /** 手动 / 轮询共用的拉取路径；失败保留旧数据并提示。 */
  async refresh(): Promise<void> {
    try {
      this.tasks = await this.api.list()
      this.loadError = undefined
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err)
    }
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(node: BuildTaskNode): vscode.TreeItem {
    if (node.kind === 'info') {
      const info = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None)
      info.iconPath = new vscode.ThemeIcon(node.icon)
      return info
    }
    const task = node.task
    const item = new vscode.TreeItem(task.branch, vscode.TreeItemCollapsibleState.None)
    const statusLabel = STATUS_LABEL[task.status]
    item.description =
      task.status === 'running'
        ? `${statusLabel} ${task.progress}% · ${task.buildType === 'full' ? '完整' : '增量'}`
        : `${statusLabel} · ${task.buildType === 'full' ? '完整' : '增量'}`
    item.iconPath = new vscode.ThemeIcon(STATUS_ICONS[task.status])
    item.contextValue = VIEW.buildTaskContextValue
    // 单击任务打开分支编译弹框（带参路由同一命令，无新增命令）
    item.command = { command: COMMAND.buildBranch, title: '在控制台查看', arguments: [] }
    item.tooltip = new vscode.MarkdownString(
      [
        `**${task.branch}**（${task.buildType === 'full' ? '完整构建' : '增量构建'}）`,
        `- 状态：${statusLabel}${task.status === 'running' ? `（${task.progress}%）` : ''}`,
        task.message ? `- 信息：${task.message}` : '',
        task.notes ? `- 备注：${task.notes}` : '',
        `- 提交于：${new Date(task.createdAt).toLocaleString()}`,
        task.finishedAt ? `- 结束于：${new Date(task.finishedAt).toLocaleString()}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    return item
  }

  async getChildren(): Promise<BuildTaskNode[]> {
    if (this.loadError) {
      return [{ kind: 'info', text: `列表拉取失败：${this.loadError}`, icon: 'error' }]
    }
    if (this.tasks.length === 0) {
      return [{ kind: 'info', text: '暂无构建任务：点击标题栏「打开控制台」提交', icon: 'info' }]
    }
    return this.tasks.map((task): BuildTaskNode => ({ kind: 'task', task }))
  }

  dispose(): void {
    this.setPolling(false)
    this._onDidChangeTreeData.dispose()
  }
}
