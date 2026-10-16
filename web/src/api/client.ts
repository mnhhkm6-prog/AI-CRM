import axios, { type AxiosInstance } from 'axios'
import { ElMessage } from 'element-plus'

/**
 * HTTP 客户端
 * - 统一注入 Authorization: Bearer <token>
 * - 统一解包 { data } / 分页 { data: { list, total } }
 * - 统一错误提示（400/403/404/409/500 → ElMessage）
 */
const client: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 60000,
})

const TOKEN_KEY = 'crm_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

client.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  // 后端响应统一为 { data: ... }，此处直接解包，调用方拿到业务数据
  (res) => {
    const body = res.data
    if (body && typeof body === 'object' && 'data' in body) return body.data
    return body
  },
  (err) => {
    const status = err.response?.status
    const body = err.response?.data || {}
    const msg = body.error || err.message || '请求失败'

    if (status === 401) {
      clearToken()
      if (window.location.pathname !== '/login') {
        ElMessage.error('登录已失效，请重新登录')
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
      }
    } else if (status === 403) {
      ElMessage.error(msg || '无权限访问')
    } else if (status === 404) {
      ElMessage.error(msg || '资源不存在')
    } else if (status === 409) {
      ElMessage.warning(msg)
    } else if (status === 400) {
      ElMessage.error(msg)
    } else {
      ElMessage.error(msg)
    }
    // 保留业务码供调用方判断（如 1001 固定动作未完成）
    return Promise.reject(Object.assign(err, { bizCode: body.code, bizMessage: msg, status }))
  }
)

export default client
