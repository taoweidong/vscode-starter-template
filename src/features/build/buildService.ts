import * as childProcess from 'child_process'
import * as vscode from 'vscode'
import type { TaskSignal } from '../../tasks/types'

export interface GitInfo {
  /** 当前目录是否为 Git 仓库 */
  available: boolean
  current?: string
  branches: string[]
}

export interface BuildResult {
  branch?: string
  status: 'ok' | 'warn' | 'error'
  durationMs: number
  finishedAt: string
  message: string
  /** 生成的 .vsix 路径（出包成功时） */
  artifact?: string
}

const EXEC_TIMEOUT_MS = 300000
/** GitInfo 缓存有效期：树视图刷新频繁，避免每次 spawn 两个 git 进程 */
const GIT_CACHE_TTL_MS = 5000
/** Git 快速查询（rev-parse / branch / status）超时 */
const GIT_QUERY_TIMEOUT_MS = 10000
/** 分支切换超时 */
const GIT_CHECKOUT_TIMEOUT_MS = 60000
/** vsce 可用性探测超时 */
const VSCE_PROBE_TIMEOUT_MS = 30000

/**
 * 脏检查时忽略的路径前缀（T5.4 / P1-09）：
 * 插件自身数据文件与本地产物目录默认不纳入「未提交修改」判定，
 * 避免用过一次 CRUD 后分支切换永远失败（自阻断）。
 */
export const DEFAULT_DIRTY_IGNORES = ['.vscode/crud-starter-items.json', '.crud-starter/']

/** 一条待执行命令（spawn 参数数组形态，杜绝 shell 拼接注入，P0-05）。 */
export interface CommandSpec {
  command: string
  args: readonly string[]
  cwd: string
  timeoutMs?: number
}

/** 用户取消编译（子进程已被 kill）。 */
export class BuildCancelledError extends Error {
  constructor(message = '编译任务已取消。') {
    super(message)
    this.name = 'BuildCancelledError'
  }
}

/** 命令执行超时（子进程已被 kill）。 */
export class CommandTimeoutError extends Error {
  constructor(spec: CommandSpec) {
    super(`命令超时：${spec.command} ${spec.args.join(' ')}`)
    this.name = 'CommandTimeoutError'
  }
}

/**
 * 可注入的命令执行器（默认实现为 spawn 参数数组 + shell:false）。
 * 返回 stdout；失败抛错（含 stderr 摘要）。token 触发取消时 kill 子进程并抛 BuildCancelledError。
 */
export type CommandRunner = (spec: CommandSpec, token?: TaskSignal) => Promise<string>

/** Windows 下 npm / npx 是 .cmd 脚本，Node 出于安全（CVE-2024-27980）禁止无 shell 直接
 * spawn .cmd/.bat——经由 cmd.exe /c 包装；参数全部为固定常量，不含任何用户输入。 */
function npmCommand(): { command: string; prefix: string[] } {
  return process.platform === 'win32'
    ? { command: 'cmd.exe', prefix: ['/c', 'npm'] }
    : { command: 'npm', prefix: [] }
}

function npxCommand(): { command: string; prefix: string[] } {
  return process.platform === 'win32'
    ? { command: 'cmd.exe', prefix: ['/c', 'npx'] }
    : { command: 'npx', prefix: [] }
}

/** 默认命令执行器：spawn（shell:false、参数数组、windowsHide），支持取消与超时。 */
export function spawnCommand(spec: CommandSpec, token?: TaskSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = childProcess.spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let cancelSub: vscode.Disposable | undefined
    const settle = (action: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      cancelSub?.dispose()
      action()
    }
    const timer = setTimeout(() => {
      child.kill()
      settle(() => reject(new CommandTimeoutError(spec)))
    }, spec.timeoutMs ?? EXEC_TIMEOUT_MS)
    cancelSub = token?.onCancellationRequested(() => {
      child.kill()
      settle(() => reject(new BuildCancelledError()))
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      settle(() =>
        reject(new Error(`命令失败：${spec.command} ${spec.args.join(' ')}\n${err.message}`))
      )
    })
    child.on('close', (code) => {
      settle(() => {
        if (code === 0) {
          resolve(stdout)
          return
        }
        const detail = (stderr || stdout || `退出码 ${code}`)
          .trim()
          .split(/\r?\n/)
          .slice(-3)
          .join('\n')
        reject(new Error(`命令失败：${spec.command} ${spec.args.join(' ')}\n${detail}`))
      })
    })
  })
}

/**
 * 过滤 git status --porcelain 输出：忽略插件自身数据文件等指定前缀后返回剩余脏行。
 * porcelain 行形如 ` M path`、`?? dir/`、`R  old -> new`（前两列是状态码 XY，其后才是路径），
 * 路径可能带引号；注意必须从**原始行**第 3 列起取路径（先 trim 会吃掉空白状态位破坏列对齐）。
 */
export function filterDirtyLines(
  porcelain: string,
  ignorePrefixes: readonly string[] = DEFAULT_DIRTY_IGNORES
): string[] {
  const unquote = (path: string): string =>
    path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path
  const isIgnored = (path: string): boolean =>
    ignorePrefixes.some(
      (prefix) => path === prefix || (prefix.endsWith('/') && path.startsWith(prefix))
    )
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .filter((line) => {
      // 原始行前两列为状态码（XY），第 3 列起是路径；不足 3 列的异常行按整行处理
      const raw = line.length >= 3 ? line.slice(3).trim() : line.trim()
      if (!raw) {
        return true
      }
      // 重命名行「old -> new」：两边任一命中忽略前缀即忽略
      const parts = raw.includes(' -> ')
        ? raw.split(' -> ').map((part) => unquote(part.trim()))
        : [unquote(raw)]
      return !parts.some((part) => isIgnored(part))
    })
    .map((line) => line.trim())
}

/** BuildService 的可注入依赖。 */
export interface BuildServiceOptions {
  /** 命令执行器（默认 spawn 参数数组实现；单测注入假 runner 记录调用 / 编程失败）。 */
  runCommand?: CommandRunner
  /** 脏检查忽略前缀（默认 DEFAULT_DIRTY_IGNORES；可按实际 storagePath 配置追加）。 */
  dirtyIgnorePrefixes?: string[]
}

/**
 * 分支编译出包服务：演示「任务自动化 + 进度反馈 + 终端输出」模式。
 * 流程：选择分支 →（切换前 check-ref-format 校验 + 脏检查 + 模态确认）→ npm run package →
 * 检测到 vsce 时追加 .vsix 打包 → 结果记录到视图与输出通道。
 *
 * 生命周期契约（T5.4 / P0-05 / P1-09 / P1-10）：
 * - 信任边界：不受信任工作区直接拒绝（配合 manifest 的 capabilities.untrustedWorkspaces）；
 * - 互斥：running 标志，并发 build 返回 error「已有编译任务进行中」；
 * - 取消：withProgress cancellable 全流程包裹，取消时 kill 子进程并返回 error；
 * - shell 安全：全部命令 spawn 参数数组 + shell:false；分支名经 git check-ref-format 预检；
 * - 脏检查：排除插件自身数据文件（P1-09 自阻断）；
 * - 分支切换前模态确认，失败结果附「可用 git checkout <原分支> 恢复」指引。
 */
export class BuildService implements vscode.Disposable {
  private lastBuild: BuildResult | undefined
  private gitCache: { info: GitInfo; at: number } | undefined
  private running = false
  private readonly runCommand: CommandRunner
  private readonly dirtyIgnorePrefixes: readonly string[]

  private readonly _onDidChangeItems = new vscode.EventEmitter<void>()
  readonly onDidChangeItems = this._onDidChangeItems.event

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly getCwd: () => string | undefined,
    options: BuildServiceOptions = {}
  ) {
    this.runCommand = options.runCommand ?? spawnCommand
    this.dirtyIgnorePrefixes = options.dirtyIgnorePrefixes ?? DEFAULT_DIRTY_IGNORES
  }

  get isRunning(): boolean {
    return this.running
  }

  getLastBuild(): BuildResult | undefined {
    return this.lastBuild
  }

  /** 读取当前分支与分支列表（非 Git 仓库时 available=false，不抛错）。
   * 结果带 5 秒 TTL 缓存，避免树视图频繁刷新时反复 spawn git 进程；build 等需要最新状态时传 force。 */
  async getGitInfo(force = false): Promise<GitInfo> {
    const now = Date.now()
    if (!force && this.gitCache && now - this.gitCache.at < GIT_CACHE_TTL_MS) {
      return this.gitCache.info
    }
    const cwd = this.getCwd()
    let info: GitInfo
    if (!cwd) {
      info = { available: false, branches: [] }
    } else {
      try {
        const current = (
          await this.runCommand({
            command: 'git',
            args: ['rev-parse', '--abbrev-ref', 'HEAD'],
            cwd,
            timeoutMs: GIT_QUERY_TIMEOUT_MS,
          })
        ).trim()
        const branches = (
          await this.runCommand({
            command: 'git',
            args: ['branch', '--format=%(refname:short)'],
            cwd,
            timeoutMs: GIT_QUERY_TIMEOUT_MS,
          })
        )
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        info = { available: true, current, branches }
      } catch {
        info = { available: false, branches: [] }
      }
    }
    this.gitCache = { info, at: now }
    return info
  }

  /** 编译出包。传入 branch 且与当前分支不同时，先校验分支名与工作区干净、模态确认再切换。 */
  async build(branch?: string): Promise<BuildResult> {
    const startedAt = Date.now()
    // 信任边界（P0-05）：不受信任的工作区禁止执行分支编译（会运行工作区脚本 / 切换工作区状态）
    if (vscode.workspace.isTrusted === false) {
      return this.fail('error', '当前工作区不受信任，已禁用分支编译。', startedAt, branch)
    }
    // 互斥（P1-10）：并发 build 会互毁 dist/，直接拒绝
    if (this.running) {
      return this.fail('error', '已有编译任务进行中，请稍后再试。', startedAt, branch)
    }
    const cwd = this.getCwd()
    if (!cwd) {
      return this.fail('error', '未打开工作区，无法编译。', startedAt, branch)
    }

    this.running = true
    try {
      // 取消（P1-10）：全流程 withProgress cancellable 包裹，取消时 kill 子进程
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'CRUD Starter：分支编译',
          cancellable: true,
        },
        (progress, token) => this.runFlow(branch, cwd, progress, token, startedAt)
      )
    } finally {
      this.running = false
    }
  }

  /** 编译主流程（build 内部调用；进度与取消令牌来自 withProgress）。 */
  private async runFlow(
    branch: string | undefined,
    cwd: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
    startedAt: number
  ): Promise<BuildResult> {
    const fail = (status: 'warn' | 'error', message: string, artifact?: string): BuildResult => {
      const result: BuildResult = {
        branch,
        status,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date().toISOString(),
        message,
        artifact,
      }
      this.lastBuild = result
      this._onDidChangeItems.fire()
      return result
    }
    const cancelled = (err: unknown): boolean =>
      err instanceof BuildCancelledError || token.isCancellationRequested

    progress.report({ message: '读取 Git 信息…' })
    this.output.appendLine(`[编译] 开始（分支：${branch ?? '当前'}）…`)
    const git = await this.getGitInfo(true)
    if (!git.available) {
      return fail('error', '当前工作区不是 Git 仓库，无法获取分支信息。')
    }
    const target = branch || git.current
    const originalBranch = git.current
    // 切换成功后停留在目标分支：任何后续失败都附恢复指引（P1-10）
    const recovery = () => `当前已停留在 ${target} 分支，可用 git checkout ${originalBranch} 恢复。`

    let switched = false
    if (branch && branch !== originalBranch) {
      // 分支名预检（P0-05）：git check-ref-format 而非正则白名单（拒绝控制字符 / 空格 / ~^:?*[\ 等）
      progress.report({ message: `校验分支名 ${branch}…` })
      if (!(await this.isValidBranchName(branch, cwd))) {
        return fail('error', `分支名不合法：${branch}`)
      }
      // 脏检查（P1-09）：过滤插件自身数据文件后再判脏
      progress.report({ message: '检查工作区是否干净…' })
      let dirtyLines: string[]
      try {
        const porcelain = await this.runCommand(
          { command: 'git', args: ['status', '--porcelain'], cwd, timeoutMs: GIT_QUERY_TIMEOUT_MS },
          token
        )
        dirtyLines = filterDirtyLines(porcelain, this.dirtyIgnorePrefixes)
      } catch (err) {
        if (cancelled(err)) {
          return fail('error', '已取消编译。')
        }
        return fail(
          'error',
          `读取工作区状态失败：${err instanceof Error ? err.message : String(err)}`
        )
      }
      if (dirtyLines.length > 0) {
        return fail(
          'error',
          `存在未提交的修改（如 ${dirtyLines[0]}），切换分支前请先提交或 stash（git status 非空）。`
        )
      }
      // 模态确认（P1-10）：切换后会停留在目标分支，必须用户明确同意
      const confirm = await vscode.window.showWarningMessage(
        `将切换到 ${branch} 分支并停留在该分支，是否继续？`,
        { modal: true },
        '切换并编译'
      )
      if (confirm !== '切换并编译') {
        this.output.appendLine(`[编译] 用户取消了分支切换（${originalBranch} → ${branch}）。`)
        return fail('error', `已取消：未切换到 ${branch} 分支。`)
      }
      progress.report({ message: `切换分支 ${originalBranch} → ${branch}…` })
      try {
        await this.runCommand(
          { command: 'git', args: ['checkout', branch], cwd, timeoutMs: GIT_CHECKOUT_TIMEOUT_MS },
          token
        )
      } catch (err) {
        if (cancelled(err)) {
          return fail('error', '已取消编译。')
        }
        const message = err instanceof Error ? err.message : String(err)
        this.output.appendLine(`[编译] 切换分支失败：${message}`)
        return fail('error', `切换分支到「${branch}」失败，详见输出通道。`)
      }
      switched = true
      this.gitCache = undefined // 分支已变化，失效缓存
      this.output.appendLine(`[编译] 已切换分支：${originalBranch} → ${branch}`)
    }

    // ---- 编译（npm run package：类型检查 + 生产构建）----
    progress.report({ message: `编译中（${target}）…` })
    const npm = npmCommand()
    try {
      const buildOutput = await this.runCommand(
        { command: npm.command, args: [...npm.prefix, 'run', 'package'], cwd },
        token
      )
      this.output.appendLine(buildOutput.trim())
    } catch (err) {
      if (cancelled(err)) {
        return fail('error', `已取消编译。${switched ? recovery() : ''}`)
      }
      const message = err instanceof Error ? err.message : String(err)
      this.output.appendLine(`[编译] 失败：${message}`)
      return fail(
        'error',
        `编译失败：类型检查或构建未通过，详见输出通道。${switched ? recovery() : ''}`
      )
    }

    // ---- 出包（vsce 已随 devDependencies 提供；失败按三类区分：未安装 / 元数据不完整 / 其他）----
    progress.report({ message: '打包 .vsix…' })
    let artifact: string | undefined
    let status: BuildResult['status'] = 'ok'
    let extra = ''
    let vsceAvailable = false
    const npx = npxCommand()
    try {
      await this.runCommand(
        {
          command: npx.command,
          args: [...npx.prefix, '--no-install', 'vsce', '--version'],
          cwd,
          timeoutMs: VSCE_PROBE_TIMEOUT_MS,
        },
        token
      )
      vsceAvailable = true
    } catch (err) {
      if (cancelled(err)) {
        return fail('error', `已取消编译。${switched ? recovery() : ''}`)
      }
      status = 'warn'
      extra = '；未检测到 vsce，跳过 .vsix 打包（可执行 npm i -D @vscode/vsce 补装）'
    }
    if (vsceAvailable) {
      try {
        const vsixOutput = await this.runCommand(
          {
            command: npx.command,
            args: [...npx.prefix, '--no-install', 'vsce', 'package', '--no-dependencies'],
            cwd,
          },
          token
        )
        const match = vsixOutput.match(/(\S+\.vsix)/)
        artifact = match ? match[1] : undefined
        this.output.appendLine(vsixOutput.trim())
      } catch (err) {
        if (cancelled(err)) {
          return fail('error', `已取消编译。${switched ? recovery() : ''}`)
        }
        const message = err instanceof Error ? err.message : String(err)
        this.output.appendLine(`[编译] vsce package 失败：${message}`)
        status = 'error'
        extra = /publisher|repository|readme|icon/i.test(message)
          ? '；打包失败：发布元数据不完整，详见输出通道'
          : '；打包失败，详见输出通道'
      }
    }

    const result: BuildResult = {
      branch: target,
      status,
      durationMs: Date.now() - startedAt,
      finishedAt: new Date().toISOString(),
      message: `编译成功（${target}）${artifact ? `，产物：${artifact}` : extra}`,
      artifact,
    }
    this.lastBuild = result
    this.output.appendLine(`[编译] ✓ ${result.message}（${result.durationMs}ms）`)
    this._onDidChangeItems.fire()
    return result
  }

  /** 分支名预检：git check-ref-format --allow-onelevel（参数数组，无 shell 拼接）。 */
  private async isValidBranchName(branch: string, cwd: string): Promise<boolean> {
    if (!branch || branch.includes('\0')) {
      return false
    }
    try {
      await this.runCommand({
        command: 'git',
        args: ['check-ref-format', '--allow-onelevel', branch],
        cwd,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
      })
      return true
    } catch {
      return false
    }
  }

  /** 记录失败结果并广播（build 的快速失败路径共用）。 */
  private fail(
    status: 'warn' | 'error',
    message: string,
    startedAt: number,
    branch?: string
  ): BuildResult {
    const result: BuildResult = {
      branch,
      status,
      durationMs: Date.now() - startedAt,
      finishedAt: new Date().toISOString(),
      message,
    }
    this.lastBuild = result
    this._onDidChangeItems.fire()
    return result
  }

  dispose(): void {
    this._onDidChangeItems.dispose()
  }
}
