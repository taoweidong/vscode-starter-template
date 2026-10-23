import * as vscode from 'vscode'
import { getFeatureValue } from '../features/featureConfig/featureFlags'
import type { Item, ItemDraft, Priority } from '../models/item'
import { isPriority } from '../models/item'
import { toDraft } from '../domain/itemSchema'
import { ItemService, ItemValidationError } from '../services/itemService'
import { FORM_SCHEMA, toFieldDefs } from '../webview/formSchema'
import {
  WebviewController,
  type BuildInitContext,
  type WebviewControllerDeps,
} from '../webview/host/webviewController'

/**
 * 条目表单面板（M4-T4.2 重写）：宿主侧改走通用 WebviewController。
 *
 * - 三模式：新增（空白）/ 预填新增（initial 部分初值）/ 编辑（item 回填）；
 * - init 载荷：{schema, value, extra:{mode, itemId, categories}}（页面侧恢复草稿）；
 * - submit → service.create / update；校验错误按 field 回传定位控件；
 * - 保存成功：关闭面板 + 成功提示（受 successNotifications 开关约束）；
 * - 同一面板切换目标：dirty 时经 confirmSwitchTarget 模态确认（拒绝则保持原目标）；
 * - 序列化器恢复（窗口重载）：buildInit 依据持久化状态重建编辑目标（回查最新数据）。
 *
 * 面板创建需要 ExtensionContext（资源解析），由 extension.ts 经 configure() 注入；
 * 静态 createOrShow(service, item?, initial?) 签名保持不变，供命令层直接调用。
 */

/** 表单目标：新增 / 预填新增 / 编辑的统一描述。 */
export interface ItemFormTarget {
  mode: 'create' | 'edit'
  /** 编辑目标条目 id */
  itemId?: string
  /** 编辑目标条目（打开时的快照，init 时转成 draft） */
  item?: Item
  /** 预填初值（仅新增模式） */
  initial?: Partial<ItemDraft>
}

/** 页面持久化的草稿状态形状（与 apps/itemForm/App.vue 约定一致）。 */
interface PersistedDraftState {
  draft?: unknown
  mode?: unknown
  itemId?: unknown
}

export class ItemFormPanel {
  private static context: vscode.ExtensionContext | undefined
  private static current: ItemFormPanel | undefined

  /** extension.ts 组装时注入扩展上下文（面板资源解析基准）。 */
  static configure(context: vscode.ExtensionContext): void {
    ItemFormPanel.context = context
  }

  /**
   * 打开（或复用）条目表单面板；已打开时切换目标（dirty 会先弹模态确认）。
   * @param extraDeps 测试注入的面板依赖（createPanel / resolveAssets 等），生产不传
   */
  static createOrShow(
    service: ItemService,
    item?: Item,
    initial?: Partial<ItemDraft>,
    extraDeps?: Partial<WebviewControllerDeps>
  ): void {
    const context = ItemFormPanel.context
    if (!context) {
      void vscode.window.showErrorMessage(
        '条目表单面板未完成装配（缺少扩展上下文），请重新加载窗口。'
      )
      return
    }
    const target: ItemFormTarget = item
      ? { mode: 'edit', itemId: item.id, item }
      : { mode: 'create', initial }
    const existing = ItemFormPanel.current
    if (existing && existing.isActive()) {
      void existing.switchTarget(target)
      return
    }
    ItemFormPanel.current = new ItemFormPanel(context, service, target, extraDeps)
  }

  private controller: WebviewController | undefined

  private constructor(
    context: vscode.ExtensionContext,
    service: ItemService,
    private target: ItemFormTarget,
    extraDeps?: Partial<WebviewControllerDeps>
  ) {
    this.controller = WebviewController.createOrShow(
      'itemForm',
      context,
      extraDeps
        ? {
            ...createItemFormDeps(service, () => this.target, {
              onClose: () => this.close(),
            }),
            ...extraDeps,
          }
        : createItemFormDeps(service, () => this.target, {
            onClose: () => this.close(),
          })
    )
  }

  /** 面板是否仍然存活（用户关闭面板后控制器从注册表移除）。 */
  private isActive(): boolean {
    return this.controller !== undefined && WebviewController.get('itemForm') === this.controller
  }

  /** 切换编辑 / 新增目标：同目标只 reveal；不同目标 dirty 时模态确认。 */
  private async switchTarget(target: ItemFormTarget): Promise<void> {
    if (sameTarget(this.target, target)) {
      this.controller?.reveal()
      return
    }
    const proceed = (await this.controller?.confirmSwitchTarget('切换目标')) ?? true
    if (!proceed) {
      return
    }
    this.target = target
    // 重新下发 init：页面整体重置为当前目标（含草稿匹配恢复）
    this.controller?.sendInit()
  }

  /** 关闭面板（成功 / 取消；幂等）。 */
  private close(): void {
    if (ItemFormPanel.current === this) {
      ItemFormPanel.current = undefined
    }
    this.controller?.dispose()
    this.controller = undefined
  }
}

/** createItemFormDeps 的可选钩子。 */
export interface ItemFormDepsOptions {
  /** 保存成功 / 取消后关闭面板（实例面板与序列化恢复面板各有关闭路径）。 */
  onClose: () => void
}

/**
 * 条目表单页面的宿主依赖工厂（面板实例与序列化器共用一条提交路径）。
 *
 * @param service 条目服务
 * @param getTarget 取当前表单目标；序列化恢复流程返回 undefined（按持久化状态重建）
 */
export function createItemFormDeps(
  service: ItemService,
  getTarget: () => ItemFormTarget | undefined,
  options: ItemFormDepsOptions
): WebviewControllerDeps {
  /** 序列化恢复流程在 buildInit 时解析出的目标（提交时复用）。 */
  let restoredTarget: ItemFormTarget | undefined
  return {
    buildInit: async ({ persistedState }: BuildInitContext) => {
      // 正常打开用当前目标；序列化器恢复（窗口重载）时依据持久化状态重建
      const target = getTarget() ?? (await targetFromPersisted(service, persistedState))
      restoredTarget = target
      return buildItemFormInitPayload(service, target)
    },
    onSubmit: async (draft: Record<string, unknown>) => {
      // 提交按最新目标执行：实例面板跟随切换，恢复面板用 buildInit 解析出的目标
      const current = getTarget() ?? restoredTarget ?? { mode: 'create' as const }
      try {
        if (current.mode === 'edit' && current.itemId) {
          const updated = await service.update(current.itemId, toItemDraft(draft))
          options.onClose()
          notifySuccess(`已更新「${updated.name}」。`)
        } else {
          const created = await service.create(toItemDraft(draft))
          options.onClose()
          notifySuccess(`已新增「${created.name}」。`)
        }
      } catch (err) {
        // 校验错误尽量定位到具体字段（页面把它显示在对应控件下）
        throw withField(err, fieldOfError(err))
      }
    },
    onCancel: () => options.onClose(),
  }
}

/**
 * 序列化器依赖工厂（extension.ts 注册 WebviewController.registerSerializer 时按页分发）。
 * 恢复流程没有面板实例，关闭经控制器注册表完成。
 */
export function createItemFormSerializerDeps(service: ItemService): WebviewControllerDeps {
  return createItemFormDeps(service, () => undefined, {
    onClose: () => WebviewController.get('itemForm')?.dispose(),
  })
}

/* ================= 内部工具 ================= */

/** 组装 init 载荷（schema + 初值 + 分类建议）。 */
async function buildItemFormInitPayload(
  service: ItemService,
  target: ItemFormTarget
): Promise<{
  schema: ReturnType<typeof toFieldDefs>
  value: unknown
  extra: Record<string, unknown>
}> {
  const categories = await service.getCategories()
  const value =
    target.mode === 'edit' && target.item ? toDraft(target.item) : { ...(target.initial ?? {}) }
  const extra: Record<string, unknown> = { mode: target.mode, categories }
  if (target.itemId !== undefined) {
    extra.itemId = target.itemId
  }
  return { schema: toFieldDefs(FORM_SCHEMA), value, extra }
}

/** 成功通知统一入口：受「操作成功通知」特性开关约束。 */
function notifySuccess(message: string): void {
  if (getFeatureValue('successNotifications')) {
    void vscode.window.showInformationMessage(message)
  }
}

/** 两个目标是否等价（同模式 + 同条目 / 同初值）。 */
function sameTarget(a: ItemFormTarget | undefined, b: ItemFormTarget): boolean {
  if (!a) {
    return false
  }
  if (a.mode !== b.mode || a.itemId !== b.itemId) {
    return false
  }
  return JSON.stringify(a.initial ?? {}) === JSON.stringify(b.initial ?? {})
}

/** 持久化状态 → 表单目标；匹配不上（或无持久化）回退空白新增。 */
async function targetFromPersisted(
  service: ItemService,
  persistedState: unknown
): Promise<ItemFormTarget> {
  const state = persistedState as PersistedDraftState | undefined
  if (
    state &&
    typeof state === 'object' &&
    state.mode === 'edit' &&
    typeof state.itemId === 'string'
  ) {
    const item = await service.get(state.itemId)
    if (item) {
      return { mode: 'edit', itemId: item.id, item }
    }
  }
  return { mode: 'create' }
}

/** Item → 全字段草稿（剥离 id / createdAt / updatedAt，含扩展字段）由领域层提供（M5-T5.1）。 */

/** 页面字段集 → ItemDraft（结构清洗；校验交给服务层）。 */
function toItemDraft(draft: Record<string, unknown>): ItemDraft {
  return {
    name: String(draft.name ?? ''),
    category: String(draft.category ?? ''),
    description: String(draft.description ?? ''),
    priority: (isPriority(draft.priority) ? draft.priority : 'medium') as Priority,
    tags: Array.isArray(draft.tags) ? draft.tags.map(String) : [],
  }
}

/** 给错误附加 field 属性（webviewController 会随 error 消息下发，页面据此定位控件）。 */
function withField(err: unknown, field: string | undefined): unknown {
  if (field === undefined) {
    return err
  }
  return Object.assign(err instanceof Error ? err : new Error(String(err)), { field })
}

/** 服务层校验错误 → 字段 key：按 FORM_SCHEMA 的必填字段 label 匹配错误文案。 */
function fieldOfError(err: unknown): string | undefined {
  if (!(err instanceof ItemValidationError)) {
    return undefined
  }
  const hit = FORM_SCHEMA.find((field) => field.required && err.message.includes(field.label))
  return hit?.key
}
