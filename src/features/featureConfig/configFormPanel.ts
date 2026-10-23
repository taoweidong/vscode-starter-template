import * as vscode from 'vscode'
import {
  FEATURE_FLAGS,
  getFeatureValue,
  getFeatureValues,
  setFeatureValue,
  toFeatureFormFields,
} from './featureFlags'
import { toFieldDefs } from '../../webview/formSchema'
import { WebviewController, type WebviewControllerDeps } from '../../webview/host/webviewController'

/**
 * 特性配置面板（M4-T4.3 重写）：宿主侧改走通用 WebviewController。
 *
 * - init 回显 getFeatureValues()；保存（submit）逐项 setFeatureValue；
 * - 批量写入采用 allSettled 语义：全部完成后收集失败项——
 *   部分失败抛错（回 error 消息列出失败开关，面板保持打开供重试），
 *   全部成功才关闭面板 + 成功提示（受 successNotifications 开关约束）；
 * - setFeatureValue 可注入（单测模拟部分失败）。
 */
export class ConfigFormPanel {
  private static context: vscode.ExtensionContext | undefined
  private static current: ConfigFormPanel | undefined

  /** extension.ts 组装时注入扩展上下文（面板资源解析基准）。 */
  static configure(context: vscode.ExtensionContext): void {
    ConfigFormPanel.context = context
  }

  static createOrShow(extraDeps?: Partial<WebviewControllerDeps>): void {
    const context = ConfigFormPanel.context
    if (!context) {
      void vscode.window.showErrorMessage(
        '特性配置面板未完成装配（缺少扩展上下文），请重新加载窗口。'
      )
      return
    }
    const existing = ConfigFormPanel.current
    if (existing && existing.isActive()) {
      existing.controller?.reveal()
      return
    }
    ConfigFormPanel.current = new ConfigFormPanel(context, extraDeps)
  }

  private controller: WebviewController | undefined

  private constructor(
    context: vscode.ExtensionContext,
    extraDeps?: Partial<WebviewControllerDeps>
  ) {
    const baseDeps = this.buildDeps()
    this.controller = WebviewController.createOrShow(
      'featureConfig',
      context,
      extraDeps ? { ...baseDeps, ...extraDeps } : baseDeps
    )
  }

  private isActive(): boolean {
    return (
      this.controller !== undefined && WebviewController.get('featureConfig') === this.controller
    )
  }

  private close(): void {
    if (ConfigFormPanel.current === this) {
      ConfigFormPanel.current = undefined
    }
    this.controller?.dispose()
    this.controller = undefined
  }

  private buildDeps(): WebviewControllerDeps {
    const panel = this
    return createFeatureConfigDeps({
      onSaved: () => panel.close(),
      onCancel: () => panel.close(),
    })
  }
}

/** createFeatureConfigDeps 的可选钩子（保存成功 / 取消后由面板关闭自身）。 */
export interface FeatureConfigDepsOptions {
  onSaved?: () => void
  /** 取消回调（页面点取消 / Esc 后由面板关闭自身）。 */
  onCancel?: () => void
  /** 单测注入：模拟部分开关写入失败。 */
  applyFeatureValue?: (key: string, value: boolean) => Promise<void>
}

/**
 * 特性配置页面的宿主依赖工厂（serializer 复用；onSubmit 也可用于面板直连）。
 * allSettled 语义见类注释；失败开关联同 label 一并列出，便于用户定位重试。
 */
export function createFeatureConfigDeps(
  options: FeatureConfigDepsOptions = {}
): WebviewControllerDeps {
  const apply = options.applyFeatureValue ?? setFeatureValue
  return {
    buildInit: () => ({
      schema: toFieldDefs(toFeatureFormFields()),
      value: getFeatureValues(),
      extra: {},
    }),
    onSubmit: async (draft: Record<string, unknown>) => {
      const entries = Object.entries(draft).filter(([key]) =>
        FEATURE_FLAGS.some((flag) => flag.key === key)
      )
      const labels = new Map(FEATURE_FLAGS.map((flag) => [flag.key, flag.label]))
      const results = await Promise.allSettled(
        entries.map(([key, value]) => apply(key, value === true))
      )
      const failedKeys = entries
        .filter((_, index) => results[index].status === 'rejected')
        .map(([key]) => labels.get(key) ?? key)
      if (failedKeys.length > 0) {
        // 部分失败：面板保持打开，列出失败开关
        throw new Error(
          `部分开关保存失败：${failedKeys.join('、')}。请重试或检查 VSCode 设置权限。`
        )
      }
      options.onSaved?.()
      if (getFeatureValue('successNotifications')) {
        void vscode.window.showInformationMessage(`已保存 ${entries.length} 项特性配置。`)
      }
    },
    onCancel: () => options.onCancel?.(),
  }
}
