<template>
  <template v-if="defs.length">
    <h3 class="section-card__title">{{ title }}</h3>
    <el-row :gutter="12">
      <el-col v-for="def in defs" :key="def.field_code" :span="12">
        <el-form-item :label="def.field_name" :required="def.is_required === 1">
          <!-- 布尔 -->
          <el-switch v-if="def.field_type === 'boolean'" v-model="model[def.field_code]" />

          <!-- 多选 -->
          <el-select
            v-else-if="def.field_type === 'multi_select'"
            v-model="model[def.field_code]"
            multiple
            collapse-tags
            clearable
            placeholder="请选择"
            style="width: 100%"
          >
            <el-option v-for="o in optionsOf(def)" :key="o" :label="o" :value="o" />
          </el-select>

          <!-- 单选 -->
          <el-select
            v-else-if="def.field_type === 'select'"
            v-model="model[def.field_code]"
            clearable
            placeholder="请选择"
            style="width: 100%"
          >
            <el-option v-for="o in optionsOf(def)" :key="o" :label="o" :value="o" />
          </el-select>

          <!-- 日期 / 时间 -->
          <el-date-picker
            v-else-if="def.field_type === 'date'"
            v-model="model[def.field_code]"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            style="width: 100%"
          />
          <el-date-picker
            v-else-if="def.field_type === 'datetime'"
            v-model="model[def.field_code]"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
            placeholder="选择时间"
            style="width: 100%"
          />

          <!-- 数字 / 金额 -->
          <el-input-number
            v-else-if="def.field_type === 'number' || def.field_type === 'amount'"
            v-model="model[def.field_code]"
            :controls="false"
            style="width: 100%"
          />

          <!-- 多行文本 -->
          <el-input
            v-else-if="def.field_type === 'textarea'"
            v-model="model[def.field_code]"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
          />

          <!-- 其余按单行文本处理 -->
          <el-input v-else v-model="model[def.field_code]" :placeholder="def.default_value || ''" />
        </el-form-item>
      </el-col>
    </el-row>
  </template>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import * as api from '@/api'
import { DICT_LOCAL } from '@/config/options'

/**
 * 自定义字段表单（PRD 4.7.2 动态渲染）
 * - 字段定义来自 /custom-fields（需 custom_field:view 权限）
 * - 无权限或该实体无自定义字段时不渲染
 */
const props = withDefaults(defineProps<{ entityType: string; modelValue: Record<string, any>; title?: string }>(), {
  title: '自定义字段',
})
const model = defineModel<Record<string, any>>('modelValue', { required: true })

const defs = ref<any[]>([])

function optionsOf(def: any): string[] {
  if (!def.options) return []
  try {
    const arr = JSON.parse(def.options)
    if (Array.isArray(arr)) return arr
  } catch (e) {
    /* 非 JSON：options 为字典编码，回退本地默认字典项 */
  }
  return DICT_LOCAL[def.options] || []
}

async function load() {
  try {
    defs.value = await api.listCustomFields(props.entityType)
  } catch (e) {
    defs.value = []
  }
}

watch(
  () => props.entityType,
  () => load(),
  { immediate: true }
)
</script>
