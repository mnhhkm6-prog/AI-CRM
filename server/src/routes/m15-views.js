'use strict';

/**
 * M15 视图与报表配置（P42–P44，M15-R1~R6）
 * 覆盖：视图配置 CRUD/设默认、报表模板 CRUD/预览、报表订阅
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, conflict, forbidden } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const { logOperation } = require('../services/operationLog');

/** JSON 解析容错：失败返回原值 */
function parseMaybe(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return v;
  }
}

/** 数组/对象 JSON 序列化；null/undefined 原样保留 */
function ser(v, fallback) {
  if (v === undefined) return fallback === undefined ? null : fallback;
  if (v === null) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const parseView = (v) => (v ? {
  ...v,
  columns: parseMaybe(v.columns),
  default_filter: parseMaybe(v.default_filter),
  default_sort: parseMaybe(v.default_sort),
  group_by: parseMaybe(v.group_by),
} : null);

const parseTemplate = (t) => (t ? {
  ...t,
  dimensions: parseMaybe(t.dimensions),
  metrics: parseMaybe(t.metrics),
  filter_config: parseMaybe(t.filter_config),
} : null);

// ---------------------------------------------------------------- 视图配置
/** 视图列表（M15-R1）：系统默认 + 个人 + 共享 */
router.get('/views', requirePermission('view:view'), (req, res) => {
  const entityType = requireString(req.query, 'entity_type', '实体类型');
  const conditions = ['is_deleted = 0', 'entity_type = ?'];
  const params = [entityType];
  if (req.query.view_type) {
    conditions.push('view_type = ?');
    params.push(req.query.view_type);
  }
  if (req.query.scope) {
    conditions.push('scope = ?');
    params.push(req.query.scope);
  }
  conditions.push("(view_type = 'default' OR owner_id = ? OR scope = 'all' OR view_type = 'shared')");
  params.push(req.user.id);

  const list = db.prepare(
    `SELECT * FROM view_configs WHERE ${conditions.join(' AND ')} ORDER BY is_default DESC, is_system DESC, created_at DESC`
  ).all(...params);
  ok(res, list.map(parseView));
});

/** 新增视图（M15-R1/R2） */
router.post('/views', requirePermission('view:manage'), (req, res) => {
  const body = bodyOf(req);
  const viewName = requireString(body, 'view_name', '视图名称');
  const entityType = requireString(body, 'entity_type', '实体类型');
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO view_configs
      (id, view_name, entity_type, view_type, scope, owner_id, columns, default_filter, default_sort, group_by, page_size, is_system, is_default, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`
  ).run(
    id, viewName, entityType,
    optional(body, 'view_type', 'personal'), optional(body, 'scope', 'self'), req.user.id,
    ser(body.columns, null), ser(body.default_filter, null), ser(body.default_sort, null), ser(body.group_by, null),
    optional(body, 'page_size', 20), t, t
  );
  logOperation(req, { action: 'CREATE_VIEW', targetType: 'ViewConfig', targetId: id, detail: { view_name: viewName } });
  created(res, parseView(db.prepare('SELECT * FROM view_configs WHERE id = ?').get(id)));
});

/** 编辑视图（系统默认禁止；仅本人或管理员） */
router.put('/views/:id', requirePermission('view:manage'), (req, res) => {
  const view = db.prepare('SELECT * FROM view_configs WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!view) throw notFound('视图不存在');
  if (view.is_system === 1) throw conflict('系统默认视图不可修改');
  if (!req.user.isAdmin && view.owner_id !== req.user.id) throw forbidden('仅创建人可修改该视图');

  const body = bodyOf(req);
  const after = {};
  ['view_name', 'view_type', 'scope', 'page_size'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  ['columns', 'default_filter', 'default_sort', 'group_by'].forEach((f) => {
    if (body[f] !== undefined) after[f] = ser(body[f], null);
  });
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE view_configs SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: view.id, t: now() });
  logOperation(req, { action: 'UPDATE_VIEW', targetType: 'ViewConfig', targetId: view.id, detail: after });
  ok(res, parseView(db.prepare('SELECT * FROM view_configs WHERE id = ?').get(view.id)));
});

/** 删除视图（系统默认禁止；软删） */
router.delete('/views/:id', requirePermission('view:manage'), (req, res) => {
  const view = db.prepare('SELECT * FROM view_configs WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!view) throw notFound('视图不存在');
  if (view.is_system === 1) throw conflict('系统默认视图不可删除');
  if (!req.user.isAdmin && view.owner_id !== req.user.id) throw forbidden('仅创建人可删除该视图');
  db.prepare('UPDATE view_configs SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), view.id);
  logOperation(req, { action: 'DELETE_VIEW', targetType: 'ViewConfig', targetId: view.id, detail: { view_name: view.view_name } });
  ok(res, { id: view.id, deleted: true });
});

/** 设为默认视图 */
router.post('/views/:id/set-default', requirePermission('view:manage'), (req, res) => {
  const view = db.prepare('SELECT * FROM view_configs WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!view) throw notFound('视图不存在');
  const t = now();
  db.transaction(() => {
    db.prepare('UPDATE view_configs SET is_default = 0, updated_at = ? WHERE entity_type = ? AND owner_id IS ? AND is_deleted = 0')
      .run(t, view.entity_type, view.owner_id);
    db.prepare('UPDATE view_configs SET is_default = 1, updated_at = ? WHERE id = ?').run(t, view.id);
  })();
  logOperation(req, { action: 'SET_DEFAULT_VIEW', targetType: 'ViewConfig', targetId: view.id });
  ok(res, parseView(db.prepare('SELECT * FROM view_configs WHERE id = ?').get(view.id)));
});

// ---------------------------------------------------------------- 报表模板
router.get('/report-templates', requirePermission('report_template:view'), (req, res) => {
  const list = db.prepare('SELECT * FROM report_templates WHERE is_deleted = 0 ORDER BY is_system DESC, created_at').all();
  ok(res, list.map(parseTemplate));
});

/** 新增报表模板（M15-R5） */
router.post('/report-templates', requirePermission('report_template:manage'), (req, res) => {
  const body = bodyOf(req);
  const name = requireString(body, 'template_name', '模板名称');
  const type = requireString(body, 'template_type', '模板类型');
  const source = requireString(body, 'data_source', '数据源');
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO report_templates
      (id, template_name, template_type, data_source, dimensions, metrics, chart_type, filter_config, is_system, is_enabled, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?, ?)`
  ).run(id, name, type, source, ser(body.dimensions, null), ser(body.metrics, null),
    optional(body, 'chart_type', 'table'), ser(body.filter_config, null), t, t);
  logOperation(req, { action: 'CREATE_REPORT_TEMPLATE', targetType: 'ReportTemplate', targetId: id, detail: { template_name: name } });
  created(res, parseTemplate(db.prepare('SELECT * FROM report_templates WHERE id = ?').get(id)));
});

/** 编辑报表模板 */
router.put('/report-templates/:id', requirePermission('report_template:manage'), (req, res) => {
  const tpl = db.prepare('SELECT * FROM report_templates WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!tpl) throw notFound('报表模板不存在');
  const body = bodyOf(req);
  const after = {};
  ['template_name', 'template_type', 'data_source', 'chart_type', 'is_enabled'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  ['dimensions', 'metrics', 'filter_config'].forEach((f) => {
    if (body[f] !== undefined) after[f] = ser(body[f], null);
  });
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE report_templates SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: tpl.id, t: now() });
  logOperation(req, { action: 'UPDATE_REPORT_TEMPLATE', targetType: 'ReportTemplate', targetId: tpl.id, detail: after });
  ok(res, parseTemplate(db.prepare('SELECT * FROM report_templates WHERE id = ?').get(tpl.id)));
});

/** 删除报表模板（系统预置禁止） */
router.delete('/report-templates/:id', requirePermission('report_template:manage'), (req, res) => {
  const tpl = db.prepare('SELECT * FROM report_templates WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!tpl) throw notFound('报表模板不存在');
  if (tpl.is_system === 1) throw conflict('系统预置报表模板不可删除');
  db.prepare('UPDATE report_templates SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), tpl.id);
  logOperation(req, { action: 'DELETE_REPORT_TEMPLATE', targetType: 'ReportTemplate', targetId: tpl.id, detail: { template_name: tpl.template_name } });
  ok(res, { id: tpl.id, deleted: true });
});

/** 报表预览渲染（M15-R5） */
router.post('/report-templates/:id/preview', requirePermission('report_template:view'), (req, res) => {
  const tpl = db.prepare('SELECT * FROM report_templates WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!tpl) throw notFound('报表模板不存在');
  const dims = parseMaybe(tpl.dimensions) || [];
  const metrics = parseMaybe(tpl.metrics) || [];
  const filter = parseMaybe(tpl.filter_config) || {};
  const days = Math.trunc(Number(filter.recent_days));
  const useRecent = Number.isFinite(days) && days > 0;

  let columns = [];
  let rows = [];
  if (tpl.data_source === 'opportunities') {
    const allowed = ['stage_name_snapshot', 'owner_id', 'status', 'is_in_sea', 'customer_id', 'name'];
    let dim = Array.isArray(dims) && dims.length ? dims[0] : 'stage_name_snapshot';
    if (!allowed.includes(dim)) dim = 'stage_name_snapshot';
    const wantAmount = Array.isArray(metrics) && metrics.includes('amount');
    const amountSel = wantAmount ? ', COALESCE(SUM(amount), 0) AS amount' : '';
    const where = useRecent ? "is_deleted = 0 AND created_at >= datetime('now', ?)" : 'is_deleted = 0';
    const stmt = db.prepare(
      `SELECT ${dim} AS dim, COUNT(*) AS count${amountSel} FROM opportunities WHERE ${where} GROUP BY ${dim} ORDER BY count DESC`
    );
    rows = useRecent ? stmt.all('-' + days + ' days') : stmt.all();
    columns = [{ key: 'dim', label: dim }, { key: 'count', label: '数量' }];
    if (wantAmount) columns.push({ key: 'amount', label: '金额' });
  } else if (tpl.data_source === 'stale_alerts') {
    const stmt = useRecent
      ? db.prepare("SELECT alert_level AS dim, COUNT(*) AS count FROM stale_alerts WHERE created_at >= datetime('now', ?) GROUP BY alert_level ORDER BY count DESC")
      : db.prepare('SELECT alert_level AS dim, COUNT(*) AS count FROM stale_alerts GROUP BY alert_level ORDER BY count DESC');
    rows = useRecent ? stmt.all('-' + days + ' days') : stmt.all();
    columns = [{ key: 'dim', label: '预警级别' }, { key: 'count', label: '数量' }];
  } else if (tpl.data_source === 'loss_records') {
    const stmt = useRecent
      ? db.prepare("SELECT loss_reason AS dim, COUNT(*) AS count FROM loss_records WHERE created_at >= datetime('now', ?) GROUP BY loss_reason ORDER BY count DESC")
      : db.prepare('SELECT loss_reason AS dim, COUNT(*) AS count FROM loss_records GROUP BY loss_reason ORDER BY count DESC');
    rows = useRecent ? stmt.all('-' + days + ' days') : stmt.all();
    columns = [{ key: 'dim', label: '失效原因' }, { key: 'count', label: '数量' }];
  }
  ok(res, { columns, rows, chart_type: tpl.chart_type });
});

// ---------------------------------------------------------------- 报表订阅
/** 订阅列表（M15-R6） */
router.get('/report-subscriptions', requirePermission('report:view'), (req, res) => {
  const list = db.prepare(
    `SELECT s.*, t.template_name FROM report_subscriptions s
     LEFT JOIN report_templates t ON t.id = s.template_id
     ORDER BY s.created_at DESC`
  ).all();
  ok(res, list.map((s) => ({ ...s, receivers: parseMaybe(s.receivers) })));
});

/** 新增订阅（M15-R6） */
router.post('/report-subscriptions', requirePermission('report:view'), (req, res) => {
  const body = bodyOf(req);
  const templateId = requireString(body, 'template_id', '报表模板');
  const frequency = requireString(body, 'frequency', '推送频率');
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) throw badRequest('frequency 必须为 daily/weekly/monthly');
  const format = requireString(body, 'format', '导出格式');
  if (!['excel', 'html'].includes(format)) throw badRequest('format 必须为 excel 或 html');
  if (!Array.isArray(body.receivers) || !body.receivers.length) throw badRequest('receivers 不能为空');

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO report_subscriptions (id, template_id, frequency, receivers, format, is_enabled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(id, templateId, frequency, JSON.stringify(body.receivers), format, req.user.id, t, t);
  logOperation(req, { action: 'CREATE_REPORT_SUBSCRIPTION', targetType: 'ReportSubscription', targetId: id, detail: { frequency } });
  const row = db.prepare('SELECT * FROM report_subscriptions WHERE id = ?').get(id);
  created(res, { ...row, receivers: parseMaybe(row.receivers) });
});

/** 编辑订阅（M15-R6） */
router.put('/report-subscriptions/:id', requirePermission('report:view'), (req, res) => {
  const sub = db.prepare('SELECT * FROM report_subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) throw notFound('报表订阅不存在');
  const body = bodyOf(req);
  const after = {};
  if (body.template_id !== undefined) after.template_id = body.template_id;
  if (body.frequency !== undefined) {
    if (!['daily', 'weekly', 'monthly'].includes(body.frequency)) throw badRequest('frequency 必须为 daily/weekly/monthly');
    after.frequency = body.frequency;
  }
  if (body.format !== undefined) {
    if (!['excel', 'html'].includes(body.format)) throw badRequest('format 必须为 excel 或 html');
    after.format = body.format;
  }
  if (body.receivers !== undefined) {
    if (!Array.isArray(body.receivers) || !body.receivers.length) throw badRequest('receivers 不能为空');
    after.receivers = JSON.stringify(body.receivers);
  }
  if (body.is_enabled !== undefined) after.is_enabled = body.is_enabled ? 1 : 0;
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE report_subscriptions SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: sub.id, t: now() });
  logOperation(req, { action: 'UPDATE_REPORT_SUBSCRIPTION', targetType: 'ReportSubscription', targetId: sub.id, detail: after });
  const row = db.prepare('SELECT * FROM report_subscriptions WHERE id = ?').get(sub.id);
  ok(res, { ...row, receivers: parseMaybe(row.receivers) });
});

/** 删除订阅（该表无 is_deleted，物理删除）M15-R6 */
router.delete('/report-subscriptions/:id', requirePermission('report:view'), (req, res) => {
  const sub = db.prepare('SELECT * FROM report_subscriptions WHERE id = ?').get(req.params.id);
  if (!sub) throw notFound('报表订阅不存在');
  db.prepare('DELETE FROM report_subscriptions WHERE id = ?').run(sub.id);
  logOperation(req, { action: 'DELETE_REPORT_SUBSCRIPTION', targetType: 'ReportSubscription', targetId: sub.id });
  ok(res, { id: sub.id, deleted: true });
});

module.exports = router;
