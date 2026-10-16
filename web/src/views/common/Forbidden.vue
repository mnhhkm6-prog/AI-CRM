<template>
  <div class="page">
    <div class="page-card">
      <el-result icon="warning" title="403" sub-title="当前账号没有访问该页面的权限，请联系系统管理员分配角色权限">
        <template #extra>
          <el-button type="primary" @click="router.replace('/')">返回工作台</el-button>
        </template>
      </el-result>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>
