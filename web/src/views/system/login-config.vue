<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">登录方式配置</h2>
          <span class="text-muted">切换后登录页自动替换为对应形态，无需改版（M10-R6）</span>
        </div>
        <div class="page-head__right">
          <el-button @click="load">刷新</el-button>
        </div>
      </div>

      <div v-loading="loading" class="form-block">
        <el-form label-width="120px" style="max-width: 620px">
          <el-form-item label="登录方式">
            <el-radio-group v-model="form.mode" :disabled="!canManage">
              <el-radio value="password">账号密码登录</el-radio>
              <el-radio value="ad_ldap">AD / LDAP 域账号登录</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>

        <el-alert
          v-if="form.mode === 'ad_ldap'"
          type="warning"
          :closable="false"
          show-icon
          title="启用域账号登录后，账号密码登录入口将关闭"
          description="请确认域服务地址与绑定账号可用后再保存，避免管理员无法登录。"
          class="mb-12"
        />
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          title="当前使用系统内置账号体系"
          description="用户在「用户管理」中维护账号与密码。"
          class="mb-12"
        />

        <template v-if="form.mode === 'ad_ldap'">
          <h3 class="section-card__title">域服务参数</h3>
          <el-form label-width="120px" style="max-width: 620px" :disabled="!canManage">
            <el-form-item label="服务器地址">
              <el-input v-model="adForm.server" placeholder="如 ldap://192.168.1.10 或 ad.example.com" />
            </el-form-item>
            <el-form-item label="端口">
              <el-input-number v-model="adForm.port" :min="1" :max="65535" :controls="false" style="width: 160px" />
            </el-form-item>
            <el-form-item label="基准 DN">
              <el-input v-model="adForm.base_dn" placeholder="如 dc=example,dc=com" />
            </el-form-item>
            <el-form-item label="绑定账号">
              <el-input v-model="adForm.bind_dn" placeholder="如 cn=admin,dc=example,dc=com" />
            </el-form-item>
            <el-form-item label="绑定密码">
              <el-input v-model="adForm.bind_password" type="password" show-password placeholder="请输入绑定账号密码" />
            </el-form-item>
            <el-form-item label="用户过滤器">
              <el-input v-model="adForm.user_filter" placeholder="如 (sAMAccountName={username})" />
            </el-form-item>
            <el-form-item label="启用 SSL">
              <el-switch v-model="adForm.use_ssl" />
            </el-form-item>
          </el-form>
        </template>

        <div v-if="canManage" class="mt-12">
          <el-button type="primary" :loading="submitting" @click="save">保存</el-button>
        </div>
        <p v-else class="text-muted mt-12">当前角色无参数修改权限</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const form = reactive<{ mode: string }>({ mode: 'password' })
const adForm = reactive<any>({
  server: '',
  port: 389,
  base_dn: '',
  bind_dn: '',
  bind_password: '',
  user_filter: '(sAMAccountName={username})',
  use_ssl: false,
})

const canManage = computed(() => userStore.hasPerm('system_config:manage'))

async function load() {
  loading.value = true
  try {
    const res = await api.loginConfig()
    form.mode = res.mode || 'password'
    const cfg = res.ad_ldap || {}
    Object.keys(adForm).forEach((k) => {
      if (cfg[k] !== undefined && cfg[k] !== null) adForm[k] = cfg[k]
    })
  } finally {
    loading.value = false
  }
}

async function save() {
  if (form.mode === 'ad_ldap') {
    if (!adForm.server) {
      ElMessage.warning('请输入服务器地址')
      return
    }
    if (!adForm.base_dn) {
      ElMessage.warning('请输入基准 DN')
      return
    }
    await ElMessageBox.confirm(
      '切换为 AD / LDAP 域账号登录后，账号密码登录入口将关闭，请确认域服务配置正确。是否继续？',
      '切换确认',
      { type: 'warning' }
    )
  }
  submitting.value = true
  try {
    await api.updateLoginConfig({ mode: form.mode, ad_ldap: { ...adForm } })
    ElMessage.success('登录方式已保存')
    await load()
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.form-block {
  min-height: 200px;
  padding-top: 4px;
}
</style>
