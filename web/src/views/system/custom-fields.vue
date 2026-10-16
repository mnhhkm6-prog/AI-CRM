<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">自定义字段</h2>
          <span class="text-muted">字段定义变更影响录入表单与列表列（M12-R1~R3）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
          <el-button v-if="canManage" type="primary" @click="openCreate">新增字段</el-button>
        </div>
      </div>

      <el-tabs v-model="entityType" @tab-change="load">
        <el-tab-pane v-for="t in ENTITY_TABS" :key="t.key" :label="t.label" :name="t.key" />
      </el-tabs>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column prop="field_name" label="字段名称" min-width="130" show-overflow-tooltip />
        <el-table-column prop="field_code" label="字段编码" width="150" show-overflow-tooltip />
        <el-table-column label="字段类型" width="110">
          <template #default="{ row }">{{ fieldTypeLabel(row.field_type) }}</template>
        </el-table-column>
        <el-table-column label="必填" width="70" align="center">
          <template #default="{ row }">{{ isOn(row.is_required) ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="字段分组" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.field_group || '—' }}</template>
        </el-table-column>
        <el-table-column prop="sort_order" label="排序" width="70" align="center" />
        <el-table-column label="列表可见" width="80" align="center">
          <template #default="{ row }">{{ isOn(row.is_list_visible) ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="查重" width="70" align="center">
          <template #default="{ row }">{{ isOn(row.is_dup_check) ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="isOn(row.is_enabled) ? 'success' : 'info'" effect="plain">
              {{ isOn(row.is_enabled) ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canManage" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="canManage"
              link
              :type="isOn(row.is_enabled) ? 'danger' : 'primary'"
              @click="toggle(row)"
            >
              {{ isOn(row.is_enabled) ? '停用' : '启用' }}
            </el-button>
            <el-button link type="primary" @click="openReferences(row)">引用详情</el-button>
            <el-button v-if="canManage && !isOn(row.is_system)" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无数据</div>
        </template>
      </el-table>
    </div>

    <!-- 新增 / 编辑字段（抽屉 480px） -->
    <el-drawer v-model="drawer" :title="editing ? '编辑字段' : '新增字段'" size="480px" @closed="resetForm">
      <el-form label-width="100px">
        <el-form-item label="实体类型">
          <el-input :model-value="entityLabel(entityType)" disabled />
        </el-form-item>
        <el-form-item label="字段编码" required>
          <el-input v-model="form.field_code" maxlength="60" placeholder="英文字段编码" :disabled="!!editing" />
          <div v-if="editing" class="el-upload__tip">字段编码创建后不可修改</div>
        </el-form-item>
        <el-form-item label="字段名称" required>
          <el-input v-model="form.field_name" maxlength="60" placeholder="请输入字段名称" />
        </el-form-item>
        <el-form-item label="字段类型" required>
          <el-select v-model="form.field_type" placeholder="请选择字段类型" style="width: 100%">
            <el-option v-for="t in FIELD_TYPES" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="字段分组">
          <el-input v-model="form.field_group" maxlength="60" placeholder="请输入字段分组（可空）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="是否必填">
          <el-switch v-model="form.is_required" />
        </el-form-item>
        <el-form-item label="是否列表可见">
          <el-switch v-model="form.is_list_visible" />
        </el-form-item>
        <el-form-item label="是否参与查重">
          <el-switch v-model="form.is_dup_check" />
        </el-form-item>
        <el-form-item label="默认值">
          <el-input v-model="form.default_value" maxlength="200" placeholder="请输入默认值（可空）" />
        </el-form-item>
        <el-form-item v-if="showOptions" label="选项">
          <el-select
            v-model="form.options"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入后回车添加选项"
            style="width: 100%"
          />
          <div class="el-upload__tip">输入后回车添加选项</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawer = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSubmit">提交</el-button>
      </template>
    </el-drawer>

    <!-- 引用详情 -->
    <el-dialog v-model="refDialog" title="引用详情" width="480px" align-center>
      <div v-loading="refLoading">
        <p class="text-muted mb-12">字段「{{ current?.field_name }}（{{ current?.field_code }}）」被以下配置引用。</p>
        <ul v-if="refList.length" class="ref-list">
          <li v-for="(r, i) in refList" :key="i" class="ref-list__item">
            <el-tag size="small" effect="plain">{{ refTypeLabel(r.type) }}</el-tag>
            <span class="ref-list__name">{{ r.name || '—' }}</span>
          </li>
        </ul>
        <p v-else-if="!refLoading" class="empty-tip">未被引用</p>
      </div>
      <template #footer>
        <el-button @click="refDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

/** 实体类型页签（中文名） */
const ENTITY_TABS = [
  { key: 'customer', label: '客户' },
  { key: 'contact', label: '联系人' },
  { key: 'lead', label: '线索' },
  { key: 'opportunity', label: '商机' },
  { key: 'activity', label: '行为记录' },
  { key: 'proposal', label: '方案' },
  { key: 'quotation', label: '报价' },
  { key: 'contract', label: '合同' },
]

/** 字段类型（中文标签） */
const FIELD_TYPES = [
  { value: 'text', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'amount', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'select', label: '单选下拉' },
  { value: 'multi_select', label: '多选下拉' },
  { value: 'boolean', label: '布尔开关' },
  { value: 'attachment_list', label: '附件列表' },
  { value: 'json', label: 'JSON' },
]

/** 引用来源中文映射 */
const REF_TYPE_LABEL: Record<string, string> = {
  stage_action_rule: '阶段固定动作',
  view_config: '视图配置',
  report_template: '报表模板',
}

const loading = ref(false)
const submitting = ref(false)
const refLoading = ref(false)

const entityType = ref('customer')
const items = ref<any[]>([])

const drawer = ref(false)
const editing = ref<any>(null)

const refDialog = ref(false)
const refList = ref<any[]>([])
const current = ref<any>(null)

const form = reactive<any>({
  field_code: '',
  field_name: '',
  field_type: 'text',
  field_group: '',
  sort_order: 0,
  is_required: false,
  is_list_visible: true,
  is_dup_check: false,
  default_value: '',
  options: [] as string[],
})

const canManage = computed(() => userStore.hasPerm('custom_field:manage'))
const showOptions = computed(() => form.field_type === 'select' || form.field_type === 'multi_select')

function isOn(v: any) {
  return v === 1 || v === true
}

function fieldTypeLabel(type: string) {
  return FIELD_TYPES.find((t) => t.value === type)?.label || type || '—'
}

function entityLabel(key: string) {
  return ENTITY_TABS.find((t) => t.key === key)?.label || key
}

function refTypeLabel(type: string) {
  return REF_TYPE_LABEL[type] || type
}

/** 选项归一化：兼容字符串数组或 { value/label } 数组 */
function normalizeOptions(opts: any): string[] {
  if (!Array.isArray(opts)) return []
  return opts
    .map((o) => (typeof o === 'string' ? o : o?.value ?? o?.label ?? ''))
    .filter((v) => v !== '')
}

async function load() {
  loading.value = true
  try {
    items.value = (await api.listCustomFields(entityType.value)) || []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    field_code: '',
    field_name: '',
    field_type: 'text',
    field_group: '',
    sort_order: 0,
    is_required: false,
    is_list_visible: true,
    is_dup_check: false,
    default_value: '',
    options: [],
  })
  drawer.value = true
}

function openEdit(row: any) {
  editing.value = row
  Object.assign(form, {
    field_code: row.field_code || '',
    field_name: row.field_name || '',
    field_type: row.field_type || 'text',
    field_group: row.field_group || '',
    sort_order: row.sort_order ?? 0,
    is_required: isOn(row.is_required),
    is_list_visible: isOn(row.is_list_visible),
    is_dup_check: isOn(row.is_dup_check),
    default_value: row.default_value ?? '',
    options: normalizeOptions(row.options),
  })
  drawer.value = true
}

function resetForm() {
  editing.value = null
}

async function confirmSubmit() {
  if (!editing.value && !form.field_code.trim()) {
    ElMessage.warning('请输入字段编码')
    return
  }
  if (!form.field_name.trim()) {
    ElMessage.warning('请输入字段名称')
    return
  }
  if (!form.field_type) {
    ElMessage.warning('请选择字段类型')
    return
  }
  submitting.value = true
  try {
    const body: Record<string, any> = {
      field_name: form.field_name.trim(),
      field_type: form.field_type,
      field_group: form.field_group.trim() || null,
      sort_order: Number(form.sort_order) || 0,
      is_required: form.is_required,
      is_list_visible: form.is_list_visible,
      is_dup_check: form.is_dup_check,
      default_value: form.default_value.trim() || null,
      options: showOptions.value ? form.options : [],
    }
    if (editing.value) {
      await api.updateCustomField(editing.value.id, body)
      ElMessage.success('已保存')
    } else {
      await api.createCustomField({
        entity_type: entityType.value,
        field_code: form.field_code.trim(),
        ...body,
      })
      ElMessage.success('字段已创建')
    }
    drawer.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function toggle(row: any) {
  const next = !isOn(row.is_enabled)
  const action = next ? '启用' : '停用'
  await ElMessageBox.confirm(`确认${action}字段「${row.field_name}」？`, `${action}确认`, { type: 'warning' })
  await api.toggleCustomField(row.id, next)
  ElMessage.success(`已${action}`)
  await load()
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除字段「${row.field_name}」？`, '删除确认', { type: 'warning' })
  try {
    await api.deleteCustomField(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    ElMessage.error(e?.bizMessage || '删除失败')
  }
}

async function openReferences(row: any) {
  current.value = row
  refDialog.value = true
  refLoading.value = true
  refList.value = []
  try {
    const res = await api.customFieldReferences(row.id)
    refList.value = res?.list || []
  } finally {
    refLoading.value = false
  }
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.ref-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ref-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--crm-border);
}

.ref-list__item:last-child {
  border-bottom: none;
}

.ref-list__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
