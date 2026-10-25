import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BuildValidationError,
  HttpBuildApiClient,
  StubBuildApiClient,
  createBuildApiClient,
} from '../../extension/features/build/buildApiClient'

/**
 * 构建任务 HTTP 客户端（v2.0 分支编译改造）：
 * - Stub 打桩实现：内存任务表 + 定时器推进排队 → 构建中 → 成功 / 失败（确定性规则）；
 * - 工厂路由：baseUrl 空 → Stub（默认打桩），非空 → Http（真实接口预留）。
 * 全部用 fake timers 驱动，无真实等待。
 */

describe('StubBuildApiClient（打桩模拟）', () => {
  let client: StubBuildApiClient

  beforeEach(() => {
    vi.useFakeTimers()
    client = new StubBuildApiClient()
  })

  afterEach(() => {
    client.dispose()
    vi.useRealTimers()
  })

  /** 推进到任务终态（排队 1.5s + 进度 tick 600ms × 若干）。 */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(8000)
  }

  it('submit：校验分支名必填（错误带 field 供表单定位）', async () => {
    // 校验在延迟之前同步抛出：直接经 catch 取错误对象断言（避免拒绝事件竞态）
    const err = (await client
      .submit({ branch: '   ', buildType: 'full' })
      .catch((caught: unknown) => caught)) as BuildValidationError
    expect(err).toBeInstanceOf(BuildValidationError)
    expect(err.message).toContain('分支名不能为空')
    expect(err.field).toBe('branch')
  })

  it('submit：创建任务后依序推进 queued → running → success（进度 100、有完成时间）', async () => {
    const submitPromise = client.submit({ branch: 'release/1.0.0', buildType: 'full' })
    await vi.advanceTimersByTimeAsync(300)
    const created = await submitPromise
    expect(created.status).toBe('queued')
    expect(created.progress).toBe(0)
    expect(created.id).toMatch(/^build-/)

    await vi.advanceTimersByTimeAsync(1500)
    expect((await client.list())[0].status).toBe('running')

    await settle()
    const done = (await client.list())[0]
    expect(done.status).toBe('success')
    expect(done.progress).toBe(100)
    expect(done.finishedAt).toBeTruthy()
    expect(done.message).toContain('模拟构建完成')
  })

  it('确定性失败规则：分支名含 fail → failed 且 message 说明打桩规则', async () => {
    const submitPromise = client.submit({ branch: 'hotfix/fail-case', buildType: 'incremental' })
    await vi.advanceTimersByTimeAsync(300)
    await submitPromise
    await settle()
    const done = (await client.list())[0]
    expect(done.status).toBe('failed')
    expect(done.message).toContain('模拟失败')
  })

  it('list：最新在前；notes 透传；增量类型保留', async () => {
    const first = client.submit({ branch: 'a/first', buildType: 'full', notes: '第一条' })
    await vi.advanceTimersByTimeAsync(300)
    await first
    const second = client.submit({ branch: 'b/second', buildType: 'incremental' })
    await vi.advanceTimersByTimeAsync(300)
    await second
    const tasks = await client.list()
    expect(tasks.map((task) => task.branch)).toEqual(['b/second', 'a/first'])
    expect(tasks[1].notes).toBe('第一条')
    expect(tasks[0].buildType).toBe('incremental')
  })

  it('dispose：清空定时器，任务停留在当前状态', async () => {
    const submitPromise = client.submit({ branch: 'release/x', buildType: 'full' })
    await vi.advanceTimersByTimeAsync(300)
    await submitPromise
    client.dispose()
    await settle()
    expect((await client.list())[0].status).toBe('queued')
  })
})

describe('createBuildApiClient（工厂路由）', () => {
  it('baseUrl 为空 → Stub 打桩（默认）；非空 → Http 真实接口', () => {
    expect(createBuildApiClient('')).toBeInstanceOf(StubBuildApiClient)
    expect(createBuildApiClient('  ')).toBeInstanceOf(StubBuildApiClient)
    expect(createBuildApiClient('http://127.0.0.1:3000')).toBeInstanceOf(HttpBuildApiClient)
  })
})

describe('HttpBuildApiClient（真实接口契约）', () => {
  it('POST /builds 提交、GET /builds 拉取；非 2xx 抛错（URL 去尾斜杠）', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/builds') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 't1', branch: 'x', status: 'queued' }), {
          status: 200,
        })
      }
      if (String(url).endsWith('/builds')) {
        return new Response(JSON.stringify([{ id: 't1', branch: 'x', status: 'queued' }]), {
          status: 200,
        })
      }
      return new Response('nope', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpBuildApiClient('http://127.0.0.1:3000///')
      const task = await client.submit({ branch: 'x', buildType: 'full' })
      expect(task.id).toBe('t1')
      const tasks = await client.list()
      expect(tasks).toHaveLength(1)
      expect(calls[0].url).toBe('http://127.0.0.1:3000/builds')
      expect(calls[0].init?.method).toBe('POST')
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        branch: 'x',
        buildType: 'full',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
