'use strict';

/**
 * 全局能力：顶栏全局搜索（2.4）、消息通知中心（P03 / 8.7）、审批中心（P04）
 * 说明：本模块聚合既有业务数据，不重复落库；通知经 notifications 表惰性同步并持久化已读状态。
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, getPaging, paged } = require('../utils/http');
const { notFound } = require('../utils/errors');
const { requireAnyPermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const notification = require('../services/notification');

// ---------------------------------------------------------------- 全局搜索
router.get('/search', (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  if (keyword.length < 2) {
    return ok(res, { keyword, customers: [], leads: [], opportunities: [], contacts: [] });
  }
  const like = `%${keyword}%`;

  const cs = dataScope.scopeFragment(req.user, 'customer');
  const ls = dataScope.scopeFragment(req.user, 'lead');
  const os = dataScope.scopeFragment(req.user, 'opportunity');

  const customers = db
    .prepare(`SELECT id, name, level, status FROM customers WHERE is_deleted = 0 AND name LIKE ?${cs.sql} ORDER BY updated_at DESC LIMIT ?`)
    .all(like, ...cs.params, limit);

  const leads = db
    .prepare(`SELECT id, name, status, source_channel FROM leads WHERE is_deleted = 0 AND name LIKE ?${ls.sql} ORDER BY updated_at DESC LIMIT ?`)
    .all(like, ...ls.params, limit);

  const opportunities = db
    .prepare(
      `SELECT id, customer_id, name, status, stage_name_snapshot, amount FROM opportunities
       WHERE is_deleted = 0 AND name LIKE ?${os.sql} ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, ...os.params, limit);

  // 联系人按所属客户的数据权限过滤
  const ctScope = dataScope.scopeFragment(req.user, 'customer', 'c.owner_id');
  const contacts = db
    .prepare(
      `SELECT ct.id, ct.name, ct.phone, ct.customer_id, c.name AS customer_name
       FROM contacts ct JOIN customers c ON c.id = ct.customer_id
       WHERE ct.is_deleted = 0 AND (ct.name LIKE ? OR ct.phone LIKE ?)${ctScope.sql}
       ORDER BY ct.updated_at DESC LIMIT ?`
    )
    .all(like, like, ...ctScope.params, limit);

  return ok(res, { keyword, customers, leads, opportunities, contacts });
});

// ---------------------------------------------------------------- 消息通知中心
router.get('/notifications', (req, res) => {
  notification.syncForUser(req.user);
  const paging = getPaging(req);
  const { rows, total } = notification.list(req.user, {
    category: req.query.category,
    isRead: req.query.is_read,
    limit: paging.limit,
    offset: paging.offset,
  });
  ok(res, {
    ...paged(rows, total, paging),
    unread: notification.unreadCount(req.user),
  });
});

router.get('/notifications/unread-count', (req, res) => {
  notification.syncForUser(req.user);
  ok(res, { unread: notification.unreadCount(req.user) });
});

router.post('/notifications/read-all', (req, res) => {
  ok(res, { updated: notification.markAllRead(req.user) });
});

router.post('/notifications/:id/read', (req, res) => {
  const row = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) throw notFound('消息不存在');
  notification.markRead(req.user, req.params.id);
  ok(res, { id: req.params.id, is_read: 1 });
});

// ---------------------------------------------------------------- 审批中心（P04）
/** 统一映射：失效申请 / 停滞说明延期申请 */
function mapLoss(row) {
  return {
    type: 'loss',
    id: row.id,
    opportunity_id: row.opportunity_id,
    opportunity_name: row.opportunity_name,
    customer_name: row.customer_name,
    status: row.approval_status,
    summary: row.loss_reason,
    detail: row.loss_detail,
    applicant_id: row.submitted_by,
    applicant_name: row.submitter_name,
    approver_name: row.approver_name,
    comment: row.approve_comment,
    created_at: row.created_at,
    approved_at: row.approved_at,
  };
}

function mapStagnation(row) {
  return {
    type: 'stagnation',
    id: row.id,
    opportunity_id: row.opportunity_id,
    opportunity_name: row.opportunity_name,
    customer_name: row.customer_name,
    status: row.status,
    summary: row.reason,
    detail: row.detail,
    extra: { expected_date: row.expected_date },
    applicant_id: row.submitted_by,
    applicant_name: row.submitter_name,
    approver_name: row.approver_name,
    comment: row.approve_comment,
    created_at: row.created_at,
    approved_at: row.approved_at,
  };
}

router.get('/approvals', requireAnyPermission(['loss:view', 'alert:view']), (req, res) => {
  const status = String(req.query.status || 'pending');
  const type = String(req.query.type || '');
  const paging = getPaging(req);
  const items = [];

  const isApprover = req.user.isAdmin || ['management'].includes(req.user.role_code);

  if (type !== 'stagnation') {
    const cond = ['1 = 1'];
    const params = [];
    if (status === 'pending') {
      cond.push("lr.approval_status = 'pending'");
    } else if (status === 'done') {
      cond.push("lr.approval_status IN ('approved', 'rejected')");
    } else if (status !== 'all') {
      cond.push('lr.approval_status = ?');
      params.push(status);
    }
    // 待办仅审批人可见；已办仅本人处理的可见（管理员/管理层看全部）
    if (!isApprover) {
      if (status === 'pending') cond.push('1 = 0');
      else cond.push('lr.submitted_by = ?'), params.push(req.user.id);
    } else if (status === 'done') {
      cond.push('lr.approved_by = ?');
      params.push(req.user.id);
    }
    const rows = db
      .prepare(
        `SELECT lr.*, o.name AS opportunity_name, c.name AS customer_name,
                su.name AS submitter_name, au.name AS approver_name
         FROM loss_records lr
         JOIN opportunities o ON o.id = lr.opportunity_id
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN users su ON su.id = lr.submitted_by
         LEFT JOIN users au ON au.id = lr.approved_by
         WHERE ${cond.join(' AND ')}`
      )
      .all(...params);
    rows.forEach((r) => items.push(mapLoss(r)));
  }

  if (type !== 'loss') {
    const cond = ['1 = 1'];
    const params = [];
    if (status === 'pending') {
      cond.push("se.status = 'pending'");
    } else if (status === 'done') {
      cond.push("se.status IN ('approved', 'rejected')");
    } else if (status !== 'all') {
      cond.push('se.status = ?');
      params.push(status);
    }
    if (!isApprover) {
      if (status === 'pending') cond.push('1 = 0');
      else cond.push('se.submitted_by = ?'), params.push(req.user.id);
    } else if (status === 'done') {
      cond.push('se.approver_id = ?');
      params.push(req.user.id);
    }
    const rows = db
      .prepare(
        `SELECT se.*, o.name AS opportunity_name, c.name AS customer_name,
                su.name AS submitter_name, au.name AS approver_name
         FROM stagnation_explains se
         JOIN opportunities o ON o.id = se.opportunity_id
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN users su ON su.id = se.submitted_by
         LEFT JOIN users au ON au.id = se.approver_id
         WHERE ${cond.join(' AND ')}`
      )
      .all(...params);
    rows.forEach((r) => items.push(mapStagnation(r)));
  }

  items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const total = items.length;
  const pageList = items.slice(paging.offset, paging.offset + paging.limit);
  ok(res, paged(pageList, total, paging));
});

router.get('/approvals/summary', (req, res) => {
  const isApprover = req.user.isAdmin || ['management'].includes(req.user.role_code);
  let lossPending = 0;
  let stagPending = 0;
  let myDone = 0;
  if (isApprover) {
    lossPending = db.prepare("SELECT COUNT(*) c FROM loss_records WHERE approval_status = 'pending'").get().c;
    stagPending = db.prepare("SELECT COUNT(*) c FROM stagnation_explains WHERE status = 'pending'").get().c;
    myDone =
      db.prepare("SELECT COUNT(*) c FROM loss_records WHERE approved_by = ? AND approval_status IN ('approved','rejected')").get(req.user.id).c +
      db.prepare("SELECT COUNT(*) c FROM stagnation_explains WHERE approver_id = ? AND status IN ('approved','rejected')").get(req.user.id).c;
  }
  const mySubmitted = db
    .prepare("SELECT COUNT(*) c FROM loss_records WHERE submitted_by = ? AND approval_status = 'pending'")
    .get(req.user.id).c;
  ok(res, {
    pending: lossPending + stagPending,
    loss_pending: lossPending,
    stagnation_pending: stagPending,
    done: myDone,
    my_pending_submissions: mySubmitted,
    can_approve: isApprover,
  });
});

module.exports = router;
