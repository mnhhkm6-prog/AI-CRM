<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">报表订阅管理</h2>
          <span class="text-muted">按频率自动推送报表给指定接收人（M15-R6）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
          <el-button type="primary" @click="openCreate">新建订阅</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column label="报表模板" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.template_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="推送频率" width="110" align="center">
          <template #default="{ row }">{{ FREQ_LABEL[row.frequency] || row.frequency }}</template>
        </el-table-column>
        <el-table-column label="导出格式" width="100" align="center">
          <template #default="{ row }">{{ FORMAT_LABEL[row.format] || row.format }}</template>
        </el-table-column>
        <el-table-column label="接收人" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ receiverText(row.receivers) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.is_enabled ? 'success' : 'info'" effect="plain">
              {{ row.is_enabled ? '已启用' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" @click="toggle(row)">{{ row.is_enabled ? '停用' : '启用' }}</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无报表订阅</div>
        </template>
      </el-table>
    </div>

    <!-- 新建 / 编辑订阅 -->
    <el-dialog v-model="dialog" :title="editing ? '编辑订阅' : '新建订阅'" width="480px" align-center @closed="resetForm">
      <el-form label-width="90px">
        <el-form-item label="报表模板" required>
          <el-select v-model="form.template_id" placeholder="请选择报表模板" filterable style="width: 100%">
            <el-option v-for="t in templates" :key="t.id" :label="t.template_name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="推送频率" required>
          <el-select v-model="form.frequency" placeholder="请选择推送频率" style="width: 100%">
            <el-option label="每日" value="daily" />
            <el-option label="每周" value="weekly" />
            <el-option label="每月" value="monthly" />
          </el-select>
        </el-form-item>
        <el-form-item label="导出格式" required>
          <el-radio-group v-model="form.format">
            <el-radio value="excel">Excel</el-radio>
            <el-radio value="html">HTML / PDF</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="接收人" required>
          <el-select
            v-model="form.receivers"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="请选择接收人"
            style="width: 100%"
          >
            <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { loadOwnerOptions, type Option } from '@/config/options'

const userStore = useUserStore()

const FREQ_LABEL: Record<string, string> = { daily: '每日', weekly: '每周', monthly: '每月' }
const FORMAT_LABEL: Record<string, string> = { excel: 'Excel', html: 'HTML / PDF' }

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const templates = ref<any[]>([])
const owners = ref<Option[]>([])

const dialog = ref(false)
const editing = ref<any>(null)
const form = reactive<any>({ template_id: '', frequency: 'weekly', format: 'excel', receivers: [] })

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function receiverText(receivers: any) {
  if (!Array.isArray(receivers) || !receivers.length) return '—'
  return receivers
    .map((r: any) => {
      const id = typeof r === 'string' ? r : r?.id
      const name = typeof r === 'string' ? owners.value.find((o) => o.value === id)?.label : r?.name
      return name || id || '—'
    })
    .join('、')
}

async function load() {
  loading.value = true
  try {
    items.value = await api.listReportSubscriptions()
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { template_id: '', frequency: 'weekly', format: 'excel', receivers: [] })
  dialog.value = true
}

function openEdit(row: any) {
  editing.value = row
  Object.assign(form, {
    template_id: row.template_id || '',
    frequency: row.frequency || 'weekly',
    format: row.format || 'excel',
    receivers: Array.isArray(row.receivers) ? row.receivers.map((r: any) => (typeof r === 'string' ? r : r?.id)).filter(Boolean) : [],
  })
  dialog.value = true
}

function resetForm() {
  editing.value = null
}

async function confirmSubmit() {
  if (!form.template_id) {
    ElMessage.warning('请选择报表模板')
    return
  }
  if (!form.frequency) {
    ElMessage.warning('请选择推送频率')
    return
  }
  if (!form.receivers.length) {
    ElMessage.warning('请选择接收人')
    return
  }
  submitting.value = true
  try {
    const body = {
      template_id: form.template_id,
      frequency: form.frequency,
      format: form.format,
      receivers: form.receivers,
    }
    if (editing.value) {
      await api.updateReportSubscription(editing.value.id, body)
      ElMessage.success('已保存')
    } else {
      await api.createReportSubscription(body)
      ElMessage.success('订阅已创建')
    }
    dialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function toggle(row: any) {
  await api.updateReportSubscription(row.id, { is_enabled: row.is_enabled ? 0 : 1 })
  ElMessage.success(row.is_enabled ? '已停用' : '已启用')
  await load()
}

async function remove(row: any) {
  await ElMessageBox.confirm('确认删除该报表订阅？', '删除确认', { type: 'warning' })
  await api.deleteReportSubscription(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  try {
    templates.value = await api.listReportTemplates()
  } catch (e) {
    templates.value = []
  }
  await load()
})
</script>
