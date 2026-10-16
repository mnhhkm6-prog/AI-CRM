<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">产品价格记录</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button v-if="canCreate" type="primary" @click="openCreate">录入产品价格</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="query.product_type" placeholder="产品类型" clearable style="width: 160px" @change="reload">
          <el-option v-for="p in PRODUCT_TYPES" :key="p" :label="p" :value="p" />
        </el-select>
        <div class="filter-bar__spacer" />
        <el-button @click="reset">重置</el-button>
        <el-button @click="load">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column prop="product_type" label="产品类型" width="140" show-overflow-tooltip />
        <el-table-column label="价格" width="140" align="right" class-name="num">
          <template #default="{ row }">{{ money(row.price) }}</template>
        </el-table-column>
        <el-table-column prop="currency" label="币种" width="90" align="center">
          <template #default="{ row }">{{ row.currency || 'CNY' }}</template>
        </el-table-column>
        <el-table-column label="生效日期" width="130">
          <template #default="{ row }">{{ row.effective_date || '—' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="200" show-overflow-tooltip />
        <el-table-column label="更新时间" width="150">
          <template #default="{ row }">{{ fmt(row.updated_at || row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canUpdate" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="canDelete" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无产品价格记录</div>
        </template>
      </el-table>

      <el-pagination
        v-if="total > 0"
        class="mt-12"
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        :page-size="query.page_size"
        :current-page="query.page"
        :page-sizes="[20, 50, 100]"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <!-- 录入 / 编辑产品价格 -->
    <el-dialog v-model="dialog" :title="editing ? '编辑产品价格' : '录入产品价格'" width="480px" align-center>
      <el-form label-width="90px">
        <el-form-item label="产品类型" required>
          <el-select v-model="form.product_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="p in PRODUCT_TYPES" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="价格" required>
          <el-input-number v-model="form.price" :min="0" :controls="false" placeholder="请输入价格" style="width: 100%" />
        </el-form-item>
        <el-form-item label="币种">
          <el-input v-model="form.currency" placeholder="默认 CNY" maxlength="10" />
        </el-form-item>
        <el-form-item label="生效日期">
          <el-date-picker v-model="form.effective_date" type="date" value-format="YYYY-MM-DD" placeholder="请选择" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { PRODUCT_TYPES } from '@/config/options'

const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)

const dialog = ref(false)
const editing = ref<any>(null)

const query = reactive({ product_type: '', page: 1, page_size: 20 })
const form = reactive<any>({ product_type: '', price: undefined, currency: 'CNY', effective_date: '', remark: '' })

const canCreate = computed(() => userStore.hasPerm('quotation:create'))
const canUpdate = computed(() => userStore.hasPerm('quotation:update'))
const canDelete = computed(() => userStore.hasPerm('quotation:delete'))
const scopeText = computed(() => userStore.scopeBadge('quotation'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function money(v?: number | string | null) {
  return Number(v || 0).toLocaleString('zh-CN')
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    if (query.product_type) params.product_type = query.product_type
    const res = await api.listProductPrices(params)
    items.value = res.list || []
    total.value = res.total || 0
  } finally {
    loading.value = false
  }
}

function reload() {
  query.page = 1
  load()
}

function reset() {
  Object.assign(query, { product_type: '', page: 1 })
  load()
}

function onPageChange(p: number) {
  query.page = p
  load()
}

function onSizeChange(s: number) {
  query.page_size = s
  query.page = 1
  load()
}

function openCreate() {
  editing.value = null
  Object.assign(form, { product_type: '', price: undefined, currency: 'CNY', effective_date: '', remark: '' })
  dialog.value = true
}

function openEdit(row: any) {
  editing.value = row
  Object.assign(form, {
    product_type: row.product_type || '',
    price: row.price,
    currency: row.currency || 'CNY',
    effective_date: row.effective_date || '',
    remark: row.remark || '',
  })
  dialog.value = true
}

async function confirmSubmit() {
  if (!form.product_type) {
    ElMessage.warning('请选择产品类型')
    return
  }
  if (form.price === undefined || form.price === null || Number(form.price) < 0) {
    ElMessage.warning('请输入有效的价格')
    return
  }
  submitting.value = true
  try {
    const body = {
      product_type: form.product_type,
      price: Number(form.price),
      currency: form.currency || 'CNY',
      effective_date: form.effective_date || undefined,
      remark: form.remark || undefined,
    }
    if (editing.value) {
      await api.updateProductPrice(editing.value.id, body)
      ElMessage.success('已保存')
    } else {
      await api.createProductPrice(body)
      ElMessage.success('已录入')
    }
    dialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除「${row.product_type}」的价格记录？`, '删除确认', { type: 'warning' })
  await api.deleteProductPrice(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(load)
</script>
