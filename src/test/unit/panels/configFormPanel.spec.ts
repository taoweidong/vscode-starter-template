import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { createExtensionContextStub, __resetStubs, __stubs } from '../stubs/vscode'
import { WebviewController } from '../../../webview/host/webviewController'
import {
  ConfigFormPanel,
  createFeatureConfigDeps,
} from '../../../features/featureConfig/configFormPanel'
import { FEATURE_FLAGS } from '../../../features/featureConfig/featureFlags'
import { lastPosted, makePanelDeps } from './support/fakePanel'

/**
 * 特性配置面板（M4-T4.3）：allSettled 语义 —— 部分失败保持打开并列出失败开关，
 * 全部成功才关闭 + 成功提示（受 successNotifications 约束）。
 */

const context = createExtensionContextStub() as unknown as vscode.ExtensionContext

beforeEach(() => {
  __resetStubs()
  WebviewController.__resetForTest()
  ConfigFormPanel.configure(context)
})

describe('createFeatureConfigDeps：buildInit', () => {
  it('schema 为全部 boolean 开关字段；value 回显当前配置（默认值）', async () => {
    const deps = createFeatureConfigDeps({ onSaved: () => undefined })
    const payload = await deps.buildInit!({ persistedState: undefined })
    expect(payload.schema.length).toBe(FEATURE_FLAGS.length)
    expect(payload.schema.every((field) => field.type === 'boolean')).toBe(true)
    expect(payload.value).toEqual({
      confirmDelete: true,
      successNotifications: true,
      showPriorityIcons: true,
      showViewBadges: true,
      autoRefreshOnExternalChange: true,
    })
  })
})

describe('createFeatureConfigDeps：onSubmit（allSettled）', () => {
  it('全部成功 → onSaved 调用 + 成功提示（successNotifications 默认开）', async () => {
    const onSaved = vi.fn()
    const apply = vi.fn(async () => undefined)
    const deps = createFeatureConfigDeps({ onSaved, applyFeatureValue: apply })
    await deps.onSubmit!({ confirmDelete: false, successNotifications: true })
    expect(apply).toHaveBeenCalledTimes(2)
    expect(onSaved).toHaveBeenCalledTimes(1)
    const info = __stubs.recorded.find((entry) => entry.kind === 'showInformationMessage')
    expect(info?.args[0]).toMatchObject({ message: '已保存 2 项特性配置。' })
  })

  it('部分失败 → 抛错列出失败开关（label），不关闭面板', async () => {
    const onSaved = vi.fn()
    const apply = vi.fn(async (key: string) => {
      if (key === 'confirmDelete') {
        throw new Error('denied')
      }
    })
    const deps = createFeatureConfigDeps({ onSaved, applyFeatureValue: apply })
    await expect(
      deps.onSubmit!({ confirmDelete: false, showViewBadges: false, unknownKey: true })
    ).rejects.toThrow(/删除前确认/)
    expect(onSaved).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledTimes(2) // unknownKey 已在入口过滤
  })

  it('未注册的 key 被忽略（不写入设置）', async () => {
    const apply = vi.fn(async () => undefined)
    const deps = createFeatureConfigDeps({ onSaved: () => undefined, applyFeatureValue: apply })
    await deps.onSubmit!({ notAFlag: true })
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('ConfigFormPanel：经控制器的完整流', () => {
  it('ready → init；submit 全部成功 → 面板关闭 + 成功提示', async () => {
    const { deps, panels } = makePanelDeps()
    ConfigFormPanel.createOrShow(deps)
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'init')).toBeDefined()
    })
    panels[0].webview.__emit({ type: 'submit', draft: { confirmDelete: false } })
    await vi.waitFor(() => {
      expect(panels[0].disposeCalls).toBe(1)
    })
    const info = __stubs.recorded.find((entry) => entry.kind === 'showInformationMessage')
    expect(info?.args[0]).toMatchObject({ message: expect.stringContaining('已保存') })
  })

  it('cancel → 面板关闭', async () => {
    const { deps, panels } = makePanelDeps()
    ConfigFormPanel.createOrShow(deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'cancel' })
    expect(panels[0].disposeCalls).toBe(1)
  })
})
