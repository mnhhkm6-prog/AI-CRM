<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">阶段编辑</h2>
          <span class="text-muted">阶段属性与固定动作配置，保存后即时生效于商机推进校验（P34）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="goBack">返回列表</el-button>
          <el-button v-if="canManage" type="primary" :loading="submitting" @click="save">保存</el-button>
        </div>
      </div>

      <div v-loading="loading" class="edit-layout">
        <!-- 左：阶段属性 -->
        <div class="edit-main">
          <h3 class="section-card__title">阶段属性</h3>
          <el-form label-width="110px" :disabled="!canManage">
            <el-form-item label="阶段名称" required>
              <el-input v-model="form.name" maxlength="30" />
            </el-form-item>
            <el-form-item label="阶段编码">
              <el-input v-model="form.code" disabled placeholder="阶段编码创建后不可修改" />
            </el-form-item>
            <el-form-item label="说明">
              <el-input v-model="form.description" type="textarea" :rows="2" maxlength="200" />
            </el-form-item>
            <el-form-item label="排序">
              <el-input-number v-model="form.sort_order" :min="0" :controls="false" style="width: 160px" />
            </el-form-item>
            <el-form-item label="进入条件">
              <el-input v-model="form.entry_condition" type="textarea" :rows="2" maxlength="200" />
            </el-form-item>
            <el-form-item label="交付物">
              <el-input v-model="form.deliverables" type="textarea" :rows="2" maxlength="200" />
            </el-form-item>
            <el-form-item label="可见角色">
              <el-select v-model="form.roles" multiple filterable collapse-tags placeholder="不选则全部角色可见" style="width: 100%">
                <el-option v-for="r in roles" :key="r.role_code" :label="r.role_name" :value="r.role_code" />
              </el-select>
            </el-form-item>
            <el-form-item label="是否终态">
              <el-switch v-model="form.is_terminal" :disabled="!canManage || isSystem" />
              <span v-if="isSystem" class="text-muted" style="margin-left: 8px">内置阶段不可修改终态设置</span>
            </el-form-item>
            <el-form-item v-if="form.is_terminal" label="终态类型">
              <el-radio-group v-model="form.terminal_type" :disabled="!canManage || isSystem">
                <el-radio value="win">赢单</el-radio>
                <el-radio value="loss">失败</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="启用状态">
              <el-switch v-model="form.is_enabled" />
            </el-form-item>
          </el-form>

          <h3 class="section-card__title">停滞预警阈值（可选，留空则用全局阈值）</h3>
          <el-form label-width="110px" :disabled="!canManage">
            <el-form-item label="一级（天）">
              <el-input-number v-model="thresholds.level1" :min="0" :controls="false" style="width: 140px" />
            </el-form-item>
            <el-form-item label="二级（天）">
              <el-input-number v-model="thresholds.level2" :min="0" :controls="false" style="width: 140px" />
            </el-form-item>
            <el-form-item label="三级（天）">
              <el-input-number v-model="thresholds.level3" :min="0" :controls="false" style="width: 140px" />
            </el-form-item>
          </el-form>
        </div>

        <!-- 右：固定动作 -->
        <div class="edit-aside-card">
          <div class="aside-head">
            <span>固定动作（{{ rules.length }}）</span>
            <el-button v-if="canManage" link type="primary" @click="openRuleCreate">新增动作</el-button>
          </div>
          <el-table v-loading="rulesLoading" :data="rules" size="small" style="width: 100%">
            <el-table-column prop="action_name" label="动作名称" min-width="120" show-overflow-tooltip />
            <el-table-column prop="field_key" label="字段键" width="130" show-overflow-tooltip />
            <el-table-column label="类型" width="100" align="center">
              <template #default="{ row }">{{ FIELD_TYPE_LABEL[row.field_type] || row.field_type }}</template>
            </el-table-column>
            <el-table-column label="必填" width="70" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.is_required === 1 ? 'danger' : 'info'" effect="plain">
                  {{ row.is_required === 1 ? '是' : '否' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="排序" width="70" align="right" class-name="num">
              <template #default="{ row }">{{ row.sort_order }}</template>
            </el-table-column>
            <el-table-column label="状态" width="80" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.is_enabled === 1 ? 'success' : 'info'" effect="plain">
                  {{ row.is_enabled === 1 ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" align="center" fixed="right">
              <template #default="{ row }">
                <el-button v-if="canManage" link type="primary" @click="openRuleEdit(row)">编辑</el-button>
                <el-button v-if="canManage" link type="danger" @click="removeRule(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="empty-tip">暂无固定动作</div>
            </template>
          </el-table>
        </div>
      </div>
    </div>

    <!-- 固定动作弹窗 -->
    <el-dialog v-model="ruleDialog" :title="ruleEditing ? '编辑固定动作' : '新增固定动作'" width="480px" align-center @closed="resetRule">
      <el-form label-width="96px">
        <el-form-item label="动作名称" required>
          <el-input v-model="ruleForm.action_name" maxlength="30" placeholder="如 填写客户预算" />
        </el-form-item>
        <el-form-item label="字段键" required>
          <el-input v-model="ruleForm.field_key" maxlength="50" :disabled="!!ruleEditing" placeholder="自定义字段编码或核心字段名" />
        </el-form-item>
        <el-form-item label="字段类型" required>
          <el-select v-model="ruleForm.field_type" style="width: 100%">
            <el-option v-for="(label, value) in FIELD_TYPE_LABEL" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="是否必填">
          <el-switch v-model="ruleForm.is_required" />
        </el-form-item>
        <el-form-item v-if="needOptions" label="选项">
          <el-select
            v-model="ruleForm.options"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入后回车添加选项"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="提示语">
          <el-input v-model="ruleForm.tip" maxlength="100" placeholder="推进时展示给销售的提示" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="ruleForm.sort_order" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="ruleForm.is_enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmRule">提交</el-button>
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

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const FIELD_TYPE_LABEL: Record<string, string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  amount: '金额',
  date: '日期',
  datetime: '日期时间',
  select: '单选下拉',
  multi_select: '多选下拉',
  boolean: '布尔开关',
}

const loading = ref(false)
const submitting = ref(false)
const rulesLoading = ref(false)
const stage = ref<any>(null)
const rules = ref<any[]>([])
const roles = ref<any[]>([])

const ruleDialog = ref(false)
const ruleEditing = ref<any>(null)

const form = reactive<any>({
  code: '',
  name: '',
  description: '',
  sort_order: 0,
  entry_condition: '',
  deliverables: '',
  is_terminal: false,
  terminal_type: 'win',
  is_enabled: true,
  roles: [],
})
const thresholds = reactive<any>({ level1: undefined, level2: undefined, level3: undefined })
const ruleForm = reactive<any>({
  action_name: '',
  field_key: '',
  field_type: 'text',
  is_required: true,
  options: [],
  tip: '',
  sort_order: 0,
  is_enabled: true,
})

const canManage = computed(() => userStore.hasPerm('stage_config:manage'))
const isSystem = computed(() => stage.value?.is_system === 1)
const needOptions = computed(() => ruleForm.field_type === 'select' || ruleForm.field_type === 'multi_select')
const stageId = computed(() => String(route.params.id || ''))

async function load() {
  loading.value = true
  try {
    const list = await api.listStageConfigs({ include_disabled: 1 })
    const hit = (list || []).find((s: any) => s.id === stageId.value)
    if (!hit) {
      ElMessage.error('阶段不存在')
      goBack()
      return
    }
    stage.value = hit
    Object.assign(form, {
      code: hit.code,
      name: hit.name,
      description: hit.description || '',
      sort_order: hit.sort_order || 0,
      entry_condition: hit.entry_condition || '',
      deliverables: hit.deliverables || '',
      is_terminal: hit.is_terminal === 1,
      terminal_type: hit.terminal_type || 'win',
      is_enabled: hit.is_enabled === 1,
      roles: Array.isArray(hit.roles) ? hit.roles : [],
    })
    const th = hit.alert_thresholds || {}
    thresholds.level1 = th.level1 ?? undefined
    thresholds.level2 = th.level2 ?? undefined
    thresholds.level3 = th.level3 ?? undefined
    rules.value = hit.action_rules || []
  } finally {
    loading.value = false
  }
}

async function loadRoles() {
  try {
    roles.value = await api.listRoles({ is_enabled: 1 })
  } catch (e) {
    roles.value = []
  }
}

async function loadRules() {
  rulesLoading.value = true
  try {
    rules.value = await api.listStageActionRules(stageId.value)
  } finally {
    rulesLoading.value = false
  }
}

function goBack() {
  router.push('/system/stages')
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入阶段名称')
    return
  }
  const hasThreshold = thresholds.level1 || thresholds.level2 || thresholds.level3
  if (hasThreshold && !(thresholds.level1 && thresholds.level2 && thresholds.level3)) {
    ElMessage.warning('阶段预警阈值需三项全部填写，或全部留空')
    return
  }
  submitting.value = true
  try {
    const body: Record<string, any> = {
      name: form.name.trim(),
      description: form.description || null,
      sort_order: Number(form.sort_order) || 0,
      entry_condition: form.entry_condition || null,
      deliverables: form.deliverables || null,
      roles: form.roles,
      is_enabled: form.is_enabled,
      alert_thresholds: hasThreshold
        ? { level1: Number(thresholds.level1), level2: Number(thresholds.level2), level3: Number(thresholds.level3) }
        : null,
    }
    if (!isSystem.value) {
      body.is_terminal = form.is_terminal
      body.terminal_type = form.is_terminal ? form.terminal_type : null
    }
    await api.updateStageConfig(stageId.value, body)
    ElMessage.success('已保存')
    await load()
  } finally {
    submitting.value = false
  }
}

function openRuleCreate() {
  ruleEditing.value = null
  Object.assign(ruleForm, {
    action_name: '',
    field_key: '',
    field_type: 'text',
    is_required: true,
    options: [],
    tip: '',
    sort_order: (rules.value.length + 1) * 10,
    is_enabled: true,
  })
  ruleDialog.value = true
}

function openRuleEdit(row: any) {
  ruleEditing.value = row
  let options: string[] = []
  if (row.options) {
    try {
      const parsed = JSON.parse(row.options)
      options = Array.isArray(parsed) ? parsed : []
    } catch (e) {
      options = []
    }
  }
  Object.assign(ruleForm, {
    action_name: row.action_name,
    field_key: row.field_key,
    field_type: row.field_type,
    is_required: row.is_required === 1,
    options,
    tip: row.tip || '',
    sort_order: row.sort_order || 0,
    is_enabled: row.is_enabled === 1,
  })
  ruleDialog.value = true
}

function resetRule() {
  ruleEditing.value = null
}

async function confirmRule() {
  if (!ruleForm.action_name.trim()) {
    ElMessage.warning('请输入动作名称')
    return
  }
  if (!ruleForm.field_key.trim()) {
    ElMessage.warning('请输入字段键')
    return
  }
  if (!ruleForm.field_type) {
    ElMessage.warning('请选择字段类型')
    return
  }
  submitting.value = true
  try {
    const body = {
      action_name: ruleForm.action_name.trim(),
      field_key: ruleForm.field_key.trim(),
      field_type: ruleForm.field_type,
      is_required: ruleForm.is_required,
      options: needOptions.value ? ruleForm.options : null,
      tip: ruleForm.tip || null,
      sort_order: Number(ruleForm.sort_order) || 0,
      is_enabled: ruleForm.is_enabled,
    }
    if (ruleEditing.value) {
      // 字段键创建后不可修改，更新时不提交
      const { action_name, field_type, is_required, options, tip, sort_order, is_enabled } = body
      await api.updateStageActionRule(ruleEditing.value.id, {
        action_name,
        field_type,
        is_required,
        options,
        tip,
        sort_order,
        is_enabled,
      })
      ElMessage.success('已保存')
    } else {
      await api.createStageActionRule(stageId.value, body)
      ElMessage.success('固定动作已创建')
    }
    ruleDialog.value = false
    await loadRules()
  } finally {
    submitting.value = false
  }
}

async function removeRule(row: any) {
  await ElMessageBox.confirm(`确认删除固定动作「${row.action_name}」？`, '删除确认', { type: 'warning' })
  await api.deleteStageActionRule(row.id)
  ElMessage.success('已删除')
  await loadRules()
}

onMounted(async () => {
  await Promise.all([loadRoles(), load()])
})
</script>

<style scoped>
.edit-layout {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.edit-main {
  flex: 1;
  min-width: 0;
}

.edit-aside-card {
  width: 520px;
  flex-shrink: 0;
}

.aside-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}

@media (max-width: 1400px) {
  .edit-layout {
    flex-direction: column;
  }

  .edit-aside-card {
    width: 100%;
  }
}
</style>
