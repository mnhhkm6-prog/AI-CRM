<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">失效记录</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.approval_status" placeholder="审批状态" clearable style="width: 130px" @change="reload">
          <el-option label="待审批" value="pending" />
          <el-option label="已通过" value="approved" />
          <el-option label="已驳回" value="rejected" />
        </el-select>
        <el-select v-model="query.loss_reason" placeholder="失效原因" clearable style="width: 160px" @change="reload">
          <el-option v-for="o in LOSS_REASONS" :key="o.value" :label="o.label" :value="o.value" />
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
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column label="商机名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="goOpportunity(row)">{{ row.opportunity_name || '—' }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="customer_name" label="客户" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.customer_name || '—' }}</template>
        </el-table-column>
        <el-table-column prop="loss_reason" label="失效原因" width="130" show-overflow-tooltip />
        <el-table-column label="详细说明" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.loss_detail || '—' }}</template>
        </el-table-column>
        <el-table-column label="竞争对手" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.competitor_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="是否可挽回" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.is_recoverable ? 'success' : 'info'" effect="plain">
              {{ row.is_recoverable ? '可挽回' : '不可挽回' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="申请人" width="100">
          <template #default="{ row }">{{ row.submitted_by_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="审批人" width="100">
          <template #default="{ row }">{{ row.approved_by_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="审批状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.approval_status)" effect="plain">
              {{ statusLabel(row.approval_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="申请时间" width="150">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">查看详情</el-button>
            <el-button
              v-if="canUpdate && row.approval_status !== 'rejected' && !row.is_recoverable"
              link
              type="primary"
              @click="openRecover(row)"
            >
              标记可挽回
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无失效记录</div>
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

    <!-- 失效记录详情抽屉 -->
    <el-drawer v-model="detailDrawer" title="失效记录详情" size="480px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="section-card">
            <h3 class="section-card__title">商机信息</h3>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="商机名称">{{ detail.opportunity?.name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="客户">{{ detail.customer?.name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="商机状态">{{ detail.opportunity?.status || '—' }}</el-descriptions-item>
              <el-descriptions-item label="阶段快照">{{ detail.opportunity?.stage_name_snapshot || '—' }}</el-descriptions-item>
              <el-descriptions-item label="商机金额">{{ money(detail.opportunity?.amount) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="section-card">
            <h3 class="section-card__title">失效信息</h3>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="失效原因">{{ detail.loss_reason || '—' }}</el-descriptions-item>
              <el-descriptions-item label="详细说明">
                <span class="pre-wrap">{{ detail.loss_detail || '—' }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="竞争对手">{{ detail.competitor_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="是否可挽回">{{ detail.is_recoverable ? '可挽回' : '不可挽回' }}</el-descriptions-item>
              <el-descriptions-item label="挽回计划">{{ detail.recovery_plan || '—' }}</el-descriptions-item>
              <el-descriptions-item label="申请人">{{ detail.submitted_by_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="审批人">{{ detail.approved_by_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="审批状态">{{ statusLabel(detail.approval_status) }}</el-descriptions-item>
              <el-descriptions-item label="审批意见">{{ detail.approve_comment || '—' }}</el-descriptions-item>
              <el-descriptions-item label="申请时间">{{ fmt(detail.created_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </template>
        <p v-else-if="!detailLoading" class="empty-tip">未获取到详情</p>
      </div>
    </el-drawer>

    <!-- 标记可挽回 -->
    <el-dialog v-model="recoverDialog" title="标记可挽回" width="480px" align-center>
      <p class="text-muted">为商机「{{ current?.opportunity_name }}」填写挽回计划，标记后可继续跟进。</p>
      <el-input
        v-model="recoveryPlan"
        type="textarea"
        :rows="4"
        maxlength="500"
        show-word-limit
        placeholder="请填写挽回计划（必填）"
      />
      <template #footer>
        <el-button @click="recoverDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmRecover">确认标记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { LOSS_REASONS } from '@/config/options'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const dateRange = ref<[string, string] | null>(null)

const detailDrawer = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)

const recoverDialog = ref(false)
const submitting = ref(false)
const recoveryPlan = ref('')
const current = ref<any>(null)

const query = reactive({ approval_status: '', loss_reason: '', page: 1, page_size: 20 })

const scopeText = computed(() => userStore.scopeBadge('opportunity'))
const canUpdate = computed(() => userStore.hasPerm('loss:update'))

const STATUS_LABEL: Record<string, string> = { pending: '待审批', approved: '已通过', rejected: '已驳回' }
const STATUS_TAG: Record<string, string> = { pending: 'info', approved: 'success', rejected: 'danger' }

function statusLabel(s?: string) {
  return STATUS_LABEL[s || ''] || s || '—'
}

function statusTagType(s?: string) {
  return STATUS_TAG[s || ''] || 'info'
}

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function money(v?: any) {
  if (v === null || v === undefined || v === '') return '—'
  return Number(v).toLocaleString('zh-CN')
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    if (query.approval_status) params.approval_status = query.approval_status
    if (query.loss_reason) params.loss_reason = query.loss_reason
    if (dateRange.value) {
      params.start_date = dateRange.value[0]
      params.end_date = dateRange.value[1]
    }
    const res = await api.listLossRecords(params)
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
  query.approval_status = ''
  query.loss_reason = ''
  query.page = 1
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

function goOpportunity(row: any) {
  if (row.opportunity_id) router.push(`/opportunities/${row.opportunity_id}`)
}

async function openDetail(row: any) {
  detail.value = null
  detailDrawer.value = true
  detailLoading.value = true
  try {
    detail.value = await api.getLossRecord(row.id)
  } finally {
    detailLoading.value = false
  }
}

function openRecover(row: any) {
  current.value = row
  recoveryPlan.value = ''
  recoverDialog.value = true
}

async function confirmRecover() {
  if (!recoveryPlan.value.trim()) {
    ElMessage.warning('请填写挽回计划')
    return
  }
  submitting.value = true
  try {
    await api.markLossRecoverable(current.value.id, { recovery_plan: recoveryPlan.value.trim() })
    ElMessage.success('已标记为可挽回')
    recoverDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.pre-wrap {
  white-space: pre-wrap;
}
</style>
