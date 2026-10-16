<template>
  <div class="layout">
    <!-- 侧边菜单 -->
    <aside class="layout__aside" :class="{ 'is-collapsed': collapsed }">
      <div class="layout__brand" @click="router.push('/')">
        <div class="layout__brand-mark">CRM</div>
        <div v-show="!collapsed" class="layout__brand-text">
          <p class="layout__brand-name">{{ companyName }}</p>
          <p class="layout__brand-sub">客户关系管理系统</p>
        </div>
      </div>
      <el-scrollbar class="layout__nav">
        <el-menu :default-active="activeMenu" :collapse="collapsed" :collapse-transition="false" router unique-opened>
          <template v-for="group in visibleMenu" :key="group.title">
            <el-sub-menu v-if="group.children.length > 1" :index="group.title">
              <template #title>
                <el-icon><component :is="group.icon" /></el-icon>
                <span>{{ group.title }}</span>
              </template>
              <el-menu-item v-for="leaf in group.children" :key="leaf.path" :index="leaf.path">
                {{ leaf.title }}
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else :index="group.children[0].path">
              <el-icon><component :is="group.icon" /></el-icon>
              <template #title>{{ group.children[0].title }}</template>
            </el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>
    </aside>

    <div class="layout__body">
      <!-- 顶栏 -->
      <header class="layout__header">
        <div class="layout__header-left">
          <el-icon class="layout__icon-btn" @click="collapsed = !collapsed">
            <component :is="collapsed ? Expand : Fold" />
          </el-icon>
          <span class="layout__page-title">{{ pageTitle }}</span>
        </div>

        <div class="layout__header-right">
          <el-autocomplete
            v-model="keyword"
            class="layout__search"
            :fetch-suggestions="fetchSuggestions"
            placeholder="搜索客户 / 线索 / 商机 / 联系人"
            clearable
            @select="onSearchSelect"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
            <template #default="{ item }">
              <div class="sug">
                <span class="sug__type">{{ item.type }}</span>
                <span class="sug__label">{{ item.label }}</span>
              </div>
            </template>
          </el-autocomplete>

          <el-tooltip content="审批中心（待我审批）" placement="bottom">
            <el-badge :value="approvalPending" :hidden="!approvalPending" class="layout__badge">
              <el-icon class="layout__icon-btn" @click="router.push('/approvals')"><Checked /></el-icon>
            </el-badge>
          </el-tooltip>

          <el-popover placement="bottom-end" :width="340" trigger="click" @show="loadNotifications">
            <template #reference>
              <el-badge :value="unread" :hidden="!unread" class="layout__badge">
                <el-icon class="layout__icon-btn"><Bell /></el-icon>
              </el-badge>
            </template>
            <div class="noti">
              <div class="noti__head">
                <span>消息通知</span>
                <el-button link type="primary" size="small" :disabled="!unread" @click="markAll">全部已读</el-button>
              </div>
              <el-scrollbar max-height="300px">
                <p v-if="!notifications.length" class="noti__empty">暂无消息</p>
                <div
                  v-for="n in notifications"
                  :key="n.id"
                  class="noti__item"
                  :class="{ 'is-unread': !n.is_read }"
                  @click="openNotification(n)"
                >
                  <p class="noti__title">{{ n.title }}</p>
                  <p v-if="n.content" class="noti__content">{{ n.content }}</p>
                  <p class="noti__time">{{ n.created_at }}</p>
                </div>
              </el-scrollbar>
              <div class="noti__foot">
                <el-button link type="primary" size="small" @click="router.push('/notifications')">查看全部</el-button>
              </div>
            </div>
          </el-popover>

          <el-dropdown @command="onUserCommand">
            <span class="layout__user">
              <el-icon><UserFilled /></el-icon>
              <span class="layout__user-name">{{ userStore.displayName }}</span>
              <span class="layout__user-role">{{ userStore.roleName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password"><el-icon><Lock /></el-icon>修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <!-- 内容区 -->
      <main class="layout__main">
        <router-view />
      </main>
    </div>

    <!-- 修改密码 -->
    <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="90px">
        <el-form-item label="原密码" prop="old_password">
          <el-input v-model="pwdForm.old_password" type="password" show-password autocomplete="off" />
        </el-form-item>
        <el-form-item label="新密码" prop="new_password">
          <el-input v-model="pwdForm.new_password" type="password" show-password autocomplete="off" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="pwdForm.confirm" type="password" show-password autocomplete="off" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="submitPassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { ArrowDown, Bell, Checked, Expand, Fold, Lock, Search, SwitchButton, UserFilled } from '@element-plus/icons-vue'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { MENU, type MenuGroup } from '@/config/menu'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const collapsed = ref(false)
const companyName = ref('自研 CRM')

/** 按权限过滤菜单；分组内无可见项时隐藏该分组 */
const visibleMenu = computed<MenuGroup[]>(() =>
  MENU.map((g) => ({ ...g, children: g.children.filter((leaf) => userStore.hasPerm(leaf.perm)) })).filter(
    (g) => g.children.length > 0
  )
)

const pageTitle = computed(() => (route.meta.title as string) || '')

/** 当前高亮菜单：详情/表单等隐藏路由回溯到所属列表页 */
const activeMenu = computed(() => {
  const path = route.path
  const leaves = MENU.flatMap((g) => g.children)
  if (leaves.some((l) => l.path === path)) return path
  const matched = leaves
    .filter((l) => path.startsWith(`${l.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return matched ? matched.path : path
})

/* ---------------- 全局搜索 ---------------- */
interface Suggestion {
  value: string
  label: string
  type: string
  path: string
}

const keyword = ref('')

async function fetchSuggestions(query: string, cb: (arg: Suggestion[]) => void) {
  const q = (query || '').trim()
  if (q.length < 2) return cb([])
  try {
    const res = await api.globalSearch(q, 5)
    const list: Suggestion[] = []
    ;(res.customers || []).forEach((c: any) => list.push({ value: c.name, label: c.name, type: '客户', path: `/customers/${c.id}` }))
    ;(res.leads || []).forEach((c: any) => list.push({ value: c.name, label: c.name, type: '线索', path: `/leads/${c.id}` }))
    ;(res.opportunities || []).forEach((c: any) =>
      list.push({ value: c.name, label: c.name, type: '商机', path: `/opportunities/${c.id}` })
    )
    ;(res.contacts || []).forEach((c: any) =>
      list.push({
        value: c.name,
        label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}`,
        type: '联系人',
        path: `/customers/${c.customer_id}`,
      })
    )
    cb(list)
  } catch (e) {
    cb([])
  }
}

function onSearchSelect(item: Suggestion) {
  keyword.value = ''
  if (item?.path) router.push(item.path)
}

/* ---------------- 通知 / 审批角标 ---------------- */
const notifications = ref<any[]>([])
const unread = ref(0)
const approvalPending = ref(0)

async function refreshBadges() {
  try {
    const [u, s] = await Promise.all([api.unreadCount(), api.approvalSummary()])
    unread.value = u.unread || 0
    approvalPending.value = s.pending || 0
  } catch (e) {
    /* 静默失败，不打断使用 */
  }
}

async function loadNotifications() {
  try {
    const res = await api.listNotifications({ page: 1, page_size: 8 })
    notifications.value = res.list || []
    if (typeof res.unread === 'number') unread.value = res.unread
  } catch (e) {
    /* 静默 */
  }
}

async function markAll() {
  await api.readAllNotifications()
  unread.value = 0
  notifications.value = notifications.value.map((n) => ({ ...n, is_read: 1 }))
}

async function openNotification(n: any) {
  if (!n.is_read) {
    try {
      await api.readNotification(n.id)
    } catch (e) {
      /* 静默 */
    }
    n.is_read = 1
    unread.value = Math.max(0, unread.value - 1)
  }
  if (n.link) router.push(n.link)
}

/* ---------------- 用户操作 ---------------- */
function onUserCommand(cmd: string) {
  if (cmd === 'password') {
    pwdVisible.value = true
    return
  }
  if (cmd === 'logout') {
    ElMessageBox.confirm('确定退出登录吗？', '提示', { type: 'warning' })
      .then(async () => {
        await userStore.signOut()
        router.replace('/login')
      })
      .catch(() => {})
  }
}

/* ---------------- 修改密码 ---------------- */
const pwdVisible = ref(false)
const pwdLoading = ref(false)
const pwdFormRef = ref<FormInstance>()
const pwdForm = ref({ old_password: '', new_password: '', confirm: '' })
const pwdRules: FormRules = {
  old_password: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  new_password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度不少于 6 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) =>
        value === pwdForm.value.new_password ? callback() : callback(new Error('两次输入的密码不一致')),
      trigger: 'blur',
    },
  ],
}

async function submitPassword() {
  const form = pwdFormRef.value
  if (!form) return
  const valid = await form.validate().catch(() => false)
  if (!valid) return
  pwdLoading.value = true
  try {
    await api.changePassword(pwdForm.value.old_password, pwdForm.value.new_password)
    ElMessage.success('密码已修改，请重新登录')
    pwdVisible.value = false
    pwdForm.value = { old_password: '', new_password: '', confirm: '' }
    await userStore.signOut()
    router.replace('/login')
  } finally {
    pwdLoading.value = false
  }
}

/* ---------------- 生命周期 ---------------- */
let timer: number | undefined

onMounted(async () => {
  try {
    const cfg = await api.getLoginConfig()
    if (cfg?.company_name) companyName.value = cfg.company_name
  } catch (e) {
    /* 静默 */
  }
  refreshBadges()
  timer = window.setInterval(refreshBadges, 60000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<style scoped>
.layout {
  display: flex;
  height: 100%;
  background: var(--crm-bg);
}

/* ---------------- 侧边栏 ---------------- */
.layout__aside {
  width: var(--crm-sidebar-width);
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid var(--crm-border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
  overflow: hidden;
}

.layout__aside.is-collapsed {
  width: 64px;
}

.layout__brand {
  height: var(--crm-header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--crm-border);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.layout__brand-mark {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--crm-radius);
  background: var(--crm-primary);
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.layout__brand-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.layout__brand-sub {
  margin: 0;
  font-size: 11px;
  color: var(--crm-text-secondary);
}

.layout__nav {
  flex: 1;
  min-height: 0;
}

.layout__nav :deep(.el-menu) {
  border-right: none;
}

.layout__nav :deep(.el-menu-item.is-active),
.layout__nav :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  color: var(--crm-primary);
}

.layout__nav :deep(.el-menu-item.is-active) {
  background: var(--el-color-primary-light-9);
  box-shadow: inset -3px 0 0 var(--crm-primary);
}

/* ---------------- 主体 ---------------- */
.layout__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.layout__header {
  height: var(--crm-header-height);
  flex-shrink: 0;
  background: #fff;
  border-bottom: 1px solid var(--crm-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
}

.layout__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.layout__page-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.layout__header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.layout__icon-btn {
  font-size: 18px;
  color: var(--crm-text-regular);
  cursor: pointer;
}

.layout__icon-btn:hover {
  color: var(--crm-primary);
}

.layout__search {
  width: 260px;
}

.layout__badge {
  display: inline-flex;
  cursor: pointer;
}

.layout__user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  outline: none;
}

.layout__user-name {
  font-size: 13px;
}

.layout__user-role {
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.layout__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* ---------------- 搜索建议 ---------------- */
.sug {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sug__type {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--crm-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 3px;
  padding: 0 4px;
  line-height: 16px;
}

.sug__label {
  font-size: 13px;
}

/* ---------------- 通知面板 ---------------- */
.noti__head,
.noti__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.noti__head {
  font-weight: 600;
  margin-bottom: 6px;
}

.noti__empty {
  text-align: center;
  color: var(--crm-text-secondary);
  font-size: 12px;
  padding: 16px 0;
  margin: 0;
}

.noti__item {
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
}

.noti__item:hover {
  background: #f7f8fa;
}

.noti__item.is-unread .noti__title::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--crm-alert-2);
  margin-right: 6px;
  vertical-align: middle;
}

.noti__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.noti__content {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--crm-text-regular);
}

.noti__time {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--crm-text-secondary);
}

.noti__foot {
  border-top: 1px solid var(--crm-border);
  margin-top: 6px;
  padding-top: 6px;
  justify-content: center;
}
</style>
