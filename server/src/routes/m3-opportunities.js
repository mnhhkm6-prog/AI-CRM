'use strict';

/**
 * M3 商机管理（P11/P12/P13/P14）
 * 覆盖：商机 CRUD、阶段推进/回退（固定动作校验由 stageEngine 承担）、赢单/失败关闭、时间轴与进度
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, getPaging, paged, buildSort, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, conflict, forbidden, CODE } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission, requireAnyPermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const customField = require('../services/customField');
const { logOperation, diffFields } = require('../services/operationLog');
const stageEngine = require('../services/stageEngine');
const seaService = require('../services/seaService');

const SORTABLE = ['created_at', 'updated_at', 'amount', 'stage_changed_at', 'last_activity_at'];
const EDITABLE = ['name', 'customer_id', 'amount', 'expected_close_date', 'owner_id', 'remark'];
/** 阶段详情去掉配置类大字段 */
const STAGE_BIG_FIELDS = ['entry_condition', 'deliverables', 'roles_json', 'alert_thresholds'];

/** 按数据权限加载商机（不存在或越权均 404） */
function loadOpportunity(req) {
  const row = dataScope.findScoped('opportunity', 'opportunities', req.params.id, req.user);
  if (!row) throw notFound('商机不存在或无权访问');
  return row;
}

/** 精简阶段信息（去掉配置类大字段） */
function pickStage(stage) {
  if (!stage) return null;
  const out = { ...stage };
  STAGE_BIG_FIELDS.forEach((f) => delete out[f]);
  return out;
}

/** 商机列表（M3-R6：数据权限 + 关键字 + 自定义字段筛选） */
router.get('/opportunities', requirePermission('opportunity:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];

  const scope = dataScope.scopeFragment(req.user, 'opportunity', 't.owner_id');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  if (req.query.keyword) {
    conditions.push('t.name LIKE ?');
    params.push(`%${req.query.keyword}%`);
  }
  ['status', 'stage_config_id', 'owner_id', 'customer_id'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.is_in_sea !== undefined) {
    conditions.push('t.is_in_sea = ?');
    params.push(req.query.is_in_sea === 'true' || req.query.is_in_sea === '1' ? 1 : 0);
  }
  if (req.query.start_date) {
    conditions.push('t.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.created_at <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }
  customField.buildFilter('opportunity', req.query, conditions, params);

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM opportunities t WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, SORTABLE);
  const list = db
    .prepare(
      `SELECT t.*, c.name AS customer_name, u.name AS owner_name FROM opportunities t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = t.owner_id
       WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);

  customField.attach('opportunity', list);
  ok(res, paged(list, total, paging));
});

/** 新建商机（M3-R1） */
router.post('/opportunities', requirePermission('opportunity:create'), (req, res) => {
  const body = bodyOf(req);
  const name = requireString(body, 'name', '商机名称');
  const customerId = requireString(body, 'customer_id', '所属客户');

  const customer = dataScope.findScoped('customer', 'customers', customerId, req.user);
  if (!customer) throw notFound('所属客户不存在或无权访问');

  // 商机查重：同一客户下不允许重复创建同名进行中商机
  const dup = db
    .prepare("SELECT id, name FROM opportunities WHERE is_deleted = 0 AND status = '进行中' AND customer_id = ? AND name = ?")
    .get(customerId, name.trim());
  if (dup && !body.ignore_duplicate) {
    throw conflict('该客户下已存在同名进行中商机，如确认不重复请传 ignore_duplicate=true', CODE.DUPLICATE);
  }

  const stage = body.stage_config_id ? stageEngine.getById(body.stage_config_id) : stageEngine.firstStage();
  if (!stage) throw notFound(body.stage_config_id ? '阶段不存在' : '漏斗起点阶段未初始化');
  if (stage.is_enabled !== 1) throw badRequest(`阶段「${stage.name}」已停用，不可使用`);

  let amount = 0;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    amount = Number(body.amount);
    if (Number.isNaN(amount)) throw badRequest('amount 必须为数字');
  }

  // 说明：自定义字段的必填校验属于「阶段固定动作」，仅在阶段推进时由 stageEngine 执行；
  // 创建商机只需满足核心字段（name / customer_id），避免起点阶段即被拦死。
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO opportunities (id, name, customer_id, stage_config_id, stage_name_snapshot, amount, expected_close_date,
      owner_id, status, stage_changed_at, last_activity_at, is_in_sea, remark, created_by, is_deleted, created_at, updated_at)
     VALUES (@id, @name, @customer_id, @stage_config_id, @stage_name_snapshot, @amount, @expected_close_date,
      @owner_id, '进行中', @t, @t, 0, @remark, @created_by, 0, @t, @t)`
  ).run({
    id,
    name,
    customer_id: customerId,
    stage_config_id: stage.id,
    stage_name_snapshot: stage.name,
    amount,
    expected_close_date: optional(body, 'expected_close_date'),
    owner_id: optional(body, 'owner_id', req.user.id),
    remark: optional(body, 'remark'),
    created_by: req.user.id,
    t,
  });

  db.prepare(
    `INSERT INTO stage_history
      (id, opportunity_id, from_stage, from_stage_name, to_stage, to_stage_name, action_type, reason, config_version, changed_by, created_at)
     VALUES (?, ?, NULL, NULL, ?, ?, 'create', NULL, ?, ?, ?)`
  ).run(newId(), id, stage.id, stage.name, stage.version, req.user.id, t);

  customField.setValues('opportunity', id, body.custom_fields, req.user.id);
  logOperation(req, { action: 'CREATE_OPPORTUNITY', targetType: 'Opportunity', targetId: id, detail: { name, customer_id: customerId } });

  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  row.custom_fields = customField.readValues('opportunity', id);
  created(res, row);
});

/** 商机详情（M3-R7：阶段进度 + 固定动作完成度 + 关联统计） */
router.get('/opportunities/:id', requirePermission('opportunity:view'), (req, res) => {
  const row = loadOpportunity(req);
  const stage = stageEngine.getById(row.stage_config_id);
  const evaluation = stageEngine.evaluate(row, stage);

  const customerName = row.customer_id
    ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(row.customer_id) || {}).name
    : null;
  const ownerName = row.owner_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(row.owner_id) || {}).name : null;

  const count = (table) =>
    db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE opportunity_id = ? AND is_deleted = 0`).get(row.id).c;

  ok(res, {
    ...row,
    stage: pickStage(stage),
    stage_progress: stageEngine.stageProgress(row.id),
    fixed_actions: { items: evaluation.items, completeness: evaluation.completeness, missing: evaluation.missing },
    customer_name: customerName,
    owner_name: ownerName,
    custom_fields: customField.readValues('opportunity', row.id),
    stats: {
      activity_count: count('activities'),
      proposal_count: count('proposals'),
      quotation_count: count('quotations'),
      contract_count: count('contracts'),
    },
  });
});

/** 编辑商机（字段编辑视为推进动作，解除停滞预警） */
router.put('/opportunities/:id', requirePermission('opportunity:update'), (req, res) => {
  const before = loadOpportunity(req);
  const body = bodyOf(req);

  if (body.amount !== undefined && body.amount !== null && body.amount !== '' && Number.isNaN(Number(body.amount))) {
    throw badRequest('amount 必须为数字');
  }

  const after = {};
  EDITABLE.forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length && !body.custom_fields) throw badRequest('没有可更新的字段');

  if (Object.keys(after).length) {
    const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE opportunities SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: before.id, t: now() });
  }
  if (body.custom_fields) customField.setValues('opportunity', before.id, body.custom_fields, req.user.id);

  stageEngine.touchOpportunity(before.id, req);
  const updated = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(before.id);
  logOperation(req, { action: 'UPDATE_OPPORTUNITY', targetType: 'Opportunity', targetId: before.id, detail: diffFields(before, updated, Object.keys(after)) });

  updated.custom_fields = customField.readValues('opportunity', before.id);
  ok(res, updated);
});

/** 删除商机（软删） */
router.delete('/opportunities/:id', requirePermission('opportunity:delete'), (req, res) => {
  const row = loadOpportunity(req);
  db.prepare('UPDATE opportunities SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_OPPORTUNITY', targetType: 'Opportunity', targetId: row.id, detail: { name: row.name } });
  ok(res, { id: row.id, deleted: true });
});

/** 推进前固定动作校验摘要（M3-R2） */
router.get('/opportunities/:id/advance-check', requirePermission('opportunity:view'), (req, res) => {
  loadOpportunity(req);
  ok(res, stageEngine.checkAdvance(req.params.id));
});

/** 阶段推进（M3-R2） */
router.post('/opportunities/:id/advance', requirePermission('opportunity:update'), (req, res) => {
  loadOpportunity(req);
  const result = stageEngine.advance(req.params.id, bodyOf(req), req);
  ok(res, { opportunity: result.opportunity, evaluation: result.evaluation });
});

/** 阶段回退（M3-R3，仅管理层） */
router.post('/opportunities/:id/rollback', requirePermission('opportunity:rollback'), (req, res) => {
  loadOpportunity(req);
  const body = bodyOf(req);
  const result = stageEngine.rollback(req.params.id, { to_stage: body.to_stage, reason: body.reason }, req);
  ok(res, result);
});

/** 赢单关闭（M3-R4，可同时落合同） */
router.post('/opportunities/:id/close-win', requirePermission('opportunity:update'), (req, res) => {
  loadOpportunity(req);
  ok(res, stageEngine.closeWin(req.params.id, bodyOf(req), req));
});

/** 失败关闭（M3-R5/M8-R1，生成失效申请） */
router.post('/opportunities/:id/close-loss', requirePermission('opportunity:update'), (req, res) => {
  loadOpportunity(req);
  ok(res, stageEngine.closeLoss(req.params.id, bodyOf(req), req));
});

/** 阶段变更历史（时间轴） */
router.get('/opportunities/:id/timeline', requirePermission('opportunity:view'), (req, res) => {
  loadOpportunity(req);
  ok(res, stageEngine.timeline(req.params.id));
});

/** 阶段进度条数据 */
router.get('/opportunities/:id/stage-progress', requirePermission('opportunity:view'), (req, res) => {
  loadOpportunity(req);
  ok(res, stageEngine.stageProgress(req.params.id));
});

/** 商机转公海（P14 更多菜单 / M6-R5） */
router.post('/opportunities/:id/release-to-sea', requirePermission('opportunity:update'), (req, res) => {
  const row = loadOpportunity(req);
  const reason = requireString(bodyOf(req), 'reason', '转公海原因');
  const record = seaService.moveToSea({
    entityType: 'opportunity', entityId: row.id, reason, source: 'manual', user: req.user,
  });
  logOperation(req, { action: 'RELEASE_OPPORTUNITY_TO_SEA', targetType: 'Opportunity', targetId: row.id, detail: { reason } });
  ok(res, record);
});

/** 批量操作：转移负责人 / 转公海 / 删除（单次最多 200 条，逐条校验数据权限） */
router.post('/opportunities/batch', requireAnyPermission(['opportunity:update', 'opportunity:delete']), (req, res) => {
  const body = bodyOf(req);
  const action = requireString(body, 'action', '批量操作类型');
  if (!['transfer', 'release_to_sea', 'delete'].includes(action)) throw badRequest('不支持的批量操作');
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
  if (!ids.length) throw badRequest('ids 为必填数组');
  if (ids.length > 200) throw badRequest('单次最多处理 200 个商机');

  const needPerm = action === 'delete' ? 'opportunity:delete' : 'opportunity:update';
  if (!req.user.isAdmin && !req.user.permissions.has(needPerm)) throw forbidden('无权执行该批量操作');

  let ownerId = null;
  let reason = null;
  if (action === 'transfer') {
    ownerId = requireString(body, 'owner_id', '负责人');
    const owner = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'enabled' AND is_deleted = 0").get(ownerId);
    if (!owner) throw badRequest('负责人不存在或已停用');
  }
  if (action === 'release_to_sea') reason = requireString(body, 'reason', '转公海原因');

  const success = [];
  const failed = [];
  ids.forEach((id) => {
    const row = dataScope.findScoped('opportunity', 'opportunities', id, req.user);
    if (!row) {
      failed.push({ id, reason: '商机不存在或无权操作' });
      return;
    }
    try {
      if (action === 'transfer') {
        db.prepare('UPDATE opportunities SET owner_id = ?, updated_at = ? WHERE id = ?').run(ownerId, now(), id);
      } else if (action === 'release_to_sea') {
        seaService.moveToSea({ entityType: 'opportunity', entityId: id, reason, source: 'manual', user: req.user });
      } else {
        db.prepare('UPDATE opportunities SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), id);
      }
      success.push(id);
    } catch (e) {
      failed.push({ id, reason: e.message });
    }
  });
  logOperation(req, {
    action: `BATCH_${action.toUpperCase()}`,
    targetType: 'Opportunity',
    targetId: null,
    detail: { action, success: success.length, failed: failed.length },
  });
  ok(res, { action, success, failed });
});

module.exports = router;
