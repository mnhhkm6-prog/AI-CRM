<template>
  <el-drawer v-model="visible" :title="isEdit ? '编辑提醒' : '设置提醒'" size="440px" @closed="onClosed">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="关联对象">
        <el-radio-group v-model="form.entity_type" :disabled="locked || isEdit" @change="onEntityTypeChange">
          <el-radio value="none">不关联</el-radio>
          <el-radio value="opportunity">商机</el-radio>
          <el-radio value="customer">客户</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item
        v-if="form.entity_type !== 'none'"
        :label="form.entity_type === 'opportunity' ? '选择商机' : '选择客户'"
        prop="entity_id"
      >
        <el-select
          v-model="form.entity_id"
          filterable
          remote
          clearable
          :remote-method="searchEntity"
          :loading="loadingOptions"
          :disabled="locked || isEdit"
          placeholder="输入名称搜索"
          style="width: 100%"
        >
          <el-option v-for="o in entityOptions" :key="o.id" :label="o.name" :value="o.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="提醒事项" prop="title">
        <el-input v-model="form.title" maxlength="100" show-word-limit placeholder="例如：给张总回电话" />
      </el-form-item>
      <el-form-item label="提醒时间" required>
        <div class="datetime-row">
          <el-date-picker
            v-model="form.remind_date"
            type="date"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            style="flex: 1"
          />
          <el-time-select
            v-model="form.remind_time"
            start="00:00"
            step="00:15"
            end="23:45"
            placeholder="选择时间"
            style="width: 120px"
          />
        </div>
      </el-form-item>
      <el-form-item label="重复">
        <el-select v-model="form.repeat_rule" style="width: 100%">
          <el-option label="不重复" value="none" />
          <el-option label="每天" value="daily" />
          <el-option label="每周" value="weekly" />
          <el-option label="每月" value="monthly" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="form.repeat_rule !== 'none'" label="重复截止">
        <el-date-picker
          v-model="form.repeat_until"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="不填表示长期重复"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.content" type="textarea" :rows="3" maxlength="500" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import * as api from '@/api'

interface EntityOption {
  id: string
  name: string
}

const props = defineProps<{
  modelValue: boolean
  preset?: { entity_type: 'customer' | 'opportunity' | 'none'; entity_id: string; entity_name?: string } | null
  editRow?: any
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'saved'): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})
const isEdit = computed(() => !!props.editRow)
const locked = computed(() => !!props.preset)

const formRef = ref<FormInstance>()
const saving = ref(false)
const loadingOptions = ref(false)
const entityOptions = ref<EntityOption[]>([])

const form = reactive({
  entity_type: 'none' as 'customer' | 'opportunity' | 'none',
  entity_id: '',
  title: '',
  remind_date: '',
  remind_time: '',
  repeat_rule: 'none',
  repeat_until: '',
  content: '',
})

const rules = computed<FormRules>(() => ({
  entity_id:
    form.entity_type === 'none'
      ? []
      : [{ required: true, message: '请选择关联的客户或商机', trigger: 'change' }],
  title: [{ required: true, message: '请填写提醒事项', trigger: 'blur' }],
}))

function fallbackOption(id: string, name?: string) {
  if (!id) return
  if (!entityOptions.value.some((o) => o.id === id)) {
    entityOptions.value = [{ id, name: name || '已选对象' }, ...entityOptions.value]
  }
}

async function searchEntity(keyword: string) {
  const kw = (keyword || '').trim()
  if (!kw) return
  loadingOptions.value = true
  try {
    const res: any =
      form.entity_type === 'opportunity'
        ? await api.listOpportunities({ page: 1, page_size: 20, keyword: kw })
        : await api.listCustomers({ page: 1, page_size: 20, keyword: kw })
    entityOptions.value = (res?.list || res || []).map((x: any) => ({ id: x.id, name: x.name }))
  } catch {
    entityOptions.value = []
  } finally {
    loadingOptions.value = false
  }
}

function onEntityTypeChange() {
  form.entity_id = ''
  entityOptions.value = []
}

function resetForm() {
  form.entity_type = props.preset?.entity_type || props.editRow?.entity_type || 'none'
  form.entity_id = props.preset?.entity_id || props.editRow?.entity_id || ''
  form.title = props.editRow?.title || ''
  const remindAt = String(props.editRow?.remind_at || '')
  form.remind_date = remindAt.slice(0, 10)
  form.remind_time = remindAt.slice(11, 16)
  form.repeat_rule = props.editRow?.repeat_rule || 'none'
  form.repeat_until = props.editRow?.repeat_until || ''
  form.content = props.editRow?.content || ''
  entityOptions.value = []
  fallbackOption(form.entity_id, props.preset?.entity_name || props.editRow?.entity_name)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm()
  },
)

function onClosed() {
  formRef.value?.clearValidate()
}

async function submit() {
  if (!form.remind_date || !form.remind_time) {
    ElMessage.warning('请选择提醒日期与时间')
    return
  }
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = {
      entity_type: form.entity_type,
      entity_id: form.entity_type === 'none' ? '' : form.entity_id,
      title: form.title,
      remind_at: `${form.remind_date} ${form.remind_time}`,
      repeat_rule: form.repeat_rule,
      repeat_until: form.repeat_rule === 'none' ? null : form.repeat_until || null,
      content: form.content,
    }
    if (isEdit.value) {
      await api.updateReminder(props.editRow.id, payload)
      ElMessage.success('提醒已更新')
    } else {
      await api.createReminder(payload)
      ElMessage.success('提醒已创建')
    }
    emit('saved')
    visible.value = false
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.datetime-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
</style>
