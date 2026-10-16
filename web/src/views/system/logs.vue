<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">操作日志</h2>
          <span class="text-muted">关键操作审计留痕，仅查询不提供编辑（M10-R5）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <el-tabs v-model="tab" @tab-change="reload">
        <el-tab-pane label="业务操作" name="business" />
        <el-tab-pane label="配置变更" name="config" />
        <el-tab-pane label="全部" name="all" />
      </el-tabs>

      <div class="filter-bar">
        <el-select v-model="query.user_id" placeholder="操作人" clearable filterable style="width: 190px" @change="reload">
          <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
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
        <span class="text-muted">共 {{ total }} 条</span>
        <el-button @click="reset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.user_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="日志类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.log_type === 'config' ? 'warning' : 'info'" effect="plain">
              {{ row.log_type === 'config' ? '配置变更' : '业务操作' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="200" show-overflow-tooltip />
        <el-table-column label="对象" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.target_type || '—' }}
            <span v-if="row.target_id" class="text-muted">（{{ shortId(row.target_id) }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="详情" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">{{ detailText(row.detail_json) }}</template>
        </el-table-column>
        <el-table-column label="IP" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.ip_address || '—' }}</template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无操作日志</div>
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { loadOwnerOptions, type Option } from '@/config/options'

const userStore = useUserStore()

const loading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const owners = ref<Option[]>([])
const dateRange = ref<[string, string] | null>(null)
const tab = ref('business')

const query = reactive({ user_id: '', page: 1, page_size: 20 })

function fmt(iso?: string) {
  return String(iso || '').slice(0, 19).replace('T', ' ') || '—'
}

function shortId(id?: string) {
  return id ? String(id).slice(0, 8) : ''
}

function detailText(json?: string) {
  if (!json) return '—'
  try {
    const obj = JSON.parse(json)
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
      .join('；')
  } catch (e) {
    return String(json)
  }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    if (query.user_id) params.user_id = query.user_id
    if (tab.value !== 'all') params.type = tab.value
    if (dateRange.value) {
      params.start_date = dateRange.value[0]
      params.end_date = dateRange.value[1]
    }
    const res = await api.listOperationLogs(params)
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
  query.user_id = ''
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

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  await load()
})
</script>
