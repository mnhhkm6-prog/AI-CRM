<template>
  <div class="page">
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">竞争对手管理</h2>
          <span class="scope-badge">{{ scopeText }}</span>
        </div>
        <div class="page-head__right">
          <el-button v-if="canCreate" type="primary" @click="openCreateMaster">新增竞品主数据</el-button>
        </div>
      </div>

      <el-tabs v-model="tab">
        <!-- 竞品主数据 -->
        <el-tab-pane label="竞品主数据" name="masters">
          <div class="filter-bar">
            <el-input
              v-model="masterKeyword"
              placeholder="竞品名称"
              clearable
              style="width: 220px"
              @keyup.enter="loadMasters"
              @clear="loadMasters"
            />
            <div class="filter-bar__spacer" />
            <el-button @click="loadMasters">刷新</el-button>
          </div>

          <el-table v-loading="masterLoading" :data="masters" size="small" style="width: 100%">
            <el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip />
            <el-table-column prop="industry" label="行业" width="120" show-overflow-tooltip />
            <el-table-column prop="strengths" label="优势" min-width="180" show-overflow-tooltip />
            <el-table-column prop="weaknesses" label="劣势" min-width="180" show-overflow-tooltip />
            <el-table-column prop="typical_cases" label="典型案例" min-width="180" show-overflow-tooltip />
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.is_enabled ? 'success' : 'info'" effect="plain">
                  {{ row.is_enabled ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" align="center" fixed="right">
              <template #default="{ row }">
                <el-button v-if="canUpdate" link type="primary" @click="openEditMaster(row)">编辑</el-button>
                <el-button v-if="canUpdate" link :type="row.is_enabled ? 'danger' : 'primary'" @click="toggleMaster(row)">
                  {{ row.is_enabled ? '停用' : '启用' }}
                </el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="empty-tip">暂无竞品主数据</div>
            </template>
          </el-table>
        </el-tab-pane>

        <!-- 竞品记录 -->
        <el-tab-pane label="竞品记录" name="records">
          <div class="filter-bar">
            <el-input
              v-model="query.keyword"
              placeholder="竞品名称 / 商机名"
              clearable
              style="width: 200px"
              @keyup.enter="reloadRecords"
              @clear="reloadRecords"
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
              @change="reloadRecords"
            >
              <el-option v-for="o in oppOptions" :key="o.id" :label="o.name" :value="o.id" />
            </el-select>
            <el-select
              v-model="query.competitor_master_id"
              placeholder="竞品主数据"
              clearable
              filterable
              style="width: 180px"
              @change="reloadRecords"
            >
              <el-option v-for="m in masters" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
            <div class="filter-bar__spacer" />
            <el-button @click="resetRecords">重置</el-button>
            <el-button @click="loadRecords">刷新</el-button>
          </div>

          <el-table v-loading="loading" :data="items" size="small" style="width: 100%">
            <el-table-column prop="name" label="竞品名称" min-width="140" show-overflow-tooltip />
            <el-table-column label="所属商机" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                <el-link v-if="row.opportunity_id" type="primary" underline="never" @click="goOpportunity(row)">
                  {{ row.opportunity_name || '查看商机' }}
                </el-link>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="strengths" label="优势" min-width="180" show-overflow-tooltip />
            <el-table-column prop="weaknesses" label="劣势" min-width="180" show-overflow-tooltip />
            <el-table-column prop="created_by_name" label="记录人" width="100" />
            <el-table-column label="记录时间" width="150">
              <template #default="{ row }">{{ fmt(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="90" align="center" fixed="right">
              <template #default="{ row }">
                <el-button v-if="canDelete" link type="danger" @click="removeRecord(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="empty-tip">暂无竞品记录</div>
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
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 新建 / 编辑竞品主数据 -->
    <el-drawer
      v-model="drawer"
      :title="editingMaster ? '编辑竞品主数据' : '新增竞品主数据'"
      size="480px"
      @closed="resetForm"
    >
      <el-form label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="60" placeholder="请输入竞品名称" />
        </el-form-item>
        <el-form-item label="行业">
          <el-input v-model="form.industry" maxlength="60" placeholder="请输入所属行业" />
        </el-form-item>
        <el-form-item label="优势">
          <el-input v-model="form.strengths" type="textarea" :rows="3" maxlength="300" show-word-limit />
        </el-form-item>
        <el-form-item label="劣势">
          <el-input v-model="form.weaknesses" type="textarea" :rows="3" maxlength="300" show-word-limit />
        </el-form-item>
        <el-form-item label="典型案例">
          <el-input v-model="form.typical_cases" type="textarea" :rows="3" maxlength="300" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawer = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitMaster">保存</el-button>
      </template>
    </el-drawer>
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

const tab = ref('masters')

const masterLoading = ref(false)
const masters = ref<any[]>([])
const masterKeyword = ref('')

const loading = ref(false)
const submitting = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const oppLoading = ref(false)
const oppOptions = ref<any[]>([])

const drawer = ref(false)
const editingMaster = ref<any>(null)

const query = reactive({ keyword: '', opportunity_id: '', competitor_master_id: '', page: 1, page_size: 20 })
const form = reactive<any>({ name: '', industry: '', strengths: '', weaknesses: '', typical_cases: '' })

const canCreate = computed(() => userStore.hasPerm('competitor:create'))
const canUpdate = computed(() => userStore.hasPerm('competitor:update'))
const canDelete = computed(() => userStore.hasPerm('competitor:delete'))
const scopeText = computed(() => userStore.scopeBadge('opportunity'))

function fmt(iso?: string) {
  return String(iso || '').slice(0, 16).replace('T', ' ') || '—'
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

async function loadMasters() {
  masterLoading.value = true
  try {
    const res = await api.listCompetitorMasters({ keyword: masterKeyword.value || undefined })
    masters.value = Array.isArray(res) ? res : res.list || []
  } finally {
    masterLoading.value = false
  }
}

async function loadRecords() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: query.page, page_size: query.page_size }
    ;['keyword', 'opportunity_id', 'competitor_master_id'].forEach((k) => {
      const v = (query as any)[k]
      if (v) params[k] = v
    })
    const res = await api.listAllCompetitors(params)
    items.value = res.list || []
    total.value = res.total || 0
  } finally {
    loading.value = false
  }
}

function reloadRecords() {
  query.page = 1
  loadRecords()
}

function resetRecords() {
  Object.assign(query, { keyword: '', opportunity_id: '', competitor_master_id: '', page: 1 })
  loadRecords()
}

function onPageChange(p: number) {
  query.page = p
  loadRecords()
}

function onSizeChange(s: number) {
  query.page_size = s
  query.page = 1
  loadRecords()
}

function openCreateMaster() {
  editingMaster.value = null
  Object.assign(form, { name: '', industry: '', strengths: '', weaknesses: '', typical_cases: '' })
  drawer.value = true
}

function openEditMaster(row: any) {
  editingMaster.value = row
  Object.assign(form, {
    name: row.name || '',
    industry: row.industry || '',
    strengths: row.strengths || '',
    weaknesses: row.weaknesses || '',
    typical_cases: row.typical_cases || '',
  })
  drawer.value = true
}

function resetForm() {
  editingMaster.value = null
}

async function submitMaster() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入竞品名称')
    return
  }
  submitting.value = true
  try {
    const body = {
      name: form.name.trim(),
      industry: form.industry || undefined,
      strengths: form.strengths || undefined,
      weaknesses: form.weaknesses || undefined,
      typical_cases: form.typical_cases || undefined,
    }
    if (editingMaster.value) {
      await api.updateCompetitorMaster(editingMaster.value.id, body)
      ElMessage.success('已保存')
    } else {
      await api.createCompetitorMaster(body)
      ElMessage.success('已新增')
    }
    drawer.value = false
    await loadMasters()
  } finally {
    submitting.value = false
  }
}

async function toggleMaster(row: any) {
  const enabling = !row.is_enabled
  await ElMessageBox.confirm(`确认${enabling ? '启用' : '停用'}竞品「${row.name}」？`, '操作确认', { type: 'warning' })
  if (enabling) {
    await api.updateCompetitorMaster(row.id, { is_enabled: 1 })
  } else {
    await api.disableCompetitorMaster(row.id, 'disabled')
  }
  ElMessage.success('已更新')
  await loadMasters()
}

function goOpportunity(row: any) {
  router.push(`/opportunities/${row.opportunity_id}`)
}

async function removeRecord(row: any) {
  await ElMessageBox.confirm(`确认删除竞品记录「${row.name}」？`, '删除确认', { type: 'warning' })
  await api.deleteCompetitor(row.id)
  ElMessage.success('已删除')
  await loadRecords()
}

onMounted(async () => {
  await loadMasters()
  await loadRecords()
})
</script>
