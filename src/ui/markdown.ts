/**
 * Markdown 行内转义（R-C-8：消除 commands/shared.ts 与 itemsTreeDataProvider.ts 两份同款实现）。
 * 无 vscode 依赖：宿主 tooltip、剪贴板 Markdown 等场景共用（与 src/ui/icons.ts 同层）。
 */

/** Markdown 行内特殊字符转义（\ * _ [ ] `；反斜杠必须优先，否则自身被当转义符）。 */
export function escapeMarkdownInline(text: string): string {
  return text.replace(/([\\*_`[\]])/g, '\\$1')
}
