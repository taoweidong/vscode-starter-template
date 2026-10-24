import { describe, expect, it } from 'vitest'
import { renderWebviewHtml } from '../../../webview/host/webviewHtml'

/** HTML 外壳（03 §5.3 / §5.4）：CSP 矩阵、nonce、data-page、资源顺序。 */
const baseOptions = {
  pageId: 'gallery',
  title: '组件画廊（开发）',
  scriptUri: 'vscode-webview-view/assets/gallery-abc123.js',
  styleUris: ['vscode-webview-view/assets/gallery-def456.css'],
  cspSource: 'vscode-webview-view:',
  nonce: 'a1b2c3d4',
}

describe('renderWebviewHtml', () => {
  it('完整文档骨架：DOCTYPE、zh-CN、CSP meta、挂载点、模块脚本', () => {
    const html = renderWebviewHtml(baseOptions)
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('<div id="app" data-page="gallery"></div>')
    expect(html).toContain('<script type="module" nonce="a1b2c3d4"')
    expect(html).toContain(`src="${baseOptions.scriptUri}"></script>`)
  })

  it('CSP 矩阵与 03 §5.4 逐项一致（含 nonce 与 cspSource）', () => {
    const html = renderWebviewHtml(baseOptions)
    const csp =
      /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'nonce-a1b2c3d4' vscode-webview-view:")
    expect(csp).toContain('style-src vscode-webview-view:')
    expect(csp).toContain('img-src vscode-webview-view: data:')
    expect(csp).toContain('font-src vscode-webview-view:')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    // 禁止出现宽松指令
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
  })

  it('样式 link 在 script 之前，且逐个渲染 styleUris', () => {
    const html = renderWebviewHtml({
      ...baseOptions,
      styleUris: [
        'vscode-webview-view/assets/tokens-1.css',
        'vscode-webview-view/assets/page-2.css',
      ],
    })
    const linkIdx = html.indexOf('<link rel="stylesheet"')
    const secondLinkIdx = html.indexOf('href="vscode-webview-view/assets/page-2.css"')
    const scriptIdx = html.indexOf('<script type="module"')
    expect(linkIdx).toBeGreaterThanOrEqual(0)
    expect(secondLinkIdx).toBeGreaterThan(linkIdx)
    expect(scriptIdx).toBeGreaterThan(secondLinkIdx)
  })

  it('动态文本（title / URI）HTML 转义，防注入', () => {
    const html = renderWebviewHtml({
      ...baseOptions,
      title: `条目<script>alert(1)</script>&"x'y",`,
      scriptUri: 'vscode-webview-view/a"><script>',
    })
    expect(html).toContain(
      '<title>条目&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;x&#39;y&quot;,</title>'
    )
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('src="vscode-webview-view/a&quot;&gt;&lt;script&gt;"')
  })
})
