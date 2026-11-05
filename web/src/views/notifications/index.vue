<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">消息通知中心</h2>
          <span class="scope-badge">未读 {{ unread }}</span>
        </div>
        <div class="page-head__right">
          <template v-if="activeTab === 'messages'">
            <el-button :disabled="!unread" @click="markAll">全部已读</el-button>
            <el-button @click="load">刷新</el-button>
          </template>
          <template v-else>
            <el-button type="primary" @click="openCreate">新建提醒</el-button>
            <el-button @click="loadReminders">刷新</el-button>
          </template>
        </div>
      </div>

      <el-tabs v-model="activeTab" class="noti-tabs" @tab-change="onTabChange">
        <el-tab-pane label="消息" name="messages">
          <div class="filter-bar">
            <el-input
              v-model="keyword"
              class="f-item"
              placeholder="搜索标题或内容"
              clearable
              style="width: 200px"
              @keyup.enter="applyMessageFilters"
              @clear="applyMessageFilters"
            />
            <el-select v-model="readState" class="f-item" style="width: 110px" @change="applyMessageFilters">
              <el-option label="全部" value="all" />
              <el-option label="未读" value="unread" />
              <el-option label="已读" value="read" />
            </el-select>
            <el-select v-model="category" class="f-item" placeholder="全部类型" clearable style="width: 140px" @change="applyMessageFilters">
              <el-option v-for="c in CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
            </el-select>
            <el-select v-model="range" class="f-item" style="width: 120px" @change="onRangeChange('messages')">
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
              @change="applyMessageFilters"
            />
            <div class="filter-bar__spacer" />
            <span class="filter-count">共 {{ total }} 条</span>
            <el-button link @click="resetMessageFilters">重置</el-button>
          </div>

          <div v-loading="loading" class="noti-list">
            <p v-if="!items.length" class="empty-tip">暂无消息通知</p>
            <div v-for="n in items" :key="n.id" class="noti" :class="{ 'is-unread': !n.is_read }" @click="open(n)">
              <el-icon class="noti__icon" :style="{ color: iconOf(n.category).color }">
                <component :is="iconOf(n.category).icon" />
              </el-icon>
              <div class="noti__body">
                <p class="noti__title">
                  <span v-if="!n.is_read" class="noti__dot" />
                  {{ n.title }}
                </p>
                <p v-if="n.content" class="noti__content">{{ n.content }}</p>
              </div>
              <div class="noti__side">
                <span class="noti__tag">{{ labelOf(n.category) }}</span>
                <span class="noti__time">{{ fmt(n.created_at) }}</span>
              </div>
            </div>
          </div>

          <el-pagination
            v-if="total > pageSize"
            class="mt-12"
            layout="total, prev, pager, next"
            :total="total"
            :page-size="pageSize"
            :current-page="page"
            @current-change="onPageChange"
          />
        </el-tab-pane>

        <el-tab-pane label="提醒事项" name="reminders">
          <div class="filter-bar">
            <el-input
              v-model="reminderKeyword"
              class="f-item"
              placeholder="搜索提醒事项"
              clearable
              style="width: 170px"
              @keyup.enter="applyReminderFilters"
              @clear="applyReminderFilters"
            />
            <el-select v-model="reminderStatus" class="f-item" style="width: 110px" @change="applyReminderFilters">
              <el-option label="全部" value="all" />
              <el-option label="待提醒" value="pending" />
              <el-option label="已提醒" value="sent" />
              <el-option label="已完成" value="done" />
              <el-option label="已取消" value="canceled" />
            </el-select>
            <el-select v-model="reminderEntity" class="f-item" style="width: 120px" @change="applyReminderFilters">
              <el-option label="全部对象" value="all" />
              <el-option label="商机" value="opportunity" />
              <el-option label="客户" value="customer" />
              <el-option label="个人提醒" value="none" />
            </el-select>
            <el-select v-model="reminderSource" class="f-item" style="width: 120px" @change="applyReminderFilters">
              <el-option label="全部来源" value="all" />
              <el-option label="手动创建" value="manual" />
              <el-option label="回访自动" value="activity" />
            </el-select>
            <el-select v-model="reminderRepeat" class="f-item" style="width: 110px" @change="applyReminderFilters">
              <el-option label="全部重复" value="all" />
              <el-option label="不重复" value="none" />
              <el-option label="每天" value="daily" />
              <el-option label="每周" value="weekly" />
              <el-option label="每月" value="monthly" />
            </el-select>
            <el-select v-model="reminderRange" class="f-item" style="width: 120px" @change="onRangeChange('reminders')">
              <el-option label="全部时间" value="all" />
              <el-option label="今天" value="today" />
              <el-option label="近 7 天" value="7d" />
              <el-option label="近 30 天" value="30d" />
              <el-option label="自定义" value="custom" />
            </el-select>
            <el-date-picker
              v-if="reminderRange === 'custom'"
              v-model="reminderCustomRange"
              class="f-item"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              style="width: 240px"
              @change="applyReminderFilters"
            />
            <el-checkbox v-model="reminderOverdue" class="f-item" @change="applyReminderFilters">只看逾期</el-checkbox>
            <div class="filter-bar__spacer" />
            <span class="filter-count">共 {{ reminderTotal }} 条</span>
            <el-button link @click="resetReminderFilters">重置</el-button>
          </div>

          <el-table v-loading="reminderLoading" :data="reminders" size="small">
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
                <el-link v-if="row.entity_name" type="primary" underline="never" @click="goEntity(row)">
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
            <el-table-column label="操作" width="230" align="center">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'pending' || row.status === 'sent'"
                  link
                  type="primary"
                  size="small"
                  @click="markDone(row)"
                >已完成</el-button>
                <el-button
                  v-if="row.repeat_rule !== 'none' && (row.status === 'pending' || row.status === 'sent')"
                  link
                  type="warning"
                  size="small"
                  @click="skipOnce(row)"
                >跳过本次</el-button>
                <el-button v-if="row.status === 'pending'" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                <el-button
                  v-if="row.status === 'pending' || row.status === 'sent'"
                  link
                  type="warning"
                  size="small"
                  @click="cancelRow(row)"
                >取消</el-button>
                <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="empty-tip">暂无提醒事项</div></template>
          </el-table>

          <el-pagination
            v-if="reminderTotal > reminderPageSize"
            class="mt-12"
            layout="total, prev, pager, next"
            :total="reminderTotal"
            :page-size="reminderPageSize"
            :current-page="reminderPage"
            @current-change="onReminderPageChange"
          />
        </el-tab-pane>
      </el-tabs>
    </div>

    <ReminderDrawer v-model="drawerVisible" :edit-row="editRow" @saved="loadReminders" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Bell, Checked, Timer, Warning } from '@element-plus/icons-vue'
import * as api from '@/api'
import ReminderDrawer from '@/components/ReminderDrawer.vue'

const router = useRouter()
const route = useRoute()

const CATEGORIES = [
  { value: 'alert', label: '停滞预警' },
  { value: 'approval', label: '审批通知' },
  { value: 'todo', label: '提醒事项' },
  { value: 'reminder', label: '回访提醒' },
]

const activeTab = ref<'messages' | 'reminders'>(route.query.tab === 'reminders' ? 'reminders' : 'messages')
const loading = ref(false)
const items = ref<any[]>([])
const unread = ref(0)
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const category = ref('')
const readState = ref<'all' | 'unread' | 'read'>('all')
const keyword = ref('')
const range = ref<'all' | 'today' | '7d' | '30d' | 'custom'>('all')
const customRange = ref<[string, string] | null>(null)

const reminderLoading = ref(false)
const reminders = ref<any[]>([])
const reminderTotal = ref(0)
const reminderPage = ref(1)
const reminderPageSize = ref(20)
const reminderStatus = ref<'all' | 'pending' | 'sent' | 'done' | 'canceled'>('all')
const reminderKeyword = ref('')
const reminderEntity = ref<'all' | 'opportunity' | 'customer' | 'none'>('all')
const reminderSource = ref<'all' | 'manual' | 'activity'>('all')
const reminderRepeat = ref<'all' | 'none' | 'daily' | 'weekly' | 'monthly'>('all')
const reminderRange = ref<'all' | 'today' | '7d' | '30d' | 'custom'>('all')
const reminderCustomRange = ref<[string, string] | null>(null)
const reminderOverdue = ref(false)
const drawerVisible = ref(false)
const editRow = ref<any>(null)

function labelOf(c: string) {
  return CATEGORIES.find((x) => x.value === c)?.label || '通知'
}

function iconOf(c: string) {
  if (c === 'alert') return { icon: Warning, color: 'var(--crm-alert-1)' }
  if (c === 'approval') return { icon: Checked, color: 'var(--crm-neutral)' }
  if (c === 'todo' || c === 'reminder') return { icon: Timer, color: 'var(--crm-primary)' }
  return { icon: Bell, color: 'var(--crm-text-secondary)' }
}

function repeatLabel(rule?: string) {
  const map: Record<string, string> = { daily: '每天', weekly: '每周', monthly: '每月' }
  return map[rule || 'none'] || '不重复'
}

function statusMeta(status: string) {
  if (status === 'pending') return { label: '待提醒', type: 'warning' as const }
  if (status === 'sent') return { label: '已提醒', type: 'primary' as const }
  if (status === 'done') return { label: '已完成', type: 'success' as const }
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

function onRangeChange(tab: 'messages' | 'reminders') {
  if (tab === 'messages') {
    if (range.value !== 'custom') customRange.value = null
    applyMessageFilters()
  } else {
    if (reminderRange.value !== 'custom') reminderCustomRange.value = null
    applyReminderFilters()
  }
}

/** 当前筛选条件写入 URL，刷新/分享后可复现 */
function syncQuery() {
  const q: Record<string, any> = {}
  if (activeTab.value === 'reminders') {
    q.tab = 'reminders'
    if (reminderStatus.value !== 'all') q.status = reminderStatus.value
    if (reminderKeyword.value.trim()) q.keyword = reminderKeyword.value.trim()
    if (reminderEntity.value !== 'all') q.entity = reminderEntity.value
    if (reminderSource.value !== 'all') q.source = reminderSource.value
    if (reminderRepeat.value !== 'all') q.repeat = reminderRepeat.value
    if (reminderOverdue.value) q.overdue = '1'
    if (reminderRange.value !== 'all') {
      q.range = reminderRange.value
      if (reminderRange.value === 'custom' && reminderCustomRange.value) {
        q.start = reminderCustomRange.value[0]
        q.end = reminderCustomRange.value[1]
      }
    }
  } else {
    if (readState.value !== 'all') q.read = readState.value
    if (keyword.value.trim()) q.keyword = keyword.value.trim()
    if (category.value) q.category = category.value
    if (range.value !== 'all') {
      q.range = range.value
      if (range.value === 'custom' && customRange.value) {
        q.start = customRange.value[0]
        q.end = customRange.value[1]
      }
    }
  }
  router.replace({ query: q })
}

function readQuery() {
  const q = route.query
  const r = RANGE_KEYS.includes(String(q.range)) ? String(q.range) : 'all'
  const start = q.start ? String(q.start) : ''
  const end = q.end ? String(q.end) : ''
  if (activeTab.value === 'reminders') {
    reminderStatus.value = (['pending', 'sent', 'done', 'canceled'].includes(String(q.status)) ? q.status : 'all') as any
    reminderKeyword.value = q.keyword ? String(q.keyword) : ''
    reminderEntity.value = (['opportunity', 'customer', 'none'].includes(String(q.entity)) ? q.entity : 'all') as any
    reminderSource.value = (['manual', 'activity'].includes(String(q.source)) ? q.source : 'all') as any
    reminderRepeat.value = (['none', 'daily', 'weekly', 'monthly'].includes(String(q.repeat)) ? q.repeat : 'all') as any
    reminderOverdue.value = q.overdue === '1'
    reminderRange.value = r as any
    if (r === 'custom' && start && end) reminderCustomRange.value = [start, end]
  } else {
    readState.value = (['unread', 'read'].includes(String(q.read)) ? q.read : 'all') as any
    keyword.value = q.keyword ? String(q.keyword) : ''
    category.value = q.category ? String(q.category) : ''
    range.value = r as any
    if (r === 'custom' && start && end) customRange.value = [start, end]
  }
}

function applyMessageFilters() {
  page.value = 1
  syncQuery()
  load()
}

function applyReminderFilters() {
  reminderPage.value = 1
  syncQuery()
  loadReminders()
}

function resetMessageFilters() {
  keyword.value = ''
  readState.value = 'all'
  category.value = ''
  range.value = 'all'
  customRange.value = null
  applyMessageFilters()
}

function resetReminderFilters() {
  reminderStatus.value = 'all'
  reminderKeyword.value = ''
  reminderEntity.value = 'all'
  reminderSource.value = 'all'
  reminderRepeat.value = 'all'
  reminderRange.value = 'all'
  reminderCustomRange.value = null
  reminderOverdue.value = false
  applyReminderFilters()
}

async function load() {
  loading.value = true
  try {
    const res = await api.listNotifications({
      page: page.value,
      page_size: pageSize.value,
      category: category.value || undefined,
      is_read: readState.value === 'all' ? undefined : readState.value === 'read' ? 'true' : 'false',
      keyword: keyword.value.trim() || undefined,
      ...rangeParams(range.value, customRange.value),
    })
    items.value = res.list || []
    total.value = res.total || 0
    unread.value = res.unread || 0
  } finally {
    loading.value = false
  }
}

function onPageChange(p: number) {
  page.value = p
  load()
}

async function markAll() {
  await api.readAllNotifications()
  await load()
}

async function open(n: any) {
  if (!n.is_read) {
    await api.readNotification(n.id)
    n.is_read = 1
    unread.value = Math.max(0, unread.value - 1)
  }
  if (n.link) router.push(n.link)
}

async function loadReminders() {
  reminderLoading.value = true
  try {
    const res = await api.listReminders({
      page: reminderPage.value,
      page_size: reminderPageSize.value,
      status: reminderStatus.value === 'all' ? undefined : reminderStatus.value,
      keyword: reminderKeyword.value.trim() || undefined,
      entity_type: reminderEntity.value === 'all' ? undefined : reminderEntity.value,
      source: reminderSource.value === 'all' ? undefined : reminderSource.value,
      repeat_rule: reminderRepeat.value === 'all' ? undefined : reminderRepeat.value,
      overdue: reminderOverdue.value ? '1' : undefined,
      ...rangeParams(reminderRange.value, reminderCustomRange.value),
    })
    reminders.value = res.list || []
    reminderTotal.value = res.total || 0
  } finally {
    reminderLoading.value = false
  }
}

function onReminderPageChange(p: number) {
  reminderPage.value = p
  loadReminders()
}

function onTabChange(name: string | number) {
  const tab = name === 'reminders' ? 'reminders' : 'messages'
  syncQuery()
  if (tab === 'reminders') loadReminders()
  else load()
}

function openCreate() {
  editRow.value = null
  drawerVisible.value = true
}

function openEdit(row: any) {
  editRow.value = row
  drawerVisible.value = true
}

function goEntity(row: any) {
  if (row.link) router.push(row.link)
}

async function markDone(row: any) {
  await api.doneReminder(row.id)
  ElMessage.success('已标记完成')
  await loadReminders()
}

async function skipOnce(row: any) {
  await ElMessageBox.confirm(`跳过本次提醒，顺延到下一个周期？（${row.title}）`, '跳过确认', { type: 'warning' })
  await api.skipReminder(row.id)
  ElMessage.success('已跳过本次')
  await loadReminders()
}

async function cancelRow(row: any) {
  await ElMessageBox.confirm(`取消提醒「${row.title}」？取消后不再通知。`, '取消确认', { type: 'warning' })
  await api.cancelReminder(row.id)
  ElMessage.success('已取消')
  await loadReminders()
}

async function removeRow(row: any) {
  await ElMessageBox.confirm(`删除提醒「${row.title}」？`, '删除确认', { type: 'warning' })
  await api.deleteReminder(row.id)
  ElMessage.success('已删除')
  await loadReminders()
}

onMounted(() => {
  readQuery()
  if (activeTab.value === 'reminders') loadReminders()
  else load()
})
</script>

<style scoped>
.noti-tabs {
  margin-top: 4px;
}

.noti-list {
  min-height: 120px;
}

.noti {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--crm-border);
  cursor: pointer;
}

.noti:hover {
  background: #f7f8fa;
}

.noti.is-unread {
  background: #fbfcfa;
}

.noti__icon {
  font-size: 18px;
  margin-top: 2px;
  flex-shrink: 0;
}

.noti__body {
  flex: 1;
  min-width: 0;
}

.noti__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
}

.noti__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--crm-primary);
  margin-right: 6px;
  flex-shrink: 0;
}

.noti__content {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--crm-text-regular);
}

.noti__side {
  flex-shrink: 0;
  text-align: right;
}

.noti__tag {
  display: block;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.noti__time {
  display: block;
  font-size: 11px;
  color: var(--crm-text-secondary);
  margin-top: 2px;
}

.reminder-title {
  font-size: 13px;
  font-weight: 600;
}

.reminder-content {
  font-size: 12px;
  color: var(--crm-text-secondary);
  margin-top: 2px;
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
