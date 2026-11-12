'use strict';

/** 公海机制（M6 / PRD 第 5.5 章，K 系列已定案） */
const { db } = require('../db');
const { newId, now } = require('../utils/ids');
const { CODE, badRequest, notFound, forbidden, conflict } = require('../utils/errors');
const configService = require('./configService');
const notification = require('./notification');
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

/** 客户打包转公海时，随客户一起入海的子商机记录 */
function openChildRecords(parentRecordId) {
  return db
    .prepare("SELECT * FROM sea_pool_records WHERE parent_record_id = ? AND status = 'in_sea' ORDER BY entered_at")
    .all(parentRecordId);
}

/** 客户公海详情：随迁商机的业务信息（供主管分配前判断带走什么） */
function childOpportunities(parentRecordId) {
  return db
    .prepare(
      `SELECT r.id, r.entity_id, r.entity_name, r.entered_at, r.protect_until, r.status,
              o.amount, o.stage_name_snapshot, o.status AS opportunity_status
       FROM sea_pool_records r
       LEFT JOIN opportunities o ON o.id = r.entity_id AND o.is_deleted = 0
       WHERE r.parent_record_id = ? AND r.status = 'in_sea' ORDER BY r.entered_at`
    )
    .all(parentRecordId);
}

/**
 * 商机流转的前置约束：客户与商机同时在公海时，必须先领客户。
 * 覆盖两种情况：①商机随客户打包入海（parent_record_id 非空）；②商机先单独入海、客户后入海。
 */
function assertOpportunityCustomerHandled(entityType, entity, record) {
  if (entityType !== 'opportunity') return;
  if (record && record.parent_record_id) {
    throw conflict('该商机随客户一起在公海池中，请先在客户公海领取或分配客户');
  }
  if (!entity.customer_id) return;
  const customer = db
    .prepare('SELECT id, name, is_in_sea FROM customers WHERE id = ? AND is_deleted = 0')
    .get(entity.customer_id);
  if (customer && customer.is_in_sea === 1) {
    throw conflict(`客户「${customer.name}」也在公海池中，请先领取或分配客户，商机会随客户一起带出`);
  }
}

function protectUntil(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() + n * 86400000).toISOString();
}

/** 转入公海（手工释放 / 三级预警自动回落 / 线索超期回收 / 客户长期无商机活动回收） */
function _moveToSea({ entityType, entityId, reason = null, source = 'manual', user = null, parentRecordId = null }) {
  const m = meta(entityType);
  const row = loadEntity(entityType, entityId);
  if (row.is_in_sea === 1) throw conflict(`${m.label}已在公海池中`);

  const rules = configService.seaRules();
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
    `INSERT INTO sea_pool_records (id, entity_type, entity_id, entity_name, customer_id, reason, source, previous_owner,
      parent_record_id, entered_at, protect_until, is_claimed, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'in_sea', ?, ?, ?)`
  ).run(
    recordId, entityType, entityId, row[m.nameCol], row.customer_id || (entityType === 'customer' ? row.id : null),
    reason, source, previousOwner, parentRecordId, t, protectUntil(rules.protection_days),
    user ? user.id : null, t, t
  );

  logOperation({ user }, {
    action: 'MOVE_TO_SEA',
    targetType: entityType,
    targetId: entityId,
    detail: { entity_type: entityType, previous_owner: previousOwner, reason, source },
  });

  // 非负责人手工转入公海时，告知原负责人去哪里查看
  if (user && previousOwner && user.id !== previousOwner) {
    notification.push(previousOwner, {
      category: 'sea',
      title: `${m.label}「${row[m.nameCol]}」已转入公海`,
      content: reason || '可在公海池查看申请领回',
      refType: entityType,
      refId: entityId,
      link: `/sea/${entityType}?previous_owner=me`,
      dedupKey: `sea:${recordId}:${previousOwner}`,
    });
  }
  return db.prepare('SELECT * FROM sea_pool_records WHERE id = ?').get(recordId);
}

function moveToSea(opts) {
  return db.transaction(() => _moveToSea(opts))();
}

/**
 * 客户转公海：客户与其名下「进行中」商机绑定，一起转入公海。
 * 赢单/失败商机保留在原负责人名下作为历史，不随客户流转。
 */
function releaseCustomerToSea({ customerId, reason = null, source = 'manual', user = null }) {
  return db.transaction(() => {
    const customerRecord = _moveToSea({ entityType: 'customer', entityId: customerId, reason, source, user });
    const children = db
      .prepare("SELECT id FROM opportunities WHERE customer_id = ? AND is_deleted = 0 AND is_in_sea = 0 AND status = '进行中'")
      .all(customerId);
    children.forEach((o) => {
      _moveToSea({
        entityType: 'opportunity',
        entityId: o.id,
        reason,
        source,
        user,
        parentRecordId: customerRecord.id,
      });
    });
    return { record: customerRecord, opportunities: children.length };
  })();
}

function markRecord(recordId, userId, channel, status) {
  const t = now();
  db.prepare(
    `UPDATE sea_pool_records SET claimed_by = ?, claimed_at = ?, claim_channel = ?, is_claimed = 1, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(userId, t, channel, status, t, recordId);
  return t;
}

function applyToOwner(entityType, entityId, ownerId, t, resetActivity = true) {
  const m = meta(entityType);
  db.prepare(`UPDATE ${m.table} SET is_in_sea = 0, ${m.ownerCol} = ?, updated_at = ? WHERE id = ?`).run(ownerId, t, entityId);
  Object.entries(m.onPickup).forEach(([col, val]) => {
    db.prepare(`UPDATE ${m.table} SET ${col} = ? WHERE id = ?`).run(val, entityId);
  });
  if (resetActivity && hasColumn(m.table, 'last_activity_at')) {
    db.prepare(`UPDATE ${m.table} SET last_activity_at = ? WHERE id = ?`).run(t, entityId);
  }
}

function countOwnedOpportunities(userId) {
  return db
    .prepare("SELECT COUNT(*) c FROM opportunities WHERE owner_id = ? AND is_deleted = 0 AND is_in_sea = 0 AND status = '进行中'")
    .get(userId).c;
}

/** 今日自主领取次数（主管分配不计入） */
function countSelfPickupsToday(userId) {
  const today = now().slice(0, 10);
  return db
    .prepare("SELECT COUNT(*) c FROM sea_pool_records WHERE claimed_by = ? AND claim_channel = 'self' AND claimed_at LIKE ?")
    .get(userId, `${today}%`).c;
}

/** 领取（M6-R2 / M6-R4：保护期、个人上限、每日上限） */
function pickup(entityType, entityId, user) {
  return db.transaction(() => {
    const m = meta(entityType);
    const rules = configService.seaRules();
    if (!rules.is_pickup_mode) throw forbidden('当前未开启公海自主领取模式，请联系主管分配');
    const entity = loadEntity(entityType, entityId);
    const record = openSeaRecord(entityType, entityId);
    if (!record) throw conflict('该记录不在公海池中，无法领取');
    assertOpportunityCustomerHandled(entityType, entity, record);

    // 保护期：入海后 N 天内任何销售都不能自主领取，只能由主管分配；系统管理员保留最高权限
    const isSystemAdmin = user.isAdmin === true || user.role_code === 'system_admin';
    if (!isSystemAdmin && record.protect_until && new Date(record.protect_until) > new Date()) {
      throw conflict(`该数据处于保护期内（至 ${record.protect_until.slice(0, 10)}），仅支持主管分配`, CODE.IN_PROTECTION);
    }

    // 客户领取时，其下随迁商机一并计入个人商机上限
    const children = entityType === 'customer' ? openChildRecords(record.id) : [];
    if (entityType === 'opportunity' || entityType === 'customer') {
      const need = entityType === 'customer' ? children.length : 1;
      const owned = countOwnedOpportunities(user.id);
      if (owned + need > rules.personal_max) {
        throw conflict(`个人商机已达上限（${rules.personal_max}），无法继续领取`, CODE.SEA_LIMIT);
      }
    }

    if (countSelfPickupsToday(user.id) >= rules.daily_pickup_max) {
      throw conflict(`今日领取已达上限（${rules.daily_pickup_max}），请明日再试`, CODE.SEA_LIMIT);
    }

    const t = markRecord(record.id, user.id, 'self', 'claimed');
    applyToOwner(entityType, entityId, user.id, t);
    children.forEach((c) => {
      markRecord(c.id, user.id, null, 'claimed');
      applyToOwner('opportunity', c.entity_id, user.id, t);
    });

    logOperation({ user }, {
      action: 'PICKUP_FROM_SEA',
      targetType: entityType,
      targetId: entityId,
      detail: { record_id: record.id, bundled_opportunities: children.length },
    });
    return {
      record: db.prepare('SELECT * FROM sea_pool_records WHERE id = ?').get(record.id),
      entity: loadEntity(entityType, entityId),
      bundled_opportunities: children.length,
    };
  })();
}

let columnCache = null;
function hasColumn(table, col) {
  if (!columnCache) columnCache = {};
  if (columnCache[table]) return columnCache[table].includes(col);
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  columnCache[table] = cols;
  return cols.includes(col);
}

/** 主管分配（M6-R3）：不受保护期、个人上限、每日领取额度限制 */
function assign(entityType, entityId, ownerId, user) {
  return db.transaction(() => {
    const m = meta(entityType);
    if (!ownerId) throw badRequest('owner_id 为必填项');
    const owner = db.prepare("SELECT * FROM users WHERE id = ? AND is_deleted = 0 AND status = 'enabled'").get(ownerId);
    if (!owner) throw notFound('目标负责人不存在或已停用');
    const row = loadEntity(entityType, entityId);
    if (row.is_in_sea !== 1) throw conflict(`${m.label}不在公海池中，无法分配`);

    const record = openSeaRecord(entityType, entityId);
    assertOpportunityCustomerHandled(entityType, row, record);
    const t = record ? markRecord(record.id, ownerId, 'assign', 'assigned') : now();
    if (!record) {
      db.prepare(
        `INSERT INTO sea_pool_records (id, entity_type, entity_id, entity_name, customer_id, reason, source, entered_at, claimed_by, claimed_at, claim_channel, is_claimed, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '主管分配', 'assigned', ?, ?, ?, 'assign', 1, 'assigned', ?, ?, ?)`
      ).run(
        newId(), entityType, entityId, row[m.nameCol], row.customer_id || (entityType === 'customer' ? row.id : null),
        t, ownerId, t, user ? user.id : null, t, t
      );
    }
    applyToOwner(entityType, entityId, ownerId, t, false);

    const children = entityType === 'customer' && record ? openChildRecords(record.id) : [];
    children.forEach((c) => {
      markRecord(c.id, ownerId, null, 'assigned');
      applyToOwner('opportunity', c.entity_id, ownerId, t, false);
    });

    logOperation({ user }, {
      action: 'ASSIGN_FROM_SEA',
      targetType: entityType,
      targetId: entityId,
      detail: { owner_id: ownerId, bundled_opportunities: children.length },
    });
    return { entity: loadEntity(entityType, entityId), record_id: record ? record.id : null, bundled_opportunities: children.length };
  })();
}

/** 公海池列表（M6-R1） */
function list({
  entityType = null,
  keyword = null,
  previousOwner = null,
  viewerId = null,
  source = null,
  enteredStart = null,
  enteredEnd = null,
  protectState = null,
  customerType = null,
  industry = null,
  customerName = null,
  amountMin = null,
  amountMax = null,
  stageConfigId = null,
  sourceChannel = null,
  page,
  page_size,
  limit,
  offset,
}) {
  const conditions = ["r.status = 'in_sea'"];
  const params = [];
  // 实体已被删除的记录不展示，避免点进去 404 的僵尸行
  conditions.push(`(
    (r.entity_type = 'customer' AND EXISTS (SELECT 1 FROM customers c WHERE c.id = r.entity_id AND c.is_deleted = 0))
    OR (r.entity_type = 'opportunity' AND EXISTS (SELECT 1 FROM opportunities o WHERE o.id = r.entity_id AND o.is_deleted = 0))
    OR (r.entity_type = 'lead' AND EXISTS (SELECT 1 FROM leads l WHERE l.id = r.entity_id AND l.is_deleted = 0))
  )`);
  if (entityType) {
    conditions.push('r.entity_type = ?');
    params.push(entityType);
    // 随客户打包入海的子商机只在客户公海流转，不单独出现在商机公海
    if (entityType === 'opportunity') conditions.push('r.parent_record_id IS NULL');
  }
  if (keyword) {
    conditions.push('r.entity_name LIKE ?');
    params.push(`%${keyword}%`);
  }
  if (previousOwner) {
    if (previousOwner === 'me') {
      // 「我转出的」= 我操作转入的（含主管/管理员代转），或原本归我负责被转走的
      conditions.push('(r.created_by = ? OR r.previous_owner = ?)');
      params.push(viewerId, viewerId);
    } else {
      conditions.push('r.previous_owner = ?');
      params.push(previousOwner);
    }
  }
  if (source) {
    conditions.push('r.source = ?');
    params.push(source);
  }
  if (enteredStart) {
    conditions.push('date(r.entered_at) >= date(?)');
    params.push(enteredStart);
  }
  if (enteredEnd) {
    conditions.push('date(r.entered_at) <= date(?)');
    params.push(enteredEnd);
  }
  if (protectState === 'yes' || protectState === 'no') {
    const t = now();
    if (protectState === 'yes') {
      conditions.push('r.protect_until IS NOT NULL AND r.protect_until > ?');
    } else {
      conditions.push('(r.protect_until IS NULL OR r.protect_until <= ?)');
    }
    params.push(t);
  }

  // 按实体类型关联业务表，支持按客户/商机/线索自身字段筛选
  let fromSql = 'sea_pool_records r';
  if (entityType === 'customer') {
    fromSql += ' INNER JOIN customers e ON e.id = r.entity_id AND e.is_deleted = 0';
    if (customerType) {
      conditions.push('e.type = ?');
      params.push(customerType);
    }
    if (industry) {
      conditions.push('e.industry LIKE ?');
      params.push(`%${industry}%`);
    }
  } else if (entityType === 'opportunity') {
    fromSql +=
      ' INNER JOIN opportunities e ON e.id = r.entity_id AND e.is_deleted = 0' +
      ' LEFT JOIN customers c ON c.id = e.customer_id AND c.is_deleted = 0';
    if (customerName) {
      conditions.push('c.name LIKE ?');
      params.push(`%${customerName}%`);
    }
    if (amountMin !== null && amountMin !== undefined && amountMin !== '') {
      conditions.push('e.amount >= ?');
      params.push(Number(amountMin));
    }
    if (amountMax !== null && amountMax !== undefined && amountMax !== '') {
      conditions.push('e.amount <= ?');
      params.push(Number(amountMax));
    }
    if (stageConfigId) {
      conditions.push('e.stage_config_id = ?');
      params.push(stageConfigId);
    }
  } else if (entityType === 'lead') {
    fromSql += ' INNER JOIN leads e ON e.id = r.entity_id AND e.is_deleted = 0';
    if (sourceChannel) {
      conditions.push('e.source_channel = ?');
      params.push(sourceChannel);
    }
  }

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM ${fromSql} WHERE ${where}`).get(...params).cnt;
  const rows = db
    .prepare(
      `SELECT r.*, u.name AS claimed_by_name, p.name AS previous_owner_name,
              (SELECT COUNT(*) FROM sea_pool_records cr WHERE cr.parent_record_id = r.id AND cr.status = 'in_sea') AS bundled_count
       FROM ${fromSql}
       LEFT JOIN users u ON u.id = r.claimed_by
       LEFT JOIN users p ON p.id = r.previous_owner
       WHERE ${where} ORDER BY r.entered_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return { list: attachEntityInfo(rows), total, page, page_size };
}

/**
 * 公海列表补充业务字段（列表只存了 entity_name）：
 * 线索补联系人/电话/微信/来源/关联客户；商机补所属客户及其当前归属。
 */
function attachEntityInfo(list) {
  const custIds = [...new Set(list.filter((r) => r.entity_type === 'customer').map((r) => r.entity_id))];
  const leadIds = [...new Set(list.filter((r) => r.entity_type === 'lead').map((r) => r.entity_id))];
  const oppIds = [...new Set(list.filter((r) => r.entity_type === 'opportunity').map((r) => r.entity_id))];
  if (!custIds.length && !leadIds.length && !oppIds.length) return list;

  const custMap = new Map();
  if (custIds.length) {
    const placeholders = custIds.map(() => '?').join(',');
    db.prepare(`SELECT id, type, industry FROM customers WHERE id IN (${placeholders})`)
      .all(...custIds)
      .forEach((c) => custMap.set(c.id, c));
  }

  const leadMap = new Map();
  if (leadIds.length) {
    const placeholders = leadIds.map(() => '?').join(',');
    db.prepare(
      `SELECT id, contact_name, contact_phone, wechat, source_channel, customer_id, created_at
       FROM leads WHERE id IN (${placeholders})`
    )
      .all(...leadIds)
      .forEach((l) => leadMap.set(l.id, l));
  }

  // 线索的关联客户 + 商机的所属客户，统一查一次
  const customerIds = new Set();
  leadMap.forEach((l) => l.customer_id && customerIds.add(l.customer_id));

  const oppMap = new Map();
  if (oppIds.length) {
    const placeholders = oppIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT o.id, o.customer_id, c.name AS customer_name, c.is_in_sea AS customer_in_sea, u.name AS customer_owner_name
         FROM opportunities o
         LEFT JOIN customers c ON c.id = o.customer_id AND c.is_deleted = 0
         LEFT JOIN users u ON u.id = c.owner_id
         WHERE o.id IN (${placeholders})`
      )
      .all(...oppIds);
    rows.forEach((o) => {
      oppMap.set(o.id, o);
      if (o.customer_id) customerIds.add(o.customer_id);
    });
  }

  const customerMap = new Map();
  if (customerIds.size) {
    const ids = [...customerIds];
    const cp = ids.map(() => '?').join(',');
    db.prepare(`SELECT id, name FROM customers WHERE id IN (${cp})`)
      .all(...ids)
      .forEach((c) => customerMap.set(c.id, c.name));
  }

  return list.map((r) => {
    if (r.entity_type === 'customer') {
      const c = custMap.get(r.entity_id) || {};
      return { ...r, customer_type: c.type || null, industry: c.industry || null };
    }
    if (r.entity_type === 'opportunity') {
      const opp = oppMap.get(r.entity_id) || {};
      return {
        ...r,
        customer_id: opp.customer_id || null,
        customer_name: opp.customer_name || (opp.customer_id ? customerMap.get(opp.customer_id) || null : null),
        customer_in_sea: opp.customer_in_sea === 1 ? 1 : 0,
        customer_owner_name: opp.customer_owner_name || null,
      };
    }
    if (r.entity_type !== 'lead') return r;
    const lead = leadMap.get(r.entity_id) || {};
    return {
      ...r,
      contact_name: lead.contact_name || null,
      contact_phone: lead.contact_phone || null,
      wechat: lead.wechat || null,
      source_channel: lead.source_channel || null,
      customer_id: lead.customer_id || null,
      customer_name: lead.customer_id ? customerMap.get(lead.customer_id) || null : null,
      entity_created_at: lead.created_at || null,
    };
  });
}

/** 自动分配算法（M6-R7，P2）：按在途商机数升序分配给销售 */
function autoAssign(user) {
  const rules = configService.seaRules();
  const salesRole = db.prepare("SELECT id FROM roles WHERE role_code = 'sales'").get();
  if (!salesRole) return { assigned: 0, detail: [] };
  const sales = db
    .prepare("SELECT id, name FROM users WHERE role_id = ? AND status = 'enabled' AND is_deleted = 0")
    .all(salesRole.id)
    .map((u) => ({ ...u, load: countOwnedOpportunities(u.id) }))
    .sort((a, b) => a.load - b.load);

  // 子商机随客户分配，不单独参与自动分配
  const inSea = db
    .prepare("SELECT * FROM sea_pool_records WHERE status = 'in_sea' AND parent_record_id IS NULL ORDER BY entered_at")
    .all();
  const detail = [];
  inSea.forEach((r) => {
    const isOpp = r.entity_type === 'opportunity';
    const target = sales.find((s) => (isOpp ? s.load < rules.personal_max : true));
    if (!target) return;
    try {
      assign(r.entity_type, r.entity_id, target.id, user);
    } catch (e) {
      return;
    }
    if (isOpp) target.load += 1;
    detail.push({ record_id: r.id, entity_id: r.entity_id, owner_id: target.id, owner_name: target.name });
  });
  return { assigned: detail.length, detail };
}

module.exports = {
  TYPES,
  moveToSea,
  releaseCustomerToSea,
  pickup,
  assign,
  list,
  autoAssign,
  openSeaRecord,
  openChildRecords,
  childOpportunities,
  hasColumn,
};
