import type { Priority } from '../models/item'

/**
 * 优先级对应的 codicon 图标。
 * 树视图、QuickPick、tooltip 共用此映射，保证同一概念在全插件使用同一个图标语言。
 */
export const PRIORITY_ICONS: Record<Priority, string> = {
  high: 'arrow-up',
  medium: 'dash',
  low: 'arrow-down',
}
