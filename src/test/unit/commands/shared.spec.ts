import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { createExtensionContextStub, __resetStubs, __stubs } from '../stubs/vscode'
import { WebviewController } from '../../../webview/host/webviewController'
import { ItemFormPanel } from '../../../providers/itemFormPanel'
import { PRIORITY_LABELS, type Item } from '../../../models/item'
import { ItemService, ItemValidationError } from '../../../services/itemService'
import {
  buildMoreActions,
  copyToClipboard,
  names,
  openFileForm,
  pickItem,
  showError,
  statusIcon,
  summarize,
  toItem,
} from '../../../commands/shared'

/**
 * R-E-6 / R-E-8 补网：commands/shared.ts 是三个命令分组共用的纯逻辑层，
 * 此前仅被 commands.spec.ts 间接覆盖约 42% 行——菜单构建、剪贴板兜底、
 * 错误文案、QuickPick 选条目这些「用户天天碰到」的分支全无用例。
 */

const context = createExtensionContextStub() as unknown as vscode.ExtensionContext

function makeItem(id: string, name: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    name,
    category: '需求',
    description: '描述',
    priority: 'medium',
    tags: ['a'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeService(items: Item[] = [], options: { filtered?: boolean } = {}): ItemService {
  return {
    listAll: vi.fn(async () => items),
    filtered: options.filtered ?? false,
  } as unknown as ItemService
}

let tempDir: string

beforeEach(() => {
  __resetStubs()
  WebviewController.__resetForTest()
  ItemFormPanel.configure(context)
  tempDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-cmd-shared-'))
})

afterEach(() => {
  WebviewController.__resetForTest()
  nodeFs.rmSync(tempDir, { recursive: true, force: true })
})

describe('buildMoreActions：「更多操作」动态菜单', () => {
  it('分组顺序与 action 集合稳定（树右键菜单与命令面板共用同一套）', () => {
    const item = makeItem('id-1', '甲', { priority: 'medium' })
    const picks = buildMoreActions(item)
    expect(picks.map((pick) => pick.action)).toEqual([
      '',
      'edit',
      'duplicate',
      '',
      'high',
      'medium',
      'low',
      '',
      'copyName',
      'copyMarkdown',
      'copyJson',
      '',
      'delete',
    ])
    const separators = picks.filter((pick) => pick.kind === vscode.QuickPickItemKind.Separator)
    expect(separators.map((pick) => pick.label)).toEqual(['条目操作', '优先级', '复制', '危险操作'])
  })

  it('当前优先级标注「当前」，其余不标注', () => {
    const picks = buildMoreActions(makeItem('id-1', '甲', { priority: 'high' }))
    const byPriority = (action: string) => picks.find((pick) => pick.action === action)?.detail
    expect(byPriority('high')).toBe('当前')
    expect(byPriority('medium')).toBeUndefined()
    expect(byPriority('low')).toBeUndefined()
  })
})

describe('statusIcon：初始化步骤状态图标', () => {
  it.each([
    ['done', '$(check)'],
    ['failed', '$(error)'],
    ['running', '$(sync)'],
    ['idle', '$(circle-outline)'],
  ])('%s → %s', (status, expected) => {
    expect(statusIcon(status as 'done' | 'failed' | 'running' | 'idle')).toBe(expected)
  })
})

describe('toItem：命令入参归一化', () => {
  it.each([
    ['null', null, undefined],
    ['undefined', undefined, undefined],
    ['字符串', 'x', undefined],
    ['数字', 42, undefined],
    ['category 节点', { kind: 'category' }, undefined],
    ['缺 id', { name: '甲' }, undefined],
    ['缺 name', { id: 'id-1' }, undefined],
  ])('%s → 非条目一律 undefined', (_label, input, expected) => {
    expect(toItem(input)).toBe(expected)
  })

  it('树节点（kind=item）取其 item；原始 Item 直接返回', () => {
    const item = makeItem('id-1', '甲')
    expect(toItem({ kind: 'item', item })).toBe(item)
    expect(toItem(item)).toBe(item)
  })
})

describe('summarize / names：批量确认文案', () => {
  it('summarize：0 条 → undefined；1 条 → 描述（无描述则 undefined）', () => {
    expect(summarize([])).toBeUndefined()
    expect(summarize([makeItem('id-1', '甲')])).toBe('描述')
    expect(summarize([makeItem('id-1', '甲', { description: '' })])).toBeUndefined()
  })

  it('summarize：多条 → 「即将删除」+ 名称摘要', () => {
    expect(summarize([makeItem('id-1', '甲'), makeItem('id-2', '乙')])).toBe(
      '即将删除：「甲」、「乙」'
    )
  })

  it.each([
    [1, '「甲」'],
    [3, '「甲」、「乙」、「丙」'],
    [4, '「甲」、「乙」、「丙」 等 4 个'],
  ])('names：%i 条 → %s', (count, expected) => {
    const items = ['甲', '乙', '丙', '丁']
      .slice(0, count)
      .map((name, index) => makeItem(`id-${index}`, name))
    expect(names(items)).toBe(expected)
  })
})

describe('copyToClipboard：剪贴板兜底', () => {
  it('成功 → true', async () => {
    await expect(copyToClipboard('文本')).resolves.toBe(true)
    expect(__stubs.clipboard).toBe('文本')
  })

  it('写入抛错 → false 并提示「复制失败」（不中断命令流）', async () => {
    vi.spyOn(vscode.env.clipboard, 'writeText').mockRejectedValue(new Error('被占用'))
    await expect(copyToClipboard('文本')).resolves.toBe(false)
    const error = __stubs.recorded.find((entry) => entry.kind === 'showErrorMessage')
    expect(error).toBeDefined()
    expect(String((error?.args[0] as { message: string }).message)).toContain('复制失败')
    vi.restoreAllMocks()
  })
})

describe('showError：错误文案分流', () => {
  it('ItemValidationError → 原样展示（领域校验文案已面向用户）', () => {
    showError(new ItemValidationError('名称不能为空'))
    const error = __stubs.recorded.find((entry) => entry.kind === 'showErrorMessage')
    expect((error?.args[0] as { message: string }).message).toBe('名称不能为空')
  })

  it('其他错误 → 统一加「操作失败：」前缀（String(err) 对 Error 含 "Error: " 前缀）', () => {
    showError(new Error('ENOENT'))
    const error = __stubs.recorded.find((entry) => entry.kind === 'showErrorMessage')
    expect((error?.args[0] as { message: string }).message).toBe('操作失败：Error: ENOENT')

    showError('磁盘已满')
    const plain = __stubs.recorded.filter((entry) => entry.kind === 'showErrorMessage').at(-1)
    expect((plain?.args[0] as { message: string }).message).toBe('操作失败：磁盘已满')
  })
})

describe('openFileForm：资源管理器右键「登记文件」', () => {
  it('文件夹 → 提示「请选择文件而非文件夹」，不打开表单', async () => {
    await openFileForm(makeService(), vscode.Uri.file(tempDir))
    const info = __stubs.recorded.find((entry) => entry.kind === 'showInformationMessage')
    expect((info?.args[0] as { message: string }).message).toContain('请选择文件而非文件夹')
    expect(__stubs.recorded.some((entry) => entry.kind === 'createWebviewPanel')).toBe(false)
  })

  it('stat 失败（路径不存在）→ showError，不抛出', async () => {
    await openFileForm(makeService(), vscode.Uri.file(nodePath.join(tempDir, 'nope.txt')))
    const error = __stubs.recorded.find((entry) => entry.kind === 'showErrorMessage')
    expect(error).toBeDefined()
    expect(__stubs.recorded.some((entry) => entry.kind === 'createWebviewPanel')).toBe(false)
  })

  it('文件 → 打开表单面板', async () => {
    const file = nodePath.join(tempDir, 'demo.md')
    nodeFs.writeFileSync(file, '# demo', 'utf8')
    await openFileForm(makeService(), vscode.Uri.file(file))
    await vi.waitFor(() => {
      expect(__stubs.recorded.some((entry) => entry.kind === 'createWebviewPanel')).toBe(true)
    })
  })
})

describe('pickItem：命令面板无参数时的条目选择', () => {
  it('无条目 → 提示「请先新增」，返回 undefined', async () => {
    await expect(pickItem(makeService(), '选择条目')).resolves.toBeUndefined()
    const info = __stubs.recorded.find((entry) => entry.kind === 'showInformationMessage')
    expect((info?.args[0] as { message: string }).message).toContain('当前没有条目')
  })

  it('选中 → 返回该条目（QuickPick 项携带 item 引用）', async () => {
    const item = makeItem('id-1', '甲')
    __stubs.dialogQueue.push({ item })
    await expect(pickItem(makeService([item]), '选择条目')).resolves.toBe(item)
  })

  it('过滤中：标题注明「已列出全部条目」，避免只看到过滤结果', async () => {
    const item = makeItem('id-1', '甲')
    __stubs.dialogQueue.push({ item })
    await pickItem(makeService([item], { filtered: true }), '选择条目')
    const pick = __stubs.recorded.find((entry) => entry.kind === 'showQuickPick')
    const options = (pick?.args[0] as { options: { title: string } }).options
    expect(options.title).toContain('已列出全部条目')
  })

  it('列表项带优先级图标，且与 PRIORITY_LABELS 同源（不另抄一份）', async () => {
    const item = makeItem('id-1', '甲', { priority: 'high' })
    __stubs.dialogQueue.push({ item })
    await pickItem(makeService([item]), '选择条目')
    const pick = __stubs.recorded.find((entry) => entry.kind === 'showQuickPick')
    expect(PRIORITY_LABELS.high).toBe('高')
    const first = (pick?.args[0] as { items: unknown[] }).items[0] as {
      label: string
      iconPath: { id: string }
    }
    expect(first.label).toBe('甲')
    expect(typeof first.iconPath.id).toBe('string')
  })
})

describe('openFileForm：预填草稿', () => {
  it('文件分支把「文件名 / 文件 / 绝对路径 / 文件标签」作为预填草稿交给表单', async () => {
    const file = nodePath.join(tempDir, 'demo.md')
    nodeFs.writeFileSync(file, '# demo', 'utf8')
    // 面板真实打开会牵连 webview 资源解析；此处只锁定交给表单的预填内容
    const openSpy = vi.spyOn(ItemFormPanel, 'createOrShow').mockImplementation(() => undefined)
    try {
      await openFileForm(makeService(), vscode.Uri.file(file))
      expect(openSpy).toHaveBeenCalledTimes(1)
      const prefill = openSpy.mock.calls[0]?.[2] as Record<string, unknown> | undefined
      expect(prefill).toEqual({
        name: 'demo.md',
        category: '文件',
        description: file,
        tags: ['文件'],
      })
    } finally {
      openSpy.mockRestore()
    }
  })
})
