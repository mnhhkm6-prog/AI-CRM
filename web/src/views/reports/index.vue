<template>
  <div class="page">
    <div class="report-layout">
      <!-- 左栏：报表目录（5 个预置报表 + 自定义模板 + 订阅管理） -->
      <aside class="report-nav">
        <div class="report-nav__head">预置报表</div>
        <ul class="report-nav__list">
          <li
            v-for="r in PRESET_REPORTS"
            :key="r.key"
            :class="['report-nav__item', { 'report-nav__item--active': current === r.key }]"
            @click="switchReport(r.key)"
          >
            <el-icon><component :is="r.icon" /></el-icon>
            <span>{{ r.label }}</span>
          </li>
        </ul>

        <div class="report-nav__head">
          自定义模板
          <el-button link type="primary" size="small" @click="loadTemplates">刷新</el-button>
        </div>
        <ul class="report-nav__list">
          <li
            v-for="t in templates"
            :key="t.id"
            :class="['report-nav__item', { 'report-nav__item--active': current === t.id }]"
            @click="switchTemplate(t)"
          >
            <el-icon><Histogram /></el-icon>
            <span :title="t.template_name">{{ t.template_name }}</span>
          </li>
          <li v-if="!templates.length" class="report-nav__empty">暂无自定义模板</li>
        </ul>

        <div class="report-nav__foot">
          <el-button link type="primary" @click="router.push('/report-subscriptions')">订阅管理</el-button>
        </div>
      </aside>

      <!-- 右栏：报表内容 -->
      <section class="report-main">
        <div class="page-card">
          <div class="page-head">
            <div class="page-head__left">
              <h2 class="page-title">{{ title }}</h2>
              <span class="scope-badge">{{ scopeText }}</span>
            </div>
            <div class="page-head__right">
              <el-button v-if="!isTemplate" :loading="exporting" @click="exportCurrent('excel')">导出 Excel</el-button>
              <el-button v-if="!isTemplate" :loading="exporting" @click="exportCurrent('html')">导出 PDF</el-button>
              <el-button @click="reload">刷新</el-button>
            </div>
          </div>

          <div v-if="!isTemplate" class="filter-bar">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              style="width: 250px"
              @change="reload"
            />
            <el-select
              v-if="current === 'funnel' || current === 'stagnation' || current === 'loss'"
              v-model="query.owner_id"
              placeholder="负责人"
              clearable
              filterable
              style="width: 170px"
              @change="reload"
            >
              <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-tree-select
              v-if="current === 'funnel' || current === 'team'"
              v-model="query.department_id"
              :data="deptTree"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              check-strictly
              clearable
              placeholder="部门"
              style="width: 200px"
              @change="reload"
            />
            <el-select
              v-if="current === 'personal'"
              v-model="query.user_id"
              placeholder="选择销售"
              clearable
              filterable
              style="width: 200px"
              @change="reload"
            >
              <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-select v-if="current === 'funnel'" v-model="query.date_field" style="width: 150px" @change="reload">
              <el-option label="按创建时间" value="created_at" />
              <el-option label="按阶段变更时间" value="stage_changed_at" />
            </el-select>
            <div class="filter-bar__spacer" />
            <el-button @click="reset">重置</el-button>
          </div>
        </div>

        <div v-loading="loading" class="report-body">
          <!-- 概览指标 -->
          <el-row v-if="summaryCards.length" :gutter="12" class="mb-12">
            <el-col v-for="c in summaryCards" :key="c.label" :xs="12" :sm="8" :md="6">
              <div class="stat">
                <p class="stat__label">{{ c.label }}</p>
                <p class="stat__value">{{ c.value }}</p>
              </div>
            </el-col>
          </el-row>

          <!-- 图表 -->
          <div v-if="hasChart" class="page-card">
            <h3 class="section-card__title">{{ chartTitle }}</h3>
            <div ref="chartRef" class="chart" />
          </div>

          <!-- 明细表 -->
          <div v-if="tableColumns.length" class="page-card">
            <h3 class="section-card__title">{{ tableTitle }}</h3>
            <el-table :data="tableRows" size="small" style="width: 100%" max-height="420">
              <el-table-column
                v-for="col in tableColumns"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                :width="col.width"
                :min-width="col.minWidth"
                :align="col.align || 'left'"
                :class-name="col.align === 'right' ? 'num' : ''"
                show-overflow-tooltip
              >
                <template v-if="col.format" #default="{ row }">{{ col.format(row[col.key], row) }}</template>
              </el-table-column>
              <template #empty>
                <div class="empty-tip">当前筛选条件下暂无数据</div>
              </template>
            </el-table>
          </div>

          <!-- 附加表（失效复盘：可挽回清单） -->
          <div v-if="extra.title" class="page-card">
            <h3 class="section-card__title">{{ extra.title }}</h3>
            <el-table :data="extra.rows" size="small" style="width: 100%" max-height="360">
              <el-table-column
                v-for="col in extra.columns"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                :width="col.width"
                :min-width="col.minWidth"
                show-overflow-tooltip
              />
              <template #empty>
                <div class="empty-tip">暂无数据</div>
              </template>
            </el-table>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { loadOwnerOptions, type Option } from '@/config/options'

interface TableColumn {
  key: string
  label: string
  width?: number
  minWidth?: number
  align?: 'left' | 'right'
  format?: (v: any, row: any) => string
}

const router = useRouter()
const userStore = useUserStore()

const PRESET_REPORTS = [
  { key: 'funnel', label: '漏斗报表', icon: 'Filter' },
  { key: 'stagnation', label: '停滞复盘', icon: 'AlarmClock' },
  { key: 'loss', label: '失效复盘', icon: 'CircleClose' },
  { key: 'personal', label: '销售个人报表', icon: 'User' },
  { key: 'team', label: '团队报表', icon: 'UserFilled' },
]

const loading = ref(false)
const exporting = ref(false)
const current = ref('funnel')
const currentTemplate = ref<any>(null)
const dateRange = ref<[string, string] | null>(null)
const owners = ref<Option[]>([])
const deptTree = ref<any[]>([])
const templates = ref<any[]>([])
const data = ref<any>(null)

const chartRef = ref<HTMLDivElement | null>(null)
const chartInstance = shallowRef<echarts.ECharts | null>(null)

const query = reactive<Record<string, any>>({ owner_id: '', department_id: '', user_id: '', date_field: 'created_at' })

const isTemplate = computed(() => !!currentTemplate.value)
const scopeText = computed(() => userStore.scopeBadge('opportunity'))
const title = computed(() =>
  isTemplate.value ? currentTemplate.value.template_name : PRESET_REPORTS.find((r) => r.key === current.value)?.label || '报表中心'
)

const money = (v: any) => Number(v || 0).toLocaleString('zh-CN')
const fmtDate = (iso?: string) => String(iso || '').slice(0, 16).replace('T', ' ') || '—'
const percent = (v: any) => `${(Number(v || 0) * 100).toFixed(1)}%`
const levelText = (lv: number) => (lv === 3 ? '三级' : lv === 2 ? '二级' : lv === 1 ? '一级' : '—')

/* ---------------- 概览指标 ---------------- */
const summaryCards = computed<Array<{ label: string; value: string }>>(() => {
  const d = data.value
  // 自定义模板预览数据无 summary 结构，不展示概览指标
  if (!d || isTemplate.value || !d.summary) return []
  if (current.value === 'funnel') {
    return [
      { label: '商机总数', value: money(d.summary.count) },
      { label: '商机总金额', value: money(d.summary.amount) },
      { label: '赢单数', value: money(d.summary.won_count) },
      { label: '赢单率', value: percent(d.summary.win_rate) },
      { label: '待验证（S0）', value: `${money(d.summary.pending_count)} 个 · ${money(d.summary.pending_amount)}` },
    ]
  }
  if (current.value === 'stagnation') {
    return [
      { label: '预警总数', value: money(Number(d.resolved.resolved) + Number(d.resolved.unresolved)) },
      { label: '已解除', value: money(d.resolved.resolved) },
      { label: '未解除', value: money(d.resolved.unresolved) },
      { label: '平均停滞天数', value: `${d.avg_days_stagnant} 天` },
    ]
  }
  if (current.value === 'loss') {
    return [
      { label: '失效总数', value: money(d.summary.count) },
      { label: '失效金额', value: money(d.summary.amount) },
      { label: '可挽回', value: money(d.recoverable.length) },
    ]
  }
  if (current.value === 'personal') {
    const s = d.summary
    return [
      { label: '商机数', value: money(s.opportunity_count) },
      { label: '赢单 / 失败', value: `${money(s.won_count)} / ${money(s.lost_count)}` },
      { label: '赢单金额', value: money(s.won_amount) },
      { label: '赢单率', value: percent(s.win_rate) },
      { label: '行为记录数', value: money(s.activity_count) },
    ]
  }
  if (current.value === 'team') {
    const s = d.summary
    return [
      { label: '成员数', value: money(s.member_count) },
      { label: '商机数', value: money(s.opportunity_count) },
      { label: '商机金额', value: money(s.amount) },
      { label: '赢单数', value: money(s.won_count) },
      { label: '赢单率', value: percent(s.win_rate) },
    ]
  }
  return []
})

/* ---------------- 图表 ---------------- */
const hasChart = computed(() => {
  const d = data.value
  if (!d || isTemplate.value) return false
  if (current.value === 'funnel') return (d.list || []).some((r: any) => r.stage_code !== 'S0')
  if (current.value === 'stagnation') return (d.by_level || []).length > 0
  if (current.value === 'loss') return (d.by_reason || []).length > 0
  return (d.stage_distribution || []).length > 0
})

const chartTitle = computed(() => {
  const map: Record<string, string> = {
    funnel: '阶段漏斗',
    stagnation: '预警级别分布',
    loss: '失效原因分布',
    personal: '阶段分布',
    team: '阶段分布',
  }
  return map[current.value] || '图表'
})

const AXIS_STYLE = { axisLine: { lineStyle: { color: '#dcdfe6' } }, axisLabel: { color: '#606266', fontSize: 12 } }

function chartOption(): echarts.EChartsOption | null {
  const d = data.value
  if (!d) return null
  const PRIMARY = '#344d13'
  if (current.value === 'funnel') {
    // 主漏斗从 S1 起算，S0 单独作为待验证口径
    const rows = (d.list || []).filter((r: any) => r.stage_code !== 'S0')
    return {
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}<br/>商机数：${money(p.value)}` },
      series: [
        {
          type: 'funnel',
          left: '10%',
          width: '80%',
          minSize: '20%',
          sort: 'ascending',
          gap: 2,
          label: { position: 'inside', formatter: (p: any) => `${p.name} ${money(p.value)}` },
          itemStyle: { borderColor: '#fff', borderWidth: 1 },
          color: ['#9aa689', '#71825a', '#4a5c7a', '#344d13', '#2a3e0f', '#c2cab8'],
          data: rows.map((r: any) => ({ name: `${r.stage_name || '未分阶段'}`, value: r.count })),
        },
      ],
    }
  }
  if (current.value === 'stagnation') {
    const rows = d.by_level || []
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: rows.map((r: any) => levelText(r.alert_level)), ...AXIS_STYLE },
      yAxis: { type: 'value', ...AXIS_STYLE },
      series: [
        {
          type: 'bar',
          barWidth: 40,
          data: rows.map((r: any, i: number) => ({
            value: r.count,
            itemStyle: { color: ['#e6a23c', '#f56c6c', '#c45656'][i] || PRIMARY },
          })),
          label: { show: true, position: 'top' },
        },
      ],
    }
  }
  if (current.value === 'loss') {
    const rows = d.by_reason || []
    return {
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}<br/>数量：${p.value}（${p.percent}%）` },
      legend: { bottom: 0, type: 'scroll' },
      series: [
        {
          type: 'pie',
          radius: ['40%', '68%'],
          center: ['50%', '45%'],
          label: { formatter: '{b} {c}' },
          color: ['#344d13', '#71825a', '#9aa689', '#4a5c7a', '#e6a23c', '#c2cab8'],
          data: rows.map((r: any) => ({ name: r.loss_reason || '未填写', value: r.count })),
        },
      ],
    }
  }
  const rows = d.stage_distribution || []
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: rows.map((r: any) => r.stage_name || '未分阶段'), ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, interval: 0, rotate: 20 } },
    yAxis: { type: 'value', ...AXIS_STYLE },
    series: [{ type: 'bar', barWidth: 32, itemStyle: { color: PRIMARY }, label: { show: true, position: 'top' }, data: rows.map((r: any) => r.count) }],
  }
}

function renderChart() {
  const option = hasChart.value ? chartOption() : null
  if (!option || !chartRef.value) {
    chartInstance.value?.dispose()
    chartInstance.value = null
    return
  }
  if (!chartInstance.value) chartInstance.value = echarts.init(chartRef.value)
  chartInstance.value.setOption(option as any, true)
  chartInstance.value.resize()
}

function onResize() {
  chartInstance.value?.resize()
}

/* ---------------- 明细表 ---------------- */
const tableTitle = computed(() => {
  const map: Record<string, string> = {
    funnel: '阶段明细',
    stagnation: '未推进 TOP 50',
    loss: '失效原因明细',
    personal: '阶段分布',
    team: '成员业绩',
  }
  return isTemplate.value ? '预览数据' : map[current.value] || '明细'
})

const tableColumns = computed<TableColumn[]>(() => {
  const d = data.value
  if (!d) return []
  if (isTemplate.value) return (d.columns || []).map((c: any) => ({ key: c.key, label: c.label }))
  if (current.value === 'funnel') {
    return [
      { key: 'stage_name', label: '阶段', minWidth: 180, format: (v) => v || '未分阶段' },
      { key: 'count', label: '商机数', width: 100, align: 'right' },
      { key: 'amount', label: '金额', width: 140, align: 'right', format: money },
    ]
  }
  if (current.value === 'stagnation') {
    return [
      { key: 'opportunity_name', label: '商机', minWidth: 180 },
      { key: 'customer_name', label: '客户', minWidth: 140, format: (v) => v || '—' },
      { key: 'stage_name', label: '阶段', width: 150, format: (v) => v || '—' },
      { key: 'days_stagnant', label: '停滞天数', width: 100, align: 'right' },
      { key: 'owner_name', label: '负责人', width: 110, format: (v) => v || '—' },
      { key: 'last_activity_at', label: '最后推进时间', width: 160, format: fmtDate },
    ]
  }
  if (current.value === 'loss') {
    return [
      { key: 'loss_reason', label: '失效原因', minWidth: 160, format: (v) => v || '未填写' },
      { key: 'count', label: '数量', width: 100, align: 'right' },
      { key: 'amount', label: '金额', width: 140, align: 'right', format: money },
    ]
  }
  if (current.value === 'personal') {
    return [
      { key: 'stage_name', label: '阶段', minWidth: 180, format: (v) => v || '未分阶段' },
      { key: 'count', label: '商机数', width: 100, align: 'right' },
      { key: 'amount', label: '金额', width: 140, align: 'right', format: money },
    ]
  }
  return [
    { key: 'user_name', label: '成员', minWidth: 140 },
    { key: 'opportunity_count', label: '商机数', width: 100, align: 'right' },
    { key: 'won_count', label: '赢单数', width: 100, align: 'right' },
    { key: 'amount', label: '金额', width: 140, align: 'right', format: money },
    { key: 'win_rate', label: '赢单率', width: 100, align: 'right', format: percent },
  ]
})

const tableRows = computed<any[]>(() => {
  const d = data.value
  if (!d) return []
  if (isTemplate.value) return d.rows || []
  if (current.value === 'funnel') {
    return (d.list || []).map((r: any) =>
      r.stage_code === 'S0' ? { ...r, stage_name: `${r.stage_name || '未分阶段'}（待验证）` } : r
    )
  }
  if (current.value === 'stagnation') return d.unadvanced_top || []
  if (current.value === 'loss') return d.by_reason || []
  if (current.value === 'personal') return d.stage_distribution || []
  return d.members || []
})

const extra = computed<{ title: string; columns: TableColumn[]; rows: any[] }>(() => {
  const d = data.value
  if (!d || isTemplate.value || current.value !== 'loss') return { title: '', columns: [], rows: [] }
  return {
    title: `可挽回清单（${(d.recoverable || []).length}）`,
    columns: [
      { key: 'opportunity_name', label: '商机', minWidth: 180 },
      { key: 'customer_name', label: '客户', minWidth: 140 },
      { key: 'recovery_plan', label: '挽回计划', minWidth: 220 },
      { key: 'follow_up_date', label: '计划跟进日期', width: 130 },
    ],
    rows: d.recoverable || [],
  }
})

/* ---------------- 数据加载 ---------------- */
function buildParams(): Record<string, any> {
  const params: Record<string, any> = {}
  if (dateRange.value) {
    params.start_date = dateRange.value[0]
    params.end_date = dateRange.value[1]
  }
  if (current.value === 'personal') {
    if (query.user_id) params.user_id = query.user_id
  } else if (current.value === 'team') {
    if (query.department_id) params.department_id = query.department_id
  } else {
    if (query.owner_id) params.owner_id = query.owner_id
    if (query.department_id) params.team_id = query.department_id
    if (current.value === 'funnel') params.date_field = query.date_field || 'created_at'
  }
  return params
}

const LOADERS: Record<string, (params: any) => Promise<any>> = {
  funnel: api.reportFunnel,
  stagnation: api.reportStagnation,
  loss: api.reportLoss,
  personal: api.reportPersonal,
  team: api.reportTeam,
}

async function load() {
  loading.value = true
  try {
    if (isTemplate.value) {
      data.value = await api.previewReportTemplate(currentTemplate.value.id)
    } else {
      data.value = await LOADERS[current.value](buildParams())
    }
    await nextTick()
    renderChart()
  } finally {
    loading.value = false
  }
}

function reload() {
  load()
}

function reset() {
  dateRange.value = null
  query.owner_id = ''
  query.department_id = ''
  query.user_id = ''
  query.date_field = 'created_at'
  load()
}

function switchReport(key: string) {
  currentTemplate.value = null
  current.value = key
  data.value = null
  load()
}

function switchTemplate(t: any) {
  currentTemplate.value = t
  data.value = null
  load()
}

async function exportCurrent(format: 'excel' | 'html') {
  exporting.value = true
  try {
    await api.exportReport(current.value, buildParams(), format)
    ElMessage.success(format === 'excel' ? '导出完成，文件已开始下载' : '已生成可打印 HTML，可在浏览器中另存为 PDF')
  } finally {
    exporting.value = false
  }
}

async function loadTemplates() {
  try {
    templates.value = await api.listReportTemplates()
  } catch (e) {
    templates.value = []
  }
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  if (userStore.hasPerm('user:view')) {
    owners.value = await loadOwnerOptions(true, userStore.profile || undefined)
  } else {
    owners.value = await loadOwnerOptions(false, userStore.profile || undefined)
  }
  try {
    deptTree.value = await api.listDepartments()
  } catch (e) {
    deptTree.value = []
  }
  await loadTemplates()
  await load()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chartInstance.value?.dispose()
  chartInstance.value = null
})
</script>

<style scoped>
.report-layout {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.report-nav {
  width: 200px;
  flex-shrink: 0;
  background: var(--crm-card);
  border-radius: var(--crm-radius);
  padding: 8px 0;
  position: sticky;
  top: 12px;
}

.report-nav__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.report-nav__list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.report-nav__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 34px;
  cursor: pointer;
  color: var(--crm-text-regular);
  border-left: 3px solid transparent;
  transition: background 0.15s;
}

.report-nav__item:hover {
  background: #f5f7fa;
}

.report-nav__item--active {
  background: var(--el-color-primary-light-9);
  color: var(--crm-primary);
  border-left-color: var(--crm-primary);
  font-weight: 600;
}

.report-nav__item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-nav__empty {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.report-nav__foot {
  padding: 8px 12px 0;
  border-top: 1px solid var(--crm-border);
}

.report-main {
  flex: 1;
  min-width: 0;
}

.report-body {
  min-height: 200px;
}

.stat {
  background: var(--crm-card);
  border-radius: var(--crm-radius);
  border-top: 3px solid var(--crm-primary);
  padding: 12px;
  margin-bottom: 12px;
}

.stat__label {
  margin: 0;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.stat__value {
  margin: 6px 0 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--crm-text);
  font-variant-numeric: tabular-nums;
}

.chart {
  height: 320px;
  width: 100%;
}

@media (max-width: 1200px) {
  /* 左栏为报表主入口，窄屏下收窄而非隐藏 */
  .report-nav {
    width: 168px;
  }

  .report-nav__item {
    padding: 0 8px;
    font-size: 12px;
  }
}
</style>
