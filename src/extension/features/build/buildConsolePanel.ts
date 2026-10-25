import * as vscode from 'vscode'
import { CONFIG } from '../../constants'
import {
  WebviewController,
  type WebviewControllerDeps,
} from '../../../webview/host/webviewController'
import { deriveFormSchema, toFieldDefs } from '../../../webview/formSchema'
import type { BuildTaskWire } from '../../../webview/protocol'
import { BUILD_FIELD_DEFS } from './buildSchema'
import { createBuildApiClient, type BuildApiClient, type BuildTask } from './buildApiClient'

/**
 * 分支编译控制台（v2.0 改造）：Webview 弹框表单 → HTTP 提交构建任务 → 轮询拉取
 * 任务列表展示。HTTP 接口默认打桩模拟（`extStarter.buildApiBaseUrl` 留空），
 * 配置后切换真实接口——页面与协议层零改动（见 buildApiClient.ts）。
 *
 * 消息流（复用控制器通用提交生命周期 R-C-10）：
 * - 页面 `ready` → init（schema = BUILD_FIELD_DEFS 派生）；
 * - 页面 `submit` → deps.onSubmit → api.submit（打桩/真实）→ submitAck + buildList 全量；
 * - 页面 `buildListRequest`（轮询）→ deps.onPageMessage → api.list → buildList 全量；
 * - 失败 → 控制器统一 error（err.field 定位表单控件）。
 */
export interface BuildConsoleServices {
  api: BuildApiClient
  output: vscode.OutputChannel
}

/** 组装服务（extension.ts 调用一次；baseUrl 配置决定打桩 / 真实）。 */
export function createBuildConsoleServices(output: vscode.OutputChannel): BuildConsoleServices {
  const baseUrl = vscode.workspace
    .getConfiguration(CONFIG.section)
    .get<string>(CONFIG.buildApiBaseUrl, '')
  return {
    api: createBuildApiClient(baseUrl),
    output,
  }
}

/** BuildTask → 协议线类型（匿名字面量展开获得隐式索引签名，与 toServerWire 同理）。 */
export function toBuildTaskWire(task: BuildTask): BuildTaskWire {
  return { ...task }
}

export function createBuildConsoleDeps(services: BuildConsoleServices): WebviewControllerDeps {
  const { api, output } = services

  async function pushList(): Promise<void> {
    const tasks = await api.list()
    await WebviewController.get('buildConsole')?.post({
      type: 'buildList',
      tasks: tasks.map(toBuildTaskWire),
    })
  }

  return {
    buildInit: () => ({
      schema: toFieldDefs(deriveFormSchema(BUILD_FIELD_DEFS)),
      value: {},
      extra: { mode: 'buildConsole' },
    }),

    // 通用提交生命周期：resolve → 控制器回 submitAck；抛错 → error（err.field 随行）
    onSubmit: async (draft) => {
      const branch = typeof draft.branch === 'string' ? draft.branch : ''
      const buildType = draft.buildType === 'incremental' ? 'incremental' : 'full'
      const notes = typeof draft.notes === 'string' ? draft.notes : undefined
      if (!branch.trim()) {
        throw Object.assign(new Error('分支名不能为空。'), { field: 'branch' })
      }
      output.appendLine(`[分支编译] 提交构建任务：${branch.trim()}（${buildType}）`)
      const task = await api.submit({ branch, buildType, notes })
      output.appendLine(`[分支编译] 任务已受理：${task.id}（${task.status}）`)
      await pushList()
    },

    onPageMessage: (message) => {
      if (message.type === 'buildListRequest') {
        void pushList()
      }
    },

    log: (message) => output.appendLine(`[分支编译] ${message}`),
  }
}

/** 分支编译面板入口：打开（或复用）Webview 弹框。 */
export class BuildConsolePanel {
  private static context: vscode.ExtensionContext | undefined

  static configure(context: vscode.ExtensionContext): void {
    BuildConsolePanel.context = context
  }

  static createOrShow(services: BuildConsoleServices): void {
    const context = BuildConsolePanel.context
    if (!context) {
      void vscode.window.showErrorMessage(
        '分支编译面板未完成装配（缺少扩展上下文），请重新加载窗口。'
      )
      return
    }
    WebviewController.createOrShow('buildConsole', context, createBuildConsoleDeps(services))
  }
}
