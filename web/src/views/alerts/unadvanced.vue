<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">未推进列表</h2>
          <span class="scope-badge">{{ canManage ? '管理层视图' : '我的视图' }}</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.stage_config_id" placeholder="当前阶段" clearable style="width: 170px" @change="reload">
          <el-option v-for="s in stages" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <span class="text-muted">最少停滞：</span>
        <el-input-number v-model="query.min_days" :min="1" :max="365" :step="1" style="width: 140px" @change="reload" />
        <span class="text-muted">天</span>
        <div class="filter-bar__spacer" />
        <el-button @click="reset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column label="商机名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="goOpportunity(row)">{{ row.name || '—' }}</el-link>
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
        <el-table-column label="负责人" width="100">
          <template #default="{ row }">{{ row.owner_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="最后推进时间" width="150">
          <template #default="{ row }">{{ fmt(row.last_activity_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canExplain" link type="primary" @click="openExplain(row)">填写停滞说明</el-button>
            <el-button link type="primary" @click="goOpportunity(row)">查看商机</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无未推进商机</div>
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
const stages = ref<any[]>([])

const explainDrawer = ref(false)
const explainOppId = ref('')

const query = reactive({ stage_config_id: '', min_days: 21, page: 1, page_size: 20 })

const canManage = computed(() => userStore.hasPerm('alert:manage'))
const canExplain = computed(() => userStore.hasPerm('opportunity:update'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

async function loadStages() {
  try {
    stages.value = await api.stageOptions()
  } catch (e) {
    stages.value = []
  }
}

async function load() {
  loading.value = true
  try {
    const res = await api.listUnadvanced({
      page: query.page,
      page_size: query.page_size,
      stage_config_id: query.stage_config_id || undefined,
      min_days: query.min_days || undefined,
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
  query.stage_config_id = ''
  query.min_days = 21
  query.page = 1
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

onMounted(async () => {
  await loadStages()
  await load()
})
</script>
