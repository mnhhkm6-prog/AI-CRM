<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">系统参数配置</h2>
          <span class="text-muted">参数变更立即生效并记入配置日志（M10-R3、决策 A–D）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="loadAll">刷新</el-button>
        </div>
      </div>

      <el-tabs v-model="tab">
        <!-- 预警规则 -->
        <el-tab-pane label="预警规则" name="alert">
          <div v-loading="loading" class="form-block">
            <el-alert
              type="info"
              :closable="false"
              show-icon
              title="停滞预警三级阈值"
              description="商机距上次推进超过对应天数即触发对应级别预警；保存后新阈值将于次日 0 点对全部在途商机生效。"
              class="mb-12"
            />
            <el-form label-width="140px" style="max-width: 520px">
              <el-form-item label="一级预警阈值">
                <el-input-number v-model="alertForm.stale_alert_level1_days" :min="1" :max="365" :controls="false" style="width: 160px" />
                <span class="unit">天</span>
              </el-form-item>
              <el-form-item label="二级预警阈值">
                <el-input-number v-model="alertForm.stale_alert_level2_days" :min="1" :max="365" :controls="false" style="width: 160px" />
                <span class="unit">天</span>
              </el-form-item>
              <el-form-item label="三级预警阈值">
                <el-input-number v-model="alertForm.stale_alert_level3_days" :min="1" :max="365" :controls="false" style="width: 160px" />
                <span class="unit">天</span>
              </el-form-item>
              <el-form-item>
                <el-button v-if="canManage" type="primary" :loading="submitting" @click="saveAlert">保存</el-button>
                <span v-else class="text-muted">当前角色无参数修改权限</span>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 公海规则 -->
        <el-tab-pane label="公海规则" name="sea">
          <div v-loading="loading" class="form-block">
            <el-form label-width="160px" style="max-width: 560px">
              <el-form-item label="公海分配模式">
                <el-switch
                  v-model="seaForm.is_pickup_mode"
                  active-text="销售自主领取"
                  inactive-text="主管手动分配"
                  inline-prompt
                  :disabled="!canManage"
                />
              </el-form-item>
              <el-form-item label="保护期天数">
                <el-input-number v-model="seaForm.protection_days" :min="0" :max="90" :controls="false" style="width: 160px" :disabled="!canManage" />
                <span class="unit">天</span>
              </el-form-item>
              <el-form-item label="个人商机持有上限">
                <el-input-number v-model="seaForm.personal_max" :min="1" :max="500" :controls="false" style="width: 160px" :disabled="!canManage" />
                <span class="unit">个</span>
              </el-form-item>
              <el-form-item label="每日领取上限">
                <el-input-number v-model="seaForm.daily_pickup_max" :min="1" :max="100" :controls="false" style="width: 160px" :disabled="!canManage" />
                <span class="unit">个</span>
              </el-form-item>
              <el-form-item label="三级预警后回落缓冲">
                <el-input-number
                  v-model="seaForm.fallback_days_after_alert"
                  :min="0"
                  :max="90"
                  :controls="false"
                  style="width: 160px"
                  :disabled="!canManage"
                />
                <span class="unit">天</span>
              </el-form-item>
              <el-form-item label="线索未转化回收天数">
                <el-input-number
                  v-model="seaForm.lead_recycle_days"
                  :min="1"
                  :max="365"
                  :controls="false"
                  style="width: 160px"
                  :disabled="!canManage"
                />
                <span class="unit">天</span>
              </el-form-item>
              <el-form-item>
                <el-button v-if="canManage" type="primary" :loading="submitting" @click="saveSea">保存</el-button>
                <span v-else class="text-muted">当前角色无参数修改权限</span>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 基础参数 -->
        <el-tab-pane label="基础参数" name="system">
          <div v-loading="loading" class="form-block">
            <el-table :data="systemConfigs" size="small" style="width: 100%">
              <el-table-column prop="description" label="参数说明" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">{{ row.description || row.config_key }}</template>
              </el-table-column>
              <el-table-column prop="config_key" label="参数键" width="220" show-overflow-tooltip />
              <el-table-column label="参数值" width="260">
                <template #default="{ row }">
                  <el-switch v-if="row.value_type === 'boolean'" v-model="row.value" :disabled="!canManage" />
                  <el-input-number
                    v-else-if="row.value_type === 'number'"
                    v-model="row.value"
                    :controls="false"
                    :disabled="!canManage"
                    style="width: 160px"
                  />
                  <el-input v-else v-model="row.value" :disabled="!canManage" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center">
                <template #default="{ row }">
                  <el-button v-if="canManage" link type="primary" @click="saveOne(row)">保存</el-button>
                </template>
              </el-table-column>
              <template #empty>
                <div class="empty-tip">暂无基础参数</div>
              </template>
            </el-table>
            <p class="text-muted mt-12">
              登录方式请在
              <el-link type="primary" underline="never" @click="router.push('/system/login-config')">登录方式配置</el-link>
              中调整。
            </p>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
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

const tab = ref('alert')
const loading = ref(false)
const submitting = ref(false)

const alertForm = reactive<any>({ stale_alert_level1_days: 7, stale_alert_level2_days: 14, stale_alert_level3_days: 21 })
const seaForm = reactive<any>({
  is_pickup_mode: true,
  protection_days: 3,
  personal_max: 20,
  daily_pickup_max: 5,
  fallback_days_after_alert: 7,
  lead_recycle_days: 60,
})
const systemConfigs = ref<any[]>([])

/** 登录方式有独立页面（P30），此处不重复提供编辑入口 */
const SKIP_KEYS = ['login_mode']

const canManage = computed(() => userStore.hasPerm('system_config:manage'))

async function loadAlert() {
  const list = await api.alertConfigs()
  list.forEach((c: any) => {
    if (alertForm[c.config_key] !== undefined) alertForm[c.config_key] = Number(c.value)
  })
}

async function loadSea() {
  const rules = await api.seaConfig()
  Object.keys(seaForm).forEach((k) => {
    if (rules[k] !== undefined) seaForm[k] = rules[k]
  })
}

async function loadSystem() {
  const list = await api.allSystemConfigs({ config_group: 'system' })
  systemConfigs.value = list.filter((c: any) => !SKIP_KEYS.includes(c.config_key))
}

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadAlert(), loadSea(), loadSystem()])
  } finally {
    loading.value = false
  }
}

async function saveAlert() {
  const { stale_alert_level1_days: l1, stale_alert_level2_days: l2, stale_alert_level3_days: l3 } = alertForm
  if (!(l1 > 0 && l2 > 0 && l3 > 0)) {
    ElMessage.warning('三级阈值均须大于 0')
    return
  }
  if (!(l1 < l2 && l2 < l3)) {
    ElMessage.warning('阈值须满足：一级 < 二级 < 三级')
    return
  }
  await ElMessageBox.confirm('新阈值将于次日 0 点对全部在途商机生效。确认保存？', '保存确认', { type: 'warning' })
  submitting.value = true
  try {
    await api.batchUpdateSystemConfigs([
      { config_key: 'stale_alert_level1_days', config_value: l1 },
      { config_key: 'stale_alert_level2_days', config_value: l2 },
      { config_key: 'stale_alert_level3_days', config_value: l3 },
    ])
    ElMessage.success('预警规则已保存')
    await loadAlert()
  } finally {
    submitting.value = false
  }
}

async function saveSea() {
  submitting.value = true
  try {
    await api.updateSeaConfig({ ...seaForm })
    ElMessage.success('公海规则已保存')
    await loadSea()
  } finally {
    submitting.value = false
  }
}

async function saveOne(row: any) {
  submitting.value = true
  try {
    await api.updateSystemConfig(row.config_key, row.value)
    ElMessage.success('已保存')
    await loadSystem()
  } finally {
    submitting.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.form-block {
  min-height: 200px;
  padding-top: 4px;
}

.unit {
  margin-left: 8px;
  color: var(--crm-text-secondary);
}
</style>
