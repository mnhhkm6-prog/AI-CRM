<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <el-button link @click="back">← 返回列表</el-button>
          <h2 class="page-title">{{ isEdit ? `编辑线索${form.name ? ' · ' + form.name : ''}` : '新建线索' }}</h2>
        </div>
      </div>

      <el-form ref="formRef" v-loading="loading" :model="form" :rules="rules" label-width="110px" style="max-width: 820px">
        <h3 class="section-card__title">线索信息</h3>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="线索名称" prop="name">
              <el-input v-model="form.name" maxlength="80" placeholder="请输入线索名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="来源渠道" prop="source_channel">
              <el-select v-model="form.source_channel" placeholder="请选择" style="width: 100%">
                <el-option v-for="o in SOURCE_CHANNELS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="联系人" prop="contact_name">
              <el-input v-model="form.contact_name" maxlength="40" placeholder="请输入联系人" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="联系电话">
              <el-input v-model="form.contact_phone" maxlength="30" placeholder="联系电话与微信号至少填一项" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="微信号">
              <el-input v-model="form.wechat" maxlength="40" placeholder="联系电话与微信号至少填一项" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="关联客户">
              <el-select
                v-model="form.customer_id"
                filterable
                remote
                clearable
                :remote-method="searchCustomers"
                :loading="customerLoading"
                placeholder="搜索并选择客户（选填）"
                style="width: 100%"
              >
                <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="负责人">
              <el-select v-model="form.owner_id" clearable filterable placeholder="默认为本人" style="width: 100%">
                <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col v-if="isEdit" :span="12">
            <el-form-item label="线索状态">
              <el-select v-model="form.status" style="width: 100%">
                <el-option v-for="o in LEAD_STATUS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="300" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>

        <CustomFieldForm v-model="customFields" entity-type="lead" />

        <div class="form-actions">
          <el-button type="primary" :loading="submitting" @click="save">保存</el-button>
          <el-button @click="back">取消</el-button>
        </div>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import CustomFieldForm from '@/components/CustomFieldForm.vue'
import { LEAD_STATUS, SOURCE_CHANNELS, loadOwnerOptions, type Option } from '@/config/options'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const submitting = ref(false)
const customerLoading = ref(false)
const owners = ref<Option[]>([])
const customerOptions = ref<any[]>([])
const customFields = ref<Record<string, any>>({})

const id = computed(() => (route.params.id as string) || '')
const isEdit = computed(() => !!id.value)

const form = reactive({
  name: '', source_channel: '', contact_name: '', contact_phone: '', wechat: '',
  customer_id: '', owner_id: '', status: 'new', remark: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入线索名称', trigger: 'blur' }],
  source_channel: [{ required: true, message: '请选择来源渠道', trigger: 'change' }],
  contact_name: [{ required: true, message: '请输入联系人', trigger: 'blur' }],
}

function back() {
  router.push('/leads')
}

async function searchCustomers(keyword: string) {
  if (!keyword) return
  customerLoading.value = true
  try {
    const res = await api.listCustomers({ keyword, page_size: 20 })
    customerOptions.value = res.list || []
  } finally {
    customerLoading.value = false
  }
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (!form.contact_phone.trim() && !form.wechat.trim()) {
    ElMessage.warning('联系电话与微信号至少填写一项')
    return
  }
  submitting.value = true
  try {
    const payload: Record<string, any> = {
      name: form.name.trim(),
      source_channel: form.source_channel,
      contact_name: form.contact_name.trim(),
      contact_phone: form.contact_phone || undefined,
      wechat: form.wechat || undefined,
      customer_id: form.customer_id || undefined,
      owner_id: form.owner_id || undefined,
      remark: form.remark || undefined,
    }
    if (isEdit.value) payload.status = form.status
    if (Object.keys(customFields.value).length) payload.custom_fields = customFields.value

    if (isEdit.value) {
      await api.updateLead(id.value, payload)
      ElMessage.success('已保存')
      router.push(`/leads/${id.value}`)
    } else {
      const res = await api.createLead(payload)
      ElMessage.success('线索创建成功')
      router.push(`/leads/${res.id}`)
    }
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  if (!isEdit.value) return
  loading.value = true
  try {
    const row = await api.getLead(id.value)
    Object.keys(form).forEach((k) => {
      if (row[k] !== undefined && row[k] !== null) (form as any)[k] = row[k]
    })
    customFields.value = row.custom_fields || {}
    if (row.customer_id) {
      try {
        const c = await api.getCustomer(row.customer_id)
        customerOptions.value = [{ id: c.id, name: c.name }]
      } catch (e) {
        /* 无客户查看权限时忽略 */
      }
    }
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.form-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--crm-border);
}
</style>
