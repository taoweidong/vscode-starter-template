import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import App from '../../../webview/apps/importWizard/App.vue'
import { __setVsCodeApiForTest, type VsCodeApi } from '../../../webview/shared/useVsCodeApi'
import { buttonDisabled, hostMessage, inputChecked, inputValue } from './appTestUtils'

/**
 * 批量导入向导页（M4-T4.4，FR-16 AC5）：步骤流转 / 预览去重 / 执行进度 / 取消 / 结果。
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

function button(text: string) {
  const found = wrapper!.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) {
    throw new Error(`未找到按钮：${text}`)
  }
  return found
}

function init(presetFolder?: string): void {
  const extra = presetFolder ? { presetFolder } : {}
  hostMessage({ type: 'init', page: 'importWizard', schema: [], value: null, extra })
}

describe('importWizard：步骤① 来源', () => {
  it('挂载后上报 ready；init 的 presetFolder 预填路径', async () => {
    mountApp()
    expect(api.posted).toEqual([{ type: 'ready' }])
    init('D:/project/docs')
    await vi.waitFor(() => {
      expect(inputValue(wrapper!.find('#wizard-folder').element)).toBe('D:/project/docs')
    })
    expect(wrapper!.text()).toContain('选择来源')
  })

  it('「浏览…」→ browseFolder；selectFolder 应答回填（取消不变）', async () => {
    mountApp()
    init()
    await vi.waitFor(() => {
      expect(button('下一步').exists()).toBe(true)
    })
    await button('浏览…').trigger('click')
    expect(api.posted).toContainEqual({ type: 'browseFolder' })
    hostMessage({ type: 'selectFolder', folder: 'D:/project/docs' })
    await vi.waitFor(() => {
      expect(inputValue(wrapper!.find('#wizard-folder').element)).toBe('D:/project/docs')
    })
    hostMessage({ type: 'selectFolder', folder: null })
    await vi.waitFor(() => {
      expect(inputValue(wrapper!.find('#wizard-folder').element)).toBe('D:/project/docs')
    })
  })

  it('路径为空时「下一步」禁用；填写后发 requestPreview 并显示扫描中', async () => {
    mountApp()
    init()
    await vi.waitFor(() => {
      expect(buttonDisabled(button('下一步').element)).toBe(true)
    })
    await wrapper!.find('#wizard-folder').setValue('D:/x')
    await button('下一步').trigger('click')
    expect(api.posted).toContainEqual({ type: 'requestPreview', folder: 'D:/x' })
  })

  it('宿主 error（文件夹不可读）：停留步骤①并显示错误', async () => {
    mountApp()
    init()
    await wrapper!.find('#wizard-folder').setValue('D:/nope')
    await button('下一步').trigger('click')
    hostMessage({ type: 'error', message: '读取文件夹失败：不存在' })
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('读取文件夹失败')
    })
    expect(wrapper!.text()).toContain('选择来源')
  })
})

describe('importWizard：步骤② 预览', () => {
  async function gotoPreview(): Promise<void> {
    mountApp()
    init()
    await wrapper!.find('#wizard-folder').setValue('D:/docs')
    await button('下一步').trigger('click')
    hostMessage({
      type: 'importPreview',
      files: [
        { name: 'a.md', path: 'D:/docs/a.md', exists: false },
        { name: 'b.md', path: 'D:/docs/b.md', exists: true },
        { name: 'c.md', path: 'D:/docs/c.md', exists: false },
      ],
    })
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('预览确认')
    })
  }

  it('新文件默认勾选、已存在默认不勾选并标注「已存在，将跳过」', async () => {
    await gotoPreview()
    const rows = wrapper!.findAll('input[type="checkbox"]')
    const checked = rows.map((row) => inputChecked(row.element))
    expect(checked).toEqual([true, false, true])
    expect(wrapper!.text()).toContain('已存在，将跳过')
    expect(wrapper!.text()).toContain('个新文件将被导入')
    expect(wrapper!.text()).toContain('个与现有条目同名')
  })

  it('手动勾选已存在文件后一并回传（由宿主按跳过统计）', async () => {
    await gotoPreview()
    await wrapper!.findAll('input[type="checkbox"]')[1].setValue(true)
    await button('开始导入').trigger('click')
    const execute = api.posted.find((m) => (m as { type: string }).type === 'executeImport') as {
      files: { name: string; exists: boolean }[]
    }
    expect(execute.files).toHaveLength(3) // 勾选的全部文件
  })

  it('全部不勾选时「开始导入」禁用；上一步回到来源', async () => {
    await gotoPreview()
    await wrapper!.findAll('input[type="checkbox"]')[0].setValue(false)
    await wrapper!.findAll('input[type="checkbox"]')[2].setValue(false)
    expect(buttonDisabled(button('开始导入').element)).toBe(true)
    await button('上一步').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('选择来源')
    })
  })

  it('预览为空：空态提示', async () => {
    mountApp()
    init()
    await wrapper!.find('#wizard-folder').setValue('D:/empty')
    await button('下一步').trigger('click')
    hostMessage({ type: 'importPreview', files: [] })
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('该文件夹下没有文件')
    })
  })
})

describe('importWizard：步骤③ 执行与取消', () => {
  async function gotoExecuting(): Promise<void> {
    mountApp()
    init()
    await wrapper!.find('#wizard-folder').setValue('D:/docs')
    await button('下一步').trigger('click')
    hostMessage({
      type: 'importPreview',
      files: [{ name: 'a.md', path: 'D:/docs/a.md', exists: false }],
    })
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('预览确认')
    })
    await button('开始导入').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('执行导入')
    })
  }

  it('开始导入 → executeImport（勾选子集）；进度消息更新进度条', async () => {
    await gotoExecuting()
    const execute = api.posted.find((m) => (m as { type: string }).type === 'executeImport') as {
      files: { name: string }[]
    }
    expect(execute.files.map((file) => file.name)).toEqual(['a.md'])
    hostMessage({ type: 'importProgress', done: 1, total: 2 })
    await vi.waitFor(() => {
      expect(wrapper!.find('.wizard__progress').attributes('aria-valuenow')).toBe('1')
    })
    expect(wrapper!.text()).toContain('已完成 1 / 2')
  })

  it('取消导入 → cancelImport；importDone(cancelled) 后进入结果页', async () => {
    await gotoExecuting()
    api.posted.length = 0
    await button('取消导入').trigger('click')
    expect(api.posted).toContainEqual({ type: 'cancelImport' })
    hostMessage({
      type: 'importDone',
      result: { created: 1, skipped: 0, failed: 0, cancelled: true },
    })
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('导入已取消')
    })
    expect(wrapper!.text()).toContain('成功')
  })
})

describe('importWizard：步骤④ 结果', () => {
  async function gotoResult(failures?: { name: string; reason: string }[]): Promise<void> {
    mountApp()
    init()
    await wrapper!.find('#wizard-folder').setValue('D:/docs')
    await button('下一步').trigger('click')
    hostMessage({
      type: 'importPreview',
      files: [
        { name: 'a.md', path: 'D:/docs/a.md', exists: false },
        { name: 'b.md', path: 'D:/docs/b.md', exists: true },
      ],
    })
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('预览确认')
    })
    await button('开始导入').trigger('click')
    hostMessage({
      type: 'importDone',
      result: {
        created: 1,
        skipped: 1,
        failed: 1,
        cancelled: false,
        ...(failures ? { failures } : {}),
      },
    })
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('导入完成')
    })
  }

  it('结果页显示 成功 / 跳过 / 失败 计数与失败明细', async () => {
    await gotoResult([{ name: 'c.md', reason: '写入失败' }])
    expect(wrapper!.text()).toContain('导入完成')
    expect(wrapper!.text()).toContain('c.md')
    expect(wrapper!.text()).toContain('写入失败')
  })

  it('「完成」→ cancel（宿主关闭面板）；「再次导入」回到步骤①', async () => {
    await gotoResult()
    api.posted.length = 0
    await button('完成').trigger('click')
    expect(api.posted).toContainEqual({ type: 'cancel' })
    await button('再次导入').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper!.text()).toContain('选择来源')
    })
  })
})
