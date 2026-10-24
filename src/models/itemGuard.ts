import { createId, isPriority, type Item } from './item'
import { ITEM_FIELD_DEFS } from '../domain/itemSchema'

/**
 * T1.3（P1-04）：条目加载守卫。
 *
 * 数据文件 / Memento 中的内容可能被手工改坏（tags 非数组、priority 非法、缺 id 等），
 * 一旦流入缓存会导致树视图渲染抛错、保存时写回坏数据。
 * 本模块在「存储层 load」时对每条记录做运行时校验：
 * - 合法但缺字段 → 补默认值（警告说明被改写的字段）；
 * - 结构性坏条目 → 跳过并上报（不进结果集）。
 *
 * T5.1（P0-04）：**未知字段（不在字段定义表内的 key）值为 string / number / boolean
 * 时原样透传**——与领域校验 coerceDraft 同一策略，保证「加字段」全链路（含落盘往返）
 * 不丢数据；不支持保留的类型（对象 / 数组等）丢弃并告警。
 */

/** 单条规范化结果。 */
export type NormalizedItemResult =
  { ok: true; item: Item; warnings: string[] } | { ok: false; reason: string }

/** 系统元字段（id 与时间戳，不属于业务 draft 字段）。 */
const META_KEYS = new Set(['id', 'createdAt', 'updatedAt'])
/** 领域字段定义表中的 key（src/domain/itemSchema.ts 单一来源）。 */
const DEFINED_KEYS = new Set(ITEM_FIELD_DEFS.map((def) => def.key))

/** 最小条目判定：非空对象且 name 为非空字符串（trim 后仍非空）。 */
export function isItemLike(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { name?: unknown }).name === 'string' &&
    (value as { name: string }).name.trim().length > 0
  )
}

/**
 * 规范化单条记录：非法值改写并给出警告；结构性缺失补默认值。
 * @param index 条目在原数组中的序号（用于警告/失败原因定位，从 0 起）
 */
export function normalizeItem(value: unknown, index: number): NormalizedItemResult {
  if (!isItemLike(value)) {
    return { ok: false, reason: `第 ${index + 1} 条不是有效条目（需要非空 name 字段），已跳过。` }
  }
  const at = `第 ${index + 1} 条`
  const warnings: string[] = []
  const now = new Date().toISOString()

  const readString = (key: 'category' | 'description', fallback = ''): string => {
    const raw = value[key]
    if (raw === undefined || raw === null) return fallback
    if (typeof raw !== 'string') {
      warnings.push(`${at}：${key} 不是字符串，已${fallback === '' ? '置空' : '改写'}。`)
      return fallback
    }
    return raw.trim()
  }

  let priority: Item['priority']
  if (value.priority === undefined || value.priority === null) {
    priority = 'medium'
  } else if (isPriority(value.priority)) {
    priority = value.priority
  } else {
    priority = 'medium'
    warnings.push(`${at}：priority「${String(value.priority)}」非法，已回退为 medium。`)
  }

  let tags: string[]
  if (value.tags === undefined || value.tags === null) {
    tags = []
  } else if (Array.isArray(value.tags)) {
    const source = value.tags as unknown[]
    tags = source
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (tags.length !== source.length) {
      warnings.push(
        `${at}：tags 含非字符串或空白项，已过滤（丢弃 ${source.length - tags.length} 项）。`
      )
    }
  } else {
    tags = []
    warnings.push(`${at}：tags 不是数组，已置空。`)
  }

  let id: string
  if (typeof value.id === 'string' && value.id.trim()) {
    id = value.id
  } else {
    id = createId()
    if (value.id !== undefined && value.id !== null) {
      warnings.push(`${at}：id 不是非空字符串，已重新生成。`)
    }
  }

  const readTimestamp = (key: 'createdAt' | 'updatedAt'): string => {
    const raw = value[key]
    // R-C-9：除「非空字符串」外还要求 Date.parse 可解析——
    // "昨天" 之类可通过旧守卫，渲染时 new Date(...).toLocaleString() 产出 "Invalid Date"
    if (typeof raw === 'string' && raw.trim() && !Number.isNaN(Date.parse(raw))) {
      return raw
    }
    if (raw !== undefined && raw !== null) {
      warnings.push(`${at}：${key} 不是合法日期，已补当前时间。`)
    }
    return now
  }

  // T5.1（P0-04）：未知字段透传——string / number / boolean 原样保留（加字段零丢失），
  // 其余类型不支持保留，丢弃并告警（避免坏结构流入缓存）。
  const extras: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (META_KEYS.has(key) || DEFINED_KEYS.has(key)) {
      continue
    }
    const raw = value[key]
    if (raw === undefined || raw === null) {
      continue
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      extras[key] = raw
    } else {
      warnings.push(
        `${at}：扩展字段 ${key} 的类型（${Array.isArray(raw) ? 'array' : typeof raw}）不支持保留，已丢弃。`
      )
    }
  }

  return {
    ok: true,
    item: {
      id,
      name: (value.name as string).trim(),
      category: readString('category'),
      description: readString('description'),
      priority,
      tags,
      createdAt: readTimestamp('createdAt'),
      updatedAt: readTimestamp('updatedAt'),
      ...extras,
    },
    warnings,
  }
}

/**
 * 规范化整表：逐条 normalize，坏条目跳过、重复 id 保留首个，全部经 onWarning 上报。
 * 存储层（JsonFileStore / MementoStore）load 时统一走这里。
 */
export function normalizeItemList(
  values: unknown[],
  onWarning?: (message: string) => void
): Item[] {
  const items: Item[] = []
  const seenIds = new Set<string>()
  for (let index = 0; index < values.length; index += 1) {
    const result = normalizeItem(values[index], index)
    if (!result.ok) {
      onWarning?.(result.reason)
      continue
    }
    if (seenIds.has(result.item.id)) {
      onWarning?.(
        `第 ${index + 1} 条与前面的条目 id「${result.item.id}」重复，已保留首个并跳过本条。`
      )
      continue
    }
    seenIds.add(result.item.id)
    for (const warning of result.warnings) {
      onWarning?.(warning)
    }
    items.push(result.item)
  }
  return items
}
