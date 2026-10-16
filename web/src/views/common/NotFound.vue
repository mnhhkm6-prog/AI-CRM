<template>
  <div class="nf">
    <el-result icon="info" title="404" sub-title="页面不存在或已被移除">
      <template #extra>
        <el-button type="primary" @click="router.replace('/')">返回工作台</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<style scoped>
.nf {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--crm-bg);
}
</style>
