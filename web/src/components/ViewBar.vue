<template>
  <div class="view-bar">
    <el-select
      v-model="activeId"
      placeholder="选择视图"
      style="width: 180px"
      :no-data-text="'暂无可用视图'"
      @change="onSelectView"
    >
      <el-option v-for="v in views" :key="v.id" :label="v.view_name" :value="v.id">
        <span>{{ v.view_name }}</span>
        <el-tag v-if="v.is_system === 1" size="small" type="info" effect="plain" class="opt-tag">系统</el-tag>
      </el-option>
    </el-select>
    <el-button @click="openDrawer">
      <el-icon><Setting /></el-icon>
      <span>配置视图</span>
    </el-button>
  </div>

  <!-- 视图配置抽屉（P42 / M15-R1~R3） -->
  <el-drawer v-model="drawer" title="视图配置" size="480px">
    <el-form label-width="96px" label-position="top">
      <el-form-item label="视图名称" required>
        <el-input v-model="draft.name" maxlength="40" placeholder="请输入视图名称" />
      </el-form-item>
      <el-form-item label="视图类型">
        <el-radio-group v-model="draft.view_type">
          <el-radio value="personal">个人视图</el-radio>
          <el-radio value="shared">共享视图</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="默认数据范围">
        <el-select v-model="draft.scope" style="width: 100%">
          <el-option label="我的" value="self" />
          <el-option label="本部门" value="department" />
          <el-option label="本部门及下级" value="sub_department" />
          <el-option label="全部" value="all" />
        </el-select>
      </el-form-item>
      <el-form-item label="每页条数">
        <el-select v-model="draft.page_size" style="width: 100%">
          <el-option v-for="n in PAGE_SIZES" :key="n" :label="`${n} 条/页`" :value="n" />
        </el-select>
      </el-form-item>

      <el-form-item label="显示列与顺序">
        <div class="col-list">
          <div v-for="(d, i) in orderedDefs" :key="d.key" class="col-row">
            <el-checkbox
              :model-value="selected.includes(d.key)"
              @update:model-value="(v: any) => toggleColumn(d.key, !!v)"
            >
              {{ d.label }}
            </el-checkbox>
            <span v-if="selected.includes(d.key)" class="col-actions">
              <el-button
                link
                :disabled="selectedIndex(d.key) === 0"
                title="上移"
                @click="moveColumn(d.key, -1)"
              >
                <el-icon><Top /></el-icon>
              </el-button>
              <el-button
                link
                :disabled="selectedIndex(d.key) === selected.length - 1"
                title="下移"
                @click="moveColumn(d.key, 1)"
              >
                <el-icon><Bottom /></el-icon>
              </el-button>
            </span>
            <span v-else class="text-muted col-hidden">未显示</span>
          </div>
        </div>
      </el-form-item>

      <el-form-item v-if="filterDefs.length" label="默认筛选">
        <div class="filter-fields">
          <div v-for="f in filterDefs" :key="f.key" class="filter-field">
            <span class="filter-field__label">{{ f.label }}</span>
            <el-select
              v-if="f.type === 'select'"
              v-model="draft.filter[f.key]"
              clearable
              placeholder="不限"
              style="width: 100%"
            >
              <el-option v-for="o in f.options || []" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-input v-else v-model="draft.filter[f.key]" clearable placeholder="不限" />
          </div>
        </div>
      </el-form-item>

      <el-form-item label="默认排序">
        <div class="sort-row">
          <el-select v-model="draft.sortField" clearable placeholder="默认排序字段" style="width: 60%">
            <el-option v-for="d in sortOptions" :key="d.key" :label="d.label" :value="d.key" />
          </el-select>
          <el-select v-model="draft.sortOrder" :disabled="!draft.sortField" style="width: 36%">
            <el-option label="降序" value="desc" />
            <el-option label="升序" value="asc" />
          </el-select>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="drawer-footer">
        <span class="text-muted drawer-footer__tip">
          {{ currentIsSystem ? '系统默认视图不可修改，保存将新建视图' : '' }}
        </span>
        <div>
          <el-button @click="drawer = false">取消</el-button>
          <el-button v-if="canEditCurrent" :loading="saving" @click="save(false)">保存修改</el-button>
          <el-button type="primary" :loading="saving" @click="save(true)">
            {{ canEditCurrent ? '另存为新视图' : '保存视图' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
/**
 * 视图切换器 + 视图配置抽屉（P42 / M15-R1~R3）
 * - 由列表页传入可用列（columnDefs）与可筛选字段（filterDefs）
 * - 加载 /views 后套用默认视图，并把列顺序、每页条数、默认筛选、默认排序通过 apply 事件回传
 * - 系统默认视图只读，保存时自动新建为个人/共享视图
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api'
import { useUserStore } from '@/stores/user'
import type { Option } from '@/config/options'

export interface ViewColumnDef {
  key: string
  label: string
  width?: number | string
  minWidth?: number | string
  fixed?: 'left' | 'right'
}

export interface ViewFilterDef {
  key: string
  label: string
  type?: 'text' | 'select'
  options?: Option[]
}

export interface ViewApplyState {
  view: any | null
  columns: string[]
  page_size: number
  default_filter: Record<string, any>
  default_sort: { field: string; order: string } | null
}

const props = defineProps<{
  entityType: string
  columnDefs: ViewColumnDef[]
  filterDefs?: ViewFilterDef[]
  sortDefs?: ViewColumnDef[]
  defaultViewName?: string
}>()

const emit = defineEmits<{ apply: [state: ViewApplyState] }>()

const PAGE_SIZES = [20, 50, 100]

const userStore = useUserStore()
const canManage = computed(() => userStore.hasPerm('view:manage'))

const filterDefs = computed<ViewFilterDef[]>(() => props.filterDefs || [])
/** 可排序字段（默认取全部列） */
const sortOptions = computed(() => (props.sortDefs?.length ? props.sortDefs : props.columnDefs))

const views = ref<any[]>([])
const activeId = ref<string>('')
const drawer = ref(false)
const saving = ref(false)

const draft = reactive({
  id: '',
  name: '',
  view_type: 'personal',
  scope: 'self',
  page_size: 20,
  filter: {} as Record<string, any>,
  sortField: '',
  sortOrder: 'desc',
})
const selected = ref<string[]>([])

const activeView = computed(() => views.value.find((v) => v.id === activeId.value) || null)
const currentIsSystem = computed(() => activeView.value?.is_system === 1)
const canEditCurrent = computed(
  () =>
    !!activeView.value &&
    activeView.value.is_system !== 1 &&
    (userStore.isAdmin || activeView.value.owner_id === userStore.profile?.id)
)

/** 已选列按顺序在前，未选列在后 */
const orderedDefs = computed(() => {
  const map = new Map(props.columnDefs.map((d) => [d.key, d]))
  const picked = selected.value.map((k) => map.get(k)).filter(Boolean) as ViewColumnDef[]
  const rest = props.columnDefs.filter((d) => !selected.value.includes(d.key))
  return [...picked, ...rest]
})

function toArray(v: any): string[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function selectedIndex(key: string) {
  return selected.value.indexOf(key)
}

function toggleColumn(key: string, on: boolean) {
  if (on) {
    if (!selected.value.includes(key)) selected.value.push(key)
  } else {
    selected.value = selected.value.filter((k) => k !== key)
  }
}

function moveColumn(key: string, delta: number) {
  const i = selectedIndex(key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= selected.value.length) return
  const arr = [...selected.value]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  selected.value = arr
}

/** 应用某个视图到列表页 */
function applyView(view: any | null) {
  const allKeys = props.columnDefs.map((d) => d.key)
  const cols = toArray(view?.columns)
  emit('apply', {
    view,
    columns: cols.length ? cols.filter((k) => allKeys.includes(k)) : allKeys,
    page_size: Number(view?.page_size) || 20,
    default_filter: (view?.default_filter && typeof view.default_filter === 'object') ? view.default_filter : {},
    default_sort: view?.default_sort?.field ? view.default_sort : null,
  })
}

async function loadViews() {
  views.value = (await api.listViews({ entity_type: props.entityType })) || []
  if (!views.value.length) {
    activeId.value = ''
    applyView(null)
    return
  }
  const preferred = views.value.find((v) => v.is_default === 1) || views.value[0]
  activeId.value = preferred.id
  applyView(preferred)
}

function onSelectView(id: string) {
  applyView(views.value.find((v) => v.id === id) || null)
}

function openDrawer() {
  const v = activeView.value
  draft.id = v?.id || ''
  draft.name = v ? `${v.view_name}${v.is_system === 1 ? ' 副本' : ''}` : (props.defaultViewName || '我的视图')
  draft.view_type = v?.view_type === 'default' ? 'personal' : (v?.view_type || 'personal')
  draft.scope = v?.scope === 'department' || v?.scope === 'sub_department' || v?.scope === 'all' ? v.scope : 'self'
  draft.page_size = Number(v?.page_size) || 20
  const cols = toArray(v?.columns)
  selected.value = cols.length ? cols.filter((k) => props.columnDefs.some((d) => d.key === k)) : props.columnDefs.map((d) => d.key)
  const filter = (v?.default_filter && typeof v.default_filter === 'object') ? v.default_filter : {}
  draft.filter = {}
  filterDefs.value.forEach((f) => {
    const val = filter[f.key]
    draft.filter[f.key] = val === undefined || val === null ? '' : val
  })
  draft.sortField = v?.default_sort?.field || ''
  draft.sortOrder = v?.default_sort?.order === 'asc' ? 'asc' : 'desc'
  drawer.value = true
}

function buildBody() {
  const defaultFilter: Record<string, any> = {}
  Object.keys(draft.filter).forEach((k) => {
    const val = draft.filter[k]
    if (val !== '' && val !== null && val !== undefined) defaultFilter[k] = val
  })
  return {
    view_name: draft.name.trim(),
    entity_type: props.entityType,
    view_type: draft.view_type,
    scope: draft.scope,
    page_size: draft.page_size,
    columns: selected.value,
    default_filter: defaultFilter,
    default_sort: draft.sortField ? { field: draft.sortField, order: draft.sortOrder } : {},
  }
}

async function save(asNew: boolean) {
  if (!canManage.value) {
    ElMessage.warning('无视图配置权限')
    return
  }
  if (!draft.name.trim()) {
    ElMessage.warning('请输入视图名称')
    return
  }
  if (!selected.value.length) {
    ElMessage.warning('请至少保留一列')
    return
  }
  const body = buildBody()
  saving.value = true
  try {
    if (!asNew && draft.id) {
      await api.updateView(draft.id, body)
      ElMessage.success('视图已更新')
    } else {
      const res = await api.createView(body)
      ElMessage.success('视图已保存')
      await loadViews()
      activeId.value = res.id
      applyView(views.value.find((v) => v.id === res.id) || null)
      drawer.value = false
      return
    }
    drawer.value = false
    await loadViews()
    activeId.value = draft.id
    applyView(views.value.find((v) => v.id === draft.id) || null)
  } catch (e: any) {
    ElMessage.error(e?.bizMessage || e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadViews)
</script>

<style scoped>
.view-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.opt-tag {
  margin-left: 6px;
}

.col-list,
.filter-fields {
  width: 100%;
  border: 1px solid var(--crm-border);
  border-radius: var(--crm-radius);
  padding: 6px 10px;
}

.col-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
}

.col-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.col-hidden {
  font-size: 12px;
}

.filter-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}

.filter-field__label {
  width: 84px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--crm-text-regular);
}

.sort-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer-footer__tip {
  font-size: 12px;
}
</style>
