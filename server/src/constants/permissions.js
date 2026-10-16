'use strict';

/**
 * 权限点全量清单（功能权限）
 * 命名规范：<资源>:<动作>；数据权限范围在 role_permissions.data_scope 中单独定义。
 */
const PERMISSIONS = [
  // M1 客户管理
  { code: 'customer:view', name: '客户查看', module: 'M1', action: 'view' },
  { code: 'customer:create', name: '客户新增', module: 'M1', action: 'create' },
  { code: 'customer:update', name: '客户编辑', module: 'M1', action: 'update' },
  { code: 'customer:delete', name: '客户删除', module: 'M1', action: 'delete' },
  { code: 'contact:view', name: '联系人查看', module: 'M1', action: 'view' },
  { code: 'contact:create', name: '联系人新增', module: 'M1', action: 'create' },
  { code: 'contact:update', name: '联系人编辑', module: 'M1', action: 'update' },
  { code: 'contact:delete', name: '联系人删除', module: 'M1', action: 'delete' },
  // M2 线索管理
  { code: 'lead:view', name: '线索查看', module: 'M2', action: 'view' },
  { code: 'lead:create', name: '线索新增', module: 'M2', action: 'create' },
  { code: 'lead:update', name: '线索编辑', module: 'M2', action: 'update' },
  { code: 'lead:delete', name: '线索删除', module: 'M2', action: 'delete' },
  { code: 'lead:assign', name: '线索分配', module: 'M2', action: 'assign' },
  { code: 'lead:convert', name: '线索转商机', module: 'M2', action: 'convert' },
  { code: 'lead:recycle', name: '线索回收', module: 'M2', action: 'recycle' },
  // M3 商机管理
  { code: 'opportunity:view', name: '商机查看', module: 'M3', action: 'view' },
  { code: 'opportunity:create', name: '商机新增', module: 'M3', action: 'create' },
  { code: 'opportunity:update', name: '商机编辑/推进', module: 'M3', action: 'update' },
  { code: 'opportunity:delete', name: '商机删除', module: 'M3', action: 'delete' },
  { code: 'opportunity:rollback', name: '阶段回退', module: 'M3', action: 'rollback' },
  // M4 销售行为记录
  { code: 'activity:view', name: '行为记录查看', module: 'M4', action: 'view' },
  { code: 'activity:create', name: '行为记录新增', module: 'M4', action: 'create' },
  { code: 'activity:update', name: '行为记录编辑', module: 'M4', action: 'update' },
  { code: 'activity:delete', name: '行为记录删除', module: 'M4', action: 'delete' },
  // M5 方案与报价管理
  { code: 'file:upload', name: '附件上传', module: 'M5', action: 'upload' },
  { code: 'file:view', name: '附件查看/下载', module: 'M5', action: 'view' },
  { code: 'proposal:view', name: '方案查看', module: 'M5', action: 'view' },
  { code: 'proposal:create', name: '方案上传', module: 'M5', action: 'create' },
  { code: 'proposal:update', name: '方案编辑', module: 'M5', action: 'update' },
  { code: 'proposal:delete', name: '方案删除', module: 'M5', action: 'delete' },
  { code: 'quotation:view', name: '报价查看', module: 'M5', action: 'view' },
  { code: 'quotation:create', name: '报价新增', module: 'M5', action: 'create' },
  { code: 'quotation:update', name: '报价编辑', module: 'M5', action: 'update' },
  { code: 'quotation:delete', name: '报价删除', module: 'M5', action: 'delete' },
  { code: 'competitor:view', name: '竞争对手查看', module: 'M5', action: 'view' },
  { code: 'competitor:create', name: '竞争对手新增', module: 'M5', action: 'create' },
  { code: 'competitor:update', name: '竞争对手编辑', module: 'M5', action: 'update' },
  { code: 'competitor:delete', name: '竞争对手删除', module: 'M5', action: 'delete' },
  { code: 'contract:view', name: '合同查看', module: 'M5', action: 'view' },
  { code: 'contract:create', name: '合同新增', module: 'M5', action: 'create' },
  { code: 'contract:update', name: '合同编辑', module: 'M5', action: 'update' },
  { code: 'contract:delete', name: '合同删除', module: 'M5', action: 'delete' },
  // M6 公海管理
  { code: 'sea:view', name: '公海查看', module: 'M6', action: 'view' },
  { code: 'sea:pickup', name: '公海领取', module: 'M6', action: 'pickup' },
  { code: 'sea:assign', name: '公海分配', module: 'M6', action: 'assign' },
  { code: 'sea:manage', name: '公海管理', module: 'M6', action: 'manage' },
  // M7 停滞预警
  { code: 'alert:view', name: '预警查看', module: 'M7', action: 'view' },
  { code: 'alert:manage', name: '预警处理/审批', module: 'M7', action: 'manage' },
  // M8 商机失效
  { code: 'loss:view', name: '失效记录查看', module: 'M8', action: 'view' },
  { code: 'loss:update', name: '失效记录维护', module: 'M8', action: 'update' },
  { code: 'loss:approve', name: '失效审批', module: 'M8', action: 'approve' },
  // M9 报表复盘
  { code: 'report:view', name: '报表查看', module: 'M9', action: 'view' },
  { code: 'report:export', name: '报表导出', module: 'M9', action: 'export' },
  // M10 系统管理与权限
  { code: 'user:view', name: '用户查看', module: 'M10', action: 'view' },
  { code: 'user:manage', name: '用户管理', module: 'M10', action: 'manage' },
  { code: 'system_config:view', name: '系统配置查看', module: 'M10', action: 'view' },
  { code: 'system_config:manage', name: '系统配置管理', module: 'M10', action: 'manage' },
  { code: 'operation_log:view', name: '操作日志查看', module: 'M10', action: 'view' },
  { code: 'system_backup:manage', name: '数据备份恢复', module: 'M10', action: 'manage' },
  // M11 漏斗配置管理
  { code: 'stage_config:view', name: '漏斗配置查看', module: 'M11', action: 'view' },
  { code: 'stage_config:manage', name: '漏斗配置管理', module: 'M11', action: 'manage' },
  // M12 自定义字段管理
  { code: 'custom_field:view', name: '自定义字段查看', module: 'M12', action: 'view' },
  { code: 'custom_field:manage', name: '自定义字段管理', module: 'M12', action: 'manage' },
  // M13 角色与权限配置管理
  { code: 'role:view', name: '角色权限查看', module: 'M13', action: 'view' },
  { code: 'role:manage', name: '角色权限管理', module: 'M13', action: 'manage' },
  // M14 系统字典管理
  { code: 'dictionary:view', name: '字典查看', module: 'M14', action: 'view' },
  { code: 'dictionary:manage', name: '字典管理', module: 'M14', action: 'manage' },
  // M15 视图与报表配置
  { code: 'view:view', name: '视图查看', module: 'M15', action: 'view' },
  { code: 'view:manage', name: '视图管理', module: 'M15', action: 'manage' },
  { code: 'report_template:view', name: '报表模板查看', module: 'M15', action: 'view' },
  { code: 'report_template:manage', name: '报表模板管理', module: 'M15', action: 'manage' },
];

const ALL_CODES = PERMISSIONS.map((p) => p.code);

/** 数据权限可过滤资源（其余资源不做数据范围过滤） */
const SCOPED_RESOURCES = ['customer', 'lead', 'opportunity', 'activity', 'proposal', 'quotation', 'contract'];

module.exports = { PERMISSIONS, ALL_CODES, SCOPED_RESOURCES };
