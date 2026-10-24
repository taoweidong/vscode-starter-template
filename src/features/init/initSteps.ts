import * as vscode from 'vscode'
import { CONFIG, STORAGE } from '../../constants'
import { resolveStorageUri, storageRelativePath } from '../../services/storagePath'
import { STORAGE_SCHEMA_VERSION } from '../../services/stores/jsonFileStore'
import { environmentTask } from '../../tasks/environmentTask'
import { TaskSignalSource } from '../../tasks/taskRunner'
import type { TaskResult } from '../../tasks/types'
import { StaticConfigService } from '../staticConfig/staticConfigService'

/** 数据文件路径：跟随 crudStarter.storagePath 配置，经白名单校验（T1.1 / P0-03）。 */
function resolveDataFileUri(workspaceRoot: vscode.Uri): {
  fileUri: vscode.Uri
  relative: string
  warning?: string
} {
  const configured = vscode.workspace
    .getConfiguration(CONFIG.section)
    .get<string>(CONFIG.storagePath, STORAGE.defaultFileName)
  const resolved = resolveStorageUri(workspaceRoot, configured)
  if (resolved.ok) {
    return {
      fileUri: resolved.uri,
      relative: storageRelativePath(workspaceRoot, resolved.uri),
    }
  }
  // 非法配置：回退默认路径并提示，不中断初始化
  return {
    fileUri: vscode.Uri.joinPath(workspaceRoot, STORAGE.defaultFileName),
    relative: STORAGE.defaultFileName,
    warning: `CRUD Starter：crudStarter.storagePath 配置值「${configured}」无效（${resolved.reason}），已回退默认路径 ${STORAGE.defaultFileName}。`,
  }
}

/** 初始化步骤的执行上下文。 */
export interface InitContext {
  /** 当前工作区根目录（未打开工作区时为 undefined） */
  workspaceRoot?: vscode.Uri
  output: vscode.OutputChannel
  staticConfig: StaticConfigService
}

/**
 * 初始化步骤定义：返回成功信息；失败直接抛错（由 InitService 记录为 failed）。
 * timeoutMs 可选（默认 120s，见 InitService）：挂死步骤被裁决为 failed。
 * 新增步骤在本数组加一项即可（注册表模式）。
 */
export interface InitStep {
  id: string
  title: string
  description: string
  /** 步骤超时（毫秒）；缺省 INIT_STEP_TIMEOUT_MS。 */
  timeoutMs?: number
  run(ctx: InitContext): Promise<string>
}

/** createInitSteps 的可注入依赖。 */
export interface CreateInitStepsOptions {
  /**
   * 环境快照 getter（T5.4 / P1-12）：返回扩展宿主已缓存的环境检测结果；
   * 有结果时 envSnapshot 步骤直接复用（避免最坏约 48s 的重复全量探测），
   * 无结果（undefined）才现场运行 environmentTask。
   */
  getEnvironmentSnapshot?: () => TaskResult | undefined
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
  }
}

export function createInitSteps(options?: CreateInitStepsOptions): InitStep[] {
  return [
    {
      id: 'workspace',
      title: '检查工作区',
      description: '确认已打开工作区文件夹，后续初始化动作都落在工作区内',
      async run(ctx) {
        if (!ctx.workspaceRoot) {
          throw new Error('未打开工作区，无法初始化。请先打开一个文件夹。')
        }
        return `工作区就绪：${ctx.workspaceRoot.fsPath}`
      },
    },
    {
      id: 'dataFile',
      title: '初始化数据文件',
      description: '确保数据文件存在（路径跟随 crudStarter.storagePath 配置，不存在则创建空数据）',
      async run(ctx) {
        if (!ctx.workspaceRoot) {
          throw new Error('未打开工作区。')
        }
        const { fileUri, relative, warning } = resolveDataFileUri(ctx.workspaceRoot)
        if (warning) {
          void vscode.window.showWarningMessage(warning)
        }
        if (await pathExists(fileUri)) {
          return '数据文件已存在，跳过创建。'
        }
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, '..'))
        // R-C-12：写 v2 信封（与 save 一致）——写 '[]' 会让此后每次 load 都触发
        // 「旧版数组格式」告警，直到首次保存才迁移
        await vscode.workspace.fs.writeFile(
          fileUri,
          Buffer.from(
            `${JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION, items: [] }, null, 2)}\n`,
            'utf8'
          )
        )
        return `已创建：${relative}`
      },
    },
    {
      id: 'staticConfig',
      title: '生成静态配置',
      description: '生成 .vscode/crud-starter.config.json 默认静态配置（已存在则跳过）',
      async run(ctx) {
        const result = await ctx.staticConfig.ensureDefault()
        if (result === 'created') {
          await ctx.staticConfig.load()
          return '已生成默认静态配置（可在「静态配置」视图查看）。'
        }
        if (result === 'exists') {
          return '静态配置已存在，跳过生成。'
        }
        throw new Error('未打开工作区。')
      },
    },
    {
      id: 'artifactDir',
      title: '创建构建产物目录',
      description: '创建 .crud-starter/ 目录，用于存放环境快照等本地产物',
      async run(ctx) {
        if (!ctx.workspaceRoot) {
          throw new Error('未打开工作区。')
        }
        const dirUri = vscode.Uri.joinPath(ctx.workspaceRoot, '.crud-starter')
        await vscode.workspace.fs.createDirectory(dirUri)
        return `目录就绪：${dirUri.fsPath}`
      },
    },
    {
      id: 'envSnapshot',
      title: '写入环境快照',
      description: '运行环境检测并保存到 .crud-starter/environment.json，便于核对环境一致性',
      async run(ctx) {
        if (!ctx.workspaceRoot) {
          throw new Error('未打开工作区。')
        }
        // T5.4 / P1-12：优先复用宿主注入的快照（如启动任务已探测过），无则现场运行
        const snapshotSource = options?.getEnvironmentSnapshot?.()
        const result =
          snapshotSource ??
          (await environmentTask.run({
            output: ctx.output,
            workspaceRoot: ctx.workspaceRoot,
            signal: new TaskSignalSource().signal,
          }))
        const snapshot = {
          finishedAt: result.finishedAt,
          status: result.status,
          items: result.items.map((item) => ({
            name: item.label,
            version: item.description,
            status: item.status,
          })),
        }
        const fileUri = vscode.Uri.joinPath(ctx.workspaceRoot, '.crud-starter/environment.json')
        // 单步重跑时 artifactDir 可能尚未执行：确保目录存在再写入
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, '..'))
        await vscode.workspace.fs.writeFile(
          fileUri,
          Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8')
        )
        const okCount = result.items.filter((item) => item.status === 'ok').length
        const reused = snapshotSource ? '（复用已有检测结果）' : ''
        return `快照已写入${reused}（${okCount}/${result.items.length} 项就绪）。`
      },
    },
  ]
}
