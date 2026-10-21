<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">线索管理</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <ViewBar
            entity-type="lead"
            :column-defs="COLUMN_DEFS"
            :filter-defs="filterDefs"
            :sort-defs="SORT_DEFS"
            default-view-name="我的线索视图"
            @apply="onViewApply"
          />
          <el-button v-if="canCreate" type="primary" @click="goCreate">新建线索</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-input
          v-model="query.keyword"
          placeholder="线索名称 / 客户名称 / 联系人 / 电话 / 微信"
          clearable
          style="width: 220px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <el-select v-model="query.status" placeholder="线索状态" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in LEAD_STATUS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.source_channel" placeholder="来源渠道" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in SOURCE_CHANNELS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="录入开始"
          end-placeholder="录入结束"
          style="width: 260px"
          @change="reload"
        />
        <el-select v-model="query.owner_id" placeholder="负责人" clearable filterable style="width: 170px" @change="reload">
          <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <div class="filter-bar__spacer" />
        <el-button @click="reset">重置</el-button>
        <el-button @click="load">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column
          v-for="col in tableColumns"
          :key="col.key"
          :label="col.label"
          :width="col.width"
          :min-width="col.minWidth"
          :align="col.align"
          :show-overflow-tooltip="col.tooltip"
        >
          <template #default="{ row }">
            <el-link
              v-if="col.key === 'name'"
              type="primary"
              underline="never"
              @click="goDetail(row)"
            >{{ row.name }}</el-link>
            <el-tag
              v-else-if="col.key === 'status'"
              size="small"
              :type="statusTagType(row.status)"
              effect="plain"
            >{{ statusLabel(row.status) }}</el-tag>
            <template v-else-if="col.key === 'linked_customer_name'">
              <el-link v-if="row.customer_id" type="primary" underline="never" @click="goCustomer(row)">{{ row.linked_customer_name || '查看客户' }}</el-link>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else-if="col.key === 'created_at'">{{ fmt(row.created_at) }}</template>
            <template v-else>{{ cellText(row[col.key]) }}</template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row)">查看</el-button>
            <el-button v-if="canUpdate" link type="primary" @click="goEdit(row)">编辑</el-button>
            <el-dropdown trigger="click" @command="(c: string) => onCommand(c, row)">
              <el-button link type="primary">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="canAssign" command="assign">分配给销售</el-dropdown-item>
                  <el-dropdown-item v-if="canConvertCustomer && !row.customer_id" command="to-customer">转客户</el-dropdown-item>
                  <el-dropdown-item v-if="canConvert && !row.opportunity_id" command="convert">转商机</el-dropdown-item>
                  <el-dropdown-item v-if="canRecycle && !row.is_in_sea" command="recycle">回收至公海</el-dropdown-item>
                  <el-dropdown-item v-if="canDelete && !row.opportunity_id" command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无线索数据</div>
        </template>
      </el-table>

      <el-pagination
        v-if="total > 0"
        class="mt-12"
        layout="total, sizes, prev, pager, next"
        :total="total"
        :page-size="query.page_size"
        :current-page="query.page"
        :page-sizes="[20, 50, 100]"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <!-- 分配给销售（M2-R3） -->
    <el-dialog v-model="assignDialog" title="分配给销售" width="420px">
      <el-form label-width="80px">
        <el-form-item label="线索">{{ current?.name }}</el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="assignOwnerId" filterable placeholder="请选择负责人" style="width: 100%">
            <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmAssign">确认分配</el-button>
      </template>
    </el-dialog>

    <!-- 转客户 -->
    <el-dialog v-model="customerDialog" title="线索转客户" width="480px">
      <el-form label-width="100px">
        <el-form-item label="线索">{{ current?.name }}</el-form-item>
        <el-form-item label="客户名称" required>
          <el-input v-model="customerForm.customer_name" maxlength="80" placeholder="请输入客户名称" />
        </el-form-item>
        <el-form-item label="来源渠道" required>
          <el-select v-model="customerForm.source_channel" placeholder="请选择来源渠道" style="width: 100%">
            <el-option v-for="o in SOURCE_CHANNELS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="客户负责人">
          <el-select v-model="customerForm.owner_id" filterable placeholder="默认使用线索负责人" style="width: 100%">
            <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="联系人">
          <span class="text-muted">
            {{ current?.contact_name || '—' }} {{ current?.contact_phone || current?.wechat || '' }}
            （将自动写入客户主联系人）
          </span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="customerDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmConvertCustomer">确认转客户</el-button>
      </template>
    </el-dialog>

    <!-- 转商机（M2-R4） -->
    <el-dialog v-model="convertDialog" title="线索转商机" width="480px">
      <el-form label-width="100px">
        <el-form-item label="线索">{{ current?.name }}</el-form-item>
        <el-form-item label="关联客户" required>
          <el-select
            v-model="convertForm.customer_id"
            filterable
            remote
            :remote-method="searchCustomers"
            :loading="customerLoading"
            placeholder="搜索并选择客户"
            style="width: 100%"
          >
            <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="商机名称">
          <el-input v-model="convertForm.opportunity_name" :placeholder="`默认：${current?.name} 商机`" maxlength="80" />
        </el-form-item>
        <el-form-item label="预计金额">
          <el-input-number v-model="convertForm.amount" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="convertDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmConvert">确认转商机</el-button>
      </template>
    </el-dialog>

    <!-- 回收至公海（M2-R5） -->
    <el-dialog v-model="recycleDialog" title="线索回收至公海" width="420px">
      <p class="text-muted">线索「{{ current?.name }}」将回收至公海池。</p>
      <el-input v-model="recycleReason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写回收原因（必填）" />
      <template #footer>
        <el-button @click="recycleDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmRecycle">确认回收</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import ViewBar, { type ViewApplyState, type ViewColumnDef, type ViewFilterDef } from '@/components/ViewBar.vue'
import { LEAD_STATUS, SOURCE_CHANNELS, loadOwnerOptions, type Option } from '@/config/options'

const router = useRouter()
const userStore = useUserStore()

/** 可配置列（P42 视图配置）；align / tooltip 仅用于还原原有表格渲染 */
interface ListColumnDef extends ViewColumnDef {
  align?: 'left' | 'center' | 'right'
  tooltip?: boolean
}

const COLUMN_DEFS: ListColumnDef[] = [
  { key: 'name', label: '线索名称', minWidth: 180, tooltip: true },
  { key: 'customer_name', label: '客户名称', minWidth: 160, tooltip: true },
  { key: 'contact_name', label: '联系人', width: 100 },
  { key: 'contact_phone', label: '联系电话', width: 130 },
  { key: 'wechat', label: '微信号', width: 130 },
  { key: 'source_channel', label: '来源渠道', width: 110 },
  { key: 'status', label: '状态', width: 100, align: 'center' },
  { key: 'owner_name', label: '负责人', width: 100 },
  { key: 'linked_customer_name', label: '关联客户', minWidth: 140, tooltip: true },
  { key: 'created_at', label: '录入时间', width: 150 },
]

/** 后端可排序字段（m2-leads.js SORTABLE） */
const SORT_DEFS: ViewColumnDef[] = [
  { key: 'created_at', label: '创建时间' },
  { key: 'updated_at', label: '更新时间' },
  { key: 'name', label: '线索名称' },
]

const loading = ref(false)
const submitting = ref(false)
const customerLoading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const owners = ref<Option[]>([])
const dateRange = ref<[string, string] | null>(null)

const query = reactive({
  keyword: '', status: '', source_channel: '', owner_id: '',
  sort: '', order: 'desc', page: 1, page_size: 20,
})

/** 视图默认筛选可配置项（仅后端支持的查询参数） */
const filterDefs = computed<ViewFilterDef[]>(() => [
  { key: 'status', label: '线索状态', type: 'select', options: LEAD_STATUS },
  { key: 'source_channel', label: '来源渠道', type: 'select', options: SOURCE_CHANNELS },
  { key: 'owner_id', label: '负责人', type: 'select', options: owners.value },
])

/** 当前视图可见列（按视图配置顺序） */
const visibleKeys = ref<string[]>(COLUMN_DEFS.map((c) => c.key))
const tableColumns = computed<ListColumnDef[]>(() => {
  const map = new Map(COLUMN_DEFS.map((c) => [c.key, c]))
  const picked = visibleKeys.value.map((k) => map.get(k)).filter(Boolean) as ListColumnDef[]
  return picked.length ? picked : COLUMN_DEFS
})

function onViewApply(state: ViewApplyState) {
  visibleKeys.value = state.columns
  query.page_size = state.page_size
  query.page = 1
  Object.keys(state.default_filter || {}).forEach((k) => {
    if (k in query) (query as any)[k] = state.default_filter[k]
  })
  const sort = state.default_sort
  query.sort = sort?.field && SORT_DEFS.some((s) => s.key === sort.field) ? sort.field : ''
  query.order = sort?.order === 'asc' ? 'asc' : 'desc'
  load()
}

function cellText(v: any) {
  return v === null || v === undefined || v === '' ? '—' : String(v)
}

const canCreate = computed(() => userStore.hasPerm('lead:create'))
const canUpdate = computed(() => userStore.hasPerm('lead:update'))
const canDelete = computed(() => userStore.hasPerm('lead:delete'))
const canAssign = computed(() => userStore.hasPerm('lead:assign'))
const canConvert = computed(() => userStore.hasPerm('lead:convert'))
const canConvertCustomer = computed(() => userStore.hasPerm('customer:create'))
const canRecycle = computed(() => userStore.hasPerm('lead:recycle'))
const scopeText = computed(() => userStore.scopeBadge('lead'))

const current = ref<any>(null)
const assignDialog = ref(false)
const assignOwnerId = ref('')
const customerDialog = ref(false)
const customerForm = reactive<{ customer_name: string; source_channel: string; owner_id: string }>({
  customer_name: '', source_channel: '', owner_id: '',
})
const convertDialog = ref(false)
const convertForm = reactive<{ customer_id: string; opportunity_name: string; amount: number }>({
  customer_id: '', opportunity_name: '', amount: 0,
})
const customerOptions = ref<any[]>([])
const recycleDialog = ref(false)
const recycleReason = ref('')

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function statusLabel(s?: string) {
  return { new: '新建', following: '跟进中', converted: '已转商机', recycled: '已回收' }[s || ''] || s || '—'
}

function statusTagType(s?: string) {
  return { new: 'info', following: 'primary', converted: 'success', recycled: 'warning' }[s || ''] || 'info'
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['keyword', 'status', 'source_channel', 'owner_id'].forEach((k) => {
      const v = (query as any)[k]
      if (v) params[k] = v
    })
    if (dateRange.value) {
      params.start_date = dateRange.value[0]
      params.end_date = dateRange.value[1]
    }
    if (query.sort) {
      params.sort = query.sort
      params.order = query.order
    }
    const res = await api.listLeads(params)
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
  Object.assign(query, { keyword: '', status: '', source_channel: '', owner_id: '', page: 1 })
  dateRange.value = null
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

function goCreate() {
  router.push('/leads/new')
}

function goEdit(row: any) {
  router.push(`/leads/${row.id}/edit`)
}

function goDetail(row: any) {
  router.push(`/leads/${row.id}`)
}

function goCustomer(row: any) {
  router.push(`/customers/${row.customer_id}`)
}

function onCommand(cmd: string, row: any) {
  current.value = row
  if (cmd === 'assign') {
    assignOwnerId.value = row.owner_id || ''
    assignDialog.value = true
  } else if (cmd === 'to-customer') openCustomerConvert(row)
  else if (cmd === 'convert') openConvert(row)
  else if (cmd === 'recycle') {
    recycleReason.value = ''
    recycleDialog.value = true
  } else if (cmd === 'delete') remove(row)
}

async function confirmAssign() {
  if (!assignOwnerId.value) {
    ElMessage.warning('请选择负责人')
    return
  }
  submitting.value = true
  try {
    await api.assignLead(current.value.id, assignOwnerId.value)
    ElMessage.success('已分配')
    assignDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function searchCustomers(keyword: string) {
  customerLoading.value = true
  try {
    const res = await api.listCustomers({ keyword, page_size: 20 })
    customerOptions.value = res.list || []
  } finally {
    customerLoading.value = false
  }
}

function openCustomerConvert(row: any) {
  customerForm.customer_name = row.customer_name || ''
  customerForm.source_channel = row.source_channel || ''
  customerForm.owner_id = row.owner_id || ''
  customerDialog.value = true
}

async function confirmConvertCustomer() {
  if (!customerForm.customer_name.trim()) {
    ElMessage.warning('请输入客户名称')
    return
  }
  if (!customerForm.source_channel) {
    ElMessage.warning('请选择来源渠道')
    return
  }
  submitting.value = true
  try {
    const res = await api.convertLeadToCustomer(current.value.id, {
      customer_name: customerForm.customer_name.trim(),
      source_channel: customerForm.source_channel,
      owner_id: customerForm.owner_id || undefined,
    })
    ElMessage.success(`已转为客户「${res.customer?.name || customerForm.customer_name}」`)
    customerDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function openConvert(row: any) {
  convertForm.customer_id = row.customer_id || ''
  convertForm.opportunity_name = ''
  convertForm.amount = 0
  customerOptions.value = []
  convertDialog.value = true
  if (row.customer_id) {
    try {
      const c = await api.getCustomer(row.customer_id)
      customerOptions.value = [{ id: c.id, name: c.name }]
    } catch (e) {
      /* 无客户查看权限时保持空选项 */
    }
  }
}

async function confirmConvert() {
  if (!convertForm.customer_id) {
    ElMessage.warning('请选择关联客户')
    return
  }
  submitting.value = true
  try {
    const res = await api.convertLead(current.value.id, {
      customer_id: convertForm.customer_id,
      opportunity_name: convertForm.opportunity_name || undefined,
      amount: convertForm.amount,
    })
    ElMessage.success('已转为商机')
    convertDialog.value = false
    await load()
    if (res.opportunity_id) router.push(`/opportunities/${res.opportunity_id}`)
  } finally {
    submitting.value = false
  }
}

async function confirmRecycle() {
  if (!recycleReason.value.trim()) {
    ElMessage.warning('请填写回收原因')
    return
  }
  submitting.value = true
  try {
    await api.recycleLead(current.value.id, recycleReason.value.trim())
    ElMessage.success('已回收至公海')
    recycleDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除线索「${row.name}」？`, '删除确认', { type: 'warning' })
  await api.deleteLead(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
})
</script>
