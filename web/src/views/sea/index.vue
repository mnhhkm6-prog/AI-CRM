<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">公海池</h2>
          <span class="scope-badge">{{ modeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <el-tabs v-model="tab" @tab-change="onTabChange">
        <el-tab-pane label="客户公海" name="customer" />
        <el-tab-pane label="商机公海" name="opportunity" />
        <el-tab-pane label="线索公海" name="lead" />
      </el-tabs>

      <div class="filter-bar">
        <el-input
          v-model="query.keyword"
          :placeholder="`${typeLabel}名称`"
          clearable
          style="width: 220px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <div class="filter-bar__spacer" />
        <el-button v-if="showAssign" :disabled="!selected.length" @click="openAssign">分配给销售</el-button>
        <el-button v-if="showPickup" type="primary" :disabled="!selected.length" @click="batchPickup">批量领取</el-button>
        <el-button @click="reset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%" @selection-change="onSelectionChange">
        <el-table-column v-if="showAssign || showPickup" type="selection" width="44" />
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
              v-if="showPickup && !isProtected(row.protect_until)"
              link
              type="primary"
              @click="pickup(row)"
            >
              领取
            </el-button>
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
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

type SeaType = 'customer' | 'opportunity' | 'lead'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const tab = ref<SeaType>('customer')
const rules = ref<any>({})
const selected = ref<any[]>([])

const detailDrawer = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)

const assignDialog = ref(false)
const assigning = ref(false)
const assignOwnerId = ref('')
const userOptions = ref<any[]>([])

const query = reactive({ keyword: '', page: 1, page_size: 20 })

const canAssign = computed(() => userStore.hasPerm('sea:assign'))
const canPickup = computed(() => userStore.hasPerm('sea:pickup'))
const pickupMode = computed(
  () => rules.value.is_pickup_mode === true || rules.value.is_pickup_mode === 1 || rules.value.is_pickup_mode === 'true'
)
const showAssign = computed(() => canAssign.value)
const showPickup = computed(() => pickupMode.value && canPickup.value)
const modeText = computed(() => (pickupMode.value ? '领取模式' : '主管手动分配'))

const typeLabel = computed(() => ({ customer: '客户', opportunity: '商机', lead: '线索' }[tab.value]))

const SOURCE_MAP: Record<string, string> = {
  manual: '手工转入',
  auto_stale: '预警自动回落',
  auto_recycle: '线索超期回收',
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

function reset() {
  query.keyword = ''
  query.page = 1
  load()
}

function onTabChange() {
  selected.value = []
  reload()
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
  await loadRules()
  await load()
})
</script>
