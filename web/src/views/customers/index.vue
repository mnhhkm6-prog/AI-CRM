<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">客户管理</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <ViewBar
            entity-type="customer"
            :column-defs="COLUMN_DEFS"
            :filter-defs="filterDefs"
            :sort-defs="SORT_DEFS"
            default-view-name="我的客户视图"
            @apply="onViewApply"
          />
          <el-button v-if="canCreate" type="primary" @click="goCreate">新建客户</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-input
          v-model="query.keyword"
          placeholder="客户名称 / 信用代码 / 地址"
          clearable
          style="width: 220px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <el-select v-model="query.status" placeholder="客户状态" clearable style="width: 130px" @change="reload">
          <el-option v-for="o in CUSTOMER_STATUS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.level" placeholder="客户等级" clearable style="width: 120px" @change="reload">
          <el-option v-for="o in CUSTOMER_LEVELS" :key="o.value" :label="`${o.label} 级`" :value="o.value" />
        </el-select>
        <el-select v-model="query.industry" placeholder="所属行业" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in CUSTOMER_INDUSTRIES" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button text type="primary" @click="more = !more">{{ more ? '收起筛选' : '更多筛选' }}</el-button>
        <div class="filter-bar__spacer" />
        <el-button @click="reset">重置</el-button>
        <el-button @click="load">刷新</el-button>
      </div>

      <div v-if="more" class="filter-bar">
        <el-select v-model="query.scale" placeholder="客户规模" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in CUSTOMER_SCALES" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.source_channel" placeholder="来源渠道" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in SOURCE_CHANNELS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.owner_id" placeholder="负责人" clearable filterable style="width: 180px" @change="reload">
          <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.is_in_sea" placeholder="公海状态" clearable style="width: 130px" @change="reload">
          <el-option label="非公海" value="false" />
          <el-option label="公海中" value="true" />
        </el-select>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column
          v-for="col in tableColumns"
          :key="col.key"
          :label="col.label"
          :width="col.width"
          :min-width="col.minWidth"
          :show-overflow-tooltip="col.key !== 'name'"
        >
          <template #default="{ row }">
            <el-link
              v-if="col.key === 'name'"
              type="primary"
              underline="never"
              @click="goDetail(row)"
            >{{ row.name }}</el-link>
            <template v-else-if="col.key === 'level'">
              <el-tag v-if="row.level" size="small" effect="plain">{{ row.level }} 级</el-tag>
              <span v-else class="text-muted">—</span>
            </template>
            <el-tag
              v-else-if="col.key === 'status'"
              size="small"
              :type="statusTagType(row.status)"
              effect="plain"
            >{{ statusLabel(row.status) }}</el-tag>
            <template v-else-if="col.key === 'last_activity_at'">{{ fmt(row.last_activity_at || row.updated_at) }}</template>
            <template v-else>{{ cellText(row[col.key]) }}</template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row)">查看</el-button>
            <el-button v-if="canUpdate" link type="primary" @click="goEdit(row)">编辑</el-button>
            <el-dropdown v-if="canUpdate || canDelete" trigger="click" @command="(c: string) => onCommand(c, row)">
              <el-button link type="primary">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="canUpdate && !row.is_in_sea" command="sea">转公海</el-dropdown-item>
                  <el-dropdown-item v-if="canDelete" command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无客户数据</div>
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

    <!-- 转公海（M1-R6，需填写原因） -->
    <el-dialog v-model="seaDialog" title="客户转公海" width="420px">
      <p class="text-muted">
        客户「{{ current?.name }}」将转入公海池，其他销售可领取或由主管分配。
      </p>
      <el-input v-model="seaReason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写转公海原因（必填）" />
      <template #footer>
        <el-button @click="seaDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSea">确认转入公海</el-button>
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
import {
  CUSTOMER_INDUSTRIES,
  CUSTOMER_LEVELS,
  CUSTOMER_SCALES,
  CUSTOMER_STATUS,
  SOURCE_CHANNELS,
  loadOwnerOptions,
  type Option,
} from '@/config/options'

const router = useRouter()
const userStore = useUserStore()

/** 可配置列（P42 视图配置） */
const COLUMN_DEFS: ViewColumnDef[] = [
  { key: 'name', label: '客户名称', minWidth: 200 },
  { key: 'type', label: '类型', width: 80 },
  { key: 'industry', label: '行业', width: 100 },
  { key: 'scale', label: '规模', width: 90 },
  { key: 'level', label: '等级', width: 80 },
  { key: 'status', label: '状态', width: 90 },
  { key: 'source_channel', label: '来源渠道', width: 100 },
  { key: 'owner_name', label: '负责人', width: 100 },
  { key: 'last_activity_at', label: '最近跟进', width: 150 },
]

/** 后端可排序字段 */
const SORT_DEFS: ViewColumnDef[] = [
  { key: 'created_at', label: '创建时间' },
  { key: 'updated_at', label: '更新时间' },
  { key: 'name', label: '客户名称' },
  { key: 'last_activity_at', label: '最近跟进' },
]

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const more = ref(false)
const owners = ref<Option[]>([])

const query = reactive({
  keyword: '',
  status: '',
  level: '',
  industry: '',
  scale: '',
  source_channel: '',
  owner_id: '',
  is_in_sea: '',
  sort: '',
  order: 'desc',
  page: 1,
  page_size: 20,
})

/** 视图默认筛选可配置项 */
const filterDefs = computed<ViewFilterDef[]>(() => [
  { key: 'status', label: '客户状态', type: 'select', options: CUSTOMER_STATUS },
  { key: 'level', label: '客户等级', type: 'select', options: CUSTOMER_LEVELS },
  { key: 'industry', label: '所属行业', type: 'select', options: CUSTOMER_INDUSTRIES },
  { key: 'scale', label: '客户规模', type: 'select', options: CUSTOMER_SCALES },
  { key: 'source_channel', label: '来源渠道', type: 'select', options: SOURCE_CHANNELS },
  { key: 'owner_id', label: '负责人', type: 'select', options: owners.value },
])

/** 当前视图可见列（按视图配置顺序） */
const visibleKeys = ref<string[]>(COLUMN_DEFS.map((c) => c.key))
const tableColumns = computed(() => {
  const map = new Map(COLUMN_DEFS.map((c) => [c.key, c]))
  const picked = visibleKeys.value.map((k) => map.get(k)).filter(Boolean) as ViewColumnDef[]
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

const canCreate = computed(() => userStore.hasPerm('customer:create'))
const canUpdate = computed(() => userStore.hasPerm('customer:update'))
const canDelete = computed(() => userStore.hasPerm('customer:delete'))
const scopeText = computed(() => userStore.scopeBadge('customer'))

const seaDialog = ref(false)
const seaReason = ref('')
const current = ref<any>(null)

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function statusLabel(s?: string) {
  return { active: '活跃', sea: '公海', invalid: '无效' }[s || ''] || s || '—'
}

function statusTagType(s?: string) {
  return { active: 'success', sea: 'info', invalid: 'danger' }[s || ''] || 'info'
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['keyword', 'status', 'level', 'industry', 'scale', 'source_channel', 'owner_id', 'is_in_sea'].forEach((k) => {
      const v = (query as any)[k]
      if (v !== '' && v !== null && v !== undefined) params[k] = v
    })
    if (query.sort) {
      params.sort = query.sort
      params.order = query.order
    }
    const res = await api.listCustomers(params)
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
  Object.assign(query, {
    keyword: '', status: '', level: '', industry: '', scale: '',
    source_channel: '', owner_id: '', is_in_sea: '', page: 1,
  })
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
  router.push('/customers/new')
}

function goEdit(row: any) {
  router.push(`/customers/${row.id}/edit`)
}

function goDetail(row: any) {
  router.push(`/customers/${row.id}`)
}

function onCommand(cmd: string, row: any) {
  if (cmd === 'sea') openSea(row)
  else if (cmd === 'delete') remove(row)
}

function openSea(row: any) {
  current.value = row
  seaReason.value = ''
  seaDialog.value = true
}

async function confirmSea() {
  if (!seaReason.value.trim()) {
    ElMessage.warning('请填写转公海原因')
    return
  }
  submitting.value = true
  try {
    await api.releaseCustomerToSea(current.value.id, seaReason.value.trim())
    ElMessage.success('已转入公海池')
    seaDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除客户「${row.name}」？删除后可从数据库恢复。`, '删除确认', {
    type: 'warning',
  })
  await api.deleteCustomer(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
})
</script>
