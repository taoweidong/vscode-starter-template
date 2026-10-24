import { describe, expect, it } from 'vitest'
import { escapeMarkdownInline } from '../../../ui/markdown'

/**
 * R-C-8：escapeMarkdownInline 抽到 src/ui/markdown.ts（无 vscode 依赖）后的单一来源 spec。
 * 用例自 commands.spec.ts 迁移（C-12 反斜杠转义修复的复现与回归保留在此）。
 */
describe('escapeMarkdownInline（C-12：反斜杠必须一并转义）', () => {
  it('六个行内特殊字符均前置反斜杠', () => {
    expect(escapeMarkdownInline('\\')).toBe('\\\\')
    expect(escapeMarkdownInline('*')).toBe('\\*')
    expect(escapeMarkdownInline('_')).toBe('\\_')
    expect(escapeMarkdownInline('`')).toBe('\\`')
    expect(escapeMarkdownInline('[')).toBe('\\[')
    expect(escapeMarkdownInline(']')).toBe('\\]')
  })

  it('修复前 `a\\*b` 中的字面反斜杠会被当成转义符吞掉（复现用例）', () => {
    // 旧正则 /([*_`[\]])/g 不匹配 \：a\*b → a\*b（星号被转义、反斜杠丢失），渲染错乱
    expect(escapeMarkdownInline('a\\*b')).toBe('a\\\\\\*b')
  })

  it('混合文本逐字符转义，不重复处理已转义序列', () => {
    expect(escapeMarkdownInline('修复 \\ 转义_[x]`')).toBe('修复 \\\\ 转义\\_\\[x\\]\\`')
  })
})
