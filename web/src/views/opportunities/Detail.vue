<template>
  <div class="page" v-loading="loading">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <el-button link @click="back">← 商机列表</el-button>
          <h2 class="page-title">{{ opp?.name }}</h2>
          <el-tag size="small" :type="statusTagType(opp?.status)" effect="plain">{{ opp?.status }}</el-tag>
          <span v-if="alertLevel" :class="['alert-dot', `alert-dot--${alertLevel}`]">停滞 {{ stagnantDays }} 天</span>
        </div>
        <div class="page-head__right">
          <el-button v-if="canUpdate && opp?.status === '进行中'" type="primary" @click="advanceDialog = true">
            推进至下一阶段<template v-if="missingCount">（缺 {{ missingCount }} 项）</template>
          </el-button>
          <el-button v-if="canUpdate" @click="goEdit">编辑</el-button>
          <el-dropdown v-if="hasMore" trigger="click" @command="onMore">
            <el-button>更多</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="canUpdate && opp?.status === '进行中'" command="win">赢单关闭</el-dropdown-item>
                <el-dropdown-item v-if="canUpdate && opp?.status === '进行中'" command="loss">标记失败</el-dropdown-item>
                <el-dropdown-item v-if="canRollback && opp?.status === '进行中'" command="rollback">阶段回退</el-dropdown-item>
                <el-dropdown-item v-if="canUpdate && opp?.status === '进行中'" command="sea">转公海</el-dropdown-item>
                <el-dropdown-item v-if="canUpdate" command="share" divided>分享·协作成员</el-dropdown-item>
                <el-dropdown-item v-if="canDelete" command="delete" divided>删除商机</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <div class="section-card">
            <div class="stage-flow">
              <template v-for="(s, i) in stageProgress?.stages || []" :key="s.id">
                <span v-if="i > 0" class="stage-flow__arrow">→</span>
                <span
                  :class="[
                    'stage-flow__node',
                    s.current ? 'stage-flow__node--current' : s.passed ? 'stage-flow__node--done' : '',
                  ]"
                >
                  {{ s.passed ? '✓ ' : '' }}{{ s.name }}
                </span>
              </template>
            </div>
          </div>

          <div class="section-card">
            <el-tabs v-model="tab">
              <el-tab-pane label="固定动作" name="actions">
                <el-alert
                  v-if="opp?.status === '进行中'"
                  :type="missingCount ? 'warning' : 'success'"
                  :closable="false"
                  show-icon
                  :title="
                    missingCount
                      ? `当前阶段固定动作完成度 ${opp?.fixed_actions?.completeness}，仍有 ${missingCount} 项未完成`
                      : `当前阶段固定动作已全部完成（${opp?.fixed_actions?.completeness}）`
                  "
                />
                <div v-for="item in opp?.fixed_actions?.items || []" :key="item.rule_id" class="check-item">
                  <span class="check-item__icon">{{ item.done ? '✅' : '⬜' }}</span>
                  <span class="check-item__name">{{ item.action_name }}</span>
                  <span class="check-item__tip text-muted">{{ item.tip || '' }}</span>
                  <el-tag size="small" :type="item.done ? 'success' : 'info'" effect="plain">
                    {{ item.done ? '已完成' : '未完成' }}
                  </el-tag>
                </div>
              </el-tab-pane>

              <el-tab-pane label="基本信息" name="basic">
                <el-descriptions :column="2" size="small" border>
                  <el-descriptions-item label="所属客户">
                    <el-link type="primary" underline="never" @click="goCustomer">{{ opp?.customer_name || '—' }}</el-link>
                  </el-descriptions-item>
                  <el-descriptions-item label="负责人">{{ opp?.owner_name || '—' }}</el-descriptions-item>
                  <el-descriptions-item label="商机金额">{{ Number(opp?.amount || 0).toLocaleString('zh-CN') }}</el-descriptions-item>
                  <el-descriptions-item label="预计成交日期">{{ opp?.expected_close_date || '—' }}</el-descriptions-item>
                  <el-descriptions-item label="当前阶段">{{ opp?.stage_name_snapshot || '—' }}</el-descriptions-item>
                  <el-descriptions-item label="阶段变更时间">{{ fmt(opp?.stage_changed_at) }}</el-descriptions-item>
                  <el-descriptions-item label="创建时间">{{ fmt(opp?.created_at) }}</el-descriptions-item>
                  <el-descriptions-item label="最后推进">{{ fmt(opp?.last_activity_at) }}</el-descriptions-item>
                  <el-descriptions-item label="备注" :span="2">{{ opp?.remark || '—' }}</el-descriptions-item>
                  <el-descriptions-item v-for="(v, k) in customFieldEntries" :key="k" :label="String(k)">
                    {{ formatCustom(v) }}
                  </el-descriptions-item>
                </el-descriptions>
              </el-tab-pane>

              <el-tab-pane :label="`方案与报价 (${proposals.length + quotations.length})`" name="assets">
                <h4 class="sub-title">方案</h4>
                <el-table :data="proposals" size="small">
                  <el-table-column prop="file_name" label="文件" min-width="200" show-overflow-tooltip />
                  <el-table-column label="类型" width="110">
                    <template #default="{ row }">{{ row.proposal_type === 'formal' ? '正式方案' : '初步方案' }}</template>
                  </el-table-column>
                  <el-table-column label="上传时间" width="150">
                    <template #default="{ row }">{{ fmt(row.created_at) }}</template>
                  </el-table-column>
                  <template #empty><div class="empty-tip">暂无方案</div></template>
                </el-table>
                <h4 class="sub-title">报价</h4>
                <el-table :data="quotations" size="small">
                  <el-table-column prop="file_name" label="文件" min-width="200" show-overflow-tooltip />
                  <el-table-column label="类型" width="110">
                    <template #default="{ row }">{{ row.quotation_type === 'final' ? '最终报价' : '初步报价' }}</template>
                  </el-table-column>
                  <el-table-column label="上传时间" width="150">
                    <template #default="{ row }">{{ fmt(row.created_at) }}</template>
                  </el-table-column>
                  <template #empty><div class="empty-tip">暂无报价</div></template>
                </el-table>
                <el-table :data="contracts" size="small" class="mt-12">
                  <el-table-column prop="contract_no" label="合同编号" width="160" />
                  <el-table-column label="金额" width="120" align="right">
                    <template #default="{ row }">{{ Number(row.amount || 0).toLocaleString('zh-CN') }}</template>
                  </el-table-column>
                  <template #empty><div class="empty-tip">暂无合同</div></template>
                </el-table>
              </el-tab-pane>

              <el-tab-pane :label="`行为记录 (${activities.length})`" name="activity">
                <div class="mb-12">
                  <el-button v-if="canActivityCreate" type="primary" size="small" @click="openActivity">新增行为</el-button>
                </div>
                <el-table :data="activities" size="small">
                  <el-table-column label="时间" width="150">
                    <template #default="{ row }">{{ fmt(row.activity_time) }}</template>
                  </el-table-column>
                  <el-table-column prop="activity_type" label="类型" width="100" />
                  <el-table-column prop="content" label="内容" min-width="240" show-overflow-tooltip />
                  <el-table-column prop="creator_name" label="记录人" width="100" />
                  <template #empty><div class="empty-tip">暂无行为记录</div></template>
                </el-table>
              </el-tab-pane>

              <el-tab-pane label="阶段历史" name="history">
                <el-timeline v-if="history.length">
                  <el-timeline-item
                    v-for="h in history"
                    :key="h.id"
                    :timestamp="fmt(h.created_at)"
                    placement="top"
                    :type="h.action_type === 'rollback' ? 'warning' : 'success'"
                  >
                    <div class="timeline-item__title">
                      {{ actionLabel(h.action_type) }} → {{ h.to_stage_name }}
                    </div>
                    <div class="timeline-item__meta">
                      {{ h.from_stage_name || '—' }} → {{ h.to_stage_name || '—' }}
                      <template v-if="h.changed_by_name"> · {{ h.changed_by_name }}</template>
                      <template v-if="h.reason"> · {{ h.reason }}</template>
                    </div>
                  </el-timeline-item>
                </el-timeline>
                <div v-else class="empty-tip">暂无阶段变更记录</div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </div>

        <div class="detail-aside">
          <div class="section-card">
            <h3 class="section-card__title">固定动作完成度</h3>
            <div class="card-row">
              <span>{{ opp?.fixed_actions?.completeness || '0/0' }}</span>
              <el-progress :percentage="completenessPercent" :show-text="false" style="flex: 1" />
            </div>
          </div>

          <div class="section-card">
            <h3 class="section-card__title">预警状态</h3>
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="停滞天数">
                <span :class="alertLevel ? `text-alert-${alertLevel}` : ''">{{ stagnantDays }} 天</span>
              </el-descriptions-item>
              <el-descriptions-item label="当前阈值">7 / 14 / 21 天</el-descriptions-item>
              <el-descriptions-item label="最后推进">{{ fmt(opp?.last_activity_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="section-card">
            <h3 class="section-card__title">团队</h3>
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="负责人">{{ opp?.owner_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="协作成员">
                <template v-if="shares.length">
                  <div v-for="s in shares" :key="s.id" class="share-item">
                    <span>{{ s.shared_to_name }}</span>
                    <el-button v-if="canUpdate" link type="danger" size="small" @click="revoke(s)">撤销</el-button>
                  </div>
                </template>
                <span v-else class="text-muted">暂无</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </div>
    </div>

    <OpportunityAdvanceDialog v-model="advanceDialog" :opportunity-id="id" @advanced="reload" />
    <ActivityDrawer
      v-model="activityDrawer"
      :default-customer-id="opp?.customer_id"
      :default-customer-name="opp?.customer_name"
      :default-opportunity-id="id"
      :default-opportunity-name="opp?.name"
      @saved="reload"
    />

    <!-- 阶段回退 -->
    <el-dialog v-model="rollbackDialog" title="阶段回退" width="440px">
      <el-form label-width="90px">
        <el-form-item label="回退至" required>
          <el-select v-model="rollbackStage" placeholder="请选择目标阶段" style="width: 100%">
            <el-option
              v-for="s in rollbackTargets"
              :key="s.id"
              :label="s.name"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="回退原因" required>
          <el-input v-model="rollbackReason" type="textarea" :rows="3" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rollbackDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmRollback">确认回退</el-button>
      </template>
    </el-dialog>

    <!-- 标记失败（M8-R1：生成失效申请，审批通过后生效） -->
    <el-dialog v-model="lossDialog" title="标记失败（提交失效申请）" width="520px">
      <el-form label-width="100px">
        <el-form-item label="失败原因" required>
          <el-select v-model="lossForm.loss_reason" placeholder="请选择" style="width: 100%">
            <el-option v-for="o in LOSS_REASONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="详细说明" required>
          <el-input v-model="lossForm.loss_detail" type="textarea" :rows="3" maxlength="300" show-word-limit />
        </el-form-item>
        <el-form-item v-if="lossForm.loss_reason.includes('竞争对手')" label="竞争对手" required>
          <el-input v-model="lossForm.competitor_name" maxlength="60" />
        </el-form-item>
        <el-form-item label="是否可挽回">
          <el-switch v-model="lossForm.is_recoverable" />
        </el-form-item>
        <el-form-item v-if="lossForm.is_recoverable" label="挽回计划">
          <el-input v-model="lossForm.recovery_plan" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
        <el-form-item v-if="lossForm.is_recoverable" label="跟进日期">
          <el-date-picker v-model="lossForm.follow_up_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="lossDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="confirmLoss">提交失效申请</el-button>
      </template>
    </el-dialog>

    <!-- 赢单关闭（M3-R4） -->
    <el-dialog v-model="winDialog" title="赢单关闭" width="480px">
      <el-form label-width="100px">
        <el-form-item label="合同编号"><el-input v-model="winForm.contract_no" maxlength="40" placeholder="留空自动生成" /></el-form-item>
        <el-form-item label="合同金额" required>
          <el-input-number v-model="winForm.amount" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="签订日期">
          <el-date-picker v-model="winForm.signed_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="winDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmWin">确认赢单</el-button>
      </template>
    </el-dialog>

    <!-- 转公海 -->
    <el-dialog v-model="seaDialog" title="商机转公海" width="440px">
      <el-input v-model="seaReason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写转公海原因（必填）" />
      <template #footer>
        <el-button @click="seaDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSea">确认转入公海</el-button>
      </template>
    </el-dialog>

    <!-- 分享·协作成员（M4-R7） -->
    <el-dialog v-model="shareDialog" title="分享·协作成员" width="520px">
      <el-form label-width="90px">
        <el-form-item label="分享给">
          <el-select v-model="shareForm.shared_to" filterable placeholder="选择协作成员" style="width: 100%">
            <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="权限范围">
          <el-checkbox-group v-model="shareForm.permissions">
            <el-checkbox value="view">查看商机</el-checkbox>
            <el-checkbox value="activity_create">填写行为记录</el-checkbox>
            <el-checkbox value="view_proposal">查看方案</el-checkbox>
            <el-checkbox value="edit">编辑商机</el-checkbox>
            <el-checkbox value="advance">推进阶段</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <div class="sub-title">已分享成员</div>
      <el-table :data="shares" size="small">
        <el-table-column prop="shared_to_name" label="成员" width="120" />
        <el-table-column prop="shared_by_name" label="分享人" width="120" />
        <el-table-column label="权限" min-width="160">
          <template #default="{ row }">{{ (row.permissions || []).join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button link type="danger" @click="revoke(row)">撤销</el-button>
          </template>
        </el-table-column>
        <template #empty><div class="empty-tip">暂无协作成员</div></template>
      </el-table>
      <template #footer>
        <el-button @click="shareDialog = false">关闭</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmShare">确认分享</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import OpportunityAdvanceDialog from '@/components/OpportunityAdvanceDialog.vue'
import ActivityDrawer from '@/components/ActivityDrawer.vue'
import { LOSS_REASONS, loadOwnerOptions, type Option } from '@/config/options'

const DAY = 86400000
const THRESHOLDS = { level1: 7, level2: 14, level3: 21 }

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const tab = ref('actions')

const opp = ref<any>(null)
const stageProgress = ref<any>(null)
const proposals = ref<any[]>([])
const quotations = ref<any[]>([])
const contracts = ref<any[]>([])
const activities = ref<any[]>([])
const history = ref<any[]>([])
const shares = ref<any[]>([])
const owners = ref<Option[]>([])
const stages = ref<any[]>([])

const advanceDialog = ref(false)
const activityDrawer = ref(false)

const rollbackDialog = ref(false)
const rollbackStage = ref('')
const rollbackReason = ref('')

const lossDialog = ref(false)
const lossForm = reactive<any>({ loss_reason: '', loss_detail: '', competitor_name: '', is_recoverable: false, recovery_plan: '', follow_up_date: '' })

const winDialog = ref(false)
const winForm = reactive<any>({ contract_no: '', amount: 0, signed_date: '' })

const seaDialog = ref(false)
const seaReason = ref('')

const shareDialog = ref(false)
const shareForm = reactive<any>({ shared_to: '', permissions: ['view', 'activity_create'] })

const id = computed(() => route.params.id as string)
const canUpdate = computed(() => userStore.hasPerm('opportunity:update'))
const canDelete = computed(() => userStore.hasPerm('opportunity:delete'))
const canRollback = computed(() => userStore.isAdmin || userStore.hasPerm('opportunity:rollback'))
const canActivityCreate = computed(() => userStore.hasPerm('activity:create'))
const hasMore = computed(() => canUpdate.value || canDelete.value || canRollback.value)

const missingCount = computed(() => (opp.value?.fixed_actions?.missing || []).length)

const completenessPercent = computed(() => {
  const c = opp.value?.fixed_actions?.completeness || '0/0'
  const [done, total] = String(c).split('/').map(Number)
  return total ? Math.round((done / total) * 100) : 0
})

const stagnantDays = computed(() => {
  const row = opp.value
  if (!row || row.status !== '进行中') return 0
  const base = row.last_activity_at || row.stage_changed_at || row.created_at
  if (!base) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(base).getTime()) / DAY))
})

const alertLevel = computed(() => {
  const d = stagnantDays.value
  if (d >= THRESHOLDS.level3) return 3
  if (d >= THRESHOLDS.level2) return 2
  if (d >= THRESHOLDS.level1) return 1
  return 0
})

const rollbackTargets = computed(() =>
  stages.value.filter((s) => s.id !== opp.value?.stage_config_id && s.terminal_type !== 'loss')
)

const customFieldEntries = computed(() => {
  const cf = opp.value?.custom_fields || {}
  const out: Record<string, any> = {}
  Object.entries(cf).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  })
  return out
})

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function formatCustom(v: any) {
  if (Array.isArray(v)) return v.join('、')
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

function statusTagType(s?: string) {
  return { 进行中: 'primary', 赢单: 'success', 失败: 'danger', 公海: 'info' }[s || ''] || 'info'
}

function actionLabel(t?: string) {
  return { create: '创建', advance: '阶段推进', rollback: '阶段回退', close_win: '赢单关闭', close_loss: '失效关闭' }[t || ''] || t || '—'
}

async function load() {
  loading.value = true
  try {
    const row = await api.getOpportunity(id.value)
    opp.value = row
    stageProgress.value = row.stage_progress
    const [p, q, c, a, h, s] = await Promise.all([
      api.listProposals(id.value).catch(() => []),
      api.listQuotations(id.value).catch(() => []),
      api.listOpportunityContracts(id.value).catch(() => []),
      api.listActivities({ opportunity_id: id.value, page_size: 100 }).catch(() => ({ list: [] })),
      api.opportunityTimeline(id.value).catch(() => []),
      api.listShares(id.value).catch(() => []),
    ])
    proposals.value = p || []
    quotations.value = q || []
    contracts.value = c || []
    activities.value = (a as any).list || []
    history.value = h || []
    shares.value = s || []
  } finally {
    loading.value = false
  }
}

function reload() {
  load()
}

function back() {
  router.push('/opportunities')
}

function goEdit() {
  router.push(`/opportunities/${id.value}/edit`)
}

function goCustomer() {
  if (opp.value?.customer_id) router.push(`/customers/${opp.value.customer_id}`)
}

function openActivity() {
  activityDrawer.value = true
}

function onMore(cmd: string) {
  if (cmd === 'rollback') {
    rollbackStage.value = ''
    rollbackReason.value = ''
    rollbackDialog.value = true
  } else if (cmd === 'loss') {
    Object.assign(lossForm, { loss_reason: '', loss_detail: '', competitor_name: '', is_recoverable: false, recovery_plan: '', follow_up_date: '' })
    lossDialog.value = true
  } else if (cmd === 'win') {
    Object.assign(winForm, { contract_no: '', amount: opp.value?.amount || 0, signed_date: '' })
    winDialog.value = true
  } else if (cmd === 'sea') {
    seaReason.value = ''
    seaDialog.value = true
  } else if (cmd === 'share') {
    shareForm.shared_to = ''
    shareForm.permissions = ['view', 'activity_create']
    shareDialog.value = true
  } else if (cmd === 'delete') {
    remove()
  }
}

async function confirmRollback() {
  if (!rollbackStage.value || !rollbackReason.value.trim()) {
    ElMessage.warning('请选择目标阶段并填写回退原因')
    return
  }
  submitting.value = true
  try {
    await api.rollbackOpportunity(id.value, { to_stage: rollbackStage.value, reason: rollbackReason.value.trim() })
    ElMessage.success('已回退阶段')
    rollbackDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function confirmLoss() {
  if (!lossForm.loss_reason || !lossForm.loss_detail.trim()) {
    ElMessage.warning('请填写失败原因与详细说明')
    return
  }
  if (lossForm.loss_reason.includes('竞争对手') && !lossForm.competitor_name.trim()) {
    ElMessage.warning('失败原因含竞争对手时，请填写竞争对手名称')
    return
  }
  submitting.value = true
  try {
    await api.closeLoss(id.value, {
      loss_reason: lossForm.loss_reason,
      loss_detail: lossForm.loss_detail.trim(),
      competitor_name: lossForm.competitor_name || undefined,
      is_recoverable: lossForm.is_recoverable,
      recovery_plan: lossForm.recovery_plan || undefined,
      follow_up_date: lossForm.follow_up_date || undefined,
    })
    ElMessage.success('失效申请已提交，等待审批')
    lossDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function confirmWin() {
  if (!winForm.amount) {
    ElMessage.warning('请填写合同金额')
    return
  }
  submitting.value = true
  try {
    await api.closeWin(id.value, {
      reason: '合同签订完毕',
      contract: {
        contract_no: winForm.contract_no || undefined,
        amount: winForm.amount,
        signed_date: winForm.signed_date || undefined,
      },
    })
    ElMessage.success('已赢单关闭')
    winDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function confirmSea() {
  if (!seaReason.value.trim()) {
    ElMessage.warning('请填写转公海原因')
    return
  }
  submitting.value = true
  try {
    await api.releaseOpportunityToSea(id.value, seaReason.value.trim())
    ElMessage.success('已转入公海池')
    seaDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function confirmShare() {
  if (!shareForm.shared_to) {
    ElMessage.warning('请选择协作成员')
    return
  }
  submitting.value = true
  try {
    await api.createShare(id.value, { shared_to: shareForm.shared_to, permissions: shareForm.permissions })
    ElMessage.success('已分享')
    shareForm.shared_to = ''
    shares.value = await api.listShares(id.value)
  } finally {
    submitting.value = false
  }
}

async function revoke(row: any) {
  await api.revokeShare(id.value, row.id)
  ElMessage.success('已撤销')
  shares.value = await api.listShares(id.value)
}

async function remove() {
  await ElMessageBox.confirm(`确认删除商机「${opp.value?.name}」？`, '删除确认', { type: 'warning' })
  await api.deleteOpportunity(id.value)
  ElMessage.success('已删除')
  router.push('/opportunities')
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  try {
    stages.value = await api.stageOptions()
  } catch (e) {
    stages.value = []
  }
  await load()
  if (route.query.action === 'loss' && canUpdate.value) {
    onMore('loss')
  }
})
</script>

<style scoped>
.alert-dot {
  display: inline-block;
  min-width: 46px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
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

.check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--crm-border);
}

.check-item:last-child {
  border-bottom: none;
}

.check-item__tip {
  flex: 1;
  font-size: 12px;
  text-align: right;
  margin-right: 8px;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sub-title {
  margin: 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--crm-text-regular);
}

.share-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.text-alert-1 {
  color: var(--crm-alert-1);
}

.text-alert-2 {
  color: var(--crm-alert-2);
}

.text-alert-3 {
  color: var(--crm-alert-3);
}
</style>
