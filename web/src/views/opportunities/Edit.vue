<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <el-button link @click="back">{{ isEdit ? '← 返回详情' : '← 返回列表' }}</el-button>
          <h2 class="page-title">{{ isEdit ? `编辑商机${form.name ? ' · ' + form.name : ''}` : '新建商机' }}</h2>
        </div>
      </div>

      <el-form ref="formRef" v-loading="loading" :model="form" :rules="rules" label-width="140px" style="max-width: 880px">
        <h3 class="section-card__title">商机信息</h3>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item id="field-name" label="商机名称" prop="name">
              <el-input v-model="form.name" maxlength="80" placeholder="请输入商机名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item id="field-customer_id" label="所属客户" prop="customer_id">
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
            <el-form-item id="field-amount" label="预计金额" :required="isStageRequired('amount')">
              <el-input-number v-model="form.amount" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item id="field-expected_close_date" label="预计成交日期" :required="isStageRequired('expected_close_date')">
              <el-date-picker
                v-model="form.expected_close_date"
                type="date"
                value-format="YYYY-MM-DD"
                :placeholder="isStageRequired('expected_close_date') ? '请选择日期' : '选填'"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item id="field-owner_id" label="负责人" :required="isStageRequired('owner_id')">
              <el-select v-model="form.owner_id" clearable filterable placeholder="默认为本人" style="width: 100%">
                <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item id="field-remark" label="备注" :required="isStageRequired('remark')">
              <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="300" show-word-limit />
            </el-form-item>
          </el-col>
        </el-row>

        <CustomFieldForm
          ref="customFieldRef"
          v-model="customFields"
          entity-type="opportunity"
          title="阶段填写项"
          :stage-id="currentStageId"
        />

        <div class="form-actions">
          <el-button type="primary" :loading="submitting" @click="save">保存</el-button>
          <el-button @click="back">取消</el-button>
        </div>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import CustomFieldForm from '@/components/CustomFieldForm.vue'
import { loadOwnerOptions, type Option } from '@/config/options'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const customFieldRef = ref<any>()
const loading = ref(false)
const submitting = ref(false)
const customerLoading = ref(false)
const owners = ref<Option[]>([])
const customerOptions = ref<any[]>([])
const customFields = ref<Record<string, any>>({})
const stageOptions = ref<any[]>([])
const loadedStageId = ref('')
/** 当前阶段配置为必填的内置字段（来自商机详情的 fixed_actions） */
const stageRequiredBuiltin = ref<string[]>([])
/** 可在编辑页填写、且可能被配置为阶段固定动作的内置字段 */
const BUILTIN_LABELS: Record<string, string> = {
  amount: '预计金额',
  expected_close_date: '预计成交日期',
  owner_id: '负责人',
  remark: '备注',
}

const id = computed(() => (route.params.id as string) || '')
const isEdit = computed(() => !!id.value)
/** 编辑时为商机当前阶段；新建时为漏斗起点阶段 */
const currentStageId = computed(
  () =>
    loadedStageId.value ||
    stageOptions.value.find((s) => s.is_enabled === 1 && !s.is_terminal)?.id ||
    ''
)

const form = reactive({
  name: '', customer_id: '', amount: 0, expected_close_date: '', owner_id: '', remark: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入商机名称', trigger: 'blur' }],
  customer_id: [{ required: true, message: '请选择所属客户', trigger: 'change' }],
}

function isStageRequired(key: string) {
  return stageRequiredBuiltin.value.includes(key)
}

/** 当前阶段必填的内置字段是否已填（与推进校验口径一致：金额需大于 0） */
function builtinMissing(): { field_code: string; field_name: string }[] {
  return stageRequiredBuiltin.value
    .filter((key) => {
      if (key === 'amount') return !(Number(form.amount) > 0)
      if (key === 'expected_close_date') return !form.expected_close_date
      if (key === 'owner_id') return !form.owner_id
      if (key === 'remark') return !String(form.remark || '').trim()
      return false
    })
    .map((key) => ({ field_code: key, field_name: BUILTIN_LABELS[key] || key }))
}

function back() {
  if (isEdit.value) {
    router.push(`/opportunities/${id.value}`)
    return
  }
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
  const missing = [
    ...builtinMissing(),
    ...((customFieldRef.value?.validate?.() || []) as { field_code: string; field_name: string }[]),
  ]
  if (missing.length) {
    ElMessage.warning(`请填写当前阶段必填项：${missing.map((m) => m.field_name).join('、')}`)
    focusField(missing[0].field_code)
    return
  }
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
      let res
      try {
        res = await api.createOpportunity(payload)
      } catch (e: any) {
        if (e?.status !== 409) throw e
        // 同一客户下已存在同名进行中商机，确认后可继续创建
        const confirmed = await ElMessageBox.confirm('该客户下已存在同名进行中商机，仍要创建一个新的吗？', '商机重复提醒', {
          type: 'warning',
          confirmButtonText: '继续创建',
          cancelButtonText: '取消',
        }).then(() => true).catch(() => false)
        if (!confirmed) return
        res = await api.createOpportunity({ ...payload, ignore_duplicate: true })
      }
      ElMessage.success('商机创建成功')
      router.push(`/opportunities/${res.id}`)
    }
  } finally {
    submitting.value = false
  }
}

function focusField(key: string) {
  const el = document.getElementById(`field-${key}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const input = el.querySelector('input, textarea') as HTMLElement | null
  input?.focus?.()
}

/** 由推进弹窗“去填写”带入的字段定位 */
async function focusRequestedField() {
  const key = String(route.query.focus || '')
  if (!key) return
  await nextTick()
  focusField(key)
}

/** 阶段列表用于判断“当前阶段”的必填字段 */
async function loadStages() {
  try {
    stageOptions.value = await api.stageOptions(true)
  } catch (e) {
    stageOptions.value = []
  }
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  await loadStages()
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
      loadedStageId.value = row.stage_config_id || ''
      stageRequiredBuiltin.value = ((row.fixed_actions?.items || []) as any[])
        .filter((i) => i?.is_required === 1 && !i.core && !!BUILTIN_LABELS[i?.field_key])
        .map((i) => i.field_key)
      if (row.customer_id) customerOptions.value = [{ id: row.customer_id, name: row.customer_name || '当前客户' }]
    } finally {
      loading.value = false
    }
    await focusRequestedField()
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
