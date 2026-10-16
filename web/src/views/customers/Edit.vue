<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <el-button link @click="back">← 返回列表</el-button>
          <h2 class="page-title">{{ isEdit ? `编辑客户${form.name ? ' · ' + form.name : ''}` : '新建客户' }}</h2>
        </div>
      </div>

      <el-form ref="formRef" v-loading="loading" :model="form" :rules="rules" label-width="110px" style="max-width: 920px">
        <h3 class="section-card__title">基本信息</h3>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="客户名称" prop="name">
              <el-input v-model="form.name" maxlength="80" placeholder="请输入客户名称" @blur="onNameBlur" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="客户类型">
              <el-select v-model="form.type" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="o in CUSTOMER_TYPES" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属行业">
              <el-select v-model="form.industry" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="o in CUSTOMER_INDUSTRIES" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="客户规模">
              <el-select v-model="form.scale" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="o in CUSTOMER_SCALES" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="客户等级">
              <el-select v-model="form.level" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="o in CUSTOMER_LEVELS" :key="o.value" :label="`${o.label} 级`" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="统一信用代码">
              <el-input v-model="form.credit_code" maxlength="30" placeholder="选填" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="客户地址">
              <el-input v-model="form.address" maxlength="120" placeholder="选填" />
            </el-form-item>
          </el-col>
        </el-row>

        <h3 class="section-card__title">归属与来源</h3>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="来源渠道" prop="source_channel">
              <el-select v-model="form.source_channel" placeholder="请选择" style="width: 100%">
                <el-option v-for="o in SOURCE_CHANNELS" :key="o.value" :label="o.label" :value="o.value" />
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
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="300" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>

        <CustomFieldForm v-model="customFields" entity-type="customer" />

        <div class="form-actions">
          <el-button type="primary" :loading="submitting" @click="save">保存</el-button>
          <el-button @click="back">取消</el-button>
        </div>
      </el-form>
    </div>

    <!-- 查重提示（M1-R3） -->
    <el-dialog v-model="dupDialog" title="发现重复客户" width="480px">
      <el-alert type="warning" :closable="false" show-icon title="系统中已存在同名客户，请确认是否继续创建。" />
      <el-table :data="dupMatches" size="small" class="mt-12">
        <el-table-column prop="name" label="客户名称" min-width="140" />
        <el-table-column label="匹配方式" width="100">
          <template #default="{ row }">{{ row.match_type === 'phone' ? '联系电话' : '客户名称' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="goExisting(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="dupDialog = false">返回修改</el-button>
        <el-button type="primary" :loading="submitting" @click="save(true)">仍要创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import CustomFieldForm from '@/components/CustomFieldForm.vue'
import {
  CUSTOMER_INDUSTRIES,
  CUSTOMER_LEVELS,
  CUSTOMER_SCALES,
  CUSTOMER_TYPES,
  SOURCE_CHANNELS,
  loadOwnerOptions,
  type Option,
} from '@/config/options'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const submitting = ref(false)
const owners = ref<Option[]>([])
const customFields = ref<Record<string, any>>({})

const dupDialog = ref(false)
const dupMatches = ref<any[]>([])

const id = computed(() => (route.params.id as string) || '')
const isEdit = computed(() => !!id.value)

const form = reactive({
  name: '',
  type: '',
  industry: '',
  scale: '',
  address: '',
  credit_code: '',
  level: '',
  source_channel: '',
  owner_id: '',
  remark: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入客户名称', trigger: 'blur' }],
  source_channel: [{ required: true, message: '请选择来源渠道', trigger: 'change' }],
}

function back() {
  router.push('/customers')
}

async function onNameBlur() {
  if (isEdit.value || !form.name.trim()) return
  const res = await api.checkCustomerDuplicate({ name: form.name.trim() })
  if (res.duplicated) {
    dupMatches.value = res.matches || []
    dupDialog.value = true
  }
}

function goExisting(row: any) {
  dupDialog.value = false
  router.push(`/customers/${row.id}`)
}

async function save(ignoreDuplicate = false) {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const payload: Record<string, any> = {
      name: form.name.trim(),
      type: form.type || undefined,
      industry: form.industry || undefined,
      scale: form.scale || undefined,
      address: form.address || undefined,
      credit_code: form.credit_code || undefined,
      level: form.level || undefined,
      source_channel: form.source_channel,
      owner_id: form.owner_id || undefined,
      remark: form.remark || undefined,
    }
    if (Object.keys(customFields.value).length) payload.custom_fields = customFields.value
    if (ignoreDuplicate) payload.ignore_duplicate = true

    if (isEdit.value) {
      await api.updateCustomer(id.value, payload)
      ElMessage.success('已保存')
      router.push(`/customers/${id.value}`)
    } else {
      const res = await api.createCustomer(payload)
      ElMessage.success('客户创建成功')
      router.push(`/customers/${res.id}`)
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
    const row = await api.getCustomer(id.value)
    Object.keys(form).forEach((k) => {
      ;(form as any)[k] = row[k] ?? ''
    })
    customFields.value = row.custom_fields || {}
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
