<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">漏斗配置</h2>
          <span class="text-muted">阶段定义、固定动作与顺序调整，变更即时生效于商机推进校验（M11-R1~R3）</span>
        </div>
        <div class="page-head__right">
          <el-button v-if="canManage" @click="openMapping">阶段映射</el-button>
          <el-button @click="openVersions">版本历史</el-button>
          <el-button @click="load">刷新</el-button>
          <el-button v-if="canManage" type="primary" @click="openCreate">新增阶段</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column label="顺序" width="110" align="center">
          <template #default="{ row, $index }">
            <span class="order-cell">
              <el-button v-if="canManage" link :disabled="$index === 0" @click="move($index, -1)">
                <el-icon><Top /></el-icon>
              </el-button>
              <span class="order-cell__num">{{ $index + 1 }}</span>
              <el-button v-if="canManage" link :disabled="$index === items.length - 1" @click="move($index, 1)">
                <el-icon><Bottom /></el-icon>
              </el-button>
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="阶段名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="code" label="阶段编码" width="140" show-overflow-tooltip />
        <el-table-column label="说明" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || '—' }}</template>
        </el-table-column>
        <el-table-column label="进入条件" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.entry_condition || '—' }}</template>
        </el-table-column>
        <el-table-column label="交付物" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.deliverables || '—' }}</template>
        </el-table-column>
        <el-table-column label="固定动作" width="100" align="right" class-name="num">
          <template #default="{ row }">{{ (row.action_rules || []).length }}</template>
        </el-table-column>
        <el-table-column label="终态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_terminal === 1" size="small" effect="plain" :type="row.terminal_type === 'win' ? 'success' : 'danger'">
              {{ row.terminal_type === 'win' ? '赢单' : '失败' }}
            </el-tag>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.is_enabled === 1 ? 'success' : 'info'" effect="plain">
              {{ row.is_enabled === 1 ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="版本" width="80" align="center">
          <template #default="{ row }">v{{ row.version || 1 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goEdit(row)">{{ canManage ? '编辑' : '查看' }}</el-button>
            <el-button v-if="canManage" link type="primary" @click="toggle(row)">{{ row.is_enabled === 1 ? '停用' : '启用' }}</el-button>
            <el-button v-if="canManage && row.is_system !== 1 && row.is_terminal !== 1" link type="danger" @click="remove(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无阶段配置</div>
        </template>
      </el-table>
    </div>

    <!-- 新增阶段 -->
    <el-dialog v-model="createDialog" title="新增阶段" width="480px" align-center @closed="resetCreate">
      <el-form label-width="96px">
        <el-form-item label="阶段编码" required>
          <el-input v-model="form.code" maxlength="30" placeholder="如 NEGOTIATION，创建后不可修改" />
        </el-form-item>
        <el-form-item label="阶段名称" required>
          <el-input v-model="form.name" maxlength="30" placeholder="如 商务谈判" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
        <el-form-item label="进入条件">
          <el-input v-model="form.entry_condition" type="textarea" :rows="2" maxlength="200" placeholder="满足哪些条件才可进入该阶段" />
        </el-form-item>
        <el-form-item label="交付物">
          <el-input v-model="form.deliverables" type="textarea" :rows="2" maxlength="200" placeholder="离开该阶段需要产出的材料" />
        </el-form-item>
        <el-form-item label="是否终态">
          <el-switch v-model="form.is_terminal" />
        </el-form-item>
        <el-form-item v-if="form.is_terminal" label="终态类型">
          <el-radio-group v-model="form.terminal_type">
            <el-radio value="win">赢单</el-radio>
            <el-radio value="loss">失败</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="可见角色">
          <el-select v-model="form.roles" multiple filterable collapse-tags placeholder="不选则全部角色可见" style="width: 100%">
            <el-option v-for="r in roles" :key="r.role_code" :label="r.role_name" :value="r.role_code" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmCreate">提交</el-button>
      </template>
    </el-dialog>

    <!-- 配置版本历史（P35） -->
    <el-drawer v-model="versionDrawer" title="配置版本历史" size="480px">
      <el-table v-loading="versionLoading" :data="versions" size="small" style="width: 100%">
        <el-table-column label="变更时间" width="150">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="阶段" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.stage_name || '全局' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">{{ ACTION_LABEL[row.action] || row.action }}</template>
        </el-table-column>
        <el-table-column label="版本" width="70" align="center">
          <template #default="{ row }">v{{ row.version_after || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.changed_by_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canManage && row.version_after" link type="primary" @click="rollback(row)">回滚</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无变更记录</div>
        </template>
      </el-table>
      <p class="text-muted mt-12">回滚将按该版本的阶段与固定动作快照覆盖当前配置，并生成新的版本号。</p>
    </el-drawer>

    <!-- 存量商机阶段映射（P36） -->
    <el-dialog v-model="mappingDialog" title="存量商机阶段映射" width="720px" align-center>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="删除阶段前需先映射其存量商机"
        description="选择来源阶段与目标阶段后先预览影响数量，确认执行后该阶段下的全部商机将迁移至目标阶段。"
        class="mb-12"
      />
      <el-table :data="mappingRows" size="small" style="width: 100%">
        <el-table-column label="来源阶段" min-width="200">
          <template #default="{ row }">
            <el-select v-model="row.from_stage" placeholder="请选择来源阶段" filterable style="width: 100%" @change="previewMapping">
              <el-option v-for="s in items" :key="s.id" :label="`${s.name}（${s.code}）`" :value="s.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="目标阶段" min-width="200">
          <template #default="{ row }">
            <el-select v-model="row.to_stage" placeholder="请选择目标阶段" filterable style="width: 100%" @change="previewMapping">
              <el-option
                v-for="s in items.filter((x) => x.id !== row.from_stage)"
                :key="s.id"
                :label="`${s.name}（${s.code}）`"
                :value="s.id"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="影响商机数" width="140" align="right" class-name="num">
          <template #default="{ row }">
            <span v-if="row.opportunity_count !== undefined">{{ row.opportunity_count }}</span>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" @click="mappingRows.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="mt-12">
        <el-button link type="primary" @click="mappingRows.push({ from_stage: '', to_stage: '', opportunity_count: undefined })">
          添加映射行
        </el-button>
        <span class="text-muted" style="margin-left: 12px">合计影响 {{ mappingTotal }} 个商机</span>
      </div>
      <template #footer>
        <el-button @click="mappingDialog = false">取消</el-button>
        <el-button :loading="submitting" @click="previewMapping">预览影响</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmMapping">确认执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const ACTION_LABEL: Record<string, string> = {
  create: '新增阶段',
  update: '修改配置',
  delete: '删除阶段',
  reorder: '调整顺序',
  rollback: '版本回滚',
  mapping_execute: '执行映射',
}

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const roles = ref<any[]>([])

const createDialog = ref(false)
const versionDrawer = ref(false)
const versionLoading = ref(false)
const versions = ref<any[]>([])
const mappingDialog = ref(false)
const mappingRows = ref<any[]>([])

const form = reactive<any>({
  code: '',
  name: '',
  sort_order: 0,
  description: '',
  entry_condition: '',
  deliverables: '',
  is_terminal: false,
  terminal_type: 'win',
  roles: [],
})

const canManage = computed(() => userStore.hasPerm('stage_config:manage'))
const mappingTotal = computed(() => mappingRows.value.reduce((sum, r) => sum + (Number(r.opportunity_count) || 0), 0))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 19).replace('T', ' ') || '—'
}

async function load() {
  loading.value = true
  try {
    items.value = await api.listStageConfigs({ include_disabled: 1 })
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

async function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= items.value.length) return
  const ids = items.value.map((s) => s.id)
  const [moved] = ids.splice(index, 1)
  ids.splice(target, 0, moved)
  await api.reorderStageConfigs(ids)
  ElMessage.success('顺序已更新')
  await load()
}

function goEdit(row: any) {
  router.push({ name: 'sys-stage-detail', params: { id: row.id } })
}

function openCreate() {
  Object.assign(form, {
    code: '',
    name: '',
    sort_order: (items.value.length + 1) * 10,
    description: '',
    entry_condition: '',
    deliverables: '',
    is_terminal: false,
    terminal_type: 'win',
    roles: [],
  })
  createDialog.value = true
}

function resetCreate() {
  /* 表单在 openCreate 时已重置，此处仅占位避免重复赋值 */
}

async function confirmCreate() {
  if (!form.code.trim()) {
    ElMessage.warning('请输入阶段编码')
    return
  }
  if (!form.name.trim()) {
    ElMessage.warning('请输入阶段名称')
    return
  }
  submitting.value = true
  try {
    await api.createStageConfig({
      code: form.code.trim(),
      name: form.name.trim(),
      sort_order: Number(form.sort_order) || 0,
      description: form.description || undefined,
      entry_condition: form.entry_condition || undefined,
      deliverables: form.deliverables || undefined,
      is_terminal: form.is_terminal,
      terminal_type: form.is_terminal ? form.terminal_type : undefined,
      roles: form.roles,
    })
    ElMessage.success('阶段已创建')
    createDialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function toggle(row: any) {
  const next = row.is_enabled !== 1
  await ElMessageBox.confirm(
    `确认${next ? '启用' : '停用'}阶段「${row.name}」？${next ? '' : '停用后该阶段不再出现在推进路径中。'}`,
    `${next ? '启用' : '停用'}确认`,
    { type: 'warning' }
  )
  await api.toggleStageConfig(row.id, next)
  ElMessage.success(`已${next ? '启用' : '停用'}`)
  await load()
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除阶段「${row.name}」？该阶段下的固定动作将一并删除。`, '删除确认', { type: 'warning' })
  try {
    await api.deleteStageConfig(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e?.bizCode === 1002) {
      ElMessage.error(e.bizMessage || '该阶段下存在存量商机，请先执行阶段映射')
      openMapping()
    }
  }
}

/* ---------------- 版本历史（P35） ---------------- */
async function openVersions() {
  versionDrawer.value = true
  versionLoading.value = true
  try {
    versions.value = await api.stageVersions()
  } finally {
    versionLoading.value = false
  }
}

async function rollback(row: any) {
  await ElMessageBox.confirm(
    `回滚到版本 v${row.version_after}？当前配置将被该版本快照覆盖，并生成新版本号。`,
    '回滚确认',
    { type: 'warning', confirmButtonText: '确认回滚' }
  )
  const res: any = await api.rollbackStageVersion(Number(row.version_after))
  ElMessage.success(`已回滚，影响 ${(res?.restored || []).length} 个阶段`)
  await load()
  await openVersions()
}

/* ---------------- 阶段映射（P36） ---------------- */
function openMapping() {
  if (!mappingRows.value.length) {
    mappingRows.value = [{ from_stage: '', to_stage: '', opportunity_count: undefined }]
  }
  mappingDialog.value = true
}

async function previewMapping() {
  const changes = mappingRows.value.filter((r) => r.from_stage && r.to_stage)
  if (!changes.length) {
    ElMessage.warning('请先选择来源阶段与目标阶段')
    return
  }
  submitting.value = true
  try {
    const res: any = await api.previewStageMapping(changes.map((r) => ({ from_stage: r.from_stage, to_stage: r.to_stage })))
    const list = res?.list || []
    mappingRows.value = mappingRows.value.map((r) => {
      const hit = list.find((x: any) => x.from_stage === r.from_stage && x.to_stage === r.to_stage)
      return hit ? { ...r, opportunity_count: hit.opportunity_count } : r
    })
    ElMessage.success(`合计影响 ${res?.total_opportunities || 0} 个商机`)
  } finally {
    submitting.value = false
  }
}

async function confirmMapping() {
  const mapping = mappingRows.value.filter((r) => r.from_stage && r.to_stage)
  if (!mapping.length) {
    ElMessage.warning('请先选择来源阶段与目标阶段')
    return
  }
  await ElMessageBox.confirm(
    `确认将 ${mapping.length} 组来源阶段的存量商机迁移至目标阶段？该操作会直接改写商机所属阶段。`,
    '执行确认',
    { type: 'warning', confirmButtonText: '确认执行' }
  )
  submitting.value = true
  try {
    await api.executeStageMapping({ mapping: mapping.map((r) => ({ from_stage: r.from_stage, to_stage: r.to_stage })) })
    ElMessage.success('阶段映射已完成')
    mappingDialog.value = false
    mappingRows.value = []
    await load()
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await Promise.all([load(), loadRoles()])
})
</script>

<style scoped>
.order-cell {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.order-cell__num {
  min-width: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
