/**
 * Webview 页面注册表（docs/需求与优化方案/03 §5.1，单一来源）。
 *
 * - Vite 构建（vite.config.ts）从本表生成 rollupOptions.input；
 * - 宿主（webviewController.ts）从本表取标题与入口；
 * - 本文件必须保持纯数据：不 import vscode / DOM / Vue，两侧共用。
 *
 * 新增页面 = 本表一项 + apps/<pageId>/ 目录（FR-16-AC2）。
 */
export type WebviewPageId =
  | 'itemForm'
  | 'featureConfig'
  | 'importWizard'
  | 'gallery'
  | 'serialConsole'

export interface WebviewPageDef {
  /** 页面唯一 id，同时是 Vite 入口名与宿主 viewType 后缀 */
  id: WebviewPageId
  /** 面板标题（中文） */
  title: string
  /** Vite 入口（相对仓库根路径），构建与宿主 manifest 解析共用 */
  entry: string
  /**
   * 面板附加选项。
   * retainContextWhenHidden 一律 false（见 03 §5.1 / 05 S5），
   * 页面状态由页面侧经 webview getState/setState 自行持久化。
   */
  panelOptions?: { enableCommandUris?: false }
}

export const WEBVIEW_PAGES: readonly WebviewPageDef[] = [
  { id: 'itemForm', title: '条目表单', entry: 'src/webview/apps/itemForm/main.ts' },
  { id: 'featureConfig', title: '特性配置', entry: 'src/webview/apps/featureConfig/main.ts' },
  { id: 'importWizard', title: '批量导入', entry: 'src/webview/apps/importWizard/main.ts' },
  { id: 'gallery', title: '组件画廊（开发）', entry: 'src/webview/apps/gallery/main.ts' },
  { id: 'serialConsole', title: '串口控制台', entry: 'src/webview/apps/serialConsole/main.ts' },
]

/** 按 id 查页面定义；不存在返回 undefined（调用方需给出清晰错误）。 */
export function findWebviewPage(id: string): WebviewPageDef | undefined {
  return WEBVIEW_PAGES.find((page) => page.id === id)
}
