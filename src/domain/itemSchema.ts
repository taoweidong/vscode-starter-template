import { PRIORITIES, PRIORITY_LABELS, type Item, type ItemDraft } from '../models/item'

/**
 * T5.1（P0-04）：领域字段定义——条目 Schema 的**单一来源**。
 *
 * 「给条目加字段」的承诺在此兑现：
 * - 表单 UI 元数据（src/webview/formSchema.ts）由本表派生；
 * - 服务端校验 / 清洗（coerceDraft）按本表逐字段处理；
 * - 未知字段（不在本表中的 key）只要值是 string / number / boolean，
 *   就原样透传进 draft 并随条目落盘——**加字段前甚至不用改这里**，
 *   改了这里则获得类型转换与校验能力。
 *
 * 本模块必须是纯 TypeScript（禁止 import vscode / DOM），
 * 以便在单元测试与 Webview 两侧共用。
 */
export interface ItemFieldDef {
  /** 对应 ItemDraft 的字段名 */
  key: string
  type: 'text' | 'textarea' | 'select' | 'tags' | 'boolean'
  label: string
  /** 必填（text / textarea：trim 后非空；select：必须有合法值） */
  required?: boolean
  /** 文本最大长度（trim 后计量，超长报错） */
  maxLength?: number
  /** select / boolean 的默认值 */
  defaultValue?: string
  /** select 的可选项 */
  options?: { value: string; label: string }[]
  /** 字段下方的说明文字 */
  hint?: string
  placeholder?: string
}

/** 条目字段定义（现有 5 个字段）。 */
export const ITEM_FIELD_DEFS: ItemFieldDef[] = [
  {
    key: 'name',
    type: 'text',
    label: '名称',
    required: true,
    maxLength: 200,
    placeholder: '请输入条目名称',
  },
  {
    key: 'category',
    type: 'text',
    label: '分类',
    placeholder: '例如：需求 / 任务 / 笔记（留空归入「未分类」）',
    hint: '输入时会自动提示已有分类',
  },
  {
    key: 'priority',
    type: 'select',
    label: '优先级',
    defaultValue: 'medium',
    options: PRIORITIES.map((priority) => ({
      value: priority,
      label: PRIORITY_LABELS[priority],
    })),
  },
  {
    key: 'tags',
    type: 'tags',
    label: '标签',
    placeholder: '前端, 待办',
    hint: '多个标签用逗号分隔',
  },
  {
    key: 'description',
    type: 'textarea',
    label: '描述',
    placeholder: '补充说明（可选）',
  },
]

/** 校验失败结果：field 定位字段（供表单错误锚定），message 已含字段中文名，可直接展示。 */
export type CoerceDraftResult =
  { ok: true; draft: ItemDraft } | { ok: false; field: string; message: string }

/** 已知字段 key 集合（供未知字段透传判定）。 */
const DEFINED_KEYS = new Set(ITEM_FIELD_DEFS.map((def) => def.key))

/** 单个 text / textarea 字段的清洗：非字符串报错；返回 trim 后的值。 */
function coerceTextField(
  def: ItemFieldDef,
  raw: unknown
): { ok: true; value: string } | { ok: false; message: string } {
  const text = typeof raw === 'string' ? raw.trim() : raw === undefined || raw === null ? '' : null
  if (text === null) {
    return { ok: false, message: `${def.label}必须是文本。` }
  }
  if (def.required && !text) {
    return { ok: false, message: `${def.label}不能为空。` }
  }
  if (def.maxLength !== undefined && text.length > def.maxLength) {
    return { ok: false, message: `${def.label}长度不能超过 ${def.maxLength} 字。` }
  }
  return { ok: true, value: text }
}

/** 单个 select 字段的清洗：值必须在 options 内；缺省回退 defaultValue。 */
function coerceSelectField(
  def: ItemFieldDef,
  raw: unknown
): { ok: true; value: string } | { ok: false; message: string } {
  const options = def.options ?? []
  if (raw === undefined || raw === null || raw === '') {
    if (def.required && !def.defaultValue) {
      return { ok: false, message: `${def.label}不能为空。` }
    }
    return { ok: true, value: def.defaultValue ?? options[0]?.value ?? '' }
  }
  if (typeof raw !== 'string' || !options.some((option) => option.value === raw)) {
    return { ok: false, message: `${def.label}的值「${String(raw)}」不在可选项内。` }
  }
  return { ok: true, value: raw }
}

/** 单个 tags 字段的清洗：字符串数组去重、去空白；非数组报错。 */
function coerceTagsField(
  def: ItemFieldDef,
  raw: unknown
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: [] }
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: `${def.label}必须是字符串数组。` }
  }
  const value = [...new Set(raw.map((tag) => String(tag).trim()).filter(Boolean))]
  if (def.required && value.length === 0) {
    return { ok: false, message: `${def.label}不能为空。` }
  }
  return { ok: true, value }
}

/** 单个 boolean 字段的清洗：接受 boolean 或 'true'/'false' 字符串；缺省回退 defaultValue。 */
function coerceBooleanField(
  def: ItemFieldDef,
  raw: unknown
): { ok: true; value: boolean } | { ok: false; message: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: def.defaultValue === 'true' }
  }
  if (typeof raw === 'boolean') {
    return { ok: true, value: raw }
  }
  if (raw === 'true' || raw === 'false') {
    return { ok: true, value: raw === 'true' }
  }
  return { ok: false, message: `${def.label}必须是布尔值。` }
}

/**
 * 领域校验与清洗（按字段定义动态处理）：
 * - 已定义字段逐个按类型转换与校验，失败返回 { ok:false, field, message }；
 * - **未知 key 且值为 string / number / boolean 时原样透传进 draft**
 *   （「加字段零改动」承诺的核心：表单多提交一个字段不会被白名单丢弃）。
 */
export function coerceDraft(raw: Record<string, unknown>): CoerceDraftResult {
  const source = raw ?? {}
  const draft: Record<string, unknown> = {}

  for (const def of ITEM_FIELD_DEFS) {
    const value = source[def.key]
    let coerced: { ok: true; value: string | string[] | boolean } | { ok: false; message: string }
    switch (def.type) {
      case 'text':
      case 'textarea':
        coerced = coerceTextField(def, value)
        break
      case 'select':
        coerced = coerceSelectField(def, value)
        break
      case 'tags':
        coerced = coerceTagsField(def, value)
        break
      case 'boolean':
        coerced = coerceBooleanField(def, value)
        break
    }
    if (!coerced.ok) {
      return { ok: false, field: def.key, message: coerced.message }
    }
    draft[def.key] = coerced.value
  }

  for (const [key, value] of Object.entries(source)) {
    if (DEFINED_KEYS.has(key)) {
      continue
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      draft[key] = value
    }
  }

  return { ok: true, draft: draft as ItemDraft }
}

/** 剥离 id / createdAt / updatedAt，其余字段（含未来扩展字段）全量保留。 */
function stripMeta(item: Item & Record<string, unknown>): Record<string, unknown> {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = item
  void _id
  void _createdAt
  void _updatedAt
  return rest
}

/** 全字段 draft（含未来扩展字段）：编辑表单回填用。 */
export function toDraft(item: Item): ItemDraft {
  return stripMeta(item as Item & Record<string, unknown>) as ItemDraft
}

/** 克隆用 draft：与 toDraft 同源（duplicate 等路径复用，保证扩展字段不丢）。 */
export function cloneDraft(item: Item): ItemDraft {
  return toDraft(item)
}

/** 局部合并：以条目当前值（含扩展字段）为底，patch 中出现的字段覆盖。 */
export function applyPatch(item: Item, patch: Partial<ItemDraft>): ItemDraft {
  return { ...toDraft(item), ...patch } as ItemDraft
}
