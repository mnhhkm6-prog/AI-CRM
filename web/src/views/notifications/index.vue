<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">消息通知中心</h2>
          <span class="scope-badge">未读 {{ unread }}</span>
        </div>
        <div class="page-head__right">
          <el-button :disabled="!unread" @click="markAll">全部已读</el-button>
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-radio-group v-model="readState" @change="reload">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="unread">未读</el-radio-button>
          <el-radio-button value="read">已读</el-radio-button>
        </el-radio-group>
        <el-select v-model="category" placeholder="全部类型" clearable style="width: 160px" @change="reload">
          <el-option v-for="c in CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
        </el-select>
        <div class="filter-bar__spacer" />
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Checked, Timer, Warning } from '@element-plus/icons-vue'
import * as api from '@/api'

const router = useRouter()

const CATEGORIES = [
  { value: 'alert', label: '停滞预警' },
  { value: 'approval', label: '审批通知' },
  { value: 'reminder', label: '回访提醒' },
]

const loading = ref(false)
const items = ref<any[]>([])
const unread = ref(0)
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const category = ref('')
const readState = ref<'all' | 'unread' | 'read'>('all')

function labelOf(c: string) {
  return CATEGORIES.find((x) => x.value === c)?.label || '通知'
}

function iconOf(c: string) {
  if (c === 'alert') return { icon: Warning, color: 'var(--crm-alert-1)' }
  if (c === 'approval') return { icon: Checked, color: 'var(--crm-neutral)' }
  if (c === 'reminder') return { icon: Timer, color: 'var(--crm-primary)' }
  return { icon: Bell, color: 'var(--crm-text-secondary)' }
}

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ')
}

async function load() {
  loading.value = true
  try {
    const res = await api.listNotifications({
      page: page.value,
      page_size: pageSize.value,
      category: category.value || undefined,
      is_read: readState.value === 'all' ? undefined : readState.value === 'read' ? 'true' : 'false',
    })
    items.value = res.list || []
    total.value = res.total || 0
    unread.value = res.unread || 0
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

onMounted(load)
</script>

<style scoped>
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
</style>
