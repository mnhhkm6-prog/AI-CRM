import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import 'element-plus/dist/index.css'
import '@/styles/index.scss'

import App from './App.vue'
import router from './router'

const app = createApp(App)

// 全局注册 Element Plus 图标（菜单/按钮按字符串名动态引用）
Object.entries(ElementPlusIconsVue).forEach(([name, component]) => {
  app.component(name, component)
})

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// ElMessageBox 取消/关闭会 reject 'cancel' / 'close'，属正常交互流程，不视为异常
app.config.errorHandler = (err) => {
  if (err === 'cancel' || err === 'close') return
  console.error(err)
}

app.mount('#app')
