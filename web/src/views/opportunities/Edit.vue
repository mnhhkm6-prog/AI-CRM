<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <el-button link @click="back">← 返回列表</el-button>
          <h2 class="page-title">{{ isEdit ? `编辑商机${form.name ? ' · ' + form.name : ''}` : '新建商机' }}</h2>
        </div>
      </div>

      <el-form ref="formRef" v-loading="loading" :model="form" :rules="rules" label-width="110px" style="max-width: 820px">
        <h3 class="section-card__title">商机信息</h3>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="商机名称" prop="name">
              <el-input v-model="form.name" maxlength="80" placeholder="请输入商机名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属客户" prop="customer_id">
              <el-select
                v-model="form.customer_id"
                filterable
                remote
                :remote-method="searchCustomers"
                :loading="customerLoading"
                placeholder="搜索并选择客户"
                style="width: 100%"
                :disabled="isEdit"
              >
                <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="预计金额">
              <el-input-number v-model="form.amount" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="预计成交日期">
              <el-date-picker v-model="form.expected_close_date" type="date" value-format="YYYY-MM-DD" placeholder="选填" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="负责人">
              <el-select v-model="form.owner_id" clearable filterable placeholder="默认为本人" style="width: 100%">
                <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="300" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>

        <CustomFieldForm v-model="customFields" entity-type="opportunity" title="阶段填写项" />

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
import { loadOwnerOptions, type Option } from '@/config/options'

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
  name: '', customer_id: '', amount: 0, expected_close_date: '', owner_id: '', remark: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入商机名称', trigger: 'blur' }],
  customer_id: [{ required: true, message: '请选择所属客户', trigger: 'change' }],
}

function back() {
  router.push('/opportunities')
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
  submitting.value = true
  try {
    const payload: Record<string, any> = {
      name: form.name.trim(),
      amount: form.amount,
      expected_close_date: form.expected_close_date || undefined,
      owner_id: form.owner_id || undefined,
      remark: form.remark || undefined,
    }
    if (Object.keys(customFields.value).length) payload.custom_fields = customFields.value

    if (isEdit.value) {
      await api.updateOpportunity(id.value, payload)
      ElMessage.success('已保存')
      router.push(`/opportunities/${id.value}`)
    } else {
      payload.customer_id = form.customer_id
      const res = await api.createOpportunity(payload)
      ElMessage.success('商机创建成功')
      router.push(`/opportunities/${res.id}`)
    }
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  if (isEdit.value) {
    loading.value = true
    try {
      const row = await api.getOpportunity(id.value)
      form.name = row.name || ''
      form.customer_id = row.customer_id || ''
      form.amount = row.amount || 0
      form.expected_close_date = row.expected_close_date || ''
      form.owner_id = row.owner_id || ''
      form.remark = row.remark || ''
      customFields.value = row.custom_fields || {}
      if (row.customer_id) customerOptions.value = [{ id: row.customer_id, name: row.customer_name || '当前客户' }]
    } finally {
      loading.value = false
    }
    return
  }
  // 由客户 360「新建商机」带入客户
  const preset = route.query.customer_id as string | undefined
  if (preset) {
    form.customer_id = preset
    try {
      const c = await api.getCustomer(preset)
      customerOptions.value = [{ id: c.id, name: c.name }]
    } catch (e) {
      /* 无客户查看权限时忽略 */
    }
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
