import { expect, test } from 'playwright/test'
import { fieldControl, expectLastSentType, lastSent, loadPage, sendHost } from './helpers'

/**
 * 分支编译弹框（buildConsole）E2E：表单填写提交 + 任务列表展示。
 *
 * 消息字段以 src/webview/protocol.ts 为准：
 * init{schema}（BUILD_FIELD_DEFS 派生字面量的内联副本，与宿主派生逻辑的一致性由
 * 单测 buildConsoleApp.spec 锁定）→ submit{draft} → submitAck → buildListRequest →
 * buildList{tasks} 渲染列表（状态徽标 / 进行中计数 / 空态）。
 */
const SCHEMA = [
  { key: 'branch', label: '分支名', type: 'text', required: true, placeholder: '如 release/1.2.0' },
  {
    key: 'buildType',
    label: '构建类型',
    type: 'select',
    defaultValue: 'full',
    options: [
      { value: 'full', label: '完整构建' },
      { value: 'incremental', label: '增量构建' },
    ],
  },
  { key: 'notes', label: '备注', type: 'textarea', placeholder: '选填' },
]

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'build-1',
  branch: 'release/1.0.0',
  buildType: 'full',
  status: 'running',
  progress: 42,
  createdAt: '2026-10-25T00:00:00.000Z',
  ...overrides,
})

test.beforeEach(async ({ page }) => {
  await loadPage(page, 'buildConsole')
  await sendHost(page, { type: 'init', page: 'buildConsole', schema: SCHEMA, value: null })
})

test('buildConsole：init 后表单渲染，空列表展示空态', async ({ page }) => {
  await expect(page.locator('.build-form')).toBeVisible()
  await expect(fieldControl(page, '分支名')).toBeVisible()
  await expect(page.getByText('暂无构建任务')).toBeVisible()
  // init 后页面自动请求任务列表
  await expectLastSentType(page, 'buildListRequest')
})

test('buildConsole：填写提交 → submit 草稿正确（含默认构建类型）', async ({ page }) => {
  await fieldControl(page, '分支名').fill('release/2.0.0')
  await fieldControl(page, '备注').fill('e2e 提交')
  await page.getByRole('button', { name: /提交构建/ }).click()

  const sent = await lastSent(page)
  expect(sent).toMatchObject({
    type: 'submit',
    draft: { branch: 'release/2.0.0', buildType: 'full', notes: 'e2e 提交' },
  })
  // 提交中：按钮禁用（等待 submitAck）
  await expect(page.getByRole('button', { name: /提交构建/ })).toBeDisabled()
})

test('buildConsole：buildList 渲染任务列表与状态；error 反馈定位字段', async ({ page }) => {
  await sendHost(page, { type: 'buildList', tasks: [makeTask()] })
  await expect(page.getByText('release/1.0.0')).toBeVisible()
  await expect(page.getByText(/构建中/)).toBeVisible()
  await expect(page.getByText('1 个进行中')).toBeVisible()

  // 提交命中校验失败：error.field 定位分支控件 + 反馈条
  await fieldControl(page, '分支名').fill('   ')
  await page.getByRole('button', { name: /提交构建/ }).click()
  await sendHost(page, { type: 'error', message: '分支名不能为空。', field: 'branch' })
  // 错误同时出现在字段错误与反馈条两处：断言反馈条（.build-form__feedback）文本
  await expect(page.locator('.build-form__feedback')).toHaveText('分支名不能为空。')
  // 字段级错误也同步定位到分支控件（VFormField role=alert）
  await expect(page.locator('.v-form-field__error').first()).toBeVisible()
})

test('buildConsole：submitAck 解锁提交并触发列表刷新', async ({ page }) => {
  await fieldControl(page, '分支名').fill('release/3.0.0')
  await page.getByRole('button', { name: /提交构建/ }).click()
  await sendHost(page, {
    type: 'buildList',
    tasks: [makeTask({ branch: 'release/3.0.0', status: 'queued', progress: 0 })],
  })
  await sendHost(page, { type: 'submitAck', ok: true })
  await expect(page.getByRole('button', { name: /提交构建/ })).toBeEnabled()
  await expect(page.getByText('release/3.0.0')).toBeVisible()
  expect((await lastSent(page))?.type).toBe('buildListRequest')
})
