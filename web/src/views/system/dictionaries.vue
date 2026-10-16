<template>
  <div class="page">
    <!-- 页头 -->
    <div class="page-card">
      <div class="page-head">
        <div class="page-head__left">
          <h2 class="page-title">系统字典</h2>
          <span class="text-muted">字典项变更即时生效，被业务引用的项删除需二次确认</span>
        </div>
        <div class="page-head__right">
          <el-button @click="loadAll">刷新</el-button>
          <el-button v-if="canView" :disabled="!current" @click="openReferences">引用明细</el-button>
          <el-button v-if="canManage" type="primary" @click="openDictCreate">新增字典类型</el-button>
        </div>
      </div>
    </div>

    <div class="dict-layout">
      <!-- 左栏：字典类型 -->
      <aside class="dict-card">
        <div class="dict-card__head">
          <span>字典类型</span>
          <el-button v-if="canManage" link type="primary" @click="openDictCreate">新增</el-button>
        </div>
        <el-input v-model="dictKeyword" placeholder="搜索名称 / 编码" clearable size="small" class="mb-12" />
        <div v-loading="dictLoading" class="dict-list">
          <div
            v-for="d in filteredDicts"
            :key="d.id"
            class="dict-item"
            :class="{ 'dict-item--active': current?.id === d.id }"
            @click="selectDict(d)"
          >
            <div class="dict-item__main">
              <div class="dict-item__name">
                <span class="dict-item__text">{{ d.dict_name }}</span>
                <el-tag v-if="isOn(d.is_system)" size="small" type="info" effect="plain">内置</el-tag>
              </div>
              <div class="dict-item__code text-muted">{{ d.dict_code }} · {{ d.item_count ?? 0 }} 项</div>
            </div>
            <span v-if="canManage" class="dict-item__ops">
              <el-icon title="编辑" @click.stop="openDictEdit(d)"><Edit /></el-icon>
              <el-icon v-if="!isOn(d.is_system)" title="删除" @click.stop="removeDict(d)"><Delete /></el-icon>
            </span>
          </div>
          <p v-if="!filteredDicts.length && !dictLoading" class="empty-tip">暂无字典类型</p>
        </div>
      </aside>

      <!-- 右栏：字典项 -->
      <section class="page-card dict-main">
        <div v-if="current" class="dict-info">
          <div class="dict-info__title">
            <span class="dict-info__name">{{ current.dict_name }}</span>
            <el-tag v-if="isOn(current.is_system)" size="small" type="info" effect="plain">内置</el-tag>
            <el-tag size="small" :type="isOn(current.is_enabled) ? 'success' : 'info'" effect="plain">
              {{ isOn(current.is_enabled) ? '启用' : '停用' }}
            </el-tag>
          </div>
          <div class="dict-info__meta text-muted">
            <span>编码：{{ current.dict_code }}</span>
            <span>分类：{{ current.category || '—' }}</span>
            <span>版本号：{{ current.version || 1 }}</span>
          </div>
          <div v-if="current.description" class="dict-info__desc text-muted">描述：{{ current.description }}</div>
        </div>
        <p v-else class="empty-tip">请选择左侧字典类型</p>

        <div class="items-head">
          <span class="section-card__title">字典项</span>
          <el-button v-if="canManage" type="primary" size="small" :disabled="!current" @click="openItemCreate">
            新增字典项
          </el-button>
        </div>

        <el-table v-loading="itemsLoading" :data="items" size="small" style="width: 100%">
          <el-table-column prop="sort_order" label="排序" width="70" align="center" />
          <el-table-column prop="item_code" label="编码" width="160" show-overflow-tooltip />
          <el-table-column prop="item_name" label="名称" min-width="140" show-overflow-tooltip />
          <el-table-column label="默认" width="80" align="center">
            <template #default="{ row }">
              <el-tag v-if="isOn(row.is_default)" size="small" effect="plain">默认</el-tag>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="isOn(row.is_enabled) ? 'success' : 'info'" effect="plain">
                {{ isOn(row.is_enabled) ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.remark || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" align="center" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canManage" link type="primary" @click="openItemEdit(row)">编辑</el-button>
              <el-button
                v-if="canManage"
                link
                :type="isOn(row.is_enabled) ? 'danger' : 'primary'"
                @click="toggleItem(row)"
              >
                {{ isOn(row.is_enabled) ? '停用' : '启用' }}
              </el-button>
              <el-button v-if="canManage" link type="danger" @click="removeItem(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="empty-tip">暂无数据</div>
          </template>
        </el-table>
      </section>
    </div>

    <!-- 新增 / 编辑字典类型 -->
    <el-dialog v-model="dictDialog" :title="dictEditing ? '编辑字典类型' : '新增字典类型'" width="480px" align-center @closed="resetDictForm">
      <el-form label-width="90px">
        <el-form-item label="字典编码" required>
          <el-input
            v-model="dictForm.dict_code"
            maxlength="60"
            placeholder="英文编码，如 customer_industry"
            :disabled="!!dictEditing && isOn(dictEditing.is_system)"
          />
          <div v-if="!!dictEditing && isOn(dictEditing.is_system)" class="el-upload__tip">内置字典编码不可修改</div>
        </el-form-item>
        <el-form-item label="字典名称" required>
          <el-input v-model="dictForm.dict_name" maxlength="60" placeholder="请输入字典名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="dictForm.category" maxlength="60" placeholder="留空默认与编码相同" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="dictForm.description" type="textarea" :rows="2" maxlength="200" placeholder="请输入描述" />
        </el-form-item>
        <el-form-item v-if="dictEditing" label="状态">
          <el-switch v-model="dictForm.is_enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dictDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmDict">提交</el-button>
      </template>
    </el-dialog>

    <!-- 新增 / 编辑字典项 -->
    <el-dialog v-model="itemDialog" :title="itemEditing ? '编辑字典项' : '新增字典项'" width="480px" align-center @closed="resetItemForm">
      <el-form label-width="90px">
        <el-form-item label="字典项编码" required>
          <el-input v-model="itemForm.item_code" maxlength="60" placeholder="请输入字典项编码" />
        </el-form-item>
        <el-form-item label="字典项名称" required>
          <el-input v-model="itemForm.item_name" maxlength="60" placeholder="请输入字典项名称" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="itemForm.sort_order" :min="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="是否默认">
          <el-switch v-model="itemForm.is_default" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="itemForm.remark" type="textarea" :rows="2" maxlength="200" placeholder="请输入备注" />
        </el-form-item>
        <el-form-item v-if="itemEditing" label="状态">
          <el-switch v-model="itemForm.is_enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmItem">提交</el-button>
      </template>
    </el-dialog>

    <!-- 引用明细 -->
    <el-dialog v-model="refDialog" title="引用明细" width="480px" align-center>
      <div v-loading="refLoading">
        <p class="text-muted mb-12">字典「{{ current?.dict_name }}（{{ current?.dict_code }}）」的字典项被业务引用情况。</p>
        <div v-for="it in refItems" :key="it.item_id" class="ref-row">
          <div class="ref-row__name">
            {{ it.item_name }}
            <span class="text-muted">（{{ it.item_code }}）</span>
          </div>
          <div class="ref-row__refs">
            <template v-if="it.references && it.references.length">
              <el-tag v-for="r in it.references" :key="r.type" size="small" effect="plain" class="ref-tag">
                {{ refTypeLabel(r.type) }}（{{ r.count }} 条）
              </el-tag>
            </template>
            <span v-else class="text-muted">未被引用</span>
          </div>
        </div>
        <p v-if="!refItems.length && !refLoading" class="empty-tip">暂无可查看的字典项</p>
      </div>
      <template #footer>
        <el-button @click="refDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

/** 字典项引用来源中文映射 */
const REF_TYPE_LABEL: Record<string, string> = {
  custom_field_definition: '自定义字段',
  stage_action_rule: '阶段固定动作',
  customer_industry: '客户行业',
  customer_scale: '客户规模',
  customer_source_channel: '客户来源渠道',
  lead_source_channel: '线索来源渠道',
  activity_type: '行为类型',
  product_type: '产品类型',
  quotation_product_type: '报价产品类型',
}

const dictLoading = ref(false)
const itemsLoading = ref(false)
const submitting = ref(false)
const refLoading = ref(false)

const dicts = ref<any[]>([])
const items = ref<any[]>([])
const current = ref<any>(null)
const dictKeyword = ref('')

const dictDialog = ref(false)
const dictEditing = ref<any>(null)
const dictForm = reactive<any>({ dict_code: '', dict_name: '', category: '', description: '', is_enabled: true })

const itemDialog = ref(false)
const itemEditing = ref<any>(null)
const itemForm = reactive<any>({ item_code: '', item_name: '', sort_order: 0, is_default: false, remark: '', is_enabled: true })

const refDialog = ref(false)
const refItems = ref<any[]>([])

const canManage = computed(() => userStore.hasPerm('dictionary:manage'))
const canView = computed(() => userStore.hasPerm('dictionary:view'))

/** 后端布尔字段可能为 0/1 或 true/false */
function isOn(v: any) {
  return v === 1 || v === true
}

function refTypeLabel(type: string) {
  return REF_TYPE_LABEL[type] || type
}

const filteredDicts = computed(() => {
  const kw = dictKeyword.value.trim().toLowerCase()
  if (!kw) return dicts.value
  return dicts.value.filter(
    (d) => String(d.dict_name || '').toLowerCase().includes(kw) || String(d.dict_code || '').toLowerCase().includes(kw)
  )
})

async function loadDicts() {
  dictLoading.value = true
  try {
    dicts.value = (await api.listDictionaries()) || []
    const found = current.value ? dicts.value.find((d) => d.id === current.value.id) : null
    current.value = found || dicts.value[0] || null
  } finally {
    dictLoading.value = false
  }
  await loadItems()
}

async function loadItems() {
  if (!current.value) {
    items.value = []
    return
  }
  itemsLoading.value = true
  try {
    items.value = (await api.listDictionaryItems(current.value.id)) || []
  } finally {
    itemsLoading.value = false
  }
}

function loadAll() {
  return loadDicts()
}

function selectDict(d: any) {
  current.value = d
  loadItems()
}

/* ---------------- 字典类型维护 ---------------- */
function openDictCreate() {
  dictEditing.value = null
  Object.assign(dictForm, { dict_code: '', dict_name: '', category: '', description: '', is_enabled: true })
  dictDialog.value = true
}

function openDictEdit(d: any) {
  dictEditing.value = d
  Object.assign(dictForm, {
    dict_code: d.dict_code || '',
    dict_name: d.dict_name || '',
    category: d.category || '',
    description: d.description || '',
    is_enabled: isOn(d.is_enabled),
  })
  dictDialog.value = true
}

function resetDictForm() {
  dictEditing.value = null
}

async function confirmDict() {
  if (!dictEditing.value && !dictForm.dict_code.trim()) {
    ElMessage.warning('请输入字典编码')
    return
  }
  if (!dictForm.dict_name.trim()) {
    ElMessage.warning('请输入字典名称')
    return
  }
  submitting.value = true
  try {
    if (dictEditing.value) {
      const body: Record<string, any> = {
        dict_name: dictForm.dict_name.trim(),
        category: dictForm.category.trim() || null,
        description: dictForm.description.trim() || null,
        is_enabled: dictForm.is_enabled,
      }
      if (!isOn(dictEditing.value.is_system)) body.dict_code = dictForm.dict_code.trim()
      await api.updateDictionary(dictEditing.value.id, body)
      ElMessage.success('已保存')
    } else {
      await api.createDictionary({
        dict_code: dictForm.dict_code.trim(),
        dict_name: dictForm.dict_name.trim(),
        category: dictForm.category.trim() || undefined,
        description: dictForm.description.trim() || undefined,
      })
      ElMessage.success('字典类型已创建')
    }
    dictDialog.value = false
    await loadDicts()
  } finally {
    submitting.value = false
  }
}

async function removeDict(d: any) {
  await ElMessageBox.confirm(`确认删除字典类型「${d.dict_name}」？其下字典项将一并删除。`, '删除确认', { type: 'warning' })
  try {
    await api.deleteDictionary(d.id)
    ElMessage.success('已删除')
    if (current.value?.id === d.id) current.value = null
    await loadDicts()
  } catch (e: any) {
    ElMessage.error(e?.bizMessage || '删除失败')
  }
}

/* ---------------- 字典项维护 ---------------- */
function openItemCreate() {
  if (!current.value) return
  itemEditing.value = null
  Object.assign(itemForm, { item_code: '', item_name: '', sort_order: 0, is_default: false, remark: '', is_enabled: true })
  itemDialog.value = true
}

function openItemEdit(row: any) {
  itemEditing.value = row
  Object.assign(itemForm, {
    item_code: row.item_code || '',
    item_name: row.item_name || '',
    sort_order: row.sort_order ?? 0,
    is_default: isOn(row.is_default),
    remark: row.remark || '',
    is_enabled: isOn(row.is_enabled),
  })
  itemDialog.value = true
}

function resetItemForm() {
  itemEditing.value = null
}

async function confirmItem() {
  if (!itemForm.item_code.trim()) {
    ElMessage.warning('请输入字典项编码')
    return
  }
  if (!itemForm.item_name.trim()) {
    ElMessage.warning('请输入字典项名称')
    return
  }
  submitting.value = true
  try {
    if (itemEditing.value) {
      await api.updateDictionaryItem(itemEditing.value.id, {
        item_code: itemForm.item_code.trim(),
        item_name: itemForm.item_name.trim(),
        sort_order: Number(itemForm.sort_order) || 0,
        is_default: itemForm.is_default,
        is_enabled: itemForm.is_enabled,
        remark: itemForm.remark.trim() || null,
      })
      ElMessage.success('已保存')
    } else {
      await api.createDictionaryItem(current.value.id, {
        item_code: itemForm.item_code.trim(),
        item_name: itemForm.item_name.trim(),
        sort_order: Number(itemForm.sort_order) || 0,
        is_default: itemForm.is_default,
        remark: itemForm.remark.trim() || undefined,
      })
      ElMessage.success('字典项已创建')
    }
    itemDialog.value = false
    await refreshItems()
  } finally {
    submitting.value = false
  }
}

async function toggleItem(row: any) {
  const next = !isOn(row.is_enabled)
  const action = next ? '启用' : '停用'
  await ElMessageBox.confirm(`确认${action}字典项「${row.item_name}」？`, `${action}确认`, { type: 'warning' })
  await api.updateDictionaryItem(row.id, { is_enabled: next })
  ElMessage.success(`已${action}`)
  await refreshItems()
}

async function removeItem(row: any) {
  await ElMessageBox.confirm(`确认删除字典项「${row.item_name}」？`, '删除确认', { type: 'warning' })
  try {
    await api.deleteDictionaryItem(row.id)
    ElMessage.success('已删除')
    await refreshItems()
  } catch (e: any) {
    const refs = e?.response?.data?.data
    if (e?.status === 409 && Array.isArray(refs) && refs.length) {
      const lines = refs.map((r: any) => `${refTypeLabel(r.type)}（${r.count} 条）`).join('<br/>')
      try {
        await ElMessageBox.confirm(
          `字典项「${row.item_name}」已被以下业务引用：<br/><br/>${lines}<br/><br/>删除后可能影响上述数据，确认继续删除？`,
          '删除二次确认',
          { type: 'warning', dangerouslyUseHTMLString: true, confirmButtonText: '确认删除', cancelButtonText: '取消' }
        )
      } catch (e2) {
        return
      }
      await api.deleteDictionaryItem(row.id, true)
      ElMessage.success('已删除')
      await refreshItems()
    } else {
      ElMessage.error(e?.bizMessage || '删除失败')
    }
  }
}

/** 字典项变更后刷新列表与左侧项数 */
async function refreshItems() {
  await loadItems()
  if (current.value) current.value.item_count = items.value.length
}

/* ---------------- 引用明细 ---------------- */
async function openReferences() {
  if (!current.value) return
  refDialog.value = true
  refLoading.value = true
  refItems.value = []
  try {
    const res = await api.dictionaryReferences(current.value.id)
    refItems.value = res?.items || []
  } finally {
    refLoading.value = false
  }
}

onMounted(() => {
  loadDicts()
})
</script>

<style scoped>
.dict-layout {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.dict-card {
  width: 260px;
  flex-shrink: 0;
  background: var(--crm-card);
  border-radius: var(--crm-radius);
  padding: 12px;
}

.dict-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}

.dict-list {
  max-height: calc(100vh - 220px);
  overflow-y: auto;
}

.dict-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--crm-radius);
  cursor: pointer;
}

.dict-item:hover {
  background: #f5f7fa;
}

.dict-item--active {
  background: var(--el-color-primary-light-9);
}

.dict-item__main {
  min-width: 0;
  flex: 1;
}

.dict-item__name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dict-item__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dict-item__code {
  font-size: 12px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dict-item__ops {
  display: none;
  gap: 6px;
  color: var(--crm-text-secondary);
}

.dict-item:hover .dict-item__ops {
  display: inline-flex;
}

.dict-main {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.dict-info {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--crm-border);
}

.dict-info__title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dict-info__name {
  font-size: 15px;
  font-weight: 600;
}

.dict-info__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  margin-top: 6px;
}

.dict-info__desc {
  font-size: 12px;
  margin-top: 4px;
}

.items-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.ref-row {
  padding: 8px 0;
  border-bottom: 1px dashed var(--crm-border);
}

.ref-row:last-child {
  border-bottom: none;
}

.ref-row__name {
  font-weight: 600;
}

.ref-row__refs {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ref-tag {
  margin: 0;
}

@media (max-width: 1200px) {
  .dict-card {
    width: 200px;
  }
}
</style>
