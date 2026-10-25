/**
 * 构建任务 HTTP 接口客户端（09 后分支编译改造：表单 → HTTP 提交 → 列表拉取）。
 *
 * - **打桩优先**：`baseUrl` 留空（默认）时使用 `StubBuildApiClient`——内存态任务表 +
 *   定时器模拟排队 / 构建中 / 成功 / 失败的完整生命周期，无真实网络依赖；
 * - **预留真实接口**：配置 `extStarter.buildApiBaseUrl` 后切换 `HttpBuildApiClient`
 *   （POST /builds 提交、GET /builds 拉取列表；Node 20 全局 fetch）。
 *   服务端契约 = 本文件的 `BuildSubmitPayload` / `BuildTask`（JSON）。
 */

export type BuildTaskStatus = 'queued' | 'running' | 'success' | 'failed'

export type BuildType = 'full' | 'incremental'

/** 提交构建任务的请求体（真实服务端契约）。 */
export interface BuildSubmitPayload {
  branch: string
  buildType: BuildType
  notes?: string
}

/** 构建任务快照（列表元素；真实服务端契约）。 */
export interface BuildTask {
  id: string
  branch: string
  buildType: BuildType
  status: BuildTaskStatus
  /** 进度 0-100 */
  progress: number
  notes?: string
  /** 失败原因 / 完成摘要 */
  message?: string
  /** ISO 时间 */
  createdAt: string
  finishedAt?: string
}

export interface BuildApiClient {
  /** 当前模式（stub = 打桩模拟；http = 真实接口） */
  readonly mode: 'stub' | 'http'
  /** 提交构建任务，返回创建后的任务快照 */
  submit(payload: BuildSubmitPayload): Promise<BuildTask>
  /** 拉取任务列表（最新在前） */
  list(): Promise<BuildTask[]>
  /** 释放内部定时器（扩展停用时调用；Http 实现为 no-op） */
  dispose(): void
}

export class BuildValidationError extends Error {
  constructor(
    message: string,
    /** 出错字段（协议 error 消息随行，页面据此定位控件） */
    readonly field?: string
  ) {
    super(message)
    this.name = 'BuildValidationError'
  }
}

/* ============================ 打桩实现 ============================ */

const STUB_SUBMIT_LATENCY_MS = 250

/** 真实接口单请求超时（毫秒）：超时即失败，避免页面提交态永久锁定。 */
const HTTP_REQUEST_TIMEOUT_MS = 10_000
/** queued → running 的等待 */
const STUB_QUEUE_MS = 1500
/** running 期间每个进度 tick */
const STUB_TICK_MS = 600
/** 每个 tick 的进度增量 */
const STUB_PROGRESS_STEP = 14
const STUB_MAX_TASKS = 50

/** 确定性演示规则：分支名含 fail（大小写不敏感）→ 构建失败，否则成功。 */
function willFail(branch: string): boolean {
  return branch.toLowerCase().includes('fail')
}

/**
 * 打桩客户端：内存任务表 + 定时器推进状态机。
 * 确定性优先——不引入随机数，失败路径由分支名规则触发，便于测试与演示复现。
 */
export class StubBuildApiClient implements BuildApiClient {
  readonly mode = 'stub' as const

  private tasks: BuildTask[] = []
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private seq = 0

  async submit(payload: BuildSubmitPayload): Promise<BuildTask> {
    const branch = payload.branch.trim()
    if (!branch) {
      throw new BuildValidationError('分支名不能为空。', 'branch')
    }
    await this.delay(STUB_SUBMIT_LATENCY_MS)
    const task: BuildTask = {
      id: `build-${Date.now()}-${++this.seq}`,
      branch,
      buildType: payload.buildType,
      status: 'queued',
      progress: 0,
      notes: payload.notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    }
    this.tasks.unshift(task)
    if (this.tasks.length > STUB_MAX_TASKS) {
      this.tasks.length = STUB_MAX_TASKS
    }
    this.scheduleRun(task.id)
    return { ...task }
  }

  async list(): Promise<BuildTask[]> {
    // 列表轮询高频（页面 3s 一次）：不模拟延迟，立即返回快照
    return this.tasks.map((task) => ({ ...task }))
  }

  dispose(): void {
    for (const timer of this.timers) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  /** 模拟服务端调度：排队 → 构建中（进度推进）→ 成功 / 失败。 */
  private scheduleRun(id: string): void {
    this.later(STUB_QUEUE_MS, () => {
      const task = this.tasks.find((candidate) => candidate.id === id)
      if (!task || task.status !== 'queued') {
        return
      }
      task.status = 'running'
      const tick = (): void => {
        const current = this.tasks.find((candidate) => candidate.id === id)
        if (!current || current.status !== 'running') {
          return
        }
        current.progress = Math.min(100, current.progress + STUB_PROGRESS_STEP)
        if (current.progress >= 100) {
          current.status = willFail(current.branch) ? 'failed' : 'success'
          current.finishedAt = new Date().toISOString()
          current.message = willFail(current.branch)
            ? '模拟失败：分支名包含 fail（打桩规则）'
            : `模拟构建完成（${current.buildType === 'full' ? '完整' : '增量'}）`
          return
        }
        this.later(STUB_TICK_MS, tick)
      }
      this.later(STUB_TICK_MS, tick)
    })
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      fn()
    }, ms)
    this.timers.add(timer)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => this.later(ms, resolve))
  }
}

/* ============================ 真实接口实现 ============================ */

/**
 * 真实 HTTP 客户端（Node 20 全局 fetch）。
 * 服务端契约：POST /builds（BuildSubmitPayload → BuildTask）、GET /builds（BuildTask[]）。
 * 接口路径 / 字段与服务端不一致时，只改本类，页面与协议层零改动。
 */
export class HttpBuildApiClient implements BuildApiClient {
  readonly mode = 'http' as const

  constructor(private readonly baseUrl: string) {}

  async submit(payload: BuildSubmitPayload): Promise<BuildTask> {
    const task = await this.request<BuildTask>('/builds', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (!task || typeof task.id !== 'string') {
      throw new Error('构建接口返回的任务缺少 id。')
    }
    return task
  }

  async list(): Promise<BuildTask[]> {
    const tasks = await this.request<BuildTask[]>('/builds')
    return Array.isArray(tasks) ? tasks : []
  }

  dispose(): void {
    // 无内部资源
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    // 10s 请求超时：挂起的 fetch 会让页面提交态被控制器「保持锁定」，
    // 显式 abort 后走错误路径解锁（与控制器 10s 超时同量级）
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      ...init,
    })
    if (!response.ok) {
      throw new Error(`构建接口 ${init?.method ?? 'GET'} ${path} 失败：HTTP ${response.status}`)
    }
    return (await response.json()) as T
  }
}

/** 工厂：配置了 baseUrl 走真实接口，否则打桩模拟（默认）。 */
export function createBuildApiClient(baseUrl: string): BuildApiClient {
  return baseUrl.trim().length > 0
    ? new HttpBuildApiClient(baseUrl.trim())
    : new StubBuildApiClient()
}
