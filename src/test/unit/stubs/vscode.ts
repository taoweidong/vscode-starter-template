/**
 * `vscode` 模块的单元测试桩（NFR-07 / docs/需求与优化方案/03 §6.1）。
 *
 * 由 vitest.config.ts 的 resolve.alias 将 `import * as vscode from 'vscode'`
 * 重定向到本文件——被测源码零改动即可在无 VSCode 宿主的环境下运行。
 *
 * 设计原则：
 * - 只覆盖 src/ 实际使用到的 API 面；缺什么由用例作者按需补充（勿删已有导出）；
 * - 副作用可观测、可重置：统一经 `__resetStubs()` / `__stubs` 访问与清理；
 * - `workspace.fs` 基于真实 Node fs（测试用临时目录），错误映射为 FileSystemError
 *   并携带 VSCode 语义的 code（'FileNotFound' 等）。
 */
import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import * as nodePath from 'node:path'

/* ---------------- 基础类型与枚举 ---------------- */

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export const QuickPickItemKind = { Separator: -1, Default: 0 } as const

export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
} as const

/** 与真实 vscode.ViewColumn 对齐的最小枚举（createWebviewPanel 的 showOptions 用）。 */
export enum ViewColumn {
  Active = 1,
  Beside = 2,
  One = 1,
  Two = 2,
  Three = 3,
}

/* ---------------- 可释放 / 事件 ---------------- */

export class Disposable {
  constructor(private readonly callback: () => void) {}
  dispose(): void {
    this.callback()
  }
}

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => unknown>()
  private disposed = false

  /**
   * 订阅事件（对齐真实 vscode.Event 语义：传入监听器、返回可退订 Disposable）。
   * 注意：早期版本误将本属性实现为「触发函数」，导致 .event(listener) 变成触发而非订阅，
   * 现已修正——触发一律走 fire()/各桩的 __fire* 入口。
   */
  get event(): (listener: (e: T) => unknown) => Disposable {
    return (listener: (e: T) => unknown) => {
      this.listeners.add(listener)
      return new Disposable(() => this.listeners.delete(listener))
    }
  }

  fire(data: T): void {
    if (this.disposed) {
      return // 已释放的事件源不再分发（对齐真实语义）
    }
    for (const listener of [...this.listeners]) {
      listener(data)
    }
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
}

/* ---------------- URI / 文件系统 ---------------- */

function toPosix(p: string): string {
  return p.split('\\').join('/')
}

export class Uri {
  readonly scheme: string
  readonly fsPath: string
  readonly path: string
  readonly authority: string
  readonly query: string
  readonly fragment: string

  constructor(parts: { scheme: string; fsPath: string; query?: string; fragment?: string }) {
    this.scheme = parts.scheme
    this.fsPath = parts.fsPath
    this.path = toPosix(parts.fsPath)
    this.query = parts.query ?? ''
    this.fragment = parts.fragment ?? ''
    this.authority = ''
  }

  static file(path: string): Uri {
    return new Uri({ scheme: 'file', fsPath: nodePath.normalize(path) })
  }

  static parse(value: string): Uri {
    return Uri.file(value.replace(/^file:\/\//, ''))
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    return new Uri({
      scheme: base.scheme,
      fsPath: nodePath.normalize(nodePath.join(base.fsPath, ...pathSegments)),
    })
  }

  with(change: { query?: string; fragment?: string }): Uri {
    return new Uri({
      scheme: this.scheme,
      fsPath: this.fsPath,
      query: change.query ?? this.query,
      fragment: change.fragment ?? this.fragment,
    })
  }

  toString(): string {
    return `${this.scheme}://${toPosix(this.fsPath)}${this.query ? `?${this.query}` : ''}`
  }
}

export class FileSystemError extends Error {
  readonly code: string
  constructor(message: string, code = 'Unknown') {
    super(message)
    this.name = 'FileSystemError'
    this.code = code
  }
  static FileNotFound(uri: Uri): FileSystemError {
    return new FileSystemError(uri.fsPath, 'FileNotFound')
  }
}

function toFileType(stat: nodeFs.Stats): FileType {
  if (stat.isFile()) return FileType.File
  if (stat.isDirectory()) return FileType.Directory
  if (stat.isSymbolicLink()) return FileType.SymbolicLink
  return FileType.Unknown
}

function mapFsError(err: unknown, uri: Uri): unknown {
  if (err instanceof FileSystemError) return err
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return FileSystemError.FileNotFound(uri)
  if (code === 'EACCES' || code === 'EPERM') return new FileSystemError(uri.fsPath, 'NoPermissions')
  if (code === 'EISDIR') return new FileSystemError(uri.fsPath, 'FileIsADirectory')
  if (code === 'ENOTDIR') return new FileSystemError(uri.fsPath, 'FileNotADirectory')
  return err
}

/* ---------------- 配置存储 ---------------- */

interface ConfigurationLike {
  get<T>(section: string, defaultValue?: T): T
  update(section: string, value: unknown, target?: ConfigurationTarget): Promise<void>
  has(section: string): boolean
  inspect(section: string): unknown
}

/** 配置存储：section → key → value（模拟用户 / 工作区设置合并结果）。 */
const configStore = new Map<string, Map<string, unknown>>()

function makeConfiguration(section: string): ConfigurationLike {
  return {
    get<T>(key: string, defaultValue?: T): T {
      const value = configStore.get(section)?.get(key)
      return (value === undefined ? defaultValue : value) as T
    },
    async update(key: string, value: unknown, _target?: ConfigurationTarget): Promise<void> {
      __record('configUpdate', { section, key, value })
      if (!configStore.has(section)) {
        configStore.set(section, new Map())
      }
      configStore.get(section)!.set(key, value)
      fireConfigChange(`${section}.${key}`)
    },
    has(key: string): boolean {
      return configStore.get(section)?.has(key) ?? false
    },
    inspect(key: string): unknown {
      return { key: `${section}.${key}`, globalValue: configStore.get(section)?.get(key) }
    },
  }
}

const configChangeListeners = new Set<
  (event: { affectsConfiguration(section: string): boolean }) => unknown
>()

function fireConfigChange(fullKey: string): void {
  const event = {
    affectsConfiguration(section: string): boolean {
      return fullKey === section || fullKey.startsWith(`${section}.`)
    },
  }
  for (const listener of [...configChangeListeners]) {
    listener(event)
  }
}

/** 测试入口：模拟某个配置键发生变化（fullKey 形如 'crudStarter.storagePath'）。 */
export function __fireConfigurationChange(fullKey: string): void {
  fireConfigChange(fullKey)
}

/* ---------------- 工作区文件夹变化监听 ---------------- */

const workspaceFoldersListeners = new Set<() => unknown>()

/** 测试入口：模拟工作区文件夹集合变化（增删文件夹 / 首次打开）。 */
export function __fireWorkspaceFoldersChanged(): void {
  for (const listener of [...workspaceFoldersListeners]) {
    listener()
  }
}

/* ---------------- 录制器 ---------------- */

type Recorded = { kind: string; args: unknown[] }

const recorded: Recorded[] = []
function __record(kind: string, payload?: unknown): void {
  recorded.push({ kind, args: payload === undefined ? [] : [payload] })
}

/** 对话框 / QuickPick / InputBox 的排队应答（shift 取用；空则返回 undefined）。 */
const dialogQueue: unknown[] = []

export interface StubState {
  recorded: Recorded[]
  dialogQueue: unknown[]
  outputLines: string[]
  registeredCommands: Map<string, (...args: unknown[]) => unknown>
  /** 已注册的 Webview 面板序列化器（viewType → serializer），供窗口重载恢复用例驱动。 */
  registeredSerializers: Map<
    string,
    { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> }
  >
  clipboard: string
  workspaceFolders: { uri: Uri; name: string; index: number }[] | undefined
  isTrusted: boolean
}

export const __stubs: StubState = {
  recorded,
  dialogQueue,
  outputLines: [],
  registeredCommands: new Map(),
  registeredSerializers: new Map(),
  clipboard: '',
  workspaceFolders: undefined,
  isTrusted: true,
}

/** 每个用例 setup 时调用：清空全部副作用。 */
export function __resetStubs(options?: { keepWorkspaceFolders?: boolean }): void {
  recorded.length = 0
  dialogQueue.length = 0
  __stubs.outputLines.length = 0
  __stubs.registeredCommands.clear()
  __stubs.registeredSerializers.clear()
  __stubs.clipboard = ''
  configStore.clear()
  configChangeListeners.clear()
  workspaceFoldersListeners.clear()
  if (!options?.keepWorkspaceFolders) {
    __stubs.workspaceFolders = undefined
  }
  __stubs.isTrusted = true
}

/** 写入配置（等价于用户设置）。 */
export function __setConfig(section: string, key: string, value: unknown): void {
  if (!configStore.has(section)) {
    configStore.set(section, new Map())
  }
  configStore.get(section)!.set(key, value)
}

/* ---------------- window ---------------- */

function nextDialogAnswer(): unknown {
  return dialogQueue.length ? dialogQueue.shift() : undefined
}

function createOutputChannelStub(name: string) {
  return {
    name,
    appendLine(line: string): void {
      __stubs.outputLines.push(line)
    },
    append(value: string): void {
      __stubs.outputLines.push(value)
    },
    replace(value: string): void {
      __stubs.outputLines.push(value)
    },
    clear(): void {},
    show(): void {
      __record('outputShow', name)
    },
    hide(): void {},
    dispose(): void {},
  }
}

export const window = {
  createOutputChannel: (name: string) => createOutputChannelStub(name),
  showInformationMessage: (message: string, ...items: unknown[]) => {
    __record('showInformationMessage', { message, items })
    return Promise.resolve(nextDialogAnswer())
  },
  showWarningMessage: (message: string, ...items: unknown[]) => {
    __record('showWarningMessage', { message, items })
    return Promise.resolve(nextDialogAnswer())
  },
  showErrorMessage: (message: string, ...items: unknown[]) => {
    __record('showErrorMessage', { message, items })
    return Promise.resolve(nextDialogAnswer())
  },
  showQuickPick: (items: unknown, options?: unknown) => {
    __record('showQuickPick', { items, options })
    return Promise.resolve(nextDialogAnswer())
  },
  showInputBox: (options?: unknown) => {
    __record('showInputBox', options)
    return Promise.resolve(nextDialogAnswer())
  },
  showTextDocument: (uriOrDocument: unknown, _options?: unknown) => {
    __record('showTextDocument', { uriOrDocument })
    return Promise.resolve({ uri: uriOrDocument })
  },
  createTreeView: (viewId: string, options?: unknown) => {
    __record('createTreeView', { viewId, options })
    return {
      viewId,
      message: undefined,
      badge: undefined,
      reveal: () => Promise.resolve(),
      dispose: () => {},
    }
  },
  createWebviewPanel: (
    viewType: string,
    title: string,
    showOptions: unknown,
    options?: unknown
  ) => {
    __record('createWebviewPanel', { viewType, title, showOptions, options })
    return createWebviewPanelStub(viewType, title)
  },
  /** 面板序列化器注册（录制 + 可经 __stubs.registeredSerializers 驱动恢复）。 */
  registerWebviewPanelSerializer: (
    viewType: string,
    serializer: { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> }
  ): Disposable => {
    __record('registerWebviewPanelSerializer', viewType)
    __stubs.registeredSerializers.set(viewType, serializer)
    return new Disposable(() => __stubs.registeredSerializers.delete(viewType))
  },
  /** 文件夹 / 文件选择框：应答经 dialogQueue 队列（数组元素为 Uri[]，取消为 undefined）。 */
  showOpenDialog: (options?: unknown) => {
    __record('showOpenDialog', options)
    return Promise.resolve(nextDialogAnswer() as Uri[] | undefined)
  },
  withProgress: async <T>(
    options: unknown,
    task: (
      progress: { report(value: { message?: string; increment?: number }): void },
      token: {
        isCancellationRequested: boolean
        onCancellationRequested(cb: () => void): Disposable
      }
    ) => Promise<T>
  ): Promise<T> => {
    __record('withProgress', options)
    return task(
      { report: (value) => __record('progressReport', value) },
      {
        isCancellationRequested: false,
        onCancellationRequested: () => new Disposable(() => {}),
      }
    )
  },
}

/** 测试用 Webview 面板桩：postMessage 可经 webview.__emit 直接触发页面消息回调。 */
export function createWebviewPanelStub(viewType: string, title: string) {
  const messageListeners = new Set<(message: unknown) => unknown>()
  const panel = {
    viewType,
    title,
    visible: true,
    active: true,
    webview: {
      html: '',
      cspSource: 'vscode-webview://stub-csp-source',
      options: {} as Record<string, unknown>,
      postMessage: async (message: unknown): Promise<boolean> => {
        __record('webviewPostMessage', message)
        return true
      },
      asWebviewUri: (uri: Uri): Uri => uri,
      onDidReceiveMessage: (listener: (message: unknown) => unknown): Disposable => {
        messageListeners.add(listener)
        return new Disposable(() => messageListeners.delete(listener))
      },
      /** 测试入口：模拟页面发来的消息。 */
      __emit: (message: unknown): void => {
        for (const listener of [...messageListeners]) {
          void listener(message)
        }
      },
    },
    onDidDispose: (cb: () => unknown): Disposable => new Disposable(() => void cb()),
    onDidChangeViewState: (cb: () => unknown): Disposable => new Disposable(() => void cb()),
    reveal: (): void => {
      __record('panelReveal', viewType)
    },
    dispose: (): void => {
      __record('panelDispose', viewType)
    },
  }
  return panel
}

/* ---------------- workspace ---------------- */

async function fsCall<T>(uri: Uri, op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    throw mapFsError(err, uri)
  }
}

export const workspace = {
  name: 'stub-workspace',
  workspaceFolders: undefined as { uri: Uri; name: string; index: number }[] | undefined,
  isTrusted: true,
  getConfiguration: (section?: string): ConfigurationLike => makeConfiguration(section ?? ''),
  fs: {
    readFile: (uri: Uri): Promise<Uint8Array> =>
      fsCall(uri, async () => new Uint8Array(await nodeFsPromises.readFile(uri.fsPath))),
    writeFile: (uri: Uri, content: Uint8Array): Promise<void> =>
      fsCall(uri, () => nodeFsPromises.writeFile(uri.fsPath, content)),
    stat: (uri: Uri): Promise<{ type: FileType; ctime: number; mtime: number; size: number }> =>
      fsCall(uri, async () => {
        const s = await nodeFsPromises.stat(uri.fsPath)
        return { type: toFileType(s), ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size }
      }),
    createDirectory: (uri: Uri): Promise<void> =>
      fsCall(uri, async () => {
        await nodeFsPromises.mkdir(uri.fsPath, { recursive: true })
      }),
    readDirectory: (uri: Uri): Promise<[string, FileType][]> =>
      fsCall(uri, async () => {
        const entries = await nodeFsPromises.readdir(uri.fsPath, { withFileTypes: true })
        return entries.map(
          (e) =>
            [e.name, e.isDirectory() ? FileType.Directory : FileType.File] as [string, FileType]
        )
      }),
    rename: (source: Uri, target: Uri, _options?: { overwrite?: boolean }): Promise<void> =>
      // node 的 rename 在两个平台上都覆盖已存在目标，与 overwrite:true 语义一致
      fsCall(source, () => nodeFsPromises.rename(source.fsPath, target.fsPath)),
    copy: (source: Uri, target: Uri, options?: { overwrite?: boolean }): Promise<void> =>
      fsCall(source, () =>
        nodeFsPromises.copyFile(
          source.fsPath,
          target.fsPath,
          options?.overwrite ? 0 : nodeFs.constants.COPYFILE_EXCL
        )
      ),
    delete: (uri: Uri, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> =>
      fsCall(uri, () => nodeFsPromises.rm(uri.fsPath, { recursive: options?.recursive ?? false })),
  },
  createFileSystemWatcher: (globPattern: unknown) => {
    __record('createFileSystemWatcher', globPattern)
    const change = new EventEmitter<void>()
    const create = new EventEmitter<void>()
    const del = new EventEmitter<void>()
    return {
      onDidChange: (cb: () => unknown) => change.event(cb),
      onDidCreate: (cb: () => unknown) => create.event(cb),
      onDidDelete: (cb: () => unknown) => del.event(cb),
      __fireChange: () => change.fire(),
      __fireCreate: () => create.fire(),
      __fireDelete: () => del.fire(),
      dispose: () => {
        change.dispose()
        create.dispose()
        del.dispose()
      },
    }
  },
  onDidChangeConfiguration: (
    listener: (event: { affectsConfiguration(section: string): boolean }) => unknown
  ): Disposable => {
    configChangeListeners.add(listener)
    return new Disposable(() => configChangeListeners.delete(listener))
  },
  onDidChangeWorkspaceFolders: (listener: () => unknown): Disposable => {
    __record('onDidChangeWorkspaceFolders')
    workspaceFoldersListeners.add(listener)
    return new Disposable(() => workspaceFoldersListeners.delete(listener))
  },
  asRelativePath: (pathOrUri: unknown): string => String(pathOrUri),
  findFiles: async (): Promise<Uri[]> => [],
  openTextDocument: async (uri: Uri): Promise<unknown> => ({ uri }),
}

/* ---------------- commands / env / 其余 UI 值类型 ---------------- */

export const commands = {
  registerCommand: (command: string, callback: (...args: unknown[]) => unknown): Disposable => {
    __stubs.registeredCommands.set(command, callback)
    return new Disposable(() => __stubs.registeredCommands.delete(command))
  },
  executeCommand: async (command: string, ...args: unknown[]): Promise<unknown> => {
    __record('executeCommand', { command, args })
    const handler = __stubs.registeredCommands.get(command)
    if (!handler) {
      throw new Error(`命令未注册（stub）：${command}`)
    }
    return handler(...args)
  },
  getCommands: async (): Promise<string[]> => [...__stubs.registeredCommands.keys()],
}

export const env = {
  appName: 'stub',
  clipboard: {
    writeText: async (value: string): Promise<void> => {
      __stubs.clipboard = value
    },
    readText: async (): Promise<string> => __stubs.clipboard,
  },
  uiKind: 1,
  language: 'zh-cn',
}

export class ThemeIcon {
  readonly id: string
  constructor(id: string) {
    this.id = id
  }
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class TreeItem {
  label?: string | { label: string }
  id?: string
  description?: string | boolean
  tooltip?: string | unknown
  iconPath?: unknown
  contextValue?: string
  command?: { command: string; title: string; arguments?: unknown[] }
  collapsibleState?: TreeItemCollapsibleState
  accessibilityInformation?: { label: string; role?: string }
  constructor(label?: string | { label: string }, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label
    this.collapsibleState = collapsibleState
  }
}

export class MarkdownString {
  value = ''
  supportThemeIcons = false
  supportHtml = false
  isTrusted: unknown = undefined
  appendMarkdown(value: string): this {
    this.value += value
    return this
  }
  appendText(value: string): this {
    this.value += value
    return this
  }
  appendCodeblock(code: string, language = ''): this {
    this.value += `\`\`\`${language}\n${code}\n\`\`\``
    return this
  }
}

export class RelativePattern {
  base: unknown
  pattern: string
  constructor(base: unknown, pattern: string) {
    this.base = base
    this.pattern = pattern
  }
}

/** Memento / ExtensionContext 由测试自行构造，此处仅提供便捷实现。 */
export function createMementoStub(initial: Record<string, unknown> = {}) {
  const backing = new Map<string, unknown>(Object.entries(initial))
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      backing.has(key) ? (backing.get(key) as T) : (defaultValue as T),
    update: async (key: string, value: unknown): Promise<void> => {
      backing.set(key, value)
    },
    keys: (): string[] => [...backing.keys()],
    setKeysForSync: (): void => {},
    __backing: backing,
  }
}

export function createExtensionContextStub() {
  return {
    subscriptions: [] as Disposable[],
    globalState: createMementoStub(),
    workspaceState: createMementoStub(),
    extensionUri: Uri.file(process.cwd()),
    extensionPath: process.cwd(),
    globalStorageUri: Uri.file(nodePath.join(process.cwd(), '.stub-global-storage')),
    globalStoragePath: nodePath.join(process.cwd(), '.stub-global-storage'),
    storageUri: Uri.file(nodePath.join(process.cwd(), '.stub-storage')),
    storagePath: nodePath.join(process.cwd(), '.stub-storage'),
    logUri: Uri.file(nodePath.join(process.cwd(), '.stub-log')),
    logPath: nodePath.join(process.cwd(), '.stub-log'),
    asAbsolutePath: (p: string): string => nodePath.join(process.cwd(), p),
    environmentVariableCollection: {},
    extensionMode: 1,
    secrets: {},
    languageModelAccessInformation: {},
  }
}

/* 让 workspace.workspaceFolders / isTrusted 与 __stubs 联动（保持引用一致） */
Object.defineProperty(workspace, 'workspaceFolders', {
  get: () => __stubs.workspaceFolders,
  set: (value) => {
    __stubs.workspaceFolders = value
  },
})
Object.defineProperty(workspace, 'isTrusted', {
  get: () => __stubs.isTrusted,
  set: (value) => {
    __stubs.isTrusted = value
  },
})
