/**
 * Webview HTML 外壳（docs/需求与优化方案/03 §5.3 / §5.4 CSP 矩阵）。
 *
 * 纯函数、全字符串入参、不 import vscode —— 可在无宿主环境单测。
 * CSP 采用 nonce 授权入口脚本 + cspSource 授权静态资源；禁止 unsafe-eval / unsafe-inline。
 */

export interface WebviewHtmlOptions {
  pageId: string
  title: string
  /** 入口脚本 URI（webview.asWebviewUri 转换后的字符串） */
  scriptUri: string
  /** 样式表 URI 列表（转换后的字符串） */
  styleUris: string[]
  cspSource: string
  nonce: string
}

/** HTML 文本转义：title 等动态文本进入 HTML 前必须转义。 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

export function renderWebviewHtml(o: WebviewHtmlOptions): string {
  const title = escapeHtml(o.title)
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${o.nonce}' ${o.cspSource}`,
    `style-src ${o.cspSource}`,
    `img-src ${o.cspSource} data:`,
    `font-src ${o.cspSource}`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
  const styleLinks = o.styleUris
    .map((uri) => `<link rel="stylesheet" href="${escapeHtml(uri)}">`)
    .join('\n    ')
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${styleLinks}
  </head>
  <body>
    <div id="app" data-page="${escapeHtml(o.pageId)}"></div>
    <script type="module" nonce="${escapeHtml(o.nonce)}" src="${escapeHtml(o.scriptUri)}"></script>
  </body>
</html>`
}
