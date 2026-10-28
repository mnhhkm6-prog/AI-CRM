'use strict';

/**
 * M18 通用审批流引擎
 * - 流程模板按业务类型 + 条件匹配，优先级数字越小越优先，命中一条即走该流程
 * - 节点顺序执行，支持或签（any）/ 会签（all），审批人来源：指定用户 / 指定角色
 * - 业务侧只需在提交动作调用 startFor()，引擎负责实例、任务、状态回写与通知
 */
const { db } = require('../db');
const { newId, now } = require('../utils/ids');
const { badRequest, notFound, conflict, forbidden } = require('../utils/errors');
const { logOperation } = require('./operationLog');
const notification = require('./notification');

const BIZ_TYPES = {
  quotation: { label: '报价', table: 'quotations' },
  contract: { label: '合同', table: 'contracts' },
};

const CONDITION_FIELDS = {
  amount: '金额',
  discount_rate: '折扣率',
  opportunity_amount: '商机金额',
};

const OPERATORS = ['<', '<=', '>', '>=', '==', '!='];

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function requireBizType(bizType) {
  const biz = BIZ_TYPES[bizType];
  if (!biz) throw badRequest('biz_type 仅支持 quotation、contract');
  return biz;
}

function compare(actual, op, expected) {
  if (actual === null || actual === undefined || actual === '') return false;
  const a = Number(actual);
  const b = Number(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

function conditionsMatch(conditions, ctx) {
  if (!Array.isArray(conditions) || !conditions.length) return true;
  return conditions.every((c) => c && compare(ctx[c.field], c.op, c.value));
}

function validateConditions(conditions) {
  if (!Array.isArray(conditions) || !conditions.length) throw badRequest('至少配置一个触发条件');
  conditions.forEach((c) => {
    if (!c || !CONDITION_FIELDS[c.field]) throw badRequest(`条件字段不支持：${c && c.field}`);
    if (!OPERATORS.includes(c.op)) throw badRequest(`条件运算符不支持：${c && c.op}`);
    if (c.value === undefined || c.value === null || c.value === '' || Number.isNaN(Number(c.value))) {
      throw badRequest('条件阈值必须填写数字');
    }
  });
}

/** 命中优先级最高的启用流程 */
function matchFlow(bizType, ctx) {
  const flows = db
    .prepare('SELECT * FROM approval_flows WHERE biz_type = ? AND is_deleted = 0 AND is_enabled = 1')
    .all(bizType);
  const matched = flows.filter((f) => conditionsMatch(parseJson(f.conditions_json, []), ctx));
  matched.sort((a, b) => (a.priority - b.priority) || String(b.updated_at).localeCompare(String(a.updated_at)));
  return matched[0] || null;
}

function resolveApprovers(node) {
  const values = parseJson(node.approver_values, []);
  if (node.approver_type === 'user') {
    if (!values.length) return [];
    const marks = values.map(() => '?').join(',');
    return db
      .prepare(`SELECT id FROM users WHERE is_deleted = 0 AND status = 'enabled' AND id IN (${marks})`)
      .all(...values)
      .map((r) => r.id);
  }
  if (node.approver_type === 'role') {
    if (!values.length) return [];
    const marks = values.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.is_deleted = 0 AND u.status = 'enabled' AND r.role_code IN (${marks})`
      )
      .all(...values)
      .map((r) => r.id);
  }
  return [];
}

function flowNodes(flowId) {
  return db
    .prepare("SELECT * FROM approval_flow_nodes WHERE flow_id = ? AND node_type = 'approval' ORDER BY sort_order, created_at")
    .all(flowId);
}

function setBusinessStatus(bizType, bizId, status, instanceId) {
  const biz = requireBizType(bizType);
  db.prepare(`UPDATE ${biz.table} SET approval_status = ?, approval_instance_id = ?, updated_at = ? WHERE id = ?`)
    .run(status, instanceId, now(), bizId);
}

function businessInfo(bizType, bizId) {
  if (bizType === 'quotation') {
    const row = db
      .prepare(
        `SELECT q.*, o.name AS opportunity_name, o.amount AS opportunity_amount, o.customer_id, c.name AS customer_name
         FROM quotations q
         JOIN opportunities o ON o.id = q.opportunity_id
         LEFT JOIN customers c ON c.id = o.customer_id
         WHERE q.id = ? AND q.is_deleted = 0`
      )
      .get(bizId);
    if (!row) throw notFound('报价不存在');
    const discountRate = Number(row.opportunity_amount) > 0 ? Number(row.amount) / Number(row.opportunity_amount) : null;
    return {
      row,
      ctx: { amount: Number(row.amount), discount_rate: discountRate, opportunity_amount: Number(row.opportunity_amount) },
      summary: `${row.quotation_type === 'final' ? '最终报价' : '初步报价'} ${Number(row.amount).toLocaleString('zh-CN')} 元`,
      snapshot: {
        quotation_type: row.quotation_type,
        amount: row.amount,
        opportunity_amount: row.opportunity_amount,
        discount_rate: discountRate,
        opportunity_id: row.opportunity_id,
        opportunity_name: row.opportunity_name,
        customer_name: row.customer_name,
      },
    };
  }
  if (bizType === 'contract') {
    const row = db
      .prepare(
        `SELECT ct.*, o.name AS opportunity_name, c.name AS customer_name
         FROM contracts ct
         LEFT JOIN opportunities o ON o.id = ct.opportunity_id
         LEFT JOIN customers c ON c.id = ct.customer_id
         WHERE ct.id = ? AND ct.is_deleted = 0`
      )
      .get(bizId);
    if (!row) throw notFound('合同不存在');
    return {
      row,
      ctx: { amount: Number(row.amount) },
      summary: `${row.contract_no} · ${Number(row.amount).toLocaleString('zh-CN')} 元`,
      snapshot: {
        contract_no: row.contract_no,
        contract_name: row.contract_name,
        amount: row.amount,
        opportunity_id: row.opportunity_id,
        opportunity_name: row.opportunity_name,
        customer_name: row.customer_name,
      },
    };
  }
  throw badRequest('biz_type 仅支持 quotation、contract');
}

function notifyApprovers(instance, node, approvers) {
  approvers.forEach((userId) => {
    notification.push(userId, {
      category: 'approval',
      title: `审批待办：${instance.flow_name}`,
      content: instance.biz_summary,
      refType: 'approval',
      refId: instance.id,
      link: '/approvals',
      dedupKey: `approval:${instance.id}:${node.id}:${userId}`,
    });
  });
}

function notifySubmitter(instance, title, content) {
  if (!instance.submitted_by) return;
  notification.push(instance.submitted_by, {
    category: 'approval',
    title,
    content,
    refType: 'approval',
    refId: instance.id,
    link: '/approvals',
    dedupKey: `approval-result:${instance.id}:${instance.status}`,
  });
}

/** 激活节点；无可用审批人时顺延，全部节点都无审批人则自动通过 */
function activateNode(instanceId, nodeIndex) {
  const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(instanceId);
  const nodes = flowNodes(instance.flow_id);
  if (nodeIndex >= nodes.length) {
    finishInstance(instance, 'approved');
    return;
  }
  const node = nodes[nodeIndex];
  const approvers = resolveApprovers(node);
  if (!approvers.length) {
    activateNode(instanceId, nodeIndex + 1);
    return;
  }
  const t = now();
  const ins = db.prepare(
    `INSERT INTO approval_tasks (id, instance_id, node_id, node_name, node_index, approve_mode, approver_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  );
  approvers.forEach((userId) => ins.run(newId(), instance.id, node.id, node.node_name, nodeIndex, node.approve_mode, userId, t, t));
  db.prepare(
    'UPDATE approval_instances SET current_node_id = ?, current_node_name = ?, status = ?, updated_at = ? WHERE id = ?'
  ).run(node.id, node.node_name, 'pending', t, instance.id);
  notifyApprovers(instance, node, approvers);
}

function finishInstance(instance, status) {
  const t = now();
  db.prepare(
    'UPDATE approval_instances SET status = ?, current_node_id = NULL, current_node_name = NULL, completed_at = ?, updated_at = ? WHERE id = ?'
  ).run(status, t, t, instance.id);
  setBusinessStatus(instance.biz_type, instance.biz_id, status, instance.id);
  const label = status === 'approved' ? '审批已通过' : status === 'rejected' ? '审批已驳回' : '审批已撤销';
  notifySubmitter(instance, `${label}：${instance.flow_name}`, instance.biz_summary);
}

/**
 * 为业务对象发起审批。
 * 返回 null 表示没有命中任何流程（业务不需要审批）。
 */
function startFor(bizType, bizId, req) {
  requireBizType(bizType);
  const existing = db
    .prepare("SELECT id FROM approval_instances WHERE biz_type = ? AND biz_id = ? AND status = 'pending'")
    .get(bizType, bizId);
  if (existing) return db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(existing.id);

  const info = businessInfo(bizType, bizId);
  const flow = matchFlow(bizType, info.ctx);
  if (!flow) return null;
  if (!flowNodes(flow.id).length) return null;

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO approval_instances (id, flow_id, flow_name, flow_version, biz_type, biz_id, biz_summary, business_snapshot,
      status, submitted_by, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    id, flow.id, flow.name, flow.version || 1, bizType, bizId, info.summary,
    JSON.stringify(info.snapshot), req && req.user ? req.user.id : null, t, t, t
  );
  setBusinessStatus(bizType, bizId, 'pending', id);
  logOperation(req, {
    action: 'SUBMIT_APPROVAL',
    targetType: 'ApprovalInstance',
    targetId: id,
    detail: { biz_type: bizType, biz_id: bizId, flow: flow.name },
  });
  activateNode(id, 0);
  return db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id);
}

/** 审批通过：当前节点或签任一人通过 / 会签全部通过后进入下一节点 */
function approve(instanceId, user, comment) {
  const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(instanceId);
  if (!instance) throw notFound('审批实例不存在');
  if (instance.status !== 'pending') throw badRequest('该审批已结束，无需重复处理');
  const task = db
    .prepare("SELECT * FROM approval_tasks WHERE instance_id = ? AND node_id = ? AND approver_id = ? AND status = 'pending'")
    .get(instanceId, instance.current_node_id, user.id);
  if (!task) throw forbidden('当前账号不是该节点的审批人');

  const t = now();
  db.prepare("UPDATE approval_tasks SET status = 'approved', comment = ?, handled_at = ?, updated_at = ? WHERE id = ?")
    .run(comment || null, t, t, task.id);

  if (task.approve_mode === 'all') {
    const remain = db
      .prepare("SELECT COUNT(*) c FROM approval_tasks WHERE instance_id = ? AND node_id = ? AND status = 'pending'")
      .get(instanceId, instance.current_node_id).c;
    if (remain > 0) {
      logOperation({ user }, { action: 'APPROVE_TASK', targetType: 'ApprovalInstance', targetId: instanceId, detail: { node: task.node_name, comment } });
      return { status: 'pending', current_node: instance.current_node_name };
    }
  } else {
    db.prepare(
      "UPDATE approval_tasks SET status = 'skipped', handled_at = ?, updated_at = ? WHERE instance_id = ? AND node_id = ? AND status = 'pending'"
    ).run(t, t, instanceId, instance.current_node_id);
  }

  logOperation({ user }, { action: 'APPROVE_TASK', targetType: 'ApprovalInstance', targetId: instanceId, detail: { node: task.node_name, comment } });
  activateNode(instanceId, Number(task.node_index) + 1);
  const latest = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(instanceId);
  return { status: latest.status, current_node: latest.current_node_name };
}

/** 驳回：任一节点驳回即终止 */
function reject(instanceId, user, comment) {
  if (!comment || !String(comment).trim()) throw badRequest('驳回意见为必填项');
  const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(instanceId);
  if (!instance) throw notFound('审批实例不存在');
  if (instance.status !== 'pending') throw badRequest('该审批已结束，无需重复处理');
  const task = db
    .prepare("SELECT * FROM approval_tasks WHERE instance_id = ? AND approver_id = ? AND status = 'pending'")
    .get(instanceId, user.id);
  if (!task) throw forbidden('当前账号不是该审批的审批人');

  const t = now();
  db.prepare("UPDATE approval_tasks SET status = 'rejected', comment = ?, handled_at = ?, updated_at = ? WHERE id = ?")
    .run(comment.trim(), t, t, task.id);
  db.prepare(
    "UPDATE approval_tasks SET status = 'skipped', handled_at = ?, updated_at = ? WHERE instance_id = ? AND status = 'pending'"
  ).run(t, t, instanceId);
  finishInstance(instance, 'rejected');
  logOperation({ user }, { action: 'REJECT_APPROVAL', targetType: 'ApprovalInstance', targetId: instanceId, detail: { comment } });
  return { status: 'rejected' };
}

/** 撤回：仅发起人（或管理员）可撤回进行中的审批 */
function cancel(instanceId, user) {
  const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(instanceId);
  if (!instance) throw notFound('审批实例不存在');
  if (instance.status !== 'pending') throw badRequest('该审批已结束，无法撤回');
  if (!user.isAdmin && instance.submitted_by !== user.id) throw forbidden('只有发起人可以撤回审批');
  const t = now();
  db.prepare(
    "UPDATE approval_tasks SET status = 'skipped', handled_at = ?, updated_at = ? WHERE instance_id = ? AND status = 'pending'"
  ).run(t, t, instanceId);
  finishInstance(instance, 'canceled');
  setBusinessStatus(instance.biz_type, instance.biz_id, 'canceled', null);
  logOperation({ user }, { action: 'CANCEL_APPROVAL', targetType: 'ApprovalInstance', targetId: instanceId });
  return { status: 'canceled' };
}

/** 被驳回后重新发起（业务数据修正后调用） */
function resubmit(bizType, bizId, req) {
  const pending = db
    .prepare("SELECT id FROM approval_instances WHERE biz_type = ? AND biz_id = ? AND status = 'pending'")
    .get(bizType, bizId);
  if (pending) throw conflict('该业务已有进行中的审批');
  const biz = requireBizType(bizType);
  const row = db.prepare(`SELECT id FROM ${biz.table} WHERE id = ? AND is_deleted = 0`).get(bizId);
  if (!row) throw notFound(`${biz.label}不存在`);
  setBusinessStatus(bizType, bizId, 'none', null);
  return startFor(bizType, bizId, req);
}

/** 审批中心列表（新引擎部分，由 M17 合并旧审批后统一分页） */
function center(user, { tab = 'pending', type = '' } = {}) {
  const params = [];
  let sql;
  if (tab === 'pending') {
    sql = `SELECT t.id AS task_id, t.status AS task_status, i.*
           FROM approval_tasks t JOIN approval_instances i ON i.id = t.instance_id
           WHERE t.approver_id = ? AND t.status = 'pending' AND i.status = 'pending'`;
    params.push(user.id);
  } else if (tab === 'done') {
    sql = `SELECT t.id AS task_id, t.status AS task_status, i.*
           FROM approval_tasks t JOIN approval_instances i ON i.id = t.instance_id
           WHERE t.approver_id = ? AND t.status IN ('approved', 'rejected')`;
    params.push(user.id);
  } else {
    sql = `SELECT NULL AS task_id, NULL AS task_status, i.*
           FROM approval_instances i WHERE i.submitted_by = ?`;
    params.push(user.id);
  }
  if (type) {
    sql += ' AND i.biz_type = ?';
    params.push(type);
  }
  sql += ' ORDER BY i.created_at DESC';

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => {
    const snapshot = parseJson(row.business_snapshot, {});
    const approverNames = db
      .prepare(
        `SELECT u.name, t.status FROM approval_tasks t JOIN users u ON u.id = t.approver_id
         WHERE t.instance_id = ? ORDER BY t.node_index, t.created_at`
      )
      .all(row.id);
    const handled = approverNames.filter((a) => a.status === 'approved').map((a) => a.name);
    const applicant = row.submitted_by
      ? (db.prepare('SELECT name FROM users WHERE id = ?').get(row.submitted_by) || {}).name
      : null;
    return {
      type: row.biz_type,
      id: row.id,
      instance_id: row.id,
      task_id: row.task_id,
      flow_name: row.flow_name,
      status: row.status,
      task_status: row.task_status,
      opportunity_id: snapshot.opportunity_id || null,
      opportunity_name: snapshot.opportunity_name || null,
      customer_name: snapshot.customer_name || null,
      summary: row.biz_summary,
      detail: snapshot.contract_no ? `合同编号：${snapshot.contract_no}` : null,
      extra: {
        amount: snapshot.amount,
        discount_rate: snapshot.discount_rate,
        quotation_type: snapshot.quotation_type,
      },
      applicant_id: row.submitted_by,
      applicant_name: applicant,
      approver_name: row.current_node_name || (handled.length ? handled.join('、') : null),
      comment: null,
      created_at: row.created_at,
      approved_at: row.completed_at,
      biz_id: row.biz_id,
      can_handle: tab === 'pending',
    };
  });
}

function pendingCountFor(user) {
  return db
    .prepare(
      `SELECT COUNT(*) c FROM approval_tasks t JOIN approval_instances i ON i.id = t.instance_id
       WHERE t.approver_id = ? AND t.status = 'pending' AND i.status = 'pending'`
    )
    .get(user.id).c;
}

function detail(instanceId) {
  const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(instanceId);
  if (!instance) throw notFound('审批实例不存在');
  const tasks = db
    .prepare(
      `SELECT t.*, u.name AS approver_name FROM approval_tasks t
       LEFT JOIN users u ON u.id = t.approver_id
       WHERE t.instance_id = ? ORDER BY t.node_index, t.created_at`
    )
    .all(instanceId);
  return { ...instance, snapshot: parseJson(instance.business_snapshot, {}), tasks };
}

module.exports = {
  BIZ_TYPES,
  CONDITION_FIELDS,
  OPERATORS,
  validateConditions,
  matchFlow,
  startFor,
  approve,
  reject,
  cancel,
  resubmit,
  center,
  pendingCountFor,
  detail,
  businessInfo,
  setBusinessStatus,
};
