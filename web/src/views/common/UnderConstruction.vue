<template>
  <div class="page">
    <div class="page-card">
      <el-empty :image-size="120" description="该功能页面正在建设中">
        <template #description>
          <p class="uc__title">{{ title }}</p>
          <p class="uc__tip">页面文件尚未交付，接口已完成，可先通过接口联调验证</p>
        </template>
      </el-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => (route.meta.title as string) || '功能页面')
</script>

<style scoped>
.uc__title {
  font-size: 15px;
  color: var(--crm-text);
  margin: 0 0 4px;
}
.uc__tip {
  font-size: 12px;
  color: var(--crm-text-secondary);
  margin: 0;
}
</style>
