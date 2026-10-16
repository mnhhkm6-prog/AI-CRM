<template>
  <div class="page">
    <div class="role-layout">
      <!-- 左栏：角色列表 -->
      <aside class="role-card">
        <div class="role-card__head">
          <span>角色列表</span>
          <span class="text-muted">{{ roles.length }}</span>
        </div>
        <div v-loading="rolesLoading" class="role-list">
          <div
            v-for="role in roles"
            :key="role.id"
            class="role-item"
            :class="{ 'role-item--active': selected?.id === role.id }"
            @click="selectRole(role)"
          >
            <div class="role-item__top">
              <span class="role-item__name">{{ role.role_name }}</span>
              <el-tag size="small" :type="role.is_system === 1 ? 'info' : 'primary'" effect="plain">
                {{ role.is_system === 1 ? '内置' : '自定义' }}
              </el-tag>
            </div>
            <div class="role-item__meta">
              <span class="role-item__code">{{ role.role_code }}</span>
              <span class="role-item__count">{{ role.member_count || 0 }} 人</span>
            </div>
            <div v-if="canManage" class="role-item__ops">
              <el-button link type="primary" size="small" @click.stop="openEdit(role)">编辑</el-button>
              <el-button link type="primary" size="small" @click.stop="openCopy(role)">复制</el-button>
              <el-button v-if="role.is_system !== 1" link type="danger" size="small" @click.stop="removeRole(role)">删除</el-button>
            </div>
          </div>
          <p v-if="!roles.length && !rolesLoading" class="empty-tip">暂无角色</p>
        </div>
      </aside>

      <!-- 右栏：角色配置 -->
      <section class="page-card role-main">
        <div class="page-head">
          <div class="page-head__left">
            <h2 class="page-title">角色权限</h2>
          </div>
          <div class="page-head__right">
            <el-button @click="refresh">刷新</el-button>
            <el-button v-if="canManage" type="primary" @click="openCreate">新增角色</el-button>
          </div>
        </div>

        <template v-if="selected">
          <div class="role-summary">
            <div class="role-summary__head">
              <span class="role-summary__name">{{ selected.role_name }}</span>
              <el-tag size="small" :type="selected.is_system === 1 ? 'info' : 'primary'" effect="plain">
                {{ selected.is_system === 1 ? '内置' : '自定义' }}
              </el-tag>
              <span class="text-muted">{{ selected.role_code }}</span>
            </div>
            <p class="text-muted">{{ selected.description || '暂无描述' }}</p>
          </div>

          <el-tabs v-model="tab">
            <!-- 功能权限 -->
            <el-tab-pane label="功能权限" name="perm">
              <div v-loading="detailLoading" class="perm-panel">
                <div v-for="g in permGroups" :key="g.module" class="perm-group">
                  <div class="perm-group__head">
                    <el-checkbox
                      :model-value="groupAllChecked(g)"
                      :indeterminate="groupIndeterminate(g)"
                      :disabled="!canManage"
                      @change="setGroup(g, $event)"
                    >
                      <span class="perm-group__title">{{ g.module }}</span>
                    </el-checkbox>
                    <span class="text-muted">{{ g.items.length }} 项</span>
                  </div>
                  <div class="perm-group__body">
                    <div v-for="it in g.items" :key="it.code" class="perm-item">
                      <el-checkbox v-model="permState[it.code]" :disabled="!canManage">
                        {{ it.name || it.code }}
                      </el-checkbox>
                      <span class="perm-item__code">{{ it.code }}</span>
                    </div>
                  </div>
                </div>
                <p v-if="!permGroups.length && !detailLoading" class="empty-tip">暂无权限点</p>
                <div v-if="canManage" class="mt-12">
                  <el-button type="primary" :loading="saving" @click="savePerms">保存</el-button>
                </div>
              </div>
            </el-tab-pane>

            <!-- 数据权限 -->
            <el-tab-pane label="数据权限" name="scope">
              <div v-loading="detailLoading">
                <el-table :data="scopeRows" size="small" style="width: 100%">
                  <el-table-column label="资源" width="120">
                    <template #default="{ row }">{{ row.label }}</template>
                  </el-table-column>
                  <el-table-column label="数据范围">
                    <template #default="{ row }">
                      <el-select v-model="row.data_scope" :disabled="!canManage" style="width: 180px">
                        <el-option v-for="o in scopeOptions" :key="o.value" :label="o.label" :value="o.value" />
                      </el-select>
                      <div v-if="row.data_scope === 'custom'" class="scope-extra">
                        <div class="scope-extra__row">
                          <span class="scope-extra__label">部门范围</span>
                          <el-tree-select
                            v-model="row.scope_config.departments"
                            :data="deptTree"
                            :props="{ label: 'name', children: 'children' }"
                            node-key="id"
                            multiple
                            show-checkbox
                            check-strictly
                            clearable
                            collapse-tags
                            :disabled="!canManage"
                            placeholder="请选择部门"
                            style="width: 360px"
                          />
                        </div>
                        <div class="scope-extra__row">
                          <span class="scope-extra__label">包含本人</span>
                          <el-switch v-model="row.scope_config.include_self" :disabled="!canManage" />
                        </div>
                        <div class="scope-extra__row">
                          <span class="scope-extra__label">含协作数据</span>
                          <el-switch v-model="row.scope_config.collaborated" :disabled="!canManage" />
                        </div>
                      </div>
                    </template>
                  </el-table-column>
                  <template #empty>
                    <div class="empty-tip">暂无数据</div>
                  </template>
                </el-table>
                <div v-if="canManage" class="mt-12">
                  <el-button type="primary" :loading="saving" @click="saveScopes">保存</el-button>
                </div>
              </div>
            </el-tab-pane>

            <!-- 成员 -->
            <el-tab-pane label="成员" name="member">
              <el-table v-loading="detailLoading" :data="members" size="small" style="width: 100%">
                <el-table-column prop="username" label="账号" width="150" show-overflow-tooltip />
                <el-table-column prop="name" label="姓名" width="130" show-overflow-tooltip />
                <el-table-column label="部门" min-width="160" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.department_name || '—' }}</template>
                </el-table-column>
                <el-table-column label="状态" width="90" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.status === 'enabled' ? 'success' : 'info'" effect="plain">
                      {{ row.status === 'enabled' ? '启用' : '停用' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <template #empty>
                  <div class="empty-tip">暂无数据</div>
                </template>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
        <p v-else class="empty-tip">请选择左侧角色</p>
      </section>
    </div>

    <!-- 新增 / 编辑 / 复制角色 -->
    <el-dialog v-model="roleDialog" :title="dialogTitle" width="480px" align-center>
      <p v-if="dialogMode === 'copy'" class="text-muted mb-12">将复制源角色的全部权限配置。</p>
      <el-form label-width="90px">
        <el-form-item label="角色名称" required>
          <el-input v-model="roleForm.role_name" maxlength="30" placeholder="请输入角色名称" />
        </el-form-item>
        <el-form-item label="角色编码">
          <el-input
            v-model="roleForm.role_code"
            maxlength="40"
            :disabled="roleCodeDisabled"
            :placeholder="dialogMode === 'create' ? '留空自动生成' : '请输入角色编码'"
          />
        </el-form-item>
        <template v-if="dialogMode !== 'copy'">
          <el-form-item label="描述">
            <el-input v-model="roleForm.description" type="textarea" :rows="2" maxlength="100" placeholder="请输入描述" />
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="roleForm.sort_order" :min="0" :controls="false" style="width: 100%" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="roleDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmRole">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

/** 数据范围资源定义（7 项） */
const RESOURCES = [
  { type: 'customer', label: '客户' },
  { type: 'lead', label: '线索' },
  { type: 'opportunity', label: '商机' },
  { type: 'activity', label: '行为记录' },
  { type: 'proposal', label: '方案' },
  { type: 'quotation', label: '报价' },
  { type: 'contract', label: '合同' },
]

/** 数据范围选项 */
const scopeOptions = [
  { value: 'self', label: '本人' },
  { value: 'department', label: '本部门' },
  { value: 'sub_department', label: '本部门及下级' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
]

const canManage = computed(() => userStore.hasPerm('role:manage'))

const roles = ref<any[]>([])
const rolesLoading = ref(false)
const selected = ref<any>(null)
const tab = ref('perm')

const detailLoading = ref(false)
const saving = ref(false)
const submitting = ref(false)

const permissions = ref<any[]>([])
const permState = ref<Record<string, boolean>>({})
const members = ref<any[]>([])
const scopeRows = ref<any[]>([])
const deptTree = ref<any[]>([])

const roleDialog = ref(false)
const dialogMode = ref<'create' | 'edit' | 'copy'>('create')
const editingRole = ref<any>(null)
const sourceRole = ref<any>(null)
const roleForm = reactive<any>({ role_name: '', role_code: '', description: '', sort_order: 0 })

const dialogTitle = computed(() => {
  if (dialogMode.value === 'create') return '新增角色'
  if (dialogMode.value === 'copy') return '复制角色'
  return '编辑角色'
})

/** 内置角色的编码不允许修改 */
const roleCodeDisabled = computed(() => dialogMode.value === 'edit' && editingRole.value?.is_system === 1)

/** 按 module 分组的权限点（模块内按 sort_order 升序） */
const permGroups = computed(() => {
  const map = new Map<string, any[]>()
  permissions.value.forEach((p) => {
    const m = p.module || '其他'
    if (!map.has(m)) map.set(m, [])
    map.get(m)!.push(p)
  })
  return [...map.entries()]
    .map(([module, items]) => ({
      module,
      items: items.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    }))
    .sort((a, b) => a.module.localeCompare(b.module, undefined, { numeric: true }))
})

function groupAllChecked(g: any) {
  return g.items.length > 0 && g.items.every((i: any) => !!permState.value[i.code])
}

function groupIndeterminate(g: any) {
  const n = g.items.filter((i: any) => !!permState.value[i.code]).length
  return n > 0 && n < g.items.length
}

function setGroup(g: any, val: any) {
  if (!canManage.value) return
  const next = { ...permState.value }
  g.items.forEach((i: any) => {
    next[i.code] = !!val
  })
  permState.value = next
}

async function loadPermissions() {
  try {
    permissions.value = await api.listPermissions()
  } catch (e) {
    permissions.value = []
  }
}

async function loadDepartments() {
  try {
    deptTree.value = await api.listDepartments()
  } catch (e) {
    deptTree.value = []
  }
}

function applyPermissions(rp: any) {
  const granted: string[] = rp?.granted || []
  const next: Record<string, boolean> = {}
  permissions.value.forEach((p) => {
    next[p.code] = granted.includes(p.code)
  })
  permState.value = next
}

function applyScopes(ds: any) {
  const map: Record<string, any> = {}
  ;(ds?.scopes || []).forEach((s: any) => {
    map[s.resource_type] = s
  })
  scopeRows.value = RESOURCES.map((r) => {
    const s = map[r.type]
    const cfg = s?.scope_config || {}
    return {
      resource_type: r.type,
      label: r.label,
      data_scope: s?.data_scope || 'self',
      scope_config: {
        departments: cfg.departments || [],
        include_self: !!cfg.include_self,
        collaborated: !!cfg.collaborated,
      },
    }
  })
}

async function loadDetail(id: string) {
  detailLoading.value = true
  try {
    const [rp, ds, ms] = await Promise.all([api.rolePermissions(id), api.roleDataScopes(id), api.roleMembers(id)])
    applyPermissions(rp)
    applyScopes(ds)
    members.value = Array.isArray(ms) ? ms : ms ? [ms] : []
  } finally {
    detailLoading.value = false
  }
}

async function loadRoles(keepId?: string) {
  rolesLoading.value = true
  try {
    roles.value = await api.listRoles()
    const id = keepId || selected.value?.id
    selected.value = roles.value.find((r) => r.id === id) || roles.value[0] || null
    if (selected.value) {
      await loadDetail(selected.value.id)
    } else {
      permState.value = {}
      scopeRows.value = []
      members.value = []
    }
  } finally {
    rolesLoading.value = false
  }
}

async function selectRole(role: any) {
  if (selected.value?.id === role.id) return
  selected.value = role
  await loadDetail(role.id)
}

async function refresh() {
  await loadRoles(selected.value?.id)
}

/* ---------------- 保存：成员数 > 0 时二次确认 ---------------- */
async function submitWithConfirm(
  previewFn: () => Promise<any>,
  saveFn: (confirm: boolean) => Promise<any>,
  successMsg: string
) {
  let memberCount = 0
  let affected: any = {}
  try {
    const preview = await previewFn()
    memberCount = preview?.member_count || 0
    affected = preview?.affected || {}
  } catch (e) {
    memberCount = 0
  }
  if (memberCount > 0) {
    const a = affected || {}
    const text = `该角色下有 ${memberCount} 名成员，涉及 客户 ${a.customers || 0} 条 / 线索 ${a.leads || 0} 条 / 商机 ${a.opportunities || 0} 条 数据。确认继续保存？`
    await ElMessageBox.confirm(text, '权限变更确认', { type: 'warning' })
    await saveFn(true)
  } else {
    await saveFn(false)
  }
  ElMessage.success(successMsg)
  if (selected.value) await loadDetail(selected.value.id)
}

async function savePerms() {
  if (!selected.value) return
  const roleId = selected.value.id
  const payload = permissions.value.map((p) => ({ permission_code: p.code, is_enabled: !!permState.value[p.code] }))
  saving.value = true
  try {
    await submitWithConfirm(
      () => api.rolePermissionChangePreview(roleId, {}),
      (confirm) => api.updateRolePermissions(roleId, confirm ? { permissions: payload, confirm: true } : { permissions: payload }),
      '权限已保存'
    )
  } catch (e) {
    /* 取消确认或接口报错已由拦截器提示 */
  } finally {
    saving.value = false
  }
}

async function saveScopes() {
  if (!selected.value) return
  const roleId = selected.value.id
  const scopes = scopeRows.value.map((r) => {
    const item: any = { resource_type: r.resource_type, data_scope: r.data_scope }
    if (r.data_scope === 'custom') {
      item.scope_config = {
        departments: r.scope_config.departments || [],
        include_self: !!r.scope_config.include_self,
        collaborated: !!r.scope_config.collaborated,
      }
    }
    return item
  })
  saving.value = true
  try {
    await submitWithConfirm(
      () => api.rolePermissionChangePreview(roleId, {}),
      (confirm) => api.updateRoleDataScopes(roleId, confirm ? { scopes, confirm: true } : { scopes }),
      '数据权限已保存'
    )
  } catch (e) {
    /* 取消确认或接口报错已由拦截器提示 */
  } finally {
    saving.value = false
  }
}

/* ---------------- 角色维护 ---------------- */
function openCreate() {
  dialogMode.value = 'create'
  editingRole.value = null
  sourceRole.value = null
  Object.assign(roleForm, { role_name: '', role_code: '', description: '', sort_order: 0 })
  roleDialog.value = true
}

function openEdit(role: any) {
  dialogMode.value = 'edit'
  editingRole.value = role
  sourceRole.value = null
  Object.assign(roleForm, {
    role_name: role.role_name || '',
    role_code: role.role_code || '',
    description: role.description || '',
    sort_order: role.sort_order || 0,
  })
  roleDialog.value = true
}

function openCopy(role: any) {
  dialogMode.value = 'copy'
  editingRole.value = null
  sourceRole.value = role
  Object.assign(roleForm, { role_name: `${role.role_name}-副本`, role_code: '', description: '', sort_order: 0 })
  roleDialog.value = true
}

async function confirmRole() {
  if (!roleForm.role_name.trim()) {
    ElMessage.warning('请输入角色名称')
    return
  }
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      await api.createRole({
        role_name: roleForm.role_name.trim(),
        role_code: roleForm.role_code.trim() || undefined,
        description: roleForm.description.trim() || undefined,
        sort_order: Number(roleForm.sort_order) || 0,
      })
      ElMessage.success('角色已创建')
    } else if (dialogMode.value === 'copy') {
      await api.copyRole(sourceRole.value.id, {
        role_name: roleForm.role_name.trim(),
        role_code: roleForm.role_code.trim() || undefined,
      })
      ElMessage.success('角色已复制')
    } else {
      const body: any = {
        role_name: roleForm.role_name.trim(),
        description: roleForm.description.trim() || null,
        sort_order: Number(roleForm.sort_order) || 0,
      }
      if (editingRole.value?.is_system !== 1) body.role_code = roleForm.role_code.trim() || undefined
      await api.updateRole(editingRole.value.id, body)
      ElMessage.success('已保存')
    }
    roleDialog.value = false
    await loadRoles(selected.value?.id)
  } finally {
    submitting.value = false
  }
}

async function removeRole(role: any) {
  await ElMessageBox.confirm(`确认删除角色「${role.role_name}」？该操作不可恢复。`, '删除确认', { type: 'warning' })
  try {
    await api.deleteRole(role.id)
    ElMessage.success('已删除')
    await loadRoles()
  } catch (e: any) {
    ElMessage.error(e?.bizMessage || '删除失败')
  }
}

onMounted(async () => {
  await Promise.all([loadPermissions(), loadDepartments()])
  await loadRoles()
})
</script>

<style scoped>
.role-layout {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.role-card {
  width: 260px;
  flex-shrink: 0;
  background: var(--crm-card);
  border-radius: var(--crm-radius);
  padding: 12px;
}

.role-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}

.role-list {
  min-height: 60px;
}

.role-item {
  padding: 8px;
  border-radius: var(--crm-radius);
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 6px;
}

.role-item:hover {
  background: #f5f7fa;
}

.role-item--active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.role-item__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.role-item__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.role-item__code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-item__ops {
  display: none;
  gap: 4px;
  margin-top: 4px;
}

.role-item:hover .role-item__ops,
.role-item--active .role-item__ops {
  display: flex;
}

.role-main {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.role-summary {
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: var(--crm-radius);
  margin-bottom: 12px;
}

.role-summary__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.role-summary__name {
  font-size: 14px;
  font-weight: 600;
}

.role-summary p {
  margin: 4px 0 0;
  font-size: 12px;
}

.perm-group {
  border: 1px solid var(--crm-border);
  border-radius: var(--crm-radius);
  margin-bottom: 10px;
}

.perm-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f5f7fa;
  border-bottom: 1px solid var(--crm-border);
}

.perm-group__title {
  font-weight: 600;
}

.perm-group__body {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px 12px;
  padding: 8px 10px;
}

.perm-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.perm-item__code {
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.scope-extra {
  margin-top: 8px;
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: var(--crm-radius);
}

.scope-extra__row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.scope-extra__row:last-child {
  margin-bottom: 0;
}

.scope-extra__label {
  width: 70px;
  color: var(--crm-text-regular);
}

@media (max-width: 1200px) {
  .role-card {
    width: 200px;
  }
}
</style>
