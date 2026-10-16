<template>
  <div class="page">
    <!-- 数据概览（界面设计文档 U2：我的预警商机 / 待办 / 快捷入口三卡片） -->
    <el-row :gutter="12" class="mb-12">
      <el-col v-for="s in stats" :key="s.label" :xs="12" :sm="12" :md="6">
        <div class="stat" :style="{ borderTopColor: s.color }">
          <p class="stat__label">{{ s.label }}</p>
          <p class="stat__value">{{ s.value }}</p>
          <p class="stat__hint">{{ s.hint }}</p>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="12">
      <!-- 我的预警商机（三级置顶） -->
      <el-col :xs="24" :lg="16">
        <div class="section-card">
          <div class="section-head">
            <h3 class="section-card__title">我的预警商机</h3>
            <el-button v-if="userStore.hasPerm('alert:view')" link type="primary" @click="router.push('/alerts')">
              查看全部
            </el-button>
          </div>
          <el-table v-if="userStore.hasPerm('alert:view')" :data="alerts" size="small" :loading="loading" style="width: 100%">
            <el-table-column prop="opportunity_name" label="商机" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <el-link type="primary" underline="never" @click="router.push(`/opportunities/${row.opportunity_id}`)">
                  {{ row.opportunity_name }}
                </el-link>
              </template>
            </el-table-column>
            <el-table-column prop="customer_name" label="客户" min-width="140" show-overflow-tooltip />
            <el-table-column prop="stage_name_snapshot" label="当前阶段" width="140" show-overflow-tooltip />
            <el-table-column label="停留天数" width="90" align="right">
              <template #default="{ row }">
                <span class="num">{{ row.days_stagnant }}</span>
              </template>
            </el-table-column>
            <el-table-column label="预警级别" width="90" align="center">
              <template #default="{ row }">
                <span class="lv" :class="`lv--${row.alert_level || 0}`">{{ levelText(row.alert_level) }}</span>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="empty-tip">当前角色无停滞预警查看权限</p>
        </div>

        <!-- 待跟进回访 -->
        <div class="section-card">
          <div class="section-head">
            <h3 class="section-card__title">待跟进回访</h3>
            <el-button v-if="userStore.hasPerm('activity:view')" link type="primary" @click="router.push('/activities')">
              查看全部
            </el-button>
          </div>
          <el-table v-if="userStore.hasPerm('activity:view')" :data="reminders" size="small" :loading="loading" style="width: 100%">
            <el-table-column label="客户 / 商机" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.customer_name || row.opportunity_name || '未关联' }}</template>
            </el-table-column>
            <el-table-column prop="content" label="跟进内容" min-width="200" show-overflow-tooltip />
            <el-table-column label="计划回访" width="140">
              <template #default="{ row }">
                <span>{{ String(row.follow_up_time || '').slice(0, 10) }}</span>
                <el-tag v-if="row.overdue" size="small" type="danger" class="ml-6">逾期</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="empty-tip">当前角色无销售行为查看权限</p>
        </div>
      </el-col>

      <el-col :xs="24" :lg="8">
        <!-- 待我审批 -->
        <div class="section-card">
          <div class="section-head">
            <h3 class="section-card__title">待我审批</h3>
            <el-button v-if="canApprove" link type="primary" @click="router.push('/approvals')">审批中心</el-button>
          </div>
          <template v-if="canApprove">
            <p v-if="!approvals.length" class="empty-tip">暂无待办审批</p>
            <div v-for="a in approvals" :key="`${a.type}-${a.id}`" class="todo" @click="router.push('/approvals')">
              <div class="todo__head">
                <el-tag size="small" :type="a.type === 'loss' ? 'danger' : 'warning'" effect="plain">
                  {{ a.type === 'loss' ? '商机失效' : '停滞延期' }}
                </el-tag>
                <span class="todo__time">{{ String(a.created_at || '').slice(0, 16).replace('T', ' ') }}</span>
              </div>
              <p class="todo__title">{{ a.opportunity_name }}</p>
              <p class="todo__meta">{{ a.customer_name }} · 申请人 {{ a.applicant_name }}</p>
            </div>
          </template>
          <p v-else class="empty-tip">当前角色无审批权限</p>
        </div>

        <!-- 快捷入口 -->
        <div class="section-card">
          <h3 class="section-card__title">快捷入口</h3>
          <div class="quick">
            <el-button
              v-for="l in quickLinks"
              :key="l.path"
              :type="l.primary ? 'primary' : 'default'"
              class="quick__btn"
              @click="router.push(l.path)"
            >
              {{ l.label }}
            </el-button>
          </div>
          <p v-if="!quickLinks.length" class="empty-tip">当前角色无可用操作入口</p>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const customerTotal = ref(0)
const oppTotal = ref(0)
const alertTotal = ref(0)
const alerts = ref<any[]>([])
const reminders = ref<any[]>([])
const approvals = ref<any[]>([])
const canApprove = ref(false)
const pendingCount = ref(0)

const stats = computed(() => [
  { label: '我的客户', value: customerTotal.value, hint: userStore.scopeBadge('customer'), color: '#4a5c7a' },
  { label: '进行中商机', value: oppTotal.value, hint: userStore.scopeBadge('opportunity'), color: '#4a5c7a' },
  { label: '停滞预警', value: alertTotal.value, hint: '未解除', color: '#e6a23c' },
  { label: '待我审批', value: pendingCount.value, hint: canApprove.value ? '需处理' : '无审批权限', color: '#f56c6c' },
])

const quickLinks = computed(() =>
  [
    { label: '新建客户', path: '/customers/new', perm: 'customer:create' as string | string[], primary: true },
    { label: '新增线索', path: '/leads/new', perm: 'lead:create' },
    { label: '新建商机', path: '/opportunities/new', perm: 'opportunity:create' },
    { label: '行为记录', path: '/activities', perm: 'activity:create' },
    { label: '公海池', path: '/sea', perm: 'sea:view' },
    { label: '报表中心', path: '/reports', perm: 'report:view' },
  ].filter((l) => userStore.hasPerm(l.perm))
)

/** 预警级别文案（1 黄 / 2 橙 / 3 红，界面设计文档 6.3） */
function levelText(level: number) {
  return { 1: '一级', 2: '二级', 3: '三级' }[level] || '已报备'
}

async function load() {
  loading.value = true
  const jobs: Promise<any>[] = []
  try {
    if (userStore.hasPerm('customer:view')) {
      jobs.push(api.listCustomers({ page: 1, page_size: 1 }).then((r) => (customerTotal.value = r.total)))
    }
    if (userStore.hasPerm('opportunity:view')) {
      jobs.push(api.listOpportunities({ page: 1, page_size: 1, status: '进行中' }).then((r) => (oppTotal.value = r.total)))
    }
    if (userStore.hasPerm('alert:view')) {
      jobs.push(
        api.listAlerts({ page: 1, page_size: 20 }).then((r) => {
          alertTotal.value = r.total
          // 三级预警置顶展示（界面设计文档 6.3）
          alerts.value = (r.list || [])
            .slice()
            .sort((a: any, b: any) => b.alert_level - a.alert_level || b.days_stagnant - a.days_stagnant)
            .slice(0, 8)
        })
      )
    }
    if (userStore.hasPerm('activity:view')) {
      jobs.push(api.activityReminders().then((r) => (reminders.value = (r || []).slice(0, 8))))
    }
    jobs.push(
      api.approvalSummary().then(async (s) => {
        canApprove.value = !!s.can_approve
        pendingCount.value = s.pending || 0
        if (s.can_approve) {
          const r = await api.listApprovals({ status: 'pending', page: 1, page_size: 5 })
          approvals.value = r.list || []
        }
      })
    )
    await Promise.all(jobs)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.stat {
  background: var(--crm-card);
  border-radius: var(--crm-radius);
  border-top: 3px solid var(--crm-neutral);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.stat__label {
  margin: 0;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.stat__value {
  margin: 6px 0 2px;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.stat__hint {
  margin: 0;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-head .section-card__title {
  margin-bottom: 10px;
}

.lv {
  display: inline-block;
  min-width: 42px;
  padding: 0 6px;
  height: 20px;
  line-height: 20px;
  border-radius: 10px;
  font-size: 12px;
  color: #fff;
  background: var(--crm-text-secondary);
}

.lv--1 {
  background: var(--crm-alert-1);
}
.lv--2 {
  background: var(--crm-alert-2);
}
.lv--3 {
  background: var(--crm-alert-3);
}

.ml-6 {
  margin-left: 6px;
}

.todo {
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  border-bottom: 1px dashed var(--crm-border);
}

.todo:hover {
  background: #f7f8fa;
}

.todo__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.todo__time {
  font-size: 11px;
  color: var(--crm-text-secondary);
}

.todo__title {
  margin: 6px 0 2px;
  font-size: 13px;
  font-weight: 600;
}

.todo__meta {
  margin: 0;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick__btn {
  margin-left: 0;
}
</style>
