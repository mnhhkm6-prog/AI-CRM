'use strict';

/**
 * 初始化种子数据（幂等：已存在则跳过）
 * 依据：PRD 11.2.16 默认角色权限、11.2.17 系统配置、3.2/4.1-4.4 默认漏斗、4.8.2 预置字典、
 *      第 9 章预置报表模板、4.10.3 出厂实施模板。
 */
const { db, migrate } = require('./index');
const { newId, now } = require('../utils/ids');
const { hashPassword } = require('../utils/password');
const { PERMISSIONS, ALL_CODES, SCOPED_RESOURCES } = require('../constants/permissions');

/** 演示账号统一初始密码（登录页 P01） */
const DEFAULT_PASSWORD = '123456';

// ---------------------------------------------------------------- 角色定义
const ROLE_DEFS = [
  {
    code: 'sales',
    name: '销售',
    sort: 10,
    perms: [
      'customer:view', 'customer:create', 'customer:update',
      'contact:view', 'contact:create', 'contact:update',
      'lead:view', 'lead:create', 'lead:update', 'lead:convert',
      'opportunity:view', 'opportunity:create', 'opportunity:update',
      'activity:view', 'activity:create', 'activity:update',
      'proposal:view', 'proposal:create', 'quotation:view', 'quotation:create',
      'competitor:view', 'competitor:create', 'contract:view', 'contract:create',
      'file:upload', 'file:view', 'sea:view', 'sea:pickup',
      'alert:view', // P22 停滞预警列表（仅本人数据，界面设计文档 2.3 默认菜单可见性）
      'report:view', // 支撑 M9-R4 销售个人报表
      'view:view', 'view:manage', // 支撑 M15-R1 个人视图配置（仅本人视图）
      'approval:view', // 审批中心：查看自己发起的审批
    ],
    scopes: { customer: 'self', lead: 'self', opportunity: 'self', activity: 'self', proposal: 'self', quotation: 'self', contract: 'self' },
  },
  {
    code: 'support',
    name: '业务支撑',
    sort: 20,
    perms: [
      'customer:view', 'customer:update', 'contact:view', 'contact:create', 'contact:update',
      'lead:view', 'opportunity:view', 'opportunity:update',
      'activity:view', 'activity:create', 'activity:update',
      'proposal:view', 'proposal:create', 'quotation:view', 'quotation:create',
      'competitor:view', 'competitor:create', 'contract:view', 'contract:create',
      'file:upload', 'file:view', 'sea:view', 'report:view', 'approval:view',
    ],
    scopes: { customer: 'all', lead: 'all', opportunity: 'all', activity: 'self', proposal: 'all', quotation: 'all', contract: 'all' },
  },
  {
    code: 'presales',
    name: '售前',
    sort: 30,
    perms: [
      'customer:view', 'contact:view', 'opportunity:view', 'opportunity:update',
      'activity:view', 'activity:create', 'proposal:view', 'proposal:create', 'proposal:update',
      'quotation:view', 'quotation:create', 'quotation:update',
      'competitor:view', 'competitor:create', 'file:upload', 'file:view', 'approval:view',
    ],
    scopes: { customer: 'custom', opportunity: 'custom', activity: 'self', proposal: 'self', quotation: 'self' },
  },
  {
    code: 'ecosystem',
    name: '生态',
    sort: 40,
    perms: [
      'customer:view', 'contact:view', 'opportunity:view', 'activity:view', 'activity:create',
      'competitor:view', 'file:view', 'file:upload', 'approval:view',
    ],
    scopes: { customer: 'custom', opportunity: 'custom', activity: 'self' },
  },
  {
    code: 'procurement',
    name: '采购',
    sort: 50,
    perms: [
      'proposal:view', 'quotation:view', 'quotation:create', 'quotation:update', 'competitor:view',
      'contract:view', 'contract:update', 'file:view', 'report:view', 'approval:view',
    ],
    scopes: { proposal: 'all', quotation: 'all', contract: 'all' },
  },
  {
    code: 'management',
    name: '管理层',
    sort: 60,
    perms: [
      'customer:view', 'customer:update', 'customer:delete', 'contact:view',
      'lead:view', 'lead:assign', 'lead:recycle', 'lead:convert',
      'opportunity:view', 'opportunity:update', 'opportunity:rollback', 'opportunity:create',
      'activity:view', 'activity:delete', 'proposal:view', 'quotation:view', 'competitor:view', 'contract:view',
      'file:view', 'sea:view', 'sea:pickup', 'sea:assign', 'sea:manage',
      'alert:view', 'alert:manage', 'loss:view', 'loss:update', 'loss:approve',
      'report:view', 'report:export', 'view:view', 'view:manage', 'report_template:view', 'user:view',
      'approval:view', 'approval:approve', 'approval:manage',
    ],
    scopes: { customer: 'all', lead: 'all', opportunity: 'all', activity: 'all', proposal: 'all', quotation: 'all', contract: 'all' },
  },
  {
    code: 'hr',
    name: '人事',
    sort: 70,
    perms: ['user:view', 'report:view'],
    scopes: {},
  },
  {
    code: 'system_admin',
    name: '系统管理员',
    sort: 99,
    perms: ALL_CODES,
    scopes: Object.fromEntries(SCOPED_RESOURCES.map((r) => [r, 'all'])),
  },
];

// ---------------------------------------------------------------- 系统配置
const SYSTEM_CONFIGS = [
  { key: 'stale_alert_level1_days', value: '7', group: 'alert', type: 'number', desc: '一级预警阈值（天）' },
  { key: 'stale_alert_level2_days', value: '14', group: 'alert', type: 'number', desc: '二级预警阈值（天）' },
  { key: 'stale_alert_level3_days', value: '21', group: 'alert', type: 'number', desc: '三级预警阈值（天）' },
  { key: 'sea_fallback_days_after_alert', value: '7', group: 'sea', type: 'number', desc: '三级预警后回落公海缓冲天数' },
  { key: 'sea_personal_max', value: '20', group: 'sea', type: 'number', desc: '公海个人商机上限' },
  { key: 'sea_daily_pickup_max', value: '5', group: 'sea', type: 'number', desc: '公海每日领取上限' },
  { key: 'sea_protection_days', value: '3', group: 'sea', type: 'number', desc: '公海保护期天数' },
  { key: 'lead_unconverted_recycle_days', value: '60', group: 'sea', type: 'number', desc: '线索未转化回收天数' },
  { key: 'sea_pickup_mode', value: 'true', group: 'sea', type: 'boolean', desc: '是否开启公海自主领取模式' },
  { key: 'company_name', value: '示例科技有限公司', group: 'system', type: 'string', desc: '企业名称' },
  { key: 'login_mode', value: 'password', group: 'system', type: 'string', desc: '登录方式：password / ad_ldap' },
];

// ---------------------------------------------------------------- 默认漏斗（PRD 3.2 / 4.1–4.4）
const STAGE_DEFS = [
  {
    code: 'S0', name: '客户数据录入', sort: 10, system: 1,
    entry: '各渠道获取客户信息', deliverables: '客户信息', roles: ['sales'],
    // 起点阶段门槛低，使用更短的停滞阈值，让占位商机尽快暴露
    thresholds: { level1: 3, level2: 5, level3: 7 },
    rules: [],
  },
  {
    code: 'S1', name: '客户触达', sort: 20,
    entry: '确认客户主体真实，有初步业务诉求', deliverables: '客户背景调研资料、需求描述', roles: ['sales', 'support', 'management'],
    rules: [
      { name: '客户背景调研', key: 'customer_background', type: 'text', required: 1 },
      { name: '需求业务类型', key: 'demand_biz_types', type: 'multi_select', required: 1, options: 'product_type' },
      { name: '预期成交日期', key: 'expected_close_date', type: 'date', required: 1 },
      { name: '客户预算', key: 'customer_budget', type: 'amount', required: 0 },
      { name: '需求描述', key: 'demand_desc', type: 'textarea', required: 1 },
      { name: '售前行为记录', key: 'sys:activity', type: 'relation', required: 1, tip: '至少 1 条行为记录' },
    ],
  },
  {
    code: 'S2', name: '需求匹配与方案制定', sort: 30,
    entry: '客户表达明确项目意向，有初步预算', deliverables: '初步方案、产品价格记录、竞争对手档案', roles: ['sales', 'presales', 'ecosystem', 'procurement', 'management'],
    rules: [
      { name: '售前跟单行为记录', key: 'sys:activity', type: 'relation', required: 1, tip: '至少 1 条行为记录' },
      { name: '需求调研完成', key: 'demand_survey_done', type: 'boolean', required: 1 },
      { name: '真实需求清单', key: 'real_demand_list', type: 'textarea', required: 1 },
      { name: '初步方案', key: 'sys:proposal_preliminary', type: 'attachment', required: 1, tip: '需上传初步方案附件' },
      { name: '竞争对手', key: 'competitor_name', type: 'text', required: 1 },
      { name: '初步产品价格记录', key: 'sys:product_price', type: 'relation', required: 1, tip: '至少 1 条产品价格记录' },
    ],
  },
  {
    code: 'S3', name: '方案确定与跟进', sort: 40,
    entry: '需求清单获得客户确认', deliverables: '正式方案、最终报价', roles: ['sales', 'support', 'procurement', 'ecosystem', 'management'],
    rules: [
      { name: '售前跟单行为记录', key: 'sys:activity', type: 'relation', required: 1, tip: '至少 1 条行为记录' },
      { name: '正式方案', key: 'sys:proposal_formal', type: 'attachment', required: 1, tip: '需上传正式方案附件' },
      { name: '最终报价', key: 'sys:quotation_final', type: 'attachment', required: 1, tip: '需上传最终报价' },
      { name: '客户价格诉求', key: 'customer_price_demand', type: 'text', required: 1 },
      { name: '比价与测试', key: 'compare_test_done', type: 'boolean', required: 1 },
    ],
  },
  {
    code: 'S4', name: '合同推进', sort: 50,
    entry: '客户认可方案及报价，同意商务谈判', deliverables: '合同', roles: ['sales', 'support', 'presales', 'procurement', 'management'],
    rules: [
      { name: '售前跟单行为记录', key: 'sys:activity', type: 'relation', required: 1, tip: '至少 1 条行为记录' },
      { name: '合同文件', key: 'sys:contract', type: 'attachment', required: 1, tip: '需上传合同附件' },
      { name: '合同金额', key: 'sys:contract_amount', type: 'amount', required: 1 },
      { name: '合同签订日期', key: 'sys:contract_signed_date', type: 'date', required: 1 },
    ],
  },
  { code: 'WIN', name: '赢单关闭', sort: 90, system: 1, terminal: 1, terminalType: 'win', entry: '合同签订完毕', deliverables: '归档客户、商机、合同信息', roles: ['sales', 'support'], rules: [] },
  { code: 'LOSS', name: '已失效', sort: 91, system: 1, terminal: 1, terminalType: 'loss', entry: '失效审批通过', deliverables: '失效记录', roles: ['sales', 'management'], rules: [] },
];

/** 阶段固定动作引用的商机自定义字段（PRD 4.1–4.4 必填参数表） */
const OPPORTUNITY_FIELDS = [
  { code: 'customer_background', name: '客户背景调研', type: 'text', required: 1 },
  { code: 'demand_biz_types', name: '需求业务类型', type: 'multi_select', required: 1, options: 'product_type' },
  { code: 'customer_budget', name: '客户预算', type: 'amount', required: 0 },
  { code: 'demand_desc', name: '需求描述', type: 'textarea', required: 1 },
  { code: 'demand_survey_done', name: '需求调研完成', type: 'boolean', required: 1 },
  { code: 'real_demand_list', name: '真实需求清单', type: 'textarea', required: 1 },
  { code: 'competitor_name', name: '竞争对手', type: 'text', required: 1 },
  { code: 'customer_price_demand', name: '客户价格诉求', type: 'text', required: 1 },
  { code: 'compare_test_done', name: '比价与测试', type: 'boolean', required: 1 },
];

/** 客户出厂默认自定义字段（H1 方案：业务诉求走自定义字段） */
const CUSTOMER_FIELDS = [
  { code: 'biz_needs', name: '业务诉求', type: 'textarea', required: 0 },
];

// ---------------------------------------------------------------- 默认字典（PRD 4.8.2）
const DICT_DEFS = [
  { code: 'lead_source_channel', name: '线索来源渠道', items: ['电话', '展会', '线上推广', '转介绍', '其他'], module: '4.1 线索录入' },
  { code: 'opportunity_loss_reason', name: '商机失败原因', items: ['价格过高', '方案不匹配', '客户预算不足', '竞争对手胜出', '客户项目暂停', '其他'], module: '4.5 商机失效' },
  { code: 'customer_industry', name: '客户行业', items: ['互联网', '制造业', '金融', '政府', '教育', '医疗', '其他'], module: '客户管理' },
  { code: 'customer_scale', name: '客户规模', items: ['微型', '小型', '中型', '大型', '集团'], module: '客户管理' },
  {
    code: 'product_type',
    name: '产品类型',
    items: ['上网链路', '数据专线', 'IDC', '云计算', '数据中台', '软件定制', '定制项目'],
    module: '4.2 初步方案',
  },
  { code: 'activity_type', name: '行动类型', items: ['电话沟通', '线下拜访', '邮件往来', '微信沟通', '其他'], module: '4.1 售前行为记录' },
];

// ---------------------------------------------------------------- 预置报表模板（PRD 第 9 章）
const REPORT_TEMPLATES = [
  {
    name: '销售漏斗报表', type: 'funnel', source: 'opportunities',
    dimensions: ['stage_name_snapshot'], metrics: ['count', 'amount'],
    chart: 'funnel', filter: { date_field: 'created_at' },
  },
  {
    name: '停滞预警复盘', type: 'stagnation', source: 'stale_alerts',
    dimensions: ['stage_name_snapshot', 'alert_level'], metrics: ['count'],
    chart: 'bar', filter: {},
  },
  {
    name: '失效原因分析', type: 'loss', source: 'loss_records',
    dimensions: ['loss_reason'], metrics: ['count', 'amount'],
    chart: 'pie', filter: {},
  },
  {
    name: '销售个人业绩报表', type: 'personal', source: 'opportunities',
    dimensions: ['owner_id', 'stage_name_snapshot'], metrics: ['count', 'amount'],
    chart: 'table', filter: {},
  },
  {
    name: '团队业绩报表', type: 'team', source: 'opportunities',
    dimensions: ['department', 'stage_name_snapshot'], metrics: ['count', 'amount'],
    chart: 'bar', filter: {},
  },
];

// ---------------------------------------------------------------- 工具
const exists = (table, col, val) => !!db.prepare(`SELECT id FROM ${table} WHERE ${col} = ?`).get(val);

function bump(table, col, val, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE ${table} SET ${sets} WHERE ${col} = @__v`).run({ ...fields, __v: val });
}

// ---------------------------------------------------------------- 各域种子
function seedPermissions() {
  const ins = db.prepare(
    'INSERT INTO permissions (id, code, name, module, action, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  PERMISSIONS.forEach((p, i) => {
    if (!exists('permissions', 'code', p.code)) ins.run(newId(), p.code, p.name, p.module, p.action, (i + 1) * 10);
  });
}

function seedRoles() {
  const ins = db.prepare(
    `INSERT INTO roles (id, role_code, role_name, role_type, description, sort_order, is_system, is_enabled, created_at, updated_at)
     VALUES (@id, @code, @name, 'system', @desc, @sort, 1, 1, @t, @t)`
  );
  ROLE_DEFS.forEach((r) => {
    if (!exists('roles', 'role_code', r.code)) {
      ins.run({ id: newId(), code: r.code, name: r.name, desc: `${r.name}（系统预置角色）`, sort: r.sort, t: now() });
    } else {
      // 预置角色权限可能随版本升级，这里同步最新定义
      const role = db.prepare('SELECT * FROM roles WHERE role_code = ?').get(r.code);
      bump('roles', 'id', role.id, { role_name: r.name, sort_order: r.sort, updated_at: now() });
    }
  });

  const insPerm = db.prepare(
    `INSERT INTO role_permissions (id, role_id, permission_code, permission_type, data_scope, resource_type, scope_config_json, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const t = now();
  ROLE_DEFS.forEach((r) => {
    const role = db.prepare('SELECT * FROM roles WHERE role_code = ?').get(r.code);
    // 已有权限配置说明管理员可能已在界面上调整过，不再覆盖
    const bound = db.prepare('SELECT COUNT(*) c FROM role_permissions WHERE role_id = ?').get(role.id).c;
    if (bound > 0) return;
    r.perms.forEach((code) => insPerm.run(newId(), role.id, code, 'function', null, null, null, t, t));
    Object.entries(r.scopes).forEach(([resource, scope]) => {
      const cfg = scope === 'custom' ? JSON.stringify({ collaborated: true, include_self: true }) : null;
      insPerm.run(newId(), role.id, `data_scope:${resource}`, 'data', scope, resource, cfg, t, t);
    });
  });

  // 审批为新增能力：仅补齐缺失的 approval:* 权限，不影响管理员对既有权限的调整
  ROLE_DEFS.forEach((r) => {
    const role = db.prepare('SELECT * FROM roles WHERE role_code = ?').get(r.code);
    r.perms.filter((code) => code.startsWith('approval:')).forEach((code) => {
      const boundPerm = db
        .prepare('SELECT id FROM role_permissions WHERE role_id = ? AND permission_code = ?')
        .get(role.id, code);
      if (!boundPerm) insPerm.run(newId(), role.id, code, 'function', null, null, null, t, t);
    });
  });

  // 行为记录删除为新增能力：仅补齐缺失的 activity:delete，不影响既有权限调整
  ROLE_DEFS.forEach((r) => {
    if (!r.perms.includes('activity:delete')) return;
    const role = db.prepare('SELECT * FROM roles WHERE role_code = ?').get(r.code);
    const boundPerm = db
      .prepare('SELECT id FROM role_permissions WHERE role_id = ? AND permission_code = ?')
      .get(role.id, 'activity:delete');
    if (!boundPerm) insPerm.run(newId(), role.id, 'activity:delete', 'function', null, null, null, t, t);
  });

  // 行为记录可见性一次性修正（v1）：普通角色仅可见本人记录，管理者可见全部
  const visibilityDone = db
    .prepare("SELECT id FROM system_configs WHERE config_key = 'activity_visibility_scope_v1'")
    .get();
  if (!visibilityDone) {
    const insScope = db.prepare(
      `INSERT INTO role_permissions (id, role_id, permission_code, permission_type, data_scope, resource_type, scope_config_json, is_enabled, created_at, updated_at)
       VALUES (?, ?, 'data_scope:activity', 'data', 'self', 'activity', NULL, 1, ?, ?)`
    );
    ['sales', 'support', 'presales', 'ecosystem'].forEach((code) => {
      const role = db.prepare('SELECT id FROM roles WHERE role_code = ?').get(code);
      if (!role) return;
      const bound = db
        .prepare("SELECT id FROM role_permissions WHERE role_id = ? AND permission_code = 'data_scope:activity'")
        .get(role.id);
      if (bound) {
        db.prepare(
          "UPDATE role_permissions SET data_scope = 'self', scope_config_json = NULL, updated_at = ? WHERE id = ?"
        ).run(t, bound.id);
      } else {
        insScope.run(newId(), role.id, t, t);
      }
    });
    db.prepare(
      `INSERT INTO system_configs (id, config_key, config_value, config_group, value_type, description, created_at, updated_at)
       VALUES (?, 'activity_visibility_scope_v1', 'done', 'system', 'string', '行为记录可见性修正标记', ?, ?)`
    ).run(newId(), t, t);
  }
}

/** 预置审批流（仅在从未配置过任何流程时写入，避免删掉后每次启动重建） */
function seedApprovalFlows() {
  if (db.prepare('SELECT COUNT(*) c FROM approval_flows').get().c > 0) return;
  const t = now();
  const insFlow = db.prepare(
    `INSERT INTO approval_flows (id, name, biz_type, description, priority, is_enabled, conditions_json, version, created_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, 1, NULL, 0, ?, ?)`
  );
  const insNode = db.prepare(
    `INSERT INTO approval_flow_nodes (id, flow_id, node_name, sort_order, node_type, approve_mode, approver_type, approver_values, timeout_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'approval', ?, ?, ?, NULL, ?, ?)`
  );

  const quotationFlowId = newId();
  insFlow.run(
    quotationFlowId, '报价折扣审批', 'quotation', '报价低于商机金额 9 折时，需管理层审批',
    10, JSON.stringify([{ field: 'discount_rate', op: '<', value: 0.9 }]), t, t
  );
  insNode.run(newId(), quotationFlowId, '管理层审批', 10, 'any', 'role', JSON.stringify(['management']), t, t);

  const contractFlowId = newId();
  insFlow.run(
    contractFlowId, '大额合同审批', 'contract', '合同金额达到 50 万时，需管理层审批',
    10, JSON.stringify([{ field: 'amount', op: '>=', value: 500000 }]), t, t
  );
  insNode.run(newId(), contractFlowId, '管理层审批', 10, 'any', 'role', JSON.stringify(['management']), t, t);
}

function seedDepartments() {
  const ins = db.prepare(
    'INSERT INTO departments (id, name, parent_id, sort_order, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  );
  if (exists('departments', 'name', '总部')) return db.prepare("SELECT * FROM departments WHERE name = '总部'").get();
  const t = now();
  const rootId = newId();
  ins.run(rootId, '总部', null, 1, t, t);
  ['销售部', '业务支撑部', '售前部', '生态合作部', '采购部', '人事部'].forEach((name, i) => {
    ins.run(newId(), name, rootId, (i + 2) * 10, t, t);
  });
  return db.prepare('SELECT * FROM departments WHERE name = ?').get('总部');
}

function seedUsers() {
  const dept = (name) => {
    const d = db.prepare('SELECT id FROM departments WHERE name = ?').get(name);
    return d ? d.id : null;
  };
  const roleId = (code) => {
    const r = db.prepare('SELECT id FROM roles WHERE role_code = ?').get(code);
    return r ? r.id : null;
  };
  const defs = [
    { username: 'admin', name: '系统管理员', role: 'system_admin', dept: null, email: 'admin@example.com' },
    { username: 'sales01', name: '张销售', role: 'sales', dept: '销售部', email: 'sales01@example.com' },
    { username: 'support01', name: '李支撑', role: 'support', dept: '业务支撑部', email: 'support01@example.com' },
    { username: 'presales01', name: '王售前', role: 'presales', dept: '售前部', email: 'presales01@example.com' },
    { username: 'ecosystem01', name: '赵生态', role: 'ecosystem', dept: '生态合作部', email: 'ecosystem01@example.com' },
    { username: 'purchase01', name: '孙采购', role: 'procurement', dept: '采购部', email: 'purchase01@example.com' },
    { username: 'manager01', name: '周经理', role: 'management', dept: '总部', email: 'manager01@example.com' },
    { username: 'hr01', name: '吴人事', role: 'hr', dept: '人事部', email: 'hr01@example.com' },
  ];
  const ins = db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role_id, department_id, phone, email, status, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled', 0, ?, ?)`
  );
  const t = now();
  const defaultHash = hashPassword(DEFAULT_PASSWORD);
  defs.forEach((u) => {
    if (!exists('users', 'username', u.username)) {
      ins.run(newId(), u.username, u.name, defaultHash, roleId(u.role), dept(u.dept), null, u.email, t, t);
    } else {
      // 兼容历史库：已存在但未设密码的演示账号补默认密码
      const row = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(u.username);
      if (row && !row.password_hash) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(defaultHash, row.id);
      }
    }
  });
}

function seedSystemConfigs() {
  const ins = db.prepare(
    `INSERT INTO system_configs (id, config_key, config_value, config_group, value_type, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const t = now();
  SYSTEM_CONFIGS.forEach((c) => {
    if (!exists('system_configs', 'config_key', c.key)) {
      ins.run(newId(), c.key, c.value, c.group, c.type, c.desc, t, t);
    }
  });
}

function seedCustomFields() {
  const ins = db.prepare(
    `INSERT INTO custom_field_definitions
      (id, entity_type, field_code, field_name, field_type, is_required, options, field_group, sort_order, is_enabled, is_list_visible, is_dup_check, is_system, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 1, 0, ?, ?)`
  );
  const t = now();
  const add = (entityType, f, i, group) => {
    const dup = db.prepare('SELECT id FROM custom_field_definitions WHERE entity_type = ? AND field_code = ?').get(entityType, f.code);
    if (dup) return;
    ins.run(newId(), entityType, f.code, f.name, f.type, f.required, f.options ? JSON.stringify([f.options]) : null, group, (i + 1) * 10, t, t);
  };
  OPPORTUNITY_FIELDS.forEach((f, i) => add('opportunity', f, i, '阶段固定动作'));
  CUSTOMER_FIELDS.forEach((f, i) => add('customer', f, i, '基础扩展'));
}

function seedStageConfigs() {
  const insStage = db.prepare(
    `INSERT INTO stage_configs
      (id, code, name, description, sort_order, is_enabled, is_terminal, terminal_type, entry_condition, deliverables, roles_json, alert_thresholds, version, is_system, created_at, updated_at)
     VALUES (@id, @code, @name, @desc, @sort, 1, @terminal, @terminalType, @entry, @deliverables, @roles, @thresholds, 1, @system, @t, @t)`
  );
  const insRule = db.prepare(
    `INSERT INTO stage_action_rules
      (id, stage_config_id, action_name, field_key, field_type, is_required, options, tip, sort_order, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const insLog = db.prepare(
    `INSERT INTO stage_config_change_logs (id, stage_config_id, action, after_snapshot, changed_by, version_after, created_at)
     VALUES (?, ?, 'create', ?, ?, 1, ?)`
  );
  const t = now();
  STAGE_DEFS.forEach((s) => {
    let stage = db.prepare('SELECT * FROM stage_configs WHERE code = ?').get(s.code);
    if (!stage) {
      const id = newId();
      insStage.run({
        id, code: s.code, name: s.name, desc: `${s.name}（出厂默认配置）`, sort: s.sort,
        terminal: s.terminal || 0, terminalType: s.terminalType || null,
        entry: s.entry || null, deliverables: s.deliverables || null,
        roles: JSON.stringify(s.roles || []),
        thresholds: s.thresholds ? JSON.stringify(s.thresholds) : null,
        system: s.system || 0, t,
      });
      insLog.run(newId(), id, JSON.stringify({ code: s.code, name: s.name }), 'system', t);
      stage = db.prepare('SELECT * FROM stage_configs WHERE code = ?').get(s.code);
    }
    if (!s.rules || !s.rules.length) return;
    const hasRules = db.prepare('SELECT COUNT(*) c FROM stage_action_rules WHERE stage_config_id = ?').get(stage.id).c;
    if (hasRules > 0) return;
    s.rules.forEach((r, i) => {
      let options = null;
      if (r.options) {
        const dict = db.prepare('SELECT id FROM dictionary_types WHERE dict_code = ?').get(r.options);
        if (dict) {
          const items = db.prepare('SELECT item_name FROM dictionary_items WHERE dict_type_id = ? AND is_deleted = 0 ORDER BY sort_order').all(dict.id);
          options = JSON.stringify(items.map((x) => x.item_name));
        }
      }
      insRule.run(newId(), stage.id, r.name, r.key, r.type, r.required, options, r.tip || null, (i + 1) * 10, t, t);
    });
  });

  // 新建库：阶段固定动作生成后，把商机自定义字段回填到所属阶段
  db.exec(`
    UPDATE custom_field_definitions
    SET stage_config_id = (
      SELECT r.stage_config_id
      FROM stage_action_rules r
      JOIN stage_configs s ON s.id = r.stage_config_id
      WHERE r.field_key = custom_field_definitions.field_code
      ORDER BY s.sort_order
      LIMIT 1
    )
    WHERE entity_type = 'opportunity'
      AND (stage_config_id IS NULL OR stage_config_id = '')
      AND EXISTS (SELECT 1 FROM stage_action_rules r WHERE r.field_key = custom_field_definitions.field_code)
  `);
}

function seedDictionaries() {
  const insType = db.prepare(
    `INSERT INTO dictionary_types (id, dict_code, dict_name, category, description, is_system, is_enabled, version, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, 1, 0, ?, ?)`
  );
  const insItem = db.prepare(
    `INSERT INTO dictionary_items (id, dict_type_id, item_code, item_name, sort_order, is_default, is_enabled, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  );
  const t = now();
  DICT_DEFS.forEach((d) => {
    if (exists('dictionary_types', 'dict_code', d.code)) return;
    const id = newId();
    insType.run(id, d.code, d.name, d.code, d.module, t, t);
    d.items.forEach((item, i) => insItem.run(newId(), id, `item_${i + 1}`, item, (i + 1) * 10, i === 0 ? 1 : 0, t, t));
  });
}

function seedViews() {
  const ins = db.prepare(
    `INSERT INTO view_configs (id, view_name, entity_type, view_type, scope, columns, default_filter, default_sort, is_system, is_default, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, 'default', ?, ?, ?, ?, 1, ?, 0, ?, ?)`
  );
  const t = now();
  const defs = [
    { name: '我的客户', entity: 'customer', scope: 'self', cols: ['name', 'type', 'industry', 'level', 'owner_id', 'last_activity_at'], sort: { field: 'created_at', order: 'desc' }, def: 1 },
    { name: '全部客户', entity: 'customer', scope: 'all', cols: ['name', 'type', 'industry', 'level', 'owner_id', 'created_at'], sort: { field: 'created_at', order: 'desc' }, def: 0 },
    { name: '我的线索', entity: 'lead', scope: 'self', cols: ['name', 'source_channel', 'status', 'owner_id', 'created_at'], sort: { field: 'created_at', order: 'desc' }, def: 1 },
    { name: '我的商机', entity: 'opportunity', scope: 'self', cols: ['name', 'customer_id', 'stage_name_snapshot', 'amount', 'expected_close_date', 'last_activity_at'], sort: { field: 'created_at', order: 'desc' }, def: 1 },
    { name: '全部商机', entity: 'opportunity', scope: 'all', cols: ['name', 'customer_id', 'stage_name_snapshot', 'amount', 'owner_id', 'status'], sort: { field: 'created_at', order: 'desc' }, def: 0 },
    { name: '我的行为记录', entity: 'activity', scope: 'self', cols: ['opportunity_id', 'activity_type', 'activity_time', 'content', 'follow_up_time'], sort: { field: 'activity_time', order: 'desc' }, def: 1 },
  ];
  defs.forEach((v) => {
    const dup = db.prepare('SELECT id FROM view_configs WHERE view_name = ? AND entity_type = ?').get(v.name, v.entity);
    if (dup) return;
    ins.run(newId(), v.name, v.entity, v.scope, JSON.stringify(v.cols), JSON.stringify([]), JSON.stringify(v.sort), v.def, t, t);
  });
}

function seedReportTemplates() {
  const ins = db.prepare(
    `INSERT INTO report_templates (id, template_name, template_type, data_source, dimensions, metrics, chart_type, filter_config, is_system, is_enabled, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`
  );
  const t = now();
  REPORT_TEMPLATES.forEach((r) => {
    if (exists('report_templates', 'template_name', r.name)) return;
    ins.run(newId(), r.name, r.type, r.source, JSON.stringify(r.dimensions), JSON.stringify(r.metrics), r.chart, JSON.stringify(r.filter), t, t);
  });
}

/** 导出当前配置为一份模板包（M16-R2 复用） */
function buildTemplateConfig() {
  return {
    stage_configs: db.prepare('SELECT * FROM stage_configs ORDER BY sort_order').all(),
    stage_action_rules: db.prepare('SELECT * FROM stage_action_rules ORDER BY stage_config_id, sort_order').all(),
    custom_field_definitions: db.prepare('SELECT * FROM custom_field_definitions WHERE is_deleted = 0').all(),
    roles: db.prepare('SELECT * FROM roles').all()
      .map((r) => ({ role_code: r.role_code, role_name: r.role_name, sort_order: r.sort_order, is_system: r.is_system })),
    role_permissions: db.prepare('SELECT * FROM role_permissions').all(),
    dictionary_types: db.prepare('SELECT * FROM dictionary_types WHERE is_deleted = 0').all(),
    dictionary_items: db.prepare('SELECT * FROM dictionary_items WHERE is_deleted = 0').all(),
    view_configs: db.prepare('SELECT * FROM view_configs WHERE is_deleted = 0').all(),
    report_templates: db.prepare('SELECT * FROM report_templates WHERE is_deleted = 0').all(),
    system_configs: db.prepare('SELECT * FROM system_configs').all(),
  };
}

function seedImplementationTemplate() {
  if (exists('implementation_templates', 'template_name', '出厂默认模板')) return;
  db.prepare(
    `INSERT INTO implementation_templates (id, template_name, template_version, description, is_system, config_data, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?)`
  ).run(newId(), '出厂默认模板', '1.0.0', '我司 PPT 四阶段漏斗 + 预置字段/角色/字典/视图/报表配置', JSON.stringify(buildTemplateConfig()), now(), now());
}

function seedWizardState() {
  const row = db.prepare('SELECT id FROM implementation_wizard_state LIMIT 1').get();
  if (row) return;
  db.prepare(
    `INSERT INTO implementation_wizard_state (id, step, mode, payload, status, created_at, updated_at)
     VALUES (?, 'basic', 'default', '{}', 'draft', ?, ?)`
  ).run(newId(), now(), now());
}

function seedAll() {
  migrate();
  seedPermissions();
  seedRoles();
  seedApprovalFlows();
  seedDepartments();
  seedUsers();
  seedSystemConfigs();
  seedDictionaries();
  seedCustomFields();
  seedStageConfigs();
  seedViews();
  seedReportTemplates();
  seedImplementationTemplate();
  seedWizardState();
}

module.exports = { seedAll, buildTemplateConfig, STAGE_DEFS, SYSTEM_CONFIGS, DICT_DEFS };
