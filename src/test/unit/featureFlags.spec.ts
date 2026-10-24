import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { FEATURE_FLAGS, setFeatureValue } from '../../features/featureConfig/featureFlags'

/**
 * setFeatureValue 写入作用域（P1-08 修复）：写入 target 必须与生效来源一致——
 * 工作区有覆盖时写 Workspace（否则「点击开关无变化」），无覆盖时写 Global。
 * 通过替换测试桩的 getConfiguration 注入可控 inspect/update 实现。
 */

interface RecordedUpdate {
  key: string
  value: boolean
  target?: vscode.ConfigurationTarget
}

function fakeConfiguration(workspaceValue: boolean | undefined): {
  config: ReturnType<typeof vscode.workspace.getConfiguration>
  updates: RecordedUpdate[]
} {
  const updates: RecordedUpdate[] = []
  const config = {
    get: (_key: string, defaultValue?: boolean) => workspaceValue ?? defaultValue ?? false,
    has: () => true,
    inspect: (key: string) => ({ key: `crudStarter.${key}`, workspaceValue }),
    update: async (key: string, value: boolean, target?: vscode.ConfigurationTarget) => {
      updates.push({ key, value, target })
    },
  } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>
  return { config, updates }
}

describe('featureFlags 写入作用域（P1-08）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无工作区覆盖时写入 Global（用户设置）', async () => {
    const { config, updates } = fakeConfiguration(undefined)
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(config)
    await setFeatureValue('confirmDelete', false)
    expect(updates).toEqual([
      { key: 'features.confirmDelete', value: false, target: vscode.ConfigurationTarget.Global },
    ])
  })

  it('存在工作区覆盖时写入 Workspace（与生效来源一致，修复「点击无效」）', async () => {
    const { config, updates } = fakeConfiguration(true)
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(config)
    await setFeatureValue('successNotifications', false)
    expect(updates).toEqual([
      {
        key: 'features.successNotifications',
        value: false,
        target: vscode.ConfigurationTarget.Workspace,
      },
    ])
  })

  it('开关清单与 package.json 的 crudStarter.features.* 声明一一对应（门禁兜底，此处锁定数量）', () => {
    // 6 个开关：删除确认 / 成功通知 / 优先级图标 / 视图徽标 / 自动刷新 / 串口控制台
    expect(FEATURE_FLAGS.map((flag) => flag.key)).toEqual([
      'confirmDelete',
      'successNotifications',
      'showPriorityIcons',
      'showViewBadges',
      'autoRefreshOnExternalChange',
      'serialConsole',
    ])
    for (const flag of FEATURE_FLAGS) {
      expect(typeof flag.defaultValue).toBe('boolean')
    }
  })
})
