import * as assert from 'assert'
import * as cp from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import { environmentTask } from '../extension/tasks/environmentTask'
import { TaskRunner } from '../extension/tasks/taskRunner'
import type { StartupTask, TaskResult } from '../extension/tasks/types'
import { BuildService } from '../extension/features/build/buildService'
import { InitService } from '../extension/features/init/initService'
import type { InitStep } from '../extension/features/init/initSteps'

/**
 * 宿主集成测试（@vscode/test-electron，09 方案阶段 2 后）：
 * 条目 / 特性配置 / 静态配置 / 存储层四组已随领域删除，
 * 保留启动任务框架 / 环境初始化 / 分支编译三组（其余领域的深度覆盖在单测）。
 */

/**
 * 清理测试临时目录。Windows 下 git 仓库的 .git 对象文件为只读，rmSync 会 EPERM——
 * 失败时先递归清除只读位再删（测试卫生规约：临时目录必须清理）。
 */
function rmTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return
  } catch {
    // 落入下方只读位清理流程
  }
  const clearReadOnly = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) {
        clearReadOnly(child)
      } else {
        try {
          fs.chmodSync(child, 0o666)
        } catch {
          // 尽力而为
        }
      }
    }
  }
  clearReadOnly(dir)
  fs.rmSync(dir, { recursive: true, force: true })
}

suite('启动任务框架', () => {
  function fakeTask(id: string, title: string, behavior: () => Promise<void>): StartupTask {
    return {
      id,
      title,
      async run() {
        await behavior()
        return {
          taskId: id,
          taskTitle: title,
          status: 'ok',
          durationMs: 1,
          finishedAt: new Date().toISOString(),
          items: [{ label: '示例', description: '1.0.0', status: 'ok' }],
        }
      },
    }
  }

  test('TaskRunner 依次执行任务并发出变更事件（逐任务事件，任务数 + 2）', async () => {
    let runs = 0
    const task = fakeTask('demo', '演示任务', async () => {
      runs++
    })
    const runner = new TaskRunner([task], vscode.window.createOutputChannel('CRUD Starter Test'))
    let events = 0
    runner.onDidChangeItems(() => events++)
    await runner.runAll()
    assert.strictEqual(runs, 1)
    // T5.4 事件节奏：开始一次 + 每个任务完成后一次 + 结束一次（1 个任务 → 3 次）
    assert.strictEqual(events, 3)
    assert.strictEqual(runner.lastResults.length, 1)
    assert.strictEqual(runner.lastResults[0].items[0].label, '示例')
  })

  test('任务抛错时降级为 error 结果且不影响后续任务', async () => {
    const boom = fakeTask('boom', '爆炸任务', async () => {
      throw new Error('boom')
    })
    const okTask = fakeTask('ok', '正常任务', async () => undefined)
    const runner = new TaskRunner(
      [boom, okTask],
      vscode.window.createOutputChannel('CRUD Starter Test')
    )
    await runner.runAll()
    assert.strictEqual(runner.lastResults.length, 2)
    assert.strictEqual(runner.lastResults[0].status, 'error')
    assert.strictEqual(runner.lastResults[1].status, 'ok')
  })

  test('环境检测产出语义化结果（Node.js 必检到；Python/Git 状态合法即可）', async () => {
    const runner = new TaskRunner(
      [environmentTask],
      vscode.window.createOutputChannel('CRUD Starter Test')
    )
    await runner.runAll()
    const env = runner.lastResults[0]
    // Node.js 是 npm test 自身的运行前提：必须 ok 且版本号以 v 开头
    const node = env.items.find((item) => item.label === 'Node.js')
    assert.ok(node, '应包含 Node.js 条目')
    assert.strictEqual(node.status, 'ok')
    assert.match(node.description ?? '', /^v/)
    // Python / Git 依赖开发机真实安装：条目必须存在，状态只要求语义合法（P1-13 修复：
    // 不再断言「标签存在即通过」的恒真条件，无 Python 的机器上为 missing）
    for (const label of ['Python', 'Git']) {
      const entry = env.items.find((item) => item.label === label)
      assert.ok(entry, `应包含 ${label} 条目`)
      assert.ok(
        entry.status === 'ok' || entry.status === 'missing',
        `${label} 状态应为 ok/missing（实际：${entry.status}）`
      )
    }
  })

  test('任务超时被裁决为 error「任务超时」（T5.4 / P1-11）', async () => {
    const hang: StartupTask = {
      id: 'hang',
      title: '挂死任务',
      timeoutMs: 100,
      run: () => new Promise<TaskResult>(() => undefined), // 永不完成
    }
    const runner = new TaskRunner([hang], vscode.window.createOutputChannel('CRUD Starter Test'))
    await runner.runAll()
    assert.strictEqual(runner.lastResults.length, 1)
    assert.strictEqual(runner.lastResults[0].status, 'error')
    assert.match(runner.lastResults[0].summary ?? '', /任务超时/)
    assert.strictEqual(runner.isRunning, false)
  })
})

suite('环境初始化', () => {
  test('步骤顺序执行：失败不阻断后续步骤', async () => {
    const steps: InitStep[] = [
      { id: 'a', title: 'A', description: '', run: async () => 'ok-a' },
      {
        id: 'b',
        title: 'B',
        description: '',
        run: async () => {
          throw new Error('bad')
        },
      },
      { id: 'c', title: 'C', description: '', run: async () => 'ok-c' },
    ]
    const output = vscode.window.createOutputChannel('CRUD Starter Test')
    const svc = new InitService(steps, output)
    await svc.runAll()
    const states = svc.getStates()
    assert.strictEqual(states[0].status, 'done')
    assert.strictEqual(states[0].message, 'ok-a')
    assert.strictEqual(states[1].status, 'failed')
    assert.strictEqual(states[1].message, 'bad')
    assert.strictEqual(states[2].status, 'done')
  })

  test('runStep 在 runAll 执行期间被忽略（T5.4 / P1-12 单步互斥）', async () => {
    let releaseFirst!: () => void
    const steps: InitStep[] = [
      {
        id: 'a',
        title: 'A',
        description: '',
        run: () =>
          new Promise<string>((resolve) => {
            releaseFirst = () => resolve('ok-a')
          }),
      },
      { id: 'b', title: 'B', description: '', run: async () => 'ok-b' },
    ]
    const output = vscode.window.createOutputChannel('CRUD Starter Test')
    const svc = new InitService(steps, output)
    const running = svc.runAll()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.strictEqual(svc.isRunning, true)
    await svc.runStep('b') // runAll 进行中：被忽略
    assert.strictEqual(svc.getStates().find((state) => state.id === 'b')?.status, 'idle')
    releaseFirst()
    await running
    assert.strictEqual(svc.getStates().find((state) => state.id === 'b')?.status, 'done')
  })
})

suite('分支编译', () => {
  test('getGitInfo 识别临时 git 仓库的分支清单与当前分支', async () => {
    // P1-13 修复：用临时 git fixture 替代「断言本仓库必须在 main 分支」——
    // 在 os.tmpdir 下自建仓库（初始分支 main + 额外分支），不再依赖开发机的分支状态
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crud-git-fixture-'))
    const git = (args: string[]): void => {
      cp.execFileSync('git', args, { cwd: dir })
    }
    try {
      git(['init'])
      git(['symbolic-ref', 'HEAD', 'refs/heads/main']) // 兼容 git 默认分支名不同的环境
      git(['config', 'user.email', 'test@example.com'])
      git(['config', 'user.name', 'CRUD Test'])
      fs.writeFileSync(path.join(dir, 'readme.md'), '# fixture\n')
      git(['add', '.'])
      git(['commit', '-m', 'init'])
      git(['branch', 'feature-demo'])

      const output = vscode.window.createOutputChannel('CRUD Starter Test')
      const svc = new BuildService(output, () => dir)
      const info = await svc.getGitInfo()
      assert.strictEqual(info.available, true)
      assert.strictEqual(info.current, 'main')
      assert.ok(info.branches.includes('main'), '应包含初始分支 main')
      assert.ok(info.branches.includes('feature-demo'), '应包含新建分支 feature-demo')
    } finally {
      rmTempDir(dir)
    }
  })

  test('非 Git 目录返回 available=false 而不抛错', async () => {
    const output = vscode.window.createOutputChannel('CRUD Starter Test')
    const svc = new BuildService(output, () => os.tmpdir())
    const info = await svc.getGitInfo()
    assert.strictEqual(info.available, false)
  })

  test('未打开工作区时返回 error 结果而不抛错', async () => {
    const output = vscode.window.createOutputChannel('CRUD Starter Test')
    const svc = new BuildService(output, () => undefined)
    const result = await svc.build()
    assert.strictEqual(result.status, 'error')
    assert.match(result.message, /未打开工作区/)
  })

  test('并发 build 被互斥拒绝（T5.4 / P1-10）：第二次返回「已有编译任务进行中」', async () => {
    const output = vscode.window.createOutputChannel('CRUD Starter Test')
    let releaseBuild!: (value: string) => void
    const blocked = new Promise<string>((resolve) => {
      releaseBuild = resolve
    })
    // 注入假执行器：npm run package 挂起等待手动放行，其余命令（git 查询 / vsce 探测）直接成功
    const svc = new BuildService(output, () => path.resolve(__dirname, '..', '..'), {
      runCommand: async (spec) =>
        spec.args.includes('run') && spec.args.includes('package') ? blocked : '\n',
    })
    const first = svc.build()
    await new Promise((resolve) => setTimeout(resolve, 100)) // 等流程推进到构建步骤
    assert.strictEqual(svc.isRunning, true)
    const second = await svc.build()
    assert.strictEqual(second.status, 'error')
    assert.match(second.message, /已有编译任务进行中/)
    releaseBuild('build ok')
    const firstResult = await first
    assert.strictEqual(firstResult.status, 'ok')
    assert.strictEqual(svc.isRunning, false)
  })
})
