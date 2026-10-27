import client from './client'

/* ============================================================
 * 通用类型
 * ============================================================ */
export interface Paged<T> {
  list: T[]
  total: number
  page: number
  page_size: number
}

export interface PageQuery {
  page?: number
  page_size?: number
  sort?: string
  order?: 'asc' | 'desc'
  keyword?: string
  [key: string]: any
}

export interface CurrentUser {
  id: string
  username: string
  name: string
  role_id: string | null
  role_code: string | null
  role_name: string | null
  department_id: string | null
  is_admin: boolean
  permissions: string[]
  data_scopes: Record<string, string>
}

/* ============================================================
 * 鉴权与当前身份
 * ============================================================ */
export const getLoginConfig = () => client.get<any, { login_mode: string; company_name: string }>('/auth/login-config')
export const login = (username: string, password: string) =>
  client.post<any, { token: string; expires_at: string; user: { id: string; username: string; name: string } }>('/auth/login', {
    username,
    password,
  })
export const logout = () => client.post<any, { success: boolean }>('/auth/logout')
export const getMe = () => client.get<any, CurrentUser>('/me')
export const changePassword = (old_password: string, new_password: string) =>
  client.put<any, { success: boolean }>('/auth/password', { old_password, new_password })

/* ============================================================
 * 全局能力：搜索 / 通知 / 审批中心
 * ============================================================ */
export const globalSearch = (keyword: string, limit = 5) =>
  client.get<any, { keyword: string; customers: any[]; leads: any[]; opportunities: any[]; contacts: any[] }>('/search', {
    params: { keyword, limit },
  })

export const listNotifications = (params?: PageQuery) =>
  client.get<any, Paged<any> & { unread: number }>('/notifications', { params })
export const unreadCount = () => client.get<any, { unread: number }>('/notifications/unread-count')
export const readNotification = (id: string) => client.post(`/notifications/${id}/read`)
export const readAllNotifications = () => client.post<any, { updated: number }>('/notifications/read-all')

export const listApprovals = (params?: PageQuery) => client.get<any, Paged<any>>('/approvals', { params })
export const approvalSummary = () =>
  client.get<any, {
    pending: number
    done: number
    can_approve: boolean
    loss_pending: number
    stagnation_pending: number
    approval_pending: number
    my_pending_submissions: number
  }>('/approvals/summary')

/* ============================================================
 * M18 审批流引擎
 * ============================================================ */
export const listApprovalFlows = (params?: PageQuery) => client.get<any, Paged<any>>('/approval-flows', { params })
export const getApprovalFlow = (id: string) => client.get<any, any>(`/approval-flows/${id}`)
export const createApprovalFlow = (body: any) => client.post<any, { id: string }>('/approval-flows', body)
export const updateApprovalFlow = (id: string, body: any) => client.put(`/approval-flows/${id}`, body)
export const deleteApprovalFlow = (id: string) => client.delete(`/approval-flows/${id}`)
export const getApprovalOptions = () =>
  client.get<any, { biz_types: any[]; fields: any[]; operators: string[]; roles: any[]; users: any[] }>('/approval-options')
export const getApprovalInstance = (id: string) => client.get<any, any>(`/approval-instances/${id}`)
export const approveInstance = (id: string, body?: any) => client.post(`/approval-instances/${id}/approve`, body || {})
export const rejectInstance = (id: string, body: any) => client.post(`/approval-instances/${id}/reject`, body)
export const cancelInstance = (id: string) => client.post(`/approval-instances/${id}/cancel`)
export const resubmitApproval = (bizType: string, bizId: string) =>
  client.post<any, any>('/approval-instances/resubmit', { biz_type: bizType, biz_id: bizId })

/* ============================================================
 * M1 客户 / 联系人（P05/P06/P07）
 * ============================================================ */
export const listCustomers = (params?: PageQuery) => client.get<any, Paged<any>>('/customers', { params })
export const getCustomer = (id: string) => client.get<any, any>(`/customers/${id}`)
export const createCustomer = (body: any) => client.post<any, { id: string }>('/customers', body)
export const updateCustomer = (id: string, body: any) => client.put(`/customers/${id}`, body)
export const deleteCustomer = (id: string) => client.delete(`/customers/${id}`)
export const checkCustomerDuplicate = (body: { name?: string; phone?: string; credit_code?: string }) =>
  client.post<any, { duplicated: boolean; matches: any[] }>('/customers/check-duplicate', body)
export const customerHistory = (id: string) => client.get<any, any[]>(`/customers/${id}/history`)
export const customer360 = (id: string) => client.get<any, any>(`/customers/${id}/360`)
export const releaseCustomerToSea = (id: string, reason?: string) => client.post(`/customers/${id}/release-to-sea`, { reason })

export const listContacts = (customerId: string) => client.get<any, any[]>(`/customers/${customerId}/contacts`)
export const createContact = (customerId: string, body: any) => client.post<any, { id: string }>(`/customers/${customerId}/contacts`, body)
export const updateContact = (id: string, body: any) => client.put(`/contacts/${id}`, body)
export const deleteContact = (id: string) => client.delete(`/contacts/${id}`)
export const setPrimaryContact = (id: string) => client.post(`/contacts/${id}/set-primary`)

/* ============================================================
 * M2 线索（P08/P09/P10）
 * ============================================================ */
export const listLeads = (params?: PageQuery) => client.get<any, Paged<any>>('/leads', { params })
export const getLead = (id: string) => client.get<any, any>(`/leads/${id}`)
export const createLead = (body: any) => client.post<any, { id: string }>('/leads', body)
export const updateLead = (id: string, body: any) => client.put(`/leads/${id}`, body)
export const deleteLead = (id: string) => client.delete(`/leads/${id}`)
export const assignLead = (id: string, ownerId: string) => client.post(`/leads/${id}/assign`, { owner_id: ownerId })
export const convertLead = (id: string, body: any) =>
  client.post<any, { lead_id: string; opportunity_id: string }>(`/leads/${id}/convert`, body)
export const convertLeadToCustomer = (id: string, body: any) =>
  client.post<any, { lead_id: string; customer_id: string; customer: any }>(`/leads/${id}/convert-to-customer`, body)
export const recycleLead = (id: string, reason: string) => client.post(`/leads/${id}/recycle`, { reason })

/* ============================================================
 * M3 商机（P11–P14）
 * ============================================================ */
export const listOpportunities = (params?: PageQuery) => client.get<any, Paged<any>>('/opportunities', { params })
/** 阶段下拉选项（商机推进 / 看板列头） */
export const stageOptions = (includeDisabled = false) =>
  client.get<any, any[]>('/stage-options', { params: includeDisabled ? { include_disabled: 1 } : {} })
export const getOpportunity = (id: string) => client.get<any, any>(`/opportunities/${id}`)
export const createOpportunity = (body: any) => client.post<any, { id: string }>('/opportunities', body)
export const updateOpportunity = (id: string, body: any) => client.put(`/opportunities/${id}`, body)
export const deleteOpportunity = (id: string) => client.delete(`/opportunities/${id}`)
export const advanceCheck = (id: string) => client.get<any, any>(`/opportunities/${id}/advance-check`)
export const advanceOpportunity = (id: string, body: any) => client.post(`/opportunities/${id}/advance`, body)
export const rollbackOpportunity = (id: string, body: any) => client.post(`/opportunities/${id}/rollback`, body)
export const closeWin = (id: string, body: any) => client.post(`/opportunities/${id}/close-win`, body)
export const closeLoss = (id: string, body: any) => client.post(`/opportunities/${id}/close-loss`, body)
export const opportunityTimeline = (id: string) => client.get<any, any[]>(`/opportunities/${id}/timeline`)
export const opportunityStageProgress = (id: string) => client.get<any, any>(`/opportunities/${id}/stage-progress`)
export const releaseOpportunityToSea = (id: string, reason: string) =>
  client.post(`/opportunities/${id}/release-to-sea`, { reason })
/** 批量操作：transfer / release_to_sea / delete */
export const batchOpportunities = (body: { action: string; ids: string[]; owner_id?: string; reason?: string }) =>
  client.post<any, { action: string; success: string[]; failed: Array<{ id: string; reason: string }> }>('/opportunities/batch', body)

/* ============================================================
 * M4 销售行为（P15/P16）
 * ============================================================ */
export const listActivities = (params?: PageQuery) => client.get<any, Paged<any>>('/activities', { params })
export const getActivity = (id: string) => client.get<any, any>(`/activities/${id}`)
export const createActivity = (body: any) => client.post<any, { id: string }>('/activities', body)
export const updateActivity = (id: string, body: any) => client.put(`/activities/${id}`, body)
export const deleteActivity = (id: string) => client.delete(`/activities/${id}`)
export const activityStats = (params?: PageQuery) => client.get<any, any>('/activities/stats', { params })
export const activityReminders = (params?: PageQuery) => client.get<any, any[]>('/activities/reminders', { params })
export const listShares = (opportunityId: string) => client.get<any, any[]>(`/opportunities/${opportunityId}/shares`)
export const createShare = (opportunityId: string, body: any) => client.post(`/opportunities/${opportunityId}/shares`, body)
export const revokeShare = (opportunityId: string, shareId: string) =>
  client.delete(`/opportunities/${opportunityId}/shares/${shareId}`)

/* ============================================================
 * M5 方案与报价（P17–P20）
 * ============================================================ */
export const uploadFile = (file: File, extra?: Record<string, any>) => {
  const form = new FormData()
  form.append('file', file)
  Object.entries(extra || {}).forEach(([k, v]) => form.append(k, String(v)))
  return client.post<any, { file_storage_id: string; file_url: string; file_name: string; file_size: number }>(
    '/files',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
}
export const deleteFile = (id: string) => client.delete(`/files/${id}`)

/** 下载/预览附件（M5-R4）：按 blob 拉取后触发浏览器下载 */
export const downloadFile = async (id: string, fileName?: string) => {
  const blob = await client.get<any, Blob>(`/files/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || '附件'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const listProposals = (opportunityId: string) => client.get<any, any[]>(`/opportunities/${opportunityId}/proposals`)
export const listAllProposals = (params?: PageQuery) => client.get<any, Paged<any>>('/proposals', { params })
export const createProposal = (opportunityId: string, body: any) => client.post(`/opportunities/${opportunityId}/proposals`, body)
export const deleteProposal = (id: string) => client.delete(`/proposals/${id}`)

export const listQuotations = (opportunityId: string) => client.get<any, any[]>(`/opportunities/${opportunityId}/quotations`)
export const listAllQuotations = (params?: PageQuery) => client.get<any, Paged<any>>('/quotations', { params })
export const createQuotation = (opportunityId: string, body: any) => client.post(`/opportunities/${opportunityId}/quotations`, body)
export const deleteQuotation = (id: string) => client.delete(`/quotations/${id}`)

export const listProductPrices = (params?: PageQuery) => client.get<any, Paged<any>>('/products/prices', { params })
export const createProductPrice = (body: any) => client.post<any, { id: string }>('/products/prices', body)
export const updateProductPrice = (id: string, body: any) => client.put(`/products/prices/${id}`, body)
export const deleteProductPrice = (id: string) => client.delete(`/products/prices/${id}`)

export const listCompetitors = (opportunityId: string) => client.get<any, any[]>(`/opportunities/${opportunityId}/competitors`)
export const listAllCompetitors = (params?: PageQuery) => client.get<any, Paged<any>>('/competitors', { params })
export const createCompetitor = (opportunityId: string, body: any) => client.post(`/opportunities/${opportunityId}/competitors`, body)
export const deleteCompetitor = (id: string) => client.delete(`/competitors/${id}`)
export const listCompetitorMasters = (params?: PageQuery) => client.get<any, Paged<any>>('/competitor-masters', { params })
export const createCompetitorMaster = (body: any) => client.post<any, { id: string }>('/competitor-masters', body)
export const updateCompetitorMaster = (id: string, body: any) => client.put(`/competitor-masters/${id}`, body)
export const disableCompetitorMaster = (id: string, status: string) => client.post(`/competitor-masters/${id}/disable`, { status })

export const listContracts = (params?: PageQuery) => client.get<any, Paged<any>>('/contracts', { params })
export const getContract = (id: string) => client.get<any, any>(`/contracts/${id}`)
export const listOpportunityContracts = (opportunityId: string) => client.get<any, any[]>(`/opportunities/${opportunityId}/contracts`)
export const createContract = (opportunityId: string, body: any) => client.post(`/opportunities/${opportunityId}/contracts`, body)
export const updateContract = (id: string, body: any) => client.put(`/contracts/${id}`, body)
export const deleteContract = (id: string) => client.delete(`/contracts/${id}`)

/* ============================================================
 * M6 公海（P21）
 * ============================================================ */
export const seaRules = () => client.get<any, any>('/sea-pool/rules')
export const listSeaPool = (params?: PageQuery) => client.get<any, Paged<any>>('/sea-pool', { params })
export const seaDetail = (type: string, id: string) => client.get<any, any>(`/sea-pool/${type}/${id}`)
export const pickupFromSea = (type: string, id: string) => client.post(`/sea-pool/${type}/${id}/pickup`)
export const assignFromSea = (type: string, id: string, ownerId: string) =>
  client.post(`/sea-pool/${type}/${id}/assign`, { owner_id: ownerId })
export const runAutoAssign = () => client.post<any, any>('/sea-pool/auto-assign/run')

/* ============================================================
 * M7 停滞预警（P22–P24）
 * ============================================================ */
export const listAlerts = (params?: PageQuery) => client.get<any, Paged<any>>('/alerts', { params })
export const listUnadvanced = (params?: PageQuery) => client.get<any, Paged<any>>('/alerts/unadvanced', { params })
export const submitStagnationExplain = (opportunityId: string, body: any) =>
  client.post(`/opportunities/${opportunityId}/stagnation-explain`, body)
export const approveStagnationExplain = (id: string, body?: any) => client.post(`/stagnation-explains/${id}/approve`, body || {})
export const rejectStagnationExplain = (id: string, body?: any) => client.post(`/stagnation-explains/${id}/reject`, body || {})
/** 预警规则配置分组（即 P29「预警规则」页签，GET /system/configs?config_group=alert） */
export const alertConfigs = () => client.get<any, any[]>('/system/configs', { params: { config_group: 'alert' } })

/* ============================================================
 * M8 商机失效（P25/P26）
 * ============================================================ */
export const listLossRecords = (params?: PageQuery) => client.get<any, Paged<any>>('/loss-records', { params })
export const getLossRecord = (id: string) => client.get<any, any>(`/loss-records/${id}`)
export const approveLoss = (id: string, body?: any) => client.post(`/loss-records/${id}/approve`, body || {})
export const rejectLoss = (id: string, body?: any) => client.post(`/loss-records/${id}/reject`, body || {})
export const markLossRecoverable = (id: string, body?: any) => client.post(`/loss-records/${id}/mark-recoverable`, body || {})

/* ============================================================
 * M9 报表（P27）
 * ============================================================ */
export const reportFunnel = (params?: PageQuery) => client.get<any, any>('/reports/funnel', { params })
export const reportStagnation = (params?: PageQuery) => client.get<any, any>('/reports/stagnation', { params })
export const reportLoss = (params?: PageQuery) => client.get<any, any>('/reports/loss', { params })
export const reportPersonal = (params?: PageQuery) => client.get<any, any>('/reports/personal', { params })
export const reportTeam = (params?: PageQuery) => client.get<any, any>('/reports/team', { params })
/** 导出报表（M15-R6）：按 blob 拉取后触发浏览器下载；format=excel（默认）/ html */
export const exportReport = async (type: string, params: Record<string, any> = {}, format: 'excel' | 'html' = 'excel') => {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
  })
  qs.append('format', format)
  const ext = format === 'html' ? 'html' : 'xlsx'
  const blob = await client.get<any, Blob>(`/reports/${type}/export?${qs.toString()}`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `报表-${type}-${Date.now()}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/* ============================================================
 * M10 系统管理（P28–P32）
 * ============================================================ */
export const listUsers = (params?: PageQuery) => client.get<any, Paged<any>>('/users', { params })
export const getUser = (id: string) => client.get<any, any>(`/users/${id}`)
export const createUser = (body: any) => client.post<any, { id: string }>('/users', body)
export const updateUser = (id: string, body: any) => client.put(`/users/${id}`, body)
export const toggleUserStatus = (id: string, status: 'enabled' | 'disabled') => client.post(`/users/${id}/disable`, { status })
export const resetUserPassword = (id: string, newPassword: string) =>
  client.post(`/users/${id}/reset-password`, { new_password: newPassword })

export const listDepartments = () => client.get<any, any[]>('/departments')
export const createDepartment = (body: any) => client.post<any, { id: string }>('/departments', body)
export const updateDepartment = (id: string, body: any) => client.put(`/departments/${id}`, body)
export const deleteDepartment = (id: string) => client.delete(`/departments/${id}`)

export const allSystemConfigs = (params?: PageQuery) => client.get<any, any[]>('/system/configs', { params })
export const seaConfig = () => client.get<any, any>('/system/configs/sea')
export const updateSeaConfig = (body: any) => client.put('/system/configs/sea', body)
export const loginConfig = () => client.get<any, any>('/system/login-config')
export const updateLoginConfig = (body: any) => client.put('/system/login-config', body)
/** 修改单项配置（后端字段名为 config_value） */
export const updateSystemConfig = (key: string, configValue: any, confirm = false) =>
  client.put(`/system/configs/${key}`, { config_value: configValue, confirm })
/** 批量修改配置（含影响摘要二次确认） */
export const batchUpdateSystemConfigs = (items: Array<{ config_key: string; config_value: any }>) =>
  client.put('/system/configs', { items })

export const listBackups = () => client.get<any, any[]>('/system/backups')
export const createBackup = () => client.post<any, { id: string }>('/system/backups')
export const restoreBackup = (id: string) => client.post(`/system/backups/${id}/restore`)
export const listOperationLogs = (params?: PageQuery) => client.get<any, Paged<any>>('/operation-logs', { params })

/* ============================================================
 * M11 漏斗配置（P33–P36）
 * ============================================================ */
export const listStageConfigs = (params?: PageQuery) => client.get<any, any[]>('/stage-configs', { params })
export const createStageConfig = (body: any) => client.post<any, { id: string }>('/stage-configs', body)
export const updateStageConfig = (id: string, body: any) => client.put(`/stage-configs/${id}`, body)
export const deleteStageConfig = (id: string) => client.delete(`/stage-configs/${id}`)
export const toggleStageConfig = (id: string, enabled: boolean) => client.post(`/stage-configs/${id}/toggle`, { is_enabled: enabled })
export const reorderStageConfigs = (ids: string[]) => client.post('/stage-configs/reorder', { ordered_ids: ids })
export const listStageActionRules = (id: string) => client.get<any, any[]>(`/stage-configs/${id}/action-rules`)
export const getStageFieldOptions = () =>
  client.get<any, { builtin: any[]; custom: any[]; system: any[] }>('/stage-configs/field-options')
export const createStageActionRule = (id: string, body: any) => client.post(`/stage-configs/${id}/action-rules`, body)
export const updateStageActionRule = (ruleId: string, body: any) => client.put(`/stage-action-rules/${ruleId}`, body)
export const deleteStageActionRule = (ruleId: string) => client.delete(`/stage-action-rules/${ruleId}`)
export const stageVersions = () => client.get<any, any[]>('/stage-configs/versions')
export const stageVersionDetail = (version: number) => client.get<any, any>(`/stage-configs/versions/${version}`)
export const rollbackStageVersion = (version: number) => client.post('/stage-configs/rollback', { version, confirm: true })
export const previewStageMapping = (changes: any[]) => client.post<any, any>('/stage-configs/mapping/preview', { changes })
export const executeStageMapping = (body: any) => client.post('/stage-configs/mapping/execute', body)

/* ============================================================
 * M12 自定义字段（P37/P38）
 * ============================================================ */
export const listCustomFields = (entityType?: string) =>
  client.get<any, any[]>('/custom-fields', { params: { entity_type: entityType, include_disabled: 1 } })
export const createCustomField = (body: any) => client.post<any, { id: string }>('/custom-fields', body)
export const updateCustomField = (id: string, body: any) => client.put(`/custom-fields/${id}`, body)
export const deleteCustomField = (id: string) => client.delete(`/custom-fields/${id}`)
export const toggleCustomField = (id: string, enabled: boolean) => client.post(`/custom-fields/${id}/toggle`, { is_enabled: enabled })
export const customFieldReferences = (id: string) => client.get<any, any>(`/custom-fields/${id}/references`)
export const customFieldValues = (entityType: string, entityId: string) =>
  client.get<any, Record<string, any>>(`/custom-fields/values/${entityType}/${entityId}`)
export const setCustomFieldValues = (entityType: string, entityId: string, values: Record<string, any>) =>
  client.put(`/custom-fields/values/${entityType}/${entityId}`, { values })

/* ============================================================
 * M13 角色与权限（P39/P40）
 * ============================================================ */
export const listRoles = (params?: PageQuery) => client.get<any, any[]>('/roles', { params })
export const createRole = (body: any) => client.post<any, { id: string }>('/roles', body)
export const copyRole = (id: string, body: any) => client.post<any, { id: string }>(`/roles/${id}/copy`, body)
export const updateRole = (id: string, body: any) => client.put(`/roles/${id}`, body)
export const deleteRole = (id: string) => client.delete(`/roles/${id}`)
export const listPermissions = () => client.get<any, any[]>('/permissions')
export const rolePermissions = (id: string) => client.get<any, any>(`/roles/${id}/permissions`)
export const updateRolePermissions = (id: string, body: any) => client.put(`/roles/${id}/permissions`, body)
export const roleDataScopes = (id: string) => client.get<any, any>(`/roles/${id}/data-scopes`)
export const updateRoleDataScopes = (id: string, body: any) => client.put(`/roles/${id}/data-scopes`, body)
export const rolePermissionChangePreview = (id: string, body: any) =>
  client.get<any, any>(`/roles/${id}/permission-change-preview`, { params: body })
export const roleMembers = (id: string) => client.get<any, any[]>(`/roles/${id}/members`)

/* ============================================================
 * M14 字典（P41）
 * ============================================================ */
export const listDictionaries = (params?: PageQuery) => client.get<any, any[]>('/dictionaries', { params })
export const getDictionary = (id: string) => client.get<any, any>(`/dictionaries/${id}`)
export const createDictionary = (body: any) => client.post<any, { id: string }>('/dictionaries', body)
export const updateDictionary = (id: string, body: any) => client.put(`/dictionaries/${id}`, body)
export const deleteDictionary = (id: string) => client.delete(`/dictionaries/${id}`)
export const listDictionaryItems = (id: string) => client.get<any, any[]>(`/dictionaries/${id}/items`)
export const createDictionaryItem = (id: string, body: any) => client.post(`/dictionaries/${id}/items`, body)
export const updateDictionaryItem = (itemId: string, body: any) => client.put(`/dictionary-items/${itemId}`, body)
export const deleteDictionaryItem = (itemId: string, confirmed = false) =>
  client.delete(`/dictionary-items/${itemId}`, { params: { confirm: confirmed } })
export const dictionaryReferences = (id: string) => client.get<any, any>(`/dictionaries/${id}/references`)

/* ============================================================
 * M15 视图与报表配置（P42/P43/P44）
 * ============================================================ */
export const listViews = (params: PageQuery) => client.get<any, any[]>('/views', { params })
export const createView = (body: any) => client.post<any, { id: string }>('/views', body)
export const updateView = (id: string, body: any) => client.put(`/views/${id}`, body)
export const deleteView = (id: string) => client.delete(`/views/${id}`)
export const setDefaultView = (id: string) => client.post(`/views/${id}/set-default`)

export const listReportTemplates = (params?: PageQuery) => client.get<any, any[]>('/report-templates', { params })
export const createReportTemplate = (body: any) => client.post<any, { id: string }>('/report-templates', body)
export const updateReportTemplate = (id: string, body: any) => client.put(`/report-templates/${id}`, body)
export const deleteReportTemplate = (id: string) => client.delete(`/report-templates/${id}`)
export const previewReportTemplate = (id: string, body?: any) => client.post<any, any>(`/report-templates/${id}/preview`, body || {})

/** 订阅列表（后端返回数组，非分页结构） */
export const listReportSubscriptions = (params?: PageQuery) => client.get<any, any[]>('/report-subscriptions', { params })
export const createReportSubscription = (body: any) => client.post<any, { id: string }>('/report-subscriptions', body)
export const updateReportSubscription = (id: string, body: any) => client.put(`/report-subscriptions/${id}`, body)
export const deleteReportSubscription = (id: string) => client.delete(`/report-subscriptions/${id}`)

/* ============================================================
 * M16 实施向导（P45/P46）
 * ============================================================ */
export const wizardState = () => client.get<any, any>('/implementation/wizard/state')
export const saveWizardStep = (body: any) => client.post<any, any>('/implementation/wizard/step', body)
export const finishWizard = () => client.post<any, any>('/implementation/wizard/finish')
export const listImplementationTemplates = () => client.get<any, any[]>('/implementation/templates')
export const exportImplementationTemplate = (body: any) => client.post<any, any>('/implementation/templates/export', body)
export const importImplementationTemplate = (configData: any) =>
  client.post<any, any>('/implementation/templates/import', { config_data: configData })
export const confirmImportTemplate = (body: any) => client.post<any, any>('/implementation/templates/import/confirm', body)
export const upgradeImplementationTemplate = (id: string, body?: any) => client.post<any, any>(`/implementation/templates/${id}/upgrade`, body || {})
export const deleteImplementationTemplate = (id: string) => client.delete(`/implementation/templates/${id}`)
