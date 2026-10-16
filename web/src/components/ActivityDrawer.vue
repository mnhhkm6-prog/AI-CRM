<template>
  <el-drawer v-model="visible" :title="isEdit ? '编辑行为记录' : '新增行为记录'" size="480px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="行为类型" prop="activity_type">
        <el-select v-model="form.activity_type" placeholder="请选择" style="width: 100%">
          <el-option v-for="o in ACTIVITY_TYPES" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="发生时间" prop="activity_time">
        <el-date-picker
          v-model="form.activity_time"
          type="datetime"
          value-format="YYYY-MM-DD HH:mm:ss"
          placeholder="默认当前时间"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="关联客户" prop="customer_id">
        <el-select
          v-model="form.customer_id"
          filterable
          remote
          clearable
          :remote-method="searchCustomers"
          :loading="customerLoading"
          placeholder="搜索并选择客户"
          style="width: 100%"
          @change="onCustomerChange"
        >
          <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联商机">
        <el-select v-model="form.opportunity_id" clearable filterable placeholder="选填" style="width: 100%">
          <el-option v-for="o in opportunityOptions" :key="o.id" :label="o.name" :value="o.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="内容摘要" prop="content">
        <el-input v-model="form.content" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="请输入本次行为的详细内容" />
      </el-form-item>
      <el-form-item label="下次回访">
        <el-date-picker
          v-model="form.follow_up_time"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选填，填写后生成回访提醒"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <div class="drawer-actions">
      <el-button type="primary" :loading="submitting" @click="save">保存</el-button>
      <el-button @click="visible = false">取消</el-button>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import * as api from '@/api'
import { ACTIVITY_TYPES } from '@/config/options'

/**
 * 行为记录抽屉（P16 / PRD 5.4）
 * 供「行为记录」列表页与商机详情、客户 360 复用
 */
const props = withDefaults(
  defineProps<{
    record?: any
    defaultCustomerId?: string
    defaultCustomerName?: string
    defaultOpportunityId?: string
    defaultOpportunityName?: string
  }>(),
  { record: null }
)
const emit = defineEmits<{ saved: [] }>()

const visible = defineModel<boolean>({ required: true })

const formRef = ref<FormInstance>()
const submitting = ref(false)
const customerLoading = ref(false)
const customerOptions = ref<any[]>([])
const opportunityOptions = ref<any[]>([])

const isEdit = computed(() => !!props.record?.id)

const form = reactive<any>({
  activity_type: '', activity_time: '', customer_id: '', opportunity_id: '', content: '', follow_up_time: '',
})

const rules: FormRules = {
  activity_type: [{ required: true, message: '请选择行为类型', trigger: 'change' }],
  activity_time: [{ required: true, message: '请选择发生时间', trigger: 'change' }],
  customer_id: [{ required: true, message: '请选择关联客户', trigger: 'change' }],
  content: [{ required: true, message: '请输入内容摘要', trigger: 'blur' }],
}

function nowStr() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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

async function loadOpportunities(customerId: string) {
  if (!customerId) {
    opportunityOptions.value = []
    return
  }
  try {
    const res = await api.listOpportunities({ customer_id: customerId, page_size: 100 })
    opportunityOptions.value = res.list || []
  } catch (e) {
    opportunityOptions.value = []
  }
}

function onCustomerChange(id: string) {
  form.opportunity_id = ''
  loadOpportunities(id)
}

/** 打开抽屉时初始化表单 */
watch(visible, async (open) => {
  if (!open) return
  Object.assign(form, {
    activity_type: '', activity_time: nowStr(), customer_id: '', opportunity_id: '', content: '', follow_up_time: '',
  })
  customerOptions.value = []
  opportunityOptions.value = []

  if (props.record) {
    Object.assign(form, {
      activity_type: props.record.activity_type || '',
      activity_time: String(props.record.activity_time || '').slice(0, 19).replace('T', ' '),
      customer_id: props.record.customer_id || '',
      opportunity_id: props.record.opportunity_id || '',
      content: props.record.content || '',
      follow_up_time: String(props.record.follow_up_time || '').slice(0, 10),
    })
    if (form.customer_id && props.record.customer_name) {
      customerOptions.value = [{ id: form.customer_id, name: props.record.customer_name }]
    }
    await loadOpportunities(form.customer_id)
    return
  }

  // 新建：带入默认关联对象
  if (props.defaultCustomerId) {
    form.customer_id = props.defaultCustomerId
    customerOptions.value = [{ id: props.defaultCustomerId, name: props.defaultCustomerName || '当前客户' }]
    await loadOpportunities(props.defaultCustomerId)
  }
  if (props.defaultOpportunityId) {
    form.opportunity_id = props.defaultOpportunityId
    if (!props.defaultOpportunityId || !opportunityOptions.value.some((o) => o.id === props.defaultOpportunityId)) {
      opportunityOptions.value = [
        ...opportunityOptions.value,
        { id: props.defaultOpportunityId, name: props.defaultOpportunityName || '当前商机' },
      ]
    }
  }
})

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const payload = {
      activity_type: form.activity_type,
      activity_time: form.activity_time,
      customer_id: form.customer_id || undefined,
      opportunity_id: form.opportunity_id || undefined,
      content: form.content,
      follow_up_time: form.follow_up_time || undefined,
    }
    if (isEdit.value) await api.updateActivity(props.record.id, payload)
    else await api.createActivity(payload)
    ElMessage.success('已保存')
    visible.value = false
    emit('saved')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
