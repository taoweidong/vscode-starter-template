/**
 * tags 字段的解析 / 回显工具（04 §4.10）。
 *
 * 分隔符沿用旧版语义：英文逗号、中文逗号、英文分号、中文分号、顿号；
 * 解析结果去空白、去空项、去重，顺序保留首次出现。
 */

/** tags 输入的分隔符集合。 */
const TAG_SEPARATORS = /[,，;；、]/

/** 文本 → 标签数组（解析输入框内容；空项与重复项剔除）。 */
export function parseTags(input: string): string[] {
  const parts = input
    .split(TAG_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return [...new Set(parts)]
}

/** 标签数组 → 文本（回显到输入框；非数组值原样透传字符串）。 */
export function joinTags(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag)).join(', ')
  }
  return typeof value === 'string' ? value : ''
}
