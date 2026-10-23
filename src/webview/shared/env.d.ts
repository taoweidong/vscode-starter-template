/**
 * Webview 浏览器侧的环境类型声明：
 * - vite/client 提供样式表（*.css）等模块声明，供 main.ts 直接 import 样式；
 * - acquireVsCodeApi 全局声明见 src/webview/vscode.d.ts。
 */
/// <reference types="vite/client" />
