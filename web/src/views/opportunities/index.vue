<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">商机列表</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button-group>
            <el-button type="primary" disabled>列表视图</el-button>
            <el-button @click="router.push('/funnel')">看板视图</el-button>
          </el-button-group>
          <ViewBar
            entity-type="opportunity"
            :column-defs="COLUMN_DEFS"
            :filter-defs="filterDefs"
            :sort-defs="SORT_DEFS"
            default-view-name="我的商机视图"
            @apply="onViewApply"
          />
          <el-button v-if="canCreate" type="primary" @click="router.push('/opportunities/new')">新建商机</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-input v-model="query.keyword" placeholder="商机名称" clearable style="width: 200px" @keyup.enter="reload" @clear="reload" />
        <el-select v-model="query.stage_config_id" placeholder="当前阶段" clearable style="width: 190px" @change="reload">
          <el-option v-for="s in stages" :key="s.id" :label="stageLabel(s)" :value="s.id" />
        </el-select>
        <el-select v-model="query.status" placeholder="商机状态" clearable style="width: 130px" @change="reload">
          <el-option v-for="o in OPPORTUNITY_STATUS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.owner_id" placeholder="负责人" clearable filterable style="width: 170px" @change="reload">
          <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 250px"
          @change="reload"
        />
        <div class="filter-bar__spacer" />
        <el-button @click="reset">重置</el-button>
        <el-button @click="load">刷新</el-button>
      </div>

      <div v-if="selectedIds.length" class="batch-bar">
        <span class="batch-bar__count">已选 {{ selectedIds.length }} 项</span>
        <el-button v-if="canUpdate" size="small" @click="transferDialog = true">批量转移</el-button>
        <el-button v-if="canUpdate" size="small" @click="batchRelease">批量转公海</el-button>
        <el-button v-if="canDelete" size="small" type="danger" @click="batchDelete">批量删除</el-button>
        <el-button size="small" link @click="clearSelection">取消选择</el-button>
      </div>

      <el-table ref="tableRef" v-loading="loading" :data="items" size="small" style="width: 100%" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="42" />
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
            <el-link
              v-else-if="col.key === 'customer_name'"
              type="primary"
              underline="never"
              @click="goCustomer(row)"
            >{{ row.customer_name || '—' }}</el-link>
            <template v-else-if="col.key === 'amount'">{{ Number(row.amount || 0).toLocaleString('zh-CN') }}</template>
            <el-tag
              v-else-if="col.key === 'status'"
              size="small"
              :type="statusTagType(row.status)"
              effect="plain"
            >{{ row.status }}</el-tag>
            <template v-else-if="col.key === 'stagnant_days'">
              <span v-if="stagnantDays(row) > 0" :class="['alert-dot', `alert-dot--${alertLevel(row)}`]">
                {{ stagnantDays(row) }} 天
              </span>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else>{{ cellText(row[col.key]) }}</template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row)">查看</el-button>
            <el-button v-if="canUpdate && row.status === '进行中'" link type="primary" @click="openAdvance(row)">推进</el-button>
            <el-dropdown v-if="canUpdate || canDelete" trigger="click" @command="(c: string) => onCommand(c, row)">
              <el-button link type="primary">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="canUpdate" command="edit">编辑</el-dropdown-item>
                  <el-dropdown-item v-if="canUpdate && row.status === '进行中'" command="loss">标记失败</el-dropdown-item>
                  <el-dropdown-item v-if="canDelete" command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无商机数据</div>
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

    <OpportunityAdvanceDialog v-model="advanceDialog" :opportunity-id="currentId" @advanced="load" @fill="onFill" />

    <el-dialog v-model="transferDialog" title="批量转移负责人" width="420px">
      <el-select v-model="batchOwnerId" filterable placeholder="选择新负责人" style="width: 100%">
        <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <p class="text-muted" style="margin: 8px 0 0">将选中的 {{ selectedIds.length }} 个商机转移给该负责人</p>
      <template #footer>
        <el-button @click="transferDialog = false">取消</el-button>
        <el-button type="primary" :loading="batchSubmitting" @click="batchTransfer">确认转移</el-button>
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
import OpportunityAdvanceDialog from '@/components/OpportunityAdvanceDialog.vue'
import ViewBar, { type ViewApplyState, type ViewColumnDef, type ViewFilterDef } from '@/components/ViewBar.vue'
import { OPPORTUNITY_STATUS, loadOwnerOptions, type Option } from '@/config/options'

const DAY = 86400000
/** 停滞预警阈值全局兜底（PRD 4.6 / M11-R4），阶段可单独配置 */
const DEFAULT_THRESHOLDS = { level1: 7, level2: 14, level3: 21 }

/** 读取阶段自定义阈值，未配置的级别回落全局 */
function thresholdsOf(stageId?: string) {
  const stage = stages.value.find((s: any) => s.id === stageId)
  const t = stage?.alert_thresholds || {}
  return {
    level1: Number(t.level1) || DEFAULT_THRESHOLDS.level1,
    level2: Number(t.level2) || DEFAULT_THRESHOLDS.level2,
    level3: Number(t.level3) || DEFAULT_THRESHOLDS.level3,
  }
}

const router = useRouter()
const userStore = useUserStore()

/** 可配置列（P42 视图配置）；align / tooltip 仅用于还原原有表格渲染 */
interface ListColumnDef extends ViewColumnDef {
  align?: 'left' | 'center' | 'right'
  tooltip?: boolean
}

const COLUMN_DEFS: ListColumnDef[] = [
  { key: 'name', label: '商机名称', minWidth: 180, tooltip: true },
  { key: 'customer_name', label: '客户', minWidth: 140, tooltip: true },
  { key: 'stage_name_snapshot', label: '当前阶段', width: 160, tooltip: true },
  { key: 'amount', label: '金额', width: 120, align: 'right' },
  { key: 'status', label: '状态', width: 90, align: 'center' },
  { key: 'stagnant_days', label: '停滞', width: 90, align: 'center' },
  { key: 'owner_name', label: '负责人', width: 100 },
  { key: 'expected_close_date', label: '预计成交', width: 110 },
]

/** 后端可排序字段（m3-opportunities.js SORTABLE） */
const SORT_DEFS: ViewColumnDef[] = [
  { key: 'created_at', label: '创建时间' },
  { key: 'updated_at', label: '更新时间' },
  { key: 'amount', label: '金额' },
  { key: 'stage_changed_at', label: '阶段变更时间' },
  { key: 'last_activity_at', label: '最近活动时间' },
]

const loading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const owners = ref<Option[]>([])
const stages = ref<any[]>([])
const dateRange = ref<[string, string] | null>(null)
const advanceDialog = ref(false)
const currentId = ref('')
const tableRef = ref<any>(null)
const selectedIds = ref<string[]>([])
const transferDialog = ref(false)
const batchOwnerId = ref('')
const batchSubmitting = ref(false)

const query = reactive({
  keyword: '', stage_config_id: '', status: '', owner_id: '',
  sort: '', order: 'desc', page: 1, page_size: 20,
})

/** 视图默认筛选可配置项（仅后端支持的查询参数） */
const filterDefs = computed<ViewFilterDef[]>(() => [
  { key: 'stage_config_id', label: '当前阶段', type: 'select', options: stages.value.map((s: any) => ({ label: stageLabel(s), value: s.id })) },
  { key: 'status', label: '商机状态', type: 'select', options: OPPORTUNITY_STATUS },
  { key: 'owner_id', label: '负责人', type: 'select', options: owners.value },
])

function stageLabel(s: any) {
  return s.is_enabled === 0 ? `${s.name}（已停用）` : s.name
}

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

const canCreate = computed(() => userStore.hasPerm('opportunity:create'))
const canUpdate = computed(() => userStore.hasPerm('opportunity:update'))
const canDelete = computed(() => userStore.hasPerm('opportunity:delete'))
const scopeText = computed(() => userStore.scopeBadge('opportunity'))

function stagnantDays(row: any) {
  if (row.status !== '进行中') return 0
  const base = row.last_activity_at || row.stage_changed_at || row.created_at
  if (!base) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(base).getTime()) / DAY))
}

function alertLevel(row: any) {
  const d = stagnantDays(row)
  const th = thresholdsOf(row.stage_config_id)
  if (d >= th.level3) return 3
  if (d >= th.level2) return 2
  if (d >= th.level1) return 1
  return 0
}

function statusTagType(s?: string) {
  return { 进行中: 'primary', 赢单: 'success', 失败: 'danger', 公海: 'info' }[s || ''] || 'info'
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['keyword', 'stage_config_id', 'status', 'owner_id'].forEach((k) => {
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
    const res = await api.listOpportunities(params)
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
  Object.assign(query, { keyword: '', stage_config_id: '', status: '', owner_id: '', page: 1 })
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

function goDetail(row: any) {
  router.push(`/opportunities/${row.id}`)
}

function goCustomer(row: any) {
  if (row.customer_id) router.push(`/customers/${row.customer_id}`)
}

function openAdvance(row: any) {
  currentId.value = row.id
  advanceDialog.value = true
}

function onSelectionChange(rows: any[]) {
  selectedIds.value = rows.map((r) => r.id)
}

function clearSelection() {
  selectedIds.value = []
  tableRef.value?.clearSelection?.()
}

/** 推进校验缺失项：自定义/内置字段跳编辑页，系统动作跳详情对应页签 */
function onFill(item: any) {
  const key = String(item?.field_key || '')
  advanceDialog.value = false
  if (key.startsWith('sys:')) {
    const tabMap: Record<string, string> = {
      'sys:activity': 'activity',
      'sys:activity_presales': 'activity',
      'sys:proposal_preliminary': 'proposal',
      'sys:proposal_formal': 'proposal',
      'sys:quotation': 'proposal',
      'sys:quotation_final': 'proposal',
      'sys:product_price': 'proposal',
      'sys:competitor': 'competitor',
      'sys:contract': 'contract',
      'sys:contract_amount': 'contract',
      'sys:contract_signed_date': 'contract',
    }
    router.push({ path: `/opportunities/${currentId.value}`, query: { tab: tabMap[key] || 'actions' } })
    return
  }
  router.push({ path: `/opportunities/${currentId.value}/edit`, query: { focus: key } })
}

async function runBatch(body: { action: string; owner_id?: string; reason?: string }) {
  batchSubmitting.value = true
  try {
    const res = await api.batchOpportunities({ ...body, ids: selectedIds.value })
    if (res.failed?.length) {
      ElMessage.warning(`成功 ${res.success.length} 个，失败 ${res.failed.length} 个：${res.failed[0].reason}`)
    } else {
      ElMessage.success(`已处理 ${res.success.length} 个商机`)
    }
    transferDialog.value = false
    clearSelection()
    await load()
  } finally {
    batchSubmitting.value = false
  }
}

async function batchTransfer() {
  if (!batchOwnerId.value) {
    ElMessage.warning('请选择新负责人')
    return
  }
  await runBatch({ action: 'transfer', owner_id: batchOwnerId.value })
}

async function batchRelease() {
  const { value } = await ElMessageBox.prompt('请输入转公海原因', '批量转公海', {
    inputPlaceholder: '如 长时间未跟进',
    inputValidator: (v) => (v && v.trim() ? true : '原因不能为空'),
  })
  await runBatch({ action: 'release_to_sea', reason: value.trim() })
}

async function batchDelete() {
  await ElMessageBox.confirm(`确认删除选中的 ${selectedIds.value.length} 个商机？`, '批量删除', { type: 'warning' })
  await runBatch({ action: 'delete' })
}

async function onCommand(cmd: string, row: any) {
  if (cmd === 'edit') {
    router.push(`/opportunities/${row.id}/edit`)
  } else if (cmd === 'delete') {
    await ElMessageBox.confirm(`确认删除商机「${row.name}」？`, '删除确认', { type: 'warning' })
    await api.deleteOpportunity(row.id)
    ElMessage.success('已删除')
    await load()
  } else if (cmd === 'loss') {
    router.push({ path: `/opportunities/${row.id}`, query: { action: 'loss' } })
  }
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  try {
    stages.value = await api.stageOptions(true)
  } catch (e) {
    stages.value = []
  }
})
</script>

<style scoped>
.alert-dot {
  display: inline-block;
  min-width: 46px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 20px;
  color: #fff;
}

.alert-dot--1 {
  background: var(--crm-alert-1);
}

.alert-dot--2 {
  background: var(--crm-alert-2);
}

.alert-dot--3 {
  background: var(--crm-alert-3);
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  padding: 8px 12px;
  border: 1px solid var(--crm-border);
  border-radius: 6px;
  background: var(--crm-bg-soft, #f7f8fa);
}

.batch-bar__count {
  font-size: 13px;
  color: var(--crm-text-secondary, #606266);
}
</style>
