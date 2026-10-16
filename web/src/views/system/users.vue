<template>
  <div class="page">
    <div class="user-layout">
      <!-- 左栏：组织架构 -->
      <aside class="dept-card">
        <div class="dept-card__head">
          <span>组织架构</span>
          <el-button v-if="canManage" link type="primary" @click="openDeptCreate(null)">新增</el-button>
        </div>
        <el-input v-model="deptFilter" placeholder="搜索部门" clearable size="small" class="mb-12" />
        <el-tree
          ref="deptTreeRef"
          v-loading="deptLoading"
          :data="deptTree"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          highlight-current
          default-expand-all
          :filter-node-method="filterDept"
          :expand-on-click-node="false"
          @node-click="onDeptClick"
        >
          <template #default="{ data }">
            <span class="dept-node">
              <span class="dept-node__name">{{ data.name }}</span>
              <span v-if="canManage" class="dept-node__ops">
                <el-icon title="新增子部门" @click.stop="openDeptCreate(data)"><Plus /></el-icon>
                <el-icon title="编辑" @click.stop="openDeptEdit(data)"><Edit /></el-icon>
                <el-icon title="删除" @click.stop="removeDept(data)"><Delete /></el-icon>
              </span>
            </span>
          </template>
        </el-tree>
        <p v-if="!deptTree.length && !deptLoading" class="empty-tip">暂无部门</p>
      </aside>

      <!-- 右栏：用户列表 -->
      <section class="page-card user-main">
        <div class="page-head">
          <div class="page-head__left">
            <h2 class="page-title">用户管理</h2>
            <el-tag v-if="currentDept" size="small" type="info" effect="plain" closable @close="clearDept">
              {{ currentDept.name }}
            </el-tag>
          </div>
          <div class="page-head__right">
            <el-button @click="load">刷新</el-button>
            <el-button v-if="canManage" type="primary" @click="openCreate">新增用户</el-button>
          </div>
        </div>

        <div class="filter-bar">
          <el-input
            v-model="query.keyword"
            placeholder="账号 / 姓名 / 手机 / 邮箱"
            clearable
            style="width: 220px"
            @keyup.enter="reload"
            @clear="reload"
          />
          <el-select v-model="query.role_id" placeholder="角色" clearable style="width: 150px" @change="reload">
            <el-option v-for="r in roles" :key="r.id" :label="r.role_name" :value="r.id" />
          </el-select>
          <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px" @change="reload">
            <el-option label="启用" value="enabled" />
            <el-option label="停用" value="disabled" />
          </el-select>
          <div class="filter-bar__spacer" />
          <el-button @click="reset">重置</el-button>
        </div>

        <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
          <el-table-column prop="username" label="账号" width="130" show-overflow-tooltip />
          <el-table-column prop="name" label="姓名" width="110" show-overflow-tooltip />
          <el-table-column label="角色" width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.role_name || '—' }}</template>
          </el-table-column>
          <el-table-column label="部门" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.department_name || '—' }}</template>
          </el-table-column>
          <el-table-column label="手机" width="130">
            <template #default="{ row }">{{ row.phone || '—' }}</template>
          </el-table-column>
          <el-table-column label="邮箱" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.email || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'enabled' ? 'success' : 'info'" effect="plain">
                {{ row.status === 'enabled' ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="150">
            <template #default="{ row }">{{ fmt(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="200" align="center" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canManage" link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button v-if="canManage" link type="primary" @click="openReset(row)">重置密码</el-button>
              <el-button v-if="canManage" link :type="row.status === 'enabled' ? 'danger' : 'primary'" @click="toggleStatus(row)">
                {{ row.status === 'enabled' ? '停用' : '启用' }}
              </el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="empty-tip">暂无用户</div>
          </template>
        </el-table>

        <el-pagination
          v-if="total > 0"
          class="mt-12"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :page-size="query.page_size"
          :current-page="query.page"
          :page-sizes="[20, 50, 100]"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </section>
    </div>

    <!-- 新增 / 编辑用户（抽屉 480px） -->
    <el-drawer v-model="drawer" :title="editing ? '编辑用户' : '新增用户'" size="480px" @closed="resetForm">
      <el-form label-width="80px">
        <el-form-item label="账号" required>
          <el-input v-model="form.username" :disabled="!!editing" maxlength="30" placeholder="登录账号，创建后不可修改" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" maxlength="30" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item v-if="!editing" label="初始密码" required>
          <el-input v-model="form.password" type="password" show-password maxlength="30" placeholder="不少于 6 位" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role_id" placeholder="请选择角色" clearable filterable style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :label="r.role_name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-tree-select
            v-model="form.department_id"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="请选择部门"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="手机">
          <el-input v-model="form.phone" maxlength="20" placeholder="请输入手机号" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" maxlength="60" placeholder="请输入邮箱" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawer = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSubmit">提交</el-button>
      </template>
    </el-drawer>

    <!-- 重置密码 -->
    <el-dialog v-model="resetDialog" title="重置密码" width="480px" align-center>
      <p class="text-muted">为用户「{{ current?.name }}（{{ current?.username }}）」设置新密码。</p>
      <el-input v-model="newPassword" type="password" show-password maxlength="30" placeholder="新密码，不少于 6 位" />
      <template #footer>
        <el-button @click="resetDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmReset">确认重置</el-button>
      </template>
    </el-dialog>

    <!-- 部门编辑 -->
    <el-dialog v-model="deptDialog" :title="deptEditing ? '编辑部门' : '新增部门'" width="480px" align-center>
      <el-form label-width="90px">
        <el-form-item label="部门名称" required>
          <el-input v-model="deptForm.name" maxlength="30" placeholder="请输入部门名称" />
        </el-form-item>
        <el-form-item label="上级部门">
          <el-tree-select
            v-model="deptForm.parent_id"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="不选则为顶级部门"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="deptForm.sort_order" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deptDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmDept">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const roles = ref<any[]>([])
const deptTree = ref<any[]>([])
const deptLoading = ref(false)
const deptFilter = ref('')
const currentDept = ref<any>(null)
const deptTreeRef = ref<any>(null)

const drawer = ref(false)
const editing = ref<any>(null)
const resetDialog = ref(false)
const newPassword = ref('')
const current = ref<any>(null)

const deptDialog = ref(false)
const deptEditing = ref<any>(null)
const deptForm = reactive<any>({ name: '', parent_id: '', sort_order: 0 })

const query = reactive({ keyword: '', role_id: '', status: '', department_id: '', page: 1, page_size: 20 })
const form = reactive<any>({ username: '', name: '', password: '', role_id: '', department_id: '', phone: '', email: '' })

const canManage = computed(() => userStore.hasPerm('user:manage'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function filterDept(value: string, data: any) {
  if (!value) return true
  return String(data.name || '').includes(value)
}

watch(deptFilter, (v) => deptTreeRef.value?.filter(v))

async function loadDepartments() {
  deptLoading.value = true
  try {
    deptTree.value = await api.listDepartments()
  } finally {
    deptLoading.value = false
  }
}

async function loadRoles() {
  try {
    roles.value = await api.listRoles({ is_enabled: 1 })
  } catch (e) {
    try {
      roles.value = await api.listRoles()
    } catch (e2) {
      roles.value = []
    }
  }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['keyword', 'role_id', 'status', 'department_id'].forEach((k) => {
      const v = (query as any)[k]
      if (v) params[k] = v
    })
    const res = await api.listUsers(params)
    items.value = res.list || []
    total.value = res.total || 0
  } finally {
    loading.value = false
  }
}

function reload() {
  query.page = 1
  load()
}

function reset() {
  Object.assign(query, { keyword: '', role_id: '', status: '', department_id: '', page: 1 })
  currentDept.value = null
  deptTreeRef.value?.setCurrentKey(null)
  load()
}

function onPageChange(p: number) {
  query.page = p
  load()
}

function onSizeChange(s: number) {
  query.page_size = s
  query.page = 1
  load()
}

function onDeptClick(data: any) {
  currentDept.value = data
  query.department_id = data.id
  reload()
}

function clearDept() {
  currentDept.value = null
  query.department_id = ''
  deptTreeRef.value?.setCurrentKey(null)
  reload()
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    username: '',
    name: '',
    password: '',
    role_id: '',
    department_id: currentDept.value?.id || '',
    phone: '',
    email: '',
  })
  drawer.value = true
}

function openEdit(row: any) {
  editing.value = row
  Object.assign(form, {
    username: row.username || '',
    name: row.name || '',
    password: '',
    role_id: row.role_id || '',
    department_id: row.department_id || '',
    phone: row.phone || '',
    email: row.email || '',
  })
  drawer.value = true
}

function resetForm() {
  editing.value = null
}

async function confirmSubmit() {
  if (!editing.value && !form.username.trim()) {
    ElMessage.warning('请输入账号')
    return
  }
  if (!form.name.trim()) {
    ElMessage.warning('请输入姓名')
    return
  }
  if (!editing.value && String(form.password || '').length < 6) {
    ElMessage.warning('初始密码不得少于 6 位')
    return
  }
  submitting.value = true
  try {
    if (editing.value) {
      await api.updateUser(editing.value.id, {
        name: form.name.trim(),
        role_id: form.role_id || null,
        department_id: form.department_id || null,
        phone: form.phone || null,
        email: form.email || null,
      })
      ElMessage.success('已保存')
    } else {
      await api.createUser({
        username: form.username.trim(),
        name: form.name.trim(),
        password: form.password,
        role_id: form.role_id || undefined,
        department_id: form.department_id || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
      })
      ElMessage.success('用户已创建')
    }
    drawer.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

function openReset(row: any) {
  current.value = row
  newPassword.value = ''
  resetDialog.value = true
}

async function confirmReset() {
  if (String(newPassword.value || '').length < 6) {
    ElMessage.warning('新密码不得少于 6 位')
    return
  }
  submitting.value = true
  try {
    await api.resetUserPassword(current.value.id, newPassword.value)
    ElMessage.success('密码已重置')
    resetDialog.value = false
  } finally {
    submitting.value = false
  }
}

async function toggleStatus(row: any) {
  const next = row.status === 'enabled' ? 'disabled' : 'enabled'
  const action = next === 'disabled' ? '停用' : '启用'
  await ElMessageBox.confirm(`确认${action}用户「${row.name}（${row.username}）」？`, `${action}确认`, { type: 'warning' })
  await api.toggleUserStatus(row.id, next)
  ElMessage.success(`已${action}`)
  await load()
}

/* ---------------- 部门维护 ---------------- */
function openDeptCreate(parent: any) {
  deptEditing.value = null
  Object.assign(deptForm, { name: '', parent_id: parent?.id || '', sort_order: 0 })
  deptDialog.value = true
}

function openDeptEdit(data: any) {
  deptEditing.value = data
  Object.assign(deptForm, { name: data.name || '', parent_id: data.parent_id || '', sort_order: data.sort_order || 0 })
  deptDialog.value = true
}

async function confirmDept() {
  if (!deptForm.name.trim()) {
    ElMessage.warning('请输入部门名称')
    return
  }
  if (deptEditing.value && deptForm.parent_id === deptEditing.value.id) {
    ElMessage.warning('上级部门不能是自己')
    return
  }
  submitting.value = true
  try {
    const body = { name: deptForm.name.trim(), parent_id: deptForm.parent_id || null, sort_order: Number(deptForm.sort_order) || 0 }
    if (deptEditing.value) {
      await api.updateDepartment(deptEditing.value.id, body)
      ElMessage.success('已保存')
    } else {
      await api.createDepartment(body)
      ElMessage.success('部门已创建')
    }
    deptDialog.value = false
    await loadDepartments()
  } finally {
    submitting.value = false
  }
}

async function removeDept(data: any) {
  await ElMessageBox.confirm(`确认删除部门「${data.name}」？含下级部门或成员时不可删除。`, '删除确认', { type: 'warning' })
  await api.deleteDepartment(data.id)
  ElMessage.success('已删除')
  if (currentDept.value?.id === data.id) clearDept()
  await loadDepartments()
}

onMounted(async () => {
  await Promise.all([loadDepartments(), loadRoles()])
  await load()
})
</script>

<style scoped>
.user-layout {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.dept-card {
  width: 240px;
  flex-shrink: 0;
  background: var(--crm-card);
  border-radius: var(--crm-radius);
  padding: 12px;
}

.dept-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}

.user-main {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.dept-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 4px;
}

.dept-node__ops {
  display: none;
  gap: 6px;
  color: var(--crm-text-secondary);
}

.dept-node:hover .dept-node__ops {
  display: inline-flex;
}

@media (max-width: 1200px) {
  /* 组织架构为用户列表的筛选入口，窄屏下收窄而非隐藏 */
  .dept-card {
    width: 180px;
  }
}
</style>
