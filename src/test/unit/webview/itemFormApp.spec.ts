import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import App from '../../../webview/apps/itemForm/App.vue'
import { __setVsCodeApiForTest, type VsCodeApi } from '../../../webview/shared/useVsCodeApi'
import { FORM_SCHEMA, toFieldDefs } from '../../../webview/formSchema'
import type { FieldDef } from '../../../webview/protocol'
import { buttonDisabled, hostMessage, inputValue } from './appTestUtils'

/**
 * 条目表单页（M4-T4.2）：三模式回填 / 草稿持久化与恢复 / dirty 上报 / 提交与错误分流。
 * vscode api 经 __setVsCodeApiForTest 注入 mock；宿主消息经 window message 事件下发。
 */

const SCHEMA: FieldDef[] = toFieldDefs(FORM_SCHEMA)

function createApiMock(initialState: unknown = undefined) {
  const api: VsCodeApi & { posted: unknown[]; state: unknown } = {
    posted: [],
    state: initialState,
    postMessage(message: unknown): void {
      this.posted.push(message)
    },
    getState<T>(): T | undefined {
      return this.state as T | undefined
    },
    setState<T>(state: T): void {
      this.state = state
    },
  }
  return api
}

function initMessage(payload: {
  value: unknown
  mode?: string
  itemId?: string
  categories?: string[]
  persisted?: unknown
}): void {
  const extra: Record<string, unknown> = { mode: payload.mode ?? 'create' }
  if (payload.itemId !== undefined) {
    extra.itemId = payload.itemId
  }
  extra.categories = payload.categories ?? []
  if (payload.persisted !== undefined) {
    extra.persisted = payload.persisted
  }
  hostMessage({ type: 'init', page: 'itemForm', schema: SCHEMA, value: payload.value, extra })
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

/** 名称输入框 DOM（结构化读取 value，避免 DOM lib 类型）。 */
function nameInput(): unknown {
  return mountTarget().findAll('input[type="text"]')[0].element
}

function nameValue(): string {
  return inputValue(nameInput())
}

function mountTarget(): VueWrapper {
  if (!wrapper) {
    throw new Error('App 未挂载')
  }
  return wrapper
}

function findSaveButton() {
  return mountTarget()
    .findAll('button')
    .find((button) => button.text() === '保存')
}

describe('itemForm：就绪与三模式回填', () => {
  it('挂载后上报 ready', () => {
    mountApp()
    expect(api.posted).toEqual([{ type: 'ready' }])
  })

  it('新增模式：schema 默认值打底 + 宿主初值覆盖；标题「新增条目」', async () => {
    mountApp()
    initMessage({ value: { name: '预填名', category: '来自编辑器' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('预填名')
    })
    expect(mountTarget().text()).toContain('新增条目')
    expect(inputValue(mountTarget().find('select').element)).toBe('medium') // schema defaultValue
  })

  it('编辑模式：回填条目全字段；标题「编辑条目」', async () => {
    mountApp()
    initMessage({
      value: { name: '旧名', category: '需求', description: '说明', priority: 'high', tags: ['a'] },
      mode: 'edit',
      itemId: 'id-1',
    })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('旧名')
    })
    expect(mountTarget().text()).toContain('编辑条目')
    expect(inputValue(mountTarget().find('select').element)).toBe('high')
  })

  it('categories 渲染为分类 datalist 建议', async () => {
    mountApp()
    initMessage({ value: {}, categories: ['需求', '任务'] })
    await vi.waitFor(() => {
      expect(mountTarget().find('datalist#category-list').exists()).toBe(true)
    })
    const options = mountTarget().find('datalist#category-list').findAll('option')
    expect(options.map((option) => option.attributes('value'))).toEqual(['需求', '任务'])
  })
})

describe('itemForm：草稿持久化与恢复', () => {
  it('输入防抖 500ms 后 setState({draft, mode, itemId})', async () => {
    vi.useFakeTimers()
    try {
      api.state = { draft: { name: '旧目标草稿' }, mode: 'edit', itemId: 'other' }
      mountApp()
      initMessage({ value: { name: '' } })
      await vi.advanceTimersByTimeAsync(0)
      // 干净初值（与基线一致）：清掉不匹配目标的旧草稿
      expect(api.state).toEqual({})
      await mountTarget().findAll('input[type="text"]')[0].setValue('草稿内容')
      expect(api.state).toEqual({}) // 未到防抖窗口不落盘
      await vi.advanceTimersByTimeAsync(500)
      expect(api.state).toMatchObject({ mode: 'create', itemId: undefined })
      expect((api.state as { draft: Record<string, unknown> }).draft.name).toBe('草稿内容')
    } finally {
      vi.useRealTimers()
    }
  })

  it('持久化草稿与目标匹配（同 mode/itemId）→ 恢复并显示提示行', async () => {
    api = createApiMock({ draft: { name: '未保存的草稿' }, mode: 'create', itemId: undefined })
    __setVsCodeApiForTest(api)
    mountApp()
    initMessage({ value: { name: '' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('未保存的草稿')
    })
    expect(mountTarget().text()).toContain('已恢复未保存的草稿')
    // 恢复的草稿相对干净基线是脏的：立即上报 dirty
    await vi.waitFor(() => {
      expect(api.posted).toContainEqual({ type: 'dirty', dirty: true })
    })
  })

  it('持久化草稿与目标不匹配（edit vs create）→ 用宿主初值，不显示提示', async () => {
    api = createApiMock({ draft: { name: '别人的草稿' }, mode: 'edit', itemId: 'id-9' })
    __setVsCodeApiForTest(api)
    mountApp()
    initMessage({ value: { name: '宿主初值' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('宿主初值')
    })
    expect(mountTarget().text()).not.toContain('已恢复未保存的草稿')
  })

  it('serializer 恢复状态（extra.persisted）优先于页面 getState', async () => {
    api = createApiMock({ draft: { name: '页面状态草稿' }, mode: 'create' })
    __setVsCodeApiForTest(api)
    mountApp()
    initMessage({ value: {}, persisted: { draft: { name: '重载恢复草稿' }, mode: 'create' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('重载恢复草稿')
    })
  })

  it('丢弃草稿：回到干净初值并清除持久化状态', async () => {
    api = createApiMock({ draft: { name: '草稿' }, mode: 'create' })
    __setVsCodeApiForTest(api)
    mountApp()
    initMessage({ value: { name: '初始名' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('草稿')
    })
    await mountTarget().find('button.item-form__discard').trigger('click')
    await vi.waitFor(() => {
      expect(nameValue()).toBe('初始名')
    })
    expect(mountTarget().text()).not.toContain('已恢复未保存的草稿')
    expect(api.state).toEqual({})
  })
})

describe('itemForm：dirty 上报', () => {
  it('值变化上报 dirty=true；回到基线上报 dirty=false', async () => {
    mountApp()
    initMessage({ value: { name: '基线' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('基线')
    })
    api.posted.length = 0
    await mountTarget().findAll('input[type="text"]')[0].setValue('改动')
    await vi.waitFor(() => {
      expect(api.posted).toContainEqual({ type: 'dirty', dirty: true })
    })
    await mountTarget().findAll('input[type="text"]')[0].setValue('基线')
    await vi.waitFor(() => {
      expect(api.posted).toContainEqual({ type: 'dirty', dirty: false })
    })
  })
})

describe('itemForm：提交流', () => {
  it('保存按钮：必填校验失败时不发 submit；通过后发 submit 且按钮进入在途禁用', async () => {
    mountApp()
    initMessage({ value: { name: '' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('')
    })
    api.posted.length = 0
    await findSaveButton()!.trigger('click')
    expect(api.posted.filter((m) => (m as { type: string }).type === 'submit')).toHaveLength(0)
    expect(mountTarget().text()).toContain('请填写「名称」')

    await mountTarget().findAll('input[type="text"]')[0].setValue('合法名称')
    await findSaveButton()!.trigger('click')
    const submit = api.posted.find((m) => (m as { type: string }).type === 'submit') as {
      draft: Record<string, unknown>
    }
    expect(submit.draft.name).toBe('合法名称')
    // 在途：保存按钮禁用（loading）
    expect(buttonDisabled(findSaveButton()!.element)).toBe(true)
  })

  it('submitAck：清除持久化草稿并复位 dirty', async () => {
    mountApp()
    initMessage({ value: { name: '任务A' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('任务A')
    })
    await mountTarget().findAll('input[type="text"]')[0].setValue('任务B')
    await findSaveButton()!.trigger('click')
    hostMessage({ type: 'submitAck', ok: true })
    await vi.waitFor(() => {
      expect(api.posted).toContainEqual({ type: 'dirty', dirty: false })
    })
    expect(api.state).toEqual({})
  })

  it('error 带 field：定位到对应控件（aria-invalid + 错误行）', async () => {
    mountApp()
    initMessage({ value: { name: '重名' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('重名')
    })
    await findSaveButton()!.trigger('click')
    hostMessage({ type: 'error', message: '名称不能为空。', field: 'name' })
    await vi.waitFor(() => {
      expect(mountTarget().text()).toContain('名称不能为空')
    })
    const input = mountTarget().findAll('input[type="text"]')[0]
    expect(input.attributes('aria-invalid')).toBe('true')
    // 错误后按钮恢复可点（在途解锁）
    expect(buttonDisabled(findSaveButton()!.element)).toBe(false)
  })

  it('error 不带 field：显示为页面级错误', async () => {
    mountApp()
    initMessage({ value: { name: 'x' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('x')
    })
    hostMessage({ type: 'error', message: '数据文件写入失败' })
    await vi.waitFor(() => {
      expect(mountTarget().find('.item-form__error').text()).toContain('数据文件写入失败')
    })
  })
})

describe('itemForm：取消', () => {
  it('取消按钮 / Esc 键 → postMessage cancel', async () => {
    mountApp()
    initMessage({ value: { name: 'x' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('x')
    })
    api.posted.length = 0
    const cancelButton = mountTarget()
      .findAll('button')
      .find((button) => button.text() === '取消')!
    await cancelButton.trigger('click')
    expect(api.posted).toContainEqual({ type: 'cancel' })

    api.posted.length = 0
    await mountTarget().find('form').trigger('keydown', { key: 'Escape' })
    expect(api.posted).toContainEqual({ type: 'cancel' })
  })

  it('Ctrl+Enter 提交；IME 组合中忽略', async () => {
    mountApp()
    initMessage({ value: { name: '任务A' } })
    await vi.waitFor(() => {
      expect(nameValue()).toBe('任务A')
    })
    api.posted.length = 0
    await mountTarget().find('form').trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(api.posted.some((m) => (m as { type: string }).type === 'submit')).toBe(true)

    api.posted.length = 0
    await mountTarget()
      .find('form')
      .trigger('keydown', { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(api.posted.some((m) => (m as { type: string }).type === 'submit')).toBe(false)
  })
})
