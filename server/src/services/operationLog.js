'use strict';

const { db } = require('../db');
const { newId, now } = require('../utils/ids');

/**
 * 关键操作审计（PRD 11.2.18，保留 ≥180 天）
 * @param {object} req express 请求，或形如 { user } 的上下文（定时任务/服务层调用）
 */
function logOperation(req, { action, targetType, targetId, detail = null, logType = 'business' }) {
  if (!action || !targetType) return;
  const user = req && req.user ? req.user : null;
  const headers = req && req.headers ? req.headers : {};
  db.prepare(
    `INSERT INTO operation_logs (id, user_id, user_name, log_type, action, target_type, target_id, detail_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    user ? user.id : null,
    user ? user.name : 'system',
    logType,
    action,
    targetType,
    targetId || null,
    detail ? JSON.stringify(detail) : null,
    (req && (req.ip || headers['x-forwarded-for'])) || null,
    now()
  );
}

/** 记录某对象的字段变更明细（旧值/新值），供操作日志与客户历史复用 */
function diffFields(before, after, fields) {
  const changed = {};
  fields.forEach((f) => {
    const b = before ? before[f] : undefined;
    const a = after ? after[f] : undefined;
    if (a !== undefined && JSON.stringify(b !== undefined ? b : null) !== JSON.stringify(a !== undefined ? a : null)) {
      changed[f] = { before: b === undefined ? null : b, after: a === undefined ? null : a };
    }
  });
  return changed;
}

module.exports = { logOperation, diffFields };
