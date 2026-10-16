'use strict';

/**
 * M14 系统字典管理（P41，M14-R1~R3）
 * 覆盖：字典类型 CRUD、字典项 CRUD、引用明细与删除前引用校验
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, conflict, CODE } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const { logOperation } = require('../services/operationLog');

const getType = (id) => db.prepare('SELECT * FROM dictionary_types WHERE id = ? AND is_deleted = 0').get(id) || null;
const needType = (id) => {
  const type = getType(id);
  if (!type) throw notFound('字典类型不存在');
  return type;
};
const getItem = (id) => db.prepare('SELECT * FROM dictionary_items WHERE id = ? AND is_deleted = 0').get(id) || null;

/** 字典项引用来源定义（M14-R2） */
const REF_SOURCES = [
  { type: 'custom_field_definition', table: 'custom_field_definitions', column: 'options', json: true, deleted: true },
  { type: 'stage_action_rule', table: 'stage_action_rules', column: 'options', json: true },
  { type: 'customer_industry', table: 'customers', column: 'industry', deleted: true },
  { type: 'customer_scale', table: 'customers', column: 'scale', deleted: true },
  { type: 'customer_source_channel', table: 'customers', column: 'source_channel', deleted: true },
  { type: 'lead_source_channel', table: 'leads', column: 'source_channel', deleted: true },
  { type: 'activity_type', table: 'activities', column: 'activity_type', deleted: true },
  { type: 'product_type', table: 'products', column: 'product_type', deleted: true },
  { type: 'quotation_product_type', table: 'quotations', column: 'product_type', deleted: true },
];

/** 统计某字典项名称在各业务表中的引用数量 */
function referencesOfItem(itemName) {
  const refs = [];
  REF_SOURCES.forEach((s) => {
    const where = s.json ? `${s.column} LIKE ?` : `${s.column} = ?`;
    const param = s.json ? `%"${itemName}"%` : itemName;
    const extra = s.deleted ? ' AND is_deleted = 0' : '';
    let count = 0;
    try {
      count = db.prepare(`SELECT COUNT(*) c FROM ${s.table} WHERE ${where}${extra}`).get(param).c;
    } catch (e) {
      count = 0;
    }
    if (count > 0) refs.push({ type: s.type, count });
  });
  return refs;
}

/** 字典类型列表（M14-R1）：附带字典项数量 */
router.get('/dictionaries', requirePermission('dictionary:view'), (req, res) => {
  const conditions = ['is_deleted = 0'];
  const params = [];
  if (req.query.category) {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  if (req.query.is_enabled !== undefined) {
    conditions.push('is_enabled = ?');
    params.push(req.query.is_enabled === 'true' || req.query.is_enabled === '1' ? 1 : 0);
  }
  const list = db.prepare(
    `SELECT * FROM dictionary_types WHERE ${conditions.join(' AND ')} ORDER BY category, dict_code`
  ).all(...params);
  const counts = {};
  db.prepare('SELECT dict_type_id, COUNT(*) c FROM dictionary_items WHERE is_deleted = 0 GROUP BY dict_type_id')
    .all().forEach((r) => { counts[r.dict_type_id] = r.c; });
  ok(res, list.map((t) => ({ ...t, item_count: counts[t.id] || 0 })));
});

/** 新增字典类型（M14-R1） */
router.post('/dictionaries', requirePermission('dictionary:manage'), (req, res) => {
  const body = bodyOf(req);
  const dictCode = requireString(body, 'dict_code', '字典编码');
  const dictName = requireString(body, 'dict_name', '字典名称');
  if (db.prepare('SELECT id FROM dictionary_types WHERE dict_code = ?').get(dictCode)) {
    throw badRequest(`字典编码已存在：${dictCode}`);
  }
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO dictionary_types (id, dict_code, dict_name, category, description, is_system, is_enabled, version, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, 1, 0, ?, ?)`
  ).run(id, dictCode, dictName, optional(body, 'category', dictCode), optional(body, 'description'), t, t);
  logOperation(req, { action: 'CREATE_DICTIONARY', targetType: 'DictionaryType', targetId: id, detail: { dict_code: dictCode } });
  created(res, getType(id));
});

/** 编辑字典项 */
router.put('/dictionary-items/:id', requirePermission('dictionary:manage'), (req, res) => {
  const item = getItem(req.params.id);
  if (!item) throw notFound('字典项不存在');
  const body = bodyOf(req);
  const after = {};
  ['item_name', 'sort_order', 'is_default', 'is_enabled', 'remark'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (body.item_code !== undefined) {
    const code = String(body.item_code).trim();
    const dup = db.prepare(
      'SELECT id FROM dictionary_items WHERE dict_type_id = ? AND item_code = ? AND is_deleted = 0 AND id <> ?'
    ).get(item.dict_type_id, code, item.id);
    if (dup) throw badRequest(`字典项编码已存在：${code}`);
    after.item_code = code;
  }
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const t = now();
  db.transaction(() => {
    const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE dictionary_items SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: item.id, t });
    db.prepare('UPDATE dictionary_types SET version = version + 1, updated_at = ? WHERE id = ?').run(t, item.dict_type_id);
  })();
  logOperation(req, { action: 'UPDATE_DICTIONARY_ITEM', targetType: 'DictionaryItem', targetId: item.id, detail: after });
  ok(res, getItem(item.id));
});

/** 删除字典项（被引用时需二次确认）M14-R2 */
router.delete('/dictionary-items/:id', requirePermission('dictionary:manage'), (req, res) => {
  const item = getItem(req.params.id);
  if (!item) throw notFound('字典项不存在');
  const refs = referencesOfItem(item.item_name);
  const confirmed = req.query.confirm === 'true' || req.query.confirm === '1';
  if (refs.length && !confirmed) {
    throw conflict('该字典项已被引用，删除需二次确认', CODE.DICT_REFERENCED, refs);
  }
  const t = now();
  db.transaction(() => {
    db.prepare('UPDATE dictionary_items SET is_deleted = 1, updated_at = ? WHERE id = ?').run(t, item.id);
    db.prepare('UPDATE dictionary_types SET version = version + 1, updated_at = ? WHERE id = ?').run(t, item.dict_type_id);
  })();
  logOperation(req, { action: 'DELETE_DICTIONARY_ITEM', targetType: 'DictionaryItem', targetId: item.id, detail: { item_name: item.item_name } });
  ok(res, { id: item.id, deleted: true, references: refs });
});

/** 字典类型详情 */
router.get('/dictionaries/:id', requirePermission('dictionary:view'), (req, res) => {
  ok(res, needType(req.params.id));
});

/** 编辑字典类型（version+1；系统内置不可改编码）M14-R3 */
router.put('/dictionaries/:id', requirePermission('dictionary:manage'), (req, res) => {
  const type = needType(req.params.id);
  const body = bodyOf(req);
  const after = {};
  ['dict_name', 'category', 'description', 'is_enabled'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (body.dict_code !== undefined) {
    if (type.is_system === 1) throw conflict('系统内置字典不允许修改编码');
    const code = String(body.dict_code).trim();
    if (db.prepare('SELECT id FROM dictionary_types WHERE dict_code = ? AND id <> ?').get(code, type.id)) {
      throw badRequest(`字典编码已存在：${code}`);
    }
    after.dict_code = code;
  }
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE dictionary_types SET ${sets}, version = version + 1, updated_at = @t WHERE id = @id`)
    .run({ ...after, id: type.id, t: now() });
  logOperation(req, { action: 'UPDATE_DICTIONARY', targetType: 'DictionaryType', targetId: type.id, detail: after });
  ok(res, getType(type.id));
});

/** 删除字典类型（系统内置禁止，软删类型与字典项） */
router.delete('/dictionaries/:id', requirePermission('dictionary:manage'), (req, res) => {
  const type = needType(req.params.id);
  if (type.is_system === 1) throw conflict('系统内置字典不可删除');
  const t = now();
  db.transaction(() => {
    db.prepare('UPDATE dictionary_items SET is_deleted = 1, updated_at = ? WHERE dict_type_id = ?').run(t, type.id);
    db.prepare('UPDATE dictionary_types SET is_deleted = 1, version = version + 1, updated_at = ? WHERE id = ?').run(t, type.id);
  })();
  logOperation(req, { action: 'DELETE_DICTIONARY', targetType: 'DictionaryType', targetId: type.id, detail: { dict_code: type.dict_code } });
  ok(res, { id: type.id, deleted: true });
});

/** 字典项列表（M14-R1） */
router.get('/dictionaries/:id/items', requirePermission('dictionary:view'), (req, res) => {
  const type = needType(req.params.id);
  ok(res, db.prepare(
    'SELECT * FROM dictionary_items WHERE dict_type_id = ? AND is_deleted = 0 ORDER BY sort_order'
  ).all(type.id));
});

/** 新增字典项（写入后字典类型 version+1） */
router.post('/dictionaries/:id/items', requirePermission('dictionary:manage'), (req, res) => {
  const type = needType(req.params.id);
  const body = bodyOf(req);
  const itemCode = requireString(body, 'item_code', '字典项编码');
  const itemName = requireString(body, 'item_name', '字典项名称');
  if (db.prepare('SELECT id FROM dictionary_items WHERE dict_type_id = ? AND item_code = ? AND is_deleted = 0').get(type.id, itemCode)) {
    throw badRequest(`字典项编码已存在：${itemCode}`);
  }
  const id = newId();
  const t = now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO dictionary_items (id, dict_type_id, item_code, item_name, sort_order, is_default, is_enabled, remark, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`
    ).run(id, type.id, itemCode, itemName, optional(body, 'sort_order', 0), body.is_default ? 1 : 0, optional(body, 'remark'), t, t);
    db.prepare('UPDATE dictionary_types SET version = version + 1, updated_at = ? WHERE id = ?').run(t, type.id);
  })();
  logOperation(req, { action: 'CREATE_DICTIONARY_ITEM', targetType: 'DictionaryItem', targetId: id, detail: { item_code: itemCode } });
  created(res, getItem(id));
});

/** 引用明细（M14-R2） */
router.get('/dictionaries/:id/references', requirePermission('dictionary:view'), (req, res) => {
  const type = needType(req.params.id);
  const items = db.prepare(
    'SELECT * FROM dictionary_items WHERE dict_type_id = ? AND is_deleted = 0 ORDER BY sort_order'
  ).all(type.id);
  ok(res, {
    dict_type_id: type.id,
    dict_code: type.dict_code,
    items: items.map((it) => ({
      item_id: it.id,
      item_code: it.item_code,
      item_name: it.item_name,
      references: referencesOfItem(it.item_name),
    })),
  });
});

module.exports = router;
