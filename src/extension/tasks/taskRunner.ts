import * as vscode from 'vscode'
import { formatTaskResult } from './environmentTask'
import type { StartupTask, TaskContext, TaskItem, TaskResult, TaskSignal } from './types'

/** 单任务默认超时（毫秒）：挂死任务由 TaskRunner 强制裁决为 error，不锁死后续任务。 */
export const DEFAULT_TASK_TIMEOUT_MS = 60000

/**
 * 最小取消信号源（对齐 vscode.CancellationTokenSource 语义）。
 * 独立实现而非直接使用 vscode.CancellationTokenSource：便于单元测试与脱离宿主复用
 * （如 initSteps 现场运行环境探测时构造 TaskContext）。
 */
export class TaskSignalSource implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>()
  private cancelled = false

  /** 当前信号（可分发给任务 / 子进程执行器）。 */
  get signal(): TaskSignal {
    const source = this
    return {
      get isCancellationRequested(): boolean {
        return source.cancelled
      },
      onCancellationRequested: (listener: () => void) => source.emitter.event(listener),
    }
  }

  get isCancellationRequested(): boolean {
    return this.cancelled
  }

  /** 触发取消（幂等）：所有已注册监听器收到通知。 */
  cancel(): void {
    if (this.cancelled) {
      return
    }
    this.cancelled = true
    this.emitter.fire()
  }

  dispose(): void {
    this.emitter.dispose()
  }
}

/** 超时裁决用的一次性错误（runTask 内部使用）。 */
class TaskTimeoutMarker extends Error {
  constructor() {
    super('任务超时')
    this.name = 'TaskTimeoutMarker'
  }
}

/**
 * 启动任务调度器：依次执行注册表中的任务，汇总结果并写入输出通道。
 * - 结果经 onDidChangeItems 事件通知界面（环境信息树视图）刷新：
 *   开始一次、**每个任务完成后各一次**（进度语义）、结束一次；
 * - 单任务异常 / 超时 / 结果形状不合法被降级为 error 结果，不影响后续任务；
 * - runAll 重入保护：上一次未结束前忽略新的触发（输出通道记录）；
 * - running 由 try/finally 保证复位（P1-11：事件监听抛错不再永久忙）；
 * - dispose 时取消进行中的任务（signal 触发，任务可据此提前终止）。
 */
export class TaskRunner implements vscode.Disposable {
  private results: TaskResult[] = []
  private running = false
  private completedCount = 0
  private signalSource = new TaskSignalSource()

  private readonly _onDidChangeItems = new vscode.EventEmitter<void>()
  /** 任务执行前/后触发（视图据此显示「检测中」或最新结果）。 */
  readonly onDidChangeItems = this._onDidChangeItems.event

  constructor(
    private readonly tasks: StartupTask[],
    private readonly output: vscode.OutputChannel
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  /** 当前进度（含进度语义：视图可展示 completed/total）。 */
  get progress(): { total: number; completed: number } {
    return { total: this.tasks.length, completed: this.completedCount }
  }

  get lastResults(): TaskResult[] {
    return [...this.results]
  }

  /** 执行全部注册任务。启动时由 extension.ts 调用（不 await，避免阻塞激活）。 */
  async runAll(): Promise<void> {
    if (this.running) {
      this.output.appendLine('[启动任务] 上一次仍在执行，已忽略本次触发。')
      return
    }
    this.running = true
    try {
      this.results = []
      this.completedCount = 0
      this.signalSource = new TaskSignalSource()
      this._onDidChangeItems.fire()

      this.output.appendLine(`[启动任务] 开始执行 ${this.tasks.length} 个任务…`)
      const ctx: TaskContext = {
        output: this.output,
        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri,
        signal: this.signalSource.signal,
      }
      for (const task of this.tasks) {
        if (this.signalSource.isCancellationRequested) {
          this.output.appendLine('[启动任务] 已取消，跳过剩余任务。')
          break
        }
        const result = await this.runTask(task, ctx)
        this.writeResult(result)
        this.results.push(result)
        this.completedCount += 1
        this._onDidChangeItems.fire() // 逐任务事件：视图可按 progress 展示进度
      }
    } finally {
      // P1-11：无论事件监听抛错 / 任务如何失败，running 必须复位
      this.running = false
      this._onDidChangeItems.fire()
    }
  }

  /**
   * 就地更新某任务结果中的单条条目（09 方案阶段 3：单探针重检）。
   * - 按 taskId 定位结果、按 label 替换条目；任一不匹配则忽略（防误改）；
   * - 替换后按「是否仍有缺失」重算该结果的状态并广播刷新。
   */
  updateItem(taskId: string, item: TaskItem): boolean {
    const result = this.results.find((candidate) => candidate.taskId === taskId)
    if (!result) {
      return false
    }
    const index = result.items.findIndex(
      (candidate) => candidate.label.toLowerCase() === item.label.toLowerCase()
    )
    if (index < 0) {
      return false
    }
    result.items[index] = item
    const missing = result.items.filter((entry) => entry.status !== 'ok').length
    result.status = missing === 0 ? 'ok' : 'warn'
    result.finishedAt = new Date().toISOString()
    this.writeResult({ ...result, items: [item], durationMs: 0 })
    this._onDidChangeItems.fire()
    return true
  }

  /** 执行单个任务：超时裁决（Promise.race）+ 异常降级 + 结果形状校验。 */
  private async runTask(task: StartupTask, ctx: TaskContext): Promise<TaskResult> {
    const startedAt = Date.now()
    const timeoutMs = task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        reject(new TaskTimeoutMarker())
      }, timeoutMs)
    })
    try {
      const result = await Promise.race([task.run(ctx), timeoutPromise])
      if (!isTaskResultLike(result)) {
        // 结果形状校验：items 非数组等结构性问题降级为 error，避免视图渲染抛错
        return this.degrade(
          task,
          startedAt,
          `任务返回的结果不合法（items 必须是数组）：${describe(result)}`
        )
      }
      return result
    } catch (err) {
      const message = timedOut
        ? `任务超时（超过 ${timeoutMs}ms）`
        : err instanceof Error
          ? err.message
          : String(err)
      return this.degrade(task, startedAt, message)
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }

  /** 统一降级为 error 结果（异常 / 超时 / 形状不合法共用）。 */
  private degrade(task: StartupTask, startedAt: number, message: string): TaskResult {
    return {
      taskId: task.id,
      taskTitle: task.title,
      status: 'error',
      durationMs: Date.now() - startedAt,
      finishedAt: new Date().toISOString(),
      items: [],
      summary: message,
    }
  }

  private writeResult(result: TaskResult): void {
    for (const line of formatTaskResult(result)) {
      this.output.appendLine(line)
    }
  }

  dispose(): void {
    // 取消进行中的任务（信号触发后任务可提前终止；剩余任务不再执行）
    this.signalSource.cancel()
    this._onDidChangeItems.dispose()
  }
}

/** 结果形状校验：TaskResult 且 items 为数组（P1-11：防止坏结果炸视图）。 */
function isTaskResultLike(value: unknown): value is TaskResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<TaskResult>
  return (
    typeof candidate.taskId === 'string' &&
    typeof candidate.taskTitle === 'string' &&
    Array.isArray(candidate.items)
  )
}

/** 降级信息里对非法结果的简要描述。 */
function describe(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value)
  }
  if (typeof value !== 'object') {
    return `${typeof value}`
  }
  return Array.isArray(value) ? 'array' : 'object'
}
