import { describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { registerCommands, type CommandDeps } from '../../commands'
import { collectTargets, names, notifySuccess, toMarkdown } from '../../commands/shared'
import { COMMAND } from '../../constants'
import type { Item } from '../../models/item'
import { __resetStubs, __setConfig, __stubs, createExtensionContextStub } from './stubs/vscode'

/**
 * 命令层单测（C-15 拆分 + C-12 修复）：
 * - 拆分后 shared.ts 的导出是各分组与门禁静态检查的共同基础，此处锁定其行为；
 * - C-12 的转义用例已随 R-C-8 迁至 ui/markdown.spec.ts（toMarkdown 仍在此覆盖转义链路）。
 */

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'id-1',
    name: '条目',
    category: '',
    description: '',
    priority: 'medium',
    tags: [],
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
    ...overrides,
  }
}

describe('toMarkdown（复制为 Markdown 的文本结构）', () => {
  it('名称含反斜杠时正确双写转义（C-12）', () => {
    expect(toMarkdown(makeItem({ name: '修复 \\ 转义', priority: 'high' }))).toBe(
      '- **修复 \\\\ 转义**（高优先级）'
    )
  })

  it('分类 / 标签 / 描述两级缩进输出，多行描述续行缩进两空格', () => {
    const md = toMarkdown(
      makeItem({
        name: '重构',
        category: '技术债',
        description: '第一行\n第二行',
        priority: 'low',
        tags: ['a_b', 'c*d'],
      })
    )
    expect(md).toBe(
      [
        '- **重构**（低优先级）',
        '  - 分类：技术债',
        '  - 标签：a\\_b、c\\*d',
        '  - 第一行',
        '  第二行',
      ].join('\n')
    )
  })

  it('缺省分类 / 标签 / 描述时只输出标题行', () => {
    expect(toMarkdown(makeItem({ name: '空条目' }))).toBe('- **空条目**（中优先级）')
  })
})

describe('names（批量操作通知中的目标摘要）', () => {
  it('不超过 3 个时全部列出', () => {
    const items = ['甲', '乙', '丙'].map((name) => makeItem({ name }))
    expect(names(items)).toBe('「甲」、「乙」、「丙」')
  })

  it('超过 3 个时截断为「等 N 个」', () => {
    const items = ['甲', '乙', '丙', '丁', '戊'].map((name) => makeItem({ name }))
    expect(names(items)).toBe('「甲」、「乙」、「丙」 等 5 个')
  })
})

describe('collectTargets（右键目标 + 多选集合归一化）', () => {
  const a = makeItem({ id: 'a', name: 'A' })
  const b = makeItem({ id: 'b', name: 'B' })

  it('树节点元素与原始 Item 混合输入按 id 去重', () => {
    expect(collectTargets({ kind: 'item', item: a }, [a, { kind: 'item', item: b }])).toEqual([
      a,
      b,
    ])
  })

  it('分类节点等非条目入参被忽略', () => {
    expect(collectTargets({ kind: 'category' }, [{ kind: 'category' }, null, 'x'])).toEqual([])
  })

  it('无多选集合时仅返回被右键的条目', () => {
    expect(collectTargets(a)).toEqual([a])
  })
})

describe('notifySuccess（拆分前 registerCommands 内的 notify 闭包）', () => {
  it('开关开启（默认）时弹「已…」信息条', () => {
    __resetStubs()
    notifySuccess('已删除「A」。')
    expect(
      __stubs.recorded.some(
        (entry) =>
          entry.kind === 'showInformationMessage' &&
          (entry.args[0] as { message: string }).message === '已删除「A」。'
      )
    ).toBe(true)
  })

  it('开关关闭时不弹通知', () => {
    __resetStubs()
    __setConfig('crudStarter', 'features.successNotifications', false)
    notifySuccess('已删除「A」。')
    expect(__stubs.recorded.some((entry) => entry.kind === 'showInformationMessage')).toBe(false)
  })
})

describe('registerCommands（C-15 拆分后的注册完整性）', () => {
  it('注册键与 COMMAND 常量一一对应（拆分前后数量不变，门禁第 ⑥ 步的单测镜像）', () => {
    __resetStubs()
    const context = createExtensionContextStub()
    registerCommands(context as unknown as vscode.ExtensionContext, {} as CommandDeps)
    const registered = [...__stubs.registeredCommands.keys()]
    expect(registered.slice().sort()).toEqual(Object.values(COMMAND).slice().sort())
    expect(registered).toHaveLength(Object.keys(COMMAND).length)
  })
})
