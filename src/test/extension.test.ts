import * as assert from 'assert'
import * as nodeOs from 'node:os'
import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { setTimeout as delay } from 'node:timers/promises'

/** 轮询等待面板标签页出现（面板创建是异步装配，命令返回时不一定已入 tabGroups）。 */
async function vi_tabWait(hasPanel: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (hasPanel()) {
      return
    }
    await delay(200)
  }
}
import { environmentTask } from '../extension/tasks/environmentTask'
import { TaskRunner } from '../extension/tasks/taskRunner'
import type { StartupTask, TaskResult } from '../extension/tasks/types'
import { InitService } from '../extension/features/init/initService'
import type { InitStep } from '../extension/features/init/initSteps'

/**
 * 宿主集成测试（@vscode/test-electron，09 方案阶段 2 后）：
 * 条目 / 特性配置 / 静态配置 / 存储层四组已随领域删除，
 * 保留启动任务框架 / 环境初始化 / 分支编译三组（其余领域的深度覆盖在单测）。
 */

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

suite('分支编译（v2.1 端到端冒烟）', () => {
  test('buildBranch 打开弹框：真实宿主出现面板标签页；buildRefreshTasks 可执行', async () => {
    await vscode.commands.executeCommand('extStarter.buildBranch')
    // 经公开 API 断言（测试进程与扩展 bundle 是两个模块实例，不能查内部注册表）：
    // 面板创建成功 ⇔ 出现 viewType 匹配的编辑器标签页
    const hasPanel = (): boolean =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some((tab) => {
          // 测试宿主的 Tab 不暴露 viewType（proposed API，dump 实证为 undefined）：
          // 兼容 label 匹配（webview 面板标签 = 页面标题「分支编译」）
          const viewType = String((tab as unknown as { viewType?: string }).viewType ?? '')
          return viewType.endsWith('.buildConsole') || (tab.label ?? '').includes('分支编译')
        })
    await vi_tabWait(hasPanel)
    assert.ok(hasPanel(), '分支编译弹框面板应已创建（tabGroups 可见）')

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('extStarter.buildRefreshTasks')
    }, '刷新命令应可执行（树视图 + provider 接线成功）')
  })
})

suite('全流程真实环境验证（真实编辑器 / 剪贴板 / 文件 / 草稿落盘）', () => {
  /** 打开一个真实文档并把选区定为 (0,0)-(0,len) —— 与用户「选中一段文本」等价。 */
  async function openWithSelection(content: string, end: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' })
    const editor = await vscode.window.showTextDocument(doc)
    editor.selection = new vscode.Selection(0, 0, 0, end)
  }

  test('复制选中文本：真编辑器选区 → 真剪贴板（精确内容）', async () => {
    await openWithSelection('hello 世界 123', 5) // 选中 "hello"
    await vscode.commands.executeCommand('extStarter.copySelection')
    assert.strictEqual(await vscode.env.clipboard.readText(), 'hello')
  })

  test('复制文件内容 / 路径：真实临时文件 → 真剪贴板（多选批量）', async () => {
    const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-real-'))
    const fileA = vscode.Uri.file(nodePath.join(dir, 'a.txt'))
    const fileB = vscode.Uri.file(nodePath.join(dir, 'b.md'))
    await vscode.workspace.fs.writeFile(fileA, Buffer.from('内容A', 'utf8'))
    await vscode.workspace.fs.writeFile(fileB, Buffer.from('内容B', 'utf8'))
    try {
      await vscode.commands.executeCommand('extStarter.copyFileContent', fileA)
      assert.strictEqual(await vscode.env.clipboard.readText(), '内容A')

      await vscode.commands.executeCommand('extStarter.copyFileContent', fileA, [fileA, fileB])
      const multi = await vscode.env.clipboard.readText()
      assert.ok(multi.includes(`=== ${fileA.fsPath} ===`), '批量应有路径分隔头')
      assert.ok(multi.includes('内容A') && multi.includes('内容B'))

      await vscode.commands.executeCommand('extStarter.copyFilePath', fileA, [fileA, fileB])
      assert.strictEqual(
        await vscode.env.clipboard.readText(),
        `${fileA.fsPath}
${fileB.fsPath}`
      )
    } finally {
      nodeFs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('草稿箱全流程：选中文本右键 → 真实落盘工作区数据文件 → 追加 → 内容断言', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri
    assert.ok(root, '集成测试宿主应打开工作区（仓库根）')
    const draftsUri = vscode.Uri.joinPath(root, '.vscode/ext-starter.drafts.json')
    // 清场：数据文件与原子写临时残留一并删除，保证「从空草稿箱开始」的真实流程
    for (const name of await vscode.workspace.fs.readDirectory(
      vscode.Uri.joinPath(root, '.vscode')
    )) {
      if (
        name[0] === 'ext-starter.drafts.json' ||
        name[0].startsWith('ext-starter.drafts.json.tmp-')
      ) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, '.vscode', name[0]), {
          recursive: true,
        })
      }
    }

    // 命令为 fire-and-forget（void addSelection().then(...)）：原子写异步完成，
    // 轮询等待数据文件生成（真实用户视角 = 看到成功提示后数据已落盘）
    const waitForDrafts = async (): Promise<string> => {
      const startedAt = Date.now()
      for (;;) {
        try {
          return Buffer.from(await vscode.workspace.fs.readFile(draftsUri)).toString('utf8')
        } catch {
          if (Date.now() - startedAt > 5000) {
            throw new Error('草稿数据文件未在 5s 内生成（draftSelection 异步写失败）')
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    }

    await openWithSelection('草稿内容-全流程验证', 12) // 选中前 12 字符
    await vscode.commands.executeCommand('extStarter.draftSelection')
    const raw = await waitForDrafts()
    const persisted = JSON.parse(raw) as {
      schemaVersion: number
      entries: { kind: string; title: string; detail: string }[]
    }
    assert.strictEqual(persisted.schemaVersion, 1)
    assert.ok(persisted.entries.length >= 1, '落盘应产生草稿条目')
    const latest = persisted.entries[0]
    assert.strictEqual(latest.kind, 'selection')
    assert.ok(latest.title.includes('草稿内容'), `标题应含选中摘要（实际：${latest.title}）`)

    // 追加流程：再登记一次 → 追加到最近草稿 → detail 增长。
    // 文件已存在，普通读取会立刻命中追加前的旧内容——按条件轮询到追加落盘为止
    await openWithSelection('追加线索-XYZ', 8)
    const appendResult = (await vscode.commands.executeCommand(
      'extStarter.appendDraftSelection'
    )) as { ok?: boolean; reason?: string; appended?: boolean } | undefined
    assert.ok(appendResult?.ok, `追加命令应成功（返回：${JSON.stringify(appendResult)}）`)
    const startedAt = Date.now()
    for (;;) {
      const data = JSON.parse(await waitForDrafts()) as {
        entries: { detail: string }[]
      }
      if (data.entries[0]?.detail?.includes('追加线索-XYZ')) {
        break
      }
      if (Date.now() - startedAt > 5000) {
        assert.fail('追加未在 5s 内写入最近草稿 detail')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // 测试卫生：清掉本次产生的数据文件与临时残留（gitignore 已覆盖，不影响仓库状态）
    for (const name of await vscode.workspace.fs.readDirectory(
      vscode.Uri.joinPath(root, '.vscode')
    )) {
      if (
        name[0] === 'ext-starter.drafts.json' ||
        name[0].startsWith('ext-starter.drafts.json.tmp-')
      ) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, '.vscode', name[0]), {
          recursive: true,
        })
      }
    }
  })

  test('分支编译弹框：命令打开面板；任务刷新命令可执行', async () => {
    await vscode.commands.executeCommand('extStarter.buildBranch')
    const hasPanel = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some((tab) => (tab.label ?? '').includes('分支编译'))
    assert.ok(hasPanel, '弹框面板应已打开')
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('extStarter.buildRefreshTasks')
    })
  })
})
