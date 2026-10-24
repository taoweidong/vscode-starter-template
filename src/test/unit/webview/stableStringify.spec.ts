import { describe, expect, it } from 'vitest'
import { stableStringify } from '../../../webview/shared/stableStringify'

/**
 * 稳定序列化：dirty 比较不受对象键序影响（原覆盖来自已删除的 useFormPage.spec，
 * 09 方案阶段 2 后独立成文）。
 */
describe('stableStringify', () => {
  it('对象按键排序输出（键序不同 → 结果一致）', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('嵌套结构与数组递归处理', () => {
    expect(stableStringify({ z: { y: 1, x: [2, { b: 3, a: 4 }] } })).toBe(
      '{"z":{"x":[2,{"a":4,"b":3}],"y":1}}'
    )
    expect(stableStringify([3, 1, { b: null, a: true }])).toBe('[3,1,{"a":true,"b":null}]')
  })

  it('原始值与 null：走 JSON.stringify；undefined 归一为 "null"', () => {
    expect(stableStringify('x')).toBe('"x"')
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(undefined)).toBe('null')
  })
})
