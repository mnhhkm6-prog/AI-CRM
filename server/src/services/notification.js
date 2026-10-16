'use strict';

/**
 * 消息通知中心服务（P03 / 8.7）
 * 设计：不改动业务模块，读取时从既有的预警、审批、回访提醒等来源"惰性同步"到 notifications 表；
 *      以 dedup_key 保证幂等，已读状态持久化在表中。
 */
const { db } = require('../db');
const { newId, now, today } = require('../utils/ids');

/** 审批人集合：管理层 + 系统管理员 */
function approverIds() {
  return db
    .prepare(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.is_deleted = 0 AND u.status = 'enabled' AND r.role_code IN ('management', 'system_admin')`
    )
    .all()
    .map((r) => r.id);
}

function upsert(userId, item) {
  if (!userId || !item.dedupKey) return;
  const exists = db.prepare('SELECT id FROM notifications WHERE dedup_key = ?').get(item.dedupKey);
  if (exists) return;
  db.prepare(
    `INSERT INTO notifications (id, user_id, category, title, content, ref_type, ref_id, link, dedup_key, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    newId(),
    userId,
    item.category,
    item.title,
    item.content || null,
    item.refType || null,
    item.refId || null,
    item.link || null,
    item.dedupKey,
    item.createdAt || now()
  );
}

function syncForUser(user) {
  const approvers = approverIds();

  // 1) 停滞预警 → 通知商机负责人
  const alerts = db
    .prepare(
      `SELECT sa.id, sa.alert_level, sa.days_stagnant, sa.triggered_at, o.id AS opp_id, o.name AS opp_name, o.owner_id
       FROM stale_alerts sa JOIN opportunities o ON o.id = sa.opportunity_id
       WHERE sa.is_resolved = 0 AND o.is_deleted = 0 AND o.owner_id = ?`
    )
    .all(user.id);
  alerts.forEach((a) => {
    upsert(user.id, {
      category: 'alert',
      title: `商机「${a.opp_name}」停滞预警（${a.alert_level} 级）`,
      content: `已停滞 ${a.days_stagnant} 天，请及时推进或提交停滞说明`,
      refType: 'opportunity',
      refId: a.opp_id,
      link: `/opportunities/${a.opp_id}`,
      dedupKey: `alert:${a.id}:${user.id}`,
      createdAt: a.triggered_at,
    });
  });

  // 2) 失效申请待审批 → 通知审批人
  if (approvers.includes(user.id)) {
    const losses = db
      .prepare(
        `SELECT lr.id, lr.created_at, o.id AS opp_id, o.name AS opp_name
         FROM loss_records lr JOIN opportunities o ON o.id = lr.opportunity_id
         WHERE lr.approval_status = 'pending'`
      )
      .all();
    losses.forEach((l) => {
      upsert(user.id, {
        category: 'approval',
        title: `失效申请待审批：${l.opp_name}`,
        content: '请到审批中心处理商机失效申请',
        refType: 'loss_record',
        refId: l.id,
        link: '/approvals',
        dedupKey: `approval:loss:${l.id}:${user.id}`,
        createdAt: l.created_at,
      });
    });

    // 3) 停滞说明待审批 → 通知审批人
    const explains = db
      .prepare(
        `SELECT se.id, se.created_at, se.expected_date, o.id AS opp_id, o.name AS opp_name
         FROM stagnation_explains se JOIN opportunities o ON o.id = se.opportunity_id
         WHERE se.status = 'pending'`
      )
      .all();
    explains.forEach((e) => {
      upsert(user.id, {
        category: 'approval',
        title: `停滞说明待审批：${e.opp_name}`,
        content: `预计解决日期 ${e.expected_date || '—'}`,
        refType: 'stagnation_explain',
        refId: e.id,
        link: '/approvals',
        dedupKey: `approval:stag:${e.id}:${user.id}`,
        createdAt: e.created_at,
      });
    });
  }

  // 4) 失效/停滞说明审批结果 → 通知提交人
  const lossResults = db
    .prepare(
      `SELECT lr.id, lr.approval_status, lr.approved_at, o.id AS opp_id, o.name AS opp_name
       FROM loss_records lr JOIN opportunities o ON o.id = lr.opportunity_id
       WHERE lr.submitted_by = ? AND lr.approval_status IN ('approved', 'rejected')`
    )
    .all(user.id);
  lossResults.forEach((l) => {
    upsert(user.id, {
      category: 'approval',
      title: `失效申请${l.approval_status === 'approved' ? '已通过' : '被驳回'}：${l.opp_name}`,
      content: l.approval_status === 'approved' ? '商机已标记为失效' : '请补充材料后重新提交',
      refType: 'loss_record',
      refId: l.id,
      link: `/opportunities/${l.opp_id}`,
      dedupKey: `loss-result:${l.id}:${l.approval_status}`,
      createdAt: l.approved_at,
    });
  });
  const stagResults = db
    .prepare(
      `SELECT se.id, se.status, se.approved_at, o.id AS opp_id, o.name AS opp_name
       FROM stagnation_explains se JOIN opportunities o ON o.id = se.opportunity_id
       WHERE se.submitted_by = ? AND se.status IN ('approved', 'rejected')`
    )
    .all(user.id);
  stagResults.forEach((e) => {
    upsert(user.id, {
      category: 'approval',
      title: `停滞说明${e.status === 'approved' ? '已通过' : '被驳回'}：${e.opp_name}`,
      content: e.status === 'approved' ? '已计入有效的停滞延期' : '请重新提交说明',
      refType: 'stagnation_explain',
      refId: e.id,
      link: `/opportunities/${e.opp_id}`,
      dedupKey: `stag-result:${e.id}:${e.status}`,
      createdAt: e.approved_at,
    });
  });

  // 5) 回访提醒（M4-R3）→ 通知行为记录创建人
  const reminders = db
    .prepare(
      `SELECT a.id, a.activity_time, a.follow_up_time, a.content, a.customer_id, c.name AS customer_name
       FROM activities a LEFT JOIN customers c ON c.id = a.customer_id
       WHERE a.is_deleted = 0 AND a.created_by = ? AND a.follow_up_time IS NOT NULL
             AND substr(a.follow_up_time, 1, 10) <= ?`
    )
    .all(user.id, today());
  reminders.forEach((a) => {
    upsert(user.id, {
      category: 'reminder',
      title: `回访提醒：${a.customer_name || '客户'} 待回访`,
      content: a.content,
      refType: 'activity',
      refId: a.id,
      link: '/activities',
      dedupKey: `reminder:activity:${a.id}`,
      createdAt: a.follow_up_time,
    });
  });
}

/** 列表（按未读优先、时间倒序） */
function list(user, { category, isRead, limit = 50, offset = 0 }) {
  const cond = ['user_id = ?'];
  const params = [user.id];
  if (category) {
    cond.push('category = ?');
    params.push(category);
  }
  if (isRead !== undefined && isRead !== null && isRead !== '') {
    cond.push('is_read = ?');
    params.push(isRead === true || isRead === 'true' || isRead === 1 || isRead === '1' ? 1 : 0);
  }
  const where = cond.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE ${where}`).get(...params).c;
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY is_read ASC, created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { rows, total };
}

function unreadCount(user) {
  return db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
}

function markRead(user, id) {
  db.prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ?').run(now(), id, user.id);
}

function markAllRead(user) {
  const r = db
    .prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0')
    .run(now(), user.id);
  return r.changes;
}

module.exports = { syncForUser, list, unreadCount, markRead, markAllRead };
