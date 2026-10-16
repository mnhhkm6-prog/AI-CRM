<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">报表设计</h2>
          <span class="text-muted">{{ form.template_name || '未命名模板' }}</span>
        </div>
        <div class="page-head__right">
          <el-button @click="backToList">返回列表</el-button>
          <el-button v-if="canManage" type="primary" :loading="submitting" @click="save">保存</el-button>
          <el-button :disabled="isNew" @click="loadPreview">预览</el-button>
        </div>
      </div>

      <div class="design-layout">
        <div class="design-form" v-loading="loading">
          <el-form label-width="100px">
            <el-form-item label="模板名称" required>
              <el-input v-model="form.template_name" maxlength="60" placeholder="请输入模板名称" />
            </el-form-item>
            <el-form-item label="模板类型" required>
              <el-select v-model="form.template_type" filterable allow-create placeholder="请选择或输入" style="width: 100%">
                <el-option v-for="(label, value) in TEMPLATE_TYPE_LABELS" :key="value" :label="label" :value="value" />
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
            <el-form-item label="维度">
              <el-select
                v-model="form.dimensions"
                multiple
                :disabled="!dimensionEnabled"
                placeholder="请选择分组维度"
                style="width: 100%"
              >
                <el-option v-for="(label, value) in DIMENSION_LABELS" :key="value" :label="label" :value="value" />
              </el-select>
              <div v-if="!dimensionEnabled" class="text-muted form-tip">仅商机数据源支持维度设置</div>
            </el-form-item>
            <el-form-item label="指标">
              <el-select v-model="form.metrics" multiple placeholder="请选择指标" style="width: 100%">
                <el-option label="金额" value="amount" />
              </el-select>
            </el-form-item>
            <el-form-item label="筛选条件">
              <div class="filter-row">
                <el-select v-model="form.date_field" placeholder="时间字段" style="flex: 1">
                  <el-option label="创建时间" value="created_at" />
                </el-select>
                <el-select v-model="form.recent_days" placeholder="时间范围" style="flex: 1">
                  <el-option label="不限" :value="0" />
                  <el-option label="近 7 天" :value="7" />
                  <el-option label="近 30 天" :value="30" />
                  <el-option label="近 90 天" :value="90" />
                </el-select>
              </div>
            </el-form-item>
            <el-form-item v-if="!isNew" label="启用状态">
              <el-switch v-model="form.is_enabled" />
            </el-form-item>
          </el-form>
        </div>

        <div class="design-preview section-card">
          <h3 class="section-card__title">预览</h3>
          <div v-if="isNew" class="empty-tip">请先保存模板后再预览</div>
          <el-table v-else v-loading="previewLoading" :data="previewRows" size="small" style="width: 100%">
            <el-table-column v-for="c in previewColumns" :key="c.key" :label="c.label" min-width="120">
              <template #default="{ row }">{{ cellText(row[c.key]) }}</template>
            </el-table-column>
            <template #empty>
              <div class="empty-tip">暂无预览数据</div>
            </template>
          </el-table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const route = useRoute()
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
const previewLoading = ref(false)
const previewColumns = ref<Array<{ key: string; label: string }>>([])
const previewRows = ref<any[]>([])

const form = reactive<any>({
  template_name: '',
  template_type: '自定义',
  data_source: '',
  chart_type: 'table',
  dimensions: [] as string[],
  metrics: [] as string[],
  date_field: 'created_at',
  recent_days: 0,
  is_enabled: true,
})

const id = computed(() => String(route.params.id || ''))
const isNew = computed(() => id.value === 'new')
const canManage = computed(() => userStore.hasPerm('report_template:manage'))
const dimensionEnabled = computed(() => form.data_source === 'opportunities')

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

/** 后端可能返回对象或 JSON 字符串，统一转为对象 */
function toObject(v: any): Record<string, any> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v
  if (typeof v === 'string' && v) {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function cellText(v: any) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('zh-CN')
  return String(v)
}

function backToList() {
  router.push('/system/report-templates')
}

async function loadPreview() {
  if (isNew.value) return
  previewLoading.value = true
  try {
    const res = await api.previewReportTemplate(id.value)
    previewColumns.value = (res?.columns || []).map((c: any) => ({
      ...c,
      label: COLUMN_LABELS[c.label] || c.label,
    }))
    previewRows.value = res?.rows || []
  } finally {
    previewLoading.value = false
  }
}

async function load() {
  if (isNew.value) return
  loading.value = true
  try {
    const list = (await api.listReportTemplates()) || []
    const row = list.find((t: any) => String(t.id) === id.value)
    if (!row) {
      ElMessage.error('模板不存在')
      backToList()
      return
    }
    form.template_name = row.template_name || ''
    form.template_type = row.template_type || ''
    form.data_source = row.data_source || ''
    form.chart_type = row.chart_type || 'table'
    form.dimensions = toArray(row.dimensions)
    form.metrics = toArray(row.metrics)
    const filter = toObject(row.filter_config)
    form.date_field = filter.date_field || 'created_at'
    form.recent_days = Number(filter.recent_days) || 0
    form.is_enabled = row.is_enabled === 1
  } finally {
    loading.value = false
  }
}

async function save() {
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
  const body: Record<string, any> = {
    template_name: form.template_name.trim(),
    template_type: form.template_type,
    data_source: form.data_source,
    chart_type: form.chart_type,
    dimensions: form.dimensions,
    metrics: form.metrics,
    filter_config: {
      date_field: form.date_field || 'created_at',
      recent_days: Number(form.recent_days) || 0,
    },
  }
  submitting.value = true
  try {
    if (isNew.value) {
      const res = await api.createReportTemplate(body)
      ElMessage.success('已保存')
      await router.replace({ name: 'report-templates-design', params: { id: res.id } })
    } else {
      body.is_enabled = form.is_enabled ? 1 : 0
      await api.updateReportTemplate(id.value, body)
      ElMessage.success('已保存')
    }
    await loadPreview()
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await load()
  await loadPreview()
})
</script>

<style scoped>
.design-layout {
  display: flex;
  gap: var(--crm-gap);
  align-items: flex-start;
}

.design-form {
  width: 420px;
  flex-shrink: 0;
}

.design-preview {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.form-tip {
  font-size: 12px;
  line-height: 1.4;
}

.filter-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
</style>
