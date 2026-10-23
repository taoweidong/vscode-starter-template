import type { Locator, Page } from 'playwright/test'
import { expect } from 'playwright/test'

/**
 * Webview 页面 E2E 公共设施。
 *
 * - loadPage：在任何页面模块执行前注入 acquireVsCodeApi mock（单例语义：
 *   postMessage 记录到 window.__sent、getState 读 window.__state、setState 写回）
 *   与一组 --vscode-* 主题变量（Dark+ 近似值，令组件拿到真实主题外观），
 *   再打开 /harness/:pageId 并等待 Vue 挂载；
 * - sendHost：按宿主行为在 window 上派发 message 事件（页面经 window 'message' 监听）；
 * - sent / lastSent：读取页面向宿主发出的消息记录；
 * - fieldControl：按字段 label 定位 SchemaForm 内的控件
 *   （VFormField 自动生成控件 id：v-field-N，与字段 key 无关，故经 label 关联定位）。
 */

export const BASE_URL = 'http://127.0.0.1:3999'

export type SentMessage = { type: string } & Record<string, unknown>

declare global {
  interface Window {
    __sent?: SentMessage[]
    __state?: unknown
  }
}

/** acquireVsCodeApi mock + 主题变量（Dark+ 近似）。必须在模块执行前注入。 */
const INIT_SCRIPT = `
  window.__sent = [];
  window.__state = undefined;
  window.__vscodeApiMock = {
    postMessage(message) { window.__sent.push(message); },
    getState() { return window.__state; },
    setState(state) { window.__state = state; }
  };
  window.acquireVsCodeApi = function () { return window.__vscodeApiMock; };
  var themeStyle = document.createElement('style');
  themeStyle.textContent = ':root{'
    + '--vscode-foreground:#cccccc;'
    + '--vscode-descriptionForeground:#cccccc99;'
    + '--vscode-disabledForeground:rgba(204,204,204,0.6);'
    + '--vscode-list-activeSelectionForeground:#ffffff;'
    + '--vscode-list-inactiveSelectionForeground:#cccccc;'
    + '--vscode-editor-background:#1e1e1e;'
    + '--vscode-editorWidget-background:#252526;'
    + '--vscode-editorWidget-border:#454545;'
    + '--vscode-list-hoverBackground:rgba(128,128,128,0.12);'
    + '--vscode-list-activeSelectionBackground:#04395e;'
    + '--vscode-widget-border:#454545;'
    + '--vscode-panel-border:#454545;'
    + '--vscode-input-background:#3c3c3c;'
    + '--vscode-input-foreground:#cccccc;'
    + '--vscode-input-border:transparent;'
    + '--vscode-input-placeholderForeground:#989898;'
    + '--vscode-button-background:#0e639c;'
    + '--vscode-button-foreground:#ffffff;'
    + '--vscode-button-hoverBackground:#1177bb;'
    + '--vscode-button-secondaryBackground:#3a3d41;'
    + '--vscode-button-secondaryForeground:#ffffff;'
    + '--vscode-button-secondaryHoverBackground:#45494e;'
    + '--vscode-focusBorder:#007fd4;'
    + '--vscode-errorForeground:#f48771;'
    + '--vscode-inputValidation-errorBorder:#be1100;'
    + '--vscode-inputValidation-errorBackground:#5a1d1d;'
    + '--vscode-checkbox-background:#3c3c3c;'
    + '--vscode-checkbox-border:#3c3c3c;'
    + '--vscode-checkbox-foreground:#cccccc;'
    + '--vscode-checkbox-select-background:#0e639c;'
    + '--vscode-badge-background:#4d4d4d;'
    + '--vscode-badge-foreground:#ffffff;'
    + '--vscode-textLink-foreground:#3794ff;'
    + '--vscode-textLink-activeForeground:#3794ff;'
    + '--vscode-keybindingLabel-border:rgba(204,204,204,0.4);'
    + '--vscode-keybindingLabel-background:rgba(128,128,128,0.17);'
    + '--vscode-keybindingLabel-foreground:#cccccc;'
    + '--vscode-font-family:system-ui,\\'Segoe UI\\',sans-serif;'
    + '--vscode-font-size:13px;'
    + '}';
  document.documentElement.prepend(themeStyle);
`

/** 打开 /harness/:pageId 并等待 Vue 挂载出 AppShell。addInitScript 对后续导航同样生效。 */
export async function loadPage(page: Page, pageId: string): Promise<void> {
  await page.addInitScript({ content: INIT_SCRIPT })
  await page.goto(`${BASE_URL}/harness/${pageId}`)
  await page.locator('#app .app-shell').first().waitFor()
}

/** 模拟宿主下发消息：在 window 上派发 MessageEvent（页面监听 window 'message'）。 */
export async function sendHost(page: Page, message: unknown): Promise<void> {
  await page.evaluate((payload) => {
    window.dispatchEvent(new MessageEvent('message', { data: payload }))
  }, message)
}

/** 页面已向宿主发出的全部消息（按发送顺序）。 */
export async function sent(page: Page): Promise<SentMessage[]> {
  return page.evaluate(() => window.__sent ?? [])
}

/** 页面发出的最后一条消息（尚未发出时为 undefined）。 */
export async function lastSent(page: Page): Promise<SentMessage | undefined> {
  const messages = await sent(page)
  return messages[messages.length - 1]
}

/** 轮询等待最后一条消息的 type（DOM / 消息记录的时序由 expect.poll 兜底）。 */
export async function expectLastSentType(page: Page, type: string): Promise<void> {
  await expect.poll(async () => (await lastSent(page))?.type, { timeout: 5_000 }).toBe(type)
}

/**
 * 按字段 label 定位 SchemaForm 字段控件（input / textarea / select）。
 * 一个字段容器内只有一个控件（VFormField 包裹一个字段组件）。
 */
export function fieldControl(page: Page, label: string): Locator {
  return page
    .locator('.v-form-field')
    .filter({ has: page.locator('.v-form-field__label', { hasText: label }) })
    .locator('input, textarea, select')
}
