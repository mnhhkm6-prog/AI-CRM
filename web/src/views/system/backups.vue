<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">数据备份</h2>
          <span class="text-muted">备份数据库文件，保留最近 100 条记录（M10-R4）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
          <el-button v-if="canManage" type="primary" :loading="creating" @click="create">立即备份</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column label="备份文件" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">{{ fileName(row.file_path) }}</template>
        </el-table-column>
        <el-table-column label="文件大小" width="120" align="right" class-name="num">
          <template #default="{ row }">{{ fileSize(row.file_size) }}</template>
        </el-table-column>
        <el-table-column label="备份类型" width="110" align="center">
          <template #default="{ row }">{{ row.backup_type === 'manual' ? '手动备份' : row.backup_type || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'success' ? 'success' : 'danger'" effect="plain">
              {{ row.status === 'success' ? '成功' : row.status || '—' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建人" width="110">
          <template #default="{ row }">{{ userName(row.created_by) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canManage" link type="primary" @click="restore(row)">恢复</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无备份记录</div>
        </template>
      </el-table>

      <el-alert type="info" :closable="false" show-icon class="mt-12" title="恢复说明">
        <template #default>
          <p class="tip">恢复操作会以备份文件覆盖当前数据库，建议先执行一次「立即备份」再恢复；恢复完成后需重启后端服务方可完全生效。</p>
        </template>
      </el-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { loadOwnerOptions, type Option } from '@/config/options'

const userStore = useUserStore()

const loading = ref(false)
const creating = ref(false)
const items = ref<any[]>([])
const owners = ref<Option[]>([])

const canManage = computed(() => userStore.hasPerm('system_config:manage'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 19).replace('T', ' ') || '—'
}

function fileName(p?: string) {
  if (!p) return '—'
  return String(p).split(/[\\/]/).pop() || p
}

function fileSize(v?: number) {
  const n = Number(v || 0)
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function userName(id?: string) {
  if (!id) return '—'
  return owners.value.find((o) => o.value === id)?.label || id
}

async function load() {
  loading.value = true
  try {
    items.value = await api.listBackups()
  } finally {
    loading.value = false
  }
}

async function create() {
  creating.value = true
  try {
    await api.createBackup()
    ElMessage.success('备份完成')
    await load()
  } finally {
    creating.value = false
  }
}

async function restore(row: any) {
  await ElMessageBox.confirm(
    `恢复将用备份「${fileName(row.file_path)}」覆盖当前数据库，未备份的变更会丢失。确认恢复？`,
    '恢复确认',
    { type: 'warning', confirmButtonText: '确认恢复' }
  )
  await api.restoreBackup(row.id)
  ElMessage.success('数据库文件已回写，建议重启后端服务以生效')
  await load()
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  await load()
})
</script>

<style scoped>
.tip {
  margin: 0;
  line-height: 1.6;
}
</style>
