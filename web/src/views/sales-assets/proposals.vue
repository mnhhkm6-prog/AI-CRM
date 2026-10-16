<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">方案管理</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <ViewBar
            entity-type="proposal"
            :column-defs="COLUMN_DEFS"
            :filter-defs="filterDefs"
            :sort-defs="SORT_DEFS"
            default-view-name="我的方案视图"
            @apply="onViewApply"
          />
          <el-button v-if="canCreate" type="primary" @click="openCreate">上传方案</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.proposal_type" placeholder="方案类型" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in PROPOSAL_TYPES" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select
          v-model="query.opportunity_id"
          placeholder="关联商机"
          clearable
          filterable
          remote
          :remote-method="searchOpportunities"
          :loading="oppLoading"
          style="width: 220px"
          @change="reload"
        >
          <el-option v-for="o in oppOptions" :key="o.id" :label="o.name" :value="o.id" />
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
        <el-input
          v-model="query.keyword"
          placeholder="附件名 / 商机名 / 客户名"
          clearable
          style="width: 200px"
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
          :align="col.key === 'proposal_type' || col.key === 'version' ? 'center' : undefined"
          :show-overflow-tooltip="['file_name', 'opportunity_name', 'customer_name'].includes(col.key)"
        >
          <template #default="{ row }">
            <el-tag
              v-if="col.key === 'proposal_type'"
              size="small"
              :type="row.proposal_type === 'formal' ? 'success' : 'info'"
              effect="plain"
            >
              {{ proposalTypeLabel(row.proposal_type) }}
            </el-tag>
            <template v-else-if="col.key === 'file_name'">
              <el-link v-if="row.file_storage_id" type="primary" underline="never" @click="download(row)">
                {{ row.file_name || '下载附件' }}
              </el-link>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else-if="col.key === 'opportunity_name'">
              <el-link v-if="row.opportunity_id" type="primary" underline="never" @click="goOpportunity(row)">
                {{ row.opportunity_name || '查看商机' }}
              </el-link>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else-if="col.key === 'customer_name'">
              <el-link v-if="row.customer_id" type="primary" underline="never" @click="goCustomer(row)">
                {{ row.customer_name || '查看客户' }}
              </el-link>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else-if="col.key === 'created_at'">{{ fmt(row.created_at) }}</template>
            <template v-else>{{ row[col.key] }}</template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canDelete" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无方案记录</div>
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
    </div>

    <!-- 上传方案 -->
    <el-dialog v-model="dialog" title="上传方案" width="480px" align-center @closed="resetForm">
      <el-form label-width="90px">
        <el-form-item label="关联商机" required>
          <el-select
            v-model="form.opportunity_id"
            placeholder="搜索并选择商机"
            filterable
            remote
            :remote-method="searchOpportunities"
            :loading="oppLoading"
            style="width: 100%"
          >
            <el-option v-for="o in oppOptions" :key="o.id" :label="o.name" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="方案类型" required>
          <el-select v-model="form.proposal_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="o in PROPOSAL_TYPES" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="方案附件" required>
          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            :on-change="onFileChange"
            :on-remove="onFileRemove"
            :on-exceed="onFileExceed"
          >
            <el-button>选择文件</el-button>
            <template #tip>
              <div class="el-upload__tip">单个文件，大小不超过 50MB</div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmCreate">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import ViewBar, { type ViewApplyState, type ViewColumnDef, type ViewFilterDef } from '@/components/ViewBar.vue'

const PROPOSAL_TYPES = [
  { label: '初步方案', value: 'preliminary' },
  { label: '正式方案', value: 'formal' },
]

const router = useRouter()
const userStore = useUserStore()

/** 可配置列（P42 视图配置） */
const COLUMN_DEFS: ViewColumnDef[] = [
  { key: 'proposal_type', label: '方案类型', width: 110 },
  { key: 'file_name', label: '附件', minWidth: 200 },
  { key: 'opportunity_name', label: '所属商机', minWidth: 160 },
  { key: 'customer_name', label: '客户', minWidth: 150 },
  { key: 'version', label: '版本', width: 80 },
  { key: 'uploaded_by_name', label: '上传人', width: 100 },
  { key: 'created_at', label: '上传时间', width: 150 },
]

/** 后端可排序字段（m5-sales-assets.js: buildSort(['created_at'])） */
const SORT_DEFS: ViewColumnDef[] = [{ key: 'created_at', label: '上传时间' }]

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const oppLoading = ref(false)
const customerLoading = ref(false)
const oppOptions = ref<any[]>([])
const customerOptions = ref<any[]>([])

const dialog = ref(false)
const uploadRef = ref<any>(null)
const file = ref<File | null>(null)

const query = reactive({
  proposal_type: '',
  opportunity_id: '',
  customer_id: '',
  keyword: '',
  sort: '',
  order: 'desc',
  page: 1,
  page_size: 20,
})
const form = reactive({ opportunity_id: '', proposal_type: 'preliminary' })

/** 视图默认筛选可配置项（仅后端支持的查询参数） */
const filterDefs = computed<ViewFilterDef[]>(() => [
  { key: 'proposal_type', label: '方案类型', type: 'select', options: PROPOSAL_TYPES },
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

const canCreate = computed(() => userStore.hasPerm('proposal:create'))
const canDelete = computed(() => userStore.hasPerm('proposal:delete'))
const scopeText = computed(() => userStore.scopeBadge('proposal'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function proposalTypeLabel(t?: string) {
  return t === 'formal' ? '正式方案' : '初步方案'
}

async function searchOpportunities(keyword: string) {
  if (!keyword) return
  oppLoading.value = true
  try {
    const res = await api.listOpportunities({ keyword, page_size: 20 })
    oppOptions.value = res.list || []
  } finally {
    oppLoading.value = false
  }
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
    ;['proposal_type', 'opportunity_id', 'customer_id', 'keyword'].forEach((k) => {
      const v = (query as any)[k]
      if (v) params[k] = v
    })
    if (query.sort) {
      params.sort = query.sort
      params.order = query.order
    }
    const res = await api.listAllProposals(params)
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
  Object.assign(query, { proposal_type: '', opportunity_id: '', customer_id: '', keyword: '', page: 1 })
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
  form.opportunity_id = ''
  form.proposal_type = 'preliminary'
  file.value = null
  dialog.value = true
  nextTick(() => uploadRef.value?.clearFiles())
}

function resetForm() {
  file.value = null
  uploadRef.value?.clearFiles()
}

function onFileChange(uf: any) {
  file.value = uf?.raw || null
}

function onFileRemove() {
  file.value = null
}

function onFileExceed() {
  ElMessage.warning('只能上传一个文件，请先移除已选文件')
}

async function confirmCreate() {
  if (!form.opportunity_id) {
    ElMessage.warning('请选择关联商机')
    return
  }
  if (!form.proposal_type) {
    ElMessage.warning('请选择方案类型')
    return
  }
  if (!file.value) {
    ElMessage.warning('请选择方案附件')
    return
  }
  submitting.value = true
  try {
    const uploaded = (await api.uploadFile(file.value)) as any
    await api.createProposal(form.opportunity_id, {
      proposal_type: form.proposal_type,
      file_storage_id: uploaded.file_storage_id,
    })
    ElMessage.success('方案已上传')
    dialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

function download(row: any) {
  api.downloadFile(row.file_storage_id, row.file_name)
}

function goOpportunity(row: any) {
  router.push(`/opportunities/${row.opportunity_id}`)
}

function goCustomer(row: any) {
  router.push(`/customers/${row.customer_id}`)
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除方案「${row.file_name || proposalTypeLabel(row.proposal_type)}」？`, '删除确认', {
    type: 'warning',
  })
  await api.deleteProposal(row.id)
  ElMessage.success('已删除')
  await load()
}
</script>
