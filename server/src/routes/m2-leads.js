'use strict';

/**
 * M2 线索管理（P08/P09/P10）
 * 覆盖：线索 CRUD、查重、分配给销售、转商机、回收至公海
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
const { logOperation } = require('../services/operationLog');
const seaService = require('../services/seaService');
const stageEngine = require('../services/stageEngine');

const SORTABLE = ['created_at', 'updated_at', 'name'];
const EDITABLE = ['name', 'customer_name', 'customer_id', 'contact_name', 'contact_phone', 'wechat', 'source_channel', 'owner_id', 'remark', 'status'];

/** 线索列表（M2-R2：数据权限 + 关键字 + 自定义字段筛选） */
router.get('/leads', requirePermission('lead:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];

  const scope = dataScope.scopeFragment(req.user, 'lead');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  if (req.query.keyword) {
    conditions.push('(t.name LIKE ? OR t.customer_name LIKE ? OR t.contact_name LIKE ? OR t.contact_phone LIKE ? OR t.wechat LIKE ?)');
    const kw = `%${req.query.keyword}%`;
    params.push(kw, kw, kw, kw, kw);
  }
  ['status', 'source_channel', 'owner_id'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.start_date) {
    conditions.push('t.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.created_at <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }
  customField.buildFilter('lead', req.query, conditions, params);

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM leads t WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, SORTABLE);
  const list = db
    .prepare(
      `SELECT t.*, u.name AS owner_name, c.name AS linked_customer_name FROM leads t
       LEFT JOIN users u ON u.id = t.owner_id
       LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);

  customField.attach('lead', list);
  ok(res, paged(list, total, paging));
});

/** 线索录入（M2-R1） */
router.post('/leads', requirePermission('lead:create'), (req, res) => {
  const body = bodyOf(req);
  const name = requireString(body, 'name', '线索名称');
  const sourceChannel = requireString(body, 'source_channel', '来源渠道');
  // 线索必须可触达：联系人必填，联系电话与微信号至少一项
  const contactName = requireString(body, 'contact_name', '联系人');
  const contactPhone = optional(body, 'contact_phone');
  const wechat = optional(body, 'wechat');
  if (!String(contactPhone || '').trim() && !String(wechat || '').trim()) {
    throw badRequest('联系电话与微信号至少填写一项');
  }

  let customerId = null;
  if (body.customer_id !== undefined && body.customer_id !== null && body.customer_id !== '') {
    const customer = dataScope.findScoped('customer', 'customers', body.customer_id, req.user);
    if (!customer) throw notFound('关联客户不存在或无权访问');
    customerId = customer.id;
  }

  const dup = db
    .prepare('SELECT id, name FROM leads WHERE is_deleted = 0 AND name = ? AND contact_phone IS ?')
    .get(name, contactPhone);
  if (dup && !body.ignore_duplicate) {
    throw conflict('线索已存在，如确认不重复请传 ignore_duplicate=true', CODE.DUPLICATE);
  }

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO leads (id, name, customer_name, customer_id, contact_name, contact_phone, wechat, source_channel, status, owner_id,
      is_in_sea, remark, created_by, is_deleted, created_at, updated_at)
     VALUES (@id, @name, @customer_name, @customer_id, @contact_name, @contact_phone, @wechat, @source_channel, 'new', @owner_id,
      0, @remark, @created_by, 0, @t, @t)`
  ).run({
    id,
    name,
    customer_name: optional(body, 'customer_name'),
    customer_id: customerId,
    contact_name: contactName,
    contact_phone: contactPhone,
    wechat,
    source_channel: sourceChannel,
    owner_id: optional(body, 'owner_id', req.user.id),
    remark: optional(body, 'remark'),
    created_by: req.user.id,
    t,
  });
  customField.setValues('lead', id, body.custom_fields, req.user.id);
  logOperation(req, { action: 'CREATE_LEAD', targetType: 'Lead', targetId: id, detail: { name, source_channel: sourceChannel } });

  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  row.custom_fields = customField.readValues('lead', id);
  created(res, row);
});

/** 线索详情 */
router.get('/leads/:id', requirePermission('lead:view'), (req, res) => {
  const row = dataScope.findScoped('lead', 'leads', req.params.id, req.user);
  if (!row) throw notFound('线索不存在或无权访问');
  row.custom_fields = customField.readValues('lead', row.id);
  row.owner_name = row.owner_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(row.owner_id) || {}).name : null;
  row.linked_customer_name = row.customer_id ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(row.customer_id) || {}).name : null;
  ok(res, row);
});

/** 编辑线索 */
router.put('/leads/:id', requirePermission('lead:update'), (req, res) => {
  const before = dataScope.findScoped('lead', 'leads', req.params.id, req.user);
  if (!before) throw notFound('线索不存在或无权访问');
  const body = bodyOf(req);

  const after = {};
  EDITABLE.forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length && !body.custom_fields) throw badRequest('没有可更新的字段');

  // 触及联系信息时，保证线索仍然可触达（联系人必填，电话/微信至少一项）
  const touchesContact = ['contact_name', 'contact_phone', 'wechat'].some((f) => body[f] !== undefined);
  if (touchesContact) {
    const next = {
      contact_name: after.contact_name !== undefined ? after.contact_name : before.contact_name,
      contact_phone: after.contact_phone !== undefined ? after.contact_phone : before.contact_phone,
      wechat: after.wechat !== undefined ? after.wechat : before.wechat,
    };
    if (!String(next.contact_name || '').trim()) throw badRequest('联系人为必填项');
    if (!String(next.contact_phone || '').trim() && !String(next.wechat || '').trim()) {
      throw badRequest('联系电话与微信号至少填写一项');
    }
  }

  if (Object.keys(after).length) {
    const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE leads SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: before.id, t: now() });
  }
  if (body.custom_fields) customField.setValues('lead', before.id, body.custom_fields, req.user.id);

  logOperation(req, { action: 'UPDATE_LEAD', targetType: 'Lead', targetId: before.id, detail: after });
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(before.id);
  updated.custom_fields = customField.readValues('lead', before.id);
  ok(res, updated);
});

/** 删除线索（软删；已转商机不可删） */
router.delete('/leads/:id', requirePermission('lead:delete'), (req, res) => {
  const row = dataScope.findScoped('lead', 'leads', req.params.id, req.user);
  if (!row) throw notFound('线索不存在或无权访问');
  if (row.opportunity_id) throw conflict('线索已转商机，不可删除');
  db.prepare('UPDATE leads SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_LEAD', targetType: 'Lead', targetId: row.id, detail: { name: row.name } });
  ok(res, { id: row.id, deleted: true });
});

/** 分配给销售（M2-R3） */
router.post('/leads/:id/assign', requirePermission('lead:assign'), (req, res) => {
  const lead = dataScope.findScoped('lead', 'leads', req.params.id, req.user);
  if (!lead) throw notFound('线索不存在或无权访问');
  const ownerId = requireString(bodyOf(req), 'owner_id', '负责人');
  const owner = db.prepare('SELECT id FROM users WHERE id = ? AND is_deleted = 0').get(ownerId);
  if (!owner) throw notFound('目标负责人不存在');

  const status = lead.status === 'new' ? 'following' : lead.status;
  db.prepare('UPDATE leads SET owner_id = ?, status = ?, updated_at = ? WHERE id = ?').run(ownerId, status, now(), lead.id);
  logOperation(req, { action: 'ASSIGN_LEAD', targetType: 'Lead', targetId: lead.id, detail: { owner_id: ownerId } });
  ok(res, db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id));
});

/** 线索转客户（M2-R4 扩展）：以线索信息建档，联系人一并写入客户主联系人 */
router.post('/leads/:id/convert-to-customer', requirePermission('customer:create'), (req, res) => {
  const lead = dataScope.findScoped('lead', 'leads', req.params.id, req.user);
  if (!lead) throw notFound('线索不存在或无权访问');
  if (lead.customer_id) throw conflict('该线索已关联客户，请勿重复操作');
  const body = bodyOf(req);

  const name = String(optional(body, 'customer_name') || lead.customer_name || '').trim();
  if (!name) throw badRequest('线索未填写客户名称，请填写客户名称后再转客户');
  const sourceChannel = optional(body, 'source_channel') || lead.source_channel;
  if (!String(sourceChannel || '').trim()) throw badRequest('来源渠道不能为空');

  const dup = db.prepare('SELECT id, name FROM customers WHERE is_deleted = 0 AND name = ?').get(name);
  if (dup && !body.ignore_duplicate) {
    throw conflict(`客户「${name}」已存在，如确认不重复请传 ignore_duplicate=true`, CODE.DUPLICATE);
  }

  const customerId = newId();
  const t = now();
  const ownerId = body.owner_id || lead.owner_id || req.user.id;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO customers (id, name, type, status, owner_id, source_channel, is_in_sea, last_activity_at,
        remark, created_by, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, 0, ?, ?, ?, 0, ?, ?)`
    ).run(
      customerId, name, optional(body, 'type', '企业'), ownerId, sourceChannel, t,
      optional(body, 'remark') || lead.remark || null, req.user.id, t, t
    );

    db.prepare(
      `INSERT INTO customer_history (id, customer_id, action, after_snapshot, changed_by, created_at)
       VALUES (?, ?, 'create', ?, ?, ?)`
    ).run(newId(), customerId, JSON.stringify({ name, source_channel: sourceChannel, from_lead: lead.id }), req.user.id, t);

    if (lead.contact_name) {
      db.prepare(
        `INSERT INTO contacts (id, customer_id, name, phone, wechat, is_primary, created_by, is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`
      ).run(newId(), customerId, lead.contact_name, lead.contact_phone || null, lead.wechat || null, req.user.id, t, t);
    }

    db.prepare(
      `UPDATE leads SET customer_id = ?,
        status = CASE WHEN status = 'new' THEN 'following' ELSE status END,
        updated_at = ? WHERE id = ?`
    ).run(customerId, t, lead.id);
  });
  tx();

  logOperation(req, {
    action: 'CONVERT_LEAD_TO_CUSTOMER',
    targetType: 'Lead',
    targetId: lead.id,
    detail: { customer_id: customerId, name },
  });
  created(res, { lead_id: lead.id, customer_id: customerId, customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) });
});

/** 线索转商机（M2-R4） */
router.post('/leads/:id/convert', requirePermission('lead:convert'), (req, res) => {
  const lead = dataScope.findScoped('lead', 'leads', req.params.id, req.user);
  if (!lead) throw notFound('线索不存在或无权访问');
  if (lead.opportunity_id) throw conflict('该线索已转商机，请勿重复操作');
  const body = bodyOf(req);

  const customerId = body.customer_id || lead.customer_id;
  if (!customerId) throw badRequest('线索未关联客户，请传入 customer_id');
  const customer = dataScope.findScoped('customer', 'customers', customerId, req.user);
  if (!customer) throw notFound('关联客户不存在或无权访问');

  const stage = body.stage_config_id ? stageEngine.getById(body.stage_config_id) : stageEngine.firstStage();
  if (!stage) throw notFound('漏斗起点阶段未初始化');
  if (stage.is_enabled !== 1) throw badRequest(`阶段「${stage.name}」已停用，不可使用`);

  const amount = body.amount === undefined || body.amount === null || body.amount === '' ? 0 : Number(body.amount);
  if (Number.isNaN(amount)) throw badRequest('amount 必须为数字');

  const oppId = newId();
  const t = now();
  const oppName = body.opportunity_name ? String(body.opportunity_name).trim() : `${lead.customer_name || lead.name} 商机`;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO opportunities (id, name, customer_id, stage_config_id, stage_name_snapshot, amount, owner_id, status,
        stage_changed_at, last_activity_at, is_in_sea, remark, created_by, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '进行中', ?, ?, 0, ?, ?, 0, ?, ?)`
    ).run(
      oppId, oppName, customerId, stage.id, stage.name, amount, lead.owner_id || req.user.id,
      t, t, lead.remark || null, req.user.id, t, t
    );

    db.prepare(
      `INSERT INTO stage_history (id, opportunity_id, from_stage, from_stage_name, to_stage, to_stage_name,
        action_type, reason, config_version, changed_by, created_at)
       VALUES (?, ?, NULL, NULL, ?, ?, 'create', ?, ?, ?, ?)`
    ).run(newId(), oppId, stage.id, stage.name, '线索转商机', stage.version || 1, req.user.id, t);

    db.prepare("UPDATE leads SET status = 'converted', converted_at = ?, opportunity_id = ?, updated_at = ? WHERE id = ?")
      .run(t, oppId, t, lead.id);
  });
  tx();

  logOperation(req, { action: 'CONVERT_LEAD', targetType: 'Lead', targetId: lead.id, detail: { opportunity_id: oppId, name: oppName } });
  created(res, { lead_id: lead.id, opportunity_id: oppId });
});

/** 回收至公海（M2-R5） */
router.post('/leads/:id/recycle', requirePermission('lead:recycle'), (req, res) => {
  const row = dataScope.findScoped('lead', 'leads', req.params.id, req.user);
  if (!row) throw notFound('线索不存在或无权访问');
  const reason = requireString(bodyOf(req), 'reason', '回收原因');
  const record = seaService.moveToSea({ entityType: 'lead', entityId: row.id, reason, source: 'manual', user: req.user });
  ok(res, record);
});

module.exports = router;
