import * as path from 'path'
import { runTests } from '@vscode/test-electron'

/** 下载/启动一个干净的 VSCode 实例并运行集成测试（首次运行会下载 VSCode，耗时较长）。 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..')
  const extensionTestsPath = path.resolve(__dirname, 'index.js')
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // 打开仓库根作为工作区：草稿箱等「工作区数据落盘」流程需要真实 workspaceFolders
      // （数据文件已被 gitignore 覆盖，测试收尾自行清理）
      launchArgs: [extensionDevelopmentPath, '--disable-extensions'],
    })
  } catch (err) {
    console.error('集成测试运行失败：', err)
    process.exit(1)
  }
}

void main()
