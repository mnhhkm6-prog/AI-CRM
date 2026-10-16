<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">行为记录</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <ViewBar
            entity-type="activity"
            :column-defs="COLUMN_DEFS"
            :filter-defs="filterDefs"
            :sort-defs="SORT_DEFS"
            default-view-name="我的行为记录视图"
            @apply="onViewApply"
          />
          <el-button v-if="canCreate" type="primary" @click="openCreate">新增行为</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.activity_type" placeholder="行为类型" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in ACTIVITY_TYPES" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select
          v-model="query.customer_id"
          placeholder="关联客户"
          clearable
          filterable
          remote
          :remote-method="searchCustomers"
          :loading="customerLoading"
          style="width: 200px"
          @change="reload"
        >
          <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="query.created_by" placeholder="记录人" clearable filterable style="width: 170px" @change="reload">
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
        <el-input
          v-model="query.keyword"
          placeholder="内容关键字"
          clearable
          style="width: 180px"
          @keyup.enter="reload"
          @clear="reload"
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
            <template v-if="col.key === 'activity_time'">{{ fmt(row.activity_time) }}</template>
            <el-tag v-else-if="col.key === 'activity_type'" size="small" effect="plain">{{ row.activity_type }}</el-tag>
            <template v-else-if="col.key === 'customer_name'">
              <el-link v-if="row.customer_id" type="primary" underline="never" @click="goCustomer(row)">
                {{ row.customer_name || '查看客户' }}
              </el-link>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else-if="col.key === 'opportunity_name'">
              <el-link v-if="row.opportunity_id" type="primary" underline="never" @click="goOpportunity(row)">
                {{ row.opportunity_name || '查看商机' }}
              </el-link>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else-if="col.key === 'follow_up_time'">{{ row.follow_up_time ? String(row.follow_up_time).slice(0, 10) : '—' }}</template>
            <template v-else>{{ cellText(row[col.key]) }}</template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canUpdate" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="canDelete" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无行为记录</div>
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

    <ActivityDrawer v-model="drawer" :record="editing" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import ActivityDrawer from '@/components/ActivityDrawer.vue'
import ViewBar, { type ViewApplyState, type ViewColumnDef, type ViewFilterDef } from '@/components/ViewBar.vue'
import { ACTIVITY_TYPES, loadOwnerOptions, type Option } from '@/config/options'

const router = useRouter()
const userStore = useUserStore()

/** 可配置列（P42 视图配置）；align / tooltip 仅用于还原原有表格渲染 */
interface ListColumnDef extends ViewColumnDef {
  align?: 'left' | 'center' | 'right'
  tooltip?: boolean
}

const COLUMN_DEFS: ListColumnDef[] = [
  { key: 'activity_time', label: '时间', width: 150 },
  { key: 'activity_type', label: '类型', width: 100, align: 'center' },
  { key: 'content', label: '内容摘要', minWidth: 220, tooltip: true },
  { key: 'customer_name', label: '关联客户', minWidth: 150, tooltip: true },
  { key: 'opportunity_name', label: '关联商机', minWidth: 150, tooltip: true },
  { key: 'creator_name', label: '记录人', width: 100 },
  { key: 'follow_up_time', label: '下次回访', width: 120 },
]

/** 后端可排序字段（m4-activities.js SORTABLE） */
const SORT_DEFS: ViewColumnDef[] = [
  { key: 'activity_time', label: '行为时间' },
  { key: 'created_at', label: '创建时间' },
]

const loading = ref(false)
const customerLoading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const owners = ref<Option[]>([])
const customerOptions = ref<any[]>([])
const dateRange = ref<[string, string] | null>(null)

const drawer = ref(false)
const editing = ref<any>(null)

const query = reactive({
  activity_type: '', customer_id: '', created_by: '', keyword: '',
  sort: '', order: 'desc', page: 1, page_size: 20,
})

/** 视图默认筛选可配置项（仅后端支持的查询参数） */
const filterDefs = computed<ViewFilterDef[]>(() => [
  { key: 'activity_type', label: '行为类型', type: 'select', options: ACTIVITY_TYPES },
  { key: 'created_by', label: '记录人', type: 'select', options: owners.value },
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

const canCreate = computed(() => userStore.hasPerm('activity:create'))
const canUpdate = computed(() => userStore.hasPerm('activity:update'))
const canDelete = computed(() => userStore.hasPerm('activity:delete'))
const scopeText = computed(() => userStore.scopeBadge('activity'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

async function searchCustomers(keyword: string) {
  if (!keyword) return
  customerLoading.value = true
  try {
    const res = await api.listCustomers({ keyword, page_size: 20 })
    customerOptions.value = res.list || []
  } finally {
    customerLoading.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['activity_type', 'customer_id', 'created_by', 'keyword'].forEach((k) => {
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
    const res = await api.listActivities(params)
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
  Object.assign(query, { activity_type: '', customer_id: '', created_by: '', keyword: '', page: 1 })
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

function openCreate() {
  editing.value = null
  drawer.value = true
}

function openEdit(row: any) {
  editing.value = row
  drawer.value = true
}

function goCustomer(row: any) {
  router.push(`/customers/${row.customer_id}`)
}

function goOpportunity(row: any) {
  router.push(`/opportunities/${row.opportunity_id}`)
}

async function remove(row: any) {
  await ElMessageBox.confirm('确认删除该行为记录？', '删除确认', { type: 'warning' })
  await api.deleteActivity(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
})
</script>
