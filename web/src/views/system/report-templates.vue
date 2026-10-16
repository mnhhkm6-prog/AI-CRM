<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">报表模板</h2>
          <span class="text-muted">自定义报表模板，供报表中心与订阅使用（M15-R5）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
          <el-button v-if="canManage" type="primary" @click="openCreate">新增模板</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-input
          v-model="query.keyword"
          placeholder="模板名称"
          clearable
          style="width: 220px"
        />
        <el-select v-model="query.data_source" placeholder="数据源" clearable style="width: 160px">
          <el-option v-for="(label, value) in DATA_SOURCE_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="query.source" placeholder="来源" clearable style="width: 140px">
          <el-option label="系统预置" value="system" />
          <el-option label="自定义" value="custom" />
        </el-select>
        <div class="filter-bar__spacer" />
        <el-button @click="reset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="filteredItems" size="small" style="width: 100%">
        <el-table-column prop="template_name" label="模板名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="模板类型" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ TEMPLATE_TYPE_LABELS[row.template_type] || row.template_type || '—' }}</template>
        </el-table-column>
        <el-table-column label="数据源" width="110">
          <template #default="{ row }">{{ DATA_SOURCE_LABELS[row.data_source] || row.data_source || '—' }}</template>
        </el-table-column>
        <el-table-column label="图表类型" width="100">
          <template #default="{ row }">{{ CHART_TYPE_LABELS[row.chart_type] || row.chart_type || '—' }}</template>
        </el-table-column>
        <el-table-column label="维度" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ joinLabels(row.dimensions, DIMENSION_LABELS) }}</template>
        </el-table-column>
        <el-table-column label="指标" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ joinLabels(row.metrics, METRIC_LABELS) }}</template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.is_system === 1" type="info" size="small">系统预置</el-tag>
            <el-tag v-else type="success" size="small">自定义</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.is_enabled === 1" type="primary" size="small">启用</el-tag>
            <el-tag v-else type="info" size="small">停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDesign(row)">查看/设计</el-button>
            <el-button link type="primary" @click="openPreview(row)">预览</el-button>
            <el-button v-if="canManage && row.is_system !== 1" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无数据</div>
        </template>
      </el-table>
    </div>

    <!-- 新增模板 -->
    <el-dialog v-model="dialog" title="新增模板" width="480px" align-center>
      <el-form label-width="90px">
        <el-form-item label="模板名称" required>
          <el-input v-model="form.template_name" maxlength="60" placeholder="请输入模板名称" />
        </el-form-item>
        <el-form-item label="模板类型" required>
          <el-select v-model="form.template_type" filterable allow-create placeholder="请选择或输入" style="width: 100%">
            <el-option label="自定义" value="自定义" />
            <el-option label="业务报表" value="业务报表" />
          </el-select>
        </el-form-item>
        <el-form-item label="数据源" required>
          <el-select v-model="form.data_source" placeholder="请选择数据源" style="width: 100%">
            <el-option v-for="(label, value) in DATA_SOURCE_LABELS" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="图表类型">
          <el-select v-model="form.chart_type" style="width: 100%">
            <el-option v-for="(label, value) in CHART_TYPE_LABELS" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmCreate">提交</el-button>
      </template>
    </el-dialog>

    <!-- 预览 -->
    <el-dialog v-model="previewDialog" title="报表预览" width="480px" align-center>
      <el-table v-loading="previewLoading" :data="previewRows" size="small" style="width: 100%">
        <el-table-column v-for="c in previewColumns" :key="c.key" :prop="c.key" :label="c.label" min-width="120" show-overflow-tooltip />
        <template #empty>
          <div class="empty-tip">暂无预览数据</div>
        </template>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const DATA_SOURCE_LABELS: Record<string, string> = {
  opportunities: '商机',
  stale_alerts: '停滞预警',
  loss_records: '失效记录',
}
const CHART_TYPE_LABELS: Record<string, string> = {
  table: '表格',
  bar: '柱状图',
  line: '折线图',
  pie: '饼图',
  funnel: '漏斗图',
}
const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  funnel: '漏斗报表',
  stagnation: '停滞预警复盘',
  loss: '失效原因分析',
  personal: '个人报表',
  team: '团队报表',
}
const DIMENSION_LABELS: Record<string, string> = {
  stage_name_snapshot: '阶段',
  owner_id: '负责人',
  status: '状态',
  is_in_sea: '是否公海',
  customer_id: '客户',
  name: '商机名称',
}
const METRIC_LABELS: Record<string, string> = { amount: '金额' }
/** 预览列标签映射（后端 dim 的 label 为原始键名，需要在此映射为中文） */
const COLUMN_LABELS: Record<string, string> = {
  stage_name_snapshot: '阶段',
  owner_id: '负责人',
  status: '状态',
  is_in_sea: '是否公海',
  customer_id: '客户',
  name: '商机名称',
  alert_level: '预警级别',
  loss_reason: '失效原因',
  department: '部门',
  count: '数量',
  amount: '金额',
}

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])

const dialog = ref(false)
const form = reactive<any>({ template_name: '', template_type: '自定义', data_source: '', chart_type: 'table' })

const query = reactive({ keyword: '', data_source: '', source: '' })

const previewDialog = ref(false)
const previewLoading = ref(false)
const previewColumns = ref<Array<{ key: string; label: string }>>([])
const previewRows = ref<any[]>([])

const canManage = computed(() => userStore.hasPerm('report_template:manage'))

const filteredItems = computed(() =>
  items.value.filter((t) => {
    const kw = query.keyword.trim()
    if (kw && !String(t.template_name || '').includes(kw)) return false
    if (query.data_source && t.data_source !== query.data_source) return false
    if (query.source === 'system' && t.is_system !== 1) return false
    if (query.source === 'custom' && t.is_system === 1) return false
    return true
  })
)

/** 后端可能返回数组或 JSON 字符串，统一转为数组 */
function toArray(v: any): string[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function joinLabels(value: any, labels: Record<string, string>) {
  const text = toArray(value)
    .map((k) => labels[k] || k)
    .join('、')
  return text || '—'
}

async function load() {
  loading.value = true
  try {
    items.value = (await api.listReportTemplates()) || []
  } finally {
    loading.value = false
  }
}

function reset() {
  Object.assign(query, { keyword: '', data_source: '', source: '' })
  load()
}

function openCreate() {
  Object.assign(form, { template_name: '', template_type: '自定义', data_source: '', chart_type: 'table' })
  dialog.value = true
}

async function confirmCreate() {
  if (!form.template_name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  if (!form.template_type) {
    ElMessage.warning('请选择模板类型')
    return
  }
  if (!form.data_source) {
    ElMessage.warning('请选择数据源')
    return
  }
  submitting.value = true
  try {
    const res = await api.createReportTemplate({
      template_name: form.template_name.trim(),
      template_type: form.template_type,
      data_source: form.data_source,
      chart_type: form.chart_type,
    })
    ElMessage.success('模板已创建')
    dialog.value = false
    router.push({ name: 'report-templates-design', params: { id: res.id } })
  } finally {
    submitting.value = false
  }
}

function goDesign(row: any) {
  router.push({ name: 'report-templates-design', params: { id: row.id } })
}

async function openPreview(row: any) {
  previewColumns.value = []
  previewRows.value = []
  previewDialog.value = true
  previewLoading.value = true
  try {
    const res = await api.previewReportTemplate(row.id)
    previewColumns.value = (res?.columns || []).map((c: any) => ({
      ...c,
      label: COLUMN_LABELS[c.label] || c.label,
    }))
    previewRows.value = res?.rows || []
  } finally {
    previewLoading.value = false
  }
}

async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除报表模板「${row.template_name}」？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await api.deleteReportTemplate(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    ElMessage.error(e?.bizMessage || '删除失败')
  }
}

onMounted(load)
</script>
