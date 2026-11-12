'use strict';

/**
 * 定时任务（对应四大引擎之三：停滞检测 + 公海回落 + 保护期 + 线索回收 + 报表订阅）
 * 开发期用 node-cron 内置调度；同时导出函数供 POST /jobs/* 手工触发（便于测试与补跑）。
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { db } = require('../db');
const { newId, now } = require('../utils/ids');
const { logOperation } = require('../services/operationLog');
const configService = require('../services/configService');
const stageEngine = require('../services/stageEngine');
const seaService = require('../services/seaService');
const reminderService = require('../services/reminderService');
const notification = require('../services/notification');
const { buildExcel } = require('../services/exporter');

const DAY = 86400000;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : 0);

/**
 * 数据自动转入公海后，通知原负责人与主管，避免销售"数据被系统拿走却不知情"
 */
function notifySeaEntered({ entityType, entityId, name, recordId, previousOwner, label, reason }) {
  const targets = new Set();
  if (previousOwner) targets.add(previousOwner);
  db.prepare(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.role_code IN ('management', 'system_admin') AND u.is_deleted = 0 AND u.status = 'enabled'`
  )
    .all()
    .forEach((u) => targets.add(u.id));

  targets.forEach((userId) => {
    const link =
      userId === previousOwner
        ? `/sea/${entityType}?previous_owner=me`
        : `/sea/${entityType}${previousOwner ? `?previous_owner=${previousOwner}` : ''}`;
    notification.push(userId, {
      category: 'sea',
      title: `${label}「${name}」已转入公海`,
      content: reason || '可在公海池查看并重新分配',
      refType: entityType,
      refId: entityId,
      link,
      dedupKey: `sea:${recordId}:${userId}`,
    });
  });
}

/** 停滞预警检测（每日 00:05） */
function runStaleAlertScan() {
  const stages = stageEngine.listStages();
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const notified = db
    .prepare("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.role_code IN ('management','system_admin') AND u.is_deleted = 0")
    .all()
    .map((u) => u.id);

  const opps = db
    .prepare(
      `SELECT * FROM opportunities
       WHERE is_deleted = 0 AND is_in_sea = 0 AND status = '进行中'`
    )
    .all();

  const result = { scanned: opps.length, created: 0, upgraded: 0, resolved: 0, details: [] };

  opps.forEach((opp) => {
    const stage = stageMap.get(opp.stage_config_id);
    if (!stage || stage.is_terminal) return;
    const last = opp.last_activity_at || opp.stage_changed_at || opp.created_at;
    const days = daysSince(last);
    const th = configService.alertThresholds(stage);

    let level = 0;
    if (days >= th.level3) level = 3;
    else if (days >= th.level2) level = 2;
    else if (days >= th.level1) level = 1;

    const open = db
      .prepare('SELECT * FROM stale_alerts WHERE opportunity_id = ? AND is_resolved = 0 ORDER BY alert_level DESC')
      .get(opp.id);

    if (level === 0) {
      if (open) {
        db.prepare('UPDATE stale_alerts SET is_resolved = 1, resolved_at = ?, resolved_by = ? WHERE id = ?')
          .run(now(), 'system', open.id);
        result.resolved += 1;
      }
      return;
    }

    if (!open) {
      db.prepare(
        `INSERT INTO stale_alerts (id, opportunity_id, stage_config_id, stage_name_snapshot, alert_level, days_stagnant,
          triggered_at, is_resolved, notified_users, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(
        newId(), opp.id, stage.id, opp.stage_name_snapshot, level, days, now(),
        JSON.stringify([opp.owner_id, ...notified].filter(Boolean)), now(), now()
      );
      result.created += 1;
      result.details.push({ opportunity_id: opp.id, level, days });
    } else if (open.alert_level < level) {
      db.prepare('UPDATE stale_alerts SET alert_level = ?, days_stagnant = ?, notified_users = ?, updated_at = ? WHERE id = ?')
        .run(level, days, JSON.stringify([opp.owner_id, ...notified].filter(Boolean)), now(), open.id);
      result.upgraded += 1;
      result.details.push({ opportunity_id: opp.id, level, from: open.alert_level, days });
    } else {
      db.prepare('UPDATE stale_alerts SET days_stagnant = ?, updated_at = ? WHERE id = ?').run(days, now(), open.id);
    }
  });

  logOperation(null, { action: 'RUN_JOB_STALE_ALERT', targetType: 'Job', targetId: 'stale-alert', detail: result });
  return result;
}

/** 三级预警后再超缓冲天数 → 自动回落公海（每日 00:10，M7-R6） */
function runSeaFallback() {
  const fallback = configService.getNumber('sea_fallback_days_after_alert', 7);
  const alerts = db
    .prepare('SELECT * FROM stale_alerts WHERE is_resolved = 0 AND alert_level = 3')
    .all();
  const moved = [];
  alerts.forEach((a) => {
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ? AND is_deleted = 0').get(a.opportunity_id);
    if (!opp || opp.is_in_sea === 1 || opp.status !== '进行中') return;
    const last = opp.last_activity_at || opp.stage_changed_at || opp.created_at;
    const stage = stageEngine.getById(opp.stage_config_id);
    const th = configService.alertThresholds(stage);
    if (daysSince(last) < th.level3 + fallback) return;
    const reason = `三级预警后连续 ${th.level3 + fallback} 天无推进，系统自动回落公海`;
    const record = seaService.moveToSea({
      entityType: 'opportunity',
      entityId: opp.id,
      reason,
      source: 'auto_stale',
    });
    notifySeaEntered({
      entityType: 'opportunity',
      entityId: opp.id,
      name: opp.name,
      recordId: record.id,
      previousOwner: opp.owner_id,
      label: '商机',
      reason,
    });
    moved.push(opp.id);
  });
  const result = { moved: moved.length, opportunity_ids: moved };
  logOperation(null, { action: 'RUN_JOB_SEA_FALLBACK', targetType: 'Job', targetId: 'sea-fallback', detail: result });
  return result;
}

/** 公海保护期到期解锁（每小时） */
function runProtectionExpire() {
  const t = now();
  const info = db
    .prepare("UPDATE sea_pool_records SET protect_until = NULL, updated_at = ? WHERE protect_until IS NOT NULL AND protect_until < ?")
    .run(t, t);
  return { released: info.changes };
}

/** 线索未转化回收（每日 00:20，M2-R5） */
function runLeadRecycle() {
  const days = configService.getNumber('lead_unconverted_recycle_days', 60);
  const leads = db
    .prepare("SELECT * FROM leads WHERE is_deleted = 0 AND status IN ('new','following') AND is_in_sea = 0")
    .all();
  const recycled = [];
  leads.forEach((l) => {
    // 以最近一次更新为准：线索表没有独立的活动时间，updated_at 能反映跟进
    if (daysSince(l.updated_at || l.created_at) < days) return;
    const reason = `线索 ${days} 天未转化，系统自动回收`;
    const record = seaService.moveToSea({
      entityType: 'lead',
      entityId: l.id,
      reason,
      source: 'auto_recycle',
    });
    notifySeaEntered({
      entityType: 'lead',
      entityId: l.id,
      name: l.name,
      recordId: record.id,
      previousOwner: l.owner_id,
      label: '线索',
      reason,
    });
    recycled.push(l.id);
  });
  const result = { recycled: recycled.length, lead_ids: recycled };
  logOperation(null, { action: 'RUN_JOB_LEAD_RECYCLE', targetType: 'Job', targetId: 'lead-recycle', detail: result });
  return result;
}

/** 客户长期无商机更新或创建 → 自动转公海（每日 00:25） */
function runCustomerRecycle() {
  const days = configService.getNumber('customer_inactive_recycle_days', 90);
  const customers = db
    .prepare("SELECT * FROM customers WHERE is_deleted = 0 AND is_in_sea = 0 AND status = 'active'")
    .all();
  const recycled = [];
  customers.forEach((c) => {
    const lastOpp = db
      .prepare(
        `SELECT MAX(COALESCE(last_activity_at, stage_changed_at, created_at)) AS v
         FROM opportunities WHERE customer_id = ? AND is_deleted = 0`
      )
      .get(c.id).v;
    const last = [c.last_activity_at, lastOpp, c.created_at].filter(Boolean).sort().pop();
    if (!last || daysSince(last) < days) return;
    const reason = `客户 ${days} 天无商机更新或创建，系统自动转入公海（含进行中商机）`;
    try {
      const res = seaService.releaseCustomerToSea({
        customerId: c.id,
        reason,
        source: 'auto_inactive',
      });
      notifySeaEntered({
        entityType: 'customer',
        entityId: c.id,
        name: c.name,
        recordId: res.record.id,
        previousOwner: c.owner_id,
        label: '客户',
        reason,
      });
      recycled.push(c.id);
    } catch (e) {
      // 单条异常不影响其余客户
    }
  });
  const result = { recycled: recycled.length, customer_ids: recycled };
  logOperation(null, { action: 'RUN_JOB_CUSTOMER_RECYCLE', targetType: 'Job', targetId: 'customer-recycle', detail: result });
  return result;
}

/**
 * 报表订阅推送（按频率）
 * 说明：本期不接入邮件服务，仅生成导出文件并写入 data/subscriptions/，同时更新最后发送时间。
 */
async function runReportSubscriptions() {
  const subs = db.prepare('SELECT * FROM report_subscriptions WHERE is_enabled = 1').all();
  const outDir = path.resolve(__dirname, '../../data/subscriptions');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const sent = [];
  for (const s of subs) {
    const due = isDue(s);
    if (!due) continue;
    const tpl = db.prepare('SELECT * FROM report_templates WHERE id = ?').get(s.template_id);
    const rows = db
      .prepare('SELECT stage_name_snapshot, COUNT(*) AS count FROM opportunities WHERE is_deleted = 0 GROUP BY stage_name_snapshot')
      .all();
    const buf = await buildExcel({
      sheetName: tpl ? tpl.template_name : '报表',
      columns: [
        { header: '阶段名称', key: 'stage_name_snapshot', width: 24 },
        { header: '商机数', key: 'count', width: 12 },
      ],
      rows,
    });
    const file = path.join(outDir, `${s.id}-${now().slice(0, 10)}.xlsx`);
    fs.writeFileSync(file, Buffer.from(buf));
    db.prepare('UPDATE report_subscriptions SET last_sent_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), s.id);
    sent.push({ subscription_id: s.id, file });
  }
  return { generated: sent.length, files: sent };
}

function isDue(s) {
  if (!s.last_sent_at) return true;
  const diff = Date.now() - new Date(s.last_sent_at).getTime();
  if (s.frequency === 'daily') return diff >= DAY;
  if (s.frequency === 'weekly') return diff >= 7 * DAY;
  if (s.frequency === 'monthly') return diff >= 30 * DAY;
  return false;
}

const triggers = {
  'stale-alert': () => runStaleAlertScan(),
  'sea-fallback': () => runSeaFallback(),
  'protection-expire': () => runProtectionExpire(),
  'lead-recycle': () => runLeadRecycle(),
  'customer-recycle': () => runCustomerRecycle(),
  'report-subscribe': () => runReportSubscriptions(),
  'reminder-scan': () => reminderService.scan(),
};

function start() {
  cron.schedule('5 0 * * *', () => {
    try {
      runStaleAlertScan();
    } catch (e) {
      console.error('[JOB stale-alert]', e.message);
    }
  });
  cron.schedule('10 0 * * *', () => {
    try {
      runSeaFallback();
    } catch (e) {
      console.error('[JOB sea-fallback]', e.message);
    }
  });
  cron.schedule('0 * * * *', () => {
    try {
      runProtectionExpire();
    } catch (e) {
      console.error('[JOB protection-expire]', e.message);
    }
  });
  cron.schedule('20 0 * * *', () => {
    try {
      runLeadRecycle();
    } catch (e) {
      console.error('[JOB lead-recycle]', e.message);
    }
  });
  cron.schedule('25 0 * * *', () => {
    try {
      runCustomerRecycle();
    } catch (e) {
      console.error('[JOB customer-recycle]', e.message);
    }
  });
  cron.schedule('0 8 * * *', () => {
    runReportSubscriptions().catch((e) => console.error('[JOB report-subscribe]', e.message));
  });
  // 提醒事项：每分钟扫描一次；服务启动后立即补扫，避免停机期间到点的提醒漏发
  cron.schedule('* * * * *', () => {
    try {
      reminderService.scan();
    } catch (e) {
      console.error('[JOB reminder-scan]', e.message);
    }
  });
  setTimeout(() => {
    try {
      reminderService.scan();
    } catch (e) {
      console.error('[JOB reminder-scan]', e.message);
    }
  }, 5000);
  console.log('定时任务已注册：停滞预警/公海回落/保护期解锁/线索回收/客户回收/报表订阅/提醒事项');
}

module.exports = {
  start, triggers, isDue,
  runStaleAlertScan, runSeaFallback, runProtectionExpire, runLeadRecycle, runCustomerRecycle, runReportSubscriptions,
};
