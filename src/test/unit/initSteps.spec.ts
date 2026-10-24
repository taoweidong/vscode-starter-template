import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import * as vscode from 'vscode'
import { __resetStubs, __setConfig, __stubs } from './stubs/vscode'
import { createInitSteps } from '../../features/init/initSteps'
import { STORAGE } from '../../constants'

/** T1.1 接入验证：初始化「数据文件」步骤统一走路径白名单。 */
describe('initSteps 数据文件步骤（路径白名单接入）', () => {
  let rootDir: string

  beforeEach(() => {
    __resetStubs()
    rootDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'crud-init-steps-'))
  })

  afterEach(() => {
    nodeFs.rmSync(rootDir, { recursive: true, force: true })
  })

  const runDataFileStep = (): Promise<string> => {
    const steps = createInitSteps()
    const step = steps.find((candidate) => candidate.id === 'dataFile')
    if (!step) {
      throw new Error('dataFile 步骤未注册')
    }
    return step.run({
      workspaceRoot: vscode.Uri.file(rootDir),
      output: undefined as unknown as vscode.OutputChannel,
      staticConfig: undefined as unknown as never,
    })
  }

  it('默认配置：在 .vscode/crud-starter-items.json 创建 v2 信封空文件', async () => {
    const message = await runDataFileStep()
    expect(message).toContain(STORAGE.defaultFileName)
    // R-C-12：写 v2 信封而非 '[]'——否则此后每次 load 都触发「旧版数组格式」告警，
    // 直到首次保存才迁移
    const written = JSON.parse(
      nodeFs.readFileSync(nodePath.join(rootDir, STORAGE.defaultFileName), 'utf8')
    ) as { schemaVersion?: number; items?: unknown[] }
    expect(written).toEqual({ schemaVersion: 2, items: [] })
  })

  it('合法自定义路径：文件落在配置位置', async () => {
    __setConfig('crudStarter', 'storagePath', 'custom/data.json')
    await runDataFileStep()
    expect(nodeFs.existsSync(nodePath.join(rootDir, 'custom', 'data.json'))).toBe(true)
    // 不允许逃逸：工作区根目录外没有文件被创建
    expect(
      nodeFs.readdirSync(nodeFs.realpathSync(nodePath.join(rootDir, '..'))).length
    ).toBeGreaterThanOrEqual(1)
  })

  it('非法配置（..逃逸）：回退默认路径、弹出警告、不中断初始化', async () => {
    __setConfig('crudStarter', 'storagePath', '../evil.json')
    const message = await runDataFileStep()
    expect(message).toContain(STORAGE.defaultFileName) // 步骤正常完成
    const warnings = __stubs.recorded.filter((entry) => entry.kind === 'showWarningMessage')
    expect(warnings).toHaveLength(1)
    expect(JSON.stringify(warnings[0].args)).toContain('evil.json')
    // 默认路径被创建，父目录外没有文件
    expect(nodeFs.existsSync(nodePath.join(rootDir, STORAGE.defaultFileName))).toBe(true)
    expect(nodeFs.existsSync(nodePath.resolve(rootDir, '..', 'evil.json'))).toBe(false)
  })

  it('文件已存在：跳过创建且不警告', async () => {
    nodeFs.mkdirSync(nodePath.join(rootDir, '.vscode'), { recursive: true })
    nodeFs.writeFileSync(
      nodePath.join(rootDir, STORAGE.defaultFileName),
      '{"schemaVersion":2,"items":[]}',
      'utf8'
    )
    const message = await runDataFileStep()
    expect(message).toContain('跳过')
    expect(__stubs.recorded.filter((entry) => entry.kind === 'showWarningMessage')).toHaveLength(0)
  })
})
