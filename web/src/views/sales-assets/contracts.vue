<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">合同管理</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button v-if="canCreate" type="primary" @click="openCreate">新建合同</el-button>
        </div>
      </div>

      <div class="filter-bar">
        <el-input
          v-model="query.keyword"
          placeholder="合同编号 / 合同名称"
          clearable
          style="width: 220px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <el-select
          v-model="query.opportunity_id"
          placeholder="关联商机"
          clearable
          filterable
          remote
          :remote-method="searchOpportunities"
          :loading="oppLoading"
          style="width: 220px"
          @change="reload"
        >
          <el-option v-for="o in oppOptions" :key="o.id" :label="o.name" :value="o.id" />
        </el-select>
        <div class="filter-bar__spacer" />
        <el-button @click="reset">重置</el-button>
        <el-button @click="load">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
        <el-table-column prop="contract_no" label="合同编号" width="160" show-overflow-tooltip />
        <el-table-column label="关联商机" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.opportunity_id" type="primary" underline="never" @click="goOpportunity(row)">
              {{ row.opportunity_name || '查看商机' }}
            </el-link>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="客户" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.customer_id" type="primary" underline="never" @click="goCustomer(row)">
              {{ row.customer_name || '查看客户' }}
            </el-link>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="合同金额" width="140" align="right" class-name="num">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="签订日期" width="120">
          <template #default="{ row }">{{ row.signed_date || '—' }}</template>
        </el-table-column>
        <el-table-column label="签订人" width="100">
          <template #default="{ row }">{{ row.signed_by_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="附件" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.file_storage_id" type="primary" underline="never" @click="download(row)">
              {{ row.file_name || '下载附件' }}
            </el-link>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canUpdate" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="canDelete" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-tip">暂无合同记录</div>
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

    <!-- 新建 / 编辑合同 -->
    <el-dialog v-model="dialog" :title="editing ? '编辑合同' : '新建合同'" width="480px" align-center @closed="resetForm">
      <el-form label-width="90px">
        <el-form-item label="关联商机" required>
          <el-select
            v-model="form.opportunity_id"
            placeholder="搜索并选择商机"
            filterable
            remote
            :disabled="!!editing"
            :remote-method="searchOpportunities"
            :loading="oppLoading"
            style="width: 100%"
          >
            <el-option v-for="o in oppOptions" :key="o.id" :label="o.name" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="合同编号" required>
          <el-input v-model="form.contract_no" maxlength="40" placeholder="请输入合同编号" />
        </el-form-item>
        <el-form-item label="合同金额" required>
          <el-input-number v-model="form.amount" :min="0" :controls="false" placeholder="请输入金额" style="width: 100%" />
        </el-form-item>
        <el-form-item label="签订日期" required>
          <el-date-picker v-model="form.signed_date" type="date" value-format="YYYY-MM-DD" placeholder="请选择" style="width: 100%" />
        </el-form-item>
        <el-form-item label="签订人" required>
          <el-select v-model="form.signed_by" filterable placeholder="请选择签订人" style="width: 100%">
            <el-option v-for="o in owners" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="editing ? '更换附件' : '合同附件'" :required="!editing">
          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            :on-change="onFileChange"
            :on-remove="onFileRemove"
            :on-exceed="onFileExceed"
          >
            <el-button>选择文件</el-button>
            <template #tip>
              <div class="el-upload__tip">
                <template v-if="editing">可选，留空则保留原附件</template>
                <template v-else>单个文件，大小不超过 50MB</template>
              </div>
            </template>
          </el-upload>
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
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import { loadOwnerOptions, type Option } from '@/config/options'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const oppLoading = ref(false)
const oppOptions = ref<any[]>([])
const owners = ref<Option[]>([])

const dialog = ref(false)
const editing = ref<any>(null)
const uploadRef = ref<any>(null)
const file = ref<File | null>(null)

const query = reactive({ keyword: '', opportunity_id: '', page: 1, page_size: 20 })
const form = reactive<any>({ opportunity_id: '', contract_no: '', amount: undefined, signed_date: '', signed_by: '' })

const canCreate = computed(() => userStore.hasPerm('contract:create'))
const canUpdate = computed(() => userStore.hasPerm('contract:update'))
const canDelete = computed(() => userStore.hasPerm('contract:delete'))
const scopeText = computed(() => userStore.scopeBadge('contract'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
}

function money(v?: number | string | null) {
  return Number(v || 0).toLocaleString('zh-CN')
}

async function searchOpportunities(keyword: string) {
  if (!keyword) return
  oppLoading.value = true
  try {
    const res = await api.listOpportunities({ keyword, page_size: 20 })
    oppOptions.value = res.list || []
  } finally {
    oppLoading.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['keyword', 'opportunity_id'].forEach((k) => {
      const v = (query as any)[k]
      if (v) params[k] = v
    })
    const res = await api.listContracts(params)
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
  Object.assign(query, { keyword: '', opportunity_id: '', page: 1 })
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
  Object.assign(form, {
    opportunity_id: '',
    contract_no: '',
    amount: undefined,
    signed_date: '',
    signed_by: userStore.profile?.id || '',
  })
  file.value = null
  dialog.value = true
  nextTick(() => uploadRef.value?.clearFiles())
}

async function openEdit(row: any) {
  editing.value = row
  Object.assign(form, {
    opportunity_id: row.opportunity_id || '',
    contract_no: row.contract_no || '',
    amount: row.amount,
    signed_date: row.signed_date || '',
    signed_by: row.signed_by || '',
  })
  file.value = null
  dialog.value = true
  nextTick(() => uploadRef.value?.clearFiles())
  // 回填关联商机显示名（GET /contracts 不返回 opportunity_name）
  if (row.opportunity_id && !oppOptions.value.some((o) => o.id === row.opportunity_id)) {
    try {
      const o = await api.getOpportunity(row.opportunity_id)
      oppOptions.value.push({ id: o.id, name: o.name })
    } catch (e) {
      oppOptions.value.push({ id: row.opportunity_id, name: '关联商机' })
    }
  }
}

function resetForm() {
  editing.value = null
  file.value = null
  uploadRef.value?.clearFiles()
}

function onFileChange(uf: any) {
  file.value = uf?.raw || null
}

function onFileRemove() {
  file.value = null
}

function onFileExceed() {
  ElMessage.warning('只能上传一个文件，请先移除已选文件')
}

async function confirmSubmit() {
  if (!editing.value && !form.opportunity_id) {
    ElMessage.warning('请选择关联商机')
    return
  }
  if (!form.contract_no.trim()) {
    ElMessage.warning('请输入合同编号')
    return
  }
  if (form.amount === undefined || form.amount === null || Number(form.amount) < 0) {
    ElMessage.warning('请输入有效的合同金额')
    return
  }
  if (!form.signed_date) {
    ElMessage.warning('请选择签订日期')
    return
  }
  if (!form.signed_by) {
    ElMessage.warning('请选择签订人')
    return
  }
  if (!editing.value && !file.value) {
    ElMessage.warning('请上传合同附件')
    return
  }
  submitting.value = true
  try {
    let fileStorageId: string | undefined
    if (file.value) {
      const uploaded = (await api.uploadFile(file.value)) as any
      fileStorageId = uploaded.file_storage_id
    }
    const body: Record<string, any> = {
      contract_no: form.contract_no.trim(),
      amount: Number(form.amount),
      signed_date: form.signed_date,
      signed_by: form.signed_by,
    }
    if (fileStorageId) body.file_storage_id = fileStorageId
    if (editing.value) {
      await api.updateContract(editing.value.id, body)
      ElMessage.success('已保存')
    } else {
      await api.createContract(form.opportunity_id, body)
      ElMessage.success('合同已创建')
    }
    dialog.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

function download(row: any) {
  api.downloadFile(row.file_storage_id, row.file_name)
}

function goOpportunity(row: any) {
  router.push(`/opportunities/${row.opportunity_id}`)
}

function goCustomer(row: any) {
  router.push(`/customers/${row.customer_id}`)
}

async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除合同「${row.contract_no}」？`, '删除确认', { type: 'warning' })
  await api.deleteContract(row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(async () => {
  owners.value = await loadOwnerOptions(userStore.hasPerm('user:view'), userStore.profile || undefined)
  await load()
})
</script>
