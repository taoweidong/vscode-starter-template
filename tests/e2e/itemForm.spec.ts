import { expect, test } from 'playwright/test'
import { expectLastSentType, fieldControl, lastSent, loadPage, sendHost, sent } from './helpers'

/**
 * 条目表单页（itemForm）E2E。
 *
 * init 载荷按 src/webview/apps/itemForm/App.vue 与 src/webview/formSchema.ts 的
 * FORM_SCHEMA 同形构造（schema / value / extra:{mode,itemId,categories}）。
 * 验收点：ready 上报、首字段聚焦、dirty 上报、required 行内校验、
 * Ctrl+Enter 提交（含 tags 解析 / select 取值）、Esc 取消、编辑回填、草稿恢复与丢弃。
 */

/** 与 FORM_SCHEMA 同形的字段定义（宿主经 toFieldDefs 下发的形状）。 */
const SCHEMA = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '请输入条目名称' },
  {
    key: 'category',
    label: '分类',
    type: 'text',
    hint: '输入时会自动提示已有分类',
    datalist: 'category-list',
  },
  {
    key: 'priority',
    label: '优先级',
    type: 'select',
    defaultValue: 'medium',
    options: [
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' },
    ],
  },
  {
    key: 'tags',
    label: '标签',
    type: 'tags',
    placeholder: '前端, 待办',
    hint: '多个标签用逗号分隔',
  },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '补充说明（可选）' },
]

function initCreate(page: Parameters<typeof sendHost>[0]): Promise<void> {
  return sendHost(page, {
    type: 'init',
    page: 'itemForm',
    schema: SCHEMA,
    value: null,
    extra: { mode: 'create', categories: ['工作', '生活'] },
  })
}

test('itemForm：挂载上报 ready，init 后聚焦首字段，输入触发 dirty 与草稿持久化', async ({
  page,
}) => {
  await loadPage(page, 'itemForm')
  await expectLastSentType(page, 'ready')

  await initCreate(page)
  await expect(page.locator('.app-shell__title')).toHaveText('新增条目')

  const name = fieldControl(page, '名称')
  await expect(name).toBeVisible()
  await expect(name).toBeFocused()

  await name.fill('新任务')
  await fieldControl(page, '描述').fill('一条来自 E2E 的描述')
  await expect
    .poll(async () =>
      (await sent(page)).some((message) => message.type === 'dirty' && message.dirty === true)
    )
    .toBe(true)

  // 草稿防抖持久化（500ms）经 setState 写入 {draft, mode, itemId}
  await expect
    .poll(async () => {
      const state = (await page.evaluate(() => window.__state)) as
        { draft?: { name?: string } } | undefined
      return state?.draft?.name
    })
    .toBe('新任务')
})

test('itemForm：必填校验失败时显示行内错误且不发 submit', async ({ page }) => {
  await loadPage(page, 'itemForm')
  await initCreate(page)

  await page.getByRole('button', { name: '保存' }).click()

  await expect(page.locator('.v-form-field__error[role="alert"]')).toContainText('请填写「名称」')
  await expect(fieldControl(page, '名称')).toHaveAttribute('aria-invalid', 'true')
  expect((await sent(page)).some((message) => message.type === 'submit')).toBe(false)

  // 补填后错误即时清除，再保存可提交
  await fieldControl(page, '名称').fill('补填名称')
  await expect(page.locator('.v-form-field__error[role="alert"]')).toBeHidden()
  await page.getByRole('button', { name: '保存' }).click()
  await expectLastSentType(page, 'submit')
})

test('itemForm：填写全部字段后 Ctrl+Enter 提交，draft 携带解析结果', async ({ page }) => {
  await loadPage(page, 'itemForm')
  await initCreate(page)

  const name = fieldControl(page, '名称')
  await name.fill('新任务')
  await fieldControl(page, '标签').fill('前端, 待办')
  await fieldControl(page, '优先级').selectOption({ label: '高' })

  await page.screenshot({ path: 'test-results/itemForm.png', fullPage: true })

  await name.press('Control+Enter')
  await expectLastSentType(page, 'submit')
  expect(await lastSent(page)).toEqual({
    type: 'submit',
    draft: {
      name: '新任务',
      category: '',
      priority: 'high',
      tags: ['前端', '待办'],
      description: '',
    },
  })
})

test('itemForm：Esc 发出 cancel', async ({ page }) => {
  await loadPage(page, 'itemForm')
  await initCreate(page)

  await fieldControl(page, '名称').fill('随便填点')
  await fieldControl(page, '名称').press('Escape')
  await expectLastSentType(page, 'cancel')
})

test('itemForm：编辑模式 init 回填各控件', async ({ page }) => {
  await loadPage(page, 'itemForm')
  await sendHost(page, {
    type: 'init',
    page: 'itemForm',
    schema: SCHEMA,
    value: { name: '旧名', category: '工作', priority: 'high', tags: ['x'], description: 'd' },
    extra: { mode: 'edit', itemId: 'item-1', categories: ['工作', '生活'] },
  })

  await expect(page.locator('.app-shell__title')).toHaveText('编辑条目')
  await expect(fieldControl(page, '名称')).toHaveValue('旧名')
  await expect(fieldControl(page, '分类')).toHaveValue('工作')
  await expect(fieldControl(page, '优先级')).toHaveValue('high')
  await expect(fieldControl(page, '标签')).toHaveValue('x')
  await expect(fieldControl(page, '描述')).toHaveValue('d')

  // 分类建议 datalist 来自 init 的 categories（option 文本为空，值即分类名）
  const categoryOptions = page.locator('datalist#category-list option')
  await expect(categoryOptions).toHaveCount(2)
  await expect(categoryOptions.nth(0)).toHaveAttribute('value', '工作')
  await expect(categoryOptions.nth(1)).toHaveAttribute('value', '生活')

  await page.screenshot({ path: 'test-results/itemForm-edit.png', fullPage: true })
})

test('itemForm：持久化草稿在 init 时恢复并提示，可丢弃', async ({ page }) => {
  await loadPage(page, 'itemForm')

  // 模拟上次未保存的持久化状态（getState 返回 window.__state）
  await page.evaluate(() => {
    window.__state = {
      draft: { name: '草稿名', tags: ['a', 'b'] },
      mode: 'create',
      itemId: undefined,
    }
  })
  await initCreate(page)

  await expect(fieldControl(page, '名称')).toHaveValue('草稿名')
  await expect(fieldControl(page, '标签')).toHaveValue('a, b')
  const restored = page.locator('.item-form__restored')
  await expect(restored).toBeVisible()
  await expect(restored).toContainText('已恢复未保存的草稿')

  await page.getByRole('button', { name: '丢弃草稿' }).click()
  await expect(fieldControl(page, '名称')).toHaveValue('')
  await expect(fieldControl(page, '标签')).toHaveValue('')
  await expect(restored).toBeHidden()
  // 丢弃后回到干净状态：宿主收到 dirty=false
  await expect
    .poll(async () =>
      (await sent(page)).some((message) => message.type === 'dirty' && message.dirty === false)
    )
    .toBe(true)
})
