'use strict';

/** 身份解析中间件：优先 Authorization: Bearer <token>（登录态），兼容请求头 X-User-Id 模拟身份 */
const { db } = require('../db');
const { unauthorized } = require('../utils/errors');
const { now } = require('../utils/ids');

function resolveIdentity(key) {
  const user = db.prepare('SELECT * FROM users WHERE (id = ? OR username = ?) AND is_deleted = 0').get(key, key);
  if (!user) return null;
  if (user.status !== 'enabled') return null;

  const role = user.role_id ? db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role_id) : null;
  const rows = db.prepare('SELECT * FROM role_permissions WHERE role_id = ? AND is_enabled = 1').all(user.role_id);

  const permissions = new Set();
  const dataScopes = {};
  const customScopes = {};
  rows.forEach((r) => {
    if (r.permission_type === 'data') {
      if (!r.resource_type) return;
      dataScopes[r.resource_type] = r.data_scope;
      if (r.scope_config_json) {
        try {
          customScopes[r.resource_type] = JSON.parse(r.scope_config_json);
        } catch (e) {
          customScopes[r.resource_type] = {};
        }
      }
    } else {
      permissions.add(r.permission_code);
    }
  });

  const isAdmin = !!role && role.role_code === 'system_admin';
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role_id: user.role_id,
    role_code: role ? role.role_code : null,
    role_name: role ? role.role_name : null,
    department_id: user.department_id,
    permissions,
    dataScopes,
    customScopes,
    isAdmin,
  };
}

/** 生成会话令牌（登录成功后调用） */
function createSession(userId, loginMode = 'password') {
  const token = require('crypto').randomBytes(32).toString('hex');
  const t = now();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, login_mode, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, userId, loginMode, t, expires, t);
  return { token, expires_at: expires };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** 从请求中解析令牌：Authorization: Bearer <token> */
function bearerToken(req) {
  const raw = req.header('Authorization') || '';
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

function auth(req, res, next) {
  const token = bearerToken(req);
  let key = null;

  if (token) {
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) return next(unauthorized('登录已失效，请重新登录'));
    if (session.expires_at && session.expires_at < now()) {
      destroySession(token);
      return next(unauthorized('登录已过期，请重新登录'));
    }
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(now(), token);
    key = session.user_id;
    req.sessionToken = token;
  } else {
    // 开发模式：请求头 X-User-Id（可用 username 或用户 id，如 admin）
    key = req.header('X-User-Id') || req.query._uid;
  }

  if (!key) {
    return next(unauthorized('缺少身份信息：请先登录，或携带请求头 X-User-Id（如 admin）'));
  }
  const identity = resolveIdentity(key);
  if (!identity) return next(unauthorized(`未找到可用用户：${key}`));
  req.user = identity;
  next();
}

module.exports = { auth, resolveIdentity, createSession, destroySession, bearerToken };
