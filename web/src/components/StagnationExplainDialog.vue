<template>
  <el-drawer v-model="visible" title="填写停滞说明" size="480px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
      <el-form-item label="停滞原因" prop="reason">
        <el-input v-model="form.reason" maxlength="100" show-word-limit placeholder="请简要说明停滞原因" />
      </el-form-item>
      <el-form-item label="详细说明" prop="detail">
        <el-input
          v-model="form.detail"
          type="textarea"
          :rows="4"
          maxlength="500"
          show-word-limit
          placeholder="请填写详细说明"
        />
      </el-form-item>
      <el-form-item label="预计推进日期" prop="expected_date">
        <el-date-picker
          v-model="form.expected_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择预计推进日期"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <div class="drawer-actions">
      <el-button type="primary" :loading="submitting" @click="save">提交申请</el-button>
      <el-button @click="visible = false">取消</el-button>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import * as api from '@/api'

/**
 * 停滞说明申请抽屉（P24）
 * 供「停滞预警列表」「未推进列表」复用：填写延期说明并提交审批
 */
const props = defineProps<{ opportunityId: string }>()
const emit = defineEmits<{ submitted: [] }>()

const visible = defineModel<boolean>({ required: true })

const formRef = ref<FormInstance>()
const submitting = ref(false)

const form = reactive<{ reason: string; detail: string; expected_date: string }>({
  reason: '',
  detail: '',
  expected_date: '',
})

const rules: FormRules = {
  reason: [{ required: true, message: '请填写停滞原因', trigger: 'blur' }],
  detail: [{ required: true, message: '请填写详细说明', trigger: 'blur' }],
  expected_date: [{ required: true, message: '请选择预计推进日期', trigger: 'change' }],
}

/** 打开抽屉时重置表单 */
watch(visible, (open) => {
  if (!open) return
  Object.assign(form, { reason: '', detail: '', expected_date: '' })
  formRef.value?.clearValidate()
})

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await api.submitStagnationExplain(props.opportunityId, {
      reason: form.reason,
      detail: form.detail,
      expected_date: form.expected_date,
    })
    ElMessage.success('停滞说明已提交审批')
    visible.value = false
    emit('submitted')
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
