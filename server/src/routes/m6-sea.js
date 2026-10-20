'use strict';

/**
 * M6 公海管理（P21）
 * 覆盖：公海池列表、领取、主管分配、自动分配、公海规则、公海记录详情
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, getPaging, paged, requireString, bodyOf } = require('../utils/http');
const { notFound, badRequest } = require('../utils/errors');
const { requirePermission } = require('../middleware/permission');
const configService = require('../services/configService');
const seaService = require('../services/seaService');

const TYPES = ['customer', 'opportunity', 'lead'];

// 注意：静态子路径必须定义在 /sea-pool/:type/:id 之前
/** 当前公海规则（M6-R6） */
router.get('/sea-pool/rules', requirePermission('sea:view'), (req, res) => {
  ok(res, configService.seaRules());
});

/** 公海池列表（M6-R1） */
router.get('/sea-pool', requirePermission('sea:view'), (req, res) => {
  const paging = getPaging(req);
  const entityType = req.query.type || null;
  if (entityType && !TYPES.includes(entityType)) throw badRequest('type 仅支持 customer、opportunity、lead');
  const result = seaService.list({
    entityType,
    keyword: req.query.keyword || null,
    page: paging.page,
    page_size: paging.page_size,
    limit: paging.limit,
    offset: paging.offset,
  });
  ok(res, paged(result.list, result.total, paging));
});

/** 触发自动分配算法（M6-R7，P2） */
router.post('/sea-pool/auto-assign/run', requirePermission('sea:manage'), (req, res) => {
  ok(res, seaService.autoAssign(req.user));
});

/** 公海记录详情 */
router.get('/sea-pool/:type/:id', requirePermission('sea:view'), (req, res) => {
  const { type, id } = req.params;
  if (!TYPES.includes(type)) throw badRequest('type 仅支持 customer、opportunity、lead');
  const meta = seaService.TYPES[type];

  const open = seaService.openSeaRecord(type, id);
  const record =
    open ||
    db.prepare('SELECT * FROM sea_pool_records WHERE entity_type = ? AND entity_id = ? ORDER BY entered_at DESC').get(type, id);
  if (!record) throw notFound('未找到该实体的公海记录');

  const entity = db.prepare(`SELECT * FROM ${meta.table} WHERE id = ? AND is_deleted = 0`).get(id);
  if (!entity) throw notFound(`${meta.label}不存在`);

  const history = db
    .prepare('SELECT * FROM sea_pool_records WHERE entity_type = ? AND entity_id = ? ORDER BY entered_at DESC')
    .all(type, id);
  const claimedByName = record.claimed_by
    ? (db.prepare('SELECT name FROM users WHERE id = ?').get(record.claimed_by) || {}).name
    : null;
  const previousOwnerName = record.previous_owner
    ? (db.prepare('SELECT name FROM users WHERE id = ?').get(record.previous_owner) || {}).name
    : null;
  const customerName = entity.customer_id
    ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(entity.customer_id) || {}).name
    : null;

  ok(res, {
    record,
    entity: {
      id: entity.id,
      name: entity[meta.nameCol],
      owner_id: entity[meta.ownerCol],
      status: entity.status,
      is_in_sea: entity.is_in_sea,
      contact_name: entity.contact_name || null,
      contact_phone: entity.contact_phone || null,
      wechat: entity.wechat || null,
      source_channel: entity.source_channel || null,
      customer_id: entity.customer_id || null,
      customer_name: customerName,
      created_at: entity.created_at || null,
    },
    owner_history: history.map((h) => ({
      id: h.id,
      source: h.source,
      reason: h.reason,
      status: h.status,
      claimed_by: h.claimed_by,
      claimed_at: h.claimed_at,
      entered_at: h.entered_at,
      protect_until: h.protect_until,
    })),
    entered_at: record.entered_at,
    protect_until: record.protect_until,
    claimed_by_name: claimedByName,
    previous_owner_name: previousOwnerName,
  });
});

/** 领取（M6-R2） */
router.post('/sea-pool/:type/:id/pickup', requirePermission('sea:pickup'), (req, res) => {
  ok(res, seaService.pickup(req.params.type, req.params.id, req.user));
});

/** 主管分配（M6-R3） */
router.post('/sea-pool/:type/:id/assign', requirePermission('sea:assign'), (req, res) => {
  const ownerId = requireString(bodyOf(req), 'owner_id', '负责人');
  ok(res, seaService.assign(req.params.type, req.params.id, ownerId, req.user));
});

module.exports = router;
