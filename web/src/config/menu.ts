/**
 * 菜单树（界面设计文档 2.2 系统菜单树，9 个一级菜单）
 * - 每个节点通过 component 指向 src/views 下的页面文件（不带扩展名）
 * - 页面文件尚未实现时自动回退到「建设中」占位页，便于按模块逐步交付
 * - perm：访问所需功能权限编码（管理员默认放行）
 */
export interface MenuLeaf {
  title: string
  name: string
  path: string
  perm?: string | string[]
  component: string
}

export interface MenuGroup {
  title: string
  icon: string
  children: MenuLeaf[]
}

export const MENU: MenuGroup[] = [
  {
    title: '工作台',
    icon: 'HomeFilled',
    children: [{ title: '首页工作台', name: 'dashboard', path: '/dashboard', component: 'dashboard/index' }],
  },
  {
    title: '客户与线索',
    icon: 'OfficeBuilding',
    children: [
      { title: '客户管理', name: 'customers', path: '/customers', perm: 'customer:view', component: 'customers/index' },
      { title: '线索管理', name: 'leads', path: '/leads', perm: 'lead:view', component: 'leads/index' },
    ],
  },
  {
    title: '商机中心',
    icon: 'TrendCharts',
    children: [
      { title: '商机列表', name: 'opportunities', path: '/opportunities', perm: 'opportunity:view', component: 'opportunities/index' },
      { title: '漏斗看板', name: 'funnel', path: '/funnel', perm: 'opportunity:view', component: 'opportunities/Funnel' },
    ],
  },
  {
    title: '销售行为',
    icon: 'Calendar',
    children: [{ title: '行为记录', name: 'activities', path: '/activities', perm: 'activity:view', component: 'activities/index' }],
  },
  {
    title: '方案与报价',
    icon: 'Files',
    children: [
      { title: '方案管理', name: 'proposals', path: '/proposals', perm: 'proposal:view', component: 'sales-assets/proposals' },
      { title: '报价管理', name: 'quotations', path: '/quotations', perm: 'quotation:view', component: 'sales-assets/quotations' },
      { title: '产品价格', name: 'product-prices', path: '/product-prices', perm: 'quotation:view', component: 'sales-assets/product-prices' },
      { title: '竞争对手', name: 'competitors', path: '/competitors', perm: 'competitor:view', component: 'sales-assets/competitors' },
      { title: '合同管理', name: 'contracts', path: '/contracts', perm: 'contract:view', component: 'sales-assets/contracts' },
    ],
  },
  {
    title: '公海池',
    icon: 'Ship',
    children: [{ title: '公海池', name: 'sea', path: '/sea', perm: 'sea:view', component: 'sea/index' }],
  },
  {
    title: '预警与审批',
    icon: 'Warning',
    children: [
      { title: '停滞预警', name: 'alerts', path: '/alerts', perm: 'alert:view', component: 'alerts/index' },
      { title: '未推进列表', name: 'unadvanced', path: '/unadvanced', perm: 'alert:manage', component: 'alerts/unadvanced' },
      { title: '审批中心', name: 'approvals', path: '/approvals', perm: ['loss:approve', 'alert:manage', 'approval:view'], component: 'approvals/index' },
      { title: '失效记录', name: 'loss-records', path: '/loss-records', perm: 'loss:view', component: 'loss/index' },
    ],
  },
  {
    title: '报表中心',
    icon: 'DataAnalysis',
    children: [
      { title: '报表中心', name: 'reports', path: '/reports', perm: 'report:view', component: 'reports/index' },
      { title: '订阅管理', name: 'report-subscriptions', path: '/report-subscriptions', perm: 'report:view', component: 'reports/subscriptions' },
    ],
  },
  {
    title: '系统管理',
    icon: 'Setting',
    children: [
      { title: '用户管理', name: 'sys-users', path: '/system/users', perm: 'user:view', component: 'system/users' },
      { title: '角色权限', name: 'sys-roles', path: '/system/roles', perm: 'role:view', component: 'system/roles' },
      { title: '漏斗配置', name: 'sys-stages', path: '/system/stages', perm: 'stage_config:view', component: 'system/stages' },
      { title: '审批流配置', name: 'sys-approval-flows', path: '/system/approval-flows', perm: 'approval:manage', component: 'system/approval-flows' },
      { title: '自定义字段', name: 'sys-custom-fields', path: '/system/custom-fields', perm: 'custom_field:view', component: 'system/custom-fields' },
      { title: '系统字典', name: 'sys-dictionaries', path: '/system/dictionaries', perm: 'dictionary:view', component: 'system/dictionaries' },
      { title: '报表模板', name: 'sys-report-templates', path: '/system/report-templates', perm: 'report_template:view', component: 'system/report-templates' },
      { title: '系统参数', name: 'sys-configs', path: '/system/configs', perm: 'system_config:view', component: 'system/configs' },
      { title: '登录方式', name: 'sys-login', path: '/system/login-config', perm: 'system_config:view', component: 'system/login-config' },
      { title: '数据备份', name: 'sys-backups', path: '/system/backups', perm: 'system_config:view', component: 'system/backups' },
      { title: '操作日志', name: 'sys-logs', path: '/system/logs', perm: 'operation_log:view', component: 'system/logs' },
      { title: '实施向导', name: 'sys-implementation', path: '/system/implementation', perm: 'system_config:manage', component: 'system/implementation' },
    ],
  },
]

/** 隐藏路由（详情页 / 表单页，不出现在菜单中） */
export const HIDDEN_ROUTES: MenuLeaf[] = [
  { title: '客户新建', name: 'customer-create', path: '/customers/new', perm: 'customer:create', component: 'customers/Edit' },
  { title: '客户编辑', name: 'customer-edit', path: '/customers/:id/edit', perm: 'customer:update', component: 'customers/Edit' },
  { title: '客户 360', name: 'customer-detail', path: '/customers/:id', perm: 'customer:view', component: 'customers/Detail' },
  { title: '线索新建', name: 'lead-create', path: '/leads/new', perm: 'lead:create', component: 'leads/Edit' },
  { title: '线索编辑', name: 'lead-edit', path: '/leads/:id/edit', perm: 'lead:update', component: 'leads/Edit' },
  { title: '线索详情', name: 'lead-detail', path: '/leads/:id', perm: 'lead:view', component: 'leads/Detail' },
  { title: '商机新建', name: 'opportunity-create', path: '/opportunities/new', perm: 'opportunity:create', component: 'opportunities/Edit' },
  { title: '商机编辑', name: 'opportunity-edit', path: '/opportunities/:id/edit', perm: 'opportunity:update', component: 'opportunities/Edit' },
  { title: '商机详情', name: 'opportunity-detail', path: '/opportunities/:id', perm: 'opportunity:view', component: 'opportunities/Detail' },
  { title: '消息通知中心', name: 'notifications', path: '/notifications', component: 'notifications/index' },
  { title: '报表设计', name: 'report-templates-design', path: '/system/report-templates/:id', perm: 'report_template:view', component: 'system/report-template-edit' },
  { title: '阶段编辑', name: 'sys-stage-detail', path: '/system/stages/:id', perm: 'stage_config:view', component: 'system/stage-edit' },
]
