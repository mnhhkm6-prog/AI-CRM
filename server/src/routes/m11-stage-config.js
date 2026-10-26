'use strict';

/**
 * M11 漏斗配置管理（P33–P36）
 * 覆盖：阶段定义 CRUD、固定动作 CRUD、排序/启停、配置版本历史与回滚、存量商机映射
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, requireString, optional, bodyOf } = require('../utils/http');
const { badRequest, notFound, conflict, CODE } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const stageEngine = require('../services/stageEngine');
const { logOperation } = require('../services/operationLog');

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function stageOr404(id) {
  const stage = stageEngine.getById(id);
  if (!stage) throw notFound('阶段不存在');
  return stage;
}

/** 阶段 + 固定动作快照（用于版本留痕） */
function stageSnapshot(stage) {
  if (!stage) return null;
  return {
    stage,
    rules: db.prepare('SELECT * FROM stage_action_rules WHERE stage_config_id = ? ORDER BY sort_order').all(stage.id),
  };
}

function decorateStage(stage) {
  return {
    ...stage,
    roles: parseJson(stage.roles_json, []),
    alert_thresholds: parseJson(stage.alert_thresholds, null),
  };
}

function recordChange(stageId, action, before, after, versionAfter, user) {
  db.prepare(
    `INSERT INTO stage_config_change_logs (id, stage_config_id, action, before_snapshot, after_snapshot, changed_by, version_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(), stageId, action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    user ? user.id : null, versionAfter, now()
  );
}

// ---------------------------------------------------------------- 阶段定义
router.get('/stage-configs', requirePermission('stage_config:view'), (req, res) => {
  const includeDisabled = req.query.include_disabled === 'true' || req.query.include_disabled === '1';
  const list = stageEngine.listStages({ includeDisabled }).map((s) => ({
    ...decorateStage(s),
    action_rules: db.prepare('SELECT * FROM stage_action_rules WHERE stage_config_id = ? ORDER BY sort_order').all(s.id),
  }));
  ok(res, list);
});

/** 阶段下拉选项（商机推进/看板列头用，仅需商机查看权限，避免销售角色拿不到阶段列表） */
router.get('/stage-options', requirePermission('opportunity:view'), (req, res) => {
  ok(
    res,
    stageEngine.listStages().map((s) => ({
      id: s.id, code: s.code, name: s.name, sort_order: s.sort_order,
      is_terminal: s.is_terminal, terminal_type: s.terminal_type,
      alert_thresholds: parseJson(s.alert_thresholds, null),
    }))
  );
});

router.post('/stage-configs', requirePermission('stage_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const code = requireString(body, 'code', '阶段编码');
  const name = requireString(body, 'name', '阶段名称');
  if (db.prepare('SELECT id FROM stage_configs WHERE code = ?').get(code)) {
    throw conflict(`阶段编码「${code}」已存在`);
  }
  const isTerminal = body.is_terminal ? 1 : 0;
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO stage_configs
      (id, code, name, description, sort_order, is_enabled, is_terminal, terminal_type, entry_condition, deliverables,
       roles_json, alert_thresholds, version, is_system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  ).run(
    id, code, name, optional(body, 'description'), Number(body.sort_order) || 0, body.is_enabled === false ? 0 : 1,
    isTerminal, isTerminal ? optional(body, 'terminal_type') : null,
    optional(body, 'entry_condition'), optional(body, 'deliverables'),
    JSON.stringify(Array.isArray(body.roles) ? body.roles : []),
    body.alert_thresholds ? JSON.stringify(body.alert_thresholds) : null, t, t
  );
  const stage = stageEngine.getById(id);
  recordChange(id, 'create', null, stageSnapshot(stage), 1, req.user);
  logOperation(req, { action: 'CREATE_STAGE_CONFIG', targetType: 'StageConfig', targetId: id, detail: { code, name }, logType: 'config' });
  created(res, decorateStage(stage));
});

// ⚠️ 静态子路径必须写在参数化路径之前
router.post('/stage-configs/reorder', requirePermission('stage_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const ids = Array.isArray(body.ordered_ids) ? body.ordered_ids : [];
  if (!ids.length) throw badRequest('ordered_ids 为必填数组');
  const t = now();
  ids.forEach((id, i) => {
    db.prepare('UPDATE stage_configs SET sort_order = ?, updated_at = ? WHERE id = ?').run((i + 1) * 10, t, id);
  });
  recordChange(null, 'reorder', null, { ordered_ids: ids }, null, req.user);
  logOperation(req, { action: 'REORDER_STAGE_CONFIG', targetType: 'StageConfig', targetId: null, detail: { ordered_ids: ids }, logType: 'config' });
  ok(res, stageEngine.listStages({ includeDisabled: true }).map(decorateStage));
});

// ---------------------------------------------------------------- 配置版本历史
router.get('/stage-configs/versions', requirePermission('stage_config:view'), (req, res) => {
  const list = db
    .prepare(
      `SELECT l.id, l.stage_config_id, l.action, l.version_after, l.created_at,
              u.name AS changed_by_name, s.name AS stage_name
       FROM stage_config_change_logs l
       LEFT JOIN users u ON u.id = l.changed_by
       LEFT JOIN stage_configs s ON s.id = l.stage_config_id
       ORDER BY l.created_at DESC`
    )
    .all();
  ok(res, list);
});

router.get('/stage-configs/versions/:version', requirePermission('stage_config:view'), (req, res) => {
  const version = Number(req.params.version);
  if (Number.isNaN(version)) throw badRequest('version 必须为数字');
  const list = db
    .prepare(
      `SELECT l.*, s.name AS stage_name FROM stage_config_change_logs l
       LEFT JOIN stage_configs s ON s.id = l.stage_config_id
       WHERE l.version_after = ? ORDER BY l.created_at DESC`
    )
    .all(version)
    .map((l) => ({
      ...l,
      before_snapshot: parseJson(l.before_snapshot, null),
      after_snapshot: parseJson(l.after_snapshot, null),
    }));
  ok(res, list);
});

router.post('/stage-configs/rollback', requirePermission('stage_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const version = Number(body.version);
  if (!version) throw badRequest('version 为必填项');
  if (!body.confirm) throw badRequest('回滚为高风险操作，请传 confirm=true 二次确认');
  const logs = db
    .prepare("SELECT * FROM stage_config_change_logs WHERE version_after = ? AND action <> 'delete' ORDER BY created_at DESC")
    .all(version);
  if (!logs.length) throw notFound(`未找到版本 ${version} 的快照`);

  const insRule = db.prepare(
    `INSERT INTO stage_action_rules
      (id, stage_config_id, action_name, field_key, field_type, is_required, options, tip, sort_order, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const restored = [];
  logs.forEach((log) => {
    const snap = parseJson(log.after_snapshot, null);
    if (!snap || !snap.stage) return;
    const s = snap.stage;
    const current = db.prepare('SELECT * FROM stage_configs WHERE id = ?').get(s.id);
    if (!current) return;
    const t = now();
    const versionAfter = (current.version || 1) + 1;
    db.prepare(
      `UPDATE stage_configs SET name = ?, description = ?, sort_order = ?, is_enabled = ?, is_terminal = ?, terminal_type = ?,
        entry_condition = ?, deliverables = ?, roles_json = ?, alert_thresholds = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      s.name, s.description, s.sort_order, s.is_enabled, s.is_terminal, s.terminal_type,
      s.entry_condition, s.deliverables, s.roles_json, s.alert_thresholds, versionAfter, t, s.id
    );
    db.prepare('DELETE FROM stage_action_rules WHERE stage_config_id = ?').run(s.id);
    (snap.rules || []).forEach((r) => {
      insRule.run(
        newId(), s.id, r.action_name, r.field_key, r.field_type, r.is_required, r.options, r.tip, r.sort_order, r.is_enabled, t, t
      );
    });
    recordChange(s.id, 'rollback', null, stageSnapshot(stageEngine.getById(s.id)), versionAfter, req.user);
    restored.push(s.id);
  });
  logOperation(req, { action: 'ROLLBACK_STAGE_CONFIG', targetType: 'StageConfig', targetId: null, detail: { version, restored }, logType: 'config' });
  ok(res, { version, restored });
});

// ---------------------------------------------------------------- 存量商机映射
router.post('/stage-configs/mapping/preview', requirePermission('stage_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const list = changes.map((c) => {
    const fromStage = c.from_stage ? stageEngine.getById(c.from_stage) : null;
    const toStage = c.to_stage ? stageEngine.getById(c.to_stage) : null;
    const count = fromStage
      ? db.prepare('SELECT COUNT(*) c FROM opportunities WHERE stage_config_id = ? AND is_deleted = 0').get(fromStage.id).c
      : 0;
    return {
      from_stage: c.from_stage || null,
      from_stage_name: fromStage ? fromStage.name : null,
      to_stage: c.to_stage || null,
      to_stage_name: toStage ? toStage.name : null,
      opportunity_count: count,
    };
  });
  ok(res, { list, total_opportunities: list.reduce((sum, x) => sum + x.opportunity_count, 0) });
});

router.post('/stage-configs/mapping/execute', requirePermission('stage_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const mapping = Array.isArray(body.mapping) ? body.mapping : [];
  if (!mapping.length) throw badRequest('mapping 为必填数组');
  const t = now();
  const result = [];
  mapping.forEach((m) => {
    const toStage = stageEngine.requireStage(m.to_stage, '目标阶段');
    const info = db
      .prepare('UPDATE opportunities SET stage_config_id = ?, stage_name_snapshot = ?, updated_at = ? WHERE stage_config_id = ? AND is_deleted = 0')
      .run(toStage.id, toStage.name, t, m.from_stage);
    result.push({ from_stage: m.from_stage, to_stage: toStage.id, to_stage_name: toStage.name, migrated: info.changes });
  });
  recordChange(null, 'mapping_execute', null, { mapping: result }, null, req.user);
  logOperation(req, { action: 'EXECUTE_STAGE_MAPPING', targetType: 'StageConfig', targetId: null, detail: { mapping: result }, logType: 'config' });
  ok(res, { result });
});

// ---------------------------------------------------------------- 启停 / 固定动作
router.post('/stage-configs/:id/toggle', requirePermission('stage_config:manage'), (req, res) => {
  const stage = stageOr404(req.params.id);
  const body = bodyOf(req);
  const enabled = body.is_enabled === undefined ? (stage.is_enabled === 1 ? 0 : 1) : (body.is_enabled ? 1 : 0);
  const beforeSnap = stageSnapshot(stage);
  const versionAfter = (stage.version || 1) + 1;
  db.prepare('UPDATE stage_configs SET is_enabled = ?, version = ?, updated_at = ? WHERE id = ?').run(enabled, versionAfter, now(), stage.id);
  const after = stageEngine.getById(stage.id);
  recordChange(stage.id, 'update', beforeSnap, stageSnapshot(after), versionAfter, req.user);
  logOperation(req, { action: 'TOGGLE_STAGE_CONFIG', targetType: 'StageConfig', targetId: stage.id, detail: { is_enabled: enabled }, logType: 'config' });
  ok(res, decorateStage(after));
});

router.get('/stage-configs/:id/action-rules', requirePermission('stage_config:view'), (req, res) => {
  const stage = stageOr404(req.params.id);
  ok(res, stageEngine.rulesOf(stage.id, { includeDisabled: true }));
});

router.post('/stage-configs/:id/action-rules', requirePermission('stage_config:manage'), (req, res) => {
  const stage = stageOr404(req.params.id);
  const body = bodyOf(req);
  const actionName = requireString(body, 'action_name', '动作名称');
  const fieldKey = requireString(body, 'field_key', '字段键');
  const fieldType = requireString(body, 'field_type', '字段类型');
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO stage_action_rules
      (id, stage_config_id, action_name, field_key, field_type, is_required, options, tip, sort_order, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, stage.id, actionName, fieldKey, fieldType, body.is_required === false ? 0 : 1,
    body.options ? JSON.stringify(body.options) : null, optional(body, 'tip'),
    Number(body.sort_order) || 0, body.is_enabled === false ? 0 : 1, t, t
  );
  const versionAfter = (stage.version || 1) + 1;
  db.prepare('UPDATE stage_configs SET version = ?, updated_at = ? WHERE id = ?').run(versionAfter, t, stage.id);
  recordChange(stage.id, 'update', null, stageSnapshot(stageEngine.getById(stage.id)), versionAfter, req.user);
  logOperation(req, {
    action: 'CREATE_STAGE_ACTION_RULE',
    targetType: 'StageActionRule',
    targetId: id,
    detail: { stage_config_id: stage.id, action_name: actionName },
    logType: 'config',
  });
  created(res, db.prepare('SELECT * FROM stage_action_rules WHERE id = ?').get(id));
});

router.put('/stage-configs/:id', requirePermission('stage_config:manage'), (req, res) => {
  const before = stageOr404(req.params.id);
  const beforeSnap = stageSnapshot(before);
  const body = bodyOf(req);
  const fields = {};
  ['name', 'description', 'entry_condition', 'deliverables'].forEach((f) => {
    if (body[f] !== undefined) fields[f] = body[f];
  });
  if (body.sort_order !== undefined) fields.sort_order = Number(body.sort_order) || 0;
  if (body.is_enabled !== undefined) fields.is_enabled = body.is_enabled ? 1 : 0;
  if (body.roles !== undefined) fields.roles_json = JSON.stringify(Array.isArray(body.roles) ? body.roles : []);
  if (body.alert_thresholds !== undefined) fields.alert_thresholds = body.alert_thresholds ? JSON.stringify(body.alert_thresholds) : null;
  if (before.is_system !== 1) {
    if (body.is_terminal !== undefined) fields.is_terminal = body.is_terminal ? 1 : 0;
    if (body.terminal_type !== undefined) fields.terminal_type = body.terminal_type || null;
  }
  if (!Object.keys(fields).length) throw badRequest('没有可更新的字段');
  const versionAfter = (before.version || 1) + 1;
  fields.version = versionAfter;
  fields.updated_at = now();
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE stage_configs SET ${sets} WHERE id = @id`).run({ ...fields, id: before.id });
  const after = stageEngine.getById(before.id);
  recordChange(before.id, 'update', beforeSnap, stageSnapshot(after), versionAfter, req.user);
  logOperation(req, { action: 'UPDATE_STAGE_CONFIG', targetType: 'StageConfig', targetId: before.id, detail: fields, logType: 'config' });
  ok(res, decorateStage(after));
});

router.delete('/stage-configs/:id', requirePermission('stage_config:manage'), (req, res) => {
  const stage = stageOr404(req.params.id);
  if (stage.is_system === 1 || stage.is_terminal === 1) throw conflict('内置终态/系统阶段不可删除');
  const count = db.prepare('SELECT COUNT(*) c FROM opportunities WHERE stage_config_id = ? AND is_deleted = 0').get(stage.id).c;
  if (count > 0) {
    throw conflict(`该阶段下存在 ${count} 个存量商机，请先执行阶段映射`, CODE.STAGE_MAPPING, { opportunity_count: count });
  }
  const beforeSnap = stageSnapshot(stage);
  db.prepare('DELETE FROM stage_action_rules WHERE stage_config_id = ?').run(stage.id);
  db.prepare('DELETE FROM stage_configs WHERE id = ?').run(stage.id);
  recordChange(stage.id, 'delete', beforeSnap, null, null, req.user);
  logOperation(req, { action: 'DELETE_STAGE_CONFIG', targetType: 'StageConfig', targetId: stage.id, detail: { code: stage.code }, logType: 'config' });
  ok(res, { id: stage.id, deleted: true });
});

// ---------------------------------------------------------------- 固定动作（独立路径）
router.put('/stage-action-rules/:id', requirePermission('stage_config:manage'), (req, res) => {
  const rule = db.prepare('SELECT * FROM stage_action_rules WHERE id = ?').get(req.params.id);
  if (!rule) throw notFound('固定动作不存在');
  const body = bodyOf(req);
  const fields = {};
  ['action_name', 'field_key', 'field_type', 'tip'].forEach((f) => {
    if (body[f] !== undefined) fields[f] = body[f];
  });
  if (body.is_required !== undefined) fields.is_required = body.is_required ? 1 : 0;
  if (body.options !== undefined) fields.options = body.options ? JSON.stringify(body.options) : null;
  if (body.sort_order !== undefined) fields.sort_order = Number(body.sort_order) || 0;
  if (body.is_enabled !== undefined) fields.is_enabled = body.is_enabled ? 1 : 0;
  if (!Object.keys(fields).length) throw badRequest('没有可更新的字段');
  fields.updated_at = now();
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE stage_action_rules SET ${sets} WHERE id = @id`).run({ ...fields, id: rule.id });

  const stage = stageEngine.getById(rule.stage_config_id);
  const versionAfter = stage ? (stage.version || 1) + 1 : null;
  if (stage) db.prepare('UPDATE stage_configs SET version = ?, updated_at = ? WHERE id = ?').run(versionAfter, now(), stage.id);
  recordChange(rule.stage_config_id, 'update', null, stageSnapshot(stageEngine.getById(rule.stage_config_id)), versionAfter, req.user);
  logOperation(req, { action: 'UPDATE_STAGE_ACTION_RULE', targetType: 'StageActionRule', targetId: rule.id, detail: fields, logType: 'config' });
  ok(res, db.prepare('SELECT * FROM stage_action_rules WHERE id = ?').get(rule.id));
});

router.delete('/stage-action-rules/:id', requirePermission('stage_config:manage'), (req, res) => {
  const rule = db.prepare('SELECT * FROM stage_action_rules WHERE id = ?').get(req.params.id);
  if (!rule) throw notFound('固定动作不存在');
  db.prepare('DELETE FROM stage_action_rules WHERE id = ?').run(rule.id);
  const stage = stageEngine.getById(rule.stage_config_id);
  const versionAfter = stage ? (stage.version || 1) + 1 : null;
  if (stage) db.prepare('UPDATE stage_configs SET version = ?, updated_at = ? WHERE id = ?').run(versionAfter, now(), stage.id);
  recordChange(rule.stage_config_id, 'update', null, stageSnapshot(stageEngine.getById(rule.stage_config_id)), versionAfter, req.user);
  logOperation(req, {
    action: 'DELETE_STAGE_ACTION_RULE',
    targetType: 'StageActionRule',
    targetId: rule.id,
    detail: { action_name: rule.action_name },
    logType: 'config',
  });
  ok(res, { id: rule.id, deleted: true });
});

module.exports = router;
