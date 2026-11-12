<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">消息中心</h2>
          <span class="scope-badge">未读 {{ unread }}</span>
        </div>
        <div class="page-head__right">
          <el-button :disabled="!unread" @click="markAll">全部已读</el-button>
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <p class="page-desc">消息中心记录“已经发生”的提醒触发、停滞预警与审批通知；待办提醒请到「提醒事项」处理。</p>

      <div class="filter-bar">
        <el-input
          v-model="keyword"
          class="f-item"
          placeholder="搜索标题或内容"
          clearable
          style="width: 200px"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        />
        <el-select v-model="readState" class="f-item" style="width: 110px" @change="applyFilters">
          <el-option label="全部" value="all" />
          <el-option label="未读" value="unread" />
          <el-option label="已读" value="read" />
        </el-select>
        <el-select v-model="category" class="f-item" placeholder="全部类型" clearable style="width: 140px" @change="applyFilters">
          <el-option v-for="c in CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
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
        <div class="filter-bar__spacer" />
        <span class="filter-count">共 {{ total }} 条</span>
        <el-button link @click="resetFilters">重置</el-button>
      </div>

      <div v-loading="loading" class="noti-list">
        <p v-if="!items.length" class="empty-tip">暂无消息</p>
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, Box, Checked, Timer, Warning } from '@element-plus/icons-vue'
import * as api from '@/api'

const router = useRouter()
const route = useRoute()

const CATEGORIES = [
  { value: 'alert', label: '停滞预警' },
  { value: 'approval', label: '审批通知' },
  { value: 'todo', label: '提醒触发' },
  { value: 'sea', label: '公海流转' },
]

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

function labelOf(c: string) {
  return CATEGORIES.find((x) => x.value === c)?.label || '通知'
}

function iconOf(c: string) {
  if (c === 'alert') return { icon: Warning, color: 'var(--crm-alert-1)' }
  if (c === 'approval') return { icon: Checked, color: 'var(--crm-neutral)' }
  if (c === 'todo') return { icon: Timer, color: 'var(--crm-primary)' }
  if (c === 'sea') return { icon: Box, color: 'var(--crm-primary)' }
  return { icon: Bell, color: 'var(--crm-text-secondary)' }
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

/** 当前筛选条件写入 URL，刷新/分享后可复现 */
function syncQuery() {
  const q: Record<string, any> = {}
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
  router.replace({ query: q })
}

function readQuery() {
  const q = route.query
  readState.value = (['unread', 'read'].includes(String(q.read)) ? q.read : 'all') as any
  keyword.value = q.keyword ? String(q.keyword) : ''
  category.value = q.category ? String(q.category) : ''
  range.value = (RANGE_KEYS.includes(String(q.range)) ? String(q.range) : 'all') as any
  if (range.value === 'custom' && q.start && q.end) customRange.value = [String(q.start), String(q.end)]
}

function applyFilters() {
  page.value = 1
  syncQuery()
  load()
}

function resetFilters() {
  keyword.value = ''
  readState.value = 'all'
  category.value = ''
  range.value = 'all'
  customRange.value = null
  applyFilters()
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
  window.dispatchEvent(new Event('crm:refresh-badges'))
  await load()
}

/** 点击消息：先标已读；提醒触发消息跳到提醒事项详情（由详情页统一“到位”处理） */
async function open(n: any) {
  if (!n.is_read) {
    await api.readNotification(n.id)
    n.is_read = 1
    unread.value = Math.max(0, unread.value - 1)
    window.dispatchEvent(new Event('crm:refresh-badges'))
  }
  if (n.link) router.push(n.link)
}

onMounted(() => {
  readQuery()
  load()
})
</script>

<style scoped>
.page-desc {
  margin: 2px 0 12px;
  font-size: 12px;
  color: var(--crm-text-secondary);
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

.f-item {
  flex: none;
}

.filter-count {
  flex: none;
  font-size: 12px;
  color: var(--crm-text-secondary);
}
</style>
