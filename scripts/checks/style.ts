/**
 * 门禁「Webview 样式门禁」检查（E-2 / 04 §9）：对 src/webview 页面源码执行样式规约校验。
 *
 * 对应 docs/需求与优化方案/04-VSCode原生设计系统.md §9 的规则
 * （第 ⑤ 条 dist 产物 unsafe-eval 扫描由 Webview 构建产物侧负责，不在本文件）：
 *   1. 除 ui/tokens.css 外禁止硬编码颜色：`#[hex]` / `rgb(` / `hsl(`
 *      （检查 .vue 的 <style> 块与 .css 全文；.ts 模板字面量暂不扫，先宽后严）；
 *   2. 禁止 `v-html` / `innerHTML`（XSS 面；.vue 模板与 .ts 全文）；
 *   3. import 白名单：仅 `vue` / `@vscode/codicons` / 项目内相对路径，禁止 `node:` 前缀
 *      与任何其他裸包名（UI 框架，04 §9.3）——`host/` 为宿主控制器目录，随扩展宿主编译、
 *      本就 import vscode 与 node: 内置模块，不参与页面 bundle 白名单；
 *   4. 间距白名单：`padding` / `margin` / `gap` 声明中的 px 值必须 ∈ {4,8,12,16,24}，
 *      或该声明使用 `var(--ui-*)`（新增刻度需先在 ui/tokens.css 登记，04 §9.4）；
 *      负边距（如 -1px 焦点环对齐 / 视觉隐藏）不属间距刻度，不检查。
 * 违规统一收集「文件:行」后一次性 assert 抛出（fail-fast 由门禁步骤捕获）。
 */
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'

/** 间距刻度白名单（04 §3；超出需先在 ui/tokens.css 登记新刻度）。 */
const ALLOWED_SPACING_PX = new Set([4, 8, 12, 16, 24])
/** import 白名单（04 §9.3：UI 框架仅 vue / @vscode/codicons，其余走项目内相对路径）。 */
const ALLOWED_IMPORT_PACKAGES = new Set(['vue', '@vscode/codicons'])
/** 唯一允许出现颜色回退值的令牌文件（相对 src/webview，POSIX 风格）。 */
const TOKENS_FILE = 'ui/tokens.css'
/** 宿主控制器目录名（import 白名单豁免，见文件头第 3 条说明）。 */
const HOST_DIR = 'host'

interface WebviewSourceFile {
  /** 相对 src/webview 的 POSIX 路径（用于错误信息与豁免判定）。 */
  rel: string
  abs: string
}

function toPosix(value: string): string {
  return value.split('\\').join('/')
}

/** 递归收集 src/webview 下的 .vue / .css / .ts 源文件（rel 始终相对根目录，保证豁免判定稳定）。 */
function collectSourceFiles(rootDir: string): WebviewSourceFile[] {
  const out: WebviewSourceFile[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (/\.(vue|css|ts)$/.test(entry.name)) {
        out.push({ rel: toPosix(path.relative(rootDir, abs)), abs })
      }
    }
  }
  walk(rootDir)
  return out
}

/** 提取 .vue 中 <style>…</style> 区间内的行（简单状态机；单行开闭块同样支持）。 */
function vueStyleLines(lines: string[]): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  let inStyle = false
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    const opens = /<style[\s>]/.test(text)
    const closes = /<\/style>/.test(text)
    if (inStyle || opens) {
      out.push({ line: i + 1, text })
    }
    if (opens && !closes) {
      inStyle = true
    } else if (closes) {
      inStyle = false
    }
  }
  return out
}

/**
 * 执行 Webview 样式门禁，任一违规即抛错（由门禁第 ⑥ 步捕获）。
 * @param root 仓库根目录
 */
export function checkWebviewStyle(root: string): void {
  const webviewRoot = path.join(root, 'src', 'webview')
  const violations: string[] = []

  for (const file of collectSourceFiles(webviewRoot)) {
    const source = readFileSync(file.abs, 'utf8')
    const lines = source.split(/\r?\n/)
    const isTokens = file.rel === TOKENS_FILE
    // 规则 1 / 4 的检查面：.css 全文；.vue 取 <style> 块
    const styleLines = file.rel.endsWith('.css')
      ? lines.map((text, i) => ({ line: i + 1, text }))
      : vueStyleLines(lines)

    // ---- 规则 1：硬编码颜色（令牌文件豁免）----
    if (!isTokens) {
      for (const { line, text } of styleLines) {
        if (/#[0-9a-fA-F]{3,8}\b/.test(text) || /rgb\(/.test(text) || /hsl\(/.test(text)) {
          violations.push(
            `${file.rel}:${line} 硬编码颜色（#[hex] / rgb( / hsl(），请改用 --ui-* 语义令牌（04 §9.1）`
          )
        }
      }
    }

    // ---- 规则 2：v-html / innerHTML ----
    if (file.rel.endsWith('.vue') || file.rel.endsWith('.ts')) {
      for (let i = 0; i < lines.length; i++) {
        if (/v-html/.test(lines[i])) {
          violations.push(`${file.rel}:${i + 1} 禁止 v-html（XSS 面，04 §9.2）`)
        }
        if (/\binnerHTML\b/.test(lines[i])) {
          violations.push(`${file.rel}:${i + 1} 禁止 innerHTML 赋值（XSS 面，04 §9.2）`)
        }
      }
    }

    // ---- 规则 3：import 白名单（宿主控制器目录 host/ 豁免）----
    if (
      (file.rel.endsWith('.vue') || file.rel.endsWith('.ts')) &&
      !file.rel.startsWith(`${HOST_DIR}/`)
    ) {
      for (let i = 0; i < lines.length; i++) {
        const match = /^\s*import\s[^;]*?from\s+'([^']+)'/.exec(lines[i])
        if (!match) {
          continue
        }
        const specifier = match[1]
        if (specifier.startsWith('.') || ALLOWED_IMPORT_PACKAGES.has(specifier)) {
          continue
        }
        violations.push(
          `${file.rel}:${i + 1} 违规 import「${specifier}」：仅允许 vue / @vscode/codicons / 项目内相对路径（04 §9.3）`
        )
      }
    }

    // ---- 规则 4：间距白名单 ----
    for (const { line, text } of styleLines) {
      const decl = /^\s*(?:padding|margin|gap)[a-z-]*\s*:([^;]*)/.exec(text)
      if (!decl) {
        continue
      }
      const value = decl[1]
      if (value.includes('var(')) {
        continue // 使用令牌的声明整条放行
      }
      // 负向前瞻排除负值（-1px 焦点环对齐 / 视觉隐藏，非间距刻度）
      for (const px of value.matchAll(/(?<![\w-])(\d+)px/g)) {
        if (!ALLOWED_SPACING_PX.has(Number(px[1]))) {
          violations.push(
            `${file.rel}:${line} 间距值 ${px[1]}px 不在刻度 {4,8,12,16,24}（或改用 var(--ui-*)；新刻度需登记 ui/tokens.css，04 §9.4）`
          )
        }
      }
    }
  }

  assert(
    violations.length === 0,
    `Webview 样式门禁未通过（共 ${violations.length} 处违规）：\n${violations
      .map((v) => `  - ${v}`)
      .join('\n')}`
  )
}
