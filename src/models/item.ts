/** 优先级。 */
export type Priority = 'low' | 'medium' | 'high'

/**
 * 核心数据模型：条目。
 * 需要扩展字段时：在 src/domain/itemSchema.ts 的 ITEM_FIELD_DEFS 加一行字段定义，
 * 校验 / 清洗 / 表单渲染自动跟随（详见 README「如何扩展」）；
 * 只加在 Item / ItemDraft 之外的未知字段（string / number / boolean）也会被透传保留。
 */
export interface Item {
  id: string
  name: string
  /** 分类（留空归入「未分类」） */
  category: string
  description: string
  priority: Priority
  tags: string[]
  createdAt: string
  updatedAt: string
}

/**
 * 新增 / 编辑时的可写字段（不含 id 与时间戳，由服务层统一生成）。
 *
 * T5.1（P0-04）：改为与 Record<string, unknown> 的交叉类型——
 * 已知 5 个字段仍类型安全（name: string 等不变），同时**容纳任意扩展字段**
 * （owner / deadline 等，值经领域校验 src/domain/itemSchema.ts 的 coerceDraft 清洗后透传）。
 * 加字段只需在 src/domain/itemSchema.ts 的 ITEM_FIELD_DEFS 加一行定义；
 * 未加定义的 string / number / boolean 字段也会原样保留，不会被白名单丢弃。
 */
export type ItemDraft = {
  name: string
  category: string
  description: string
  priority: Priority
  tags: string[]
} & Record<string, unknown>

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

/** 供表单下拉框使用的优先级顺序（从低到高）。 */
export const PRIORITIES: Priority[] = ['low', 'medium', 'high']

export function isPriority(value: unknown): value is Priority {
  return value === 'low' || value === 'medium' || value === 'high'
}

/**
 * 生成条目 ID。
 *
 * 经 globalThis.crypto 而非 `import from 'crypto'` 获取：models 会经
 * src/domain/itemSchema.ts 被 Webview 类型程序（tsconfig.webview.json，types:[]）
 * 追溯检查，模块导入会让整个链路染上 Node 内建模块依赖（M6/P1-14 相关）；
 * globalThis.crypto 在 Node ≥ 20（engines 约束）与浏览器两侧均可用。
 */
export function createId(): string {
  return globalThis.crypto.randomUUID()
}
