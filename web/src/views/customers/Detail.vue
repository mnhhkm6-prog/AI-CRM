<template>
  <div class="page" v-loading="loading">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <el-button link @click="back">← 客户列表</el-button>
          <h2 class="page-title">{{ customer?.name }}</h2>
          <el-tag v-if="customer?.level" size="small" effect="plain">{{ customer.level }} 级</el-tag>
          <el-tag size="small" :type="statusTagType(customer?.status)" effect="plain">{{ statusLabel(customer?.status) }}</el-tag>
          <span class="text-muted">最近跟进 {{ fmt(customer?.last_activity_at || customer?.updated_at) }}</span>
        </div>
        <div class="page-head__right">
          <el-button v-if="canUpdate" @click="goEdit">编辑</el-button>
          <el-button v-if="canUpdate && !customer?.is_in_sea" @click="seaDialog = true">转公海</el-button>
          <el-button v-if="canCreateOpp" type="primary" @click="goNewOpportunity">新建商机</el-button>
        </div>
      </div>

      <div class="detail-layout">
        <!-- 左栏 320px：基本信息 + 联系人 -->
        <div class="detail-left">
          <div class="section-card">
            <h3 class="section-card__title">基本信息</h3>
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="客户类型">{{ customer?.type || '—' }}</el-descriptions-item>
              <el-descriptions-item label="所属行业">{{ customer?.industry || '—' }}</el-descriptions-item>
              <el-descriptions-item label="客户规模">{{ customer?.scale || '—' }}</el-descriptions-item>
              <el-descriptions-item label="来源渠道">{{ customer?.source_channel || '—' }}</el-descriptions-item>
              <el-descriptions-item label="负责人">{{ customer?.owner_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="信用代码">{{ customer?.credit_code || '—' }}</el-descriptions-item>
              <el-descriptions-item label="客户地址">{{ customer?.address || '—' }}</el-descriptions-item>
              <el-descriptions-item label="备注">{{ customer?.remark || '—' }}</el-descriptions-item>
              <el-descriptions-item v-for="(v, k) in customFieldEntries" :key="k" :label="String(k)">
                {{ formatCustom(v) }}
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="section-card">
            <div class="section-card__head">
              <h3 class="section-card__title">联系人</h3>
              <el-button v-if="canContactCreate" link type="primary" @click="openContact()">＋ 新增</el-button>
            </div>
            <div v-if="!contacts.length" class="empty-tip">暂无联系人</div>
            <div v-for="c in contacts" :key="c.id" class="contact-item">
              <div class="contact-item__head">
                <span class="contact-item__name">{{ c.name }}</span>
                <el-tag v-if="c.is_primary" size="small" effect="plain" type="success">主联系人</el-tag>
              </div>
              <div class="contact-item__meta">
                {{ [c.title, c.decision_role, c.relationship].filter(Boolean).join(' · ') || '—' }}
              </div>
              <div class="contact-item__meta">{{ c.phone || '—' }}{{ c.email ? ' · ' + c.email : '' }}</div>
              <div class="contact-item__ops">
                <el-button v-if="canContactUpdate" link type="primary" @click="openContact(c)">编辑</el-button>
                <el-button v-if="canContactUpdate && !c.is_primary" link type="primary" @click="setPrimary(c)">设为主</el-button>
                <el-button v-if="canContactDelete" link type="danger" @click="removeContact(c)">删除</el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 右主区：页签 -->
        <div class="detail-main">
          <div class="section-card">
            <el-tabs v-model="tab">
              <el-tab-pane label="时间轴" name="timeline">
                <el-timeline v-if="timeline.length">
                  <el-timeline-item
                    v-for="(e, i) in timeline"
                    :key="i"
                    :timestamp="fmt(e.at)"
                    placement="top"
                    :type="timelineType(e.category)"
                  >
                    <div class="timeline-item__title">{{ e.title }}</div>
                    <div class="timeline-item__meta">{{ e.content || '' }}</div>
                  </el-timeline-item>
                </el-timeline>
                <div v-else class="empty-tip">暂无生命周期记录</div>
              </el-tab-pane>

              <el-tab-pane :label="`商机 (${opportunities.length})`" name="opportunity">
                <el-table :data="opportunities" size="small">
                  <el-table-column label="商机名称" min-width="180" show-overflow-tooltip>
                    <template #default="{ row }">
                      <el-link type="primary" underline="never" @click="goOpportunity(row)">{{ row.name }}</el-link>
                    </template>
                  </el-table-column>
                  <el-table-column prop="stage_name_snapshot" label="当前阶段" width="150" />
                  <el-table-column label="金额" width="120" align="right">
                    <template #default="{ row }">{{ Number(row.amount || 0).toLocaleString('zh-CN') }}</template>
                  </el-table-column>
                  <el-table-column prop="status" label="状态" width="90" align="center" />
                  <el-table-column prop="owner_name" label="负责人" width="100" />
                  <template #empty><div class="empty-tip">暂无商机</div></template>
                </el-table>
              </el-tab-pane>

              <el-tab-pane :label="`方案与报价 (${proposals.length + quotations.length})`" name="assets">
                <h4 class="sub-title">方案</h4>
                <el-table :data="proposals" size="small">
                  <el-table-column prop="file_name" label="文件" min-width="200" show-overflow-tooltip />
                  <el-table-column label="类型" width="110">
                    <template #default="{ row }">{{ row.proposal_type === 'formal' ? '正式方案' : '初步方案' }}</template>
                  </el-table-column>
                  <el-table-column label="上传时间" width="150">
                    <template #default="{ row }">{{ fmt(row.created_at) }}</template>
                  </el-table-column>
                  <template #empty><div class="empty-tip">暂无方案</div></template>
                </el-table>
                <h4 class="sub-title">报价</h4>
                <el-table :data="quotations" size="small">
                  <el-table-column prop="file_name" label="文件" min-width="200" show-overflow-tooltip />
                  <el-table-column label="类型" width="110">
                    <template #default="{ row }">{{ row.quotation_type === 'final' ? '最终报价' : '初步报价' }}</template>
                  </el-table-column>
                  <el-table-column label="上传时间" width="150">
                    <template #default="{ row }">{{ fmt(row.created_at) }}</template>
                  </el-table-column>
                  <template #empty><div class="empty-tip">暂无报价</div></template>
                </el-table>
              </el-tab-pane>

              <el-tab-pane :label="`合同 (${contracts.length})`" name="contract">
                <el-table :data="contracts" size="small">
                  <el-table-column prop="contract_no" label="合同编号" width="160" />
                  <el-table-column prop="contract_name" label="合同名称" min-width="160" show-overflow-tooltip />
                  <el-table-column label="金额" width="120" align="right">
                    <template #default="{ row }">{{ Number(row.amount || 0).toLocaleString('zh-CN') }}</template>
                  </el-table-column>
                  <el-table-column prop="signed_date" label="签订日期" width="120" />
                  <template #empty><div class="empty-tip">暂无合同</div></template>
                </el-table>
              </el-tab-pane>

              <el-tab-pane :label="`预警 (${alertEvents.length})`" name="alert">
                <el-table :data="alertEvents" size="small">
                  <el-table-column prop="title" label="预警" width="140" />
                  <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip />
                  <el-table-column label="触发时间" width="150">
                    <template #default="{ row }">{{ fmt(row.at) }}</template>
                  </el-table-column>
                  <template #empty><div class="empty-tip">暂无预警记录</div></template>
                </el-table>
              </el-tab-pane>

              <el-tab-pane :label="`失效 (${lossEvents.length})`" name="loss">
                <el-table :data="lossEvents" size="small">
                  <el-table-column prop="content" label="失效原因" min-width="260" show-overflow-tooltip />
                  <el-table-column label="记录时间" width="150">
                    <template #default="{ row }">{{ fmt(row.at) }}</template>
                  </el-table-column>
                  <template #empty><div class="empty-tip">暂无失效记录</div></template>
                </el-table>
              </el-tab-pane>
            </el-tabs>
          </div>
        </div>
      </div>
    </div>

    <!-- 转公海 -->
    <el-dialog v-model="seaDialog" title="客户转公海" width="420px">
      <el-input v-model="seaReason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写转公海原因（必填）" />
      <template #footer>
        <el-button @click="seaDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSea">确认转入公海</el-button>
      </template>
    </el-dialog>

    <!-- 联系人抽屉（P24，480px） -->
    <el-drawer v-model="contactDrawer" :title="contactForm.id ? '编辑联系人' : '新增联系人'" size="480px">
      <el-form ref="contactFormRef" :model="contactForm" :rules="contactRules" label-width="90px">
        <el-form-item label="姓名" prop="name"><el-input v-model="contactForm.name" maxlength="40" /></el-form-item>
        <el-form-item label="联系电话" prop="phone"><el-input v-model="contactForm.phone" maxlength="30" /></el-form-item>
        <el-form-item label="职务"><el-input v-model="contactForm.title" maxlength="40" /></el-form-item>
        <el-form-item label="决策角色">
          <el-select v-model="contactForm.decision_role" clearable placeholder="请选择" style="width: 100%">
            <el-option v-for="o in DECISION_ROLES" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="关系亲密度">
          <el-select v-model="contactForm.relationship" clearable placeholder="请选择" style="width: 100%">
            <el-option v-for="o in RELATIONSHIPS" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="邮箱"><el-input v-model="contactForm.email" maxlength="60" /></el-form-item>
        <el-form-item label="微信"><el-input v-model="contactForm.wechat" maxlength="40" /></el-form-item>
        <el-form-item label="主联系人"><el-switch v-model="contactForm.is_primary" /></el-form-item>
      </el-form>
      <div class="drawer-actions">
        <el-button type="primary" :loading="submitting" @click="saveContact">保存</el-button>
        <el-button @click="contactDrawer = false">取消</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const DECISION_ROLES = ['决策人', '影响者', '使用者', '采购', '其他']
const RELATIONSHIPS = ['陌生', '一般', '良好', '紧密']

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const tab = ref('timeline')

const customer = ref<any>(null)
const contacts = ref<any[]>([])
const opportunities = ref<any[]>([])
const proposals = ref<any[]>([])
const quotations = ref<any[]>([])
const contracts = ref<any[]>([])
const timeline = ref<any[]>([])

const seaDialog = ref(false)
const seaReason = ref('')

const contactDrawer = ref(false)
const contactFormRef = ref<FormInstance>()
const contactForm = reactive<any>({
  id: '', name: '', phone: '', title: '', decision_role: '', relationship: '', email: '', wechat: '', is_primary: false,
})
const contactRules: FormRules = {
  name: [{ required: true, message: '请输入联系人姓名', trigger: 'blur' }],
  phone: [{ required: true, message: '请输入联系电话', trigger: 'blur' }],
}

const id = computed(() => route.params.id as string)
const canUpdate = computed(() => userStore.hasPerm('customer:update'))
const canCreateOpp = computed(() => userStore.hasPerm('opportunity:create'))
const canContactCreate = computed(() => userStore.hasPerm('contact:create'))
const canContactUpdate = computed(() => userStore.hasPerm('contact:update'))
const canContactDelete = computed(() => userStore.hasPerm('contact:delete'))

const customFieldEntries = computed(() => {
  const cf = customer.value?.custom_fields || {}
  const out: Record<string, any> = {}
  Object.entries(cf).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  })
  return out
})

const alertEvents = computed(() => timeline.value.filter((e) => e.category === 'alert'))
const lossEvents = computed(() => timeline.value.filter((e) => e.category === 'loss'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function formatCustom(v: any) {
  if (Array.isArray(v)) return v.join('、')
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

function statusLabel(s?: string) {
  return { active: '活跃', sea: '公海', invalid: '无效' }[s || ''] || s || '—'
}

function statusTagType(s?: string) {
  return { active: 'success', sea: 'info', invalid: 'danger' }[s || ''] || 'info'
}

function timelineType(category: string) {
  const map: Record<string, any> = {
    activity: 'primary', stage: 'success', proposal: 'primary', quotation: 'primary',
    contract: 'success', alert: 'warning', loss: 'danger',
  }
  return map[category] || 'info'
}

async function load() {
  loading.value = true
  try {
    const res = await api.customer360(id.value)
    customer.value = res.customer
    contacts.value = res.contacts || []
    opportunities.value = res.opportunities || []
    proposals.value = res.proposals || []
    quotations.value = res.quotations || []
    contracts.value = res.contracts || []
    timeline.value = res.timeline || []
  } finally {
    loading.value = false
  }
}

function back() {
  router.push('/customers')
}

function goEdit() {
  router.push(`/customers/${id.value}/edit`)
}

function goOpportunity(row: any) {
  router.push(`/opportunities/${row.id}`)
}

function goNewOpportunity() {
  router.push({ path: '/opportunities/new', query: { customer_id: id.value } })
}

async function confirmSea() {
  if (!seaReason.value.trim()) {
    ElMessage.warning('请填写转公海原因')
    return
  }
  submitting.value = true
  try {
    await api.releaseCustomerToSea(id.value, seaReason.value.trim())
    ElMessage.success('已转入公海池')
    seaDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

function openContact(c?: any) {
  Object.assign(contactForm, {
    id: '', name: '', phone: '', title: '', decision_role: '', relationship: '', email: '', wechat: '',
    is_primary: !c && contacts.value.length === 0, // 首个联系人默认设为主联系人
  })
  if (c) Object.assign(contactForm, { ...c, is_primary: c.is_primary === 1 })
  contactDrawer.value = true
}

async function saveContact() {
  const valid = await contactFormRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const payload = {
      name: contactForm.name,
      phone: contactForm.phone,
      title: contactForm.title || undefined,
      decision_role: contactForm.decision_role || undefined,
      relationship: contactForm.relationship || undefined,
      email: contactForm.email || undefined,
      wechat: contactForm.wechat || undefined,
      is_primary: contactForm.is_primary,
    }
    if (contactForm.id) await api.updateContact(contactForm.id, payload)
    else await api.createContact(id.value, payload)
    ElMessage.success('已保存')
    contactDrawer.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function setPrimary(c: any) {
  await api.setPrimaryContact(c.id)
  ElMessage.success('已设为主联系人')
  await load()
}

async function removeContact(c: any) {
  await ElMessageBox.confirm(`确认删除联系人「${c.name}」？`, '删除确认', { type: 'warning' })
  await api.deleteContact(c.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(load)
</script>

<style scoped>
.detail-layout {
  align-items: flex-start;
}

.detail-left {
  width: 320px;
  flex-shrink: 0;
}

@media (max-width: 1200px) {
  .detail-left {
    width: 100%;
  }
}

.section-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.contact-item {
  padding: 8px 0;
  border-bottom: 1px dashed var(--crm-border);
}

.contact-item:last-child {
  border-bottom: none;
}

.contact-item__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.contact-item__name {
  font-weight: 600;
}

.contact-item__meta {
  color: var(--crm-text-secondary);
  font-size: 12px;
  margin-top: 2px;
}

.contact-item__ops {
  margin-top: 4px;
}

.sub-title {
  margin: 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--crm-text-regular);
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
