/**
 * 生成市场图标 media/icon.png（128×128）：M6 / T6.5。
 *
 * 用已安装的 Playwright 加载 media/icon.svg（包裹 HTML，透明背景、128×128 视口、
 * SVG 居中放大），截图产出 PNG。浏览器通道按平台选择（07 R-E-14）：Windows 用自带
 * Edge（channel: 'msedge'，CI 与开发机均预装）；其他平台无 msedge 通道，改用
 * Playwright 捆绑的 Chromium（需先 npx playwright install chromium）。
 * 图标源更新后重新运行本脚本即可：
 *
 *   npx tsx scripts/generate-icon.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium, type Browser } from 'playwright'

const root = path.resolve(__dirname, '..')
const svgPath = path.join(root, 'media', 'icon.svg')
const outPath = path.join(root, 'media', 'icon.png')

async function main(): Promise<void> {
  const svg = fs.readFileSync(svgPath, 'utf8')
  // 包裹为 128×128 透明画布：SVG 以 viewBox 等比放大 5 倍（24 → 120）并居中
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      .wrap {
        width: 128px;
        height: 128px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      svg {
        width: 120px;
        height: 120px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">${svg}</div>
  </body>
</html>`

  // 平台条件式浏览器通道（07 R-E-14）：msedge 仅 Windows 可用；
  // 其他平台用 Playwright 捆绑的 Chromium（channel 缺省）。
  const channel = process.platform === 'win32' ? 'msedge' : undefined
  let browser: Browser
  try {
    browser = await chromium.launch(channel ? { channel } : {})
  } catch (err) {
    // 失败明确提示：给出平台相关的修复动作，而非只抛裸 stack
    const hint =
      channel === 'msedge'
        ? '请确认本机已安装 Microsoft Edge（Windows 10/11 默认自带）。'
        : '请先执行 npx playwright install chromium 安装浏览器。'
    console.error(
      `generate-icon：无法启动浏览器（channel: ${channel ?? 'bundled chromium'}）。${hint}`
    )
    console.error(err)
    process.exit(1)
  }
  try {
    const page = await browser.newPage({ viewport: { width: 128, height: 128 } })
    await page.setContent(html, { waitUntil: 'load' })
    await page.locator('.wrap').screenshot({ path: outPath, omitBackground: true })
    const size = fs.statSync(outPath).size
    process.stdout.write(
      `已生成 ${path.relative(root, outPath)}（128×128，${(size / 1024).toFixed(1)} KB）\n`
    )
  } finally {
    await browser.close()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
