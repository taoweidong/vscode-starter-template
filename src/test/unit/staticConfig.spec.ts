import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { __resetStubs } from './stubs/vscode'
import { StaticConfigService } from '../../features/staticConfig/staticConfigService'
import { StaticConfigTreeProvider } from '../../features/staticConfig/staticConfigTreeProvider'

/**
 * 静态配置（R-C-7 / R-C-22）：
 * - R-C-7：分组标题进 MarkdownString tooltip 前转义（用户可编辑配置的键名）；
 * - R-C-22：配置文件解析失败时树视图展示错误态节点，而非静默「暂无静态配置」。
 */

let rootDir: string

beforeEach(() => {
  __resetStubs()
  rootDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-static-'))
})

afterEach(() => {
  nodeFs.rmSync(rootDir, { recursive: true, force: true })
})

function makeService(): StaticConfigService {
  return new StaticConfigService(vscode.window.createOutputChannel('CRUD Starter Test'), () =>
    vscode.Uri.file(rootDir)
  )
}

function writeConfig(content: string): void {
  nodeFs.mkdirSync(nodePath.join(rootDir, '.vscode'), { recursive: true })
  nodeFs.writeFileSync(
    nodePath.join(rootDir, '.vscode', 'crud-starter.config.json'),
    content,
    'utf8'
  )
}

describe('StaticConfigService.flatten', () => {
  it('嵌套对象拍平为分组 → 条目，标量顶层键自成单条分组', () => {
    const sections = StaticConfigService.flatten({ name: 'demo', nested: { a: 1, b: true } })
    expect(sections[0]).toEqual({ title: 'name', entries: [{ key: 'name', value: 'demo' }] })
    const nested = sections.find((section) => section.title === 'nested')
    expect(nested?.entries.map((entry) => entry.key)).toEqual(['a', 'b'])
    expect(nested?.entries.map((entry) => entry.value)).toEqual(['1', 'true'])
  })
})

describe('StaticConfigService.load 错误态（R-C-22）', () => {
  it('合法配置：正常拍平且无错误', async () => {
    writeConfig(JSON.stringify({ project: { name: 'demo' } }))
    const svc = makeService()
    await svc.load()
    expect(svc.getSections().map((section) => section.title)).toEqual(['project'])
    expect(svc.getError()).toBeUndefined()
  })

  it('JSON 解析失败：sections 为空且 getError 给出原因', async () => {
    writeConfig('{ this is not json')
    const svc = makeService()
    await svc.load()
    expect(svc.getSections()).toEqual([])
    expect(svc.getError()).toBeTruthy()
  })

  it('文件不存在：空状态且不算错误（FileNotFound 不置位 getError）', async () => {
    const svc = makeService()
    await svc.load()
    expect(svc.getSections()).toEqual([])
    expect(svc.getError()).toBeUndefined()
  })

  it('修复配置文件后重新加载：错误清除、分组恢复', async () => {
    writeConfig('{ broken')
    const svc = makeService()
    await svc.load()
    expect(svc.getError()).toBeTruthy()
    writeConfig(JSON.stringify({ project: { name: 'demo' } }))
    await svc.load()
    expect(svc.getError()).toBeUndefined()
    expect(svc.getSections().map((section) => section.title)).toEqual(['project'])
  })
})

describe('StaticConfigTreeProvider（R-C-7 / R-C-22）', () => {
  it('分组标题含 Markdown 特殊字符：tooltip 中转义（标题含 * 与 [）', () => {
    const provider = new StaticConfigTreeProvider(() => [
      { title: 'a*b[c]', entries: [{ key: 'k', value: 'v' }] },
    ])
    const item = provider.getTreeItem({
      kind: 'section',
      section: { title: 'a*b[c]', entries: [{ key: 'k', value: 'v' }] },
    })
    const tooltip = item.tooltip as vscode.MarkdownString
    expect(tooltip.value).toContain('a\\*b\\[c\\]')
    expect(tooltip.value).not.toContain('a*b[c]')
  })

  it('解析失败（getError 有值）：展示错误态节点而非「暂无静态配置」', async () => {
    const provider = new StaticConfigTreeProvider(
      () => [],
      () => 'Unexpected token in JSON'
    )
    const roots = await provider.getChildren()
    expect(roots).toHaveLength(1)
    const node = roots[0]
    expect(node.kind).toBe('error')
    if (node.kind !== 'error') {
      return
    }
    expect(node.text).toContain('静态配置读取失败')
    expect(node.text).toContain('Unexpected token in JSON')
    const item = provider.getTreeItem(node)
    expect((item.iconPath as vscode.ThemeIcon).id).toBe('error')
  })

  it('无配置且无错误：保留「暂无静态配置」引导态节点', async () => {
    const provider = new StaticConfigTreeProvider(() => [])
    const roots = await provider.getChildren()
    expect(roots).toEqual([
      {
        kind: 'empty',
        text: '暂无静态配置：运行「环境初始化」生成，或点击右上角打开配置文件',
      },
    ])
  })
})
