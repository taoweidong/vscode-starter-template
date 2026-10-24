import * as vscode from 'vscode'
import { escapeMarkdownInline } from '../../ui/markdown'
import type { StaticConfigSection } from './staticConfigService'

export type StaticConfigNode =
  | { kind: 'section'; section: StaticConfigSection }
  | { kind: 'entry'; section: StaticConfigSection; entry: StaticConfigSection['entries'][number] }
  | { kind: 'empty'; text: string }
  | { kind: 'error'; text: string }

/**
 * 「静态配置」树视图：只读展示工作区静态配置文件内容。
 * 演示「只读数据展示 + 文件联动（打开/自动刷新）」模式。
 */
export class StaticConfigTreeProvider implements vscode.TreeDataProvider<StaticConfigNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    StaticConfigNode | undefined | void
  >()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(
    private readonly getSections: () => StaticConfigSection[],
    /** 最近一次加载的解析失败原因（R-C-22：解析失败时展示错误态节点而非静默空态）。 */
    private readonly getError: () => string | undefined = () => undefined
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(node: StaticConfigNode): vscode.TreeItem {
    switch (node.kind) {
      case 'section': {
        const treeItem = new vscode.TreeItem(
          node.section.title,
          vscode.TreeItemCollapsibleState.Expanded
        )
        treeItem.description = `${node.section.entries.length} 项`
        treeItem.iconPath = new vscode.ThemeIcon('json')
        treeItem.contextValue = 'staticSection'
        // R-C-7：分组标题来自用户可编辑的配置文件（键名），拼 Markdown 前必须转义
        const tooltip = new vscode.MarkdownString()
        tooltip.appendMarkdown(
          `配置分组：**${escapeMarkdownInline(node.section.title)}**\n\n只读展示，修改请编辑 .vscode/crud-starter.config.json`
        )
        treeItem.tooltip = tooltip
        return treeItem
      }
      case 'entry': {
        const treeItem = new vscode.TreeItem(node.entry.key, vscode.TreeItemCollapsibleState.None)
        treeItem.description = node.entry.value
        treeItem.iconPath = new vscode.ThemeIcon('symbol-property')
        treeItem.tooltip = `${node.section.title}.${node.entry.key} = ${node.entry.value}`
        return treeItem
      }
      case 'error': {
        const treeItem = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None)
        treeItem.iconPath = new vscode.ThemeIcon('error')
        treeItem.contextValue = 'staticError'
        treeItem.tooltip = node.text
        return treeItem
      }
      default: {
        const treeItem = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None)
        treeItem.iconPath = new vscode.ThemeIcon('info')
        return treeItem
      }
    }
  }

  async getChildren(node?: StaticConfigNode): Promise<StaticConfigNode[]> {
    if (!node) {
      const sections = this.getSections()
      if (!sections.length) {
        // R-C-22：解析失败与「尚未生成」是两种语义，分别展示错误态 / 引导态节点
        const error = this.getError()
        return [
          error
            ? {
                kind: 'error',
                text: `静态配置读取失败：${error}（修复 .vscode/crud-starter.config.json 后将自动重新加载）`,
              }
            : {
                kind: 'empty',
                text: '暂无静态配置：运行「环境初始化」生成，或点击右上角打开配置文件',
              },
        ]
      }
      return sections.map((section): StaticConfigNode => ({ kind: 'section', section }))
    }
    if (node.kind === 'section') {
      return node.section.entries.map((entry): StaticConfigNode => ({
        kind: 'entry',
        section: node.section,
        entry,
      }))
    }
    return []
  }
}
