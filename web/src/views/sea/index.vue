<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">{{ pageTitle }}</h2>
          <span class="scope-badge">{{ modeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-input
          v-model="query.keyword"
          :placeholder="`${typeLabel}名称`"
          clearable
          style="width: 200px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <el-select v-model="ownerFilter" style="width: 140px" @change="onOwnerFilterChange">
          <el-option label="全部来源" value="all" />
          <el-option label="我转出的" value="me" />
        </el-select>
        <el-select
          v-if="userOptions.length"
          v-model="filters.previousOwner"
          placeholder="原负责人（输入搜索）"
          clearable
          filterable
          remote
          :remote-method="searchOwners"
          style="width: 170px"
          @change="reload"
          @visible-change="onOwnerDropdown"
        >
          <el-option v-for="u in ownerCandidates" :key="u.id" :label="u.name" :value="u.id" />
        </el-select>
        <el-select v-model="filters.source" placeholder="转入方式" clearable style="width: 140px" @change="reload">
          <el-option v-for="(label, value) in SOURCE_MAP" :key="value" :label="label" :value="value" />
        </el-select>
        <el-date-picker
          v-model="filters.dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="入海开始"
          end-placeholder="入海结束"
          style="width: 230px"
          @change="reload"
        />
        <el-select v-model="filters.protectState" placeholder="保护期" clearable style="width: 120px" @change="reload">
          <el-option label="保护期内" value="yes" />
          <el-option label="已过保护期" value="no" />
        </el-select>

        <template v-if="tab === 'customer'">
          <el-select v-model="filters.customerType" placeholder="客户类型" clearable style="width: 110px" @change="reload">
            <el-option label="企业" value="企业" />
            <el-option label="个人" value="个人" />
          </el-select>
          <el-select v-model="filters.industry" placeholder="所属行业" clearable style="width: 130px" @change="reload">
            <el-option v-for="o in industryOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </template>

        <template v-else-if="tab === 'opportunity'">
          <el-input
            v-model="filters.customerName"
            placeholder="所属客户"
            clearable
            style="width: 130px"
            @keyup.enter="reload"
            @clear="reload"
          />
          <el-input-number
            v-model="filters.amountMin"
            :controls="false"
            placeholder="金额下限"
            style="width: 100px"
            @change="reload"
          />
          <span class="range-sep">-</span>
          <el-input-number
            v-model="filters.amountMax"
            :controls="false"
            placeholder="金额上限"
            style="width: 100px"
            @change="reload"
          />
          <el-select v-model="filters.stage" placeholder="阶段" clearable style="width: 140px" @change="reload">
            <el-option v-for="s in stages" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </template>

        <template v-else>
          <el-select v-model="filters.sourceChannel" placeholder="来源渠道" clearable style="width: 130px" @change="reload">
            <el-option v-for="o in sourceChannelOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </template>

        <div class="filter-bar__spacer" />
        <span class="filter-count">共 {{ total }} 条</span>
        <el-button v-if="showAssign" :disabled="!selected.length" @click="openAssign">分配给销售</el-button>
        <el-button v-if="showPickup" type="primary" :disabled="!selected.length" @click="batchPickup">批量领取</el-button>
        <el-button @click="reset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%" @selection-change="onSelectionChange">
        <el-table-column
          v-if="showAssign || showPickup"
          type="selection"
          width="44"
          :selectable="isRowSelectable"
        />
        <el-table-column label="名称" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="goEntity(row)">{{ row.entity_name || '—' }}</el-link>
          </template>
        </el-table-column>
        <template v-if="tab === 'lead'">
          <el-table-column label="联系人" width="100">
            <template #default="{ row }">{{ row.contact_name || '—' }}</template>
          </el-table-column>
          <el-table-column label="联系电话" width="130">
            <template #default="{ row }">{{ row.contact_phone || '—' }}</template>
          </el-table-column>
          <el-table-column label="微信号" width="130">
            <template #default="{ row }">{{ row.wechat || '—' }}</template>
          </el-table-column>
          <el-table-column label="来源渠道" width="110">
            <template #default="{ row }">{{ row.source_channel || '—' }}</template>
          </el-table-column>
          <el-table-column label="关联客户" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.customer_name || '—' }}</template>
          </el-table-column>
        </template>
        <el-table-column v-if="tab === 'customer'" label="所属行业" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.industry || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="tab === 'customer'" label="随迁商机" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.bundled_count" size="small" effect="plain">{{ row.bundled_count }} 个</el-tag>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <template v-if="tab === 'opportunity'">
          <el-table-column label="所属客户" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.customer_name || '—' }}</template>
          </el-table-column>
          <el-table-column label="客户归属" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.customer_in_sea" size="small" type="warning" effect="plain">客户在公海</el-tag>
              <span v-else>{{ row.customer_owner_name || '—' }}</span>
            </template>
          </el-table-column>
        </template>
        <el-table-column label="原负责人" width="100">
          <template #default="{ row }">{{ row.previous_owner_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="入公海时间" width="150">
          <template #default="{ row }">{{ fmt(row.entered_at) }}</template>
        </el-table-column>
        <el-table-column label="入公海来源" width="120">
          <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="入公海原因" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="认领人" width="100">
          <template #default="{ row }">{{ row.claimed_by_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="保护期" width="110" align="center">
          <template #default="{ row }">
            <el-tag v-if="isProtected(row.protect_until)" size="small" effect="plain">🔒 保护期</el-tag>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">跟进详情</el-button>
            <el-button
              v-if="showPickup && !pickupBlocked(row) && !needCustomerFirst(row)"
              link
              type="primary"
              @click="pickup(row)"
            >
              领取
            </el-button>
            <el-tag v-else-if="needCustomerFirst(row)" size="small" type="warning" effect="plain">需先领客户</el-tag>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无公海数据</div>
        </template>
      </el-table>

      <el-pagination
        v-if="total > 0"
        class="mt-12"
        layout="total, sizes, prev, pager, next"
        :total="total"
        :page-size="query.page_size"
        :current-page="query.page"
        :page-sizes="[20, 50, 100]"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <!-- 跟进详情抽屉 -->
    <el-drawer v-model="detailDrawer" title="跟进详情" size="480px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="section-card">
            <h3 class="section-card__title">基本信息</h3>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="名称">{{ detail.entity?.name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="公海类型">{{ typeLabel }}</el-descriptions-item>
              <template v-if="tab === 'lead'">
                <el-descriptions-item label="联系人">{{ detail.entity?.contact_name || '—' }}</el-descriptions-item>
                <el-descriptions-item label="联系电话">{{ detail.entity?.contact_phone || '—' }}</el-descriptions-item>
                <el-descriptions-item label="微信号">{{ detail.entity?.wechat || '—' }}</el-descriptions-item>
                <el-descriptions-item label="来源渠道">{{ detail.entity?.source_channel || '—' }}</el-descriptions-item>
                <el-descriptions-item label="关联客户">{{ detail.entity?.customer_name || '—' }}</el-descriptions-item>
                <el-descriptions-item label="录入时间">{{ fmt(detail.entity?.created_at) }}</el-descriptions-item>
              </template>
              <el-descriptions-item label="原负责人">{{ detail.previous_owner_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="入公海时间">{{ fmt(detail.entered_at) }}</el-descriptions-item>
              <el-descriptions-item label="入公海来源">{{ sourceLabel(detail.record?.source) }}</el-descriptions-item>
              <el-descriptions-item label="入公海原因">{{ detail.record?.reason || '—' }}</el-descriptions-item>
              <el-descriptions-item label="当前认领人">{{ detail.claimed_by_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="保护期至">{{ fmt(detail.protect_until) }}</el-descriptions-item>
              <el-descriptions-item label="实体状态">{{ detail.entity?.status || '—' }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div v-if="tab === 'customer'" class="section-card">
            <h3 class="section-card__title">随迁商机（{{ (detail.opportunities || []).length }}）</h3>
            <el-table :data="detail.opportunities || []" size="small" style="width: 100%">
              <el-table-column prop="entity_name" label="商机名称" min-width="150" show-overflow-tooltip />
              <el-table-column label="金额" width="100">
                <template #default="{ row }">{{ row.amount ? `¥${row.amount}` : '—' }}</template>
              </el-table-column>
              <el-table-column label="阶段" width="110" show-overflow-tooltip>
                <template #default="{ row }">{{ row.stage_name_snapshot || '—' }}</template>
              </el-table-column>
              <template #empty>
                <div class="empty-tip">无随迁商机</div>
              </template>
            </el-table>
            <p class="text-muted mt-12">领取或分配该客户时，以上商机会一并转到同一负责人。</p>
          </div>

          <div class="section-card">
            <h3 class="section-card__title">历史流转记录</h3>
            <el-table :data="detail.owner_history || []" size="small" style="width: 100%">
              <el-table-column label="入池时间" width="140">
                <template #default="{ row }">{{ fmt(row.entered_at) }}</template>
              </el-table-column>
              <el-table-column label="来源" width="100">
                <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">{{ row.reason || '—' }}</template>
              </el-table-column>
              <template #empty>
                <div class="empty-tip">暂无流转记录</div>
              </template>
            </el-table>
          </div>
        </template>
        <p v-else-if="!detailLoading" class="empty-tip">未获取到详情</p>
      </div>
    </el-drawer>

    <!-- 批量分配给销售（480px 居中弹窗） -->
    <el-dialog v-model="assignDialog" title="分配给销售" width="480px" align-center>
      <p class="text-muted">已选 {{ selected.length }} 条{{ typeLabel }}，选择负责人后逐条分配。</p>
      <el-select v-model="assignOwnerId" filterable placeholder="请选择负责人" style="width: 100%">
        <el-option v-for="u in userOptions" :key="u.id" :label="`${u.name}（${u.username}）`" :value="u.id" />
      </el-select>
      <template #footer>
        <el-button @click="assignDialog = false">取消</el-button>
        <el-button type="primary" :loading="assigning" @click="confirmAssign">确认分配</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { CUSTOMER_INDUSTRIES, SOURCE_CHANNELS, DICT_CODES, dictOptions } from '@/config/options'

type SeaType = 'customer' | 'opportunity' | 'lead'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const loading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const tab = computed<SeaType>(() => {
  const seg = String(route.path.split('/')[2] || '')
  return (['customer', 'opportunity', 'lead'].includes(seg) ? seg : 'customer') as SeaType
})
const rules = ref<any>({})
const selected = ref<any[]>([])

const detailDrawer = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)

const assignDialog = ref(false)
const assigning = ref(false)
const assignOwnerId = ref('')
const userOptions = ref<any[]>([])
const ownerCandidates = ref<any[]>([])
const stages = ref<any[]>([])

const query = reactive({ keyword: '', page: 1, page_size: 20 })
const ownerFilter = ref<'all' | 'me'>('all')
const filters = reactive({
  previousOwner: '',
  source: '',
  dateRange: null as [string, string] | null,
  protectState: '',
  customerType: '',
  industry: '',
  customerName: '',
  amountMin: undefined as number | undefined,
  amountMax: undefined as number | undefined,
  stage: '',
  sourceChannel: '',
})

const canAssign = computed(() => userStore.hasPerm('sea:assign'))
const canPickup = computed(() => userStore.hasPerm('sea:pickup'))
const pickupMode = computed(
  () => rules.value.is_pickup_mode === true || rules.value.is_pickup_mode === 1 || rules.value.is_pickup_mode === 'true'
)
const showAssign = computed(() => canAssign.value)
const showPickup = computed(() => pickupMode.value && canPickup.value)
const modeText = computed(() => (pickupMode.value ? '领取模式' : '主管手动分配'))

const typeLabel = computed(() => ({ customer: '客户', opportunity: '商机', lead: '线索' }[tab.value]))
const pageTitle = computed(() => `${typeLabel.value}公海`)
// 行业/来源渠道跟随字典维护
const industryOptions = computed(() => dictOptions(DICT_CODES.customerIndustry, CUSTOMER_INDUSTRIES))
const sourceChannelOptions = computed(() => dictOptions(DICT_CODES.leadSourceChannel, SOURCE_CHANNELS))

const SOURCE_MAP: Record<string, string> = {
  manual: '手工转入',
  auto_stale: '预警自动回落',
  auto_recycle: '线索超期回收',
  auto_inactive: '客户长期无活动',
  assigned: '主管分配',
}

function sourceLabel(s?: string) {
  return SOURCE_MAP[s || ''] || s || '—'
}

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function isProtected(v?: string) {
  return !!v && new Date(v).getTime() > Date.now()
}

/** 保护期内仅系统管理员可自主领取，其余角色只能等主管分配 */
function pickupBlocked(row: any) {
  return isProtected(row.protect_until) && !userStore.isAdmin
}

/** 商机所属客户也在公海时，必须先领客户，商机会随客户一起带出 */
function needCustomerFirst(row: any) {
  return tab.value === 'opportunity' && row.customer_in_sea === 1
}

function isRowSelectable(row: any) {
  return !needCustomerFirst(row)
}

async function loadRules() {
  try {
    rules.value = await api.seaRules()
  } catch (e) {
    rules.value = {}
  }
}

async function load() {
  loading.value = true
  try {
    const res = await api.listSeaPool({
      type: tab.value,
      page: query.page,
      page_size: query.page_size,
      keyword: query.keyword || undefined,
      previous_owner: filters.previousOwner || (ownerFilter.value === 'me' ? 'me' : undefined),
      source: filters.source || undefined,
      entered_start: filters.dateRange?.[0] || undefined,
      entered_end: filters.dateRange?.[1] || undefined,
      protect_state: filters.protectState || undefined,
      customer_type: tab.value === 'customer' ? filters.customerType || undefined : undefined,
      industry: tab.value === 'customer' ? filters.industry || undefined : undefined,
      customer_name: tab.value === 'opportunity' ? filters.customerName || undefined : undefined,
      amount_min: tab.value === 'opportunity' ? filters.amountMin ?? undefined : undefined,
      amount_max: tab.value === 'opportunity' ? filters.amountMax ?? undefined : undefined,
      stage_config_id: tab.value === 'opportunity' ? filters.stage || undefined : undefined,
      source_channel: tab.value === 'lead' ? filters.sourceChannel || undefined : undefined,
    })
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

function onOwnerFilterChange() {
  // 「我转出的」与「按原负责人」互斥，避免条件互相覆盖
  if (ownerFilter.value === 'me') filters.previousOwner = ''
  reload()
}

/** 原负责人：本地按姓名过滤，输入即出候选 */
function searchOwners(keyword: string) {
  const kw = String(keyword || '').trim()
  ownerCandidates.value = kw ? userOptions.value.filter((u) => String(u.name || '').includes(kw)) : userOptions.value
}

/** 下拉收起后恢复完整列表，避免下次打开只剩上次的搜索结果 */
function onOwnerDropdown(visible: boolean) {
  if (!visible) searchOwners('')
}

function reset() {
  query.keyword = ''
  query.page = 1
  ownerFilter.value = 'all'
  filters.previousOwner = ''
  filters.source = ''
  filters.dateRange = null
  filters.protectState = ''
  filters.customerType = ''
  filters.industry = ''
  filters.customerName = ''
  filters.amountMin = undefined
  filters.amountMax = undefined
  filters.stage = ''
  filters.sourceChannel = ''
  load()
}

function onSelectionChange(rows: any[]) {
  selected.value = rows
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

function goEntity(row: any) {
  const id = row.entity_id
  if (!id) return
  const path = { customer: `/customers/${id}`, opportunity: `/opportunities/${id}`, lead: `/leads/${id}` }[tab.value]
  router.push(path)
}

async function openDetail(row: any) {
  detail.value = null
  detailDrawer.value = true
  detailLoading.value = true
  try {
    detail.value = await api.seaDetail(tab.value, row.entity_id)
  } finally {
    detailLoading.value = false
  }
}

async function pickup(row: any) {
  await ElMessageBox.confirm(`确认领取该${typeLabel.value}「${row.entity_name}」？`, '领取确认', { type: 'warning' })
  await api.pickupFromSea(tab.value, row.entity_id)
  ElMessage.success('领取成功')
  await load()
}

async function batchPickup() {
  await ElMessageBox.confirm(`确认领取已选的 ${selected.value.length} 条${typeLabel.value}？`, '批量领取确认', {
    type: 'warning',
  })
  let success = 0
  let fail = 0
  for (const row of selected.value) {
    try {
      await api.pickupFromSea(tab.value, row.entity_id)
      success++
    } catch (e) {
      fail++
    }
  }
  ElMessage.success(`领取完成：成功 ${success} 条，失败 ${fail} 条`)
  await load()
}

async function openAssign() {
  assignOwnerId.value = ''
  assignDialog.value = true
  if (!userOptions.value.length) {
    const res = await api.listUsers({ status: 'enabled', page_size: 200 })
    userOptions.value = res.list || []
  }
}

async function confirmAssign() {
  if (!assignOwnerId.value) {
    ElMessage.warning('请选择负责人')
    return
  }
  assigning.value = true
  try {
    let success = 0
    let fail = 0
    for (const row of selected.value) {
      try {
        await api.assignFromSea(tab.value, row.entity_id, assignOwnerId.value)
        success++
      } catch (e) {
        fail++
      }
    }
    ElMessage.success(`分配完成：成功 ${success} 条，失败 ${fail} 条`)
    assignDialog.value = false
    await load()
  } finally {
    assigning.value = false
  }
}

onMounted(async () => {
  if (String(route.query.previous_owner || '') === 'me') ownerFilter.value = 'me'
  // 原负责人筛选依赖用户列表；无用户查看权限的角色不展示该筛选项
  try {
    const res = await api.listUsers({ status: 'enabled', page_size: 200 })
    userOptions.value = res.list || []
    ownerCandidates.value = userOptions.value
  } catch (e) {
    userOptions.value = []
    ownerCandidates.value = []
  }
  // 阶段下拉与阶段配置保持一致
  try {
    stages.value = await api.stageOptions()
  } catch (e) {
    stages.value = []
  }
  await loadRules()
  await load()
})

// 三个二级菜单共用同一页面组件，切换菜单时需重置选中并重新加载
watch(
  () => route.path,
  () => {
    selected.value = []
    query.page = 1
    reload()
  }
)
</script>
