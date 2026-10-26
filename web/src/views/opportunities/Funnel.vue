<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">漏斗看板</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button-group>
            <el-button @click="router.push('/opportunities')">列表视图</el-button>
            <el-button type="primary" disabled>看板视图</el-button>
          </el-button-group>
          <el-button v-if="canCreate" type="primary" @click="router.push('/opportunities/new')">新建商机</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-input v-model="query.keyword" placeholder="商机名称" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
        <el-select v-model="query.owner_id" placeholder="负责人" clearable filterable style="width: 170px" @change="load">
          <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="period" placeholder="周期" style="width: 130px" @change="load">
          <el-option label="全部" value="all" />
          <el-option label="本月" value="month" />
          <el-option label="本季" value="quarter" />
        </el-select>
        <div class="filter-bar__spacer" />
        <span class="text-muted">主漏斗 {{ mainCount }} 个商机 · 待验证 {{ pendingCount }} 个</span>
        <el-button @click="load">刷新</el-button>
      </div>

      <div v-loading="loading" class="board">
        <div v-for="col in columns" :key="col.id" class="board-col" :class="{ 'board-col--snapshot': col.snapshot }">
          <div class="board-col__head">
            <span class="board-col__name">
              {{ col.name }}
              <el-tag v-if="col.pending" size="small" type="warning" effect="plain">待验证</el-tag>
              <el-tag v-if="col.snapshot" size="small" type="info" effect="plain">历史</el-tag>
            </span>
            <span class="board-col__stat">共 {{ col.items.length }} · {{ fmtAmount(col.total) }}</span>
          </div>
          <div class="board-col__body">
            <div v-for="row in col.items" :key="row.id" class="opp-card" @click="goDetail(row)">
              <div class="opp-card__title">{{ row.name }}</div>
              <div class="opp-card__meta">{{ row.customer_name || '—' }}</div>
              <div class="opp-card__meta">
                <span>{{ Number(row.amount || 0).toLocaleString('zh-CN') }}</span>
                <span v-if="alertLevel(row)" :class="['alert-dot', `alert-dot--${alertLevel(row)}`]">
                  {{ stagnantDays(row) }} 天
                </span>
              </div>
              <div class="opp-card__foot">
                <span class="text-muted">{{ row.owner_name || '—' }}</span>
                <el-button
                  v-if="canUpdate && row.status === '进行中'"
                  size="small"
                  text
                  type="primary"
                  @click.stop="openAdvance(row)"
                >
                  推进
                </el-button>
              </div>
            </div>
            <div v-if="!col.items.length" class="board-col__empty">暂无商机</div>
          </div>
        </div>
      </div>
    </div>

    <OpportunityAdvanceDialog v-model="advanceDialog" :opportunity-id="currentId" @advanced="load" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import OpportunityAdvanceDialog from '@/components/OpportunityAdvanceDialog.vue'
import { loadOwnerOptions, type Option } from '@/config/options'

const DAY = 86400000
/** 停滞预警阈值全局兜底，阶段可单独配置 */
const DEFAULT_THRESHOLDS = { level1: 7, level2: 14, level3: 21 }

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const items = ref<any[]>([])
const owners = ref<Option[]>([])
const stages = ref<any[]>([])
const period = ref('all')
const advanceDialog = ref(false)
const currentId = ref('')

const query = reactive({ keyword: '', owner_id: '' })

const canCreate = computed(() => userStore.hasPerm('opportunity:create'))
const canUpdate = computed(() => userStore.hasPerm('opportunity:update'))
const scopeText = computed(() => userStore.scopeBadge('opportunity'))

/** 按阶段分组为看板列；阶段配置里不存在的为「历史快照」列 */
const columns = computed(() => {
  const cols = stages.value
    .filter((s) => s.terminal_type !== 'loss')
    .map((s) => {
      const list = items.value.filter((o) => o.stage_config_id === s.id)
      return { id: s.id, name: s.name, code: s.code, snapshot: false, pending: s.code === 'S0', items: list, total: sum(list) }
    })
  const known = new Set(stages.value.map((s) => s.id))
  const snapshots = items.value.filter((o) => !known.has(o.stage_config_id))
  if (snapshots.length) {
    cols.push({ id: '__snapshot__', name: '历史快照阶段', code: null, snapshot: true, pending: false, items: snapshots, total: sum(snapshots) })
  }
  return cols
})

/** 主漏斗不含 S0，S0 单独作为「待验证」口径 */
const pendingCount = computed(() => items.value.filter((o) => {
  const stage = stages.value.find((s: any) => s.id === o.stage_config_id)
  return stage?.code === 'S0'
}).length)
const mainCount = computed(() => items.value.length - pendingCount.value)

function sum(list: any[]) {
  return list.reduce((acc, o) => acc + Number(o.amount || 0), 0)
}

function fmtAmount(v: number) {
  if (v >= 10000) return `${(v / 10000).toFixed(1)} 万`
  return String(v)
}

function stagnantDays(row: any) {
  if (row.status !== '进行中') return 0
  const base = row.last_activity_at || row.stage_changed_at || row.created_at
  if (!base) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(base).getTime()) / DAY))
}

function thresholdsOf(stageId?: string) {
  const stage = stages.value.find((s: any) => s.id === stageId)
  const t = stage?.alert_thresholds || {}
  return {
    level1: Number(t.level1) || DEFAULT_THRESHOLDS.level1,
    level2: Number(t.level2) || DEFAULT_THRESHOLDS.level2,
    level3: Number(t.level3) || DEFAULT_THRESHOLDS.level3,
  }
}

function alertLevel(row: any) {
  const d = stagnantDays(row)
  const th = thresholdsOf(row.stage_config_id)
  if (d >= th.level3) return 3
  if (d >= th.level2) return 2
  if (d >= th.level1) return 1
  return 0
}

function periodRange(): [string, string] | null {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const p = (n: number) => String(n).padStart(2, '0')
  if (period.value === 'month') return [`${y}-${p(m + 1)}-01`, `${y}-${p(m + 1)}-${p(new Date(y, m + 1, 0).getDate())}`]
  if (period.value === 'quarter') {
    const startMonth = Math.floor(m / 3) * 3
    const endMonth = startMonth + 2
    return [`${y}-${p(startMonth + 1)}-01`, `${y}-${p(endMonth + 1)}-${p(new Date(y, endMonth + 1, 0).getDate())}`]
  }
  return null
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: 1, page_size: 200, status: '进行中' }
    if (query.keyword) params.keyword = query.keyword
    if (query.owner_id) params.owner_id = query.owner_id
    const range = periodRange()
    if (range) {
      params.start_date = range[0]
      params.end_date = range[1]
    }
    const res = await api.listOpportunities(params)
    items.value = res.list || []
  } finally {
    loading.value = false
  }
}

function goDetail(row: any) {
  router.push(`/opportunities/${row.id}`)
}

function openAdvance(row: any) {
  currentId.value = row.id
  advanceDialog.value = true
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  try {
    stages.value = await api.stageOptions()
  } catch (e) {
    stages.value = []
  }
  await load()
})
</script>

<style scoped>
.board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  align-items: flex-start;
}

.board-col {
  flex: 0 0 260px;
  width: 260px;
  background: #fafbfc;
  border: 1px solid var(--crm-border);
  border-radius: var(--crm-radius);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 260px);
}

.board-col--snapshot {
  background: #f0f2f5;
}

.board-col__head {
  padding: 8px 10px;
  border-bottom: 1px solid var(--crm-border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.board-col__name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.board-col__stat {
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.board-col__body {
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.board-col__empty {
  text-align: center;
  color: var(--crm-text-secondary);
  font-size: 12px;
  padding: 16px 0;
}

.opp-card {
  background: #fff;
  border: 1px solid var(--crm-border);
  border-radius: var(--crm-radius);
  padding: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.opp-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.opp-card__title {
  font-weight: 600;
  margin-bottom: 4px;
}

.opp-card__meta {
  font-size: 12px;
  color: var(--crm-text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 2px;
}

.opp-card__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
}

.alert-dot {
  display: inline-block;
  min-width: 42px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 18px;
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
</style>
