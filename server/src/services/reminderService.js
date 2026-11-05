'use strict';

/**
 * 提醒事项服务（消息通知中心 / 定时提醒）
 * 设计：
 *  - 提醒时间按服务器本地时间存 "YYYY-MM-DD HH:mm"，由每分钟的定时任务扫描到点触发；
 *  - 触发时写入 notifications（category = todo），dedup_key 按“提醒 + 本次触发时间”去重，保证幂等；
 *  - 行为记录的“下次回访时间”自动同步为提醒（source = activity），保证只有一套提醒体系。
 */
const { db } = require('../db');
const { newId, now, today } = require('../utils/ids');
const { badRequest, notFound } = require('../utils/errors');
const dataScope = require('./dataScope');
const notification = require('./notification');
const { resolveIdentity } = require('../middleware/auth');

const ENTITY_TABLE = { customer: 'customers', opportunity: 'opportunities' };
const ENTITY_LABEL = { customer: '客户', opportunity: '商机', none: '个人' };
const ENTITY_TYPES = ['customer', 'opportunity', 'none'];
const REPEAT_RULES = ['none', 'daily', 'weekly', 'monthly'];
const EDITABLE = ['title', 'content', 'remind_at', 'repeat_rule', 'repeat_until'];

const pad = (n) => String(n).padStart(2, '0');

/** 本地时间文本 YYYY-MM-DD HH:mm */
function localDateTime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 统一成 "YYYY-MM-DD HH:mm"（兼容 ISO、带 T、纯日期） */
function normalizeDateTime(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.includes('Z') || /[+-]\d{2}:\d{2}$/.test(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : localDateTime(d);
  }
  const normalized = text.replace('T', ' ').slice(0, 16);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized) ? normalized : null;
}

/** 在原有时间上按重复规则推进一个周期 */
function advance(remindAt, rule) {
  const d = new Date(`${remindAt.replace(' ', 'T')}:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else if (rule === 'monthly') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  } else return null;
  return localDateTime(d);
}

function requireReminder(user, id) {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ? AND is_deleted = 0').get(id, user.id);
  if (!row) throw notFound('提醒不存在或无权访问');
  return row;
}

function entityNameOf(type, id) {
  const row = db.prepare(`SELECT name FROM ${ENTITY_TABLE[type]} WHERE id = ? AND is_deleted = 0`).get(id);
  return row ? row.name : null;
}

/** 新建提醒（仅本人）；entity_type = none 表示不关联客户/商机的个人提醒 */
function create(user, body) {
  const entityType = String(body.entity_type || 'none');
  if (!ENTITY_TYPES.includes(entityType)) throw badRequest('entity_type 仅支持 customer / opportunity / none');
  let entityId = '';
  if (entityType !== 'none') {
    const entity = dataScope.findScoped(entityType, ENTITY_TABLE[entityType], body.entity_id, user);
    if (!entity) throw notFound('关联客户/商机不存在或无权访问');
    entityId = entity.id;
  }

  const title = String(body.title || '').trim();
  if (!title) throw badRequest('提醒标题不能为空');
  if (title.length > 100) throw badRequest('提醒标题不能超过 100 字');

  const remindAt = normalizeDateTime(body.remind_at);
  if (!remindAt) throw badRequest('提醒时间格式不正确，应为 YYYY-MM-DD HH:mm');
  if (remindAt <= localDateTime()) throw badRequest('提醒时间必须晚于当前时间');

  const repeatRule = REPEAT_RULES.includes(body.repeat_rule) ? body.repeat_rule : 'none';
  const repeatUntil = repeatRule === 'none' ? null : (body.repeat_until ? String(body.repeat_until).slice(0, 10) : null);
  if (repeatUntil && repeatUntil < remindAt.slice(0, 10)) throw badRequest('重复截止日期不能早于提醒日期');

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO reminders (id, user_id, created_by, entity_type, entity_id, title, content, remind_at,
      repeat_rule, repeat_until, source, source_id, status, is_deleted, created_at, updated_at)
     VALUES (@id, @user_id, @created_by, @entity_type, @entity_id, @title, @content, @remind_at,
      @repeat_rule, @repeat_until, 'manual', NULL, 'pending', 0, @t, @t)`
  ).run({
    id,
    user_id: user.id,
    created_by: user.id,
    entity_type: entityType,
    entity_id: entityId,
    title,
    content: body.content ? String(body.content) : null,
    remind_at: remindAt,
    repeat_rule: repeatRule,
    repeat_until: repeatUntil,
    t,
  });
  return getById(user, id);
}

function getById(user, id) {
  return list(user, { id }).list[0] || null;
}

/** 修改提醒（仅待提醒可用） */
function update(user, id, body) {
  const row = requireReminder(user, id);
  if (row.status !== 'pending') throw badRequest('该提醒已触发，不能修改；可调整后重新创建');

  const after = {};
  EDITABLE.forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  if (after.title !== undefined) {
    after.title = String(after.title).trim();
    if (!after.title) throw badRequest('提醒标题不能为空');
    if (after.title.length > 100) throw badRequest('提醒标题不能超过 100 字');
  }
  if (after.remind_at !== undefined) {
    const remindAt = normalizeDateTime(after.remind_at);
    if (!remindAt) throw badRequest('提醒时间格式不正确，应为 YYYY-MM-DD HH:mm');
    if (remindAt <= localDateTime()) throw badRequest('提醒时间必须晚于当前时间');
    after.remind_at = remindAt;
  }
  if (after.repeat_rule !== undefined && !REPEAT_RULES.includes(after.repeat_rule)) {
    throw badRequest('重复规则不合法');
  }
  after.repeat_rule = after.repeat_rule === undefined ? row.repeat_rule : after.repeat_rule;
  if (after.repeat_rule === 'none') after.repeat_until = null;
  else if (after.repeat_until !== undefined) after.repeat_until = after.repeat_until ? String(after.repeat_until).slice(0, 10) : null;

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE reminders SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: row.id, t: now() });
  return getById(user, row.id);
}

function markDone(user, id) {
  const row = requireReminder(user, id);
  if (row.status === 'done' || row.status === 'canceled') throw badRequest('该提醒已结束');
  db.prepare("UPDATE reminders SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), row.id);
  return getById(user, row.id);
}

function cancel(user, id) {
  const row = requireReminder(user, id);
  if (row.status === 'done' || row.status === 'canceled') throw badRequest('该提醒已结束');
  db.prepare("UPDATE reminders SET status = 'canceled', updated_at = ? WHERE id = ?").run(now(), row.id);
  return getById(user, row.id);
}

/** 跳过本次（仅重复提醒）：直接推进到下一周期，不产生通知 */
function skip(user, id) {
  const row = requireReminder(user, id);
  if (row.repeat_rule === 'none') throw badRequest('一次性提醒不支持跳过');
  const next = advance(row.remind_at, row.repeat_rule);
  if (!next) throw badRequest('重复规则不合法');
  if (row.repeat_until && next.slice(0, 10) > row.repeat_until) {
    db.prepare("UPDATE reminders SET status = 'done', updated_at = ? WHERE id = ?").run(now(), row.id);
  } else {
    db.prepare("UPDATE reminders SET remind_at = ?, status = 'pending', updated_at = ? WHERE id = ?").run(next, now(), row.id);
  }
  return getById(user, row.id);
}

function remove(user, id) {
  const row = requireReminder(user, id);
  db.prepare('UPDATE reminders SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  return { id: row.id, deleted: true };
}

/** 列表（仅本人） */
function list(
  user,
  { id, status, entityType, entityId, keyword, overdue, start, end, source, repeatRule, limit = 200, offset = 0 } = {}
) {
  const cond = ['r.user_id = ?', 'r.is_deleted = 0'];
  const params = [user.id];
  if (id) {
    cond.push('r.id = ?');
    params.push(id);
  }
  if (status && status !== 'all') {
    if (status === 'open') cond.push("r.status IN ('pending', 'sent')");
    else {
      cond.push('r.status = ?');
      params.push(status);
    }
  }
  if (entityType) {
    cond.push('r.entity_type = ?');
    params.push(entityType);
    if (entityId) {
      cond.push('r.entity_id = ?');
      params.push(entityId);
    }
  }
  if (keyword) {
    cond.push('r.title LIKE ?');
    params.push(`%${keyword}%`);
  }
  if (overdue) {
    cond.push("r.status IN ('pending', 'sent')", 'r.remind_at < ?');
    params.push(localDateTime());
  }
  if (start) {
    cond.push('r.remind_at >= ?');
    params.push(`${String(start).slice(0, 10)} 00:00`);
  }
  if (end) {
    cond.push('r.remind_at <= ?');
    params.push(`${String(end).slice(0, 10)} 23:59`);
  }
  if (source) {
    cond.push('r.source = ?');
    params.push(source);
  }
  if (repeatRule) {
    cond.push('r.repeat_rule = ?');
    params.push(repeatRule);
  }
  const where = cond.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM reminders r WHERE ${where}`).get(...params).c;
  const rows = db
    .prepare(
      `SELECT r.*, u.name AS creator_name,
        CASE r.entity_type WHEN 'opportunity' THEN o.name WHEN 'customer' THEN c.name END AS entity_name
       FROM reminders r
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN opportunities o ON r.entity_type = 'opportunity' AND o.id = r.entity_id
       LEFT JOIN customers c ON r.entity_type = 'customer' AND c.id = r.entity_id
       WHERE ${where}
       ORDER BY CASE r.status WHEN 'sent' THEN 0 WHEN 'pending' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                r.remind_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const nowText = localDateTime();
  rows.forEach((r) => {
    r.entity_label = ENTITY_LABEL[r.entity_type] || '';
    r.link =
      r.entity_type === 'opportunity'
        ? `/opportunities/${r.entity_id}`
        : r.entity_type === 'customer'
          ? `/customers/${r.entity_id}`
          : null;
    r.overdue = ['pending', 'sent'].includes(r.status) && r.remind_at < nowText;
  });
  return { list: rows, total };
}

/** 今日待办：未完成且提醒时间在今天或已逾期 */
function todayList(user) {
  const endOfDay = `${today()} 23:59`;
  const rows = list(user, { status: 'open' }).list.filter((r) => r.remind_at <= endOfDay);
  return {
    list: rows,
    total: rows.length,
    overdue: rows.filter((r) => r.overdue).length,
  };
}

/** 行为记录的“下次回访时间”→ 提醒（source = activity，幂等） */
function syncFromActivity(activityId) {
  const activity = db
    .prepare(
      `SELECT a.*, c.name AS customer_name, o.name AS opportunity_name
       FROM activities a
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN opportunities o ON o.id = a.opportunity_id
       WHERE a.id = ?`
    )
    .get(activityId);
  if (!activity) return;

  const existing = db
    .prepare("SELECT * FROM reminders WHERE source = 'activity' AND source_id = ? AND is_deleted = 0")
    .get(activity.id);

  if (activity.is_deleted || !activity.follow_up_time || !activity.created_by) {
    if (existing) db.prepare("UPDATE reminders SET status = 'canceled', updated_at = ? WHERE id = ?").run(now(), existing.id);
    return;
  }

  const entityType = activity.opportunity_id ? 'opportunity' : activity.customer_id ? 'customer' : null;
  if (!entityType) return;
  const entityId = entityType === 'opportunity' ? activity.opportunity_id : activity.customer_id;
  const entityName = entityType === 'opportunity' ? activity.opportunity_name : activity.customer_name;
  const remindAt = `${String(activity.follow_up_time).slice(0, 10)} 09:00`;
  const title = `回访提醒：${entityName || ENTITY_LABEL[entityType]}`;

  if (existing) {
    db.prepare(
      `UPDATE reminders SET entity_type = ?, entity_id = ?, title = ?, content = ?, remind_at = ?,
        status = 'pending', done_at = NULL, updated_at = ? WHERE id = ?`
    ).run(entityType, entityId, title, activity.content, remindAt, now(), existing.id);
    return;
  }

  // 仅对仍可访问该客户的用户生成提醒
  const identity = resolveIdentity(activity.created_by);
  if (!identity) return;
  if (!dataScope.findScoped(entityType, ENTITY_TABLE[entityType], entityId, identity)) return;

  const t = now();
  db.prepare(
    `INSERT INTO reminders (id, user_id, created_by, entity_type, entity_id, title, content, remind_at,
      repeat_rule, repeat_until, source, source_id, status, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'none', NULL, 'activity', ?, 'pending', 0, ?, ?)`
  ).run(newId(), activity.created_by, activity.created_by, entityType, entityId, title, activity.content, remindAt, activity.id, t, t);
}

/** 回填最近 7 天内、尚未生成提醒的行为记录（幂等，避免历史数据一次性刷屏） */
function syncRecentActivities() {
  const rows = db
    .prepare(
      `SELECT a.id FROM activities a
       WHERE a.is_deleted = 0 AND a.follow_up_time IS NOT NULL AND a.created_by IS NOT NULL
         AND substr(a.follow_up_time, 1, 10) >= date('now', '-7 day')
         AND NOT EXISTS (
           SELECT 1 FROM reminders r WHERE r.source = 'activity' AND r.source_id = a.id AND r.is_deleted = 0
         )`
    )
    .all();
  rows.forEach((r) => {
    try {
      syncFromActivity(r.id);
    } catch (e) {
      console.error('[REMINDER sync-activity]', r.id, e.message);
    }
  });
}

/** 每分钟扫描：到点写通知，重复提醒自动续期 */
function scan() {
  syncRecentActivities();

  const nowText = localDateTime();
  const due = db.prepare("SELECT * FROM reminders WHERE is_deleted = 0 AND status = 'pending' AND remind_at <= ?").all(nowText);
  let sent = 0;
  let canceled = 0;

  due.forEach((r) => {
    const identity = resolveIdentity(r.user_id);
    if (!identity) {
      db.prepare("UPDATE reminders SET status = 'canceled', updated_at = ? WHERE id = ?").run(now(), r.id);
      canceled += 1;
      return;
    }
    const isPersonal = r.entity_type === 'none';
    if (!isPersonal) {
      const entity = dataScope.findScoped(r.entity_type, ENTITY_TABLE[r.entity_type], r.entity_id, identity);
      if (!entity) {
        db.prepare("UPDATE reminders SET status = 'canceled', updated_at = ? WHERE id = ?").run(now(), r.id);
        canceled += 1;
        return;
      }
    }

    const repeatText = r.repeat_rule === 'none' ? '' : `（重复：${{ daily: '每天', weekly: '每周', monthly: '每月' }[r.repeat_rule]}）`;
    const name = isPersonal ? '' : entityNameOf(r.entity_type, r.entity_id) || ENTITY_LABEL[r.entity_type];
    notification.push(r.user_id, {
      category: 'todo',
      title: `提醒：${r.title}`,
      content: isPersonal
        ? `个人提醒${r.content ? ` · ${r.content}` : ''}${repeatText}`
        : `${ENTITY_LABEL[r.entity_type]}：${name}${r.content ? ` · ${r.content}` : ''}${repeatText}`,
      refType: 'reminder',
      refId: r.id,
      link: isPersonal ? '/notifications?tab=reminders' : r.entity_type === 'opportunity' ? `/opportunities/${r.entity_id}` : `/customers/${r.entity_id}`,
      dedupKey: `todo:${r.id}:${r.remind_at}`,
      createdAt: now(),
    });
    sent += 1;

    if (r.repeat_rule && r.repeat_rule !== 'none') {
      let next = advance(r.remind_at, r.repeat_rule);
      // 停机补偿：连续顺延直到时间晚于当前，避免一次停机后每分钟重复补发
      let guard = 0;
      while (next && next <= nowText && guard < 3660) {
        next = advance(next, r.repeat_rule);
        guard += 1;
      }
      if (next && (!r.repeat_until || next.slice(0, 10) <= r.repeat_until)) {
        db.prepare("UPDATE reminders SET remind_at = ?, updated_at = ? WHERE id = ?").run(next, now(), r.id);
        return;
      }
    }
    db.prepare("UPDATE reminders SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), r.id);
  });

  if (sent || canceled) console.log(`[REMINDER scan] 发送 ${sent} 条，取消 ${canceled} 条`);
  return { sent, canceled };
}

module.exports = {
  create, update, remove, markDone, cancel, skip, list, todayList,
  scan, syncFromActivity, localDateTime,
};
