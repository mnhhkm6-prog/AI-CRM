<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">停滞预警</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.level" placeholder="预警等级" clearable style="width: 130px" @change="reload">
          <el-option label="一级预警" value="1" />
          <el-option label="二级预警" value="2" />
          <el-option label="三级预警" value="3" />
        </el-select>
        <el-select v-model="query.is_resolved" placeholder="是否已解除" clearable style="width: 130px" @change="reload">
          <el-option label="未解除" value="false" />
          <el-option label="已解除" value="true" />
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
        <el-table-column label="当前阶段" width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.stage_name_snapshot || '—' }}</template>
        </el-table-column>
        <el-table-column label="停滞天数" width="100" align="right">
          <template #default="{ row }">{{ row.days_stagnant ?? 0 }} 天</template>
        </el-table-column>
        <el-table-column label="预警等级" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :style="levelStyle(row.alert_level)">{{ levelLabel(row.alert_level) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="触发时间" width="150">
          <template #default="{ row }">{{ fmt(row.triggered_at) }}</template>
        </el-table-column>
        <el-table-column label="是否已解除" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.is_resolved ? 'success' : 'warning'" effect="plain">
              {{ row.is_resolved ? '已解除' : '未解除' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canExplain" link type="primary" @click="openExplain(row)">填写停滞说明</el-button>
            <el-button link type="primary" @click="goOpportunity(row)">查看商机</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无预警数据</div>
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

    <StagnationExplainDialog v-model="explainDrawer" :opportunity-id="explainOppId" @submitted="load" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import StagnationExplainDialog from '@/components/StagnationExplainDialog.vue'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const oppLoading = ref(false)
const oppOptions = ref<any[]>([])

const explainDrawer = ref(false)
const explainOppId = ref('')

const query = reactive({ level: '', is_resolved: '', opportunity_id: '', page: 1, page_size: 20 })

const scopeText = computed(() => userStore.scopeBadge('opportunity'))
const canExplain = computed(() => userStore.hasPerm('opportunity:update'))

const LEVEL_LABEL: Record<number, string> = { 1: '一级', 2: '二级', 3: '三级' }
const LEVEL_COLOR: Record<number, string> = {
  1: 'var(--crm-alert-1)',
  2: 'var(--crm-alert-2)',
  3: 'var(--crm-alert-3)',
}

function levelLabel(level: number) {
  return LEVEL_LABEL[level] || '—'
}

function levelStyle(level: number) {
  const color = LEVEL_COLOR[level]
  return color ? { color, borderColor: color } : {}
}

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
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
    const res = await api.listAlerts({
      page: query.page,
      page_size: query.page_size,
      level: query.level || undefined,
      is_resolved: query.is_resolved || undefined,
      opportunity_id: query.opportunity_id || undefined,
    })
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
  Object.assign(query, { level: '', is_resolved: '', opportunity_id: '', page: 1 })
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

function openExplain(row: any) {
  explainOppId.value = row.opportunity_id
  explainDrawer.value = true
}

onMounted(load)
</script>
