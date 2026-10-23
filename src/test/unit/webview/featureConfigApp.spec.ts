import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import App from '../../../webview/apps/featureConfig/App.vue'
import { __setVsCodeApiForTest, type VsCodeApi } from '../../../webview/shared/useVsCodeApi'
import { toFeatureFormFields } from '../../../features/featureConfig/featureFlags'
import { toFieldDefs } from '../../../webview/formSchema'
import { buttonDisabled, hostMessage, inputChecked } from './appTestUtils'

/**
 * 特性配置页（M4-T4.3，FR-12 AC4）：回显 / dirty / 保存流（部分失败保持打开）。
 */

const SCHEMA = toFieldDefs(toFeatureFormFields())

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

let api: ReturnType<typeof createApiMock>
let wrapper: VueWrapper | undefined

beforeEach(() => {
  api = createApiMock()
  __setVsCodeApiForTest(api)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  __setVsCodeApiForTest(undefined)
})

function mountApp(): VueWrapper {
  wrapper = mount(App)
  return wrapper
}

function saveButton() {
  return wrapper!.findAll('button').find((button) => button.text() === '保存')!
}

describe('featureConfig：回显与 dirty', () => {
  it('挂载后上报 ready；init 回显开关当前值', async () => {
    mountApp()
    expect(api.posted).toEqual([{ type: 'ready' }])
    hostMessage({
      type: 'init',
      page: 'featureConfig',
      schema: SCHEMA,
      value: { confirmDelete: true, successNotifications: false },
    })
    await vi.waitFor(() => {
      expect(wrapper!.findAll('input[type="checkbox"]').length).toBe(SCHEMA.length)
    })
    const checked = wrapper!
      .findAll('input[type="checkbox"]')
      .map((box) => inputChecked(box.element))
    expect(checked[0]).toBe(true) // confirmDelete
    expect(checked[1]).toBe(false) // successNotifications
  })

  it('切换开关上报 dirty；保存成功（submitAck）后复位', async () => {
    mountApp()
    hostMessage({ type: 'init', page: 'featureConfig', schema: SCHEMA, value: {} })
    await vi.waitFor(() => {
      expect(wrapper!.findAll('input[type="checkbox"]').length).toBe(SCHEMA.length)
    })
    api.posted.length = 0
    // 开关默认全开：关掉第一个开关构成真实改动
    await wrapper!.findAll('input[type="checkbox"]')[0].setValue(false)
    await vi.waitFor(() => {
      expect(api.posted).toContainEqual({ type: 'dirty', dirty: true })
    })
    // 改回默认值 → 回到干净状态
    await wrapper!.findAll('input[type="checkbox"]')[0].setValue(true)
    await vi.waitFor(() => {
      expect(api.posted).toContainEqual({ type: 'dirty', dirty: false })
    })

    const save = saveButton()
    await save.trigger('click')
    const submit = api.posted.find((m) => (m as { type: string }).type === 'submit') as {
      draft: Record<string, unknown>
    }
    expect(submit.draft.confirmDelete).toBe(true)
    hostMessage({ type: 'submitAck', ok: true })
    await vi.waitFor(() => {
      expect(api.posted).toContainEqual({ type: 'dirty', dirty: false })
    })
  })
})

describe('featureConfig：保存流（allSettled 语义的页面侧表现）', () => {
  it('部分失败：error 消息展示失败开关，保存按钮恢复可点（面板保持打开）', async () => {
    mountApp()
    hostMessage({ type: 'init', page: 'featureConfig', schema: SCHEMA, value: {} })
    await vi.waitFor(() => {
      expect(wrapper!.findAll('input[type="checkbox"]').length).toBe(SCHEMA.length)
    })
    await saveButton().trigger('click')
    // 在途：按钮禁用
    expect(buttonDisabled(saveButton().element)).toBe(true)

    hostMessage({
      type: 'error',
      message: '部分开关保存失败：删除前确认、显示视图徽标。请重试或检查 VSCode 设置权限。',
    })
    await vi.waitFor(() => {
      expect(wrapper!.find('.feature-config__error').text()).toContain('部分开关保存失败')
    })
    expect(buttonDisabled(saveButton().element)).toBe(false)
  })

  it('取消按钮 → postMessage cancel', async () => {
    mountApp()
    hostMessage({ type: 'init', page: 'featureConfig', schema: SCHEMA, value: {} })
    await vi.waitFor(() => {
      expect(wrapper!.findAll('input[type="checkbox"]').length).toBe(SCHEMA.length)
    })
    api.posted.length = 0
    const cancel = wrapper!.findAll('button').find((button) => button.text() === '取消')!
    await cancel.trigger('click')
    expect(api.posted).toContainEqual({ type: 'cancel' })
  })
})
