import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useFormPage, type FormPageOptions } from '../../../webview/composables/useFormPage'
import { stableStringify } from '../../../webview/shared/stableStringify'
import { __setVsCodeApiForTest, type VsCodeApi } from '../../../webview/shared/useVsCodeApi'
import type { HostMessage } from '../../../webview/protocol'
import { browserWindow, hostMessage } from './appTestUtils'

/**
 * useFormPage（C-6）与 stableStringify（C-7）：
 * 表单页公共编排（消息监听 / ready 上报 / init·submitAck·error 分发 / 生命周期清理）
 * 与按键排序的稳定序列化。vscode api 经 __setVsCodeApiForTest 注入 mock。
 */

function createApiMock() {
  const api: VsCodeApi & { posted: unknown[] } = {
    posted: [],
    postMessage(message: unknown): void {
      this.posted.push(message)
    },
    getState<T>(): T | undefined {
      return undefined
    },
    setState(_state: unknown): void {},
  }
  return api
}

/** 绕过 isHostMessage 守卫的噪声消息（null / 非对象 / 未知 type）。 */
function rawMessage(data: unknown): void {
  const MessageEventCtor = (
    globalThis as unknown as {
      MessageEvent: new (type: string, init: { data: unknown }) => unknown
    }
  ).MessageEvent
  browserWindow.dispatchEvent(new MessageEventCtor('message', { data }))
}

/** 以宿主组件承载 useFormPage（onMounted / onBeforeUnmount 需要组件上下文）。 */
function mountPage(options: FormPageOptions) {
  let page: ReturnType<typeof useFormPage> | undefined
  const Harness = defineComponent({
    setup() {
      page = useFormPage(options)
      return {}
    },
    render() {
      return h('div')
    },
  })
  const wrapper = mount(Harness)
  if (!page) {
    throw new Error('useFormPage 未在 setup 中执行')
  }
  return { wrapper, page }
}

const INIT: HostMessage = { type: 'init', page: 'test', schema: [], value: null }

let api: ReturnType<typeof createApiMock>

beforeEach(() => {
  api = createApiMock()
  __setVsCodeApiForTest(api)
})

afterEach(() => {
  __setVsCodeApiForTest(undefined)
})

describe('stableStringify：按键排序的稳定序列化（C-7）', () => {
  it('键序不同但值相同 → 序列化结果一致', () => {
    expect(stableStringify({ name: 'A', priority: 'high' })).toBe(
      stableStringify({ priority: 'high', name: 'A' })
    )
  })

  it('值不同 → 序列化结果不同', () => {
    expect(stableStringify({ name: 'A' })).not.toBe(stableStringify({ name: 'B' }))
    expect(stableStringify({ a: 1, b: 2 })).not.toBe(stableStringify({ a: 2, b: 1 }))
  })

  it('嵌套对象与数组：深层键序无关，数组保序', () => {
    const left = { draft: { name: 'A', tags: ['x', 'y'], meta: { b: 2, a: 1 } } }
    const right = { draft: { meta: { a: 1, b: 2 }, tags: ['x', 'y'], name: 'A' } }
    expect(stableStringify(left)).toBe(stableStringify(right))
    expect(stableStringify({ tags: ['x', 'y'] })).not.toBe(stableStringify({ tags: ['y', 'x'] }))
  })

  it('标量与 null 的 JSON 语义（undefined 归一为 null）', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(undefined)).toBe('null')
    expect(stableStringify('文本')).toBe('"文本"')
    expect(stableStringify(7)).toBe('7')
  })
})

describe('useFormPage：宿主消息编排（C-6）', () => {
  it('挂载后上报 ready', () => {
    const { wrapper } = mountPage({ onInit: () => undefined })
    expect(api.posted).toEqual([{ type: 'ready' }])
    wrapper.unmount()
  })

  it('init 消息 → onInit 收到消息体且 initialized 置 true', () => {
    const onInit = vi.fn()
    const { wrapper, page } = mountPage({ onInit })
    expect(page.initialized.value).toBe(false)
    hostMessage(INIT)
    expect(onInit).toHaveBeenCalledTimes(1)
    expect(onInit.mock.calls[0][0]).toMatchObject({ type: 'init', page: 'test' })
    expect(page.initialized.value).toBe(true)
    wrapper.unmount()
  })

  it('噪声消息（null / 非对象 / 未知 type）被守卫拒绝，不触发回调', () => {
    const onInit = vi.fn()
    const onError = vi.fn()
    const { wrapper } = mountPage({ onInit, onError })
    rawMessage(null)
    rawMessage('文本')
    rawMessage({ type: 'unknown-type' })
    expect(onInit).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('与本页无关的宿主消息（selectFolder / import*）不触发任何回调', () => {
    const onInit = vi.fn()
    const onError = vi.fn()
    const { wrapper } = mountPage({ onInit, onError })
    hostMessage({ type: 'selectFolder', folder: null })
    hostMessage({ type: 'importProgress', done: 1, total: 2 })
    expect(onInit).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('submitAck → submitting 复位 false、hostError 清空、onSubmitAck 调用', () => {
    const onSubmitAck = vi.fn()
    const { wrapper, page } = mountPage({ onInit: () => undefined, onSubmitAck })
    page.submitting.value = true
    page.hostError.value = '旧错误'
    hostMessage({ type: 'submitAck', ok: true })
    expect(page.submitting.value).toBe(false)
    expect(page.hostError.value).toBe('')
    expect(onSubmitAck).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('error → submitting 复位 false 且 onError 收到消息体（分流由页面决定）', () => {
    const onError = vi.fn()
    const { wrapper, page } = mountPage({ onInit: () => undefined, onError })
    page.submitting.value = true
    hostMessage({ type: 'error', message: '写入失败', field: 'name' })
    expect(page.submitting.value).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ type: 'error', message: '写入失败' })
    wrapper.unmount()
  })

  it('onError / onSubmitAck 缺省时消息处理不抛错', () => {
    const { wrapper } = mountPage({ onInit: () => undefined })
    expect(() => {
      hostMessage({ type: 'submitAck', ok: true })
      hostMessage({ type: 'error', message: 'x' })
    }).not.toThrow()
    wrapper.unmount()
  })
})

describe('useFormPage：生命周期清理（C-6）', () => {
  it('卸载时调用 onUnmount（页面借此清理草稿防抖定时器）', () => {
    const onUnmount = vi.fn()
    const { wrapper } = mountPage({ onInit: () => undefined, onUnmount })
    wrapper.unmount()
    expect(onUnmount).toHaveBeenCalledTimes(1)
  })

  it('卸载后移除 window 消息监听（再发 init 不触发 onInit）', () => {
    const onInit = vi.fn()
    const { wrapper } = mountPage({ onInit })
    hostMessage(INIT)
    expect(onInit).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    hostMessage(INIT)
    expect(onInit).toHaveBeenCalledTimes(1)
  })
})
