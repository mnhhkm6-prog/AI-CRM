'use strict';

/**
 * M1 客户管理（P05/P06/P07）
 * 覆盖：客户 CRUD、查重、修改历史、客户 360、转公海、联系人管理
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, getPaging, paged, buildSort, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, conflict, CODE } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const customField = require('../services/customField');
const { logOperation, diffFields } = require('../services/operationLog');
const seaService = require('../services/seaService');

const SORTABLE = ['created_at', 'updated_at', 'name', 'last_activity_at'];
const EDITABLE = ['name', 'type', 'industry', 'scale', 'address', 'credit_code', 'level', 'source_channel', 'owner_id', 'remark'];

/**
 * 客户全生命周期时间轴（P07 / PRD 8.2）
 * 聚合：行为记录、阶段变更、方案/报价/合同上传、停滞预警、失效记录，按时间倒序
 */
function buildTimeline(customerId, { activities, proposals, quotations, contracts }) {
  const events = [];
  activities.forEach((a) =>
    events.push({
      category: 'activity', id: a.id, at: a.activity_time,
      title: `行为记录 · ${a.activity_type}`, content: a.content, ref_id: a.opportunity_id,
    })
  );
  db.prepare(
    `SELECT sh.id, sh.to_stage_name, sh.action_type, sh.reason, sh.created_at, o.id AS opp_id, o.name AS opp_name
     FROM stage_history sh JOIN opportunities o ON o.id = sh.opportunity_id
     WHERE o.customer_id = ?`
  )
    .all(customerId)
    .forEach((s) =>
      events.push({
        category: 'stage', id: s.id, at: s.created_at,
        title: `${s.action_type === 'rollback' ? '阶段回退' : '阶段推进'} → ${s.to_stage_name}`,
        content: s.reason || s.opp_name, ref_id: s.opp_id,
      })
    );
  proposals.forEach((p) =>
    events.push({
      category: 'proposal', id: p.id, at: p.created_at,
      title: `方案上传 · ${p.proposal_type === 'formal' ? '正式方案' : '初步方案'}`,
      content: p.file_name, ref_id: p.opportunity_id,
    })
  );
  quotations.forEach((q) =>
    events.push({
      category: 'quotation', id: q.id, at: q.created_at,
      title: `报价上传 · ${q.quotation_type === 'final' ? '最终报价' : '初步报价'}`,
      content: q.file_name, ref_id: q.opportunity_id,
    })
  );
  contracts.forEach((c) =>
    events.push({
      category: 'contract', id: c.id, at: c.created_at,
      title: '合同签订', content: `${c.contract_no || ''} ${c.amount || ''}`.trim(), ref_id: c.opportunity_id,
    })
  );
  db.prepare(
    `SELECT sa.id, sa.alert_level, sa.triggered_at, sa.days_stagnant, o.id AS opp_id, o.name AS opp_name
     FROM stale_alerts sa JOIN opportunities o ON o.id = sa.opportunity_id WHERE o.customer_id = ?`
  )
    .all(customerId)
    .forEach((a) =>
      events.push({
        category: 'alert', id: a.id, at: a.triggered_at,
        title: `停滞预警 · ${a.alert_level} 级`, content: `${a.opp_name} 停滞 ${a.days_stagnant} 天`, ref_id: a.opp_id,
      })
    );
  db.prepare(
    `SELECT lr.id, lr.loss_reason, lr.created_at, o.id AS opp_id, o.name AS opp_name
     FROM loss_records lr JOIN opportunities o ON o.id = lr.opportunity_id WHERE o.customer_id = ?`
  )
    .all(customerId)
    .forEach((l) =>
      events.push({
        category: 'loss', id: l.id, at: l.created_at,
        title: '商机失效', content: `${l.opp_name} · ${l.loss_reason}`, ref_id: l.opp_id,
      })
    );

  return events.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

/** 客户列表（含数据权限、关键字、自定义字段筛选） */
router.get('/customers', requirePermission('customer:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];

  const scope = dataScope.scopeFragment(req.user, 'customer');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  if (req.query.keyword) {
    conditions.push('(t.name LIKE ? OR t.credit_code LIKE ? OR t.address LIKE ?)');
    const kw = `%${req.query.keyword}%`;
    params.push(kw, kw, kw);
  }
  ['status', 'level', 'industry', 'scale', 'owner_id', 'source_channel'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.is_in_sea !== undefined) {
    conditions.push('t.is_in_sea = ?');
    params.push(req.query.is_in_sea === 'true' || req.query.is_in_sea === '1' ? 1 : 0);
  }
  if (req.query.start_date) {
    conditions.push('t.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.created_at <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }
  customField.buildFilter('customer', req.query, conditions, params);

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM customers t WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, SORTABLE);
  const list = db
    .prepare(
      `SELECT t.*, u.name AS owner_name FROM customers t
       LEFT JOIN users u ON u.id = t.owner_id
       WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);

  customField.attach('customer', list);
  ok(res, paged(list, total, paging));
});

/** 客户查重（M1-R3：同名 / 同电话） */
router.post('/customers/check-duplicate', requirePermission('customer:create'), (req, res) => {
  const body = bodyOf(req);
  const name = body.name ? String(body.name).trim() : null;
  const phone = body.phone || body.contact_phone ? String(body.phone || body.contact_phone).trim() : null;
  if (!name && !phone) throw badRequest('请至少提供 name 或 phone 用于查重');

  const matches = [];
  if (name) {
    db.prepare('SELECT id, name, owner_id, source_channel FROM customers WHERE is_deleted = 0 AND name = ?')
      .all(name)
      .forEach((c) => matches.push({ ...c, match_type: 'name' }));
  }
  if (phone) {
    db.prepare(
      `SELECT c.id, c.name, c.owner_id, ct.phone FROM contacts ct JOIN customers c ON c.id = ct.customer_id
       WHERE ct.is_deleted = 0 AND ct.phone = ?`
    )
      .all(phone)
      .forEach((c) => matches.push({ ...c, match_type: 'phone' }));
  }
  ok(res, { duplicated: matches.length > 0, matches });
});

/** 新增客户（M1-R1） */
router.post('/customers', requirePermission('customer:create'), (req, res) => {
  const body = bodyOf(req);
  const name = requireString(body, 'name', '客户名称');
  const sourceChannel = requireString(body, 'source_channel', '来源渠道');

  const dup = db.prepare('SELECT id, name FROM customers WHERE is_deleted = 0 AND name = ?').get(name);
  if (dup && !body.ignore_duplicate) {
    throw conflict(`客户「${name}」已存在，如确认不重复请传 ignore_duplicate=true`, CODE.DUPLICATE);
  }

  const cfMissing = customField.missingRequired('customer', body.custom_fields);
  if (cfMissing.length) throw badRequest(`缺少必填字段：${cfMissing.map((m) => m.field_name).join('、')}`);

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO customers (id, name, type, industry, scale, address, credit_code, level, status, owner_id,
      source_channel, is_in_sea, last_activity_at, remark, created_by, is_deleted, created_at, updated_at)
     VALUES (@id, @name, @type, @industry, @scale, @address, @credit_code, @level, 'active', @owner_id,
      @source_channel, 0, @t, @remark, @created_by, 0, @t, @t)`
  ).run({
    id, name,
    type: optional(body, 'type', '企业'),
    industry: optional(body, 'industry'),
    scale: optional(body, 'scale'),
    address: optional(body, 'address'),
    credit_code: optional(body, 'credit_code'),
    level: optional(body, 'level'),
    owner_id: optional(body, 'owner_id', req.user.id),
    source_channel: sourceChannel,
    remark: optional(body, 'remark'),
    created_by: req.user.id,
    t,
  });

  customField.setValues('customer', id, body.custom_fields, req.user.id, { partial: false });
  db.prepare(
    `INSERT INTO customer_history (id, customer_id, action, after_snapshot, changed_by, created_at)
     VALUES (?, ?, 'create', ?, ?, ?)`
  ).run(newId(), id, JSON.stringify({ name, source_channel: sourceChannel }), req.user.id, t);
  logOperation(req, { action: 'CREATE_CUSTOMER', targetType: 'Customer', targetId: id, detail: { name } });

  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  row.custom_fields = customField.readValues('customer', id);
  created(res, row);
});

/** 客户详情 */
router.get('/customers/:id', requirePermission('customer:view'), (req, res) => {
  const row = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!row) throw notFound('客户不存在或无权访问');
  row.custom_fields = customField.readValues('customer', row.id);
  row.owner_name = row.owner_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(row.owner_id) || {}).name : null;
  ok(res, row);
});

/** 编辑客户（M1-R2：记录修改历史） */
router.put('/customers/:id', requirePermission('customer:update'), (req, res) => {
  const before = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!before) throw notFound('客户不存在或无权访问');
  const body = bodyOf(req);

  const after = {};
  EDITABLE.forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length && !body.custom_fields) throw badRequest('没有可更新的字段');

  if (Object.keys(after).length) {
    const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE customers SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: before.id, t: now() });
  }
  if (body.custom_fields) customField.setValues('customer', before.id, body.custom_fields, req.user.id);

  const changed = diffFields(before, after, Object.keys(after));
  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(before.id);
  db.prepare(
    `INSERT INTO customer_history (id, customer_id, action, changed_fields, before_snapshot, after_snapshot, changed_by, created_at)
     VALUES (?, ?, 'update', ?, ?, ?, ?, ?)`
  ).run(
    newId(), before.id, JSON.stringify(changed), JSON.stringify(before), JSON.stringify(updated), req.user.id, now()
  );
  logOperation(req, { action: 'UPDATE_CUSTOMER', targetType: 'Customer', targetId: before.id, detail: changed });

  updated.custom_fields = customField.readValues('customer', before.id);
  ok(res, updated);
});

/** 删除客户（软删） */
router.delete('/customers/:id', requirePermission('customer:delete'), (req, res) => {
  const row = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!row) throw notFound('客户不存在或无权访问');
  const openOpp = db
    .prepare("SELECT COUNT(*) c FROM opportunities WHERE customer_id = ? AND is_deleted = 0 AND status = '进行中'")
    .get(row.id).c;
  if (openOpp > 0) throw conflict(`该客户下存在 ${openOpp} 个进行中的商机，无法删除`);
  db.prepare('UPDATE customers SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_CUSTOMER', targetType: 'Customer', targetId: row.id, detail: { name: row.name } });
  ok(res, { id: row.id, deleted: true });
});

/** 修改历史（M1-R2） */
router.get('/customers/:id/history', requirePermission('customer:view'), (req, res) => {
  const row = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!row) throw notFound('客户不存在或无权访问');
  const list = db
    .prepare(
      `SELECT h.*, u.name AS changed_by_name FROM customer_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.customer_id = ? ORDER BY h.created_at DESC`
    )
    .all(row.id);
  ok(res, list);
});

/** 客户 360 汇总（M1-R7） */
router.get('/customers/:id/360', requirePermission('customer:view'), (req, res) => {
  const row = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!row) throw notFound('客户不存在或无权访问');
  const oppScope = dataScope.scopeFragment(req.user, 'opportunity');
  const opportunities = db
    .prepare(
      `SELECT o.*, u.name AS owner_name FROM opportunities o
       LEFT JOIN users u ON u.id = o.owner_id
       WHERE o.customer_id = ? AND o.is_deleted = 0${oppScope.sql}
       ORDER BY o.created_at DESC`
    )
    .all(row.id, ...oppScope.params);

  // 行为记录：直接挂在客户上的 + 通过该客户名下商机关联的
  const activities = db
    .prepare(
      `SELECT a.* FROM activities a
       WHERE a.is_deleted = 0
         AND (a.customer_id = ? OR a.opportunity_id IN (SELECT id FROM opportunities WHERE customer_id = ?))
       ORDER BY a.activity_time DESC LIMIT 50`
    )
    .all(row.id, row.id);
  const proposals = db
    .prepare(
      `SELECT p.* FROM proposals p JOIN opportunities o ON o.id = p.opportunity_id
       WHERE o.customer_id = ? AND p.is_deleted = 0 ORDER BY p.created_at DESC`
    )
    .all(row.id);
  const quotations = db
    .prepare(
      `SELECT q.* FROM quotations q JOIN opportunities o ON o.id = q.opportunity_id
       WHERE o.customer_id = ? AND q.is_deleted = 0 ORDER BY q.created_at DESC`
    )
    .all(row.id);
  const contracts = db
    .prepare('SELECT * FROM contracts WHERE customer_id = ? AND is_deleted = 0 ORDER BY created_at DESC')
    .all(row.id);

  ok(res, {
    customer: { ...row, custom_fields: customField.readValues('customer', row.id) },
    contacts: db.prepare('SELECT * FROM contacts WHERE customer_id = ? AND is_deleted = 0 ORDER BY is_primary DESC, created_at').all(row.id),
    leads: db.prepare('SELECT * FROM leads WHERE customer_id = ? AND is_deleted = 0 ORDER BY created_at DESC').all(row.id),
    opportunities,
    activities,
    proposals,
    quotations,
    contracts,
    timeline: buildTimeline(row.id, { activities, proposals, quotations, contracts }),
    summary: {
      opportunity_count: opportunities.length,
      won_count: opportunities.filter((o) => o.status === '赢单').length,
      total_amount: opportunities.reduce((sum, o) => sum + (o.amount || 0), 0),
    },
  });
});

/** 客户转公海（M1-R6） */
router.post('/customers/:id/release-to-sea', requirePermission('customer:update'), (req, res) => {
  const row = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!row) throw notFound('客户不存在或无权访问');
  const reason = requireString(bodyOf(req), 'reason', '转公海原因');
  const record = seaService.moveToSea({ entityType: 'customer', entityId: row.id, reason, source: 'manual', user: req.user });
  db.prepare(
    `INSERT INTO customer_history (id, customer_id, action, after_snapshot, changed_by, created_at)
     VALUES (?, ?, 'release_to_sea', ?, ?, ?)`
  ).run(newId(), row.id, JSON.stringify({ reason }), req.user.id, now());
  ok(res, record);
});

// ---------------------------------------------------------------- 联系人
router.get('/customers/:id/contacts', requirePermission('contact:view'), (req, res) => {
  const customer = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!customer) throw notFound('客户不存在或无权访问');
  ok(res, db.prepare('SELECT * FROM contacts WHERE customer_id = ? AND is_deleted = 0 ORDER BY is_primary DESC, created_at').all(customer.id));
});

router.post('/customers/:id/contacts', requirePermission('contact:create'), (req, res) => {
  const customer = dataScope.findScoped('customer', 'customers', req.params.id, req.user);
  if (!customer) throw notFound('客户不存在或无权访问');
  const body = bodyOf(req);
  const name = requireString(body, 'name', '联系人姓名');
  const phone = requireString(body, 'phone', '联系电话');

  const id = newId();
  const t = now();
  const isPrimary = body.is_primary ? 1 : 0;
  if (isPrimary) db.prepare('UPDATE contacts SET is_primary = 0 WHERE customer_id = ?').run(customer.id);
  db.prepare(
    `INSERT INTO contacts (id, customer_id, name, title, phone, email, wechat, decision_role, relationship, is_primary,
      created_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id, customer.id, name, optional(body, 'title'), phone, optional(body, 'email'), optional(body, 'wechat'),
    optional(body, 'decision_role'), optional(body, 'relationship'), isPrimary, req.user.id, t, t
  );
  logOperation(req, { action: 'CREATE_CONTACT', targetType: 'Contact', targetId: id, detail: { customer_id: customer.id, name } });
  created(res, db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});

router.put('/contacts/:id', requirePermission('contact:update'), (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!contact) throw notFound('联系人不存在');
  const customer = dataScope.findScoped('customer', 'customers', contact.customer_id, req.user);
  if (!customer) throw notFound('联系人不存在或无权访问');

  const body = bodyOf(req);
  const fields = ['name', 'title', 'phone', 'email', 'wechat', 'decision_role', 'relationship'];
  const after = {};
  fields.forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');
  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE contacts SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: contact.id, t: now() });
  logOperation(req, { action: 'UPDATE_CONTACT', targetType: 'Contact', targetId: contact.id, detail: after });
  ok(res, db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id));
});

router.delete('/contacts/:id', requirePermission('contact:delete'), (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!contact) throw notFound('联系人不存在');
  const customer = dataScope.findScoped('customer', 'customers', contact.customer_id, req.user);
  if (!customer) throw notFound('联系人不存在或无权访问');
  db.prepare('UPDATE contacts SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), contact.id);
  logOperation(req, { action: 'DELETE_CONTACT', targetType: 'Contact', targetId: contact.id });
  ok(res, { id: contact.id, deleted: true });
});

router.post('/contacts/:id/set-primary', requirePermission('contact:update'), (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!contact) throw notFound('联系人不存在');
  const customer = dataScope.findScoped('customer', 'customers', contact.customer_id, req.user);
  if (!customer) throw notFound('联系人不存在或无权访问');
  db.prepare('UPDATE contacts SET is_primary = 0 WHERE customer_id = ?').run(contact.customer_id);
  db.prepare('UPDATE contacts SET is_primary = 1, updated_at = ? WHERE id = ?').run(now(), contact.id);
  logOperation(req, { action: 'SET_PRIMARY_CONTACT', targetType: 'Contact', targetId: contact.id });
  ok(res, db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id));
});

module.exports = router;
