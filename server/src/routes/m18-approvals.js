'use strict';

/**
 * M18 审批流配置与审批操作
 * - 流程模板 CRUD（条件 + 节点 + 审批人）
 * - 审批实例：通过 / 驳回 / 撤回 / 重新发起
 * - 待办聚合在 M17 /approvals 中与失效、停滞审批统一返回
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, getPaging, paged, requireString, optional, bodyOf } = require('../utils/http');
const { badRequest, notFound, forbidden } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const approvalFlow = require('../services/approvalFlow');
const { logOperation } = require('../services/operationLog');

const BIZ_TYPES = {
  quotation: '报价',
  contract: '合同',
};

function loadFlow(id) {
  const flow = db.prepare('SELECT * FROM approval_flows WHERE id = ? AND is_deleted = 0').get(id);
  if (!flow) throw notFound('审批流不存在');
  return flow;
}

function parseFlow(flow) {
  let conditions = [];
  try {
    conditions = flow.conditions_json ? JSON.parse(flow.conditions_json) : [];
  } catch (e) {
    conditions = [];
  }
  const nodes = db
    .prepare('SELECT * FROM approval_flow_nodes WHERE flow_id = ? ORDER BY sort_order, created_at')
    .all(flow.id)
    .map((n) => {
      let values = [];
      try {
        values = n.approver_values ? JSON.parse(n.approver_values) : [];
      } catch (e) {
        values = [];
      }
      return { ...n, approver_values: values };
    });
  return { ...flow, conditions, nodes, node_count: nodes.length };
}

function validateNode(node, index) {
  if (!node || !String(node.node_name || '').trim()) throw badRequest(`第 ${index + 1} 个节点缺少节点名称`);
  if (!['any', 'all'].includes(node.approve_mode || 'any')) throw badRequest('审批方式仅支持 any（或签）或 all（会签）');
  if (!['user', 'role'].includes(node.approver_type)) throw badRequest('审批人来源仅支持 user 或 role');
  if (!Array.isArray(node.approver_values) || !node.approver_values.length) {
    throw badRequest(`第 ${index + 1} 个节点未选择审批人`);
  }
}

function validatePayload(body) {
  const name = requireString(body, 'name', '审批流名称');
  const bizType = requireString(body, 'biz_type', '业务类型');
  if (!BIZ_TYPES[bizType]) throw badRequest('业务类型仅支持 quotation、contract');
  approvalFlow.validateConditions(body.conditions);
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  if (!nodes.length) throw badRequest('至少配置一个审批节点');
  nodes.forEach(validateNode);
  return {
    name,
    bizType,
    description: optional(body, 'description'),
    priority: Number.isFinite(Number(body.priority)) && Number(body.priority) > 0 ? Number(body.priority) : 100,
    isEnabled: body.is_enabled === undefined ? 1 : Number(body.is_enabled) ? 1 : 0,
    conditions: body.conditions,
    nodes,
  };
}

// ---------------------------------------------------------------- 流程配置
router.get('/approval-flows', requirePermission('approval:manage'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['is_deleted = 0'];
  const params = [];
  if (req.query.biz_type) {
    conditions.push('biz_type = ?');
    params.push(req.query.biz_type);
  }
  if (req.query.keyword) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM approval_flows WHERE ${where}`).get(...params).c;
  const rows = db
    .prepare(`SELECT * FROM approval_flows WHERE ${where} ORDER BY biz_type, priority, created_at LIMIT ? OFFSET ?`)
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(rows.map(parseFlow), total, paging));
});

router.get('/approval-options', requirePermission('approval:manage'), (req, res) => {
  const roles = db
    .prepare(
      `SELECT r.role_code AS code, r.role_name AS name FROM roles r
       WHERE r.is_enabled = 1 ORDER BY r.sort_order`
    )
    .all();
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.username, r.role_code FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.is_deleted = 0 AND u.status = 'enabled' ORDER BY u.created_at`
    )
    .all();
  ok(res, {
    biz_types: Object.entries(BIZ_TYPES).map(([code, name]) => ({ code, name })),
    fields: Object.entries(approvalFlow.CONDITION_FIELDS).map(([code, name]) => ({ code, name })),
    operators: approvalFlow.OPERATORS,
    roles,
    users,
  });
});

router.get('/approval-flows/:id', requirePermission('approval:manage'), (req, res) => {
  ok(res, parseFlow(loadFlow(req.params.id)));
});

router.post('/approval-flows', requirePermission('approval:manage'), (req, res) => {
  const data = validatePayload(bodyOf(req));
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO approval_flows (id, name, biz_type, description, priority, is_enabled, conditions_json, version, created_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`
  ).run(
    id, data.name, data.bizType, data.description, data.priority, data.isEnabled,
    JSON.stringify(data.conditions), req.user.id, t, t
  );
  const insNode = db.prepare(
    `INSERT INTO approval_flow_nodes (id, flow_id, node_name, sort_order, node_type, approve_mode, approver_type, approver_values, timeout_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'approval', ?, ?, ?, ?, ?, ?)`
  );
  data.nodes.forEach((n, i) => {
    insNode.run(
      newId(), id, String(n.node_name).trim(), (i + 1) * 10, n.approve_mode || 'any', n.approver_type,
      JSON.stringify(n.approver_values), Number(n.timeout_hours) || null, t, t
    );
  });
  logOperation(req, {
    action: 'CREATE_APPROVAL_FLOW', targetType: 'ApprovalFlow', targetId: id,
    detail: { name: data.name, biz_type: data.bizType, conditions: data.conditions },
  });
  created(res, parseFlow(loadFlow(id)));
});

router.put('/approval-flows/:id', requirePermission('approval:manage'), (req, res) => {
  const flow = loadFlow(req.params.id);
  const data = validatePayload(bodyOf(req));
  const t = now();
  db.prepare(
    `UPDATE approval_flows SET name = ?, biz_type = ?, description = ?, priority = ?, is_enabled = ?,
       conditions_json = ?, version = version + 1, updated_at = ? WHERE id = ?`
  ).run(
    data.name, data.bizType, data.description, data.priority, data.isEnabled,
    JSON.stringify(data.conditions), t, flow.id
  );
  db.prepare('DELETE FROM approval_flow_nodes WHERE flow_id = ?').run(flow.id);
  const insNode = db.prepare(
    `INSERT INTO approval_flow_nodes (id, flow_id, node_name, sort_order, node_type, approve_mode, approver_type, approver_values, timeout_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'approval', ?, ?, ?, ?, ?, ?)`
  );
  data.nodes.forEach((n, i) => {
    insNode.run(
      newId(), flow.id, String(n.node_name).trim(), (i + 1) * 10, n.approve_mode || 'any', n.approver_type,
      JSON.stringify(n.approver_values), Number(n.timeout_hours) || null, t, t
    );
  });
  logOperation(req, { action: 'UPDATE_APPROVAL_FLOW', targetType: 'ApprovalFlow', targetId: flow.id, detail: { name: data.name } });
  ok(res, parseFlow(loadFlow(flow.id)));
});

router.delete('/approval-flows/:id', requirePermission('approval:manage'), (req, res) => {
  const flow = loadFlow(req.params.id);
  db.prepare('UPDATE approval_flows SET is_deleted = 1, is_enabled = 0, updated_at = ? WHERE id = ?').run(now(), flow.id);
  logOperation(req, { action: 'DELETE_APPROVAL_FLOW', targetType: 'ApprovalFlow', targetId: flow.id });
  ok(res, { id: flow.id, deleted: true });
});

// ---------------------------------------------------------------- 审批实例
router.get('/approval-instances/:id', requirePermission('approval:view'), (req, res) => {
  const data = approvalFlow.detail(req.params.id);
  const isRelated =
    req.user.isAdmin ||
    data.submitted_by === req.user.id ||
    db.prepare('SELECT 1 FROM approval_tasks WHERE instance_id = ? AND approver_id = ?').get(data.id, req.user.id);
  if (!isRelated) throw forbidden('无权查看该审批');
  ok(res, data);
});

router.post('/approval-instances/:id/approve', requirePermission('approval:approve'), (req, res) => {
  const body = bodyOf(req);
  const result = approvalFlow.approve(req.params.id, req.user, optional(body, 'comment'));
  ok(res, result);
});

router.post('/approval-instances/:id/reject', requirePermission('approval:approve'), (req, res) => {
  const body = bodyOf(req);
  const result = approvalFlow.reject(req.params.id, req.user, optional(body, 'comment'));
  ok(res, result);
});

router.post('/approval-instances/:id/cancel', requirePermission('approval:view'), (req, res) => {
  ok(res, approvalFlow.cancel(req.params.id, req.user));
});

router.post('/approval-instances/resubmit', requirePermission('approval:view'), (req, res) => {
  const body = bodyOf(req);
  const bizType = requireString(body, 'biz_type', '业务类型');
  const bizId = requireString(body, 'biz_id', '业务 ID');
  const instance = approvalFlow.resubmit(bizType, bizId, req);
  ok(res, instance || { submitted: false, message: '当前数据未命中审批条件，无需审批' });
});

module.exports = router;
