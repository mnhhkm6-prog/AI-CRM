'use strict';

/**
 * M8 商机失效（P25/P26）
 * 覆盖：失效记录查询/详情、失效审批（通过/驳回）、标记可挽回
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, getPaging, paged, buildSort, requireString, optional, bodyOf } = require('../utils/http');
const { notFound } = require('../utils/errors');
const { now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const stageEngine = require('../services/stageEngine');
const { logOperation } = require('../services/operationLog');

/** 把商机数据权限片段中的 owner_id 归属到商机别名 o */
function opportunityScopeClause(user) {
  const frag = dataScope.scopeFragment(user, 'opportunity');
  const sql = frag.sql.replace(/^ AND /, '').replace(/(^|\s)owner_id(\s)/g, '$1o.owner_id$2');
  return { sql, params: frag.params };
}

/** 取失效记录并校验其所属商机可访问 */
function requireLossRecord(req, id) {
  const record = db.prepare('SELECT * FROM loss_records WHERE id = ?').get(id);
  if (!record) throw notFound('失效记录不存在');
  const opp = dataScope.findScoped('opportunity', 'opportunities', record.opportunity_id, req.user);
  if (!opp) throw notFound('失效记录不存在或无权访问');
  return { record, opportunity: opp };
}

/** 失效记录列表（M8-R4） */
router.get('/loss-records', requirePermission('loss:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['1 = 1'];
  const params = [];
  const scope = opportunityScopeClause(req.user);
  if (scope.sql) {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  ['approval_status', 'loss_reason'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.is_recoverable !== undefined) {
    conditions.push('t.is_recoverable = ?');
    params.push(req.query.is_recoverable === 'true' || req.query.is_recoverable === '1' ? 1 : 0);
  }
  if (req.query.start_date) {
    conditions.push('t.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.created_at <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }

  const where = conditions.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) c FROM loss_records t LEFT JOIN opportunities o ON o.id = t.opportunity_id WHERE ${where}`)
    .get(...params).c;
  const sort = buildSort(req, ['created_at', 'updated_at', 'approved_at'], 'created_at');
  const orderClause = sort.clause.replace('ORDER BY ', 'ORDER BY t.');
  const list = db
    .prepare(
      `SELECT t.*, o.name AS opportunity_name, o.owner_id AS owner_id, o.status AS opportunity_status,
              sub.name AS submitted_by_name, app.name AS approved_by_name, c.name AS customer_name
       FROM loss_records t
       LEFT JOIN opportunities o ON o.id = t.opportunity_id
       LEFT JOIN users sub ON sub.id = t.submitted_by
       LEFT JOIN users app ON app.id = t.approved_by
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ${where}${orderClause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

/** 失效记录详情 */
router.get('/loss-records/:id', requirePermission('loss:view'), (req, res) => {
  const { record, opportunity } = requireLossRecord(req, req.params.id);
  const customer = opportunity.customer_id
    ? db.prepare('SELECT id, name FROM customers WHERE id = ?').get(opportunity.customer_id)
    : null;
  const submittedByName = record.submitted_by
    ? (db.prepare('SELECT name FROM users WHERE id = ?').get(record.submitted_by) || {}).name
    : null;
  const approvedByName = record.approved_by
    ? (db.prepare('SELECT name FROM users WHERE id = ?').get(record.approved_by) || {}).name
    : null;
  ok(res, {
    ...record,
    submitted_by_name: submittedByName,
    approved_by_name: approvedByName,
    opportunity: {
      id: opportunity.id,
      name: opportunity.name,
      status: opportunity.status,
      stage_name_snapshot: opportunity.stage_name_snapshot,
      owner_id: opportunity.owner_id,
      amount: opportunity.amount,
    },
    customer,
  });
});

/** 审批通过（M8-R2，商机转失效终态） */
router.post('/loss-records/:id/approve', requirePermission('loss:approve'), (req, res) => {
  requireLossRecord(req, req.params.id);
  const result = stageEngine.approveLoss(req.params.id, bodyOf(req), req);
  ok(res, { loss_record: result.loss_record, opportunity: result.opportunity });
});

/** 驳回 */
router.post('/loss-records/:id/reject', requirePermission('loss:approve'), (req, res) => {
  requireLossRecord(req, req.params.id);
  ok(res, stageEngine.rejectLoss(req.params.id, bodyOf(req), req));
});

/** 标记可挽回 + 安排跟进（M8-R5） */
router.post('/loss-records/:id/mark-recoverable', requirePermission('loss:update'), (req, res) => {
  const { record } = requireLossRecord(req, req.params.id);
  const body = bodyOf(req);
  const recoveryPlan = requireString(body, 'recovery_plan', '挽回计划');
  db.prepare('UPDATE loss_records SET is_recoverable = 1, recovery_plan = ?, follow_up_date = ?, updated_at = ? WHERE id = ?').run(
    recoveryPlan, optional(body, 'follow_up_date'), now(), record.id
  );
  logOperation(req, { action: 'MARK_LOSS_RECOVERABLE', targetType: 'LossRecord', targetId: record.id, detail: { opportunity_id: record.opportunity_id } });
  ok(res, db.prepare('SELECT * FROM loss_records WHERE id = ?').get(record.id));
});

module.exports = router;
