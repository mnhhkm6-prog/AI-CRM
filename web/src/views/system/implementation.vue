<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">实施向导</h2>
          <span class="text-muted">新企业本地化部署的分步配置入口（M16-R1~R4）</span>
        </div>
        <div class="page-head__right">
          <el-button :loading="loading" @click="refresh">
            <el-icon><Refresh /></el-icon>
            <span>刷新</span>
          </el-button>
        </div>
      </div>

      <el-alert
        v-if="finished"
        type="success"
        show-icon
        :closable="false"
        class="mb-12"
        :title="`配置已完成于 ${fmt(manifest?.generated_at || updatedAt)}`"
        description="仍可重新走一遍向导以更新配置。"
      />

      <el-tabs v-model="tab">
        <!-- ============ 页签 1：实施向导 ============ -->
        <el-tab-pane label="实施向导" name="wizard">
          <div v-loading="loading" class="wizard-block">
            <el-steps :active="active" align-center finish-status="success" class="mb-12">
              <el-step v-for="s in STEPS" :key="s.key" :title="s.title" />
            </el-steps>

            <!-- 1 基础信息 -->
            <div v-show="currentKey === 'basic'" class="step-pane">
              <el-form label-width="120px" style="max-width: 520px">
                <el-form-item label="企业名称" required>
                  <el-input v-model="basic.company_name" maxlength="80" placeholder="请输入企业名称" />
                </el-form-item>
                <el-form-item label="所属行业">
                  <el-input v-model="basic.industry" maxlength="40" placeholder="如：软件与信息服务" />
                </el-form-item>
                <el-form-item label="公司规模">
                  <el-input v-model="basic.company_size" maxlength="40" placeholder="如：50-200 人" />
                </el-form-item>
                <el-form-item label="管理员联系方式">
                  <el-input v-model="basic.admin_contact" maxlength="60" placeholder="手机号 / 邮箱" />
                </el-form-item>
              </el-form>
            </div>

            <!-- 2 漏斗配置 -->
            <div v-show="currentKey === 'funnel'" class="step-pane">
              <el-form label-width="120px" style="max-width: 640px">
                <el-form-item label="实施模式">
                  <el-radio-group v-model="mode">
                    <el-radio value="default">使用出厂默认漏斗</el-radio>
                    <el-radio value="template">基于模板包配置</el-radio>
                    <el-radio value="custom">自定义阶段</el-radio>
                  </el-radio-group>
                </el-form-item>
              </el-form>
              <el-alert
                v-if="mode === 'template'"
                type="info"
                show-icon
                :closable="false"
                class="step-tip"
                title="提示"
                description="可先到「模板包管理」页签导出/导入模板包再回头继续。"
              />
              <el-alert
                v-else-if="mode === 'custom'"
                type="info"
                show-icon
                :closable="false"
                class="step-tip"
                title="提示"
                description="完成向导后到「漏斗配置」中逐条维护阶段。"
              />
            </div>

            <!-- 3 自定义字段 -->
            <div v-show="currentKey === 'fields'" class="step-pane">
              <p class="text-muted mb-12">
                以下为常用扩展字段建议，仅作记录，不会直接写入自定义字段表；向导完成后可在「自定义字段」中正式创建。
              </p>
              <el-select
                v-model="fields.suggestions"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入扩展字段建议"
                style="width: 100%; max-width: 520px"
              >
                <el-option v-for="o in FIELD_SUGGESTIONS" :key="o" :label="o" :value="o" />
              </el-select>
            </div>

            <!-- 4 角色权限 -->
            <div v-show="currentKey === 'roles'" class="step-pane">
              <p class="text-muted mb-12">
                以下为常见角色建议，仅作记录；向导完成后可在「角色权限」中正式创建并分配权限。
              </p>
              <el-select
                v-model="roles.suggestions"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入角色建议"
                style="width: 100%; max-width: 520px"
              >
                <el-option v-for="o in ROLE_SUGGESTIONS" :key="o" :label="o" :value="o" />
              </el-select>
            </div>

            <!-- 5 系统字典 -->
            <div v-show="currentKey === 'dictionary'" class="step-pane">
              <p class="text-muted mb-12">
                以下为常见字典建议，仅作记录；向导完成后可在「系统字典」中正式创建字典类型与字典项。
              </p>
              <el-select
                v-model="dictionary.suggestions"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入字典建议"
                style="width: 100%; max-width: 520px"
              >
                <el-option v-for="o in DICT_SUGGESTIONS" :key="o" :label="o" :value="o" />
              </el-select>
            </div>

            <!-- 6 数据导入 -->
            <div v-show="currentKey === 'import'" class="step-pane">
              <p class="text-muted mb-12">
                粘贴模板包 JSON 或从本地选择模板包文件，点击「预览冲突」查看与当前系统配置的差异后确认导入。
              </p>
              <el-input
                v-model="importForm.config_text"
                type="textarea"
                :rows="6"
                placeholder="在此粘贴模板包 JSON"
              />
              <div class="mt-12">
                <el-button @click="triggerFile('wizard')">选择文件</el-button>
                <el-button type="primary" :loading="previewing" @click="previewConflicts(importForm.config_text)">
                  预览冲突
                </el-button>
              </div>
            </div>

            <div class="step-actions">
              <el-button :disabled="active === 0" @click="prev">上一步</el-button>
              <el-button v-if="canManage" type="primary" :disabled="isLast" :loading="saving" @click="next">下一步</el-button>
              <el-button v-if="canManage" type="primary" :loading="saving" @click="finish">完成向导</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- ============ 页签 2：模板包管理 ============ -->
        <el-tab-pane label="模板包管理" name="templates">
          <div class="filter-bar">
            <div class="filter-bar__spacer" />
            <el-button @click="loadTemplates">
              <el-icon><Refresh /></el-icon>
              <span>刷新</span>
            </el-button>
            <el-button v-if="canManage" type="primary" @click="openExport">
              <el-icon><Download /></el-icon>
              <span>导出当前配置为模板包</span>
            </el-button>
            <el-button v-if="canManage" @click="openImportDialog">
              <el-icon><Upload /></el-icon>
              <span>导入模板包</span>
            </el-button>
          </div>

          <el-table v-loading="loading" :data="templates" size="small" style="width: 100%">
            <el-table-column prop="template_name" label="模板名称" min-width="180" show-overflow-tooltip />
            <el-table-column prop="template_version" label="版本" width="110" />
            <el-table-column label="描述" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">{{ row.description || '—' }}</template>
            </el-table-column>
            <el-table-column label="来源" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.is_system === 1 ? 'info' : 'success'" effect="plain">
                  {{ row.is_system === 1 ? '系统内置' : '自定义' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" width="160">
              <template #default="{ row }">{{ fmt(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="150" align="center" fixed="right">
              <template #default="{ row }">
                <el-button v-if="canManage" link type="primary" @click="openUpgrade(row)">升级版本</el-button>
                <el-button v-if="canManage && row.is_system !== 1" link type="danger" @click="remove(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="empty-tip">暂无模板包</div>
            </template>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 完成向导：配置清单 -->
    <el-dialog v-model="manifestDialog" title="向导完成" width="480px" align-center>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item v-for="it in MANIFEST_ITEMS" :key="it.key" :label="it.label">
          <span class="num">{{ manifestCount(it.key) }}</span> 项
        </el-descriptions-item>
        <el-descriptions-item label="生成时间">{{ fmt(manifest?.generated_at) }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="manifestDialog = false">知道了</el-button>
      </template>
    </el-dialog>

    <!-- 导出当前配置为模板包 -->
    <el-dialog v-model="exportDialog" title="导出当前配置为模板包" width="480px" align-center>
      <el-form label-width="90px">
        <el-form-item label="模板名称" required>
          <el-input v-model="exportForm.template_name" maxlength="60" placeholder="请输入模板名称" />
        </el-form-item>
        <el-form-item label="版本号">
          <el-input v-model="exportForm.template_version" maxlength="20" placeholder="默认 1.0.0" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="exportForm.description" type="textarea" :rows="3" maxlength="200" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="exportDialog = false">取消</el-button>
        <el-button type="primary" :loading="exportSubmitting" @click="doExport">确定导出</el-button>
      </template>
    </el-dialog>

    <!-- 升级模板包版本 -->
    <el-dialog v-model="upgradeDialog" title="升级模板包版本" width="480px" align-center>
      <el-form label-width="90px">
        <el-form-item label="模板名称">
          <span>{{ upgradeForm.name || '—' }}</span>
        </el-form-item>
        <el-form-item label="目标版本" required>
          <el-input v-model="upgradeForm.target_version" maxlength="20" placeholder="请输入目标版本号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="upgradeDialog = false">取消</el-button>
        <el-button type="primary" :loading="upgradeSubmitting" @click="doUpgrade">确定升级</el-button>
      </template>
    </el-dialog>

    <!-- 导入模板包：JSON 粘贴 -->
    <el-dialog v-model="importDialog" title="导入模板包" width="480px" align-center>
      <el-input v-model="importDialogText" type="textarea" :rows="6" placeholder="在此粘贴模板包 JSON" />
      <div class="mt-12">
        <el-button @click="triggerFile('dialog')">选择文件</el-button>
      </div>
      <template #footer>
        <el-button @click="importDialog = false">取消</el-button>
        <el-button type="primary" :loading="previewing" @click="onDialogPreview">预览冲突</el-button>
      </template>
    </el-dialog>

    <!-- 导入冲突预览 -->
    <el-dialog v-model="conflictDialog" title="导入冲突预览" width="720px" align-center>
      <p class="mb-12">
        <span class="text-muted">新增</span>
        <span class="num strong">{{ importSummary['新增'] ?? 0 }}</span>
        <span class="text-muted">项 / 冲突</span>
        <span class="num strong">{{ importSummary['冲突'] ?? 0 }}</span>
        <span class="text-muted">项</span>
      </p>
      <el-table v-if="conflicts.length" :data="conflicts" size="small" style="width: 100%">
        <el-table-column prop="item" label="冲突项" min-width="220" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="140" show-overflow-tooltip />
        <el-table-column label="处理方式" min-width="320">
          <template #default="{ row }">
            <el-radio-group v-model="row.action" size="small">
              <el-radio value="skip">跳过</el-radio>
              <el-radio value="overwrite">覆盖</el-radio>
              <el-radio value="rename">重命名</el-radio>
            </el-radio-group>
            <el-input
              v-if="row.action === 'rename'"
              v-model="row.rename"
              size="small"
              maxlength="60"
              placeholder="新名称"
              class="rename-input"
            />
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="empty-tip">无冲突项，确认后将直接新增导入项</p>
      <template #footer>
        <el-button @click="conflictDialog = false">取消</el-button>
        <el-button type="primary" :loading="confirmSubmitting" @click="confirmImport">确认导入</el-button>
      </template>
    </el-dialog>

    <input ref="fileInput" type="file" accept=".json" class="hidden-file" @change="onFilePicked" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const canManage = computed(() => userStore.hasPerm('system_config:manage'))

/** 向导步骤（顺序与后端 step 枚举一致） */
const STEPS = [
  { key: 'basic', title: '基础信息' },
  { key: 'funnel', title: '漏斗配置' },
  { key: 'fields', title: '自定义字段' },
  { key: 'roles', title: '角色权限' },
  { key: 'dictionary', title: '系统字典' },
  { key: 'import', title: '数据导入' },
]

/** 完成向导配置清单展示项 */
const MANIFEST_ITEMS = [
  { key: 'stage_configs', label: '阶段配置' },
  { key: 'custom_field_definitions', label: '自定义字段' },
  { key: 'roles', label: '角色' },
  { key: 'dictionary_types', label: '字典类型' },
  { key: 'view_configs', label: '视图配置' },
  { key: 'report_templates', label: '报表模板' },
  { key: 'system_configs', label: '系统参数' },
]

const FIELD_SUGGESTIONS = ['客户年采购预算', '决策链角色', '客户重要度', '使用部门', '预算周期', '现有系统情况']
const ROLE_SUGGESTIONS = ['销售主管', '售前支持', '商务运营', '销售代表', '售后客服', '财务']
const DICT_SUGGESTIONS = ['行业', '来源渠道', '产品类型', '客户等级', '商机来源', '合同类型']

const tab = ref('wizard')
const loading = ref(false)
const saving = ref(false)
const previewing = ref(false)

/* ------- 向导状态 ------- */
const active = ref(0)
const mode = ref<string>('default')
const finished = ref(false)
const updatedAt = ref('')
const manifest = ref<any>(null)
const manifestDialog = ref(false)

const basic = reactive({ company_name: '', industry: '', company_size: '', admin_contact: '' })
const fields = reactive<{ suggestions: string[] }>({ suggestions: [] })
const roles = reactive<{ suggestions: string[] }>({ suggestions: [] })
const dictionary = reactive<{ suggestions: string[] }>({ suggestions: [] })
const importForm = reactive({ config_text: '' })

const currentKey = computed(() => STEPS[active.value].key)
const isLast = computed(() => active.value === STEPS.length - 1)

/* ------- 模板包 ------- */
const templates = ref<any[]>([])

/* ------- 导出 / 升级弹窗 ------- */
const exportDialog = ref(false)
const exportSubmitting = ref(false)
const exportForm = reactive({ template_name: '', template_version: '1.0.0', description: '' })

const upgradeDialog = ref(false)
const upgradeSubmitting = ref(false)
const upgradeForm = reactive({ id: '', name: '', target_version: '' })

/* ------- 导入 / 冲突预览 ------- */
const importDialog = ref(false)
const importDialogText = ref('')
const conflictDialog = ref(false)
const confirmSubmitting = ref(false)
const conflicts = ref<any[]>([])
const importSummary = ref<any>({})
const configData = ref<any>('')

/* ------- 文件选择 ------- */
const fileInput = ref<HTMLInputElement | null>(null)
const fileTarget = ref<'wizard' | 'dialog'>('wizard')

function fmt(iso?: string) {
  return String(iso || '').slice(0, 19).replace('T', ' ') || '—'
}

function manifestCount(key: string) {
  return Number(manifest.value?.counts?.[key] || 0)
}

/** 按当前步骤组装 payload */
function payloadFor(key: string): any {
  switch (key) {
    case 'basic':
      return { ...basic }
    case 'fields':
      return { suggestions: [...fields.suggestions] }
    case 'roles':
      return { suggestions: [...roles.suggestions] }
    case 'dictionary':
      return { suggestions: [...dictionary.suggestions] }
    case 'import':
      return { config_text: importForm.config_text }
    default:
      return {}
  }
}

async function loadState() {
  const st = await api.wizardState()
  mode.value = st?.mode || 'default'
  const idx = STEPS.findIndex((s) => s.key === st?.step)
  active.value = idx >= 0 ? idx : 0
  const payloads = st?.payload || {}
  Object.assign(basic, payloads.basic || {})
  fields.suggestions = payloads.fields?.suggestions || []
  roles.suggestions = payloads.roles?.suggestions || []
  dictionary.suggestions = payloads.dictionary?.suggestions || []
  importForm.config_text = payloads.import?.config_text || ''
  finished.value = st?.status === 'finished'
  manifest.value = st?.manifest || null
  updatedAt.value = st?.updated_at || ''
}

async function loadTemplates() {
  templates.value = await api.listImplementationTemplates()
}

async function refresh() {
  loading.value = true
  try {
    await Promise.all([loadState(), loadTemplates()])
  } finally {
    loading.value = false
  }
}

async function saveCurrent() {
  await api.saveWizardStep({ step: currentKey.value, mode: mode.value, payload: payloadFor(currentKey.value) })
}

async function next() {
  if (currentKey.value === 'basic' && !basic.company_name.trim()) {
    ElMessage.warning('请先填写企业名称')
    return
  }
  saving.value = true
  try {
    await saveCurrent()
    if (!isLast.value) active.value++
  } finally {
    saving.value = false
  }
}

function prev() {
  if (active.value > 0) active.value--
}

async function finish() {
  if (!basic.company_name.trim()) {
    ElMessage.warning('请先填写企业名称')
    return
  }
  saving.value = true
  try {
    await saveCurrent()
    const res = await api.finishWizard()
    manifest.value = res?.manifest || null
    finished.value = true
    updatedAt.value = res?.updated_at || updatedAt.value
    ElMessage.success('向导已完成')
    manifestDialog.value = true
  } finally {
    saving.value = false
  }
}

/* ------- 导出 ------- */
function openExport() {
  Object.assign(exportForm, { template_name: '', template_version: '1.0.0', description: '' })
  exportDialog.value = true
}

async function doExport() {
  if (!exportForm.template_name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  const body: Record<string, any> = { template_name: exportForm.template_name.trim() }
  if (exportForm.template_version.trim()) body.template_version = exportForm.template_version.trim()
  if (exportForm.description.trim()) body.description = exportForm.description.trim()
  exportSubmitting.value = true
  try {
    await api.exportImplementationTemplate(body)
    ElMessage.success('模板包已生成')
    exportDialog.value = false
    await loadTemplates()
  } finally {
    exportSubmitting.value = false
  }
}

/* ------- 升级版本 ------- */
function openUpgrade(row: any) {
  Object.assign(upgradeForm, { id: row.id, name: row.template_name, target_version: row.template_version || '' })
  upgradeDialog.value = true
}

async function doUpgrade() {
  if (!String(upgradeForm.target_version).trim()) {
    ElMessage.warning('请输入目标版本号')
    return
  }
  upgradeSubmitting.value = true
  try {
    await api.upgradeImplementationTemplate(upgradeForm.id, { target_version: String(upgradeForm.target_version).trim() })
    ElMessage.success('版本已升级')
    upgradeDialog.value = false
    await loadTemplates()
  } finally {
    upgradeSubmitting.value = false
  }
}

/* ------- 删除 ------- */
async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除模板包「${row.template_name}」？`, '删除确认', {
    type: 'warning',
    confirmButtonText: '确认删除',
  })
  try {
    await api.deleteImplementationTemplate(row.id)
    ElMessage.success('已删除')
    await loadTemplates()
  } catch (e: any) {
    ElMessage.error(e?.bizMessage || e?.message || '删除失败')
  }
}

/* ------- 导入与冲突预览 ------- */
function openImportDialog() {
  importDialogText.value = ''
  importDialog.value = true
}

async function previewConflicts(text: string): Promise<boolean> {
  const raw = String(text || '').trim()
  if (!raw) {
    ElMessage.warning('请粘贴或选择模板包 JSON')
    return false
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    ElMessage.error('模板包 JSON 解析失败，请检查内容')
    return false
  }
  previewing.value = true
  try {
    const res = await api.importImplementationTemplate(parsed)
    configData.value = parsed
    conflicts.value = (res?.conflicts || []).map((c: any) => ({
      item: c.item,
      type: c.type,
      action: 'skip',
      rename: '',
    }))
    importSummary.value = res?.summary || {}
    conflictDialog.value = true
    return true
  } finally {
    previewing.value = false
  }
}

async function onDialogPreview() {
  const ok = await previewConflicts(importDialogText.value)
  if (ok) importDialog.value = false
}

async function confirmImport() {
  if (conflicts.value.some((c) => c.action === 'rename' && !String(c.rename || '').trim())) {
    ElMessage.warning('请为选择「重命名」的冲突项填写新名称')
    return
  }
  await ElMessageBox.confirm('将按所选方式覆盖同名配置，是否继续？', '导入确认', {
    type: 'warning',
    confirmButtonText: '确认导入',
  })
  const decisions = conflicts.value.map((c) => {
    const d: Record<string, any> = { item: c.item, action: c.action }
    if (c.action === 'rename') d.rename = String(c.rename).trim()
    return d
  })
  confirmSubmitting.value = true
  try {
    const res = await api.confirmImportTemplate({ config_data: configData.value, decisions })
    ElMessage.success(`已导入 ${(res?.applied || []).length} 项`)
    conflictDialog.value = false
    await loadTemplates()
  } finally {
    confirmSubmitting.value = false
  }
}

/* ------- 本地文件读取 ------- */
function triggerFile(target: 'wizard' | 'dialog') {
  fileTarget.value = target
  fileInput.value?.click()
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result || '')
    if (fileTarget.value === 'dialog') importDialogText.value = text
    else importForm.config_text = text
    ElMessage.success('已读取文件内容')
  }
  reader.readAsText(f)
  input.value = ''
}

onMounted(refresh)
</script>

<style scoped>
.wizard-block {
  min-height: 220px;
}

.step-pane {
  padding: 4px 0;
}

.step-tip {
  max-width: 640px;
}

.step-actions {
  display: flex;
  gap: 8px;
  margin-top: 24px;
  padding-top: 12px;
  border-top: 1px solid var(--crm-border);
}

.rename-input {
  width: 160px;
  margin-left: 8px;
}

.strong {
  font-weight: 600;
  margin: 0 4px;
}

.hidden-file {
  display: none;
}
</style>
