import { expect, test } from 'playwright/test'
import { loadPage } from './helpers'

/**
 * 组件画廊页（gallery）E2E：纯前端页，无 init 协议。
 * 验收点：各分区标题渲染、真实交互（输入 / 选择 / 勾选 / 按钮 loading）无异常、全页截图留档。
 */

const SECTION_TITLES = [
  '按钮 VButton',
  '输入 VInput / VTextarea',
  '选择 VSelect（一阶段：原生 select）',
  '复选 VCheckbox',
  '表单字段 VFormField',
  '反馈（校验提示对比）',
  '徽标 VBadge',
  '工具栏 VToolbar',
  '空态与加载',
]

test('gallery：页面加载并渲染全部分区', async ({ page }) => {
  await loadPage(page, 'gallery')
  await expect(page.locator('.app-shell__title')).toHaveText('组件画廊')
  for (const title of SECTION_TITLES) {
    await expect(page.locator('.gallery__section-title', { hasText: title })).toBeVisible()
  }
})

test('gallery：输入 / 下拉 / 复选框 / 按钮 loading 真实交互', async ({ page }) => {
  await loadPage(page, 'gallery')

  // 单行输入：v-model 双向绑定
  const demoInput = page.getByPlaceholder('请输入内容')
  await expect(demoInput).toHaveValue('示例内容')
  await demoInput.fill('E2E 真实输入')
  await expect(demoInput).toHaveValue('E2E 真实输入')

  // 多行输入
  const demoTextarea = page.getByPlaceholder('补充说明（可选）')
  await expect(demoTextarea).toHaveValue('多行内容')
  await demoTextarea.fill('第一行\n第二行')
  await expect(demoTextarea).toHaveValue('第一行\n第二行')

  // 原生下拉：medium → low
  const demoSelect = page.locator('.v-select').first()
  await expect(demoSelect).toHaveValue('medium')
  await demoSelect.selectOption('low')
  await expect(demoSelect).toHaveValue('low')

  // 复选框：勾选态取消再勾回；未勾选态勾上（demoUnchecked 初始 false）
  const confirmCheckbox = page.getByLabel('删除条目时弹出确认框')
  await expect(confirmCheckbox).toBeChecked()
  await confirmCheckbox.uncheck()
  await expect(confirmCheckbox).not.toBeChecked()
  await confirmCheckbox.check()
  await expect(confirmCheckbox).toBeChecked()

  const notifyCheckbox = page.getByLabel('操作成功后显示通知')
  await expect(notifyCheckbox).not.toBeChecked()
  await notifyCheckbox.check()
  await expect(notifyCheckbox).toBeChecked()

  // 按钮 loading：点击后禁用并显示 spinner，1500ms 后恢复
  const fakeSave = page.getByRole('button', { name: '点击模拟提交' })
  await fakeSave.click()
  await expect(fakeSave).toBeDisabled()
  await expect(fakeSave.locator('.v-button__spinner')).toBeVisible()
  await expect(fakeSave).toBeEnabled({ timeout: 5_000 })

  // 工具栏图标按钮可点击且无异常
  await page.locator('.v-toolbar button[title="新增"]').click()
  await page.locator('.v-toolbar button[title="刷新"]').click()
  await page.locator('.v-toolbar button[title="搜索"]').click()

  // 表单字段错误行（role=alert）静态渲染
  await expect(page.locator('.v-form-field__error[role="alert"]').first()).toContainText(
    '名称不能为空'
  )

  await page.screenshot({ path: 'test-results/gallery.png', fullPage: true })
})
