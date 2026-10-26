'use strict';

/**
 * 阶段流转引擎 + 固定动作校验引擎（PRD 4.5 / 4.6.3 / 15.2.3）
 * 校验规则全部从 StageActionRule 配置读取并解释执行，不硬编码阶段名。
 * 硬编码底线（4.6.3 / 15.2.6）：
 *   1) 只能逐级推进，不可跳阶段；回退需管理层权限并填写原因；
 *   2) 核心字段白名单（商机名称、客户、负责人）始终必填；
 *   3) WIN / LOSS 为内置终态，终态后不可再变更阶段；
 *   4) 每次流转写入 StageHistory，不允许业务代码绕过。
 */
const { db } = require('../db');
const { newId, now, newBizNo } = require('../utils/ids');
const { CODE, badRequest, notFound, conflict, forbidden } = require('../utils/errors');
const customField = require('./customField');
const approvalFlow = require('./approvalFlow');
const { logOperation } = require('./operationLog');

/** 核心字段白名单：无论配置如何，这些都必须在推进前具备 */
const CORE_FIELDS = [
  { key: 'name', name: '商机名称' },
  { key: 'customer_id', name: '所属客户' },
  { key: 'owner_id', name: '负责人' },
];

/** 关联字段 -> 名称来源表（校验摘要中展示可读名称，而非 UUID） */
const REF_TABLES = { customer_id: 'customers', owner_id: 'users', created_by: 'users' };

/** 将关联字段的值转成可读名称 */
function refLabel(fieldKey, value) {
  const table = REF_TABLES[fieldKey];
  if (!value || !table) return value;
  const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(value);
  return row ? row.name : value;
}

// ---------------------------------------------------------------- 阶段读取
function listStages({ includeDisabled = false } = {}) {
  const where = includeDisabled ? '' : 'WHERE is_enabled = 1';
  return db.prepare(`SELECT * FROM stage_configs ${where} ORDER BY sort_order`).all();
}

const orderedEnabledStages = () => listStages();

const getById = (id) => db.prepare('SELECT * FROM stage_configs WHERE id = ?').get(id) || null;
const getByCode = (code) => db.prepare('SELECT * FROM stage_configs WHERE code = ?').get(code) || null;

function resolveStage(idOrCode) {
  if (!idOrCode) return null;
  return getById(idOrCode) || getByCode(idOrCode);
}

function requireStage(idOrCode, label = '阶段') {
  const s = resolveStage(idOrCode);
  if (!s) throw notFound(`${label}不存在`);
  return s;
}

/** 首个启用阶段（漏斗起点） */
const firstStage = () => orderedEnabledStages()[0] || null;

const isTerminal = (stage) => !!stage && stage.is_terminal === 1;

function nextStageOf(stage) {
  if (!stage) return null;
  const stages = orderedEnabledStages();
  const idx = stages.findIndex((s) => s.id === stage.id);
  if (idx === -1) return stages.find((s) => s.sort_order > stage.sort_order) || null;
  return stages[idx + 1] || null;
}

function rulesOf(stageId, { includeDisabled = false } = {}) {
  const where = includeDisabled ? '' : 'AND is_enabled = 1';
  return db
    .prepare(`SELECT * FROM stage_action_rules WHERE stage_config_id = ? ${where} ORDER BY sort_order`)
    .all(stageId);
}

// ---------------------------------------------------------------- 规则求值
/** 关联记录类固定动作（field_key 以 sys: 开头，由系统从关联数据派生） */
const SYS_CHECKS = {
  'sys:activity': (opp) => ({
    done: count('SELECT COUNT(*) c FROM activities WHERE opportunity_id = ? AND is_deleted = 0', opp.id) > 0,
    value: `${count('SELECT COUNT(*) c FROM activities WHERE opportunity_id = ? AND is_deleted = 0', opp.id)} 条行为记录`,
  }),
  'sys:activity_presales': (opp) => {
    const c = count(
      "SELECT COUNT(*) c FROM activities WHERE opportunity_id = ? AND is_deleted = 0 AND created_by_role IN ('presales','support','management')",
      opp.id
    );
    return { done: c > 0, value: `${c} 条售前/支撑行为记录` };
  },
  'sys:proposal_preliminary': (opp) => proposalCheck(opp, 'preliminary'),
  'sys:proposal_formal': (opp) => proposalCheck(opp, 'formal'),
  'sys:quotation': (opp) => quotationCheck(opp, null),
  'sys:quotation_final': (opp) => quotationCheck(opp, 'final'),
  'sys:product_price': (opp) => {
    const c = count('SELECT COUNT(*) c FROM product_prices WHERE is_deleted = 0');
    return { done: c > 0, value: `${c} 条产品价格记录` };
  },
  'sys:competitor': (opp) => {
    const c = count('SELECT COUNT(*) c FROM competitors WHERE opportunity_id = ? AND is_deleted = 0', opp.id);
    return { done: c > 0, value: `${c} 个竞争对手` };
  },
  'sys:contract': (opp) => {
    const c = count(
      "SELECT COUNT(*) c FROM contracts WHERE opportunity_id = ? AND is_deleted = 0 AND COALESCE(approval_status, 'none') IN ('none','approved')",
      opp.id
    );
    return { done: c > 0, value: `${c} 份合同` };
  },
  'sys:contract_amount': (opp) => {
    const row = db
      .prepare(
        "SELECT amount FROM contracts WHERE opportunity_id = ? AND is_deleted = 0 AND amount > 0 AND COALESCE(approval_status, 'none') IN ('none','approved') ORDER BY created_at DESC"
      )
      .get(opp.id);
    return { done: !!row, value: row ? row.amount : null };
  },
  'sys:contract_signed_date': (opp) => {
    const row = db
      .prepare(
        "SELECT signed_date FROM contracts WHERE opportunity_id = ? AND is_deleted = 0 AND signed_date IS NOT NULL AND signed_date <> '' AND COALESCE(approval_status, 'none') IN ('none','approved') ORDER BY created_at DESC"
      )
      .get(opp.id);
    return { done: !!row, value: row ? row.signed_date : null };
  },
  'sys:customer_contact': (opp) => {
    const c = count(
      "SELECT COUNT(*) c FROM contacts WHERE customer_id = ? AND is_deleted = 0 AND phone IS NOT NULL AND phone <> ''",
      opp.customer_id
    );
    return { done: c > 0, value: `${c} 个含电话的联系人` };
  },
};

function count(sql, ...params) {
  return db.prepare(sql).get(...params).c;
}

function proposalCheck(opp, type) {
  const c = count(
    'SELECT COUNT(*) c FROM proposals WHERE opportunity_id = ? AND proposal_type = ? AND is_deleted = 0',
    opp.id, type
  );
  return { done: c > 0, value: `${c} 份${type === 'formal' ? '正式' : '初步'}方案` };
}

function quotationCheck(opp, type) {
  const approved = "COALESCE(approval_status, 'none') IN ('none','approved')";
  const c = type
    ? count(
      `SELECT COUNT(*) c FROM quotations WHERE opportunity_id = ? AND quotation_type = ? AND is_deleted = 0 AND ${approved}`,
      opp.id, type
    )
    : count(`SELECT COUNT(*) c FROM quotations WHERE opportunity_id = ? AND is_deleted = 0 AND ${approved}`, opp.id);
  return { done: c > 0, value: `${c} 条${type === 'final' ? '最终' : ''}报价` };
}

/** 内置商机字段（可直接作为固定动作字段） */
const BUILTIN_FIELDS = ['name', 'customer_id', 'amount', 'expected_close_date', 'owner_id', 'remark', 'stage_config_id'];

/** 求单个规则当前是否已完成 */
function evaluateRule(opp, rule) {
  let done = false;
  let value = null;

  if (rule.field_key.startsWith('sys:')) {
    const fn = SYS_CHECKS[rule.field_key];
    if (fn) ({ done, value } = fn(opp));
  } else if (BUILTIN_FIELDS.includes(rule.field_key)) {
    const v = opp[rule.field_key];
    value = v === undefined ? null : v;
    done = v !== null && v !== undefined && String(v).trim() !== '' && !(typeof v === 'number' && v === 0);
    if (rule.field_key === 'amount' && rule.is_required === 1) done = Number(v) > 0;
  } else {
    const v = customField.valueOf('opportunity', opp.id, rule.field_key);
    value = v;
    done = v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0) && v !== false;
  }

  return {
    rule_id: rule.id,
    action_name: rule.action_name,
    field_key: rule.field_key,
    field_type: rule.field_type,
    is_required: rule.is_required,
    tip: rule.tip,
    value: REF_TABLES[rule.field_key] ? refLabel(rule.field_key, value) : value,
    done: !!done,
  };
}

/** 校验摘要：当前阶段所有启用规则 + 核心字段 */
function evaluate(opp, stage) {
  const items = [];
  CORE_FIELDS.forEach((f) => {
    const v = opp[f.key];
    items.push({
      rule_id: `core:${f.key}`,
      action_name: f.name,
      field_key: f.key,
      field_type: 'core',
      is_required: 1,
      done: !!(v && String(v).trim()),
      value: REF_TABLES[f.key] ? refLabel(f.key, v) : v || null,
      core: true,
    });
  });
  if (stage) rulesOf(stage.id).forEach((r) => items.push(evaluateRule(opp, r)));
  const required = items.filter((i) => i.is_required === 1);
  const missing = required.filter((i) => !i.done);
  return {
    items,
    missing,
    pass: missing.length === 0,
    completeness: `${required.length - missing.length}/${required.length}`,
  };
}

/** 推进前校验摘要（M3-R2 前端置灰联动） */
function checkAdvance(opportunityId) {
  const opp = getOpportunityOr404(opportunityId);
  const stage = getById(opp.stage_config_id);
  const target = nextStageOf(stage);
  const result = evaluate(opp, stage);
  return {
    opportunity_id: opp.id,
    stage: stage ? { id: stage.id, code: stage.code, name: stage.name } : null,
    next_stage: target ? { id: target.id, code: target.code, name: target.name, is_terminal: target.is_terminal } : null,
    ...result,
  };
}

// ---------------------------------------------------------------- 写操作
function getOpportunityOr404(id) {
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ? AND is_deleted = 0').get(id);
  if (!opp) throw notFound('商机不存在');
  return opp;
}

/** 按阶段同步辅状态（PRD 11.2.4 应用层 Hook） */
function statusOfStage(stage, isInSea = false) {
  if (isInSea) return '公海';
  if (!stage) return '进行中';
  if (stage.terminal_type === 'win') return '赢单';
  if (stage.terminal_type === 'loss') return '失败';
  return '进行中';
}

function syncStatus(opportunityId) {
  const opp = getOpportunityOr404(opportunityId);
  const stage = getById(opp.stage_config_id);
  const status = statusOfStage(stage, opp.is_in_sea === 1);
  db.prepare('UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), opp.id);
  return status;
}

function recordHistory(opp, fromStage, toStage, actionType, reason, req) {
  db.prepare(
    `INSERT INTO stage_history
      (id, opportunity_id, from_stage, from_stage_name, to_stage, to_stage_name, action_type, reason, config_version, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(), opp.id,
    fromStage ? fromStage.id : opp.stage_config_id, fromStage ? fromStage.name : opp.stage_name_snapshot,
    toStage ? toStage.id : null, toStage ? toStage.name : null,
    actionType, reason || null, toStage ? toStage.version : null,
    req && req.user ? req.user.id : null, now()
  );
}

/** 停滞预警解除 + 最后活动时间刷新（任何推进动作都算"有推进"） */
function touchOpportunity(opportunityId, req) {
  db.prepare('UPDATE opportunities SET last_activity_at = ?, updated_at = ? WHERE id = ?')
    .run(now(), now(), opportunityId);
  db.prepare('UPDATE stale_alerts SET is_resolved = 1, resolved_at = ?, resolved_by = ? WHERE opportunity_id = ? AND is_resolved = 0')
    .run(now(), req && req.user ? req.user.id : null, opportunityId);
  db.prepare("UPDATE stagnation_explains SET status = 'auto_closed', updated_at = ? WHERE opportunity_id = ? AND status = 'pending'")
    .run(now(), opportunityId);
}

/**
 * 阶段推进
 * @param {object} payload { to_stage, action_values, force, force_reason }
 */
function advance(opportunityId, payload, req) {
  const opp = getOpportunityOr404(opportunityId);
  const currentStage = getById(opp.stage_config_id);
  if (currentStage && currentStage.terminal_type) {
    throw badRequest('商机已处于终态，不可再变更阶段');
  }

  const target = payload.to_stage
    ? requireStage(payload.to_stage, '目标阶段')
    : nextStageOf(currentStage);
  if (!target) throw badRequest('未找到可推进的下一阶段');
  if (target.is_enabled !== 1) throw badRequest(`目标阶段「${target.name}」已停用，不可推进`);
  if (target.terminal_type === 'loss') {
    throw badRequest('进入失效终态请走失效申请流程：POST /opportunities/{id}/close-loss');
  }

  // 逐级推进校验（不允许跳阶段）
  const stages = orderedEnabledStages();
  const curIdx = stages.findIndex((s) => s.id === opp.stage_config_id);
  const tgtIdx = stages.findIndex((s) => s.id === target.id);
  if (curIdx !== -1 && tgtIdx !== curIdx + 1) {
    const allow = stages[curIdx + 1];
    throw badRequest(`阶段只能逐级推进，当前阶段的下一个阶段为「${allow ? allow.name : '—'}」`);
  }
  if (curIdx === -1) {
    const currentSort = currentStage ? currentStage.sort_order : -1;
    const expected = stages.filter((s) => s.sort_order > currentSort)[0];
    if (!expected || expected.id !== target.id) {
      throw badRequest(`当前阶段已停用，只能推进至顺序最近的下一个启用阶段「${expected ? expected.name : '—'}」`);
    }
  }

  // 1) 先写入本次随推进提交的字段值
  if (payload.action_values && Object.keys(payload.action_values).length) {
    writeActionValues(opp, payload.action_values, req, target);
  }

  // 2) 校验固定动作（注意：重新读取商机，使随推进写入的内置字段参与校验）
  const fresh = getOpportunityOr404(opportunityId);
  const evaluation = evaluate(fresh, currentStage);
  if (!evaluation.pass) {
    if (!payload.force) {
      throw conflict(
        '存在未完成的固定动作，无法推进',
        CODE.FIXED_ACTION,
        evaluation.missing.map((m) => ({ action_name: m.action_name, field_key: m.field_key }))
      );
    }
    // 强制推进属高风险操作：仅管理层/系统管理员可用，且必须填写原因
    const canForce = req.user && (req.user.isAdmin || req.user.permissions.has('opportunity:rollback'));
    if (!canForce) throw forbidden('强制推进需管理层或系统管理员权限');
    if (!payload.force_reason) throw badRequest('强制推进必须填写 force_reason');
  }

  applyStageChange(opp, currentStage, target, 'advance', payload.force ? payload.force_reason : null, req, {
    forced: !!payload.force && !evaluation.pass,
    missing: evaluation.missing,
  });
  return { opportunity: getOpportunityOr404(opportunityId), evaluation };
}

/** 阶段回退（仅管理层/系统管理员，需原因） */
function rollback(opportunityId, payload, req) {
  const opp = getOpportunityOr404(opportunityId);
  const canRollback = req.user && (req.user.isAdmin || req.user.permissions.has('opportunity:rollback'));
  if (!canRollback) throw forbidden('阶段回退仅管理层或系统管理员可执行');
  if (!payload.reason) throw badRequest('回退原因 reason 为必填项');

  const target = requireStage(payload.to_stage, '目标阶段');
  const currentStage = getById(opp.stage_config_id);
  if (target.is_terminal === 1 && target.terminal_type !== 'win') {
    throw badRequest('不可回退至失效终态');
  }
  if (target.is_enabled !== 1) throw badRequest('目标阶段已停用');

  applyStageChange(opp, currentStage, target, 'rollback', payload.reason, req, {});
  return { opportunity: getOpportunityOr404(opportunityId) };
}

function writeActionValues(opp, values, req, targetStage) {
  const reservedKeys = Object.keys(values).filter((k) => !k.startsWith('sys:'));
  const plain = {};
  reservedKeys.forEach((k) => {
    if (BUILTIN_FIELDS.includes(k)) return;
    plain[k] = values[k];
  });
  if (BUILTIN_FIELDS.includes('amount') && values.amount !== undefined) {
    db.prepare('UPDATE opportunities SET amount = ?, updated_at = ? WHERE id = ?').run(Number(values.amount) || 0, now(), opp.id);
  }
  if (values.expected_close_date !== undefined) {
    db.prepare('UPDATE opportunities SET expected_close_date = ?, updated_at = ? WHERE id = ?')
      .run(values.expected_close_date, now(), opp.id);
  }
  if (Object.keys(plain).length) {
    customField.setValues('opportunity', opp.id, plain, req && req.user ? req.user.id : null);
  }
  // 单独成功推进到下一阶段时，允许直接上传附件类字段的关联记录由对应模块接口完成
  void targetStage;
}

/** 统一落地阶段变更 */
function applyStageChange(opp, fromStage, toStage, actionType, reason, req, extra) {
  const t = now();
  db.prepare(
    `UPDATE opportunities SET stage_config_id = ?, stage_name_snapshot = ?, stage_changed_at = ?, last_activity_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(toStage.id, toStage.name, t, t, t, opp.id);

  const status = statusOfStage(toStage, false);
  if (status !== '进行中') {
    db.prepare('UPDATE opportunities SET status = ? WHERE id = ?').run(status, opp.id);
  } else {
    db.prepare("UPDATE opportunities SET status = '进行中' WHERE id = ?").run(opp.id);
  }

  recordHistory(opp, fromStage, toStage, actionType, reason, req);
  touchOpportunity(opp.id, req);
  logOperation(req, {
    action: actionType === 'rollback' ? 'ROLLBACK_OPPORTUNITY_STAGE' : 'UPDATE_OPPORTUNITY_STAGE',
    targetType: 'Opportunity',
    targetId: opp.id,
    detail: {
      from: fromStage ? fromStage.name : null,
      to: toStage.name,
      reason: reason || null,
      forced: !!(extra && extra.forced),
      missing: extra && extra.missing ? extra.missing.map((m) => m.action_name) : undefined,
    },
  });
}

/** 赢单关闭（M3-R4）：可同时落合同 */
function closeWin(opportunityId, payload, req) {
  const opp = getOpportunityOr404(opportunityId);
  const currentStage = getById(opp.stage_config_id);
  if (currentStage && currentStage.terminal_type === 'win') throw badRequest('该商机已赢单');
  if (currentStage && currentStage.terminal_type === 'loss') throw badRequest('该商机已失效，不可直接赢单');

  const winStage = getByCode('WIN');
  if (!winStage) throw notFound('内置终态 WIN 未初始化');

  const c = payload.contract || {};
  const existsContract =
    count(
      "SELECT COUNT(*) c FROM contracts WHERE opportunity_id = ? AND is_deleted = 0 AND COALESCE(approval_status, 'none') IN ('none','approved')",
      opp.id
    ) > 0;
  if (!existsContract) {
    if (!c.contract_no && !c.amount) {
      throw badRequest('赢单需登记合同信息：请传 contract.contract_no 与 contract.amount');
    }
  }

  let contractId = null;
  if (c.contract_no || c.amount || c.file_storage_id) {
    const contractAmount = Number(c.amount || opp.amount || 0);
    // 赢单时补录的合同若达到审批门槛，必须先走合同审批，避免绕过审批直接关单
    const matchedFlow = approvalFlow.matchFlow('contract', { amount: contractAmount });
    if (matchedFlow) {
      throw badRequest(
        `合同金额 ${contractAmount} 元已触发「${matchedFlow.name}」，请先在合同页签新增该合同并完成审批后再赢单`
      );
    }
    const signedDate = c.signed_date || now().slice(0, 10);
    contractId = newId();
    db.prepare(
      `INSERT INTO contracts (id, opportunity_id, customer_id, contract_no, contract_name, amount, product_type, file_storage_id,
        file_url, file_name, signed_date, signed_by, status, created_by, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`
    ).run(
      contractId, opp.id, opp.customer_id, c.contract_no || newBizNo('HT'), c.contract_name || `${opp.name} 合同`,
      Number(c.amount || opp.amount || 0), c.product_type || null, c.file_storage_id || null,
      c.file_url || null, c.file_name || null, signedDate, c.signed_by || (req.user ? req.user.name : null),
      req.user ? req.user.id : null, now(), now()
    );
    logOperation(req, { action: 'CREATE_CONTRACT', targetType: 'Contract', targetId: contractId, detail: { opportunity_id: opp.id, from: 'close_win' } });
  }

  applyStageChange(opp, currentStage, winStage, 'close_win', payload.reason || '合同签订完毕', req, {});
  logOperation(req, { action: 'CLOSE_WIN_OPPORTUNITY', targetType: 'Opportunity', targetId: opp.id, detail: { contract_id: contractId } });
  return { opportunity: getOpportunityOr404(opportunityId), contract_id: contractId };
}

/** 失败关闭（M3-R5 / M8-R1）：生成失效申请，审批通过后方生效 */
function closeLoss(opportunityId, payload, req) {
  const opp = getOpportunityOr404(opportunityId);
  const currentStage = getById(opp.stage_config_id);
  if (currentStage && currentStage.terminal_type) throw badRequest('商机已处于终态，无法重复关闭');
  if (!payload.loss_reason) throw badRequest('失败原因 loss_reason 为必填项');
  if (!payload.loss_detail) throw badRequest('失败详细说明 loss_detail 为必填项');
  if (payload.competitor_name === undefined && payload.loss_reason && String(payload.loss_reason).includes('竞争对手')) {
    throw badRequest('失败原因含竞争对手时，competitor_name 为必填项');
  }

  const pending = db
    .prepare("SELECT * FROM loss_records WHERE opportunity_id = ? AND approval_status = 'pending'")
    .get(opp.id);
  if (pending) throw conflict('该商机已有待审批的失效申请', CODE.LOSS_APPROVAL);

  const id = newId();
  db.prepare(
    `INSERT INTO loss_records (id, opportunity_id, loss_reason, loss_detail, competitor_name, is_recoverable, recovery_plan,
      follow_up_date, submitted_by, approval_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    id, opp.id, payload.loss_reason, payload.loss_detail, payload.competitor_name || null,
    payload.is_recoverable ? 1 : 0, payload.recovery_plan || null, payload.follow_up_date || null,
    req.user ? req.user.id : null, now(), now()
  );

  logOperation(req, { action: 'SUBMIT_LOSS_RECORD', targetType: 'LossRecord', targetId: id, detail: { opportunity_id: opp.id } });
  return db.prepare('SELECT * FROM loss_records WHERE id = ?').get(id);
}

/** 失效审批（M8-R2）：通过后商机转入 LOSS 终态 */
function approveLoss(lossRecordId, payload, req) {
  const record = db.prepare('SELECT * FROM loss_records WHERE id = ?').get(lossRecordId);
  if (!record) throw notFound('失效记录不存在');
  if (record.approval_status !== 'pending') throw badRequest('该失效申请已处理');

  const opp = getOpportunityOr404(record.opportunity_id);
  const currentStage = getById(opp.stage_config_id);
  const lossStage = getByCode('LOSS');
  if (!lossStage) throw notFound('内置终态 LOSS 未初始化');

  db.prepare(
    "UPDATE loss_records SET approval_status = 'approved', approved_by = ?, approve_comment = ?, approved_at = ?, updated_at = ? WHERE id = ?"
  ).run(req.user ? req.user.id : null, payload.comment || null, now(), now(), record.id);

  applyStageChange(opp, currentStage, lossStage, 'close_loss', record.loss_reason, req, {});
  logOperation(req, { action: 'APPROVE_LOSS_RECORD', targetType: 'LossRecord', targetId: record.id, detail: { opportunity_id: opp.id } });
  return { loss_record: db.prepare('SELECT * FROM loss_records WHERE id = ?').get(record.id), opportunity: getOpportunityOr404(opp.id) };
}

function rejectLoss(lossRecordId, payload, req) {
  const record = db.prepare('SELECT * FROM loss_records WHERE id = ?').get(lossRecordId);
  if (!record) throw notFound('失效记录不存在');
  if (record.approval_status !== 'pending') throw badRequest('该失效申请已处理');
  if (!payload.comment) throw badRequest('驳回意见 comment 为必填项');
  db.prepare(
    "UPDATE loss_records SET approval_status = 'rejected', approved_by = ?, approve_comment = ?, approved_at = ?, updated_at = ? WHERE id = ?"
  ).run(req.user ? req.user.id : null, payload.comment, now(), now(), record.id);
  logOperation(req, { action: 'REJECT_LOSS_RECORD', targetType: 'LossRecord', targetId: record.id });
  return db.prepare('SELECT * FROM loss_records WHERE id = ?').get(record.id);
}

/** 阶段进度条数据 */
function stageProgress(opportunityId) {
  const opp = getOpportunityOr404(opportunityId);
  const stages = orderedEnabledStages();
  const idx = stages.findIndex((s) => s.id === opp.stage_config_id);
  const evaluation = evaluate(opp, getById(opp.stage_config_id));
  return {
    current_stage_id: opp.stage_config_id,
    stage_name_snapshot: opp.stage_name_snapshot,
    stages: stages.map((s, i) => ({
      id: s.id, code: s.code, name: s.name, sort_order: s.sort_order,
      is_terminal: s.is_terminal, terminal_type: s.terminal_type,
      passed: idx > -1 && i < idx, current: i === idx,
    })),
    completeness: evaluation.completeness,
    missing: evaluation.missing.map((m) => ({ action_name: m.action_name, field_key: m.field_key })),
  };
}

function timeline(opportunityId) {
  getOpportunityOr404(opportunityId);
  return db
    .prepare(
      `SELECT h.*, u.name AS changed_by_name FROM stage_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.opportunity_id = ? ORDER BY h.created_at`
    )
    .all(opportunityId);
}

module.exports = {
  CORE_FIELDS, listStages, orderedEnabledStages, getById, getByCode, resolveStage, requireStage,
  firstStage, nextStageOf, isTerminal, rulesOf, evaluate, evaluateRule, checkAdvance,
  advance, rollback, closeWin, closeLoss, approveLoss, rejectLoss,
  statusOfStage, syncStatus, touchOpportunity, stageProgress, timeline, getOpportunityOr404, count,
};
