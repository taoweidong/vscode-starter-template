import { expect, test } from 'playwright/test'
import { expectLastSentType, fieldControl, lastSent, loadPage, sendHost, sent } from './helpers'

/**
 * 特性配置页（featureConfig）E2E。
 *
 * init 载荷按 App.vue：schema 为 boolean 开关列表（key 对应
 * crudStarter.features.* 五个配置项），value 为全 true 回显。
 * 验收点：开关回显、真实点击翻转、dirty 上报、保存提交与取消。
 */

const FEATURES = [
  { key: 'confirmDelete', label: '删除确认' },
  { key: 'successNotifications', label: '成功通知' },
  { key: 'showPriorityIcons', label: '优先级图标' },
  { key: 'showViewBadges', label: '视图徽标' },
  { key: 'autoRefreshOnExternalChange', label: '外部变更自动刷新' },
]

const SCHEMA = FEATURES.map((feature) => ({ ...feature, type: 'boolean' }))

const ALL_TRUE = Object.fromEntries(FEATURES.map((feature) => [feature.key, true]))

async function initFeatureConfig(page: Parameters<typeof sendHost>[0]): Promise<void> {
  await sendHost(page, { type: 'init', page: 'featureConfig', schema: SCHEMA, value: ALL_TRUE })
}

test('featureConfig：init 回显全开，翻转两个开关后保存提交正确 draft', async ({ page }) => {
  await loadPage(page, 'featureConfig')
  await expectLastSentType(page, 'ready')
  await initFeatureConfig(page)

  await expect(page.locator('.app-shell__title')).toHaveText('特性配置')
  for (const feature of FEATURES) {
    await expect(fieldControl(page, feature.label)).toBeChecked()
  }

  const first = fieldControl(page, '删除确认')
  const third = fieldControl(page, '优先级图标')
  await first.uncheck()
  await third.uncheck()
  await expect(first).not.toBeChecked()
  await expect(third).not.toBeChecked()

  await expect
    .poll(async () =>
      (await sent(page)).some((message) => message.type === 'dirty' && message.dirty === true)
    )
    .toBe(true)

  await page.screenshot({ path: 'test-results/featureConfig.png', fullPage: true })

  await page.getByRole('button', { name: '保存' }).click()
  await expectLastSentType(page, 'submit')
  expect(await lastSent(page)).toEqual({
    type: 'submit',
    draft: {
      confirmDelete: false,
      successNotifications: true,
      showPriorityIcons: false,
      showViewBadges: true,
      autoRefreshOnExternalChange: true,
    },
  })
})

test('featureConfig：取消按钮发出 cancel', async ({ page }) => {
  await loadPage(page, 'featureConfig')
  await initFeatureConfig(page)
  await page.getByRole('button', { name: '取消' }).click()
  await expectLastSentType(page, 'cancel')
})
