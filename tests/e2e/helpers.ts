import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Locator, Page } from 'playwright/test'
import { expect } from 'playwright/test'

/**
 * Webview 页面 E2E 公共设施。
 *
 * - loadPage：在任何页面模块执行前注入 acquireVsCodeApi mock（单例语义：
 *   postMessage 记录到 window.__sent、getState 读 window.__state、setState 写回）
 *   与一组 --vscode-* 主题变量（从 src/webview/ui/tokens.css 的回退值解析，
 *   经 CSSOM 注入以适配 harness 的宿主级 CSP），再打开 /harness/:pageId 并等待 Vue 挂载；
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

/**
 * 主题变量：从 src/webview/ui/tokens.css 的**回退值**解析而来（07 R-E-16）。
 * 此前本文件手抄了第三份 --vscode-* 副本，tokens.css 改颜色后 e2e 主题不同步；
 * 现在单一来源是 tokens.css 的 `var(--vscode-x, <fallback>)` 回退值。
 */
const TOKENS_CSS_PATH = resolve(process.cwd(), 'src/webview/ui/tokens.css')

function parseThemeFallbacks(): Record<string, string> {
  const css = readFileSync(TOKENS_CSS_PATH, 'utf8')
  const theme: Record<string, string> = {}
  for (const line of css.split(/\r?\n/)) {
    const head = /^\s*--ui-[a-z0-9-]+\s*:\s*var\(\s*(--vscode-[A-Za-z0-9-]+)\s*,/.exec(line)
    if (!head) {
      continue
    }
    // 回退值里可能还嵌着一层 var(...)（如 --ui-surface），按括号配平截取
    const rest = line.slice(head[0].length)
    let depth = 1
    let end = 0
    for (; end < rest.length; end++) {
      if (rest[end] === '(') {
        depth += 1
      } else if (rest[end] === ')' && --depth === 0) {
        break
      }
    }
    const fallback = rest.slice(0, end).trim()
    if (fallback) {
      theme[head[1]] = fallback
    }
  }
  return theme
}

/** acquireVsCodeApi mock + 主题变量。必须在页面模块执行前注入（addInitScript）。 */
const INIT_SCRIPT = `
  window.__sent = [];
  window.__state = undefined;
  window.__vscodeApiMock = {
    postMessage(message) { window.__sent.push(message); },
    getState() { return window.__state; },
    setState(state) { window.__state = state; }
  };
  window.acquireVsCodeApi = function () { return window.__vscodeApiMock; };
  // R-E-11：harness 与宿主同 CSP（style-src 无 'unsafe-inline'）——
  // <style> 元素与 style="" 属性都会被静默拦截，主题变量必须走 CSSOM setProperty。
  var THEME = ${JSON.stringify(parseThemeFallbacks())};
  var root = document.documentElement;
  for (var name in THEME) { root.style.setProperty(name, THEME[name]); }
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
