import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as childProcess from 'child_process'
import * as vscode from 'vscode'
import { __resetStubs, __stubs } from './stubs/vscode'
import {
  BuildCancelledError,
  BuildService,
  CommandTimeoutError,
  DEFAULT_DIRTY_IGNORES,
  filterDirtyLines,
  spawnCommand,
  type CommandRunner,
  type CommandSpec,
} from '../../features/build/buildService'
import { TaskSignalSource } from '../../tasks/taskRunner'

const CWD = 'E:/fake-workspace'
/** Windows 下 npm/npx 是 .cmd，经 cmd.exe /c 包装（参数为固定常量）。 */
const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'cmd.exe' : 'npm'
const NPX = IS_WIN ? 'cmd.exe' : 'npx'
const npmArgs = (...rest: string[]): string[] => (IS_WIN ? ['/c', 'npm', ...rest] : [...rest])
const npxArgs = (...rest: string[]): string[] => (IS_WIN ? ['/c', 'npx', ...rest] : [...rest])

/** 可编程行为：固定输出 / 抛错 / 挂起 Promise / 函数式延迟计算。 */
type Behavior = string | Error | Promise<string> | (() => Promise<string>)

/**
 * 假命令执行器：记录调用（含 token），可按匹配器编程行为；**后注册的行为优先**
 * （便于测试在 programGit 基础上覆盖个别命令）。
 */
class FakeRunner {
  calls: CommandSpec[] = []
  private handlers: Array<{
    match: (spec: CommandSpec) => boolean
    behavior: () => Promise<string>
  }> = []

  on(match: (spec: CommandSpec) => boolean, behavior: Behavior): this {
    const run =
      typeof behavior === 'function'
        ? (behavior as () => Promise<string>)
        : async () => {
            if (behavior instanceof Error) {
              throw behavior
            }
            return behavior
          }
    this.handlers.push({ match, behavior: run })
    return this
  }

  /** 精确匹配 command + 完整参数数组。 */
  onArgs(command: string, args: string[], behavior: Behavior): this {
    return this.on(
      (spec) =>
        spec.command === command &&
        spec.args.length === args.length &&
        args.every((arg, i) => spec.args[i] === arg),
      behavior
    )
  }

  readonly runner: CommandRunner = async (spec) => {
    this.calls.push(spec)
    // 后注册的处理器优先命中
    for (let i = this.handlers.length - 1; i >= 0; i -= 1) {
      if (this.handlers[i].match(spec)) {
        return this.handlers[i].behavior()
      }
    }
    return ''
  }

  findCalls(command: string, argsPrefix: string[] = []): CommandSpec[] {
    return this.calls.filter(
      (spec) => spec.command === command && argsPrefix.every((arg, i) => spec.args[i] === arg)
    )
  }
}

/** 编排 git 仓库状态（当前分支 main，可选脏行）。 */
function programGit(
  fake: FakeRunner,
  options: { current?: string; porcelain?: string } = {}
): void {
  const current = options.current ?? 'main'
  fake.onArgs('git', ['rev-parse', '--abbrev-ref', 'HEAD'], current)
  fake.onArgs('git', ['branch', '--format=%(refname:short)'], 'main\nfeat/x\n')
  fake.onArgs('git', ['status', '--porcelain'], options.porcelain ?? '')
  fake.onArgs('git', ['check-ref-format', '--allow-onelevel', 'feat/x'], '')
  fake.onArgs('git', ['checkout', 'feat/x'], '')
}

function makeService(fake: FakeRunner): BuildService {
  return new BuildService(vscode.window.createOutputChannel('CRUD Starter Test'), () => CWD, {
    runCommand: fake.runner,
  })
}

/** 带额外选项构造（R-C-4 等需要注入 getDirtyIgnorePrefixes 的用例）。 */
function makeServiceWithOptions(
  fake: FakeRunner,
  options: ConstructorParameters<typeof BuildService>[2]
): BuildService {
  return new BuildService(vscode.window.createOutputChannel('CRUD Starter Test'), () => CWD, {
    runCommand: fake.runner,
    ...options,
  })
}

/** 让 withProgress 内的多段 await 推进（假 runner 同步 resolve，微任务即可）。 */
const flush = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  __resetStubs()
})

/** T5.4 / P0-05 / P1-09 / P1-10：BuildService 生命周期与安全边界。 */
describe('BuildService 信任与互斥', () => {
  it('不受信任工作区：直接拒绝，不执行任何命令、不进入进度流程', async () => {
    __stubs.isTrusted = false
    const fake = new FakeRunner()
    const svc = makeService(fake)
    const result = await svc.build()
    expect(result.status).toBe('error')
    expect(result.message).toContain('不受信任')
    expect(fake.calls).toEqual([])
    expect(__stubs.recorded.some((entry) => entry.kind === 'withProgress')).toBe(false)
  })

  it('并发 build：第二次返回 error「已有编译任务进行中」，第一次正常完成', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    let releaseBuild!: (value: string) => void
    fake.onArgs(
      NPM,
      npmArgs('run', 'package'),
      () => new Promise<string>((resolve) => (releaseBuild = resolve))
    )
    fake.onArgs(NPX, npxArgs('--no-install', 'vsce', '--version'), '')
    fake.onArgs(
      NPX,
      npxArgs('--no-install', 'vsce', 'package', '--no-dependencies'),
      'DONE crud-starter-0.1.0.vsix'
    )
    const svc = makeService(fake)
    const first = svc.build()
    await flush()
    expect(svc.isRunning).toBe(true)
    const second = await svc.build()
    expect(second.status).toBe('error')
    expect(second.message).toContain('已有编译任务进行中')
    releaseBuild('build output')
    const firstResult = await first
    expect(firstResult.status).toBe('ok')
    expect(firstResult.artifact).toBe('crud-starter-0.1.0.vsix')
    expect(svc.isRunning).toBe(false)
  })
})

describe('BuildService 分支切换（check-ref-format / 脏检查 / 确认 / 恢复指引）', () => {
  it('分支名不合法（check-ref-format 失败）：不切换、不弹确认', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(
      'git',
      ['check-ref-format', '--allow-onelevel', 'bad..name'],
      new Error('fatal: not a valid ref')
    )
    const svc = makeService(fake)
    const result = await svc.build('bad..name')
    expect(result.status).toBe('error')
    expect(result.message).toContain('不合法')
    expect(fake.findCalls('git', ['checkout'])).toEqual([])
    expect(__stubs.recorded.some((entry) => entry.kind === 'showWarningMessage')).toBe(false)
  })

  it('脏检查忽略插件自身数据文件（P1-09）：只有自身文件变更时允许切换', async () => {
    const fake = new FakeRunner()
    programGit(fake, {
      porcelain: ' M .vscode/crud-starter-items.json\n?? .crud-starter/\n',
    })
    fake.onArgs(NPM, npmArgs('run', 'package'), 'ok')
    fake.onArgs(NPX, npxArgs('--no-install', 'vsce', '--version'), new Error('no vsce'))
    __stubs.dialogQueue.push('切换并编译')
    const svc = makeService(fake)
    const result = await svc.build('feat/x')
    expect(result.message).not.toContain('未提交的修改')
    const checkouts = fake.findCalls('git', ['checkout'])
    expect(checkouts).toHaveLength(1)
    expect(checkouts[0].args).toEqual(['checkout', 'feat/x']) // 参数数组（无 shell 拼接）
  })

  it('R-C-4 脏检查忽略前缀动态跟随 storagePath：自定义路径用户不被自阻断', async () => {
    const fake = new FakeRunner()
    programGit(fake, {
      porcelain: ' M data/items.json\n',
    })
    fake.onArgs(NPM, npmArgs('run', 'package'), 'ok')
    fake.onArgs(NPX, npxArgs('--no-install', 'vsce', '--version'), new Error('no vsce'))
    __stubs.dialogQueue.push('切换并编译')
    // 模拟 crudStarter.storagePath 配置为 data/items.json 的用户
    const svc = makeServiceWithOptions(fake, {
      getDirtyIgnorePrefixes: () => [...DEFAULT_DIRTY_IGNORES, 'data/items.json'],
    })
    const result = await svc.build('feat/x')
    expect(result.message).not.toContain('未提交的修改')
    const checkouts = fake.findCalls('git', ['checkout'])
    expect(checkouts).toHaveLength(1)
    expect(checkouts[0].args).toEqual(['checkout', 'feat/x'])
  })

  it('存在其他未提交修改：拒绝切换并列出示例文件', async () => {
    const fake = new FakeRunner()
    programGit(fake, { porcelain: ' M src/index.ts\n' })
    const svc = makeService(fake)
    const result = await svc.build('feat/x')
    expect(result.status).toBe('error')
    expect(result.message).toContain('未提交的修改')
    expect(result.message).toContain('src/index.ts')
    expect(fake.findCalls('git', ['checkout'])).toEqual([])
  })

  it('切换前模态确认：用户取消则不切换、不编译', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    const svc = makeService(fake)
    const result = await svc.build('feat/x')
    expect(result.status).toBe('error')
    expect(result.message).toContain('已取消')
    const warning = __stubs.recorded.find((entry) => entry.kind === 'showWarningMessage')
    expect(warning).toBeTruthy()
    expect(JSON.stringify(warning?.args)).toContain('modal') // 模态确认
    expect(JSON.stringify(warning?.args)).toContain('将切换到 feat/x 分支并停留在该分支')
    expect(fake.findCalls('git', ['checkout'])).toEqual([])
  })

  it('确认后切换成功；随后编译失败的结果附「可用 git checkout main 恢复」指引', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(
      NPM,
      npmArgs('run', 'package'),
      new Error('命令失败：npm run package\nERROR: type check failed')
    )
    __stubs.dialogQueue.push('切换并编译')
    const svc = makeService(fake)
    const result = await svc.build('feat/x')
    expect(result.status).toBe('error')
    expect(result.message).toContain('编译失败')
    expect(result.message).toContain('可用 git checkout main 恢复')
  })

  it('切换分支失败：报错且不带恢复指引（仍在原分支）', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(
      'git',
      ['checkout', 'feat/x'],
      new Error('error: Your local changes would be overwritten')
    )
    __stubs.dialogQueue.push('切换并编译')
    const svc = makeService(fake)
    const result = await svc.build('feat/x')
    expect(result.status).toBe('error')
    expect(result.message).toContain('切换分支到「feat/x」失败')
    expect(result.message).not.toContain('恢复')
  })

  it('当前分支编译（branch 与 current 相同）：跳过切换流程', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(NPM, npmArgs('run', 'package'), 'ok')
    fake.onArgs(NPX, npxArgs('--no-install', 'vsce', '--version'), new Error('no vsce'))
    const svc = makeService(fake)
    const result = await svc.build('main')
    expect(fake.findCalls('git', ['checkout'])).toEqual([])
    expect(fake.findCalls('git', ['status'])).toEqual([])
    expect(result.status).toBe('warn') // vsce 缺失降级 warn
    expect(result.message).toContain('未检测到 vsce')
  })
})

describe('BuildService 编译与出包', () => {
  it('成功链路：npm run package + vsce package，解析 .vsix 产物', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(NPM, npmArgs('run', 'package'), 'build ok')
    fake.onArgs(NPX, npxArgs('--no-install', 'vsce', '--version'), '0.1.0')
    fake.onArgs(
      NPX,
      npxArgs('--no-install', 'vsce', 'package', '--no-dependencies'),
      ' DONE vscode-starter-0.6.1.vsix '
    )
    const svc = makeService(fake)
    const result = await svc.build()
    expect(result.status).toBe('ok')
    expect(result.artifact).toBe('vscode-starter-0.6.1.vsix')
    expect(result.branch).toBe('main')
  })

  it('vsce 打包失败且为元数据问题：三类错误中的「发布元数据不完整」', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(NPM, npmArgs('run', 'package'), 'ok')
    fake.onArgs(NPX, npxArgs('--no-install', 'vsce', '--version'), '0.1.0')
    fake.onArgs(
      NPX,
      npxArgs('--no-install', 'vsce', 'package', '--no-dependencies'),
      new Error('ERROR: Make sure to set the publisher in package.json')
    )
    const svc = makeService(fake)
    const result = await svc.build()
    expect(result.status).toBe('error')
    expect(result.message).toContain('发布元数据不完整')
  })

  it('取消（BuildCancelledError）：返回 error「已取消」；已切换分支时附恢复指引', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(NPM, npmArgs('run', 'package'), new BuildCancelledError())
    __stubs.dialogQueue.push('切换并编译')
    const svc = makeService(fake)
    const result = await svc.build('feat/x')
    expect(result.status).toBe('error')
    expect(result.message).toContain('已取消')
    expect(result.message).toContain('可用 git checkout main 恢复')
  })

  it('全流程 withProgress cancellable:true 包裹并逐段上报进度', async () => {
    const fake = new FakeRunner()
    programGit(fake)
    fake.onArgs(NPM, npmArgs('run', 'package'), 'ok')
    fake.onArgs(NPX, npxArgs('--no-install', 'vsce', '--version'), new Error('no vsce'))
    const svc = makeService(fake)
    await svc.build()
    const progressEntry = __stubs.recorded.find((entry) => entry.kind === 'withProgress')
    expect(JSON.stringify(progressEntry?.args)).toContain('"cancellable":true')
    const reports = __stubs.recorded.filter((entry) => entry.kind === 'progressReport')
    expect(reports.length).toBeGreaterThanOrEqual(3) // git 信息 / 编译 / 打包
  })

  it('getGitInfo：非 Git 仓库（git 失败）返回 available=false 而不抛错', async () => {
    const fake = new FakeRunner()
    fake.onArgs(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      new Error('fatal: not a git repository')
    )
    const info = await makeService(fake).getGitInfo()
    expect(info.available).toBe(false)
    expect(info.branches).toEqual([])
  })

  it('build：非 Git 仓库返回 error', async () => {
    const fake = new FakeRunner()
    fake.onArgs(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      new Error('fatal: not a git repository')
    )
    const result = await makeService(fake).build()
    expect(result.status).toBe('error')
    expect(result.message).toContain('不是 Git 仓库')
  })
})

/** 脏检查过滤规则（P1-09）。 */
describe('filterDirtyLines', () => {
  it('默认忽略自身数据文件与产物目录，其余保留', () => {
    const porcelain = [
      ' M .vscode/crud-starter-items.json',
      '?? .crud-starter/',
      ' M src/index.ts',
      '?? other.json',
    ].join('\n')
    expect(filterDirtyLines(porcelain)).toEqual(['M src/index.ts', '?? other.json'])
  })

  it('空输入返回空数组；带引号路径同样过滤', () => {
    expect(filterDirtyLines('')).toEqual([])
    expect(filterDirtyLines(' M ".vscode/crud-starter-items.json"')).toEqual([])
  })

  it('重命名行（old -> new）：目标或来源命中忽略前缀则忽略', () => {
    expect(filterDirtyLines('R  .vscode/crud-starter-items.json -> data.json')).toEqual([])
    expect(filterDirtyLines('R  old.json -> .crud-starter/environment.json')).toEqual([])
    expect(filterDirtyLines('R  a.ts -> b.ts')).toEqual(['R  a.ts -> b.ts'])
  })

  it('自定义前缀与默认前缀常量', () => {
    expect(filterDirtyLines(' M custom/data.json\n M x.ts', ['custom/data.json'])).toEqual([
      'M x.ts',
    ])
    expect(DEFAULT_DIRTY_IGNORES).toContain('.vscode/crud-starter-items.json')
    expect(DEFAULT_DIRTY_IGNORES).toContain('.crud-starter/')
  })
})

/** 默认执行器（spawn 参数数组 + shell:false）真实行为。 */
describe('spawnCommand（默认执行器）', () => {
  it('解析子进程 stdout（node --version）', async () => {
    const output = await spawnCommand({
      command: 'node',
      args: ['--version'],
      cwd: process.cwd(),
      timeoutMs: 15000,
    })
    expect(output.trim()).toMatch(/^v/)
  }, 20000)

  it('非零退出码：抛含 stderr 摘要的错误', async () => {
    await expect(
      spawnCommand({
        command: 'node',
        args: ['-e', 'process.exit(3)'],
        cwd: process.cwd(),
        timeoutMs: 15000,
      })
    ).rejects.toThrow(/命令失败/)
  }, 20000)

  it('超时：kill 子进程并抛 CommandTimeoutError', async () => {
    await expect(
      spawnCommand({
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 30000)'],
        cwd: process.cwd(),
        timeoutMs: 100,
      })
    ).rejects.toBeInstanceOf(CommandTimeoutError)
  }, 20000)

  it('取消：kill 子进程并抛 BuildCancelledError', async () => {
    const source = new TaskSignalSource()
    const pending = spawnCommand(
      {
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 30000)'],
        cwd: process.cwd(),
        timeoutMs: 30000,
      },
      source.signal
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    source.cancel()
    await expect(pending).rejects.toBeInstanceOf(BuildCancelledError)
  }, 20000)

  /** 无真实子进程的假 child：只提供 spawnCommand 用到的句柄（R-C-6 单测桩）。 */
  function fakeChild(pid = 4321): childProcess.ChildProcess {
    const child = {
      pid,
      stdout: { on: () => undefined },
      stderr: { on: () => undefined },
      on: () => child,
      kill: vi.fn(),
    }
    return child as unknown as childProcess.ChildProcess
  }

  it('R-C-6 取消（win32）：走 taskkill 进程树杀，不让 npm/node 孙进程成孤儿', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child) as unknown as typeof childProcess.spawn
    const source = new TaskSignalSource()
    const pending = spawnCommand(
      { command: 'npm', args: ['run', 'package'], cwd: process.cwd(), timeoutMs: 30000 },
      source.signal,
      { platform: () => 'win32', spawn }
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    source.cancel()
    await expect(pending).rejects.toBeInstanceOf(BuildCancelledError)
    expect(spawn).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4321', '/T', '/F'],
      expect.objectContaining({ shell: false })
    )
    expect(child.kill).not.toHaveBeenCalled() // 非 win32 分支才直接 kill
  }, 20000)

  it('R-C-6 取消（非 win32）：直接 kill 已覆盖整棵进程树，不调 taskkill', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child) as unknown as typeof childProcess.spawn
    const source = new TaskSignalSource()
    const pending = spawnCommand(
      { command: 'npm', args: ['run', 'package'], cwd: process.cwd(), timeoutMs: 30000 },
      source.signal,
      { platform: () => 'linux', spawn }
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    source.cancel()
    await expect(pending).rejects.toBeInstanceOf(BuildCancelledError)
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(1) // 只有建子进程那次，没有 taskkill
  }, 20000)
})
