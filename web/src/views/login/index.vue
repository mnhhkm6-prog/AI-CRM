<template>
  <div class="login">
    <div class="login__card">
      <div class="login__brand">
        <div class="login__mark">CRM</div>
        <h1 class="login__title">{{ companyName }}</h1>
        <p class="login__sub">{{ isAd ? '域账号登录' : '客户关系管理系统' }}</p>
      </div>

      <el-alert
        v-if="isAd"
        class="mb-12"
        type="warning"
        show-icon
        :closable="false"
        title="当前已启用 AD/LDAP 域账号登录"
        description="请使用域账号登录；如需切换为账号密码登录，请联系系统管理员在「系统管理 → 登录方式」中修改。"
      />

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="submit">
        <el-form-item prop="username">
          <el-input v-model="form.username" :placeholder="isAd ? '域账号' : '请输入账号'" autocomplete="username">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="isAd ? '域密码' : '请输入密码'"
            autocomplete="current-password"
          >
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="login__submit" :loading="loading" @click="submit">
            {{ isAd ? '域账号登录' : '登 录' }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <p class="login__footer">© {{ year }} {{ companyName }} · 本地化部署版</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const year = new Date().getFullYear()
const companyName = ref('自研 CRM')
const loginMode = ref('password')
/** 登录形态由系统配置驱动（界面设计文档 P01：切换 AD/LDAP 无需改版） */
const isAd = computed(() => loginMode.value === 'ad_ldap')

const formRef = ref<FormInstance>()
const form = ref({ username: '', password: '' })
const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}
const loading = ref(false)

onMounted(async () => {
  try {
    const cfg = await api.getLoginConfig()
    loginMode.value = cfg.login_mode || 'password'
    if (cfg.company_name) companyName.value = cfg.company_name
  } catch (e) {
    /* 配置获取失败时按账号密码形态渲染 */
  }
})

async function submit() {
  const formEl = formRef.value
  if (!formEl) return
  const valid = await formEl.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await userStore.signIn(form.value.username.trim(), form.value.password)
    ElMessage.success(`欢迎回来，${userStore.displayName}`)
    const redirect = (route.query.redirect as string) || '/'
    router.replace(redirect)
  } catch (e) {
    /* 错误提示由 axios 拦截器统一给出 */
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(1200px 500px at 50% -10%, rgba(52, 77, 19, 0.1), transparent 60%), var(--crm-bg);
}

.login__card {
  width: 384px;
  background: var(--crm-card);
  border: 1px solid var(--crm-border);
  border-radius: var(--crm-radius);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.06);
  padding: 28px 28px 16px;
}

.login__brand {
  text-align: center;
  margin-bottom: 20px;
}

.login__mark {
  width: 44px;
  height: 44px;
  margin: 0 auto 10px;
  border-radius: var(--crm-radius);
  background: var(--crm-primary);
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.login__sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--crm-text-secondary);
}

.login__submit {
  width: 100%;
  letter-spacing: 2px;
}

.login__footer {
  margin: 20px 0 0;
  font-size: 12px;
  color: var(--crm-text-secondary);
}
</style>
