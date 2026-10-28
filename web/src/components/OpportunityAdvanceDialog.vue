<template>
  <el-dialog v-model="visible" title="阶段推进校验" width="560px">
    <div v-loading="loading">
      <template v-if="check">
        <el-alert
          v-if="check.pass"
          type="success"
          :closable="false"
          show-icon
          :title="`固定动作已全部完成，可推进至「${check.next_stage?.name || '下一阶段'}」`"
        />
        <el-alert
          v-else
          type="warning"
          :closable="false"
          show-icon
          :title="`存在 ${check.missing.length} 项未完成的固定动作，需补齐后方可推进`"
        />

        <div class="stage-flow mt-12">
          <span class="stage-flow__node stage-flow__node--current">{{ check.stage?.name || '—' }}</span>
          <span class="stage-flow__arrow">→</span>
          <span class="stage-flow__node">{{ check.next_stage?.name || '—' }}</span>
        </div>

        <h3 class="section-card__title mt-12">固定动作清单（{{ check.completeness }}）</h3>
        <div v-for="item in check.items" :key="item.rule_id" class="check-item">
          <span :class="['check-item__icon', item.done ? 'is-done' : 'is-todo']">{{ item.done ? '✅' : '⬜' }}</span>
          <span class="check-item__name">{{ item.action_name }}</span>
          <span class="check-item__value text-muted">{{ displayValue(item) }}</span>
          <el-button
            v-if="!item.done"
            link
            type="primary"
            size="small"
            @click="goFill(item)"
          >{{ String(item.field_key || '').startsWith('sys:') ? '去处理' : '去填写' }}</el-button>
        </div>
      </template>
      <div v-else class="empty-tip">未获取到校验信息</div>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button v-if="check?.pass" type="primary" :loading="submitting" @click="advance">确认推进</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import * as api from '@/api'

/**
 * 阶段推进校验弹窗（M3-R2 / UI 6.1）
 * 供商机列表、漏斗看板、商机详情复用
 */
const props = defineProps<{ opportunityId: string }>()
const emit = defineEmits<{ advanced: []; fill: [item: any] }>()
const visible = defineModel<boolean>({ required: true })

const loading = ref(false)
const submitting = ref(false)
const check = ref<any>(null)

watch(visible, async (open) => {
  if (!open) return
  loading.value = true
  try {
    check.value = await api.advanceCheck(props.opportunityId)
  } finally {
    loading.value = false
  }
})

function displayValue(item: any) {
  if (item.value === null || item.value === undefined || item.value === '') return item.tip || ''
  if (Array.isArray(item.value)) return item.value.join('、')
  if (typeof item.value === 'boolean') return item.value ? '已完成' : '未完成'
  return String(item.value)
}

/** 去补齐：由使用方决定跳到编辑页字段还是详情页页签 */
function goFill(item: any) {
  visible.value = false
  emit('fill', item)
}

async function advance() {
  submitting.value = true
  try {
    await api.advanceOpportunity(props.opportunityId, {})
    ElMessage.success('阶段已推进')
    visible.value = false
    emit('advanced')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--crm-border);
}

.check-item:last-child {
  border-bottom: none;
}

.check-item__name {
  flex: 0 0 auto;
}

.check-item__value {
  margin-left: auto;
  text-align: right;
  font-size: 12px;
}
</style>
