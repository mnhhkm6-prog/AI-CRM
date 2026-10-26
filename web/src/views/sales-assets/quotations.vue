<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">报价管理</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <ViewBar
            entity-type="quotation"
            :column-defs="COLUMN_DEFS"
            :filter-defs="filterDefs"
            :sort-defs="SORT_DEFS"
            default-view-name="我的报价视图"
            @apply="onViewApply"
          />
          <el-button v-if="canCreate" type="primary" @click="openCreate">新增报价</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.quotation_type" placeholder="报价类型" clearable style="width: 140px" @change="reload">
          <el-option v-for="o in QUOTATION_TYPES" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.product_type" placeholder="产品类型" clearable style="width: 150px" @change="reload">
          <el-option v-for="p in PRODUCT_TYPES" :key="p" :label="p" :value="p" />
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
        <el-input
          v-model="query.keyword"
          placeholder="商机名 / 客户名"
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
          :align="col.key === 'quotation_type' ? 'center' : col.key === 'amount' ? 'right' : undefined"
          :class-name="col.key === 'amount' ? 'num' : undefined"
          :show-overflow-tooltip="['product_type', 'opportunity_name', 'customer_name', 'file_name'].includes(col.key)"
        >
          <template #default="{ row }">
            <el-tag
              v-if="col.key === 'quotation_type'"
              size="small"
              :type="row.quotation_type === 'final' ? 'success' : 'info'"
              effect="plain"
            >
              {{ quotationTypeLabel(row.quotation_type) }}
            </el-tag>
            <template v-else-if="col.key === 'amount'">{{ money(row.amount) }}</template>
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
            <template v-else-if="col.key === 'file_name'">
              <el-link v-if="row.file_storage_id" type="primary" underline="never" @click="download(row)">
                {{ row.file_name || '下载附件' }}
              </el-link>
              <span v-else class="text-muted">—</span>
            </template>
            <template v-else-if="col.key === 'created_at'">{{ fmt(row.created_at) }}</template>
            <template v-else>{{ row[col.key] }}</template>
          </template>
        </el-table-column>
        <el-table-column label="审批状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="approvalTag(row.approval_status)" effect="plain">
              {{ approvalLabel(row.approval_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.approval_status === 'rejected'" link type="primary" @click="resubmit(row)">
              重新提交
            </el-button>
            <el-button v-if="canDelete" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无报价记录</div>
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

    <!-- 新增报价 -->
    <el-dialog v-model="dialog" title="新增报价" width="480px" align-center @closed="resetForm">
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
        <el-form-item label="报价类型" required>
          <el-select v-model="form.quotation_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="o in QUOTATION_TYPES" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="产品类型" required>
          <el-select v-model="form.product_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="p in PRODUCT_TYPES" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="报价金额" required>
          <el-input-number v-model="form.amount" :min="0" :controls="false" placeholder="请输入金额" style="width: 100%" />
        </el-form-item>
        <el-form-item label="报价附件">
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
              <div class="el-upload__tip">可选，单个文件，大小不超过 50MB</div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" show-word-limit />
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
import { PRODUCT_TYPES } from '@/config/options'

const QUOTATION_TYPES = [
  { label: '初步报价', value: 'preliminary' },
  { label: '最终报价', value: 'final' },
]

const router = useRouter()
const userStore = useUserStore()

/** 可配置列（P42 视图配置） */
const COLUMN_DEFS: ViewColumnDef[] = [
  { key: 'quotation_type', label: '报价类型', width: 110 },
  { key: 'product_type', label: '产品类型', width: 130 },
  { key: 'amount', label: '报价金额', width: 140 },
  { key: 'opportunity_name', label: '所属商机', minWidth: 160 },
  { key: 'customer_name', label: '客户', minWidth: 150 },
  { key: 'file_name', label: '附件', minWidth: 160 },
  { key: 'uploaded_by_name', label: '报价人', width: 100 },
  { key: 'created_at', label: '报价时间', width: 150 },
]

/** 后端可排序字段（m5-sales-assets.js: buildSort(['created_at', 'amount'])） */
const SORT_DEFS: ViewColumnDef[] = [
  { key: 'created_at', label: '报价时间' },
  { key: 'amount', label: '报价金额' },
]

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const oppLoading = ref(false)
const oppOptions = ref<any[]>([])

const dialog = ref(false)
const uploadRef = ref<any>(null)
const file = ref<File | null>(null)

const query = reactive({
  quotation_type: '',
  product_type: '',
  opportunity_id: '',
  keyword: '',
  sort: '',
  order: 'desc',
  page: 1,
  page_size: 20,
})
const form = reactive<any>({ opportunity_id: '', quotation_type: 'preliminary', product_type: '', amount: undefined, remark: '' })

/** 视图默认筛选可配置项（仅后端支持的查询参数） */
const filterDefs = computed<ViewFilterDef[]>(() => [
  { key: 'quotation_type', label: '报价类型', type: 'select', options: QUOTATION_TYPES },
  { key: 'product_type', label: '产品类型', type: 'select', options: PRODUCT_TYPES.map((p) => ({ label: p, value: p })) },
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

const canCreate = computed(() => userStore.hasPerm('quotation:create'))
const canDelete = computed(() => userStore.hasPerm('quotation:delete'))
const scopeText = computed(() => userStore.scopeBadge('quotation'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function money(v?: number | string | null) {
  return Number(v || 0).toLocaleString('zh-CN')
}

function quotationTypeLabel(t?: string) {
  return t === 'final' ? '最终报价' : '初步报价'
}

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

const APPROVAL_LABEL: Record<string, string> = {
  none: '无需审批',
  pending: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  canceled: '已撤回',
}
const APPROVAL_TAG: Record<string, TagType> = {
  none: 'info',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  canceled: 'info',
}

function approvalLabel(s?: string) {
  return APPROVAL_LABEL[s || 'none'] || s || '无需审批'
}

function approvalTag(s?: string): TagType {
  return APPROVAL_TAG[s || 'none'] || 'info'
}

async function resubmit(row: any) {
  await ElMessageBox.confirm('确认按当前报价数据重新提交审批？', '重新提交', { type: 'warning' })
  const res = await api.resubmitApproval('quotation', row.id)
  if (res && res.submitted === false) ElMessage.warning(res.message || '当前数据未命中审批条件')
  else ElMessage.success('已重新提交审批')
  await load()
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

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['quotation_type', 'product_type', 'opportunity_id', 'keyword'].forEach((k) => {
      const v = (query as any)[k]
      if (v) params[k] = v
    })
    if (query.sort) {
      params.sort = query.sort
      params.order = query.order
    }
    const res = await api.listAllQuotations(params)
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
  Object.assign(query, { quotation_type: '', product_type: '', opportunity_id: '', keyword: '', page: 1 })
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
  Object.assign(form, { opportunity_id: '', quotation_type: 'preliminary', product_type: '', amount: undefined, remark: '' })
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
  if (!form.quotation_type) {
    ElMessage.warning('请选择报价类型')
    return
  }
  if (!form.product_type) {
    ElMessage.warning('请选择产品类型')
    return
  }
  if (!form.amount || Number(form.amount) <= 0) {
    ElMessage.warning('报价金额必须大于 0')
    return
  }
  submitting.value = true
  try {
    const body: Record<string, any> = {
      quotation_type: form.quotation_type,
      amount: Number(form.amount),
      product_type: form.product_type,
      remark: form.remark || undefined,
    }
    if (file.value) {
      const uploaded = (await api.uploadFile(file.value)) as any
      body.file_storage_id = uploaded.file_storage_id
    }
    await api.createQuotation(form.opportunity_id, body)
    ElMessage.success('报价已创建')
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
  await ElMessageBox.confirm(`确认删除该报价（${quotationTypeLabel(row.quotation_type)} · ${money(row.amount)}）？`, '删除确认', {
    type: 'warning',
  })
  await api.deleteQuotation(row.id)
  ElMessage.success('已删除')
  await load()
}
</script>
