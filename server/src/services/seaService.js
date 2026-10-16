'use strict';

/** 公海机制（M6 / PRD 第 5.5 章，K 系列已定案） */
const { db } = require('../db');
const { newId, now } = require('../utils/ids');
const { CODE, badRequest, notFound, forbidden, conflict } = require('../utils/errors');
const configService = require('./configService');
const { logOperation } = require('./operationLog');

const TYPES = {
  customer: { table: 'customers', nameCol: 'name', ownerCol: 'owner_id', label: '客户', onSea: { status: 'sea' }, onPickup: { status: 'active' } },
  opportunity: { table: 'opportunities', nameCol: 'name', ownerCol: 'owner_id', label: '商机', onSea: { status: '公海' }, onPickup: { status: '进行中' } },
  lead: { table: 'leads', nameCol: 'name', ownerCol: 'owner_id', label: '线索', onSea: { status: 'recycled' }, onPickup: { status: 'following' } },
};

function meta(entityType) {
  const m = TYPES[entityType];
  if (!m) throw badRequest(`不支持的公海实体类型：${entityType}`);
  return m;
}

function loadEntity(entityType, entityId) {
  const m = meta(entityType);
  const row = db.prepare(`SELECT * FROM ${m.table} WHERE id = ? AND is_deleted = 0`).get(entityId);
  if (!row) throw notFound(`${m.label}不存在`);
  return row;
}

/** 当前在公海中的记录 */
function openSeaRecord(entityType, entityId) {
  return db
    .prepare("SELECT * FROM sea_pool_records WHERE entity_type = ? AND entity_id = ? AND status = 'in_sea' ORDER BY entered_at DESC")
    .get(entityType, entityId) || null;
}

/** 转入公海（手工释放 / 三级预警自动回落 / 线索超期回收） */
function moveToSea({ entityType, entityId, reason = null, source = 'manual', user = null }) {
  const m = meta(entityType);
  const row = loadEntity(entityType, entityId);
  if (row.is_in_sea === 1) throw conflict(`${m.label}已在公海池中`);

  const t = now();
  const previousOwner = row[m.ownerCol];
  db.prepare(`UPDATE ${m.table} SET is_in_sea = 1, ${m.ownerCol} = NULL, updated_at = ? WHERE id = ?`).run(t, entityId);
  Object.entries(m.onSea).forEach(([col, val]) => {
    db.prepare(`UPDATE ${m.table} SET ${col} = ? WHERE id = ?`).run(val, entityId);
  });
  if (entityType === 'opportunity') {
    db.prepare('UPDATE stale_alerts SET is_resolved = 1, resolved_at = ? WHERE opportunity_id = ? AND is_resolved = 0').run(t, entityId);
  }

  const recordId = newId();
  db.prepare(
    `INSERT INTO sea_pool_records (id, entity_type, entity_id, entity_name, customer_id, reason, source, entered_at, is_claimed, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'in_sea', ?, ?, ?)`
  ).run(
    recordId, entityType, entityId, row[m.nameCol], entityType === 'opportunity' ? row.customer_id : row.id,
    reason, source, t, user ? user.id : null, t, t
  );

  logOperation({ user }, {
    action: 'MOVE_TO_SEA',
    targetType: entityType,
    targetId: entityId,
    detail: { entity_type: entityType, previous_owner: previousOwner, reason, source },
  });
  return db.prepare('SELECT * FROM sea_pool_records WHERE id = ?').get(recordId);
}

/** 领取（M6-R2 / M6-R4：保护期、个人上限、每日上限） */
function pickup(entityType, entityId, user) {
  const m = meta(entityType);
  const rules = configService.seaRules();
  if (!rules.is_pickup_mode) throw forbidden('当前未开启公海自主领取模式，请联系主管分配');
  loadEntity(entityType, entityId);
  const record = openSeaRecord(entityType, entityId);
  if (!record) throw conflict('该记录不在公海池中，无法领取');

  if (record.protect_until && new Date(record.protect_until) > new Date() && record.claimed_by && record.claimed_by !== user.id) {
    throw conflict(`该数据处于保护期内，保护期至 ${record.protect_until}`, CODE.IN_PROTECTION);
  }

  if (entityType === 'opportunity') {
    const owned = db
      .prepare("SELECT COUNT(*) c FROM opportunities WHERE owner_id = ? AND is_deleted = 0 AND is_in_sea = 0 AND status = '进行中'")
      .get(user.id).c;
    if (owned >= rules.personal_max) {
      throw conflict(`个人商机已达上限（${rules.personal_max}），无法继续领取`, CODE.SEA_LIMIT);
    }
  }

  const today = now().slice(0, 10);
  const picked = db
    .prepare("SELECT COUNT(*) c FROM sea_pool_records WHERE claimed_by = ? AND claimed_at LIKE ?")
    .get(user.id, `${today}%`).c;
  if (picked >= rules.daily_pickup_max) {
    throw conflict(`今日领取已达上限（${rules.daily_pickup_max}），请明日再试`, CODE.SEA_LIMIT);
  }

  const t = now();
  const protectUntil = new Date(Date.now() + rules.protection_days * 86400000).toISOString();
  db.prepare(
    `UPDATE sea_pool_records SET claimed_by = ?, claimed_at = ?, protect_until = ?, is_claimed = 1, status = 'claimed', updated_at = ?
     WHERE id = ?`
  ).run(user.id, t, protectUntil, t, record.id);

  db.prepare(`UPDATE ${m.table} SET is_in_sea = 0, ${m.ownerCol} = ?, updated_at = ? WHERE id = ?`).run(user.id, t, entityId);
  Object.entries(m.onPickup).forEach(([col, val]) => {
    db.prepare(`UPDATE ${m.table} SET ${col} = ? WHERE id = ?`).run(val, entityId);
  });
  if (hasColumn(m.table, 'last_activity_at')) {
    db.prepare(`UPDATE ${m.table} SET last_activity_at = ? WHERE id = ?`).run(t, entityId);
  }

  logOperation({ user }, { action: 'PICKUP_FROM_SEA', targetType: entityType, targetId: entityId, detail: { record_id: record.id, protect_until: protectUntil } });
  return { record: db.prepare('SELECT * FROM sea_pool_records WHERE id = ?').get(record.id), entity: loadEntity(entityType, entityId) };
}

let columnCache = null;
function hasColumn(table, col) {
  if (!columnCache) columnCache = {};
  if (columnCache[table]) return columnCache[table].includes(col);
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  columnCache[table] = cols;
  return cols.includes(col);
}

/** 主管分配（M6-R3） */
function assign(entityType, entityId, ownerId, user) {
  const m = meta(entityType);
  if (!ownerId) throw badRequest('owner_id 为必填项');
  const owner = db.prepare('SELECT * FROM users WHERE id = ? AND is_deleted = 0').get(ownerId);
  if (!owner) throw notFound('目标负责人不存在');
  loadEntity(entityType, entityId);

  const t = now();
  db.prepare(`UPDATE ${m.table} SET is_in_sea = 0, ${m.ownerCol} = ?, updated_at = ? WHERE id = ?`).run(ownerId, t, entityId);
  Object.entries(m.onPickup).forEach(([col, val]) => {
    db.prepare(`UPDATE ${m.table} SET ${col} = ? WHERE id = ?`).run(val, entityId);
  });

  const record = openSeaRecord(entityType, entityId);
  if (record) {
    db.prepare(
      "UPDATE sea_pool_records SET claimed_by = ?, claimed_at = ?, is_claimed = 1, status = 'assigned', updated_at = ? WHERE id = ?"
    ).run(ownerId, t, t, record.id);
  } else {
    const row = loadEntity(entityType, entityId);
    db.prepare(
      `INSERT INTO sea_pool_records (id, entity_type, entity_id, entity_name, customer_id, reason, source, entered_at, claimed_by, claimed_at, is_claimed, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '主管分配', 'assigned', ?, ?, ?, 1, 'assigned', ?, ?, ?)`
    ).run(
      newId(), entityType, entityId, row[m.nameCol],
      entityType === 'opportunity' ? row.customer_id : row.id,
      t, ownerId, t, user ? user.id : null, t, t
    );
  }

  logOperation({ user }, { action: 'ASSIGN_FROM_SEA', targetType: entityType, targetId: entityId, detail: { owner_id: ownerId } });
  return { entity: loadEntity(entityType, entityId), record_id: record ? record.id : null };
}

/** 公海池列表（M6-R1） */
function list({ entityType = null, keyword = null, page, page_size, limit, offset }) {
  const conditions = ["r.status = 'in_sea'"];
  const params = [];
  if (entityType) {
    conditions.push('r.entity_type = ?');
    params.push(entityType);
  }
  if (keyword) {
    conditions.push('r.entity_name LIKE ?');
    params.push(`%${keyword}%`);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM sea_pool_records r WHERE ${where}`).get(...params).c;
  const list = db
    .prepare(
      `SELECT r.*, u.name AS claimed_by_name FROM sea_pool_records r
       LEFT JOIN users u ON u.id = r.claimed_by
       WHERE ${where} ORDER BY r.entered_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return { list, total, page, page_size };
}

/** 自动分配算法（M6-R7，P2）：按在途商机数升序分配给销售 */
function autoAssign(user) {
  const rules = configService.seaRules();
  const salesRole = db.prepare("SELECT id FROM roles WHERE role_code = 'sales'").get();
  if (!salesRole) return { assigned: 0, detail: [] };
  const sales = db
    .prepare("SELECT id, name FROM users WHERE role_id = ? AND status = 'enabled' AND is_deleted = 0")
    .all(salesRole.id)
    .map((u) => ({
      ...u,
      load: db
        .prepare("SELECT COUNT(*) c FROM opportunities WHERE owner_id = ? AND is_deleted = 0 AND is_in_sea = 0 AND status = '进行中'")
        .get(u.id).c,
    }))
    .sort((a, b) => a.load - b.load);

  const inSea = db.prepare("SELECT * FROM sea_pool_records WHERE status = 'in_sea' ORDER BY entered_at").all();
  const detail = [];
  inSea.forEach((r) => {
    const target = sales.find((s) => s.load < rules.personal_max);
    if (!target) return;
    assign(r.entity_type, r.entity_id, target.id, user);
    target.load += 1;
    detail.push({ record_id: r.id, entity_id: r.entity_id, owner_id: target.id, owner_name: target.name });
  });
  return { assigned: detail.length, detail };
}

module.exports = { TYPES, moveToSea, pickup, assign, list, autoAssign, openSeaRecord, hasColumn };
