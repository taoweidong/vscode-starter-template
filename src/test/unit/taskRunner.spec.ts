import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { __resetStubs, __stubs } from './stubs/vscode'
import { DEFAULT_TASK_TIMEOUT_MS, TaskRunner, TaskSignalSource } from '../../tasks/taskRunner'
import type { StartupTask, TaskContext, TaskResult } from '../../tasks/types'

/** 构造合法任务结果。 */
function okResult(id: string, title: string): TaskResult {
  return {
    taskId: id,
    taskTitle: title,
    status: 'ok',
    durationMs: 1,
    finishedAt: new Date().toISOString(),
    items: [{ label: '示例', description: '1.0.0', status: 'ok' }],
  }
}

/** 构造任务：behavior 内可断言 ctx（输出通道 / 工作区根 / 取消信号）。 */
function fakeTask(id: string, behavior: (ctx: TaskContext) => Promise<TaskResult>): StartupTask {
  return {
    id,
    title: `任务-${id}`,
    async run(ctx) {
      return behavior(ctx)
    },
  }
}

const outputLines = (): string[] => __stubs.outputLines

/** T5.4 / P1-11：TaskRunner 生命周期——try/finally、逐任务事件、超时、取消、重入。 */
describe('TaskRunner 生命周期', () => {
  let output: vscode.OutputChannel

  beforeEach(() => {
    __resetStubs()
    output = vscode.window.createOutputChannel('CRUD Starter Test')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('逐任务执行后各 fire 一次（进度语义）：2 任务 → 开始 1 + 逐任务 2 + 结束 1', async () => {
    const order: string[] = []
    const runner = new TaskRunner(
      [
        fakeTask('a', async () => {
          order.push('a')
          return okResult('a', 'A')
        }),
        fakeTask('b', async () => {
          order.push('b')
          return okResult('b', 'B')
        }),
      ],
      output
    )
    let events = 0
    runner.onDidChangeItems(() => {
      events += 1
    })
    await runner.runAll()
    expect(order).toEqual(['a', 'b'])
    expect(events).toBe(4) // 任务数 + 2
    expect(runner.progress).toEqual({ total: 2, completed: 2 })
    expect(runner.lastResults.map((result) => result.taskId)).toEqual(['a', 'b'])
  })

  it('任务抛错降级为 error 且不影响后续任务', async () => {
    const runner = new TaskRunner(
      [
        fakeTask('boom', async () => {
          throw new Error('boom')
        }),
        fakeTask('ok', async () => okResult('ok', 'OK')),
      ],
      output
    )
    await runner.runAll()
    expect(runner.lastResults[0].status).toBe('error')
    expect(runner.lastResults[0].summary).toContain('boom')
    expect(runner.lastResults[1].status).toBe('ok')
  })

  it('结果形状校验：items 非数组 → 降级为 error（不炸视图）', async () => {
    const runner = new TaskRunner(
      [
        fakeTask(
          'bad',
          async () =>
            ({
              taskId: 'bad',
              taskTitle: '坏结果',
              status: 'ok',
              durationMs: 1,
              finishedAt: new Date().toISOString(),
              items: '不是数组',
            }) as unknown as TaskResult
        ),
        fakeTask('nullish', async () => null as unknown as TaskResult),
      ],
      output
    )
    await runner.runAll()
    expect(runner.lastResults[0].status).toBe('error')
    expect(runner.lastResults[0].summary).toContain('不合法')
    expect(runner.lastResults[1].status).toBe('error')
  })

  it('任务超时：Promise.race 裁决为 error「任务超时」，后续任务继续', async () => {
    vi.useFakeTimers()
    const runner = new TaskRunner(
      [
        {
          id: 'hang',
          title: '挂死任务',
          timeoutMs: 100,
          async run() {
            return new Promise<TaskResult>(() => {
              /* 永不完成 */
            })
          },
        },
        fakeTask('ok', async () => okResult('ok', 'OK')),
      ],
      output
    )
    const pending = runner.runAll()
    await vi.advanceTimersByTimeAsync(100)
    await pending
    expect(runner.lastResults[0].status).toBe('error')
    expect(runner.lastResults[0].summary).toContain('任务超时')
    expect(runner.lastResults[0].summary).toContain('100')
    expect(runner.lastResults[1].status).toBe('ok')
  })

  it('缺省超时为 DEFAULT_TASK_TIMEOUT_MS（60000ms）', async () => {
    vi.useFakeTimers()
    const runner = new TaskRunner(
      [
        {
          id: 'hang',
          title: '挂死任务',
          async run() {
            return new Promise<TaskResult>(() => {
              /* 永不完成 */
            })
          },
        },
      ],
      output
    )
    const pending = runner.runAll()
    await vi.advanceTimersByTimeAsync(DEFAULT_TASK_TIMEOUT_MS - 1)
    expect(runner.isRunning).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(runner.lastResults[0].summary).toContain('任务超时')
  })

  it('重入保护：上一次未结束时忽略并记录到输出通道', async () => {
    let releaseFirst!: () => void
    const runner = new TaskRunner(
      [
        fakeTask('slow', async () => {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
          return okResult('slow', '慢任务')
        }),
      ],
      output
    )
    const first = runner.runAll()
    await Promise.resolve() // 让首个任务进入 await
    await runner.runAll() // 重入：应被忽略
    expect(outputLines().some((line) => line.includes('上一次仍在执行，已忽略'))).toBe(true)
    releaseFirst()
    await first
    expect(runner.lastResults).toHaveLength(1)
    expect(runner.isRunning).toBe(false)
  })

  it('P1-11：事件监听抛错后 running 仍复位（try/finally），可再次 runAll', async () => {
    const runner = new TaskRunner([fakeTask('a', async () => okResult('a', 'A'))], output)
    let firstFire = true
    runner.onDidChangeItems(() => {
      if (firstFire) {
        firstFire = false
        throw new Error('监听器爆炸')
      }
    })
    await expect(runner.runAll()).rejects.toThrow('监听器爆炸')
    expect(runner.isRunning).toBe(false)
    // 修复后的关键承诺：不会永久忙
    await runner.runAll()
    expect(runner.lastResults).toHaveLength(1)
  })

  it('dispose 取消进行中的任务：当前任务可感知取消，剩余任务被跳过', async () => {
    const executed: string[] = []
    const runner = new TaskRunner(
      [
        fakeTask('blocking', async (ctx) => {
          executed.push('blocking-start')
          await new Promise<void>((resolve) => {
            ctx.signal.onCancellationRequested(resolve)
          })
          executed.push('blocking-end')
          return okResult('blocking', '阻塞任务')
        }),
        fakeTask('after', async () => {
          executed.push('after')
          return okResult('after', '后续任务')
        }),
      ],
      output
    )
    const pending = runner.runAll()
    await Promise.resolve()
    runner.dispose()
    await pending
    expect(executed).toEqual(['blocking-start', 'blocking-end'])
    expect(runner.lastResults).toHaveLength(1) // 「after」被跳过
    expect(outputLines().some((line) => line.includes('跳过剩余任务'))).toBe(true)
  })

  it('TaskContext 注入：任务可拿到输出通道与工作区根', async () => {
    __stubs.workspaceFolders = [{ uri: vscode.Uri.file('E:/ws/root'), name: 'root', index: 0 }]
    let seenRoot: string | undefined
    let seenOutputName: string | undefined
    const runner = new TaskRunner(
      [
        fakeTask('ctx', async (ctx) => {
          seenRoot = ctx.workspaceRoot?.fsPath
          seenOutputName = ctx.output.name
          return okResult('ctx', 'CTX')
        }),
      ],
      output
    )
    await runner.runAll()
    expect(seenRoot).toBe(vscode.Uri.file('E:/ws/root').fsPath)
    expect(seenOutputName).toBe('CRUD Starter Test')
  })
})

/** TaskSignalSource：最小取消信号源。 */
describe('TaskSignalSource', () => {
  it('cancel 后信号翻转且监听器收到通知（幂等）', () => {
    const source = new TaskSignalSource()
    const signal = source.signal
    expect(signal.isCancellationRequested).toBe(false)
    let notified = 0
    const sub = signal.onCancellationRequested(() => {
      notified += 1
    })
    source.cancel()
    source.cancel() // 幂等：重复取消不再触发
    expect(signal.isCancellationRequested).toBe(true)
    expect(notified).toBe(1)
    sub.dispose()
    source.dispose()
  })
})
