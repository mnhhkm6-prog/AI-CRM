-- ============================================================
-- 自研 CRM 系统 - SQLite 结构定义
-- 依据：PRD 第 11 章（实体模型）+ docs/后端API接口清单.md 第二节
-- 约定：主键统一 UUID 文本；时间统一 ISO8601 文本；金额单位为元（REAL）；
--      主数据使用 is_deleted 软删；日志/历史/失效记录不可删除。
--      外键关系在服务层校验（不启用 SQLite 外键约束），便于软删与导入导出。
-- ============================================================

-- ---------- 组织与账号 ----------
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  role_id TEXT,
  department_id TEXT,
  phone TEXT,
  email TEXT,
  status TEXT DEFAULT 'enabled',          -- enabled / disabled
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- ---------- 权限体系 ----------
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  role_type TEXT DEFAULT 'custom',        -- system / custom
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_system INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  module TEXT,                            -- M1..M16
  action TEXT,                            -- view/create/update/delete/manage/export/approve...
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  permission_type TEXT NOT NULL,          -- function / data
  data_scope TEXT,                        -- self/department/sub_department/all/custom
  resource_type TEXT,
  action_type TEXT,
  scope_config_json TEXT,                 -- custom 范围配置 {departments:[],include_self,collaborated}
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (role_id, permission_code, resource_type)
);

-- ---------- 系统配置 / 日志 / 备份 ----------
CREATE TABLE IF NOT EXISTS system_configs (
  id TEXT PRIMARY KEY,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT,
  config_group TEXT DEFAULT 'system',     -- alert / sea / system
  value_type TEXT DEFAULT 'string',       -- string / number / boolean / json
  description TEXT,
  updated_by TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  log_type TEXT DEFAULT 'business',       -- business / config
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT,
  ip_address TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  file_path TEXT,
  file_size INTEGER,
  backup_type TEXT DEFAULT 'manual',      -- manual / auto
  status TEXT DEFAULT 'success',
  created_by TEXT,
  created_at TEXT
);

-- ---------- 登录会话（P01 登录页 / M10-R1） ----------
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  login_mode TEXT DEFAULT 'password',     -- password / ad_ldap
  created_at TEXT,
  expires_at TEXT,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- ---------- 消息通知中心（P03，M7-R2 / M8-R3 / 8.7） ----------
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT,                          -- alert 停滞预警 / approval 审批待办 / reminder 回访提醒 / system 系统通知
  title TEXT,
  content TEXT,
  ref_type TEXT,                          -- opportunity / loss_record / stagnation_explain / activity
  ref_id TEXT,
  link TEXT,                              -- 前端直达路由
  dedup_key TEXT UNIQUE,                  -- 幂等同步键，避免重复生成
  is_read INTEGER DEFAULT 0,
  created_at TEXT,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);

-- ---------- M1 客户 / 联系人 ----------
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,                              -- 企业/个人
  industry TEXT,
  scale TEXT,
  address TEXT,
  credit_code TEXT,
  level TEXT,                             -- 客户等级
  status TEXT DEFAULT 'active',           -- active / sea / invalid
  owner_id TEXT,
  source_channel TEXT,
  is_in_sea INTEGER DEFAULT 0,
  last_activity_at TEXT,
  remark TEXT,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS customer_history (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  action TEXT,                            -- create / update / release_to_sea / pickup
  changed_fields TEXT,
  before_snapshot TEXT,
  after_snapshot TEXT,
  changed_by TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_history_customer ON customer_history(customer_id);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  phone TEXT,
  email TEXT,
  wechat TEXT,
  decision_role TEXT,
  relationship TEXT,
  is_primary INTEGER DEFAULT 0,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id);

-- ---------- M2 线索 ----------
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                     -- 线索名称（销售内部标识/标题）
  customer_name TEXT,                     -- 客户/公司名称（转客户时使用）
  customer_id TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  wechat TEXT,
  source_channel TEXT,
  status TEXT DEFAULT 'new',              -- new / following / converted / recycled
  owner_id TEXT,
  is_in_sea INTEGER DEFAULT 0,
  converted_at TEXT,
  opportunity_id TEXT,
  remark TEXT,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);

-- ---------- M3 商机 ----------
CREATE TABLE IF NOT EXISTS stage_configs (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  is_terminal INTEGER DEFAULT 0,
  terminal_type TEXT,                     -- win / loss
  entry_condition TEXT,
  deliverables TEXT,
  roles_json TEXT,                        -- 参与角色 code 数组
  alert_thresholds TEXT,                  -- JSON {"level1":7,"level2":14,"level3":21}
  version INTEGER DEFAULT 1,
  is_system INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS stage_action_rules (
  id TEXT PRIMARY KEY,
  stage_config_id TEXT NOT NULL,
  action_name TEXT NOT NULL,
  field_key TEXT NOT NULL,                -- sys:* 内置派生键 / 实体字段 / 自定义字段 code
  field_type TEXT NOT NULL,               -- text/textarea/number/amount/date/datetime/boolean/select/multi_select/attachment/relation/user
  is_required INTEGER DEFAULT 1,
  options TEXT,                           -- JSON 数组
  tip TEXT,
  sort_order INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_rules_stage ON stage_action_rules(stage_config_id);

CREATE TABLE IF NOT EXISTS stage_config_change_logs (
  id TEXT PRIMARY KEY,
  stage_config_id TEXT,
  action TEXT,                            -- create / update / delete / reorder / mapping_preview / mapping_execute / rollback
  before_snapshot TEXT,
  after_snapshot TEXT,
  changed_by TEXT,
  version_after INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  stage_config_id TEXT NOT NULL,
  stage_name_snapshot TEXT,
  amount REAL DEFAULT 0,
  expected_close_date TEXT,
  owner_id TEXT,
  status TEXT DEFAULT '进行中',            -- 进行中 / 赢单 / 失败 / 公海
  stage_changed_at TEXT,
  last_activity_at TEXT,
  is_in_sea INTEGER DEFAULT 0,
  reactivated_from_loss_id TEXT,
  remark TEXT,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON opportunities(owner_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage_config_id);

CREATE TABLE IF NOT EXISTS stage_history (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  from_stage TEXT,
  from_stage_name TEXT,
  to_stage TEXT,
  to_stage_name TEXT,
  action_type TEXT,                       -- advance / rollback / close_win / close_loss / reactivate
  reason TEXT,
  config_version INTEGER,
  changed_by TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_history_opp ON stage_history(opportunity_id);

-- ---------- M4 销售行为记录 / 商机协作 ----------
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  customer_id TEXT,
  activity_type TEXT NOT NULL,
  activity_time TEXT NOT NULL,
  follow_up_time TEXT,
  content TEXT NOT NULL,
  is_reminded INTEGER DEFAULT 0,
  created_by TEXT,
  created_by_role TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_activities_opp ON activities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_activities_creator ON activities(created_by);

CREATE TABLE IF NOT EXISTS opportunity_shares (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  shared_by TEXT,
  shared_to TEXT NOT NULL,
  permissions TEXT,                       -- JSON 数组：view / activity_create / edit / advance / view_proposal...
  is_revoked INTEGER DEFAULT 0,
  created_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_opp ON opportunity_shares(opportunity_id);

-- ---------- M5 方案 / 报价 / 竞对 / 合同 / 附件 ----------
CREATE TABLE IF NOT EXISTS file_storages (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER DEFAULT 0,
  file_hash TEXT,
  uploader_id TEXT,
  related_type TEXT,
  related_id TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,            -- preliminary / formal
  file_storage_id TEXT,
  file_url TEXT,
  file_name TEXT,
  version TEXT,
  uploaded_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_opp ON proposals(opportunity_id);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  product_type TEXT,
  unit TEXT,
  description TEXT,
  is_enabled INTEGER DEFAULT 1,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS product_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  product_type TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT DEFAULT 'CNY',
  effective_date TEXT,
  remark TEXT,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  quotation_type TEXT NOT NULL,           -- preliminary / final
  amount REAL NOT NULL,
  product_type TEXT,
  product_id TEXT,
  file_storage_id TEXT,
  file_url TEXT,
  file_name TEXT,
  remark TEXT,
  uploaded_by TEXT,
  approval_status TEXT DEFAULT 'none',    -- none / pending / approved / rejected / canceled
  approval_instance_id TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quotations_opp ON quotations(opportunity_id);

CREATE TABLE IF NOT EXISTS competitor_masters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  strengths TEXT,
  weaknesses TEXT,
  typical_cases TEXT,
  is_enabled INTEGER DEFAULT 1,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  competitor_master_id TEXT,
  name TEXT NOT NULL,
  strengths TEXT,
  weaknesses TEXT,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_competitors_opp ON competitors(opportunity_id);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  customer_id TEXT,
  contract_no TEXT NOT NULL,
  contract_name TEXT,
  amount REAL NOT NULL DEFAULT 0,
  product_type TEXT,
  file_storage_id TEXT,
  file_url TEXT,
  file_name TEXT,
  signed_date TEXT,
  signed_by TEXT,
  status TEXT DEFAULT 'active',           -- active / archived
  approval_status TEXT DEFAULT 'none',    -- none / pending / approved / rejected / canceled
  approval_instance_id TEXT,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contracts_opp ON contracts(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);

-- ---------- M18 审批流引擎 ----------
CREATE TABLE IF NOT EXISTS approval_flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  biz_type TEXT NOT NULL,                 -- quotation / contract
  description TEXT,
  priority INTEGER DEFAULT 100,           -- 数字越小优先级越高
  is_enabled INTEGER DEFAULT 1,
  conditions_json TEXT,                   -- [{field,op,value}]，多个条件为 AND
  version INTEGER DEFAULT 1,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_flows_biz ON approval_flows(biz_type);

CREATE TABLE IF NOT EXISTS approval_flow_nodes (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 10,
  node_type TEXT DEFAULT 'approval',      -- approval / cc（一期只执行 approval）
  approve_mode TEXT DEFAULT 'any',        -- any 或签 / all 会签
  approver_type TEXT NOT NULL,            -- user / role
  approver_values TEXT,                   -- JSON 数组：用户 ID 或角色编码
  timeout_hours INTEGER,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_flow_nodes_flow ON approval_flow_nodes(flow_id);

CREATE TABLE IF NOT EXISTS approval_instances (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  flow_name TEXT,
  flow_version INTEGER,
  biz_type TEXT NOT NULL,
  biz_id TEXT NOT NULL,
  biz_summary TEXT,
  business_snapshot TEXT,                 -- JSON：金额、折扣率、商机等
  status TEXT DEFAULT 'pending',          -- pending / approved / rejected / canceled
  current_node_id TEXT,
  current_node_name TEXT,
  submitted_by TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_instances_biz ON approval_instances(biz_type, biz_id);
CREATE INDEX IF NOT EXISTS idx_approval_instances_submitter ON approval_instances(submitted_by);

CREATE TABLE IF NOT EXISTS approval_tasks (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_name TEXT,
  node_index INTEGER DEFAULT 0,
  approve_mode TEXT DEFAULT 'any',
  approver_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',          -- pending / approved / rejected / skipped
  comment TEXT,
  handled_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_tasks_instance ON approval_tasks(instance_id);
CREATE INDEX IF NOT EXISTS idx_approval_tasks_approver ON approval_tasks(approver_id, status);

-- ---------- M6 公海 ----------
CREATE TABLE IF NOT EXISTS sea_pool_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,              -- customer / opportunity / lead
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  customer_id TEXT,
  reason TEXT,
  source TEXT DEFAULT 'manual',           -- manual / auto_stale / auto_recycle
  previous_owner TEXT,                    -- 入公海前的负责人
  entered_at TEXT,
  claimed_by TEXT,
  claimed_at TEXT,
  protect_until TEXT,
  is_claimed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'in_sea',           -- in_sea / claimed
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sea_entity ON sea_pool_records(entity_type, entity_id);

-- ---------- M7 停滞预警 ----------
CREATE TABLE IF NOT EXISTS stale_alerts (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  stage_config_id TEXT,
  stage_name_snapshot TEXT,
  alert_level INTEGER NOT NULL,           -- 1 / 2 / 3
  days_stagnant INTEGER DEFAULT 0,
  triggered_at TEXT,
  is_resolved INTEGER DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT,
  notified_users TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_opp ON stale_alerts(opportunity_id);

CREATE TABLE IF NOT EXISTS stagnation_explains (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  alert_id TEXT,
  reason TEXT NOT NULL,
  detail TEXT,
  expected_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending',          -- pending / approved / rejected
  submitted_by TEXT,
  approver_id TEXT,
  approve_comment TEXT,
  approved_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_explains_opp ON stagnation_explains(opportunity_id);

-- ---------- M8 商机失效 ----------
CREATE TABLE IF NOT EXISTS loss_records (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  loss_reason TEXT NOT NULL,
  loss_detail TEXT,
  competitor_name TEXT,
  is_recoverable INTEGER DEFAULT 0,
  recovery_plan TEXT,
  follow_up_date TEXT,
  submitted_by TEXT,
  approved_by TEXT,
  approval_status TEXT DEFAULT 'pending', -- pending / approved / rejected
  approve_comment TEXT,
  approved_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_loss_opp ON loss_records(opportunity_id);

-- ---------- M12 自定义字段 ----------
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,              -- customer/contact/lead/opportunity/activity/proposal/quotation/contract
  field_code TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  is_required INTEGER DEFAULT 0,
  default_value TEXT,
  options TEXT,
  field_group TEXT,
  stage_config_id TEXT,                   -- 商机字段所属阶段（仅该阶段校验必填）
  sort_order INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  validation_rules TEXT,
  visible_roles TEXT,
  is_list_visible INTEGER DEFAULT 1,
  is_dup_check INTEGER DEFAULT 0,
  is_system INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (entity_type, field_code)
);

CREATE TABLE IF NOT EXISTS custom_field_values (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_definition_id TEXT,
  field_code TEXT NOT NULL,
  value_text TEXT,
  value_json TEXT,
  value_number REAL,
  value_datetime TEXT,
  updated_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (entity_type, entity_id, field_code)
);
CREATE INDEX IF NOT EXISTS idx_cfv_entity ON custom_field_values(entity_type, entity_id);

-- ---------- M14 系统字典 ----------
CREATE TABLE IF NOT EXISTS dictionary_types (
  id TEXT PRIMARY KEY,
  dict_code TEXT NOT NULL UNIQUE,
  dict_name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS dictionary_items (
  id TEXT PRIMARY KEY,
  dict_type_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  remark TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dict_items_type ON dictionary_items(dict_type_id);

-- ---------- M15 视图与报表配置 ----------
CREATE TABLE IF NOT EXISTS view_configs (
  id TEXT PRIMARY KEY,
  view_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  view_type TEXT DEFAULT 'personal',      -- default / personal / shared
  scope TEXT DEFAULT 'self',              -- self / department / sub_department / all / custom
  owner_id TEXT,
  shared_roles TEXT,
  columns TEXT,
  default_filter TEXT,
  default_sort TEXT,
  group_by TEXT,
  page_size INTEGER DEFAULT 20,
  batch_actions TEXT,
  is_system INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  template_name TEXT NOT NULL,
  template_type TEXT,                     -- funnel / stagnation / loss / personal / team
  data_source TEXT,
  dimensions TEXT,
  metrics TEXT,
  chart_type TEXT,
  filter_config TEXT,
  is_system INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS report_subscriptions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  frequency TEXT NOT NULL,                -- daily / weekly / monthly
  receivers TEXT,                         -- JSON 数组（用户ID或邮箱）
  format TEXT DEFAULT 'excel',            -- excel / html
  is_enabled INTEGER DEFAULT 1,
  created_by TEXT,
  last_sent_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- ---------- M16 实施配置向导 / 模板包 ----------
CREATE TABLE IF NOT EXISTS implementation_templates (
  id TEXT PRIMARY KEY,
  template_name TEXT NOT NULL,
  template_version TEXT DEFAULT '1.0.0',
  description TEXT,
  is_system INTEGER DEFAULT 0,
  config_data TEXT,
  created_by TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS implementation_wizard_state (
  id TEXT PRIMARY KEY,
  step TEXT,
  mode TEXT DEFAULT 'default',
  payload TEXT,
  status TEXT DEFAULT 'draft',            -- draft / finished
  finished_at TEXT,
  manifest TEXT,
  updated_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
