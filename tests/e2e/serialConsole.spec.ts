import { expect, test } from 'playwright/test'
import { expectLastSentType, lastSent, loadPage, sendHost } from './helpers'

/**
 * 串口控制台（serialConsole）E2E：连接下发全流程 + 服务器保存（密码剥离）。
 *
 * 消息字段以 src/webview/protocol.ts 为准：
 * init{servers,history} → 连接 serialConnect → serialState{connected} →
 * serialSend{command}（本地回显）→ serialData{seq,text} 实时渲染 →
 * commandHistory{entries} 去重历史；serialServerSave{draft,password 分离}。
 *
 * schema 为 SERVER_FIELD_DEFS 派生字面量的内联副本（playwright 无法跨目录解析 src 模块，
 * 与宿主派生逻辑的一致性由单测 formSchema.spec 锁定）。
 */
const SCHEMA = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '如：服务器甲' },
  { key: 'serialPath', label: '串口', type: 'text', required: true, placeholder: '如 COM3' },
  {
    key: 'baudRate',
    label: '波特率',
    type: 'select',
    defaultValue: '115200',
    options: [{ value: '115200', label: '115200' }],
  },
  {
    key: 'dataBits',
    label: '数据位',
    type: 'select',
    defaultValue: '8',
    options: [{ value: '8', label: '8' }],
  },
  {
    key: 'stopBits',
    label: '停止位',
    type: 'select',
    defaultValue: '1',
    options: [{ value: '1', label: '1' }],
  },
  {
    key: 'parity',
    label: '校验位',
    type: 'select',
    defaultValue: 'none',
    options: [{ value: 'none', label: '无' }],
  },
  {
    key: 'flowControl',
    label: '流控',
    type: 'select',
    defaultValue: 'none',
    options: [{ value: 'none', label: '无' }],
  },
  {
    key: 'lineEnding',
    label: '命令换行符',
    type: 'select',
    defaultValue: 'lf',
    options: [{ value: 'lf', label: 'LF（\\n）' }],
  },
  { key: 'autoLogin', label: '自动登录', type: 'boolean', defaultValue: 'false' },
  { key: 'username', label: '登录用户名', type: 'text' },
  { key: 'password', label: '登录密码', type: 'text', placeholder: '选填' },
  { key: 'description', label: '备注', type: 'textarea' },
]

const SERVER = {
  id: 'srv-1',
  name: '服务器甲',
  serialPath: 'COM3',
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
  lineEnding: 'lf',
  autoLogin: false,
  username: '',
  description: '',
  createdAt: 1,
  updatedAt: 1,
}

async function initConsole(
  page: Parameters<typeof sendHost>[0],
  extra: Record<string, unknown> = {}
): Promise<void> {
  await sendHost(page, {
    type: 'init',
    page: 'serialConsole',
    schema: SCHEMA,
    value: null,
    extra: { servers: [SERVER], history: [], ...extra },
  })
}

test('serialConsole：连接 → 下发命令 → 实时输出 → 历史去重回填', async ({ page }) => {
  await loadPage(page, 'serialConsole')
  await expectLastSentType(page, 'ready')
  await initConsole(page)

  await expect(page.locator('.app-shell__title')).toHaveText('串口控制台')
  await expect(page.locator('.server-list__name')).toHaveText('服务器甲')
  await expect(page.locator('.console__status-text')).toHaveText('未连接')

  // ① 行内「连接」→ serialConnect；宿主回 connected
  await page.locator('.server-list__actions button').first().click()
  expect(await lastSent(page)).toEqual({ type: 'serialConnect', serverId: 'srv-1' })
  await sendHost(page, { type: 'serialState', serverId: 'srv-1', state: 'connected' })
  await expect(page.locator('.console__status-text')).toHaveText('已连接：服务器甲')

  // ② 输入命令回车 → serialSend + 本地回显
  await page.getByLabel('串口命令输入').fill('show version')
  await page.getByLabel('串口命令输入').press('Enter')
  expect(await lastSent(page)).toEqual({ type: 'serialSend', command: 'show version' })
  await expect(page.locator('.console-output__scroll')).toContainText('> show version')

  // ③ 宿主串口输出实时渲染（两批）
  await sendHost(page, { type: 'serialData', seq: 1, text: 'Ubuntu 22.04 LTS\n' })
  await sendHost(page, { type: 'serialData', seq: 2, text: 'login:' })
  await expect(page.locator('.console-output__block')).toHaveCount(3)
  await expect(page.locator('.console-output__scroll')).toContainText('Ubuntu 22.04 LTS')

  // ④ 历史推送（重复命令 useCount 累加）→ 单击回填输入框
  await sendHost(page, {
    type: 'commandHistory',
    entries: [
      { id: 'h1', command: 'show version', lastUsedAt: 2, useCount: 3 },
      { id: 'h2', command: 'ls', lastUsedAt: 1, useCount: 1 },
    ],
  })
  await expect(page.locator('.history-panel__row')).toHaveCount(2)
  await expect(page.locator('.history-panel__row').first()).toContainText('×3')
  await page.locator('.history-panel__row', { hasText: 'ls' }).click()
  await expect(page.getByLabel('串口命令输入')).toHaveValue('ls')

  await page.screenshot({ path: 'test-results/serialConsole.png', fullPage: true })
})

test('serialConsole：新增服务器保存（密码单独携带，draft 零明文）', async ({ page }) => {
  await loadPage(page, 'serialConsole')
  await initConsole(page)

  await page.getByPlaceholder('如：服务器甲').fill('服务器乙')
  await page.getByPlaceholder('如 COM3').fill('COM7')
  await page.getByPlaceholder('选填').fill('s3cret')
  await page.getByRole('button', { name: /保存服务器/ }).click()

  const sent = (await lastSent(page)) as {
    type?: string
    draft?: Record<string, unknown>
    password?: string
  }
  expect(sent.type).toBe('serialServerSave')
  expect(sent.draft).toMatchObject({ name: '服务器乙', serialPath: 'COM7' })
  expect(sent.draft && 'password' in sent.draft).toBe(false)
  expect(sent.password).toBe('s3cret')

  // 宿主推送最新列表 → 表单复位为新增态
  await sendHost(page, {
    type: 'serialServers',
    servers: [SERVER, { ...SERVER, id: 'srv-2', name: '服务器乙', serialPath: 'COM7' }],
  })
  await expect(page.getByPlaceholder('如：服务器甲')).toHaveValue('')
  await expect(page.locator('.server-list__row')).toHaveCount(2)
})

test('serialConsole：检测串口 chips 点击填充', async ({ page }) => {
  await loadPage(page, 'serialConsole')
  await initConsole(page)

  await page.getByRole('button', { name: '检测串口' }).click()
  await expectLastSentType(page, 'serialPortsRequest')
  await sendHost(page, { type: 'serialPorts', ports: [{ path: 'COM9' }, { path: 'COM10' }] })
  await expect(page.locator('.server-form__chip')).toHaveCount(2)
  await page.locator('.server-form__chip', { hasText: 'COM10' }).click()
  await expect(page.getByPlaceholder('如 COM3')).toHaveValue('COM10')
})
