import { describe, expect, it } from 'vitest'
import {
  __setVsCodeApiForTest,
  useVsCodeApi,
  type VsCodeApi,
} from '../../../webview/shared/useVsCodeApi'

/** useVsCodeApi 单例（03 §9：acquireVsCodeApi 只能调用一次）。 */
describe('useVsCodeApi', () => {
  it('无 acquireVsCodeApi 环境抛清晰错误（提示注入 mock）', () => {
    __setVsCodeApiForTest(undefined)
    expect(() => useVsCodeApi()).toThrow(/acquireVsCodeApi.*__setVsCodeApiForTest/)
  })

  it('重复调用返回同一实例（模块级单例）', () => {
    const fake: VsCodeApi = {
      postMessage: () => undefined,
      getState: () => undefined,
      setState: () => undefined,
    }
    __setVsCodeApiForTest(fake)
    expect(useVsCodeApi()).toBe(fake)
    expect(useVsCodeApi()).toBe(fake)
    __setVsCodeApiForTest(undefined)
  })
})
