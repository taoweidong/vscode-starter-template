import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { createExtensionContextStub, __resetStubs, __stubs } from '../stubs/vscode'
import { WebviewController } from '../../../webview/host/webviewController'
import { FORM_SCHEMA } from '../../../webview/formSchema'
import type { Item, ItemDraft } from '../../../models/item'
import { ItemValidationError, ItemService } from '../../../services/itemService'
import { ItemFormPanel } from '../../../providers/itemFormPanel'
import { lastPosted, makePanelDeps } from './support/fakePanel'

/**
 * 条目表单面板（M4-T4.2）：submit → create/update 分流 / 错误回传定位 /
 * dirty 切换目标确认 / 取消与成功关闭。service 用满足签名面的 mock。
 */

const context = createExtensionContextStub() as unknown as vscode.ExtensionContext

function makeItem(id: string, name: string): Item {
  return {
    id,
    name,
    category: '需求',
    description: '描述',
    priority: 'medium',
    tags: ['a'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeService(items: Item[] = []) {
  return {
    create: vi.fn(async (draft: ItemDraft) => makeItem('new-1', draft.name)),
    update: vi.fn(async (id: string, draft: ItemDraft) => ({ ...makeItem(id, draft.name) })),
    get: vi.fn(async (id: string) => items.find((item) => item.id === id)),
    getCategories: vi.fn(async () => ['需求', '任务']),
    listAll: vi.fn(async () => items),
  } as unknown as ItemService
}

beforeEach(() => {
  __resetStubs()
  WebviewController.__resetForTest()
  ItemFormPanel.configure(context)
})

describe('itemFormPanel：装配与 init', () => {
  it('未 configure 时给出明确错误（不抛出）', () => {
    const holder = ItemFormPanel as unknown as { context: vscode.ExtensionContext | undefined }
    const saved = holder.context
    holder.context = undefined
    ItemFormPanel.createOrShow(makeService())
    const error = __stubs.recorded.find((entry) => entry.kind === 'showErrorMessage')
    expect(error).toBeDefined()
    holder.context = saved
  })

  it('新增模式：ready 后回 init（schema / 空 value / mode=create / categories）', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    ItemFormPanel.createOrShow(service, undefined, undefined, deps)
    await vi.waitFor(() => {
      expect(panels[0].webview.html).toContain('data-page="itemForm"')
    })
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      const init = lastPosted(panels[0], 'init')
      expect(init).toBeDefined()
    })
    const init = lastPosted(panels[0], 'init')!
    expect(init.schema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'name', type: 'text' }),
        expect.objectContaining({ key: 'priority', type: 'select' }),
      ])
    )
    expect(init.extra).toMatchObject({ mode: 'create', categories: ['需求', '任务'] })
    expect(init.value).toEqual({})
  })

  it('预填新增：initial 合入 value', async () => {
    const { deps, panels } = makePanelDeps()
    ItemFormPanel.createOrShow(makeService(), undefined, { name: '选中文字' }, deps)
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'init')).toBeDefined()
    })
    expect(lastPosted(panels[0], 'init')!.value).toMatchObject({ name: '选中文字' })
  })

  it('编辑模式：itemId + 全字段 draft 回填（toDraft 语义）', async () => {
    const { deps, panels } = makePanelDeps()
    const item = makeItem('id-1', '旧名')
    ItemFormPanel.createOrShow(makeService([item]), item, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'init')).toBeDefined()
    })
    const init = lastPosted(panels[0], 'init')!
    expect(init.extra).toMatchObject({ mode: 'edit', itemId: 'id-1' })
    expect(init.value).toEqual({
      name: '旧名',
      category: '需求',
      description: '描述',
      priority: 'medium',
      tags: ['a'],
    })
  })
})

describe('itemFormPanel：submit 分流与错误回传', () => {
  it('新增目标 → service.create；成功后关面板 + 成功提示', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    ItemFormPanel.createOrShow(service, undefined, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({
      type: 'submit',
      draft: { name: '任务A', category: '', description: '', priority: 'medium', tags: [] },
    })
    await vi.waitFor(() => {
      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '任务A', priority: 'medium' })
      )
    })
    await vi.waitFor(() => {
      expect(panels[0].disposeCalls).toBe(1)
    })
    const info = __stubs.recorded.find((entry) => entry.kind === 'showInformationMessage')
    expect(info?.args[0]).toMatchObject({ message: expect.stringContaining('已新增「任务A」') })
  })

  it('编辑目标 → service.update(id)；成功后关面板', async () => {
    const { deps, panels } = makePanelDeps()
    const item = makeItem('id-1', '旧名')
    const service = makeService([item])
    ItemFormPanel.createOrShow(service, item, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({
      type: 'submit',
      draft: { name: '新名', category: '', description: '', priority: 'high', tags: ['x'] },
    })
    await vi.waitFor(() => {
      expect(service.update).toHaveBeenCalledWith(
        'id-1',
        expect.objectContaining({ name: '新名', priority: 'high' })
      )
    })
    await vi.waitFor(() => {
      expect(panels[0].disposeCalls).toBe(1)
    })
  })

  it('校验错误回传 error 且带 field（页面定位到 name 控件），面板保持打开', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    ;(service as unknown as { create: ReturnType<typeof vi.fn> }).create.mockRejectedValue(
      new ItemValidationError('名称不能为空。')
    )
    ItemFormPanel.createOrShow(service, undefined, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'submit', draft: { name: '' } })
    await vi.waitFor(() => {
      const error = lastPosted(panels[0], 'error')
      expect(error).toMatchObject({ type: 'error', message: '名称不能为空。', field: 'name' })
    })
    expect(panels[0].disposeCalls).toBe(0)
  })

  it('非校验错误不带 field；未知字段错误同样定位失败不误报', async () => {
    const { deps, panels } = makePanelDeps()
    const service = makeService()
    ;(service as unknown as { update: ReturnType<typeof vi.fn> }).update.mockRejectedValue(
      new Error('EACCES: permission denied')
    )
    const item = makeItem('id-1', 'x')
    ItemFormPanel.createOrShow(service, item, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'submit', draft: { name: 'x' } })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'error')).toMatchObject({
        message: expect.stringContaining('EACCES'),
      })
    })
    expect(lastPosted(panels[0], 'error')!.field).toBeUndefined()
  })
})

describe('itemFormPanel：取消与切换目标', () => {
  it('cancel → 关闭面板', async () => {
    const { deps, panels } = makePanelDeps()
    ItemFormPanel.createOrShow(makeService(), undefined, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'cancel' })
    expect(panels[0].disposeCalls).toBe(1)
  })

  it('同目标再次 createOrShow：只 reveal 不重建', async () => {
    const { deps, panels } = makePanelDeps()
    const item = makeItem('id-1', '旧名')
    ItemFormPanel.createOrShow(makeService([item]), item, undefined, deps)
    await vi.waitFor(() => {
      expect(panels).toHaveLength(1)
    })
    const postedBefore = panels[0].posted.length
    ItemFormPanel.createOrShow(makeService([item]), item, undefined, deps)
    expect(panels).toHaveLength(1)
    expect(panels[0].revealCalls).toBe(1)
    expect(panels[0].posted.length).toBe(postedBefore)
  })

  it('dirty 时切换目标：确认丢弃 → 重发 init（新目标）', async () => {
    const { deps, panels } = makePanelDeps()
    const first = makeItem('id-1', '旧名')
    ItemFormPanel.createOrShow(makeService([first]), first, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    __stubs.dialogQueue.push('放弃修改并继续')

    const second = makeItem('id-2', '另一个')
    ItemFormPanel.createOrShow(makeService([first, second]), second, undefined, deps)
    await vi.waitFor(() => {
      const init = lastPosted(panels[0], 'init')
      expect(init?.extra).toMatchObject({ mode: 'edit', itemId: 'id-2' })
    })
    expect(panels).toHaveLength(1) // 复用面板，不重建
  })

  it('dirty 时切换目标：用户拒绝 → 保持原目标（不重发 init）', async () => {
    const { deps, panels } = makePanelDeps()
    const first = makeItem('id-1', '旧名')
    ItemFormPanel.createOrShow(makeService([first]), first, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'init')).toBeDefined()
    })
    panels[0].webview.__emit({ type: 'dirty', dirty: true })
    __stubs.dialogQueue.push(undefined) // 关闭模态框 = 拒绝

    const postedBefore = panels[0].posted.length
    const second = makeItem('id-2', '另一个')
    ItemFormPanel.createOrShow(makeService([first, second]), second, undefined, deps)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(panels[0].posted.length).toBe(postedBefore) // 没有 new init
    expect(WebviewController.get('itemForm')).toBeDefined() // 面板仍在
  })

  it('用户关面板后再 createOrShow：创建新面板', async () => {
    const { deps, panels } = makePanelDeps()
    ItemFormPanel.createOrShow(makeService(), undefined, undefined, deps)
    panels[0].__close()
    ItemFormPanel.createOrShow(makeService(), undefined, undefined, deps)
    expect(panels).toHaveLength(2)
  })
})

describe('itemFormPanel：FORM_SCHEMA 完整下发', () => {
  it('init schema 覆盖 FORM_SCHEMA 全部字段键', async () => {
    const { deps, panels } = makePanelDeps()
    ItemFormPanel.createOrShow(makeService(), undefined, undefined, deps)
    panels[0].webview.__emit({ type: 'ready' })
    await vi.waitFor(() => {
      expect(lastPosted(panels[0], 'init')).toBeDefined()
    })
    const keys = (lastPosted(panels[0], 'init')!.schema as { key: string }[]).map(
      (field) => field.key
    )
    expect(keys).toEqual(FORM_SCHEMA.map((field) => field.key))
  })
})
