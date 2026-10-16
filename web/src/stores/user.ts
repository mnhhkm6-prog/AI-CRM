import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '@/api'
import { clearToken, getToken, setToken } from '@/api/client'

/**
 * 当前登录用户与权限
 * - 权限编码集合来自 GET /me（后端按角色聚合）
 * - 菜单可见性由权限驱动（界面设计文档 2.3）
 */
export const useUserStore = defineStore('user', () => {
  const token = ref<string>(getToken())
  const profile = ref<api.CurrentUser | null>(null)
  const loaded = ref(false)

  const permissions = computed<string[]>(() => profile.value?.permissions || [])
  const isAdmin = computed(() => !!profile.value?.is_admin)
  const displayName = computed(() => profile.value?.name || '')
  const roleName = computed(() => profile.value?.role_name || '')

  /** 是否具备某功能权限（管理员默认全量） */
  function hasPerm(code?: string | string[]) {
    if (!code) return true
    if (isAdmin.value) return true
    const codes = Array.isArray(code) ? code : [code]
    return codes.some((c) => permissions.value.includes(c))
  }

  /** 数据范围徽标文案（页面右上角「我的 / 全部」） */
  function scopeBadge(resource: string) {
    const scope = profile.value?.data_scopes?.[resource] || 'self'
    const map: Record<string, string> = {
      self: '我的',
      department: '本部门',
      sub_department: '本部门及下级',
      all: '全部',
      custom: '自定义范围',
    }
    return isAdmin.value ? '全部' : map[scope] || '我的'
  }

  async function signIn(username: string, password: string) {
    const res = await api.login(username, password)
    setToken(res.token)
    token.value = res.token
    await loadProfile()
    return res
  }

  async function loadProfile() {
    profile.value = await api.getMe()
    loaded.value = true
    return profile.value
  }

  async function signOut() {
    try {
      await api.logout()
    } catch (e) {
      /* 退出失败不阻塞本地清理 */
    }
    clearToken()
    token.value = ''
    profile.value = null
    loaded.value = false
  }

  return { token, profile, loaded, permissions, isAdmin, displayName, roleName, hasPerm, scopeBadge, signIn, loadProfile, signOut }
})
