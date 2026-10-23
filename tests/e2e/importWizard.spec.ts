import { expect, test } from 'playwright/test'
import { expectLastSentType, lastSent, loadPage, sendHost } from './helpers'

/**
 * 批量导入向导（importWizard）E2E：四步全流程 + 取消路径。
 *
 * 消息字段以 src/webview/protocol.ts 为准：
 * 浏览… → browseFolder；下一步 → requestPreview{folder}；
 * importPreview{files}（exists 默认不勾选）→ 开始导入 → executeImport{files}；
 * importProgress{done,total} → importDone{result} → 结果页；
 * 执行中取消 → cancelImport。
 */

const FOLDER = 'E:/demo'

const PREVIEW_FILES = [
  { name: 'a.md', path: 'E:/demo/a.md', exists: false },
  { name: 'b.ts', path: 'E:/demo/b.ts', exists: false },
  { name: 'dup.md', path: 'E:/demo/dup.md', exists: true },
]

const NEW_FILES = PREVIEW_FILES.filter((file) => !file.exists)

function initWizard(
  page: Parameters<typeof sendHost>[0],
  extra: Record<string, unknown> = {}
): Promise<void> {
  return sendHost(page, { type: 'init', page: 'importWizard', schema: [], value: null, extra })
}

test('importWizard：浏览选择文件夹 → 预览去重 → 执行进度 → 结果页', async ({ page }) => {
  await loadPage(page, 'importWizard')
  await expectLastSentType(page, 'ready')
  await initWizard(page)

  await expect(page.locator('.app-shell__title')).toHaveText('批量导入条目')
  await expect(page.getByLabel('文件夹路径')).toBeVisible()
  // 空路径时「下一步」禁用
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled()

  // ① 「浏览…」→ browseFolder；宿主应答 selectFolder 回填路径
  await page.getByRole('button', { name: '浏览…' }).click()
  await expectLastSentType(page, 'browseFolder')
  await sendHost(page, { type: 'selectFolder', folder: FOLDER })
  await expect(page.locator('#wizard-folder')).toHaveValue(FOLDER)
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled()

  // 下一步 → requestPreview
  await page.getByRole('button', { name: '下一步' }).click()
  await expectLastSentType(page, 'requestPreview')
  expect(await lastSent(page)).toEqual({ type: 'requestPreview', folder: FOLDER })

  // ② 预览：3 行，已存在项标注且默认不勾选，新文件默认勾选
  await sendHost(page, { type: 'importPreview', files: PREVIEW_FILES })
  const rows = page.locator('.wizard__files .wizard__file')
  await expect(rows).toHaveCount(3)
  const duplicateRow = page.locator('.wizard__file', { hasText: 'dup.md' })
  await expect(duplicateRow.locator('.wizard__file-mark')).toHaveText('已存在，将跳过')
  await expect(duplicateRow.locator('input[type="checkbox"]')).not.toBeChecked()
  await expect(
    page.locator('.wizard__file', { hasText: 'a.md' }).locator('input[type="checkbox"]')
  ).toBeChecked()
  await expect(
    page.locator('.wizard__file', { hasText: 'b.ts' }).locator('input[type="checkbox"]')
  ).toBeChecked()
  await expect(page.locator('.wizard__summary')).toContainText('共 3 个文件')
  await expect(page.locator('.wizard__summary')).toContainText('2个新文件将被导入')
  await expect(page.locator('.wizard__summary')).toContainText('1个与现有条目同名')

  await page.screenshot({ path: 'test-results/importWizard.png', fullPage: true })

  // ③ 开始导入 → executeImport 携带勾选的 2 个新文件
  await page.getByRole('button', { name: '开始导入' }).click()
  await expectLastSentType(page, 'executeImport')
  expect(await lastSent(page)).toEqual({ type: 'executeImport', files: NEW_FILES })

  const progress = page.locator('.wizard__progress')
  await expect(progress).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '0')
  await expect(page.locator('.wizard__summary')).toContainText('正在导入 2 个文件（已完成 0 / 2）')

  // 进度推进
  await sendHost(page, { type: 'importProgress', done: 1, total: 2 })
  await expect(progress).toHaveAttribute('aria-valuenow', '1')
  await expect(page.locator('.wizard__summary')).toContainText('已完成 1 / 2')

  // ④ 结果页：成功 2 / 跳过 1 / 失败 0
  await sendHost(page, {
    type: 'importDone',
    result: { created: 2, skipped: 1, failed: 0, cancelled: false },
  })
  const summary = page.locator('.wizard__summary')
  await expect(summary).toContainText('导入完成')
  await expect(summary.locator('.v-badge')).toHaveText(['2', '1', '0'])
  await page.screenshot({ path: 'test-results/importWizard-result.png', fullPage: true })

  // 「完成」发出 cancel（面板由宿主关闭）
  await page.getByRole('button', { name: '完成' }).click()
  await expectLastSentType(page, 'cancel')

  // 「再次导入」回到第一步，路径保留
  await page.getByRole('button', { name: '再次导入' }).click()
  await expect(page.locator('#wizard-folder')).toBeVisible()
  await expect(page.locator('#wizard-folder')).toHaveValue(FOLDER)
})

test('importWizard：执行中「取消导入」发出 cancelImport', async ({ page }) => {
  await loadPage(page, 'importWizard')
  await initWizard(page)

  // 直接真实输入路径进入预览
  await page.locator('#wizard-folder').fill('D:/docs')
  await page.getByRole('button', { name: '下一步' }).click()
  await expectLastSentType(page, 'requestPreview')
  await sendHost(page, { type: 'importPreview', files: NEW_FILES })
  await expect(page.locator('.wizard__files .wizard__file')).toHaveCount(2)

  await page.getByRole('button', { name: '开始导入' }).click()
  await expectLastSentType(page, 'executeImport')

  await page.getByRole('button', { name: '取消导入' }).click()
  await expectLastSentType(page, 'cancelImport')
})

test('importWizard：init 携带 presetFolder 时预填路径', async ({ page }) => {
  await loadPage(page, 'importWizard')
  await initWizard(page, { presetFolder: 'D:/preset/docs' })
  await expect(page.locator('#wizard-folder')).toHaveValue('D:/preset/docs')
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled()
})

test('importWizard：宿主 error 消息显示 role=alert 错误行', async ({ page }) => {
  await loadPage(page, 'importWizard')
  await initWizard(page)
  await sendHost(page, { type: 'error', message: '扫描文件夹失败：路径不存在' })
  await expect(page.locator('.wizard__error[role="alert"]')).toContainText(
    '扫描文件夹失败：路径不存在'
  )
})
