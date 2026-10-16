<template>
  <div class="page" v-loading="loading">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <el-button link @click="back">← 线索列表</el-button>
          <h2 class="page-title">{{ lead?.name }}</h2>
          <el-tag size="small" :type="statusTagType(lead?.status)" effect="plain">{{ statusLabel(lead?.status) }}</el-tag>
        </div>
        <div class="page-head__right">
          <el-button v-if="canUpdate" @click="goEdit">编辑</el-button>
          <el-button v-if="canAssign" @click="openAssign">分配给销售</el-button>
          <el-button v-if="canConvert && !lead?.opportunity_id" type="primary" @click="openConvert">转商机</el-button>
          <el-button v-if="canRecycle && !lead?.is_in_sea" @click="recycleDialog = true">回收至公海</el-button>
          <el-button v-if="canDelete && !lead?.opportunity_id" type="danger" plain @click="remove">删除</el-button>
        </div>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <div class="section-card">
            <h3 class="section-card__title">线索信息</h3>
            <el-descriptions :column="2" size="small" border>
              <el-descriptions-item label="来源渠道">{{ lead?.source_channel || '—' }}</el-descriptions-item>
              <el-descriptions-item label="负责人">{{ lead?.owner_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="联系人">{{ lead?.contact_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="联系电话">{{ lead?.contact_phone || '—' }}</el-descriptions-item>
              <el-descriptions-item label="关联客户">
                <el-link v-if="lead?.customer_id" type="primary" underline="never" @click="goCustomer">
                  {{ customerName || '查看客户' }}
                </el-link>
                <span v-else class="text-muted">—</span>
              </el-descriptions-item>
              <el-descriptions-item label="录入时间">{{ fmt(lead?.created_at) }}</el-descriptions-item>
              <el-descriptions-item label="转化时间">{{ lead?.converted_at ? fmt(lead.converted_at) : '—' }}</el-descriptions-item>
              <el-descriptions-item label="关联商机">
                <el-link v-if="lead?.opportunity_id" type="primary" underline="never" @click="goOpportunity">查看商机</el-link>
                <span v-else class="text-muted">—</span>
              </el-descriptions-item>
              <el-descriptions-item label="备注" :span="2">{{ lead?.remark || '—' }}</el-descriptions-item>
              <el-descriptions-item
                v-for="(v, k) in customFieldEntries"
                :key="k"
                :label="String(k)"
                :span="1"
              >
                {{ formatCustom(v) }}
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </div>
    </div>

    <!-- 分配 -->
    <el-dialog v-model="assignDialog" title="分配给销售" width="420px">
      <el-form label-width="80px">
        <el-form-item label="线索">{{ lead?.name }}</el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="assignOwnerId" filterable placeholder="请选择负责人" style="width: 100%">
            <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmAssign">确认分配</el-button>
      </template>
    </el-dialog>

    <!-- 转商机 -->
    <el-dialog v-model="convertDialog" title="线索转商机" width="480px">
      <el-form label-width="100px">
        <el-form-item label="关联客户" required>
          <el-select
            v-model="convertForm.customer_id"
            filterable
            remote
            :remote-method="searchCustomers"
            :loading="customerLoading"
            placeholder="搜索并选择客户"
            style="width: 100%"
          >
            <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="商机名称">
          <el-input v-model="convertForm.opportunity_name" :placeholder="`默认：${lead?.name} 商机`" maxlength="80" />
        </el-form-item>
        <el-form-item label="预计金额">
          <el-input-number v-model="convertForm.amount" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="convertDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmConvert">确认转商机</el-button>
      </template>
    </el-dialog>

    <!-- 回收 -->
    <el-dialog v-model="recycleDialog" title="线索回收至公海" width="420px">
      <el-input v-model="recycleReason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写回收原因（必填）" />
      <template #footer>
        <el-button @click="recycleDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmRecycle">确认回收</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { loadOwnerOptions, type Option } from '@/config/options'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const customerLoading = ref(false)
const lead = ref<any>(null)
const customerName = ref('')
const owners = ref<Option[]>([])

const assignDialog = ref(false)
const assignOwnerId = ref('')
const convertDialog = ref(false)
const convertForm = reactive<{ customer_id: string; opportunity_name: string; amount: number }>({
  customer_id: '', opportunity_name: '', amount: 0,
})
const customerOptions = ref<any[]>([])
const recycleDialog = ref(false)
const recycleReason = ref('')

const id = computed(() => route.params.id as string)
const canUpdate = computed(() => userStore.hasPerm('lead:update'))
const canDelete = computed(() => userStore.hasPerm('lead:delete'))
const canAssign = computed(() => userStore.hasPerm('lead:assign'))
const canConvert = computed(() => userStore.hasPerm('lead:convert'))
const canRecycle = computed(() => userStore.hasPerm('lead:recycle'))

const customFieldEntries = computed(() => {
  const cf = lead.value?.custom_fields || {}
  const out: Record<string, any> = {}
  Object.entries(cf).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  })
  return out
})

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function statusLabel(s?: string) {
  return { new: '新建', following: '跟进中', converted: '已转商机', recycled: '已回收' }[s || ''] || s || '—'
}

function statusTagType(s?: string) {
  return { new: 'info', following: 'primary', converted: 'success', recycled: 'warning' }[s || ''] || 'info'
}

function formatCustom(v: any) {
  if (Array.isArray(v)) return v.join('、')
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

async function load() {
  loading.value = true
  try {
    const row = await api.getLead(id.value)
    lead.value = row
    if (row.customer_id) {
      try {
        const c = await api.getCustomer(row.customer_id)
        customerName.value = c.name
      } catch (e) {
        customerName.value = ''
      }
    }
  } finally {
    loading.value = false
  }
}

function back() {
  router.push('/leads')
}

function goEdit() {
  router.push(`/leads/${id.value}/edit`)
}

function goCustomer() {
  router.push(`/customers/${lead.value.customer_id}`)
}

function goOpportunity() {
  router.push(`/opportunities/${lead.value.opportunity_id}`)
}

function openAssign() {
  assignOwnerId.value = lead.value?.owner_id || ''
  assignDialog.value = true
}

async function confirmAssign() {
  if (!assignOwnerId.value) {
    ElMessage.warning('请选择负责人')
    return
  }
  submitting.value = true
  try {
    await api.assignLead(id.value, assignOwnerId.value)
    ElMessage.success('已分配')
    assignDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function searchCustomers(keyword: string) {
  customerLoading.value = true
  try {
    const res = await api.listCustomers({ keyword, page_size: 20 })
    customerOptions.value = res.list || []
  } finally {
    customerLoading.value = false
  }
}

async function openConvert() {
  convertForm.customer_id = lead.value?.customer_id || ''
  convertForm.opportunity_name = ''
  convertForm.amount = 0
  customerOptions.value = customerName.value ? [{ id: lead.value.customer_id, name: customerName.value }] : []
  convertDialog.value = true
}

async function confirmConvert() {
  if (!convertForm.customer_id) {
    ElMessage.warning('请选择关联客户')
    return
  }
  submitting.value = true
  try {
    const res = await api.convertLead(id.value, {
      customer_id: convertForm.customer_id,
      opportunity_name: convertForm.opportunity_name || undefined,
      amount: convertForm.amount,
    })
    ElMessage.success('已转为商机')
    convertDialog.value = false
    if (res.opportunity_id) router.push(`/opportunities/${res.opportunity_id}`)
    else await load()
  } finally {
    submitting.value = false
  }
}

async function confirmRecycle() {
  if (!recycleReason.value.trim()) {
    ElMessage.warning('请填写回收原因')
    return
  }
  submitting.value = true
  try {
    await api.recycleLead(id.value, recycleReason.value.trim())
    ElMessage.success('已回收至公海')
    recycleDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function remove() {
  await ElMessageBox.confirm(`确认删除线索「${lead.value?.name}」？`, '删除确认', { type: 'warning' })
  await api.deleteLead(id.value)
  ElMessage.success('已删除')
  router.push('/leads')
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  await load()
})
</script>
