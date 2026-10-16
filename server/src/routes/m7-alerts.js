'use strict';

/**
 * M7 停滞预警（P22/P23/P24）
 * 覆盖：预警列表、未推进商机、停滞说明申请与审批、预警阈值配置、定时任务手工触发
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, getPaging, paged, buildSort, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, conflict, CODE } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const configService = require('../services/configService');
const stageEngine = require('../services/stageEngine');
const jobs = require('../jobs');
const { logOperation } = require('../services/operationLog');

const DAY = 86400000;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : 0);

/** 把商机数据权限片段中的 owner_id 归属到商机别名 o */
function opportunityScopeClause(user) {
  const frag = dataScope.scopeFragment(user, 'opportunity');
  const sql = frag.sql.replace(/^ AND /, '').replace(/(^|\s)owner_id(\s)/g, '$1o.owner_id$2');
  return { sql, params: frag.params };
}

// 注意：/alerts/unadvanced 必须定义在其它 /alerts/xxx 之前
/** 未推进商机列表（M7-R4） */
router.get('/alerts/unadvanced', requirePermission('alert:view'), (req, res) => {
  const stages = stageEngine.listStages({ includeDisabled: true });
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const minDays = req.query.min_days !== undefined ? Number(req.query.min_days) : 21;

  const conditions = ['o.is_deleted = 0', 'o.is_in_sea = 0', "o.status = '进行中'"];
  const params = [];
  const scope = opportunityScopeClause(req.user);
  if (scope.sql) {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  if (req.query.stage_config_id) {
    conditions.push('o.stage_config_id = ?');
    params.push(req.query.stage_config_id);
  }

  const opps = db
    .prepare(
      `SELECT o.*, u.name AS owner_name, c.name AS customer_name FROM opportunities o
       LEFT JOIN users u ON u.id = o.owner_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ${conditions.join(' AND ')}`
    )
    .all(...params);

  const result = [];
  opps.forEach((opp) => {
    const stage = stageMap.get(opp.stage_config_id);
    const threshold = configService.alertThresholds(stage);
    const last = opp.last_activity_at || opp.stage_changed_at || opp.created_at;
    const days = daysSince(last);
    const openAlert = db
      .prepare('SELECT * FROM stale_alerts WHERE opportunity_id = ? AND is_resolved = 0 ORDER BY alert_level DESC')
      .get(opp.id);
    // 判定：存在未解决预警 或 距上次活动天数达到该阶段 level3 阈值（且不低于 min_days）
    const reached = days >= threshold.level3 && days >= minDays;
    if (!openAlert && !reached) return;
    result.push({
      opportunity_id: opp.id,
      name: opp.name,
      customer_name: opp.customer_name,
      stage_name_snapshot: opp.stage_name_snapshot,
      days_stagnant: days,
      last_activity_at: last,
      owner_name: opp.owner_name,
      alert_level: openAlert ? openAlert.alert_level : 0,
    });
  });
  result.sort((a, b) => b.days_stagnant - a.days_stagnant);
  const paging = getPaging(req);
  const pageList = result.slice(paging.offset, paging.offset + paging.limit);
  ok(res, paged(pageList, result.length, paging));
});

/** 预警列表（M7-R1/M7-R2） */
router.get('/alerts', requirePermission('alert:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['1 = 1'];
  const params = [];
  const scope = opportunityScopeClause(req.user);
  if (scope.sql) {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  ['level', 'opportunity_id', 'stage_config_id'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f === 'level' ? 'alert_level' : f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.is_resolved !== undefined) {
    conditions.push('t.is_resolved = ?');
    params.push(req.query.is_resolved === 'true' || req.query.is_resolved === '1' ? 1 : 0);
  } else {
    conditions.push('t.is_resolved = 0');
  }
  if (req.query.start_date) {
    conditions.push('t.triggered_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.triggered_at <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }

  const where = conditions.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) c FROM stale_alerts t LEFT JOIN opportunities o ON o.id = t.opportunity_id WHERE ${where}`)
    .get(...params).c;
  const sort = buildSort(req, ['triggered_at', 'days_stagnant', 'alert_level', 'created_at'], 'triggered_at');
  const orderClause = sort.clause.replace('ORDER BY ', 'ORDER BY t.');
  const list = db
    .prepare(
      `SELECT t.*, o.name AS opportunity_name, o.owner_id AS owner_id, o.status AS opportunity_status,
              u.name AS owner_name, c.name AS customer_name
       FROM stale_alerts t
       LEFT JOIN opportunities o ON o.id = t.opportunity_id
       LEFT JOIN users u ON u.id = o.owner_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ${where}${orderClause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

/** 提交停滞说明申请（M7-R5，延期） */
router.post('/opportunities/:id/stagnation-explain', requirePermission('opportunity:update'), (req, res) => {
  const opp = dataScope.findScoped('opportunity', 'opportunities', req.params.id, req.user);
  if (!opp) throw notFound('商机不存在或无权访问');
  const body = bodyOf(req);
  const reason = requireString(body, 'reason', '停滞原因');
  const expectedDate = requireString(body, 'expected_date', '预计推进日期');

  const pending = db
    .prepare("SELECT id FROM stagnation_explains WHERE opportunity_id = ? AND status = 'pending'")
    .get(opp.id);
  if (pending) throw conflict('该商机已有待审批的停滞说明申请');

  const alert = db
    .prepare('SELECT id FROM stale_alerts WHERE opportunity_id = ? AND is_resolved = 0 ORDER BY alert_level DESC')
    .get(opp.id);
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO stagnation_explains (id, opportunity_id, alert_id, reason, detail, expected_date, status, submitted_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(id, opp.id, alert ? alert.id : null, reason, optional(body, 'detail'), expectedDate, req.user.id, t, t);

  logOperation(req, { action: 'SUBMIT_STAGNATION_EXPLAIN', targetType: 'StagnationExplain', targetId: id, detail: { opportunity_id: opp.id } });
  created(res, db.prepare('SELECT * FROM stagnation_explains WHERE id = ?').get(id));
});

/** 审批通过停滞说明（解除预警并重新计时） */
router.post('/stagnation-explains/:id/approve', requirePermission('alert:manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM stagnation_explains WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('停滞说明不存在');
  if (row.status !== 'pending') throw badRequest('该停滞说明已处理');
  const body = bodyOf(req);
  const t = now();

  db.prepare(
    "UPDATE stagnation_explains SET status = 'approved', approver_id = ?, approve_comment = ?, approved_at = ?, updated_at = ? WHERE id = ?"
  ).run(req.user.id, optional(body, 'comment'), t, t, row.id);
  db.prepare('UPDATE stale_alerts SET is_resolved = 1, resolved_at = ?, resolved_by = ? WHERE opportunity_id = ? AND is_resolved = 0').run(
    t, req.user.id, row.opportunity_id
  );
  db.prepare('UPDATE opportunities SET last_activity_at = ?, updated_at = ? WHERE id = ?').run(t, t, row.opportunity_id);

  logOperation(req, { action: 'APPROVE_STAGNATION_EXPLAIN', targetType: 'StagnationExplain', targetId: row.id, detail: { opportunity_id: row.opportunity_id } });
  ok(res, db.prepare('SELECT * FROM stagnation_explains WHERE id = ?').get(row.id));
});

/** 驳回停滞说明 */
router.post('/stagnation-explains/:id/reject', requirePermission('alert:manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM stagnation_explains WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('停滞说明不存在');
  if (row.status !== 'pending') throw badRequest('该停滞说明已处理');
  const comment = requireString(bodyOf(req), 'comment', '驳回意见');
  const t = now();

  db.prepare(
    "UPDATE stagnation_explains SET status = 'rejected', approver_id = ?, approve_comment = ?, approved_at = ?, updated_at = ? WHERE id = ?"
  ).run(req.user.id, comment, t, t, row.id);

  logOperation(req, { action: 'REJECT_STAGNATION_EXPLAIN', targetType: 'StagnationExplain', targetId: row.id, detail: { opportunity_id: row.opportunity_id } });
  ok(res, db.prepare('SELECT * FROM stagnation_explains WHERE id = ?').get(row.id));
});

// ---------------------------------------------------------------- 预警阈值配置
/** 读取预警阈值配置（M10-R3） */
router.get('/system/configs/alert', requirePermission('system_config:view'), (req, res) => {
  ok(res, {
    level1_days: configService.getNumber('stale_alert_level1_days', 7),
    level2_days: configService.getNumber('stale_alert_level2_days', 14),
    level3_days: configService.getNumber('stale_alert_level3_days', 21),
    fallback_days: configService.getNumber('sea_fallback_days_after_alert', 7),
  });
});

/** 修改预警阈值（需二次确认） */
router.put('/system/configs/alert', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const current = {
    level1_days: configService.getNumber('stale_alert_level1_days', 7),
    level2_days: configService.getNumber('stale_alert_level2_days', 14),
    level3_days: configService.getNumber('stale_alert_level3_days', 21),
    fallback_days: configService.getNumber('sea_fallback_days_after_alert', 7),
  };
  // 支持部分更新：未传字段沿用当前值
  const incoming = { ...current };
  Object.keys(current).forEach((f) => {
    if (body[f] === undefined) return;
    const n = Number(body[f]);
    if (body[f] === '' || Number.isNaN(n)) throw badRequest(`${f} 必须为数字`);
    incoming[f] = n;
  });

  if (body.confirm !== true) {
    throw conflict('修改预警阈值需二次确认，请传 confirm=true', CODE.ROLE_PERMISSION_CONFIRM, { current, incoming });
  }
  if (!(incoming.level1_days < incoming.level2_days && incoming.level2_days < incoming.level3_days)) {
    throw badRequest('阈值需满足 level1_days < level2_days < level3_days');
  }

  configService.set('stale_alert_level1_days', incoming.level1_days, req.user.id);
  configService.set('stale_alert_level2_days', incoming.level2_days, req.user.id);
  configService.set('stale_alert_level3_days', incoming.level3_days, req.user.id);
  configService.set('sea_fallback_days_after_alert', incoming.fallback_days, req.user.id);

  logOperation(req, {
    action: 'UPDATE_ALERT_CONFIG',
    targetType: 'SystemConfig',
    targetId: 'alert',
    detail: { before: current, after: incoming },
    logType: 'config',
  });
  ok(res, incoming);
});

// ---------------------------------------------------------------- 定时任务手工触发
router.post('/jobs/stale-alert/run', requirePermission('system_config:manage'), (req, res) => {
  ok(res, jobs.runStaleAlertScan());
});

router.post('/jobs/sea-fallback/run', requirePermission('system_config:manage'), (req, res) => {
  ok(res, jobs.runSeaFallback());
});

router.post('/jobs/protection-expire/run', requirePermission('system_config:manage'), (req, res) => {
  ok(res, jobs.runProtectionExpire());
});

router.post('/jobs/lead-recycle/run', requirePermission('system_config:manage'), (req, res) => {
  ok(res, jobs.runLeadRecycle());
});

router.post('/jobs/report-subscribe/run', requirePermission('system_config:manage'), async (req, res, next) => {
  try {
    ok(res, await jobs.runReportSubscriptions());
  } catch (e) {
    next(e);
  }
});

module.exports = router;
