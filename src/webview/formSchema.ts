import { ITEM_FIELD_DEFS, type ItemFieldDef } from '../domain/itemSchema'
import type { FieldDef } from './protocol'

/**
 * 表单字段 Schema：由领域 Schema（src/domain/itemSchema.ts 的 ITEM_FIELD_DEFS）
 * **派生**而来，本文件不再手写字段清单。
 *
 * 「给条目加字段」= 在 ITEM_FIELD_DEFS 加一行定义（可选地同步 Item / ItemDraft
 * 模型类型以获得更强的类型提示），表单渲染、取值、回填、校验全部自动跟随
 * （详见 README「如何扩展」）。同一套框架也被「特性配置」页面复用（boolean
 * 开关字段，见 src/features/featureConfig）。
 */
export type FormFieldType = 'text' | 'textarea' | 'select' | 'tags' | 'boolean'

export interface FormField {
  /** 对应 ItemDraft 的字段名 */
  key: string
  label: string
  type: FormFieldType
  required?: boolean
  placeholder?: string
  /** 字段下方的说明文字 */
  hint?: string
  /** select 类型的默认值 */
  defaultValue?: string
  /** select 类型的选项 */
  options?: { value: string; label: string }[]
  /**
   * 该字段需要「输入建议列表」的标记（text 输入的自动补全提示）。
   * 值只作标记用、不是 DOM id —— datalist 元素的真实 id 由页面用 useId 派生（R-U-7），
   * 避免固定 id 在多实例面板下重复。
   */
  datalist?: string
}

/**
 * UI 层附加属性（按字段 key 声明式叠加）：datalist 这类「页面渲染行为」属于
 * Webview 层关切，不进领域定义（领域只描述数据与校验）。
 * 当前唯一条目：分类输入建议（datalist 元素由条目表单页持有，选项来自宿主
 * 下发的已有分类列表）。值为标记，页面据此决定是否渲染 datalist 并派生唯一 DOM id。
 */
const UI_FIELD_EXTRAS: Record<string, Partial<FormField>> = {
  category: { datalist: 'category-list' },
}

/**
 * 领域字段定义 → 表单字段（ItemFieldDef 与 FormField 结构同构，逐属性显式拷贝，
 * 避免把 domain 类型直接引入 Webview 类型程序的 import 面）。
 * 加字段只需扩展 ITEM_FIELD_DEFS，本函数与表单页零改动。
 */
export function deriveFormSchema(defs: readonly ItemFieldDef[]): FormField[] {
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    type: def.type,
    required: def.required,
    placeholder: def.placeholder,
    hint: def.hint,
    defaultValue: def.defaultValue,
    options: def.options?.map((option) => ({ ...option })),
    ...UI_FIELD_EXTRAS[def.key],
  }))
}

/** 条目表单 Schema：领域 Schema 的表单视图（单一来源见 src/domain/itemSchema.ts）。 */
export const FORM_SCHEMA: FormField[] = deriveFormSchema(ITEM_FIELD_DEFS)

/**
 * FormField[] → 协议 FieldDef[]（宿主组装 init 载荷用）。
 * 逐字段拷贝到匿名对象字面量，使结构类型获得隐式索引签名（接口直赋会缺索引签名）。
 */
export function toFieldDefs(schema: FormField[]): FieldDef[] {
  return schema.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder,
    hint: field.hint,
    defaultValue: field.defaultValue,
    options: field.options?.map((option) => ({ ...option })),
    datalist: field.datalist,
  }))
}
