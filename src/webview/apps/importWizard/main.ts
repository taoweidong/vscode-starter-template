import { createApp } from 'vue'
// 令牌必须最先导入：组件样式只消费 --ui-* 语义令牌
import '../../ui/tokens.css'
// codicon 字体：页面图标（VButton / 步骤条等）需要（CSP font-src 已授权）
import '@vscode/codicons/dist/codicon.css'
import App from './App.vue'

createApp(App).mount('#app')
