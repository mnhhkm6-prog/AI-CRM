'use strict';

/**
 * M16 实施配置向导与模板导入导出（P45/P46，M16-R1~R4）
 * 覆盖：向导状态/分步提交/完成生成清单、模板包列表/导出/导入（冲突预览 + 逐项确认）/删除/升级
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, conflict } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const { logOperation } = require('../services/operationLog');
const { buildTemplateConfig } = require('../db/seed');

const WIZARD_STEPS = ['basic', 'funnel', 'fields', 'roles', 'dictionary', 'import'];
const WIZARD_MODES = ['default', 'template', 'custom'];

/** JSON 解析容错 */
function parseMaybe(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return v;
  }
}

const getWizard = () => db.prepare('SELECT * FROM implementation_wizard_state LIMIT 1').get() || null;

/** 可导入的顶层配置集合（自然键用于冲突识别） */
const IMPORT_COLLECTIONS = [
  { key: 'stage_configs', table: 'stage_configs', type: 'stage_config', match: ['code'], rename: 'code', label: (r) => r.code },
  { key: 'custom_field_definitions', table: 'custom_field_definitions', type: 'custom_field_definition', match: ['entity_type', 'field_code'], rename: 'field_code', label: (r) => `${r.entity_type}.${r.field_code}` },
  { key: 'dictionary_types', table: 'dictionary_types', type: 'dictionary_type', match: ['dict_code'], rename: 'dict_code', label: (r) => r.dict_code },
  { key: 'roles', table: 'roles', type: 'role', match: ['role_code'], rename: 'role_code', label: (r) => r.role_code },
  { key: 'report_templates', table: 'report_templates', type: 'report_template', match: ['template_name'], rename: 'template_name', label: (r) => r.template_name },
  { key: 'view_configs', table: 'view_configs', type: 'view_config', match: ['view_name', 'entity_type'], rename: 'view_name', label: (r) => `${r.entity_type}.${r.view_name}` },
  { key: 'system_configs', table: 'system_configs', type: 'system_config', match: ['config_key'], rename: 'config_key', label: (r) => r.config_key },
];

/** 解析并校验 config_data（对象或 JSON 字符串） */
function normalizeConfig(raw) {
  let config = raw;
  if (typeof raw === 'string') {
    try {
      config = JSON.parse(raw);
    } catch (e) {
      throw badRequest('config_data 不是合法的 JSON');
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw badRequest('config_data 必须为对象');
  // 允许配置包只包含部分集合；仅校验已出现的集合必须是数组
  ['stage_configs', 'custom_field_definitions', 'dictionary_types'].forEach((k) => {
    if (config[k] !== undefined && !Array.isArray(config[k])) throw badRequest(`config_data.${k} 必须为数组`);
  });
  return config;
}

/** 生成导入计划：逐项比对自然键，得出冲突清单与新增计数 */
function buildPlan(config) {
  const items = [];
  const conflicts = [];
  let added = 0;
  IMPORT_COLLECTIONS.forEach((col) => {
    const list = Array.isArray(config[col.key]) ? config[col.key] : [];
    list.forEach((incoming) => {
      const item = `${col.type}: ${col.label(incoming)}`;
      const whereParts = col.match.map((m) => `${m} = ?`).join(' AND ');
      const params = col.match.map((m) => incoming[m]);
      const existing = db.prepare(`SELECT * FROM ${col.table} WHERE ${whereParts}`).get(...params) || null;
      items.push({ item, collection: col.key, match: col.match, rename: col.rename, incoming, existing });
      if (existing) conflicts.push({ item, type: col.type, action: 'overwrite', existing, incoming });
      else added += 1;
    });
  });
  return { items, conflicts, summary: { 新增: added, 冲突: conflicts.length } };
}

function insertRow(collectionKey, incoming, renameOverride) {
  const col = IMPORT_COLLECTIONS.find((c) => c.key === collectionKey);
  const row = { ...incoming };
  delete row.id;
  row.id = newId();
  row.created_at = now();
  row.updated_at = row.created_at;
  if (renameOverride) row[renameOverride.column] = renameOverride.value;
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${col.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  db.prepare(sql).run(...cols.map((c) => row[c]));
  return row.id;
}

function updateRow(collectionKey, incoming, existingId) {
  const col = IMPORT_COLLECTIONS.find((c) => c.key === collectionKey);
  const cols = Object.keys(incoming).filter((c) => c !== 'id' && c !== 'created_at');
  const sets = cols.map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE ${col.table} SET ${sets}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => incoming[c]), now(), existingId);
}

/** 向导状态（M16-R1）：无状态行时不建行，返回默认草稿 */
router.get('/implementation/wizard/state', requirePermission('system_config:manage'), (req, res) => {
  const row = getWizard();
  if (!row) return ok(res, { step: 'basic', mode: 'default', payload: {}, status: 'draft' });
  ok(res, { ...row, payload: parseMaybe(row.payload), manifest: parseMaybe(row.manifest) });
});

/** 提交向导某一步（M16-R1） */
router.post('/implementation/wizard/step', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const step = requireString(body, 'step', '步骤');
  if (!WIZARD_STEPS.includes(step)) throw badRequest(`step 必须为 ${WIZARD_STEPS.join('/')}`);
  const mode = body.mode === undefined ? 'default' : String(body.mode);
  if (!WIZARD_MODES.includes(mode)) throw badRequest(`mode 必须为 ${WIZARD_MODES.join('/')}`);
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

  const t = now();
  const row = getWizard();
  const merged = { ...(row ? (parseMaybe(row.payload) || {}) : {}), [step]: payload };
  if (row) {
    db.prepare(
      'UPDATE implementation_wizard_state SET step = ?, mode = ?, payload = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?'
    ).run(step, mode, JSON.stringify(merged), 'draft', req.user.id, t, row.id);
  } else {
    db.prepare(
      `INSERT INTO implementation_wizard_state (id, step, mode, payload, status, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
    ).run(newId(), step, mode, JSON.stringify(merged), req.user.id, t, t);
  }
  const saved = getWizard();
  logOperation(req, { action: 'UPDATE_WIZARD_STEP', targetType: 'ImplementationWizard', targetId: saved.id, detail: { step, mode } });
  ok(res, { ...saved, payload: parseMaybe(saved.payload) });
});

/** 完成向导并生成实施配置清单（M16-R1） */
router.post('/implementation/wizard/finish', requirePermission('system_config:manage'), (req, res) => {
  const cnt = (sql) => db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get().c;
  const counts = {
    stage_configs: cnt('stage_configs'),
    custom_field_definitions: cnt('custom_field_definitions WHERE is_deleted = 0'),
    roles: cnt('roles'),
    dictionary_types: cnt('dictionary_types WHERE is_deleted = 0'),
    view_configs: cnt('view_configs WHERE is_deleted = 0'),
    report_templates: cnt('report_templates WHERE is_deleted = 0'),
    system_configs: cnt('system_configs'),
  };
  const manifest = { generated_at: now(), counts };
  const t = now();
  const row = getWizard();
  if (row) {
    db.prepare(
      "UPDATE implementation_wizard_state SET status = 'finished', finished_at = ?, manifest = ?, updated_by = ?, updated_at = ? WHERE id = ?"
    ).run(t, JSON.stringify(manifest), req.user.id, t, row.id);
  } else {
    db.prepare(
      `INSERT INTO implementation_wizard_state (id, step, mode, payload, status, finished_at, manifest, updated_by, created_at, updated_at)
       VALUES (?, 'basic', 'default', '{}', 'finished', ?, ?, ?, ?, ?)`
    ).run(newId(), t, JSON.stringify(manifest), req.user.id, t, t);
  }
  const saved = getWizard();
  logOperation(req, { action: 'FINISH_WIZARD', targetType: 'ImplementationWizard', targetId: saved.id, detail: manifest });
  ok(res, { ...saved, payload: parseMaybe(saved.payload), manifest: parseMaybe(saved.manifest) });
});

/** 模板包列表（M16-R2） */
router.get('/implementation/templates', requirePermission('system_config:view'), (req, res) => {
  ok(res, db.prepare(
    `SELECT id, template_name, template_version, description, is_system, created_by, created_at, updated_at
     FROM implementation_templates WHERE is_deleted = 0 ORDER BY is_system DESC, created_at DESC`
  ).all());
});

/** 导出当前配置为模板包（M16-R2） */
router.post('/implementation/templates/export', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const name = requireString(body, 'template_name', '模板名称');
  const version = optional(body, 'template_version', '1.0.0');
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO implementation_templates (id, template_name, template_version, description, is_system, config_data, created_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?)`
  ).run(id, name, version, optional(body, 'description'), JSON.stringify(buildTemplateConfig()), req.user.id, t, t);
  logOperation(req, { action: 'EXPORT_IMPLEMENTATION_TEMPLATE', targetType: 'ImplementationTemplate', targetId: id, detail: { template_name: name, template_version: version } });
  created(res, db.prepare('SELECT * FROM implementation_templates WHERE id = ?').get(id));
});

/** 导入模板包第一步：冲突预览（不落库）M16-R3 */
router.post('/implementation/templates/import', requirePermission('system_config:manage'), (req, res) => {
  const config = normalizeConfig(bodyOf(req).config_data);
  const plan = buildPlan(config);
  ok(res, { conflicts: plan.conflicts, summary: plan.summary });
});

/** 导入模板包第二步：按决策逐项执行（事务）M16-R3 */
router.post('/implementation/templates/import/confirm', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const config = normalizeConfig(body.config_data);
  const decisions = Array.isArray(body.decisions) ? body.decisions : [];
  const decisionMap = new Map(decisions.map((d) => [d.item, d]));
  const plan = buildPlan(config);

  const applied = [];
  db.transaction(() => {
    plan.items.forEach((it) => {
      const decision = decisionMap.get(it.item);
      const action = decision ? decision.action : 'skip';
      if (action === 'skip') {
        applied.push({ item: it.item, action: 'skip' });
        return;
      }
      if (action === 'overwrite') {
        if (it.existing) {
          updateRow(it.collection, it.incoming, it.existing.id);
          applied.push({ item: it.item, action: 'overwrite', id: it.existing.id });
        } else {
          applied.push({ item: it.item, action: 'insert', id: insertRow(it.collection, it.incoming, null) });
        }
        return;
      }
      if (action === 'rename') {
        const renamed = decision && decision.rename ? String(decision.rename) : null;
        if (!renamed) throw badRequest(`rename 动作缺少 rename 值：${it.item}`);
        applied.push({ item: it.item, action: 'rename', id: insertRow(it.collection, it.incoming, { column: it.rename, value: renamed }), rename: renamed });
        return;
      }
      throw badRequest(`不支持的 action：${action}`);
    });
  })();
  logOperation(req, { action: 'IMPORT_IMPLEMENTATION_TEMPLATE', targetType: 'ImplementationTemplate', detail: { applied: applied.length } });
  ok(res, { applied });
});

/** 跨版本升级（M16-R4） */
router.post('/implementation/templates/:id/upgrade', requirePermission('system_config:manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM implementation_templates WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('模板包不存在');
  const target = requireString(bodyOf(req), 'target_version', '目标版本');
  db.prepare('UPDATE implementation_templates SET template_version = ?, updated_at = ? WHERE id = ?').run(target, now(), row.id);
  logOperation(req, {
    action: 'UPGRADE_IMPLEMENTATION_TEMPLATE',
    targetType: 'ImplementationTemplate',
    targetId: row.id,
    detail: { from: row.template_version, to: target },
  });
  ok(res, db.prepare('SELECT * FROM implementation_templates WHERE id = ?').get(row.id));
});

/** 删除模板包（系统内置禁止，软删） */
router.delete('/implementation/templates/:id', requirePermission('system_config:manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM implementation_templates WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('模板包不存在');
  if (row.is_system === 1) throw conflict('系统内置模板不可删除');
  db.prepare('UPDATE implementation_templates SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_IMPLEMENTATION_TEMPLATE', targetType: 'ImplementationTemplate', targetId: row.id, detail: { template_name: row.template_name } });
  ok(res, { id: row.id, deleted: true });
});

module.exports = router;
