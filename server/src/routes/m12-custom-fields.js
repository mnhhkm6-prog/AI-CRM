'use strict';

/**
 * M12 自定义字段管理（P37/P38）
 * 覆盖：字段定义 CRUD、启停、引用检查、字段值读写（EAV）
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, requireString, optional, bodyOf } = require('../utils/http');
const { badRequest, notFound, conflict, forbidden, CODE } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const customField = require('../services/customField');
const { logOperation } = require('../services/operationLog');

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

const jsonOrNull = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

function decorate(def) {
  const stage = def.stage_config_id
    ? db.prepare('SELECT code, name FROM stage_configs WHERE id = ?').get(def.stage_config_id)
    : null;
  return {
    ...def,
    options: parseJson(def.options, []),
    validation_rules: parseJson(def.validation_rules, null),
    visible_roles: parseJson(def.visible_roles, []),
    stage_code: stage ? stage.code : null,
    stage_name: stage ? stage.name : null,
  };
}

/** 商机字段必须关联有效阶段；其他实体忽略该字段 */
function resolveStageId(entityType, raw) {
  if (entityType !== 'opportunity') return null;
  if (!raw) throw badRequest('商机字段必须选择所属阶段');
  const stage = db.prepare('SELECT id FROM stage_configs WHERE id = ?').get(raw);
  if (!stage) throw badRequest('所属阶段不存在');
  return raw;
}

function defOr404(id) {
  const def = db.prepare('SELECT * FROM custom_field_definitions WHERE id = ? AND is_deleted = 0').get(id);
  if (!def) throw notFound('字段定义不存在');
  return def;
}

// ---------------------------------------------------------------- 字段值（⚠️ 静态子路径写在参数化路径之前）
// 读字段值：任何登录用户可读（业务详情页/编辑页渲染需要）
router.get('/custom-fields/values/:entity_type/:entity_id', (req, res, next) => {
  if (!req.user) return next(forbidden('未识别身份'));
  ok(res, customField.readValues(req.params.entity_type, req.params.entity_id));
});

// ---------------------------------------------------------------- 字段定义
// 读字定义：任何登录用户可读（业务编辑页渲染需要）；只有管理（新增/修改/禁用）才需要 custom_field:manage
router.get('/custom-fields', (req, res, next) => {
  if (!req.user) return next(forbidden('未识别身份'));
  const entityType = req.query.entity_type;
  if (!entityType) throw badRequest('entity_type 为必填项');
  // include_disabled 只对管理员/有 custom_field:manage 权限者生效（普通用户只看启用中的字段）
  const includeDisabled =
    (req.user.isAdmin || req.user.permissions.has('custom_field:manage')) &&
    (req.query.include_disabled === 'true' || req.query.include_disabled === '1');
  ok(res, customField.listDefs(entityType, { includeDisabled }).map(decorate));
});

router.put('/custom-fields/values/:entity_type/:entity_id', requirePermission('custom_field:manage'), (req, res) => {
  const body = bodyOf(req);
  if (!body.values || typeof body.values !== 'object') throw badRequest('values 为必填对象');
  const { entity_type: entityType, entity_id: entityId } = req.params;
  if (!customField.ENTITY_TYPES.includes(entityType)) throw badRequest(`不支持的实体类型：${entityType}`);
  customField.setValues(entityType, entityId, body.values, req.user.id);
  logOperation(req, {
    action: 'UPDATE_CUSTOM_FIELD_VALUES',
    targetType: 'CustomFieldValue',
    targetId: entityId,
    detail: { entity_type: entityType, fields: Object.keys(body.values) },
    logType: 'config',
  });
  ok(res, customField.readValues(entityType, entityId));
});

router.post('/custom-fields', requirePermission('custom_field:manage'), (req, res) => {
  const body = bodyOf(req);
  const entityType = requireString(body, 'entity_type', '实体类型');
  if (!customField.ENTITY_TYPES.includes(entityType)) throw badRequest(`不支持的实体类型：${entityType}`);
  const fieldCode = requireString(body, 'field_code', '字段编码');
  const fieldName = requireString(body, 'field_name', '字段名称');
  const fieldType = requireString(body, 'field_type', '字段类型');
  const stageId = resolveStageId(entityType, body.stage_config_id);
  // 字段编码在软删除后仍占位（表级 UNIQUE(entity_type, field_code)），故此处不排除已删除记录
  if (db.prepare('SELECT id FROM custom_field_definitions WHERE entity_type = ? AND field_code = ?').get(entityType, fieldCode)) {
    throw conflict(`字段编码「${fieldCode}」在该实体下已存在`, CODE.DUPLICATE);
  }
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO custom_field_definitions
      (id, entity_type, field_code, field_name, field_type, is_required, default_value, options, field_group, stage_config_id, sort_order,
       is_enabled, validation_rules, visible_roles, is_list_visible, is_dup_check, is_system, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(
    id, entityType, fieldCode, fieldName, fieldType, body.is_required ? 1 : 0, optional(body, 'default_value'),
    jsonOrNull(body.options), optional(body, 'field_group'), stageId, Number(body.sort_order) || 0,
    body.is_enabled === false ? 0 : 1, jsonOrNull(body.validation_rules), jsonOrNull(body.visible_roles),
    body.is_list_visible === false ? 0 : 1, body.is_dup_check ? 1 : 0, t, t
  );
  logOperation(req, {
    action: 'CREATE_CUSTOM_FIELD',
    targetType: 'CustomFieldDefinition',
    targetId: id,
    detail: { entity_type: entityType, field_code: fieldCode },
    logType: 'config',
  });
  created(res, decorate(db.prepare('SELECT * FROM custom_field_definitions WHERE id = ?').get(id)));
});

router.get('/custom-fields/:id/references', requirePermission('custom_field:view'), (req, res) => {
  const def = defOr404(req.params.id);
  const refs = customField.referencesOf(def);
  ok(res, { total: refs.length, list: refs });
});

router.post('/custom-fields/:id/toggle', requirePermission('custom_field:manage'), (req, res) => {
  const def = defOr404(req.params.id);
  const body = bodyOf(req);
  const enabled = body.is_enabled === undefined ? (def.is_enabled === 1 ? 0 : 1) : (body.is_enabled ? 1 : 0);
  db.prepare('UPDATE custom_field_definitions SET is_enabled = ?, updated_at = ? WHERE id = ?').run(enabled, now(), def.id);
  logOperation(req, {
    action: 'TOGGLE_CUSTOM_FIELD',
    targetType: 'CustomFieldDefinition',
    targetId: def.id,
    detail: { is_enabled: enabled },
    logType: 'config',
  });
  ok(res, decorate(db.prepare('SELECT * FROM custom_field_definitions WHERE id = ?').get(def.id)));
});

router.put('/custom-fields/:id', requirePermission('custom_field:manage'), (req, res) => {
  const def = defOr404(req.params.id);
  const body = bodyOf(req);
  const fields = {};
  ['field_name', 'field_type', 'default_value', 'field_group'].forEach((f) => {
    if (body[f] !== undefined) fields[f] = body[f];
  });
  if (body.is_required !== undefined) fields.is_required = body.is_required ? 1 : 0;
  if (body.stage_config_id !== undefined) fields.stage_config_id = resolveStageId(def.entity_type, body.stage_config_id);
  if (body.options !== undefined) fields.options = jsonOrNull(body.options);
  if (body.sort_order !== undefined) fields.sort_order = Number(body.sort_order) || 0;
  if (body.is_enabled !== undefined) fields.is_enabled = body.is_enabled ? 1 : 0;
  if (body.validation_rules !== undefined) fields.validation_rules = jsonOrNull(body.validation_rules);
  if (body.visible_roles !== undefined) fields.visible_roles = jsonOrNull(body.visible_roles);
  if (body.is_list_visible !== undefined) fields.is_list_visible = body.is_list_visible ? 1 : 0;
  if (body.is_dup_check !== undefined) fields.is_dup_check = body.is_dup_check ? 1 : 0;
  if (!Object.keys(fields).length) throw badRequest('没有可更新的字段（field_code 不可修改）');
  const sets = Object.keys(fields).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE custom_field_definitions SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...fields, id: def.id, t: now() });
  logOperation(req, { action: 'UPDATE_CUSTOM_FIELD', targetType: 'CustomFieldDefinition', targetId: def.id, detail: fields, logType: 'config' });
  ok(res, decorate(db.prepare('SELECT * FROM custom_field_definitions WHERE id = ?').get(def.id)));
});

router.delete('/custom-fields/:id', requirePermission('custom_field:manage'), (req, res) => {
  const def = defOr404(req.params.id);
  const refs = customField.referencesOf(def);
  if (refs.length) throw conflict('该字段已被阶段固定动作/视图/报表引用，禁止删除', CODE.FIELD_REFERENCED, refs);
  db.prepare('UPDATE custom_field_definitions SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), def.id);
  db.prepare('DELETE FROM custom_field_values WHERE entity_type = ? AND field_code = ?').run(def.entity_type, def.field_code);
  logOperation(req, {
    action: 'DELETE_CUSTOM_FIELD',
    targetType: 'CustomFieldDefinition',
    targetId: def.id,
    detail: { entity_type: def.entity_type, field_code: def.field_code },
    logType: 'config',
  });
  ok(res, { id: def.id, deleted: true });
});

module.exports = router;
