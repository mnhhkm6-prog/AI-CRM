'use strict';

/**
 * M4 销售行为记录 + 商机分享协作（P15/P16）
 * 覆盖：行为记录 CRUD、行为统计、回访提醒、商机分享与撤销
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, getPaging, paged, buildSort, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest } = require('../utils/errors');
const { newId, now, today } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const { logOperation } = require('../services/operationLog');
const stageEngine = require('../services/stageEngine');

const SORTABLE = ['activity_time', 'created_at'];
const EDITABLE = ['activity_type', 'activity_time', 'follow_up_time', 'content'];
const SHARE_PERMISSIONS = ['view', 'activity_create', 'edit', 'advance', 'view_proposal'];

/** 解析分享权限 JSON */
function parsePermissions(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/** 行为记录列表（M4-R2：数据权限对应 created_by） */
router.get('/activities', requirePermission('activity:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];

  const scope = dataScope.scopeFragment(req.user, 'activity', 't.created_by');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  ['opportunity_id', 'customer_id', 'activity_type', 'created_by'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.start_date) {
    conditions.push('t.activity_time >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.activity_time <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }
  if (req.query.keyword) {
    conditions.push('t.content LIKE ?');
    params.push(`%${req.query.keyword}%`);
  }

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM activities t WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, SORTABLE);
  const list = db
    .prepare(
      `SELECT t.*, u.name AS creator_name, o.name AS opportunity_name, c.name AS customer_name FROM activities t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN opportunities o ON o.id = t.opportunity_id
       LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);

  ok(res, paged(list, total, paging));
});

/** 新增行为（M4-R1） */
router.post('/activities', requirePermission('activity:create'), (req, res) => {
  const body = bodyOf(req);
  const activityType = requireString(body, 'activity_type', '行为类型');
  const activityTime = requireString(body, 'activity_time', '行为时间');
  const followUpTime = optional(body, 'follow_up_time'); // PRD 5.4：下次回访时间可选，填写后生成提醒
  const content = requireString(body, 'content', '行为内容');

  if (!body.opportunity_id && !body.customer_id) throw badRequest('opportunity_id 与 customer_id 至少提供一个');
  if (body.opportunity_id) {
    const opp = dataScope.findScoped('opportunity', 'opportunities', body.opportunity_id, req.user);
    if (!opp) throw notFound('关联商机不存在或无权访问');
  }

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO activities (id, opportunity_id, customer_id, activity_type, activity_time, follow_up_time, content,
      is_reminded, created_by, created_by_role, is_deleted, created_at, updated_at)
     VALUES (@id, @opportunity_id, @customer_id, @activity_type, @activity_time, @follow_up_time, @content,
      0, @created_by, @created_by_role, 0, @t, @t)`
  ).run({
    id,
    opportunity_id: body.opportunity_id || null,
    customer_id: body.customer_id || null,
    activity_type: activityType,
    activity_time: activityTime,
    follow_up_time: followUpTime,
    content,
    created_by: req.user.id,
    created_by_role: req.user.role_code || null,
    t,
  });

  if (body.opportunity_id) stageEngine.touchOpportunity(body.opportunity_id, req);
  logOperation(req, { action: 'CREATE_ACTIVITY', targetType: 'Activity', targetId: id, detail: { opportunity_id: body.opportunity_id || null } });

  created(res, db.prepare('SELECT * FROM activities WHERE id = ?').get(id));
});

/** 行为统计（M4-R4，注意必须先于 /activities/:id） */
router.get('/activities/stats', requirePermission('activity:view'), (req, res) => {
  const groupBy = ['sales', 'type', 'date'].includes(req.query.group_by) ? req.query.group_by : 'sales';
  const conditions = ['t.is_deleted = 0'];
  const params = [];

  const scope = dataScope.scopeFragment(req.user, 'activity', 't.created_by');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  if (req.query.start_date) {
    conditions.push('t.activity_time >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.activity_time <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM activities t WHERE ${where}`).get(...params).c;

  let list;
  if (groupBy === 'sales') {
    list = db
      .prepare(
        `SELECT t.created_by AS key, COALESCE(u.name, '未知') AS label, COUNT(*) AS count FROM activities t
         LEFT JOIN users u ON u.id = t.created_by
         WHERE ${where} GROUP BY t.created_by ORDER BY count DESC`
      )
      .all(...params);
  } else if (groupBy === 'type') {
    list = db
      .prepare(
        `SELECT t.activity_type AS key, t.activity_type AS label, COUNT(*) AS count FROM activities t
         WHERE ${where} GROUP BY t.activity_type ORDER BY count DESC`
      )
      .all(...params);
  } else {
    list = db
      .prepare(
        `SELECT substr(t.activity_time, 1, 10) AS key, substr(t.activity_time, 1, 10) AS label, COUNT(*) AS count
         FROM activities t WHERE ${where} GROUP BY key ORDER BY key`
      )
      .all(...params);
  }

  ok(res, { group_by: groupBy, list, total });
});

/** 回访提醒（M4-R3，注意必须先于 /activities/:id） */
router.get('/activities/reminders', requirePermission('activity:view'), (req, res) => {
  const todayStr = today();
  const conditions = ['t.is_deleted = 0', 't.follow_up_time IS NOT NULL', 'substr(t.follow_up_time, 1, 10) <= ?'];
  const params = [todayStr];

  const scope = dataScope.scopeFragment(req.user, 'activity', 't.created_by');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  const oppScope = dataScope.scopeFragment(req.user, 'opportunity');
  const custScope = dataScope.scopeFragment(req.user, 'customer');
  conditions.push(
    `((t.opportunity_id IS NOT NULL AND t.opportunity_id IN (SELECT id FROM opportunities WHERE is_deleted = 0${oppScope.sql}))
      OR (t.customer_id IS NOT NULL AND t.customer_id IN (SELECT id FROM customers WHERE is_deleted = 0${custScope.sql}))
      OR (t.opportunity_id IS NULL AND t.customer_id IS NULL))`
  );
  params.push(...oppScope.params, ...custScope.params);

  const where = conditions.join(' AND ');
  const list = db
    .prepare(
      `SELECT t.*, o.name AS opportunity_name, c.name AS customer_name, u.name AS owner_name
       FROM activities t
       LEFT JOIN opportunities o ON o.id = t.opportunity_id
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = COALESCE(o.owner_id, c.owner_id)
       WHERE ${where} ORDER BY t.follow_up_time ASC`
    )
    .all(...params);

  ok(res, list.map((item) => ({ ...item, overdue: String(item.follow_up_time).slice(0, 10) < todayStr })));
});

/** 行为记录详情 */
router.get('/activities/:id', requirePermission('activity:view'), (req, res) => {
  const row = dataScope.findScoped('activity', 'activities', req.params.id, req.user);
  if (!row) throw notFound('行为记录不存在或无权访问');
  row.creator_name = row.created_by ? (db.prepare('SELECT name FROM users WHERE id = ?').get(row.created_by) || {}).name : null;
  row.opportunity_name = row.opportunity_id ? (db.prepare('SELECT name FROM opportunities WHERE id = ?').get(row.opportunity_id) || {}).name : null;
  row.customer_name = row.customer_id ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(row.customer_id) || {}).name : null;
  ok(res, row);
});

/** 编辑行为记录（改后视为推进动作，刷新商机活动时间） */
router.put('/activities/:id', requirePermission('activity:update'), (req, res) => {
  const row = dataScope.findScoped('activity', 'activities', req.params.id, req.user);
  if (!row) throw notFound('行为记录不存在或无权访问');
  const body = bodyOf(req);

  const after = {};
  EDITABLE.forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE activities SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: row.id, t: now() });
  if (row.opportunity_id) stageEngine.touchOpportunity(row.opportunity_id, req);
  logOperation(req, { action: 'UPDATE_ACTIVITY', targetType: 'Activity', targetId: row.id, detail: after });
  ok(res, db.prepare('SELECT * FROM activities WHERE id = ?').get(row.id));
});

/** 删除行为记录（软删） */
router.delete('/activities/:id', requirePermission('activity:delete'), (req, res) => {
  const row = dataScope.findScoped('activity', 'activities', req.params.id, req.user);
  if (!row) throw notFound('行为记录不存在或无权访问');
  db.prepare('UPDATE activities SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_ACTIVITY', targetType: 'Activity', targetId: row.id, detail: { opportunity_id: row.opportunity_id } });
  ok(res, { id: row.id, deleted: true });
});

// ---------------------------------------------------------------- 商机分享协作
/** 商机分享列表（M4-R7） */
router.get('/opportunities/:id/shares', requirePermission('opportunity:view'), (req, res) => {
  const opp = dataScope.findScoped('opportunity', 'opportunities', req.params.id, req.user);
  if (!opp) throw notFound('商机不存在或无权访问');
  const list = db
    .prepare(
      `SELECT s.*, tu.name AS shared_to_name, bu.name AS shared_by_name FROM opportunity_shares s
       LEFT JOIN users tu ON tu.id = s.shared_to
       LEFT JOIN users bu ON bu.id = s.shared_by
       WHERE s.opportunity_id = ? AND s.is_revoked = 0 ORDER BY s.created_at DESC`
    )
    .all(opp.id);
  ok(res, list.map((s) => ({ ...s, permissions: parsePermissions(s.permissions) })));
});

/** 分享商机并授权（M4-R7） */
router.post('/opportunities/:id/shares', requirePermission('opportunity:update'), (req, res) => {
  const opp = dataScope.findScoped('opportunity', 'opportunities', req.params.id, req.user);
  if (!opp) throw notFound('商机不存在或无权访问');
  const body = bodyOf(req);
  const sharedToRaw = requireString(body, 'shared_to', '分享对象');

  const target = db
    .prepare('SELECT id FROM users WHERE (id = ? OR username = ?) AND is_deleted = 0')
    .get(sharedToRaw, sharedToRaw);
  if (!target) throw notFound('目标用户不存在');

  let permissions = Array.isArray(body.permissions) ? body.permissions.filter((p) => SHARE_PERMISSIONS.includes(p)) : [];
  if (!permissions.length) permissions = ['view', 'activity_create'];

  const t = now();
  const existing = db
    .prepare('SELECT * FROM opportunity_shares WHERE opportunity_id = ? AND shared_to = ?')
    .get(opp.id, target.id);

  if (existing) {
    db.prepare('UPDATE opportunity_shares SET permissions = ?, shared_by = ?, is_revoked = 0, revoked_at = NULL WHERE id = ?')
      .run(JSON.stringify(permissions), req.user.id, existing.id);
    logOperation(req, { action: 'SHARE_OPPORTUNITY', targetType: 'OpportunityShare', targetId: existing.id, detail: { opportunity_id: opp.id, shared_to: target.id, permissions } });
    const row = db.prepare('SELECT * FROM opportunity_shares WHERE id = ?').get(existing.id);
    return ok(res, { ...row, permissions });
  }

  const id = newId();
  db.prepare(
    `INSERT INTO opportunity_shares (id, opportunity_id, shared_by, shared_to, permissions, is_revoked, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, opp.id, req.user.id, target.id, JSON.stringify(permissions), t);
  logOperation(req, { action: 'SHARE_OPPORTUNITY', targetType: 'OpportunityShare', targetId: id, detail: { opportunity_id: opp.id, shared_to: target.id, permissions } });
  created(res, { ...db.prepare('SELECT * FROM opportunity_shares WHERE id = ?').get(id), permissions });
});

/** 撤销分享 */
router.delete('/opportunities/:id/shares/:shareId', requirePermission('opportunity:update'), (req, res) => {
  const opp = dataScope.findScoped('opportunity', 'opportunities', req.params.id, req.user);
  if (!opp) throw notFound('商机不存在或无权访问');
  const share = db
    .prepare('SELECT * FROM opportunity_shares WHERE id = ? AND opportunity_id = ?')
    .get(req.params.shareId, opp.id);
  if (!share) throw notFound('分享记录不存在');
  db.prepare('UPDATE opportunity_shares SET is_revoked = 1, revoked_at = ? WHERE id = ?').run(now(), share.id);
  logOperation(req, { action: 'REVOKE_OPPORTUNITY_SHARE', targetType: 'OpportunityShare', targetId: share.id, detail: { opportunity_id: opp.id, shared_to: share.shared_to } });
  ok(res, { id: share.id, revoked: true });
});

module.exports = router;
