import type { HostMessage } from '../../../webview/protocol'

/**
 * 页面级组件测试的工具（类型层不依赖 DOM lib：根 tsconfig 仅 ES2022）。
 * 经结构化 cast 访问 jsdom 的 window / MessageEvent / 控件属性，
 * 与既有 vinput.spec 的 `element as { value?: string }` 手法一致。
 */
type WindowLike = {
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void
  removeEventListener(type: string, listener: (event: { data: unknown }) => void): void
  dispatchEvent(event: unknown): boolean
}

export const browserWindow: WindowLike = (globalThis as unknown as { window: WindowLike }).window

/** 模拟宿主 → 页面消息（window message 事件）。 */
export function hostMessage(message: HostMessage): void {
  const MessageEventCtor = (
    globalThis as unknown as {
      MessageEvent: new (type: string, init: { data: unknown }) => unknown
    }
  ).MessageEvent
  browserWindow.dispatchEvent(new MessageEventCtor('message', { data: message }))
}

/** 输入类控件的 value。 */
export function inputValue(element: unknown): string {
  return String((element as { value?: unknown }).value ?? '')
}

/** 复选框的 checked。 */
export function inputChecked(element: unknown): boolean {
  return (element as { checked?: unknown }).checked === true
}

/** 按钮的 disabled。 */
export function buttonDisabled(element: unknown): boolean {
  return (element as { disabled?: unknown }).disabled === true
}
