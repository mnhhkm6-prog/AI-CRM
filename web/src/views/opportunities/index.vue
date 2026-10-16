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
        <el-select v-model="query.stage_config_id" placeholder="当前阶段" clearable style="width: 170px" @change="reload">
          <el-option v-for="s in stages" :key="s.id" :label="s.name" :value="s.id" />
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

    <OpportunityAdvanceDialog v-model="advanceDialog" :opportunity-id="currentId" @advanced="load" />
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
/** 停滞预警阈值默认值（全局兜底 7/14/21 天，PRD 4.6 / M11-R4） */
const THRESHOLDS = { level1: 7, level2: 14, level3: 21 }

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

const query = reactive({
  keyword: '', stage_config_id: '', status: '', owner_id: '',
  sort: '', order: 'desc', page: 1, page_size: 20,
})

/** 视图默认筛选可配置项（仅后端支持的查询参数） */
const filterDefs = computed<ViewFilterDef[]>(() => [
  { key: 'stage_config_id', label: '当前阶段', type: 'select', options: stages.value.map((s: any) => ({ label: s.name, value: s.id })) },
  { key: 'status', label: '商机状态', type: 'select', options: OPPORTUNITY_STATUS },
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
  if (d >= THRESHOLDS.level3) return 3
  if (d >= THRESHOLDS.level2) return 2
  if (d >= THRESHOLDS.level1) return 1
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
    stages.value = await api.stageOptions()
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
</style>
