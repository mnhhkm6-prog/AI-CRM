'use strict';

/**
 * M9 报表复盘（P27）
 * 覆盖：漏斗报表、停滞复盘、失效复盘、销售个人报表、团队报表、报表导出
 * 所有报表均以「当前用户数据权限可见的商机」为基数（FROM opportunities o）。
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok } = require('../utils/http');
const { notFound } = require('../utils/errors');
const { now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const org = require('../services/org');
const stageEngine = require('../services/stageEngine');
const exporter = require('../services/exporter');

const DAY = 86400000;

/** 商机数据权限片段：把 owner_id 前缀改为 o.owner_id（跨表联查时使用） */
function oppScope(req) {
  const f = dataScope.scopeFragment(req.user, 'opportunity');
  return { sql: f.sql.replace(/(^|\s)owner_id(\s)/g, '$1o.owner_id$2'), params: f.params };
}

/** 叠加商机数据权限（以 o 为别名） */
function appendScope(req, conditions, params) {
  const scope = oppScope(req);
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
}

const endOfDay = (date) => `${date}T23:59:59.999Z`;
const ratio = (part, total) => (total ? Number((part / total).toFixed(4)) : 0);

// ---------------------------------------------------------------- 漏斗报表
function buildFunnel(req) {
  const conditions = ['o.is_deleted = 0'];
  const params = [];
  appendScope(req, conditions, params);

  const dateField = ['created_at', 'stage_changed_at'].includes(req.query.date_field) ? req.query.date_field : 'created_at';
  if (req.query.start_date) {
    conditions.push(`o.${dateField} >= ?`);
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push(`o.${dateField} <= ?`);
    params.push(endOfDay(req.query.end_date));
  }
  if (req.query.owner_id) {
    conditions.push('o.owner_id = ?');
    params.push(req.query.owner_id);
  }
  if (req.query.team_id) {
    const ids = org.userIdsInDepartments(org.subtreeIds(req.query.team_id));
    if (!ids.length) conditions.push('1 = 0');
    else {
      conditions.push(`o.owner_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  const where = conditions.join(' AND ');
  const from = 'FROM opportunities o LEFT JOIN stage_configs sc ON sc.id = o.stage_config_id';

  // 必须按阶段名称快照分组（PRD 15.2.7）
  const list = db
    .prepare(
      `SELECT o.stage_name_snapshot AS stage_name, sc.code AS stage_code,
              COUNT(*) AS count, COALESCE(SUM(o.amount), 0) AS amount
       ${from} WHERE ${where}
       GROUP BY o.stage_name_snapshot, sc.code`
    )
    .all(...params);

  // 主漏斗口径从 S1 起算，S0（客户数据录入）单独作为「待验证」统计
  const mainWhere = `${where} AND (sc.code IS NULL OR sc.code <> 'S0')`;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(o.amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN o.status = '赢单' THEN 1 ELSE 0 END), 0) AS won_count,
              COALESCE(SUM(CASE WHEN o.status = '赢单' THEN o.amount ELSE 0 END), 0) AS won_amount
       ${from} WHERE ${mainWhere}`
    )
    .get(...params);
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(o.amount), 0) AS amount
       ${from} WHERE ${where} AND sc.code = 'S0'`
    )
    .get(...params);

  return {
    list,
    summary: {
      count: row.count,
      amount: row.amount,
      won_count: row.won_count,
      won_amount: row.won_amount,
      win_rate: ratio(row.won_count, row.count),
      pending_count: pending.count,
      pending_amount: pending.amount,
    },
    pending: { count: pending.count, amount: pending.amount },
    // 按生效阶段顺序返回，供前端补零展示
    stages: stageEngine.listStages().map((s) => ({
      code: s.code,
      name: s.name,
      sort_order: s.sort_order,
      is_terminal: s.is_terminal,
      terminal_type: s.terminal_type,
    })),
  };
}

// ---------------------------------------------------------------- 停滞复盘
function buildStagnation(req) {
  const conditions = ['o.is_deleted = 0'];
  const params = [];
  appendScope(req, conditions, params);

  const start = req.query.start_date || new Date(Date.now() - 90 * DAY).toISOString();
  const end = req.query.end_date ? endOfDay(req.query.end_date) : now();
  conditions.push('sa.triggered_at >= ?');
  params.push(start);
  conditions.push('sa.triggered_at <= ?');
  params.push(end);
  if (req.query.owner_id) {
    conditions.push('o.owner_id = ?');
    params.push(req.query.owner_id);
  }
  const where = conditions.join(' AND ');
  const from = 'FROM stale_alerts sa JOIN opportunities o ON o.id = sa.opportunity_id';

  const byLevel = db
    .prepare(`SELECT sa.alert_level, COUNT(*) AS count ${from} WHERE ${where} GROUP BY sa.alert_level ORDER BY sa.alert_level`)
    .all(...params);
  const byStage = db
    .prepare(`SELECT sa.stage_name_snapshot, COUNT(*) AS count ${from} WHERE ${where} GROUP BY sa.stage_name_snapshot ORDER BY count DESC`)
    .all(...params);
  const resRow = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN sa.is_resolved = 1 THEN 1 ELSE 0 END), 0) AS resolved,
              COALESCE(SUM(CASE WHEN sa.is_resolved = 0 THEN 1 ELSE 0 END), 0) AS unresolved
       ${from} WHERE ${where}`
    )
    .get(...params);
  const avgRow = db.prepare(`SELECT AVG(sa.days_stagnant) AS avg_days ${from} WHERE ${where}`).get(...params);
  const unadvancedTop = db
    .prepare(
      `SELECT o.name AS opportunity_name, c.name AS customer_name, sa.stage_name_snapshot AS stage_name,
              sa.days_stagnant, u.name AS owner_name, o.last_activity_at
       ${from}
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.owner_id
       WHERE ${where}
       ORDER BY sa.days_stagnant DESC LIMIT 50`
    )
    .all(...params);

  return {
    by_level: byLevel,
    by_stage: byStage,
    resolved: { resolved: resRow.resolved, unresolved: resRow.unresolved },
    avg_days_stagnant: avgRow.avg_days === null ? 0 : Number(avgRow.avg_days.toFixed(1)),
    unadvanced_top: unadvancedTop,
  };
}

// ---------------------------------------------------------------- 失效复盘
function buildLoss(req) {
  const conditions = ['o.is_deleted = 0', "lr.approval_status = 'approved'"];
  const params = [];
  appendScope(req, conditions, params);

  if (req.query.start_date) {
    conditions.push('lr.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('lr.created_at <= ?');
    params.push(endOfDay(req.query.end_date));
  }
  const where = conditions.join(' AND ');
  const from = 'FROM loss_records lr JOIN opportunities o ON o.id = lr.opportunity_id';

  const byReason = db
    .prepare(
      `SELECT lr.loss_reason, COUNT(*) AS count, COALESCE(SUM(o.amount), 0) AS amount
       ${from} WHERE ${where} GROUP BY lr.loss_reason ORDER BY count DESC`
    )
    .all(...params);
  const byCompetitor = db
    .prepare(
      `SELECT lr.competitor_name, COUNT(*) AS count ${from}
       WHERE ${where} AND lr.competitor_name IS NOT NULL AND lr.competitor_name <> ''
       GROUP BY lr.competitor_name ORDER BY count DESC`
    )
    .all(...params);
  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', lr.created_at) AS month, COUNT(*) AS count, COALESCE(SUM(o.amount), 0) AS amount
       ${from} WHERE ${where} GROUP BY month ORDER BY month`
    )
    .all(...params);
  const recoverable = db
    .prepare(
      `SELECT lr.id, o.name AS opportunity_name, c.name AS customer_name, lr.recovery_plan, lr.follow_up_date
       ${from} LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ${where} AND lr.is_recoverable = 1 ORDER BY lr.follow_up_date`
    )
    .all(...params);
  const row = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(o.amount), 0) AS amount ${from} WHERE ${where}`).get(...params);

  return {
    by_reason: byReason,
    by_competitor: byCompetitor,
    by_month: byMonth,
    recoverable,
    summary: { count: row.count, amount: row.amount },
  };
}

// ---------------------------------------------------------------- 销售个人报表
function buildPersonal(req) {
  const userId = req.query.user_id || req.user.id;
  const user = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_deleted = 0').get(userId);
  if (!user) throw notFound('用户不存在');

  const conditions = ['o.is_deleted = 0', 'o.owner_id = ?'];
  const params = [user.id];
  appendScope(req, conditions, params);
  if (req.query.start_date) {
    conditions.push('o.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('o.created_at <= ?');
    params.push(endOfDay(req.query.end_date));
  }
  const where = conditions.join(' AND ');

  const row = db
    .prepare(
      `SELECT COUNT(*) AS opportunity_count,
              COALESCE(SUM(CASE WHEN o.status = '赢单' THEN 1 ELSE 0 END), 0) AS won_count,
              COALESCE(SUM(CASE WHEN o.status = '失败' THEN 1 ELSE 0 END), 0) AS lost_count,
              COALESCE(SUM(o.amount), 0) AS total_amount,
              COALESCE(SUM(CASE WHEN o.status = '赢单' THEN o.amount ELSE 0 END), 0) AS won_amount
       FROM opportunities o WHERE ${where}`
    )
    .get(...params);

  const stageDistribution = db
    .prepare(
      `SELECT o.stage_name_snapshot AS stage_name, COUNT(*) AS count, COALESCE(SUM(o.amount), 0) AS amount
       FROM opportunities o WHERE ${where} GROUP BY o.stage_name_snapshot`
    )
    .all(...params);

  const actConditions = ['created_by = ?', 'is_deleted = 0'];
  const actParams = [user.id];
  if (req.query.start_date) {
    actConditions.push('activity_time >= ?');
    actParams.push(req.query.start_date);
  }
  if (req.query.end_date) {
    actConditions.push('activity_time <= ?');
    actParams.push(endOfDay(req.query.end_date));
  }
  const actWhere = actConditions.join(' AND ');
  const activityCount = db.prepare(`SELECT COUNT(*) AS c FROM activities WHERE ${actWhere}`).get(...actParams).c;
  const activityByType = db
    .prepare(`SELECT activity_type, COUNT(*) AS count FROM activities WHERE ${actWhere} GROUP BY activity_type ORDER BY count DESC`)
    .all(...actParams);

  return {
    user: { id: user.id, name: user.name },
    summary: {
      opportunity_count: row.opportunity_count,
      won_count: row.won_count,
      lost_count: row.lost_count,
      total_amount: row.total_amount,
      won_amount: row.won_amount,
      win_rate: ratio(row.won_count, row.opportunity_count),
      activity_count: activityCount,
    },
    stage_distribution: stageDistribution,
    activity_by_type: activityByType,
  };
}

// ---------------------------------------------------------------- 团队报表
function buildTeam(req) {
  const deptId = req.query.department_id || req.user.department_id;
  const dept = deptId
    ? db.prepare('SELECT id, name FROM departments WHERE id = ? AND is_deleted = 0').get(deptId)
    : null;
  if (deptId && !dept) throw notFound('部门不存在');

  const memberIds = deptId ? org.userIdsInDepartments(org.subtreeIds(deptId)) : [];

  const conditions = ['o.is_deleted = 0'];
  const params = [];
  appendScope(req, conditions, params);
  if (!memberIds.length) conditions.push('1 = 0');
  else {
    conditions.push(`o.owner_id IN (${memberIds.map(() => '?').join(',')})`);
    params.push(...memberIds);
  }
  if (req.query.start_date) {
    conditions.push('o.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('o.created_at <= ?');
    params.push(endOfDay(req.query.end_date));
  }
  const where = conditions.join(' AND ');

  const statRows = db
    .prepare(
      `SELECT o.owner_id, COUNT(*) AS opportunity_count,
              COALESCE(SUM(CASE WHEN o.status = '赢单' THEN 1 ELSE 0 END), 0) AS won_count,
              COALESCE(SUM(o.amount), 0) AS amount
       FROM opportunities o WHERE ${where} GROUP BY o.owner_id`
    )
    .all(...params);
  const statMap = new Map(statRows.map((r) => [r.owner_id, r]));

  let members = [];
  if (memberIds.length) {
    const ph = memberIds.map(() => '?').join(',');
    members = db
      .prepare(`SELECT id AS user_id, name AS user_name FROM users WHERE id IN (${ph}) AND is_deleted = 0 ORDER BY name`)
      .all(...memberIds)
      .map((u) => {
        const s = statMap.get(u.user_id) || { opportunity_count: 0, won_count: 0, amount: 0 };
        return {
          user_id: u.user_id,
          user_name: u.user_name,
          opportunity_count: s.opportunity_count,
          won_count: s.won_count,
          amount: s.amount,
          win_rate: ratio(s.won_count, s.opportunity_count),
        };
      });
  }

  const stageDistribution = db
    .prepare(
      `SELECT o.stage_name_snapshot AS stage_name, COUNT(*) AS count, COALESCE(SUM(o.amount), 0) AS amount
       FROM opportunities o WHERE ${where} GROUP BY o.stage_name_snapshot`
    )
    .all(...params);

  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(o.amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN o.status = '赢单' THEN 1 ELSE 0 END), 0) AS won_count,
              COALESCE(SUM(CASE WHEN o.status = '赢单' THEN o.amount ELSE 0 END), 0) AS won_amount
       FROM opportunities o WHERE ${where}`
    )
    .get(...params);

  return {
    department: dept ? { id: dept.id, name: dept.name } : null,
    members,
    stage_distribution: stageDistribution,
    summary: {
      member_count: members.length,
      opportunity_count: row.count,
      won_count: row.won_count,
      amount: row.amount,
      won_amount: row.won_amount,
      win_rate: ratio(row.won_count, row.count),
    },
  };
}

// ---------------------------------------------------------------- 查询接口
router.get('/reports/funnel', requirePermission('report:view'), (req, res) => {
  ok(res, buildFunnel(req));
});

router.get('/reports/stagnation', requirePermission('report:view'), (req, res) => {
  ok(res, buildStagnation(req));
});

router.get('/reports/loss', requirePermission('report:view'), (req, res) => {
  ok(res, buildLoss(req));
});

router.get('/reports/personal', requirePermission('report:view'), (req, res) => {
  ok(res, buildPersonal(req));
});

router.get('/reports/team', requirePermission('report:view'), (req, res) => {
  ok(res, buildTeam(req));
});

// ---------------------------------------------------------------- 导出接口
const BUILDERS = {
  funnel: buildFunnel,
  stagnation: buildStagnation,
  loss: buildLoss,
  personal: buildPersonal,
  team: buildTeam,
};

/** 各报表的导出表格映射 */
const EXPORT_TABLES = {
  funnel: (d) => ({
    sheetName: '商机漏斗',
    columns: [
      { header: '阶段', key: 'stage_name', width: 24 },
      { header: '商机数', key: 'count', width: 12 },
      { header: '金额', key: 'amount', width: 16 },
    ],
    rows: d.list,
  }),
  stagnation: (d) => ({
    sheetName: '停滞复盘',
    columns: [
      { header: '商机', key: 'opportunity_name', width: 28 },
      { header: '客户', key: 'customer_name', width: 24 },
      { header: '阶段', key: 'stage_name', width: 20 },
      { header: '停滞天数', key: 'days_stagnant', width: 12 },
      { header: '负责人', key: 'owner_name', width: 14 },
      { header: '最后推进时间', key: 'last_activity_at', width: 24 },
    ],
    rows: d.unadvanced_top,
  }),
  loss: (d) => ({
    sheetName: '失效复盘',
    columns: [
      { header: '失效原因', key: 'loss_reason', width: 24 },
      { header: '数量', key: 'count', width: 12 },
      { header: '金额', key: 'amount', width: 16 },
    ],
    rows: d.by_reason,
  }),
  personal: (d) => ({
    sheetName: '个人业绩',
    columns: [
      { header: '阶段', key: 'stage_name', width: 24 },
      { header: '商机数', key: 'count', width: 12 },
      { header: '金额', key: 'amount', width: 16 },
    ],
    rows: d.stage_distribution,
  }),
  team: (d) => ({
    sheetName: '团队业绩',
    columns: [
      { header: '成员', key: 'user_name', width: 16 },
      { header: '商机数', key: 'opportunity_count', width: 12 },
      { header: '赢单数', key: 'won_count', width: 12 },
      { header: '金额', key: 'amount', width: 16 },
      { header: '赢单率', key: 'win_rate', width: 12 },
    ],
    rows: d.members,
  }),
};

// ⚠️ 参数化路径必须写在静态子路径之后
router.get('/reports/:type/export', requirePermission('report:export'), (req, res, next) => {
  const { type } = req.params;
  const builder = BUILDERS[type];
  if (!builder) throw notFound(`不支持的报表类型：${type}`);

  const data = builder(req);
  const table = EXPORT_TABLES[type](data);
  const format = String(req.query.format || 'excel').toLowerCase();
  const filename = `report-${type}-${Date.now()}`;

  // format=html/pdf 输出可打印 HTML（浏览器另存为 PDF）
  if (format === 'html' || format === 'pdf') {
    return exporter.writeHtml(res, {
      filename: `${filename}.html`,
      title: `报表导出-${type}`,
      columns: table.columns,
      rows: table.rows,
    });
  }
  return exporter
    .writeExcel(res, { filename: `${filename}.xlsx`, sheetName: table.sheetName, columns: table.columns, rows: table.rows })
    .catch(next);
});

module.exports = router;
