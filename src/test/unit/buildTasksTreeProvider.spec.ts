import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { BuildTasksTreeProvider } from '../../extension/features/build/buildTasksTreeProvider'
import type { BuildApiClient, BuildTask } from '../../extension/features/build/buildApiClient'
import { __resetStubs } from './stubs/vscode'

/**
 * 「构建任务」树视图（v2.1：分支编译侧边栏入口）：
 * - 任务条目映射（状态图标 / 描述 / contextValue / 单击打开控制台）；
 * - 空态与拉取失败 info 节点（失败保留旧数据）；
 * - 可见期轮询开关（幂等、dispose 清理）。
 */

function makeApi(tasks: BuildTask[] = [], fail = false): BuildApiClient & { calls: number } {
  return {
    calls: 0,
    mode: 'stub',
    async submit() {
      throw new Error('not used')
    },
    async list() {
      this.calls += 1
      if (fail) {
        throw new Error('HTTP 503')
      }
      return tasks.map((task) => ({ ...task }))
    },
    dispose() {},
  }
}

function makeTask(overrides: Partial<BuildTask> = {}): BuildTask {
  return {
    id: 'build-1',
    branch: 'release/1.0.0',
    buildType: 'full',
    status: 'running',
    progress: 42,
    createdAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  }
}

describe('BuildTasksTreeProvider（构建任务树视图，v2.1）', () => {
  beforeEach(() => {
    __resetStubs()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('任务条目：分支为 label、状态+进度+类型为 description、图标按状态、单击路由打开控制台', async () => {
    const provider = new BuildTasksTreeProvider(
      makeApi([
        makeTask(),
        makeTask({
          id: 'b2',
          branch: 'hotfix/fail',
          status: 'failed',
          progress: 100,
          buildType: 'incremental',
        }),
      ])
    )
    await provider.refresh()
    const children = await provider.getChildren()
    expect(children).toHaveLength(2)

    const item = provider.getTreeItem(children[0] as { kind: 'task'; task: BuildTask })
    expect(item.label).toBe('release/1.0.0')
    expect(item.description).toBe('构建中 42% · 完整')
    expect((item.iconPath as vscode.ThemeIcon).id).toBe('sync~spin')
    expect(item.contextValue).toBe('buildTask')
    expect(item.command?.command).toBe('extStarter.buildBranch')

    const failed = provider.getTreeItem(children[1] as { kind: 'task'; task: BuildTask })
    expect((failed.iconPath as vscode.ThemeIcon).id).toBe('error')
    expect(failed.description).toBe('失败 · 增量')
    provider.dispose()
  })

  it('空列表 → 引导 info 节点；拉取失败 → 错误 info 节点且保留旧数据', async () => {
    const api = makeApi([])
    const provider = new BuildTasksTreeProvider(api)
    await provider.refresh()
    expect(await provider.getChildren()).toEqual([
      { kind: 'info', text: '暂无构建任务：点击标题栏「打开控制台」提交', icon: 'info' },
    ])

    // 先有数据，再让接口失败：错误提示 + 旧数据保留
    const failing = makeApi([], true)
    const provider2 = new BuildTasksTreeProvider(failing)
    await provider2.refresh()
    const nodes = await provider2.getChildren()
    expect(nodes).toEqual([{ kind: 'info', text: '列表拉取失败：HTTP 503', icon: 'error' }])
    provider.dispose()
    provider2.dispose()
  })

  it('setPolling(true)：立即拉取 + 每 3s 轮询；false 停止；幂等', async () => {
    const api = makeApi([makeTask()])
    const provider = new BuildTasksTreeProvider(api)
    let events = 0
    provider.onDidChangeTreeData(() => events++)

    provider.setPolling(true)
    provider.setPolling(true) // 幂等：不重复启动
    await vi.advanceTimersByTimeAsync(0)
    expect(api.calls).toBe(1) // 立即拉取一次
    await vi.advanceTimersByTimeAsync(6500)
    expect(api.calls).toBe(1 + 2) // 3s × 2 次轮询
    expect(events).toBeGreaterThanOrEqual(3)

    provider.setPolling(false)
    const callsAtStop = api.calls
    await vi.advanceTimersByTimeAsync(9000)
    expect(api.calls).toBe(callsAtStop) // 已停止
    provider.dispose()
  })

  it('dispose：清理轮询定时器', async () => {
    const api = makeApi([makeTask()])
    const provider = new BuildTasksTreeProvider(api)
    provider.setPolling(true)
    await vi.advanceTimersByTimeAsync(0)
    provider.dispose()
    const calls = api.calls
    await vi.advanceTimersByTimeAsync(9000)
    expect(api.calls).toBe(calls)
  })
})
