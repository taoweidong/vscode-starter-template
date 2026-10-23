/**
 * acquireVsCodeApi 的模块级单例封装（docs/需求与优化方案/03 §9 风险表）。
 *
 * VSCode 注入的 acquireVsCodeApi 每个面板只能调用一次（重复调用抛错），
 * 因此所有页面与组件一律经 useVsCodeApi() 获取同一实例，禁止直接调用全局函数。
 * 测试环境无该全局函数时抛出清晰错误；单测可经 __setVsCodeApiForTest 注入 mock。
 */

/** 与 src/webview/vscode.d.ts 中 acquireVsCodeApi 返回值保持一致的最小接口。 */
export interface VsCodeApi {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState<T>(state: T): void
}

let instance: VsCodeApi | undefined

export function useVsCodeApi(): VsCodeApi {
  if (instance) {
    return instance
  }
  const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi
  if (typeof acquire !== 'function') {
    throw new Error(
      '未找到 acquireVsCodeApi：当前不在 VSCode Webview 环境。' +
        '单元测试请先调用 __setVsCodeApiForTest 注入 mock 实例。'
    )
  }
  instance = acquire()
  return instance
}

/** 单测专用：注入/清除 mock 实例（传 undefined 恢复未初始化状态）。 */
export function __setVsCodeApiForTest(api: VsCodeApi | undefined): void {
  instance = api
}
