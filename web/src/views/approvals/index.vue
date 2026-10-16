<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">审批中心</h2>
          <span class="scope-badge">待办 {{ pendingTotal }}</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <el-tabs v-model="tab" @tab-change="reload">
        <el-tab-pane label="待办" name="pending" />
        <el-tab-pane label="已办" name="done" />
      </el-tabs>

      <div class="filter-bar">
        <el-select v-model="type" placeholder="全部类型" clearable style="width: 160px" @change="reload">
          <el-option label="商机失效" value="loss" />
          <el-option label="停滞延期" value="stagnation" />
        </el-select>
        <div class="filter-bar__spacer" />
      </div>

      <el-table :data="items" size="small" :loading="loading" style="width: 100%">
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'loss' ? 'danger' : 'warning'" effect="plain">
              {{ row.type === 'loss' ? '商机失效' : '停滞延期' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="opportunity_name" label="商机" min-width="180" show-overflow-tooltip />
        <el-table-column prop="customer_name" label="客户" min-width="140" show-overflow-tooltip />
        <el-table-column prop="applicant_name" label="申请人" width="100" />
        <el-table-column label="申请时间" width="150">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column prop="summary" label="摘要" min-width="140" show-overflow-tooltip />
        <el-table-column v-if="tab === 'done'" label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'approved' ? 'success' : 'danger'" effect="plain">
              {{ row.status === 'approved' ? '已通过' : '已驳回' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row)">{{ tab === 'pending' ? '处理' : '查看' }}</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">{{ tab === 'pending' ? '暂无待办审批' : '暂无已办记录' }}</div>
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

    <!-- 审批处理抽屉（480px，界面设计文档 8.5） -->
    <el-drawer v-model="drawer" :title="current?.type === 'loss' ? '商机失效审批' : '停滞延期审批'" size="480px">
      <template v-if="current">
        <div class="section-card">
          <h3 class="section-card__title">商机摘要</h3>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="商机">
              <el-link type="primary" underline="never" @click="goOpportunity">
                {{ current.opportunity_name }}
              </el-link>
            </el-descriptions-item>
            <el-descriptions-item label="客户">{{ current.customer_name || '—' }}</el-descriptions-item>
            <el-descriptions-item label="当前阶段">{{ opp?.stage_name_snapshot || '—' }}</el-descriptions-item>
            <el-descriptions-item label="商机金额">
              {{ opp?.amount != null ? Number(opp.amount).toLocaleString('zh-CN') : '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="停留天数">{{ stagnantDays }} 天</el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="section-card">
          <h3 class="section-card__title">申请信息</h3>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="申请人">{{ current.applicant_name || '—' }}</el-descriptions-item>
            <el-descriptions-item label="申请时间">{{ fmt(current.created_at) }}</el-descriptions-item>
            <el-descriptions-item v-if="current.type === 'loss'" label="失败原因">
              {{ current.summary || '—' }}
            </el-descriptions-item>
            <el-descriptions-item v-else label="停滞原因">{{ current.summary || '—' }}</el-descriptions-item>
            <el-descriptions-item v-if="current.extra?.expected_date" label="预计推进日期">
              {{ current.extra.expected_date }}
            </el-descriptions-item>
            <el-descriptions-item label="详细说明">
              <span class="pre-wrap">{{ current.detail || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item v-if="tab === 'done'" label="审批人">
              {{ current.approver_name || '—' }}
            </el-descriptions-item>
            <el-descriptions-item v-if="tab === 'done'" label="审批意见">
              {{ current.comment || '—' }}
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <div v-if="tab === 'pending' && canOperate" class="section-card">
          <h3 class="section-card__title">审批处理</h3>
          <template v-if="!rejecting">
            <el-alert type="info" :closable="false" show-icon title="通过后该申请即时生效；驳回需填写意见后退回申请人。" />
            <div class="drawer-actions">
              <el-button type="primary" :loading="submitting" @click="approve">通过</el-button>
              <el-button @click="rejecting = true">驳回</el-button>
            </div>
          </template>
          <template v-else>
            <el-input v-model="comment" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写驳回意见（必填）" />
            <div class="drawer-actions">
              <el-button type="danger" :loading="submitting" @click="reject">确认驳回</el-button>
              <el-button @click="rejecting = false">取消</el-button>
            </div>
          </template>
        </div>
        <p v-else-if="tab === 'pending'" class="empty-tip">当前账号不是该审批的审批人，仅可查看</p>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const DAY = 86400000

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const tab = ref<'pending' | 'done'>('pending')
const type = ref('')
const pendingTotal = ref(0)

const drawer = ref(false)
const current = ref<any>(null)
const opp = ref<any>(null)
const rejecting = ref(false)
const comment = ref('')

const canOperate = computed(
  () => userStore.isAdmin || userStore.hasPerm(['loss:approve', 'alert:manage'])
)

const stagnantDays = computed(() => {
  const base = opp.value?.last_activity_at || opp.value?.stage_changed_at || opp.value?.created_at
  if (!base) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(base).getTime()) / DAY))
})

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ')
}

async function load() {
  loading.value = true
  try {
    const res = await api.listApprovals({
      status: tab.value,
      type: type.value || undefined,
      page: page.value,
      page_size: pageSize.value,
    })
    items.value = res.list || []
    total.value = res.total || 0
    const summary = await api.approvalSummary()
    pendingTotal.value = summary.pending || 0
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

async function open(row: any) {
  current.value = row
  opp.value = null
  rejecting.value = false
  comment.value = ''
  drawer.value = true
  try {
    opp.value = await api.getOpportunity(row.opportunity_id)
  } catch (e) {
    /* 无商机查看权限时仅展示申请信息 */
  }
}

function goOpportunity() {
  if (current.value?.opportunity_id) router.push(`/opportunities/${current.value.opportunity_id}`)
}

async function approve() {
  if (!current.value) return
  submitting.value = true
  try {
    if (current.value.type === 'loss') await api.approveLoss(current.value.id)
    else await api.approveStagnationExplain(current.value.id)
    ElMessage.success('已通过该申请')
    drawer.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function reject() {
  if (!current.value) return
  if (!comment.value.trim()) {
    ElMessage.warning('请填写驳回意见')
    return
  }
  submitting.value = true
  try {
    const body = { comment: comment.value.trim() }
    if (current.value.type === 'loss') await api.rejectLoss(current.value.id, body)
    else await api.rejectStagnationExplain(current.value.id, body)
    ElMessage.success('已驳回该申请')
    drawer.value = false
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

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
