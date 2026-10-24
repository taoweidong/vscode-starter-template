import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { __resetStubs } from './stubs/vscode'
import { createInitSteps } from '../../extension/features/init/initSteps'

/**
 * 09 方案阶段 2 后的步骤注册表：dataFile / staticConfig 步骤已删除，
 * 剩 3 步（workspace / artifactDir / envSnapshot）；envSnapshot 的快照复用
 * 契约见 initService.spec.ts，本文件锁定注册表结构与前两步行为。
 */
describe('createInitSteps 步骤注册表', () => {
  let rootDir: string

  beforeEach(() => {
    __resetStubs()
    rootDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-init-steps-'))
  })

  afterEach(() => {
    nodeFs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('注册表恰为 3 步：workspace / artifactDir / envSnapshot（dataFile 与 staticConfig 已删）', () => {
    expect(createInitSteps().map((step) => step.id)).toEqual([
      'workspace',
      'artifactDir',
      'envSnapshot',
    ])
  })

  it('workspace：有工作区 → 就绪信息；无工作区 → 抛错', async () => {
    const step = createInitSteps()[0]
    const message = await step.run({
      workspaceRoot: vscode.Uri.file(rootDir),
      output: undefined as unknown as vscode.OutputChannel,
    })
    expect(message).toContain('工作区就绪')
    await expect(
      step.run({ output: undefined as unknown as vscode.OutputChannel })
    ).rejects.toThrow('未打开工作区')
  })

  it('artifactDir：创建 .ext-starter/ 目录（幂等）', async () => {
    const step = createInitSteps()[1]
    const message = await step.run({
      workspaceRoot: vscode.Uri.file(rootDir),
      output: undefined as unknown as vscode.OutputChannel,
    })
    expect(message).toContain('目录就绪')
    expect(nodeFs.existsSync(nodePath.join(rootDir, '.ext-starter'))).toBe(true)
    // 重复执行不抛错（createDirectory recursive 语义）
    await expect(
      step.run({
        workspaceRoot: vscode.Uri.file(rootDir),
        output: undefined as unknown as vscode.OutputChannel,
      })
    ).resolves.toContain('目录就绪')
  })
})
