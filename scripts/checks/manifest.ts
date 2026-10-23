/**
 * 门禁「静态一致性检查」步骤：无需 VS Code 宿主的结构化校验（M6 / T6.4 去硬编码）。
 *
 * 校验 package.json 清单 ↔ src/constants.ts ↔ src/commands/ ↔ 视图 when 条件
 * ↔ 特性开关 ↔ 图标资源 ↔ Webview 构建产物。
 * 面向「可改名 / 可扩展的模板」做**结构**校验（双向闭合），不断言具体项目身份：
 * - 不再断言项目名 / repository 必须包含特定字符串（P1-14）；
 * - 视图数量不做下限断言，改为 constants VIEW ↔ manifest views 双向一致 + 菜单 when
 *   中的 `view == xxx` 必须指向真实存在的视图；
 * - 命令提取正则支持数字与连字符；
 * - 新增：清单每个命令必须在 src/commands/ 下有 `register(COMMAND.xxx` 注册；
 *   （扫描 src/commands/ 目录全部 .ts——命令可按场景拆分为多文件，注册检查不失效）；
 * - 新增：FEATURE_FLAGS（key + defaultValue）↔ `crudStarter.features.*` 配置声明双向一致；
 * - 新增：media/icon.svg 与 media/icon.png 存在（发布元数据）。
 */
import assert from 'node:assert'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'

/** package.json 清单中参与校验的最小结构 */
interface ExtensionManifest {
  name: string
  repository?: { url?: string }
  contributes: {
    commands: { command: string }[]
    submenus?: { id: string }[]
    menus: Record<string, ManifestMenuEntry[]>
    keybindings: { command: string }[]
    views: Record<string, { id: string }[]>
    viewsContainers: { activitybar: { id: string }[] }
    configuration?: { properties?: Record<string, { type?: string; default?: unknown }> }
  }
}

interface ManifestMenuEntry {
  command?: string
  submenu?: string
  when?: string
}

/** 表单 Schema 模块的最小类型面（对应 out/ 下编译产物） */
interface FormFieldLike {
  key: string
}

interface FormSchemaModule {
  FORM_SCHEMA: readonly FormFieldLike[]
}

interface FeatureFlagsModule {
  FEATURE_FLAGS: readonly { key: string; defaultValue: boolean }[]
  toFeatureFormFields(): readonly FormFieldLike[]
}

interface DomainSchemaModule {
  ITEM_FIELD_DEFS: readonly FormFieldLike[]
}

/** Webview 页面注册表模块的最小类型面（out/webview/pages.js） */
interface PagesModule {
  WEBVIEW_PAGES: readonly { id: string; entry: string }[]
}

/** Vite manifest 中单个 chunk 的最小结构 */
interface ManifestChunkLike {
  file?: unknown
  name?: unknown
  src?: unknown
}

/** Node 的 CJS 加载器（Module._load 为非公开 API，仅用于 stub `vscode` 模块） */
type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown
interface NodeModuleConstructor {
  _load: ModuleLoad
}

/**
 * 执行全部静态一致性检查，任一断言失败即抛错（由门禁步骤捕获）。
 * @param root 仓库根目录（必须已完成 `tsc -p . --outDir out` 测试编译与 vite build）
 */
export function checkManifestConsistency(root: string): void {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as ExtensionManifest

  // ---- 发布元数据：图标资源存在（活动栏 SVG + 市场 PNG，M6 / T6.5）----
  assert(existsSync(path.join(root, 'media', 'icon.svg')), '缺少 media/icon.svg（活动栏图标）')
  assert(existsSync(path.join(root, 'media', 'icon.png')), '缺少 media/icon.png（市场图标）')

  // ---- 命令 / 子菜单 / 视图 声明闭合 ----
  const cmds = new Set(pkg.contributes.commands.map((c) => c.command))
  const subs = new Set((pkg.contributes.submenus || []).map((s) => s.id))
  const menus = pkg.contributes.menus
  const checkEntry = (entry: ManifestMenuEntry, where: string): void => {
    const label = entry.command || entry.submenu
    assert(entry.when && entry.when.includes('view =='), `${where} 缺 when: ${label}`)
    if (entry.command) assert(cmds.has(entry.command), `${where} 引用未声明命令: ${entry.command}`)
    if (entry.submenu)
      assert(subs.has(entry.submenu), `${where} 引用未声明子菜单: ${entry.submenu}`)
  }
  for (const entry of menus['view/title']) checkEntry(entry, 'view/title')
  for (const entry of menus['view/item/context']) checkEntry(entry, 'view/item/context')
  for (const subId of subs) {
    assert(Array.isArray(menus[subId]), `子菜单缺少菜单节: ${subId}`)
    for (const entry of menus[subId]) {
      assert(entry.command && cmds.has(entry.command), `子菜单引用未声明命令: ${entry.command}`)
    }
  }
  for (const key of ['editor/context', 'explorer/context', 'editor/title']) {
    for (const entry of menus[key] || []) {
      if (entry.command) {
        assert(cmds.has(entry.command), `${key} 引用未声明命令: ${entry.command}`)
      }
      // editor/context 与 editor/title 的可见性依赖编辑器状态（选区/是否打开），必须声明 when；
      // explorer/context 天然适用于所有资源，when 可选
      if (key !== 'explorer/context') {
        assert(entry.when, `${key} 缺 when: ${entry.command}`)
      }
    }
  }
  for (const kb of pkg.contributes.keybindings) {
    assert(cmds.has(kb.command), `快捷键引用未声明命令: ${kb.command}`)
  }

  // ---- 视图 ↔ 容器（结构校验，替代旧「视图数 ≥ 6」硬编码断言）----
  const viewIds = new Set<string>()
  for (const [containerId, views] of Object.entries(pkg.contributes.views)) {
    assert(
      pkg.contributes.viewsContainers.activitybar.some((v) => v.id === containerId),
      `视图容器未声明: ${containerId}`
    )
    for (const view of views) viewIds.add(view.id)
  }

  // 菜单 when 中的 `view == xxx` 必须指向真实视图（防拼写错误 / 改名漏同步）
  for (const [section, entries] of Object.entries(menus)) {
    for (const entry of entries) {
      for (const match of entry.when?.matchAll(/view\s*==\s*([\w.-]+)/g) ?? []) {
        assert(viewIds.has(match[1]), `菜单 ${section} 的 when 引用未声明视图: ${match[1]}`)
      }
    }
  }

  // constants.ts ↔ manifest 双向一致（命令与视图）
  const src = readFileSync(path.join(root, 'src', 'constants.ts'), 'utf8')
  /** 截取某常量块：自声明起，至其后首个 `} as const`（分号风格无关）为止 */
  const constBlock = (name: string): string => {
    const start = src.indexOf(`export const ${name}`)
    assert(start >= 0, `constants.ts 未找到 export const ${name}`)
    const offset = src.slice(start).search(/}\s*as const/)
    assert(offset >= 0, `constants.ts 的 ${name} 块未正常闭合（} as const）`)
    return src.slice(start, start + offset)
  }
  const commandBlock = constBlock('COMMAND')
  // 正则支持数字与连字符（如 crudStarter.export2-fmt），修复旧版遇数字截断问题
  const commandPairs = [...commandBlock.matchAll(/(\w+):\s*'(crudStarter\.[a-zA-Z0-9-]+)'/g)]
  const keyToId = new Map(commandPairs.map((m) => [m[1], m[2]]))
  const constIds = new Set(keyToId.values())
  for (const id of constIds) {
    assert(cmds.has(id), `constants 中的命令未在清单声明: ${id}`)
  }
  for (const id of cmds) {
    assert(constIds.has(id), `清单命令未在 constants.ts 定义: ${id}`)
  }

  const viewBlock = constBlock('VIEW')
  const constViewIds = new Set([...viewBlock.matchAll(/\w*ViewId:\s*'([^']+)'/g)].map((m) => m[1]))
  for (const id of constViewIds) {
    assert(viewIds.has(id), `constants 中的视图未在清单声明: ${id}`)
  }
  for (const id of viewIds) {
    assert(constViewIds.has(id), `清单视图未在 constants.ts 定义: ${id}`)
  }
  const containerMatch = /containerId:\s*'([^']+)'/.exec(viewBlock)
  assert(
    containerMatch &&
      pkg.contributes.viewsContainers.activitybar.some((v) => v.id === containerMatch[1]),
    `constants VIEW.containerId 与 viewsContainers 不一致: ${containerMatch?.[1] ?? '(未找到)'}`
  )

  // ---- 命令注册检查：清单每个命令必须在 src/commands/ 下有 register(COMMAND.xxx ----
  // 扫描目录全部 .ts（命令可按场景拆分；旧实现硬编码 index.ts，拆分即失效）
  const commandsDir = path.join(root, 'src', 'commands')
  const commandsSrc = readdirSync(commandsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(path.join(commandsDir, file), 'utf8'))
    .join('\n')
  const registeredKeys = new Set(
    [...commandsSrc.matchAll(/register\(\s*COMMAND\.(\w+)/g)].map((m) => m[1])
  )
  for (const [key, id] of keyToId) {
    assert(registeredKeys.has(key), `命令未在 src/commands/ 注册: ${id}（COMMAND.${key}）`)
  }
  for (const key of registeredKeys) {
    assert(keyToId.has(key), `src/commands/ 注册了 constants 未定义的命令键: COMMAND.${key}`)
  }

  // ---- 特性开关一致性：FEATURE_FLAGS ↔ package.json crudStarter.features.*（键与默认值双向）----
  const featuresPrefix = 'crudStarter.features.'
  const manifestFeatures = new Map<string, { type?: string; default?: unknown }>()
  for (const [fullKey, value] of Object.entries(pkg.contributes.configuration?.properties ?? {})) {
    if (fullKey.startsWith(featuresPrefix)) {
      manifestFeatures.set(fullKey.slice(featuresPrefix.length), value)
    }
  }

  // ---- Webview 构建产物校验（M4 起替代旧的表单渲染器运行时验证）----
  // ① dist/webview/.vite/manifest.json 存在且可解析；
  // ② manifest 覆盖 out/webview/pages.js 声明的全部入口（键为入口名或源路径，
  //    或 chunk 的 name/src 字段——与 assetResolver.findEntryChunk 同一套匹配规则）。
  const requireFromRoot = createRequire(path.join(root, 'package.json'))
  const nodeModule = requireFromRoot('node:module') as NodeModuleConstructor
  const origLoad = nodeModule._load
  nodeModule._load = function stubbedLoad(
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (request === 'vscode') return {}
    return origLoad.call(nodeModule, request, parent, isMain)
  }
  try {
    const { FORM_SCHEMA } = requireFromRoot('./out/webview/formSchema.js') as FormSchemaModule
    const featureFlagsMod = requireFromRoot(
      './out/features/featureConfig/featureFlags.js'
    ) as FeatureFlagsModule
    const { toFeatureFormFields } = featureFlagsMod
    assert(FORM_SCHEMA.length >= 5, `条目表单字段数量异常: ${FORM_SCHEMA.length}`)
    assert(toFeatureFormFields().length >= 5, '特性开关数量异常')

    // FORM_SCHEMA 必须由领域 Schema 派生（长度一致；派生逻辑由单测锁定）
    const { ITEM_FIELD_DEFS } = requireFromRoot('./out/domain/itemSchema.js') as DomainSchemaModule
    assert(
      FORM_SCHEMA.length === ITEM_FIELD_DEFS.length,
      `FORM_SCHEMA(${FORM_SCHEMA.length}) 与 ITEM_FIELD_DEFS(${ITEM_FIELD_DEFS.length}) 数量不一致——表单应由领域 Schema 派生`
    )

    // 特性开关（接上文定义的 manifestFeatures，键与默认值双向校验）
    for (const flag of featureFlagsMod.FEATURE_FLAGS) {
      const declared = manifestFeatures.get(flag.key)
      assert(declared, `特性开关未在 package.json 声明: crudStarter.features.${flag.key}`)
      assert(declared?.type === 'boolean', `特性开关类型应为 boolean: ${flag.key}`)
      assert(
        declared?.default === flag.defaultValue,
        `特性开关默认值不一致: ${flag.key}（清单 ${String(declared?.default)} / 源码 ${String(flag.defaultValue)}）`
      )
    }
    for (const key of manifestFeatures.keys()) {
      assert(
        featureFlagsMod.FEATURE_FLAGS.some((flag) => flag.key === key),
        `package.json 声明了 FEATURE_FLAGS 未定义的特性开关: ${key}`
      )
    }

    const { WEBVIEW_PAGES } = requireFromRoot('./out/webview/pages.js') as PagesModule
    assert(WEBVIEW_PAGES.length >= 4, `Webview 页面注册数量异常: ${WEBVIEW_PAGES.length}`)

    const manifestPath = path.join(root, 'dist', 'webview', '.vite', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      ManifestChunkLike
    >
    const manifestKeys = new Set(Object.keys(manifest).filter((key) => !key.startsWith('_')))
    for (const page of WEBVIEW_PAGES) {
      const candidateKeys = [page.id, page.entry]
      const matched = candidateKeys.some(
        (key) => manifestKeys.has(key) && typeof manifest[key]?.file === 'string'
      )
      const matchedByField = Object.values(manifest).some(
        (chunk) =>
          typeof chunk?.file === 'string' && (chunk.name === page.id || chunk.src === page.entry)
      )
      assert(
        matched || matchedByField,
        `Webview manifest 缺少入口「${page.id}」（${page.entry}）。请先执行 npm run build:webview。`
      )
    }
  } finally {
    nodeModule._load = origLoad
  }
}
