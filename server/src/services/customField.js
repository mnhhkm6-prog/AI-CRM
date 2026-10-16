'use strict';

/**
 * 自定义字段引擎（PRD 4.7 / 11.2.24 / 11.2.25）
 * 定义存 custom_field_definitions，值存 custom_field_values（EAV）。
 * 对外统一以 { field_code: value } 形式读写。
 */
const { db } = require('../db');
const { newId, now } = require('../utils/ids');
const { badRequest } = require('../utils/errors');

const JSON_TYPES = ['multi_select', 'attachment_list', 'json'];
const NUMBER_TYPES = ['number', 'amount'];
const DATE_TYPES = ['date', 'datetime'];
const BOOL_TYPES = ['boolean'];
const ENTITY_TYPES = ['customer', 'contact', 'lead', 'opportunity', 'activity', 'proposal', 'quotation', 'contract'];

function listDefs(entityType, { includeDisabled = false } = {}) {
  const where = ['is_deleted = 0'];
  const params = [];
  if (entityType) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (!includeDisabled) where.push('is_enabled = 1');
  return db
    .prepare(`SELECT * FROM custom_field_definitions WHERE ${where.join(' AND ')} ORDER BY entity_type, sort_order`)
    .all(...params);
}

function defMap(entityType, opts) {
  const map = new Map();
  listDefs(entityType, opts).forEach((d) => map.set(d.field_code, d));
  return map;
}

/** 把 JS 值按字段类型落到对应的存储列 */
function serialize(def, raw) {
  const out = { value_text: null, value_json: null, value_number: null, value_datetime: null };
  if (raw === undefined || raw === null || raw === '') return out;
  if (JSON_TYPES.includes(def.field_type)) {
    out.value_json = typeof raw === 'string' ? raw : JSON.stringify(raw);
    out.value_text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  } else if (NUMBER_TYPES.includes(def.field_type)) {
    const n = Number(raw);
    if (Number.isNaN(n)) throw badRequest(`字段「${def.field_name}」必须为数字`);
    out.value_number = n;
    out.value_text = String(n);
  } else if (BOOL_TYPES.includes(def.field_type)) {
    const b = raw === true || raw === 'true' || raw === 1 || raw === '1';
    out.value_number = b ? 1 : 0;
    out.value_text = b ? 'true' : 'false';
  } else if (DATE_TYPES.includes(def.field_type)) {
    out.value_datetime = String(raw);
    out.value_text = String(raw);
  } else {
    out.value_text = String(raw);
  }
  return out;
}

/** 把存储列还原为 JS 值 */
function deserialize(def, row) {
  if (!row) return null;
  if (JSON_TYPES.includes(def.field_type)) {
    if (row.value_json === null || row.value_json === undefined) return null;
    try {
      return JSON.parse(row.value_json);
    } catch (e) {
      return row.value_json;
    }
  }
  if (NUMBER_TYPES.includes(def.field_type)) return row.value_number;
  if (BOOL_TYPES.includes(def.field_type)) return row.value_number === 1;
  if (DATE_TYPES.includes(def.field_type)) return row.value_datetime;
  return row.value_text;
}

/** 读取实体全部自定义字段值 */
function readValues(entityType, entityId) {
  const defs = defMap(entityType);
  const rows = db
    .prepare('SELECT * FROM custom_field_values WHERE entity_type = ? AND entity_id = ?')
    .all(entityType, entityId);
  const out = {};
  rows.forEach((r) => {
    const def = defs.get(r.field_code);
    out[r.field_code] = def ? deserialize(def, r) : r.value_text;
  });
  return out;
}

/**
 * 写入自定义字段值
 * @param {object} values { field_code: value }
 * @param {boolean} partial 为 true 时只更新传入的字段
 */
function setValues(entityType, entityId, values, userId, { partial = true } = {}) {
  if (!values || typeof values !== 'object') return;
  const defs = defMap(entityType, { includeDisabled: true });
  const upsert = db.prepare(
    `INSERT INTO custom_field_values
      (id, entity_type, entity_id, field_definition_id, field_code, value_text, value_json, value_number, value_datetime, updated_by, created_at, updated_at)
     VALUES (@id, @entity_type, @entity_id, @def_id, @field_code, @value_text, @value_json, @value_number, @value_datetime, @updated_by, @t, @t)
     ON CONFLICT(entity_type, entity_id, field_code) DO UPDATE SET
       value_text = excluded.value_text, value_json = excluded.value_json,
       value_number = excluded.value_number, value_datetime = excluded.value_datetime,
       field_definition_id = excluded.field_definition_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  );
  Object.entries(values).forEach(([code, raw]) => {
    const def = defs.get(code);
    if (!def) return; // 未定义的字段忽略
    const v = serialize(def, raw);
    upsert.run({
      id: newId(), entity_type: entityType, entity_id: entityId, def_id: def.id, field_code: code,
      ...v, updated_by: userId || null, t: now(),
    });
  });
  // partial=false 时清空未提交的非必填字段
  if (!partial) {
    defs.forEach((def, code) => {
      if (!(code in values) && def.is_required !== 1) {
        db.prepare('DELETE FROM custom_field_values WHERE entity_type = ? AND entity_id = ? AND field_code = ?')
          .run(entityType, entityId, code);
      }
    });
  }
}

/** 必填校验：返回缺失字段清单（不含阶段固定动作） */
function missingRequired(entityType, values) {
  const defs = listDefs(entityType).filter((d) => d.is_required === 1);
  const missing = [];
  defs.forEach((d) => {
    const v = values ? values[d.field_code] : undefined;
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) missing.push({ field_code: d.field_code, field_name: d.field_name });
  });
  return missing;
}

/** 读取实体在指定字段上的原始值（供阶段校验用） */
function valueOf(entityType, entityId, fieldCode) {
  const row = db
    .prepare('SELECT * FROM custom_field_values WHERE entity_type = ? AND entity_id = ? AND field_code = ?')
    .get(entityType, entityId, fieldCode);
  const def = db
    .prepare('SELECT * FROM custom_field_definitions WHERE entity_type = ? AND field_code = ?')
    .get(entityType, fieldCode);
  if (!row) return null;
  return def ? deserialize(def, row) : row.value_text;
}

/** 列表附加自定义字段：rows 会被补上 custom_fields 属性 */
function attach(entityType, rows, idField = 'id') {
  if (!rows || !rows.length) return rows;
  const defs = defMap(entityType);
  const ids = rows.map((r) => r[idField]);
  const ph = ids.map(() => '?').join(',');
  const values = db
    .prepare(`SELECT * FROM custom_field_values WHERE entity_type = ? AND entity_id IN (${ph})`)
    .all(entityType, ...ids);
  const grouped = {};
  values.forEach((v) => {
    (grouped[v.entity_id] = grouped[v.entity_id] || {})[v.field_code] = v;
  });
  rows.forEach((r) => {
    const own = grouped[r[idField]] || {};
    const cf = {};
    Object.entries(own).forEach(([code, v]) => {
      const def = defs.get(code);
      cf[code] = def ? deserialize(def, v) : v.value_text;
    });
    r.custom_fields = cf;
  });
  return rows;
}

/** 支持 ?cf_<field_code>=value 的自定义字段筛选 */
function buildFilter(entityType, query, conditions, params) {
  Object.keys(query || {}).forEach((k) => {
    if (!k.startsWith('cf_')) return;
    const code = k.slice(3);
    const def = db
      .prepare('SELECT * FROM custom_field_definitions WHERE entity_type = ? AND field_code = ? AND is_deleted = 0')
      .get(entityType, code);
    if (!def) return;
    const raw = query[k];
    const v = serialize(def, raw);
    const col = v.value_number !== null ? 'value_number' : v.value_datetime ? 'value_datetime' : 'value_text';
    const val = v.value_number !== null ? v.value_number : v.value_datetime || v.value_text;
    conditions.push(
      `EXISTS (SELECT 1 FROM custom_field_values cv WHERE cv.entity_type = ? AND cv.entity_id = t.id
               AND cv.field_code = ? AND cv.${col} = ?)`
    );
    params.push(entityType, code, val);
  });
}

/** 字段被引用情况（M12-R3：阶段固定动作 / 视图 / 报表） */
function referencesOf(def) {
  if (!def) return [];
  const refs = [];
  db.prepare('SELECT r.*, s.name AS stage_name FROM stage_action_rules r LEFT JOIN stage_configs s ON s.id = r.stage_config_id WHERE r.field_key = ?')
    .all(def.field_code)
    .forEach((r) => refs.push({ type: 'stage_action_rule', id: r.id, name: `${r.stage_name || ''} / ${r.action_name}` }));
  db.prepare('SELECT * FROM view_configs WHERE is_deleted = 0').all().forEach((v) => {
    if ((v.columns || '').includes(def.field_code) || (v.default_filter || '').includes(def.field_code)) {
      refs.push({ type: 'view_config', id: v.id, name: v.view_name });
    }
  });
  db.prepare('SELECT * FROM report_templates WHERE is_deleted = 0').all().forEach((r) => {
    const text = `${r.dimensions || ''}${r.metrics || ''}${r.filter_config || ''}`;
    if (text.includes(def.field_code)) refs.push({ type: 'report_template', id: r.id, name: r.template_name });
  });
  return refs;
}

module.exports = {
  ENTITY_TYPES, JSON_TYPES, NUMBER_TYPES, DATE_TYPES, BOOL_TYPES,
  listDefs, defMap, serialize, deserialize, readValues, setValues,
  missingRequired, valueOf, attach, buildFilter, referencesOf,
};
