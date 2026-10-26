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
        <el-tab-pane label="我发起的" name="mine" />
      </el-tabs>

      <div class="filter-bar">
        <el-select v-model="type" placeholder="全部类型" clearable style="width: 160px" @change="reload">
          <el-option v-for="t in TYPES" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <div class="filter-bar__spacer" />
      </div>

      <el-table :data="items" size="small" :loading="loading" style="width: 100%">
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="typeTag(row.type)" effect="plain">{{ typeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="商机 / 对象" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.opportunity_id" type="primary" underline="never" @click="goOpportunity(row)">
              {{ row.opportunity_name || '查看商机' }}
            </el-link>
            <span v-else>{{ row.summary || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="customer_name" label="客户" min-width="140" show-overflow-tooltip />
        <el-table-column prop="applicant_name" label="申请人" width="100" />
        <el-table-column label="申请时间" width="150">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column prop="summary" label="摘要" min-width="160" show-overflow-tooltip />
        <el-table-column v-if="tab !== 'pending'" label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTag(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row)">{{ tab === 'pending' ? '处理' : '查看' }}</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">{{ emptyText }}</div>
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

    <!-- 审批处理抽屉（界面设计文档 8.5） -->
    <el-drawer v-model="drawer" :title="drawerTitle" size="480px">
      <template v-if="current">
        <!-- 报价 / 合同：通用审批引擎 -->
        <template v-if="isEngine">
          <div class="section-card">
            <h3 class="section-card__title">审批信息</h3>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="审批流">{{ current.flow_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="申请内容">{{ current.summary || '—' }}</el-descriptions-item>
              <el-descriptions-item v-if="current.opportunity_id" label="关联商机">
                <el-link type="primary" underline="never" @click="goOpportunity()">
                  {{ current.opportunity_name || '查看商机' }}
                </el-link>
              </el-descriptions-item>
              <el-descriptions-item label="客户">{{ current.customer_name || '—' }}</el-descriptions-item>
              <el-descriptions-item v-if="current.detail" label="补充信息">{{ current.detail }}</el-descriptions-item>
              <el-descriptions-item label="金额">
                {{ current.extra?.amount != null ? Number(current.extra.amount).toLocaleString('zh-CN') : '—' }}
              </el-descriptions-item>
              <el-descriptions-item v-if="current.extra?.discount_rate != null" label="折扣率">
                {{ (Number(current.extra.discount_rate) * 10).toFixed(2) }} 折
                <span class="text-muted">（报价 ÷ 商机金额）</span>
              </el-descriptions-item>
              <el-descriptions-item label="申请人">{{ current.applicant_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="申请时间">{{ fmt(current.created_at) }}</el-descriptions-item>
              <el-descriptions-item label="当前状态">{{ statusLabel(current.status) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="section-card">
            <h3 class="section-card__title">审批链</h3>
            <div v-for="t in instance?.tasks || []" :key="t.id" class="task-row">
              <div class="task-row__main">
                <span class="task-row__node">{{ t.node_name }}</span>
                <span class="text-muted">{{ t.approver_name || '—' }}</span>
              </div>
              <div class="task-row__right">
                <el-tag size="small" :type="taskTag(t.status)" effect="plain">{{ taskLabel(t.status) }}</el-tag>
                <span v-if="t.comment" class="task-row__comment text-muted">{{ t.comment }}</span>
              </div>
            </div>
            <p v-if="!instance?.tasks?.length" class="empty-tip">暂无审批任务</p>
          </div>

          <div v-if="tab === 'pending' && current.can_handle" class="section-card">
            <h3 class="section-card__title">审批处理</h3>
            <template v-if="!rejecting">
              <el-alert type="info" :closable="false" show-icon title="通过后进入下一节点或结束审批；驳回需填写意见。" />
              <div class="drawer-actions">
                <el-button type="primary" :loading="submitting" @click="approveInstance">通过</el-button>
                <el-button @click="rejecting = true">驳回</el-button>
              </div>
            </template>
            <template v-else>
              <el-input v-model="comment" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写驳回意见（必填）" />
              <div class="drawer-actions">
                <el-button type="danger" :loading="submitting" @click="rejectInstance">确认驳回</el-button>
                <el-button @click="rejecting = false">取消</el-button>
              </div>
            </template>
          </div>
          <div v-else-if="tab === 'mine' && current.status === 'pending'" class="section-card">
            <h3 class="section-card__title">发起人操作</h3>
            <el-alert type="warning" :closable="false" show-icon title="撤回后该审批终止，业务数据回到未提交状态。" />
            <div class="drawer-actions">
              <el-button :loading="submitting" @click="cancelApproval">撤回审批</el-button>
            </div>
          </div>
          <p v-else-if="tab === 'pending'" class="empty-tip">当前账号不是该节点的审批人，仅可查看</p>
        </template>

        <!-- 商机失效 / 停滞延期：沿用原审批逻辑 -->
        <template v-else>
          <div class="section-card">
            <h3 class="section-card__title">商机摘要</h3>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="商机">
                <el-link type="primary" underline="never" @click="goOpportunity()">
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
              <el-descriptions-item v-if="tab !== 'pending'" label="审批人">
                {{ current.approver_name || '—' }}
              </el-descriptions-item>
              <el-descriptions-item v-if="tab !== 'pending'" label="审批意见">
                {{ current.comment || '—' }}
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <div v-if="tab === 'pending' && canOperate" class="section-card">
            <h3 class="section-card__title">审批处理</h3>
            <template v-if="!rejecting">
              <el-alert type="info" :closable="false" show-icon title="通过后该申请即时生效；驳回需填写意见后退回申请人。" />
              <div class="drawer-actions">
                <el-button type="primary" :loading="submitting" @click="approveLegacy">通过</el-button>
                <el-button @click="rejecting = true">驳回</el-button>
              </div>
            </template>
            <template v-else>
              <el-input v-model="comment" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写驳回意见（必填）" />
              <div class="drawer-actions">
                <el-button type="danger" :loading="submitting" @click="rejectLegacy">确认驳回</el-button>
                <el-button @click="rejecting = false">取消</el-button>
              </div>
            </template>
          </div>
          <p v-else-if="tab === 'pending'" class="empty-tip">当前账号不是该审批的审批人，仅可查看</p>
        </template>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const DAY = 86400000

const TYPES = [
  { label: '商机失效', value: 'loss' },
  { label: '停滞延期', value: 'stagnation' },
  { label: '报价审批', value: 'quotation' },
  { label: '合同审批', value: 'contract' },
]

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const tab = ref<'pending' | 'done' | 'mine'>('pending')
const type = ref('')
const pendingTotal = ref(0)

const drawer = ref(false)
const current = ref<any>(null)
const instance = ref<any>(null)
const opp = ref<any>(null)
const rejecting = ref(false)
const comment = ref('')

const isEngine = computed(() => ['quotation', 'contract'].includes(current.value?.type))

const canOperate = computed(() => userStore.isAdmin || userStore.hasPerm(['loss:approve', 'alert:manage']))

const drawerTitle = computed(() => {
  const t = current.value?.type
  if (t === 'loss') return '商机失效审批'
  if (t === 'stagnation') return '停滞延期审批'
  if (t === 'quotation') return '报价审批'
  if (t === 'contract') return '合同审批'
  return '审批详情'
})

const emptyText = computed(() => {
  if (tab.value === 'pending') return '暂无待办审批'
  if (tab.value === 'done') return '暂无已办记录'
  return '暂无我发起的审批'
})

const stagnantDays = computed(() => {
  const base = opp.value?.last_activity_at || opp.value?.stage_changed_at || opp.value?.created_at
  if (!base) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(base).getTime()) / DAY))
})

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

const STATUS_LABEL: Record<string, string> = { pending: '审批中', approved: '已通过', rejected: '已驳回', canceled: '已撤回' }
const STATUS_TAG: Record<string, TagType> = { pending: 'warning', approved: 'success', rejected: 'danger', canceled: 'info' }
const TASK_LABEL: Record<string, string> = { pending: '待处理', approved: '已通过', rejected: '已驳回', skipped: '已跳过' }
const TASK_TAG: Record<string, TagType> = { pending: 'warning', approved: 'success', rejected: 'danger', skipped: 'info' }

function typeLabel(t: string) {
  const hit = TYPES.find((x) => x.value === t)
  return hit ? hit.label : t
}

function typeTag(t: string): TagType {
  if (t === 'loss') return 'danger'
  if (t === 'stagnation') return 'warning'
  if (t === 'quotation') return 'primary'
  return 'success'
}

function statusLabel(s: string) {
  return STATUS_LABEL[s] || s
}

function statusTag(s: string): TagType {
  return STATUS_TAG[s] || 'info'
}

function taskLabel(s: string) {
  return TASK_LABEL[s] || s
}

function taskTag(s: string): TagType {
  return TASK_TAG[s] || 'info'
}

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
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
  instance.value = null
  rejecting.value = false
  comment.value = ''
  drawer.value = true
  if (['quotation', 'contract'].includes(row.type)) {
    try {
      instance.value = await api.getApprovalInstance(row.instance_id)
    } catch (e) {
      /* 无权查看时仅展示列表摘要 */
    }
  } else if (row.opportunity_id) {
    try {
      opp.value = await api.getOpportunity(row.opportunity_id)
    } catch (e) {
      /* 无商机查看权限时仅展示申请信息 */
    }
  }
}

function goOpportunity(row?: any) {
  const id = row?.opportunity_id || current.value?.opportunity_id
  if (id) router.push(`/opportunities/${id}`)
}

/* ---------------- 通用审批引擎 ---------------- */
async function approveInstance() {
  if (!current.value) return
  submitting.value = true
  try {
    await api.approveInstance(current.value.instance_id)
    ElMessage.success('已通过当前节点')
    drawer.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function rejectInstance() {
  if (!current.value) return
  if (!comment.value.trim()) {
    ElMessage.warning('请填写驳回意见')
    return
  }
  submitting.value = true
  try {
    await api.rejectInstance(current.value.instance_id, { comment: comment.value.trim() })
    ElMessage.success('已驳回该审批')
    drawer.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function cancelApproval() {
  if (!current.value) return
  await ElMessageBox.confirm('确认撤回该审批？撤回后需重新提交。', '撤回确认', { type: 'warning' })
  submitting.value = true
  try {
    await api.cancelInstance(current.value.instance_id)
    ElMessage.success('已撤回')
    drawer.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

/* ---------------- 失效 / 停滞原审批 ---------------- */
async function approveLegacy() {
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

async function rejectLegacy() {
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

.task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--crm-border);
}

.task-row:last-child {
  border-bottom: none;
}

.task-row__main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-row__node {
  font-weight: 600;
  font-size: 13px;
}

.task-row__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-row__comment {
  font-size: 12px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
