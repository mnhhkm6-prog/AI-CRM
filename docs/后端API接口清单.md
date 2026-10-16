# 后端 API 接口清单
> 依据：`自研CRM系统产品需求文档（PRD）` 第 2/3/4/11/12 章 + `CRM 界面设计文档` 第 3/6/7 章
> 技术栈：Node.js + Express + SQLite（better-sqlite3）　版本前缀：`/api/v1`
> 状态：**已定稿**（作为开发依据，对应实现见 `server/`）

---

## 一、全局约定

### 1.1 响应格式
| 场景 | HTTP 状态 | 响应体 |
|---|---|---|
| 查询成功 | 200 | `{ "data": ... }` |
| 创建成功 | 201 | `{ "data": { "id": "..." } }` |
| 参数校验失败 | 400 | `{ "error": "字段 xxx 必填" }` |
| 未找到 | 404 | `{ "error": "资源不存在" }` |
| 业务规则冲突 | 409 | `{ "error": "存在未完成固定动作，无法推进" }` |
| 无权限 | 403 | `{ "error": "无权访问该数据范围" }` |
| 服务异常 | 500 | `{ "error": "..." }` |

> **说明**：PRD 12.1 定义的 `{code,message,data}` 属"对外 API 预留"章节。本清单对内接口采用上表（RESTful + `{error}`），业务语义错误额外附 `code`（见 1.5）。

### 1.2 分页 / 排序 / 筛选
- 分页：`?page=1&page_size=20`（默认 20，上限 200），响应 `data: { list: [], total, page, page_size }`
- 排序：`?sort=created_at&order=desc`
- 筛选：`?keyword=xxx&status=xxx&owner_id=xxx&start_date=&end_date=`
- 自定义字段筛选：`?cf_<field_code>=<value>`

### 1.3 身份与权限（重要）
按职责约定**本期不实现真实鉴权**（PRD 未给出完整 JWT 方案）。
- 开发期通过请求头 `X-User-Id: <uuid>` 模拟登录用户；中间件解析出 `user → role → 权限编码集合 + 数据权限级别`。
- 所有列表/详情接口**强制走数据权限过滤**（self / department / sub_department / all / custom 五级）。
- 仅提供 `GET /api/v1/me` 返回当前身份，登录接口留空实现（`501`）。正式鉴权待 PRD 补充方案后接入。

### 1.4 通用规范
- CORS 全开（本地联调）。
- 软删除：主数据默认 `is_deleted` 软删；失效记录、操作日志、阶段变更历史**不可删除**。
- 时间统一 ISO8601；金额单位分（整数）。
- 所有写操作落 `OperationLog`。

### 1.5 错误码（业务语义，放在 `error` 文案或扩展 `code`）
| 码 | 含义 |
|---|---|
| 1001 | 固定动作未完成，禁止推进 |
| 1002 | 阶段配置变更未映射存量商机 |
| 1003 | 公海领取超上限 |
| 1004 | 数据在保护期内 |
| 1005 | 客户/线索重复 |
| 1006 | 字典项被引用，禁止删除 |
| 1007 | 自定义字段被引用，禁止删除 |
| 1008 | 角色权限变更需二次确认 |
| 1009 | 失效审批未通过 |

---

## 二、数据模型清单（对应 PRD 11.2）

| 表 | 实体 | 关键字段 |
|---|---|---|
| customers | Customer | name,type,industry,scale,address,credit_code,level,status,owner_id,source_channel,last_activity_at |
| contacts | Contact | customer_id,name,title,phone,email,wechat,decision_role,relationship,is_primary |
| leads | Lead | customer_id,source_channel,status,owner_id,converted_at,opportunity_id |
| opportunities | Opportunity | customer_id,name,stage_config_id,stage_name_snapshot,amount,expected_close_date,owner_id,status,stage_changed_at,last_activity_at,is_in_sea |
| activities | Activity | opportunity_id,customer_id,activity_type,activity_time,follow_up_time,content,created_by,created_by_role |
| opportunity_shares | OpportunityShare | opportunity_id,shared_by,shared_to,permissions,is_revoked |
| proposals | Proposal | opportunity_id,proposal_type,file_storage_id,file_url,file_name,uploaded_by |
| quotations | Quotation | opportunity_id,quotation_type,amount,file_storage_id,product_type,uploaded_by |
| competitors | Competitor | opportunity_id,competitor_master_id,name,strengths,weaknesses |
| contracts | Contract | opportunity_id,customer_id,contract_no,amount,file_storage_id,signed_date,signed_by |
| sea_pool_records | SeaPoolRecord | customer_id,opportunity_id,reason,entered_at,claimed_by,claimed_at,protect_until |
| stale_alerts | StaleAlert | opportunity_id,stage_config_id,stage_name_snapshot,alert_level,triggered_at,resolved_at,is_resolved,notified_users |
| loss_records | LossRecord | opportunity_id,loss_reason,loss_detail,competitor_name,is_recoverable,recovery_plan,submitted_by,approved_by,approval_status |
| stage_history | StageHistory | opportunity_id,from_stage,to_stage,from_stage_name,to_stage_name,changed_by,reason |
| roles | Role | role_code,role_name,role_type,description,sort_order,is_system,is_enabled |
| permissions | Permission | code,name,module,action |
| role_permissions | RolePermission | role_id,permission_code,permission_type,data_scope,resource_type,action_type,is_enabled |
| system_configs | SystemConfig | config_key,config_value,config_group,description,updated_by |
| operation_logs | OperationLog | user_id,action,target_type,target_id,detail_json,ip_address |
| competitor_masters | CompetitorMaster | name,industry,strengths,weaknesses,typical_cases |
| file_storages | FileStorage | original_name,storage_path,mime_type,file_size,file_hash,uploader_id,related_type,related_id |
| stage_configs | StageConfig | code,name,sort_order,is_enabled,is_terminal,terminal_type,entry_condition,deliverables,roles,alert_thresholds,version |
| stage_action_rules | StageActionRule | stage_config_id,action_name,field_key,field_type,is_required,options,sort_order,is_enabled |
| stage_config_change_logs | StageConfigChangeLog | stage_config_id,action,before_snapshot,after_snapshot,changed_by,version_after |
| custom_field_definitions | CustomFieldDefinition | entity_type,field_code,field_name,field_type,is_required,default_value,options,field_group,sort_order,is_enabled,validation_rules,visible_roles,is_list_visible,is_dup_check |
| custom_field_values | CustomFieldValue | entity_type,entity_id,field_definition_id,field_code,value_text,value_json,value_number,value_datetime |
| dictionary_types | DictionaryType | dict_code,dict_name,category,is_system,is_enabled,version |
| dictionary_items | DictionaryItem | dict_type_id,item_code,item_name,sort_order,is_default,is_enabled |
| view_configs | ViewConfig | view_name,entity_type,view_type,scope,owner_id,columns,default_filter,default_sort,group_by |
| report_templates | ReportTemplate | template_name,template_type,data_source,dimensions,metrics,chart_type,filter_config,is_system |
| implementation_templates | ImplementationTemplate | template_name,template_version,description,is_system,config_data,created_by |
| users | User | username,name,role_id,department_id,status,phone,email |
| departments | Department | name,parent_id,sort_order |

> `customers` 另加 `biz_needs`(业务诉求) 等**出厂默认自定义字段**，按 H1 方案统一走 `custom_field_definitions` + `custom_field_values`，不进入主表。

---

## 三、模块—实体—页面映射

| 模块 | 名称 | 主要实体 | 对应页面 |
|---|---|---|---|
| M1 | 客户管理 | Customer, Contact | P05/P06/P07 |
| M2 | 线索管理 | Lead | P08/P09/P10 |
| M3 | 商机管理 | Opportunity, StageHistory | P11/P12/P13/P14 |
| M4 | 销售行为记录 | Activity, OpportunityShare | P15/P16 |
| M5 | 方案与报价管理 | Proposal, Quotation, Competitor, Contract, FileStorage | P17/P18/P19/P20 |
| M6 | 公海管理 | SeaPoolRecord | P21 |
| M7 | 停滞预警 | StaleAlert | P22/P23/P24 |
| M8 | 商机失效 | LossRecord | P25/P26 |
| M9 | 报表复盘 | 聚合查询 | P27 |
| M10 | 系统管理与权限 | User, Department, SystemConfig, OperationLog | P28–P32 |
| M11 | 漏斗配置管理 | StageConfig, StageActionRule, StageConfigChangeLog | P33–P36 |
| M12 | 自定义字段管理 | CustomFieldDefinition, CustomFieldValue | P37/P38 |
| M13 | 角色与权限配置管理 | Role, Permission, RolePermission | P39/P40 |
| M14 | 系统字典管理 | DictionaryType, DictionaryItem | P41 |
| M15 | 视图与报表配置 | ViewConfig, ReportTemplate | P42/P43/P44 |
| M16 | 实施配置向导 | ImplementationTemplate | P45/P46 |

---

## 四、接口清单

### M1 客户管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 / 出参 |
|---|---|---|---|---|
| GET | `/customers` | 客户列表（分页/筛选/排序/数据权限） | customer:view | `page,page_size,keyword,status,level,owner_id` |
| POST | `/customers` | 新增客户 | customer:create | body: `name*`,type*,industry,scale,address,credit_code,level,source_channel*,owner_id,custom_fields |
| POST | `/customers/check-duplicate` | 查重（同名/同电话）M1-R3 | customer:create | body: `name,phone` → `{duplicated:bool,matches:[...]}` |
| GET | `/customers/{id}` | 客户详情 | customer:view | — |
| PUT | `/customers/{id}` | 编辑（记录修改历史）M1-R2 | customer:update | body: 同新增 |
| DELETE | `/customers/{id}` | 删除（软删） | customer:delete | — |
| GET | `/customers/{id}/history` | 修改历史 M1-R2 | customer:view | — |
| GET | `/customers/{id}/360` | 客户 360 汇总 M1-R7 | customer:view | → 基础信息+联系人+线索+商机+行为+方案报价+合同 |
| POST | `/customers/{id}/release-to-sea` | 客户转公海 M1-R6 | customer:update | body: `reason` |
| GET | `/customers/{id}/contacts` | 联系人列表 | contact:view | — |
| POST | `/customers/{id}/contacts` | 新增联系人 M1-R4 | contact:create | body: `name*,phone*,title,email,wechat,decision_role,relationship,is_primary` |
| PUT | `/contacts/{id}` | 编辑联系人 | contact:update | — |
| DELETE | `/contacts/{id}` | 删除联系人 | contact:delete | — |
| POST | `/contacts/{id}/set-primary` | 设为主联系人 | contact:update | — |

### M2 线索管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/leads` | 线索列表 M2-R2 | lead:view | `page,keyword,status,source_channel,owner_id` |
| POST | `/leads` | 线索录入 M2-R1 | lead:create | body: `name*,customer_id,source_channel*,owner_id,contact_phone` |
| GET | `/leads/{id}` | 详情 | lead:view | — |
| PUT | `/leads/{id}` | 编辑 | lead:update | — |
| DELETE | `/leads/{id}` | 删除 | lead:delete | — |
| POST | `/leads/{id}/assign` | 分配给销售 M2-R3 | lead:assign | body: `owner_id` |
| POST | `/leads/{id}/convert` | 转商机 M2-R4 | lead:convert | body: `opportunity_name,amount,stage_config_id` → `{opportunity_id}` |
| POST | `/leads/{id}/recycle` | 回收至公海 M2-R5 | lead:recycle | body: `reason` |

### M3 商机管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/opportunities` | 商机列表 M3-R6 | opportunity:view | `page,keyword,status,stage_config_id,owner_id` |
| POST | `/opportunities` | 新建商机 M3-R1 | opportunity:create | body: `name*,customer_id*,amount,expected_close_date,owner_id,stage_config_id` |
| GET | `/opportunities/{id}` | 商机详情 M3-R7 | opportunity:view | → 含阶段进度、固定动作完成度、时间轴 |
| PUT | `/opportunities/{id}` | 编辑 | opportunity:update | — |
| DELETE | `/opportunities/{id}` | 删除 | opportunity:delete | — |
| GET | `/opportunities/{id}/advance-check` | 推进前固定动作校验摘要 M3-R2 | opportunity:view | → `{stage,completeness:"3/5",items:[{key,name,done}]}` |
| POST | `/opportunities/{id}/advance` | 阶段推进（校验通过后）M3-R2 | opportunity:update | body: `to_stage_config_id,action_values{},force:bool,force_reason` |
| POST | `/opportunities/{id}/rollback` | 阶段回退 M3-R3 | opportunity:update | body: `to_stage_config_id,reason*`（仅管理层） |
| POST | `/opportunities/{id}/close-win` | 赢单关闭 M3-R4 | opportunity:update | body: `contract{}`（可同时建合同） |
| POST | `/opportunities/{id}/close-loss` | 失败关闭 → 生成失效申请 M3-R5/M8-R1 | opportunity:update | body: `loss_reason*,loss_detail*,competitor_name,is_recoverable,recovery_plan` |
| GET | `/opportunities/{id}/timeline` | 阶段变更历史 | opportunity:view | → StageHistory 列表 |
| GET | `/opportunities/{id}/stage-progress` | 阶段进度条数据 | opportunity:view | → 各阶段 + 当前 |

### M4 销售行为记录
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/activities` | 行为记录列表 M4-R2（默认仅本人） | activity:view | `opportunity_id,customer_id,activity_type,created_by,start_date,end_date` |
| POST | `/activities` | 新增行为 M4-R1 | activity:create | body: `opportunity_id*,customer_id,activity_type*,activity_time*,follow_up_time*,content*` |
| GET | `/activities/{id}` | 详情 | activity:view | — |
| PUT | `/activities/{id}` | 编辑 | activity:update | — |
| DELETE | `/activities/{id}` | 删除 | activity:delete | — |
| GET | `/activities/stats` | 行为统计 M4-R4 | activity:view | `group_by=sales|type|date&start_date&end_date` |
| GET | `/activities/reminders` | 回访提醒 M4-R3 | activity:view | → 到期/逾期列表 |
| GET | `/opportunities/{id}/shares` | 商机分享列表 M4-R7 | opportunity:view | — |
| POST | `/opportunities/{id}/shares` | 分享商机并授权 M4-R7 | opportunity:update | body: `shared_to,permissions[]` |
| DELETE | `/opportunities/{id}/shares/{shareId}` | 撤销分享 | opportunity:update | — |

### M5 方案与报价管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| POST | `/files` | 上传附件（multipart） | file:upload | → `{file_storage_id,file_url}` |
| GET | `/files/{id}/download` | 下载/预览附件 M5-R4 | file:view | — |
| GET | `/opportunities/{id}/proposals` | 方案列表 M5-R1 | proposal:view | — |
| POST | `/opportunities/{id}/proposals` | 上传方案（初步/正式）M5-R1 | proposal:create | body: `proposal_type*,file_storage_id*` |
| DELETE | `/proposals/{id}` | 删除方案 | proposal:delete | — |
| GET | `/opportunities/{id}/quotations` | 报价列表 M5-R2 | quotation:view | — |
| POST | `/opportunities/{id}/quotations` | 新增报价 M5-R2 | quotation:create | body: `quotation_type*,amount*,product_type*,file_storage_id` |
| DELETE | `/quotations/{id}` | 删除报价 | quotation:delete | — |
| GET | `/products/prices` | 产品价格记录列表 M5-R3 | quotation:view | `page,product_type` |
| POST | `/products/prices` | 录入产品价格 M5-R3 | quotation:create | body: `product_type*,price*` |
| PUT | `/products/prices/{id}` | 修改产品价格 | quotation:update | — |
| DELETE | `/products/prices/{id}` | 删除产品价格 | quotation:delete | — |
| GET | `/opportunities/{id}/competitors` | 商机竞争对手列表 | competitor:view | — |
| POST | `/opportunities/{id}/competitors` | 录入竞争对手 M5-R5 | competitor:create | body: `competitor_master_id,name*,strengths,weaknesses` |
| DELETE | `/competitors/{id}` | 删除 | competitor:delete | — |
| GET | `/competitor-masters` | 竞争对手主数据列表（供下拉） | competitor:view | `keyword,is_enabled` |
| POST | `/competitor-masters` | 新增主数据 | competitor:create | body: `name*,industry,strengths,weaknesses,typical_cases` |
| PUT | `/competitor-masters/{id}` | 编辑 | competitor:update | — |
| POST | `/competitor-masters/{id}/disable` | 停用 | competitor:update | — |
| GET | `/opportunities/{id}/contracts` | 合同列表 | contract:view | — |
| POST | `/opportunities/{id}/contracts` | 新建合同 | contract:create | body: `contract_no*,amount*,file_storage_id*,signed_date*,signed_by*` |

### M6 公海管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/sea-pool` | 公海池（type=customer\|opportunity\|lead）M6-R1 | sea:view | `type*,page,keyword` |
| POST | `/sea-pool/{type}/{id}/pickup` | 领取 M6-R2（需开启领取模式） | sea:pickup | → 校验个人/每日上限 M6-R4 |
| POST | `/sea-pool/{type}/{id}/assign` | 主管分配 M6-R3 | sea:assign | body: `owner_id` |
| GET | `/sea-pool/{type}/{id}` | 公海记录详情 | sea:view | → 含 `protect_until` |
| POST | `/sea-pool/auto-assign/run` | 触发自动分配算法（P2）M6-R7 | sea:manage | — |
| GET | `/sea-pool/rules` | 当前公海规则 | sea:view | → 来自 system_configs(sea) |

### M7 停滞预警
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/alerts` | 预警列表 M7-R1/M7-R2 | alert:view | `level,is_resolved,opportunity_id` |
| GET | `/alerts/unadvanced` | 未推进商机列表 M7-R4 | alert:view | `stage_config_id,min_days` |
| POST | `/opportunities/{id}/stagnation-explain` | 停滞说明申请（延期）M7-R5 | opportunity:update | body: `reason*,detail*,expected_date*` |
| POST | `/stagnation-explains/{id}/approve` | 审批通过（解除预警） | alert:manage | — |
| POST | `/stagnation-explains/{id}/reject` | 驳回 | alert:manage | body: `comment*` |
| GET | `/system/configs/alert` | 预警阈值配置 M10-R3 | system_config:view | — |
| PUT | `/system/configs/alert` | 修改阈值（7/14/21，二次确认） | system_config:manage | body: `level1_days,level2_days,level3_days,fallback_days` |
| POST | `/jobs/stale-alert/run` | 手工触发停滞检测（调试/补跑） | system_config:manage | — |

### M8 商机失效
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/loss-records` | 失效记录查询 M8-R4 | loss:view | `page,approval_status,loss_reason,start_date,end_date` |
| GET | `/loss-records/{id}` | 详情 | loss:view | — |
| POST | `/loss-records/{id}/approve` | 审批通过 M8-R2（商机转失效） | loss:approve | body: `comment` |
| POST | `/loss-records/{id}/reject` | 驳回 M8-R2 | loss:approve | body: `comment*` |
| POST | `/loss-records/{id}/mark-recoverable` | 标记可挽回 + 安排跟进 M8-R5 | loss:update | body: `recovery_plan*` |

### M9 报表复盘
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/reports/funnel` | 漏斗报表 M9-R1（按生效阶段动态分组） | report:view | `start_date,end_date,owner_id,team_id` |
| GET | `/reports/stagnation` | 停滞复盘 M9-R2 | report:view | 同上 |
| GET | `/reports/loss` | 失效复盘 M9-R3 | report:view | 同上 |
| GET | `/reports/personal` | 销售个人报表 M9-R4 | report:view | `user_id,start_date,end_date` |
| GET | `/reports/team` | 团队报表 M9-R5 | report:view | `department_id,start_date,end_date` |
| GET | `/reports/{type}/export` | 导出 Excel/PDF M15-R6 | report:export | → 文件流 |

### M10 系统管理与权限
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/me` | 当前用户与权限 | — | 由 `X-User-Id` 解析 |
| POST | `/auth/login` | 登录（**留空实现 501**） | — | — |
| GET | `/users` | 用户列表 M10-R1 | user:view | `page,keyword,role_id,department_id,status` |
| POST | `/users` | 新增用户 M10-R1 | user:manage | body: `username*,name*,role_id,department_id,phone,email,password*` |
| GET | `/users/{id}` | 用户详情 | user:view | — |
| PUT | `/users/{id}` | 编辑用户 | user:manage | — |
| POST | `/users/{id}/disable` | 禁用/启用 | user:manage | body: `status` |
| POST | `/users/{id}/reset-password` | 重置密码 | user:manage | body: `new_password*` |
| GET | `/departments` | 部门树 | user:view | → 树形 |
| POST | `/departments` | 新增部门 | user:manage | body: `name*,parent_id` |
| PUT | `/departments/{id}` | 编辑部门 | user:manage | — |
| DELETE | `/departments/{id}` | 删除部门（有下级/成员禁止） | user:manage | — |
| GET | `/system/configs` | 系统配置列表 | system_config:view | `config_group` |
| PUT | `/system/configs/{key}` | 修改单项配置 | system_config:manage | body: `config_value*,confirm:bool` |
| PUT | `/system/configs` | 批量修改（含影响摘要二次确认） | system_config:manage | body: `items[]` |
| GET | `/system/configs/sea` | 公海规则 M6-R6 | system_config:view | — |
| PUT | `/system/configs/sea` | 修改公海规则 | system_config:manage | body: `protection_days,is_pickup_mode,personal_max,daily_pickup_max,lead_recycle_days` |
| GET | `/system/login-config` | 登录方式配置 M10-R6 | system_config:view | → `{mode:'password'\|'ad_ldap',ad_ldap:{...}}` |
| PUT | `/system/login-config` | 切换登录方式 M10-R6 | system_config:manage | body: `mode*,ad_ldap{}` |
| GET | `/system/backups` | 备份记录 M10-R4 | system_config:view | — |
| POST | `/system/backups` | 立即备份 M10-R4 | system_config:manage | — |
| POST | `/system/backups/{id}/restore` | 从备份恢复 M10-R4 | system_config:manage | — |
| GET | `/operation-logs` | 操作日志 M10-R5 | operation_log:view | `page,user_id,type=business\|config,start_date,end_date` |
| GET | `/health` | 健康检查 | — | → `{status,db,jobs}` |

### M11 漏斗配置管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/stage-configs` | 阶段列表 M11-R1 | stage_config:view | `include_disabled` |
| POST | `/stage-configs` | 新增阶段 M11-R1 | stage_config:manage | body: `code*,name*,sort_order,is_terminal,terminal_type,roles[]` |
| PUT | `/stage-configs/{id}` | 编辑阶段定义 M11-R2 | stage_config:manage | — |
| DELETE | `/stage-configs/{id}` | 删除阶段（内置终态禁止） | stage_config:manage | → 有存量商机时要求先映射 |
| POST | `/stage-configs/reorder` | 排序 M11-R1 | stage_config:manage | body: `ordered_ids[]` |
| POST | `/stage-configs/{id}/toggle` | 启用/停用 | stage_config:manage | body: `is_enabled` |
| GET | `/stage-configs/{id}/action-rules` | 固定动作清单 M11-R3 | stage_config:view | — |
| POST | `/stage-configs/{id}/action-rules` | 新增固定动作 M11-R3 | stage_config:manage | body: `action_name*,field_key*,field_type*,is_required,options[],sort_order` |
| PUT | `/stage-action-rules/{id}` | 编辑固定动作 | stage_config:manage | — |
| DELETE | `/stage-action-rules/{id}` | 删除固定动作 | stage_config:manage | — |
| GET | `/stage-configs/versions` | 配置版本历史 M11-R6 | stage_config:view | — |
| GET | `/stage-configs/versions/{version}` | 版本详情/对比 | stage_config:view | — |
| POST | `/stage-configs/rollback` | 回滚版本 M11-R6 | stage_config:manage | body: `version*,confirm` |
| POST | `/stage-configs/mapping/preview` | 存量映射预览 M11-R5 | stage_config:manage | body: `changes[]` → 旧→新 + 涉及商机数 |
| POST | `/stage-configs/mapping/execute` | 执行映射 M11-R5 | stage_config:manage | body: `mapping[]` |

### M12 自定义字段管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/custom-fields` | 字段定义列表 M12-R1 | custom_field:view | `entity_type*` |
| POST | `/custom-fields` | 新增字段定义 M12-R1/R2 | custom_field:manage | body: `entity_type*,field_code*,field_name*,field_type*,is_required,default_value,options[],field_group,sort_order,visible_roles[],is_list_visible,is_dup_check,validation_rules{}` |
| PUT | `/custom-fields/{id}` | 编辑字段 M12-R2（field_code 不可改） | custom_field:manage | — |
| POST | `/custom-fields/{id}/toggle` | 启用/停用 M12-R2 | custom_field:manage | body: `is_enabled` |
| DELETE | `/custom-fields/{id}` | 删除（被引用时 1007） | custom_field:manage | — |
| GET | `/custom-fields/{id}/references` | 引用检查 M12-R3 | custom_field:view | → 阶段规则/视图/报表引用 |
| GET | `/custom-fields/values/{entity_type}/{entity_id}` | 取自定义字段值 | custom_field:view | — |
| PUT | `/custom-fields/values/{entity_type}/{entity_id}` | 写自定义字段值 | custom_field:manage | body: `values{}` |

> 八大实体 CRUD 的 `custom_fields` 字段随主接口一并读写（M12-R1）。

### M13 角色与权限配置管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/roles` | 角色列表 M13-R1 | role:view | → 含 7+1 预置 |
| POST | `/roles` | 新增角色 M13-R2 | role:manage | body: `role_name*,role_code,description,sort_order` |
| POST | `/roles/{id}/copy` | 复制新建 M13-R2 | role:manage | body: `role_name*,role_code` |
| PUT | `/roles/{id}` | 编辑角色 | role:manage | — |
| DELETE | `/roles/{id}` | 删除（系统内置禁止） | role:manage | — |
| GET | `/permissions` | 权限点清单 M13-R3 | role:view | `module` |
| GET | `/roles/{id}/permissions` | 角色功能权限矩阵 M13-R3 | role:view | → `{module:{action:bool}}` |
| PUT | `/roles/{id}/permissions` | 保存功能权限 M13-R3 | role:manage | body: `permissions[{permission_code,is_enabled}]` |
| GET | `/roles/{id}/data-scopes` | 数据权限 M13-R4 | role:view | → 每资源五级范围 |
| PUT | `/roles/{id}/data-scopes` | 保存数据权限 M13-R4 | role:manage | body: `scopes[{resource_type,data_scope}]` |
| GET | `/roles/{id}/permission-change-preview` | 变更影响预览 M13-R5 | role:view | → 影响用户数/数据量 |
| GET | `/roles/{id}/members` | 角色成员 | role:view | — |

### M14 系统字典管理
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/dictionaries` | 字典类型列表 M14-R1 | dictionary:view | `category,is_enabled` |
| POST | `/dictionaries` | 新增字典类型 M14-R1 | dictionary:manage | body: `dict_code*,dict_name*,category,description` |
| GET | `/dictionaries/{id}` | 字典类型详情 | dictionary:view | — |
| PUT | `/dictionaries/{id}` | 编辑（version+1）M14-R3 | dictionary:manage | — |
| DELETE | `/dictionaries/{id}` | 删除（系统内置禁止） | dictionary:manage | — |
| GET | `/dictionaries/{id}/items` | 字典项列表 M14-R1 | dictionary:view | — |
| POST | `/dictionaries/{id}/items` | 新增字典项 | dictionary:manage | body: `item_code*,item_name*,sort_order,is_default` |
| PUT | `/dictionary-items/{id}` | 编辑字典项 | dictionary:manage | — |
| DELETE | `/dictionary-items/{id}` | 删除（被引用时 1006，需二次确认）M14-R2 | dictionary:manage | `?confirm=true` |
| GET | `/dictionaries/{id}/references` | 引用明细 M14-R2 | dictionary:view | — |

### M15 视图与报表配置
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/views` | 视图列表 M15-R1（默认/个人/共享） | view:view | `entity_type*,view_type,scope` |
| POST | `/views` | 新增个人/共享视图 M15-R1/R2 | view:manage | body: `view_name*,entity_type*,view_type,scope,columns[],default_filter[],default_sort{},group_by` |
| PUT | `/views/{id}` | 编辑视图 | view:manage | — |
| DELETE | `/views/{id}` | 删除视图（系统默认禁止） | view:manage | — |
| POST | `/views/{id}/set-default` | 设为默认视图 | view:manage | — |
| GET | `/report-templates` | 报表模板列表 M15-R5 | report_template:view | — |
| POST | `/report-templates` | 新增模板 M15-R5 | report_template:manage | body: `template_name*,template_type*,data_source*,dimensions[],metrics[],chart_type,filter_config[]` |
| PUT | `/report-templates/{id}` | 编辑模板 | report_template:manage | — |
| DELETE | `/report-templates/{id}` | 删除（系统预置禁止） | report_template:manage | — |
| POST | `/report-templates/{id}/preview` | 预览渲染 | report_template:view | → 数据 + 图表配置 |
| GET | `/report-subscriptions` | 订阅列表 M15-R6 | report:view | — |
| POST | `/report-subscriptions` | 新增订阅 M15-R6 | report:view | body: `template_id*,frequency*,receivers[],format*` |
| PUT | `/report-subscriptions/{id}` | 编辑订阅 | report:view | — |
| DELETE | `/report-subscriptions/{id}` | 删除订阅 | report:view | — |

### M16 实施配置向导与模板导入导出
| 方法 | 路径 | 说明 | 权限 | 关键入参 |
|---|---|---|---|---|
| GET | `/implementation/wizard/state` | 向导状态/草稿 M16-R1 | system_config:manage | → 当前步、已完成步 |
| POST | `/implementation/wizard/step` | 提交某一步（基础信息/漏斗/字段/角色/字典/导入） | system_config:manage | body: `step*,mode:'default'\|'template'\|'custom',payload{}` |
| POST | `/implementation/wizard/finish` | 完成向导并生成实施配置清单 | system_config:manage | — |
| GET | `/implementation/templates` | 模板包列表 M16-R2 | system_config:view | → 名称/版本/说明 |
| POST | `/implementation/templates/export` | 导出当前配置为模板包 M16-R2 | system_config:manage | body: `template_name*,template_version*,description` |
| POST | `/implementation/templates/import` | 导入模板包（第一步：冲突预览）M16-R3 | system_config:manage | body: `config_data` → 冲突清单 |
| POST | `/implementation/templates/import/confirm` | 逐项确认覆盖/跳过/重命名 M16-R3 | system_config:manage | body: `decisions[{item,action,rename}]` |
| DELETE | `/implementation/templates/{id}` | 删除模板包 | system_config:manage | — |
| POST | `/implementation/templates/{id}/upgrade` | 跨版本升级 M16-R4 | system_config:manage | body: `target_version` |

---

## 五、定时任务（对应四大引擎之三）
| 任务 | 频率 | 说明 |
|---|---|---|
| 停滞预警检测 | 每日 00:05 | 扫在途商机 → 按 StageConfig.alert_thresholds / 全局默认 7-14-21 生成/升级 StaleAlert，通知触达对象 |
| 三级预警后回落公海 | 每日 00:10 | 三级预警后再超 `sea_fallback_days_after_alert`(7) 天 → 自动回公海 M7-R6 |
| 公海保护期到期 | 每小时 | `protect_until` 过期后允许被他人领取 |
| 线索未转化回收 | 每日 00:20 | 超 `lead_unconverted_recycle_days`(60) 天回收 M2-R5 |
| 数据报表订阅推送 | 按订阅频率 | M15-R6 |

> 开发期用 `node-cron` 内置调度；`POST /jobs/*` 提供手工触发以便测试。

---

## 六、权限种子数据（初始化）
按 PRD 11.2.16 默认角色权限编码表初始化 7+1 角色：销售 / 业务支撑 / 售前 / 生态 / 采购 / 管理层 / 人事(`user:view,report:view`) / 系统管理员(全部)。
同步初始化：StageConfig（S0–S4 + WIN/LOSS）、8 项 SystemConfig（预警 3 项 + 公海 5 项）、6 类默认字典、5 张预置报表模板。

---

## 七、已确认结论（作为开发依据）
1. **响应格式**：对内接口统一 `{ "data": ... }` / `{ "error": "..." }`，业务语义错误额外附 `code`（1001–1009）。PRD 12.1 的 `{code,message,data}` 仅用于后续对外 API 预留。
2. **身份模拟**：本期采用请求头 `X-User-Id`（支持 userId 或 username）模拟登录，**不实现真实鉴权**；`POST /auth/login` 留 `501` 空实现。
3. **文件存储**：附件存服务器本地 `uploads/` 目录，元数据落 `file_storages` 表。
4. **报表导出**：Excel 用 `exceljs`；PDF 本期输出可打印 HTML（不引入 PDF 渲染引擎）。
5. **合同接口**：除 `close-win` 时创建外，**新增** `GET /contracts`（合同管理列表，支持分页/筛选）、`GET /contracts/{id}`、`PUT /contracts/{id}`、`DELETE /contracts/{id}`。

> 补充约定（开发实现细节，不改业务语义）：
> - `role_permissions` 增列 `scope_config_json`（承载 `data_scope=custom` 的自定义部门范围）。
> - 新增 `stagnation_explains` 表承载 M7-R5 停滞说明（延期）申请与审批。
> - 新增 `report_subscriptions` 表承载 M15-R6 报表订阅。
> - 新增 `products` / `product_prices` 表承载 M5-R3 产品价格记录。
> - 新增 `customer_history` 表承载 M1-R2 客户修改历史。
