/**
 * 根 tsconfig（无 Vue 语言服务）下 .vue 模块的最小类型声明：
 * 组件测试（src/test/unit/webview/**）import SFC 时由本文件兜底；
 * Webview 侧的完整类型检查走 `vue-tsc -p tsconfig.webview.json`。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, any>, Record<string, any>, unknown>
  export default component
}
