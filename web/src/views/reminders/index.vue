<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">提醒事项</h2>
          <span class="scope-badge">共 {{ total }} 条</span>
        </div>
        <div class="page-head__right">
          <el-button type="primary" @click="openCreate">新建提醒</el-button>
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <p class="page-desc">提醒事项是待办计划，包含尚未到期的提醒；消息中心只记录已经发生的触发。</p>

      <div class="filter-bar">
        <el-input
          v-model="keyword"
          class="f-item"
          placeholder="搜索提醒事项"
          clearable
          style="width: 170px"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        />
        <el-select v-model="status" class="f-item" style="width: 110px" @change="applyFilters">
          <el-option label="全部" value="all" />
          <el-option label="待提醒" value="pending" />
          <el-option label="已提醒" value="sent" />
          <el-option label="已完成" value="done" />
          <el-option label="已取消" value="canceled" />
        </el-select>
        <el-select v-model="entityType" class="f-item" style="width: 120px" @change="applyFilters">
          <el-option label="全部对象" value="all" />
          <el-option label="商机" value="opportunity" />
          <el-option label="客户" value="customer" />
          <el-option label="个人提醒" value="none" />
        </el-select>
        <el-select v-model="source" class="f-item" style="width: 120px" @change="applyFilters">
          <el-option label="全部来源" value="all" />
          <el-option label="手动创建" value="manual" />
          <el-option label="回访自动" value="activity" />
        </el-select>
        <el-select v-model="repeatRule" class="f-item" style="width: 110px" @change="applyFilters">
          <el-option label="全部重复" value="all" />
          <el-option label="不重复" value="none" />
          <el-option label="每天" value="daily" />
          <el-option label="每周" value="weekly" />
          <el-option label="每月" value="monthly" />
        </el-select>
        <el-select v-model="range" class="f-item" style="width: 120px" @change="onRangeChange">
          <el-option label="全部时间" value="all" />
          <el-option label="今天" value="today" />
          <el-option label="近 7 天" value="7d" />
          <el-option label="近 30 天" value="30d" />
          <el-option label="自定义" value="custom" />
        </el-select>
        <el-date-picker
          v-if="range === 'custom'"
          v-model="customRange"
          class="f-item"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 240px"
          @change="applyFilters"
        />
        <el-checkbox v-model="overdue" class="f-item" @change="applyFilters">只看逾期</el-checkbox>
        <div class="filter-bar__spacer" />
        <span class="filter-count">共 {{ total }} 条</span>
        <el-button link @click="resetFilters">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" size="small" @row-click="onRowClick">
        <el-table-column label="提醒时间" width="170">
          <template #default="{ row }">
            <span>{{ row.remind_at }}</span>
            <el-tag v-if="row.overdue" size="small" type="danger" effect="plain" class="ml-6">逾期</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提醒事项" min-width="220">
          <template #default="{ row }">
            <div class="reminder-title">{{ row.title }}</div>
            <div v-if="row.content" class="reminder-content">{{ row.content }}</div>
          </template>
        </el-table-column>
        <el-table-column label="关联对象" min-width="160">
          <template #default="{ row }">
            <el-link v-if="row.entity_name" type="primary" underline="never" @click.stop="goEntity(row)">
              {{ row.entity_label }}：{{ row.entity_name }}
            </el-link>
            <span v-else-if="row.entity_type === 'none'" class="text-muted">个人提醒</span>
            <span v-else class="text-muted">已删除</span>
          </template>
        </el-table-column>
        <el-table-column label="重复" width="90" align="center">
          <template #default="{ row }">{{ repeatLabel(row.repeat_rule) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusMeta(row.status).type" effect="plain">{{ statusMeta(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="center">
          <template #default="{ row }">
            <div @click.stop>
              <el-button
                v-if="row.status === 'pending' || row.status === 'sent'"
                link
                type="primary"
                size="small"
                @click="markDone(row)"
              >已完成</el-button>
              <el-button v-if="row.status === 'pending'" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
        <template #empty><div class="empty-tip">暂无提醒事项</div></template>
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

    <!-- 提醒详情（只读） -->
    <el-dialog v-model="detailVisible" title="提醒详情" width="560px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="提醒时间">{{ detail.remind_at }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="statusMeta(detail.status).type" effect="plain">
              {{ statusMeta(detail.status).label }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="重复">{{ repeatLabel(detail.repeat_rule) }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ detail.source === 'activity' ? '回访自动' : '手动创建' }}</el-descriptions-item>
          <el-descriptions-item label="关联对象" :span="2">
            <el-link v-if="detail.entity_name" type="primary" underline="never" @click="goEntity(detail)">
              {{ detail.entity_label }}：{{ detail.entity_name }}
            </el-link>
            <span v-else-if="detail.entity_type === 'none'" class="text-muted">个人提醒</span>
            <span v-else class="text-muted">关联对象已删除</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.repeat_until" label="重复截止">{{ detail.repeat_until }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.sent_at" label="触发时间">{{ fmt(detail.sent_at) }}</el-descriptions-item>
        </el-descriptions>
        <div class="detail-block">
          <p class="detail-block__label">提醒事项</p>
          <p class="detail-block__text">{{ detail.title }}</p>
        </div>
        <div class="detail-block">
          <p class="detail-block__label">备注</p>
          <p v-if="detail.content" class="detail-block__text detail-block__content">{{ detail.content }}</p>
          <p v-else class="text-muted">无备注</p>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button
          v-if="detail && (detail.status === 'pending' || detail.status === 'sent')"
          type="primary"
          @click="markDone(detail)"
        >标记完成</el-button>
        <el-button
          v-if="detail && detail.repeat_rule !== 'none' && (detail.status === 'pending' || detail.status === 'sent')"
          type="warning"
          @click="skipOnce(detail)"
        >跳过本次</el-button>
      </template>
    </el-dialog>

    <ReminderDrawer v-model="drawerVisible" :edit-row="editRow" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import ReminderDrawer from '@/components/ReminderDrawer.vue'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const status = ref<'all' | 'pending' | 'sent' | 'done' | 'canceled'>('all')
const keyword = ref('')
const entityType = ref<'all' | 'opportunity' | 'customer' | 'none'>('all')
const source = ref<'all' | 'manual' | 'activity'>('all')
const repeatRule = ref<'all' | 'none' | 'daily' | 'weekly' | 'monthly'>('all')
const range = ref<'all' | 'today' | '7d' | '30d' | 'custom'>('all')
const customRange = ref<[string, string] | null>(null)
const overdue = ref(false)
const drawerVisible = ref(false)
const editRow = ref<any>(null)
const detailVisible = ref(false)
const detail = ref<any>(null)

function repeatLabel(rule?: string) {
  const map: Record<string, string> = { daily: '每天', weekly: '每周', monthly: '每月' }
  return map[rule || 'none'] || '不重复'
}

function statusMeta(s: string) {
  if (s === 'pending') return { label: '待提醒', type: 'warning' as const }
  if (s === 'sent') return { label: '已提醒', type: 'primary' as const }
  if (s === 'done') return { label: '已完成', type: 'success' as const }
  return { label: '已取消', type: 'info' as const }
}

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ')
}

const pad2 = (n: number) => String(n).padStart(2, '0')
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function rangeParams(key: string, custom: [string, string] | null) {
  const today = fmtDate(new Date())
  if (key === 'today') return { start: today, end: today }
  if (key === '7d') return { start: fmtDate(new Date(Date.now() - 6 * 86400000)), end: today }
  if (key === '30d') return { start: fmtDate(new Date(Date.now() - 29 * 86400000)), end: today }
  if (key === 'custom' && custom) return { start: custom[0], end: custom[1] }
  return {}
}
const RANGE_KEYS = ['all', 'today', '7d', '30d', 'custom']

function onRangeChange() {
  if (range.value !== 'custom') customRange.value = null
  applyFilters()
}

function syncQuery() {
  const q: Record<string, any> = {}
  if (status.value !== 'all') q.status = status.value
  if (keyword.value.trim()) q.keyword = keyword.value.trim()
  if (entityType.value !== 'all') q.entity = entityType.value
  if (source.value !== 'all') q.source = source.value
  if (repeatRule.value !== 'all') q.repeat = repeatRule.value
  if (overdue.value) q.overdue = '1'
  if (range.value !== 'all') {
    q.range = range.value
    if (range.value === 'custom' && customRange.value) {
      q.start = customRange.value[0]
      q.end = customRange.value[1]
    }
  }
  router.replace({ query: q })
}

function readQuery() {
  const q = route.query
  status.value = (['pending', 'sent', 'done', 'canceled'].includes(String(q.status)) ? q.status : 'all') as any
  keyword.value = q.keyword ? String(q.keyword) : ''
  entityType.value = (['opportunity', 'customer', 'none'].includes(String(q.entity)) ? q.entity : 'all') as any
  source.value = (['manual', 'activity'].includes(String(q.source)) ? q.source : 'all') as any
  repeatRule.value = (['none', 'daily', 'weekly', 'monthly'].includes(String(q.repeat)) ? q.repeat : 'all') as any
  overdue.value = q.overdue === '1'
  range.value = (RANGE_KEYS.includes(String(q.range)) ? String(q.range) : 'all') as any
  if (range.value === 'custom' && q.start && q.end) customRange.value = [String(q.start), String(q.end)]
}

function applyFilters() {
  page.value = 1
  syncQuery()
  load()
}

function resetFilters() {
  status.value = 'all'
  keyword.value = ''
  entityType.value = 'all'
  source.value = 'all'
  repeatRule.value = 'all'
  range.value = 'all'
  customRange.value = null
  overdue.value = false
  applyFilters()
}

async function load() {
  loading.value = true
  try {
    const res = await api.listReminders({
      page: page.value,
      page_size: pageSize.value,
      status: status.value === 'all' ? undefined : status.value,
      keyword: keyword.value.trim() || undefined,
      entity_type: entityType.value === 'all' ? undefined : entityType.value,
      source: source.value === 'all' ? undefined : source.value,
      repeat_rule: repeatRule.value === 'all' ? undefined : repeatRule.value,
      overdue: overdue.value ? '1' : undefined,
      ...rangeParams(range.value, customRange.value),
    } as any)
    rows.value = res.list || []
    total.value = res.total || 0
  } finally {
    loading.value = false
  }
}

function onPageChange(p: number) {
  page.value = p
  load()
}

/** 通知布局刷新角标（提醒数变化后立即生效） */
function notifyBadges() {
  window.dispatchEvent(new Event('crm:refresh-badges'))
}

/** 打开详情：一次性“已提醒”提醒视为到位，自动置为完成 */
async function showDetail(row: any, ack = true) {
  detail.value = row
  detailVisible.value = true
  if (ack && row.status === 'sent' && row.repeat_rule === 'none') {
    try {
      detail.value = await api.ackReminder(row.id)
      notifyBadges()
      await load()
    } catch (e) {
      /* 静默：已处理或无权时不阻断查看 */
    }
  }
}

function onRowClick(row: any) {
  showDetail(row, true)
}

function goEntity(row: any) {
  if (row.link) router.push(row.link)
}

function openCreate() {
  editRow.value = null
  drawerVisible.value = true
}

function openEdit(row: any) {
  editRow.value = row
  drawerVisible.value = true
}

async function markDone(row: any) {
  await api.doneReminder(row.id)
  ElMessage.success('已标记完成')
  detailVisible.value = false
  notifyBadges()
  await load()
}

async function skipOnce(row: any) {
  await ElMessageBox.confirm(`跳过本次提醒，顺延到下一个周期？（${row.title}）`, '跳过确认', { type: 'warning' })
  await api.skipReminder(row.id)
  ElMessage.success('已跳过本次')
  detailVisible.value = false
  notifyBadges()
  await load()
}

async function removeRow(row: any) {
  await ElMessageBox.confirm(`删除提醒「${row.title}」？`, '删除确认', { type: 'warning' })
  await api.deleteReminder(row.id)
  ElMessage.success('已删除')
  notifyBadges()
  await load()
}

/** 新建/编辑成功后刷新列表与角标 */
async function onSaved() {
  notifyBadges()
  await load()
}

/** 支持从消息中心 / 仪表盘带 ?open=<id> 直接打开详情 */
async function openFromQuery() {
  const id = route.query.open ? String(route.query.open) : ''
  if (!id) return
  try {
    const row = await api.getReminder(id)
    await showDetail(row, true)
  } catch (e) {
    ElMessage.warning('提醒不存在或无权访问')
  }
  const q = { ...route.query }
  delete q.open
  router.replace({ query: q })
}

watch(
  () => route.query.open,
  (v) => {
    if (v) openFromQuery()
  },
)

onMounted(() => {
  readQuery()
  load()
  openFromQuery()
})
</script>

<style scoped>
.page-desc {
  margin: 2px 0 12px;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.reminder-title {
  font-size: 13px;
  font-weight: 600;
}

.reminder-content {
  font-size: 12px;
  color: var(--crm-text-secondary);
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.detail-block {
  margin-top: 14px;
}

.detail-block__label {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.detail-block__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-block__content {
  max-height: 220px;
  overflow: auto;
  padding: 8px 10px;
  background: #f7f8fa;
  border-radius: 4px;
}

.ml-6 {
  margin-left: 6px;
}

.f-item {
  flex: none;
}

.filter-count {
  flex: none;
  font-size: 12px;
  color: var(--crm-text-secondary);
}
</style>
