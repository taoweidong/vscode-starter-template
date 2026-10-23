/**
 * Webview 环境全局 API 的最小类型声明（浏览器侧专用）。
 *
 * acquireVsCodeApi 只能调用一次，页面统一经 shared/useVsCodeApi.ts 单例访问。
 * 本文件不引入 @types/vscode（那是宿主侧 Node 环境的类型）。
 */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState<T>(state: T): void
}
