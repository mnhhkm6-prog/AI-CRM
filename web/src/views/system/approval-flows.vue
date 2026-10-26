<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">审批流配置</h2>
          <span class="text-muted">按业务类型 + 条件命中流程，命中多条时取优先级数字最小的一条</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
          <el-button type="primary" @click="openCreate">新建审批流</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.biz_type" placeholder="全部业务类型" clearable style="width: 160px" @change="reload">
          <el-option v-for="b in options.biz_types" :key="b.code" :label="b.name" :value="b.code" />
        </el-select>
        <el-input
          v-model="query.keyword"
          placeholder="流程名称 / 描述"
          clearable
          style="width: 220px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <div class="filter-bar__spacer" />
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column label="业务类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ bizLabel(row.biz_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="流程名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="触发条件" min-width="220">
          <template #default="{ row }">
            <span class="text-muted">{{ conditionText(row.conditions) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="审批节点" min-width="220">
          <template #default="{ row }">
            <span class="text-muted">{{ nodeText(row.nodes) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="80" align="center" />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="isOn(row.is_enabled) ? 'success' : 'info'" effect="plain">
              {{ isOn(row.is_enabled) ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="版本" width="70" align="center">
          <template #default="{ row }">v{{ row.version || 1 }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="150">
          <template #default="{ row }">{{ fmt(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link :type="isOn(row.is_enabled) ? 'warning' : 'success'" @click="toggle(row)">
              {{ isOn(row.is_enabled) ? '停用' : '启用' }}
            </el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无审批流，点击右上角新建</div>
        </template>
      </el-table>

      <el-pagination
        v-if="total > pageSize"
        class="mt-12"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="onPageChange"
      />
    </div>

    <!-- 流程编辑器 -->
    <el-dialog v-model="dialog" :title="editingId ? '编辑审批流' : '新建审批流'" width="760px" align-center @closed="resetForm">
      <el-form label-width="92px">
        <el-form-item label="流程名称" required>
          <el-input v-model="form.name" maxlength="60" placeholder="如：报价折扣审批" />
        </el-form-item>
        <el-form-item label="业务类型" required>
          <el-select v-model="form.biz_type" placeholder="请选择" style="width: 220px">
            <el-option v-for="b in options.biz_types" :key="b.code" :label="b.name" :value="b.code" />
          </el-select>
          <span class="form-tip">报价折扣率 = 报价金额 ÷ 商机金额</span>
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="1" :controls="false" style="width: 120px" />
          <span class="form-tip">数字越小优先级越高，默认 100</span>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="200" placeholder="说明该流程的适用场景" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.is_enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>

        <el-divider content-position="left">触发条件（全部满足才命中）</el-divider>
        <div v-for="(c, i) in form.conditions" :key="`c${i}`" class="rule-row">
          <el-select v-model="c.field" placeholder="字段" style="width: 140px">
            <el-option v-for="f in options.fields" :key="f.code" :label="f.name" :value="f.code" />
          </el-select>
          <el-select v-model="c.op" placeholder="运算符" style="width: 100px">
            <el-option v-for="op in options.operators" :key="op" :label="op" :value="op" />
          </el-select>
          <el-input-number v-model="c.value" :controls="false" :min="0" placeholder="阈值" style="width: 170px" />
          <span class="form-tip">{{ valueTip(c.field) }}</span>
          <el-button link type="danger" @click="form.conditions.splice(i, 1)">删除</el-button>
        </div>
        <el-button link type="primary" @click="addCondition">+ 添加条件</el-button>

        <el-divider content-position="left">审批节点（按顺序执行）</el-divider>
        <div v-for="(n, i) in form.nodes" :key="`n${i}`" class="node-card">
          <div class="node-card__head">
            <span class="node-card__index">节点 {{ i + 1 }}</span>
            <el-button link type="danger" @click="form.nodes.splice(i, 1)">删除</el-button>
          </div>
          <div class="rule-row">
            <el-input v-model="n.node_name" maxlength="40" placeholder="节点名称，如：管理层审批" style="width: 220px" />
            <el-select v-model="n.approve_mode" style="width: 120px">
              <el-option label="或签" value="any" />
              <el-option label="会签" value="all" />
            </el-select>
            <el-select v-model="n.approver_type" style="width: 120px" @change="n.approver_values = []">
              <el-option label="按角色" value="role" />
              <el-option label="按用户" value="user" />
            </el-select>
            <el-select
              v-model="n.approver_values"
              multiple
              filterable
              collapse-tags
              :placeholder="n.approver_type === 'role' ? '选择角色' : '选择用户'"
              style="flex: 1; min-width: 200px"
            >
              <el-option
                v-for="o in n.approver_type === 'role' ? options.roles : options.users"
                :key="n.approver_type === 'role' ? o.code : o.id"
                :label="n.approver_type === 'role' ? o.name : `${o.name}（${o.username}）`"
                :value="n.approver_type === 'role' ? o.code : o.id"
              />
            </el-select>
          </div>
        </div>
        <el-button link type="primary" @click="addNode">+ 添加节点</el-button>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const query = reactive({ biz_type: '', keyword: '' })
const options = ref<{ biz_types: any[]; fields: any[]; operators: string[]; roles: any[]; users: any[] }>({
  biz_types: [],
  fields: [],
  operators: [],
  roles: [],
  users: [],
})

const dialog = ref(false)
const editingId = ref('')
const form = reactive<any>({
  name: '',
  biz_type: 'quotation',
  priority: 100,
  description: '',
  is_enabled: true,
  conditions: [] as any[],
  nodes: [] as any[],
})

function isOn(v: any) {
  return v === 1 || v === true
}

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function bizLabel(code: string) {
  const hit = options.value.biz_types.find((b) => b.code === code)
  return hit ? hit.name : code
}

function fieldLabel(code: string) {
  const hit = options.value.fields.find((f) => f.code === code)
  return hit ? hit.name : code
}

function valueTip(field: string) {
  return field === 'discount_rate' ? '折扣率请填小数，如 0.9 表示 9 折' : ''
}

function conditionText(conditions?: any[]) {
  if (!conditions || !conditions.length) return '无条件（全部命中）'
  return conditions.map((c) => `${fieldLabel(c.field)} ${c.op} ${c.value}`).join(' 且 ')
}

function nodeText(nodes?: any[]) {
  if (!nodes || !nodes.length) return '—'
  return nodes
    .map((n) => `${n.node_name}（${n.approve_mode === 'all' ? '会签' : '或签'}）`)
    .join(' → ')
}

async function loadOptions() {
  options.value = await api.getApprovalOptions()
}

async function load() {
  loading.value = true
  try {
    const res = await api.listApprovalFlows({
      biz_type: query.biz_type || undefined,
      keyword: query.keyword || undefined,
      page: page.value,
      page_size: pageSize.value,
    })
    items.value = res.list || []
    total.value = res.total || 0
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

function onPageChange(p: number) {
  page.value = p
  load()
}

function resetForm() {
  editingId.value = ''
}

function addCondition() {
  form.conditions.push({ field: 'amount', op: '>=', value: undefined })
}

function addNode() {
  form.nodes.push({ node_name: '', approve_mode: 'any', approver_type: 'role', approver_values: [] })
}

function openCreate() {
  editingId.value = ''
  Object.assign(form, {
    name: '',
    biz_type: 'quotation',
    priority: 100,
    description: '',
    is_enabled: true,
    conditions: [],
    nodes: [],
  })
  addCondition()
  addNode()
  dialog.value = true
}

async function openEdit(row: any) {
  const detail = await api.getApprovalFlow(row.id)
  editingId.value = detail.id
  Object.assign(form, {
    name: detail.name,
    biz_type: detail.biz_type,
    priority: detail.priority || 100,
    description: detail.description || '',
    is_enabled: isOn(detail.is_enabled),
    conditions: (detail.conditions || []).map((c: any) => ({ ...c })),
    nodes: (detail.nodes || []).map((n: any) => ({
      node_name: n.node_name,
      approve_mode: n.approve_mode || 'any',
      approver_type: n.approver_type,
      approver_values: [...(n.approver_values || [])],
    })),
  })
  dialog.value = true
}

async function confirm() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入流程名称')
    return
  }
  if (!form.biz_type) {
    ElMessage.warning('请选择业务类型')
    return
  }
  if (!form.conditions.length) {
    ElMessage.warning('请至少配置一个触发条件')
    return
  }
  for (const c of form.conditions) {
    if (c.value === undefined || c.value === null || c.value === '') {
      ElMessage.warning('请填写完整的条件阈值')
      return
    }
  }
  if (!form.nodes.length) {
    ElMessage.warning('请至少配置一个审批节点')
    return
  }
  for (const [i, n] of form.nodes.entries()) {
    if (!String(n.node_name || '').trim()) {
      ElMessage.warning(`请填写第 ${i + 1} 个节点的名称`)
      return
    }
    if (!n.approver_values.length) {
      ElMessage.warning(`请为第 ${i + 1} 个节点选择审批人`)
      return
    }
  }
  const body = {
    name: form.name.trim(),
    biz_type: form.biz_type,
    priority: Number(form.priority) || 100,
    description: form.description.trim() || undefined,
    is_enabled: form.is_enabled,
    conditions: form.conditions.map((c: any) => ({ field: c.field, op: c.op, value: Number(c.value) })),
    nodes: form.nodes.map((n: any) => ({
      node_name: String(n.node_name).trim(),
      approve_mode: n.approve_mode,
      approver_type: n.approver_type,
      approver_values: n.approver_values,
    })),
  }
  submitting.value = true
  try {
    if (editingId.value) {
      await api.updateApprovalFlow(editingId.value, body)
      ElMessage.success('已保存，版本号已递增')
    } else {
      await api.createApprovalFlow(body)
      ElMessage.success('审批流已创建')
    }
    dialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function toggle(row: any) {
  const next = !isOn(row.is_enabled)
  const action = next ? '启用' : '停用'
  await ElMessageBox.confirm(`确认${action}审批流「${row.name}」？`, `${action}确认`, { type: 'warning' })
  await api.updateApprovalFlow(row.id, {
    name: row.name,
    biz_type: row.biz_type,
    priority: row.priority,
    description: row.description,
    is_enabled: next,
    conditions: row.conditions,
    nodes: row.nodes,
  })
  ElMessage.success(`已${action}`)
  await load()
}

async function remove(row: any) {
  await ElMessageBox.confirm(
    `确认删除审批流「${row.name}」？删除后新提交的业务将不再命中该流程，已发起的审批不受影响。`,
    '删除确认',
    { type: 'warning' }
  )
  await api.deleteApprovalFlow(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  await loadOptions()
  await load()
})
</script>

<style scoped>
.form-tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.node-card {
  border: 1px solid var(--crm-border);
  border-radius: var(--crm-radius);
  padding: 10px 12px;
  margin-bottom: 10px;
}

.node-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.node-card__index {
  font-weight: 600;
  font-size: 13px;
}
</style>
