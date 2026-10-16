import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import MainLayout from '@/layouts/MainLayout.vue'
import UnderConstruction from '@/views/common/UnderConstruction.vue'
import { MENU, HIDDEN_ROUTES, type MenuLeaf } from '@/config/menu'
import { getToken } from '@/api/client'
import { useUserStore } from '@/stores/user'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 访问所需功能权限编码（管理员默认放行） */
    perm?: string | string[]
    /** 免登录页面（登录页） */
    public?: boolean
  }
}

/**
 * 页面懒加载：按 menu.ts 中登记的 component 路径（相对 src/views，不含扩展名）查找
 * 页面文件尚未实现时回退到「建设中」占位页，保证菜单可点击、工程可运行
 */
const pageModules = import.meta.glob('../views/**/*.vue')

function resolvePage(component: string) {
  const key = `../views/${component}.vue`
  const found = pageModules[key]
  return found || UnderConstruction
}

function toRoute(leaf: MenuLeaf, menu: boolean): RouteRecordRaw {
  return {
    path: leaf.path,
    name: leaf.name,
    component: resolvePage(leaf.component),
    meta: { title: leaf.title, perm: leaf.perm, menu },
  }
}

const menuRoutes: RouteRecordRaw[] = MENU.flatMap((group) => group.children.map((leaf) => toRoute(leaf, true)))
const hiddenRoutes: RouteRecordRaw[] = HIDDEN_ROUTES.map((leaf) => toRoute(leaf, false))

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    component: MainLayout,
    redirect: MENU[0].children[0].path,
    children: [
      { path: '403', name: 'forbidden', component: () => import('@/views/common/Forbidden.vue'), meta: { title: '无访问权限' } },
      ...menuRoutes,
      ...hiddenRoutes,
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/common/NotFound.vue'),
    meta: { title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

const APP_TITLE = '自研 CRM 系统'

router.beforeEach(async (to) => {
  const userStore = useUserStore()
  document.title = to.meta.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE

  // 登录页：已登录则回首页
  if (to.meta.public) {
    return userStore.token && getToken() ? { path: '/' } : true
  }

  if (!getToken()) {
    return { path: '/login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } }
  }

  // 首次进入或刷新后拉取身份与权限
  if (!userStore.loaded) {
    try {
      await userStore.loadProfile()
    } catch (e) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }

  if (to.meta.perm && !userStore.hasPerm(to.meta.perm)) {
    return { path: '/403' }
  }

  return true
})

export default router
