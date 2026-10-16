'use strict';

/**
 * M10 系统管理与权限（P28–P32）
 * 覆盖：当前身份、用户管理、部门管理、系统配置、登录方式、数据备份、操作日志、健康检查
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const { db, DB_FILE, DATA_DIR } = require('../db');
const { ok, created, getPaging, paged, buildSort, requireString, optional, bodyOf } = require('../utils/http');
const { badRequest, notFound, conflict, unauthorized } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const { createSession, destroySession } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/password');
const configService = require('../services/configService');
const org = require('../services/org');
const { logOperation } = require('../services/operationLog');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const USER_FIELDS = ['name', 'role_id', 'department_id', 'phone', 'email'];

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ---------------------------------------------------------------- 身份
router.get('/me', (req, res) => {
  ok(res, {
    id: req.user.id,
    username: req.user.username,
    name: req.user.name,
    role_id: req.user.role_id,
    role_code: req.user.role_code,
    role_name: req.user.role_name,
    department_id: req.user.department_id,
    is_admin: req.user.isAdmin,
    permissions: Array.from(req.user.permissions).sort(),
    data_scopes: req.user.dataScopes,
  });
});

/** 登录页所需的公开配置（无需登录） */
router.get('/auth/login-config', (req, res) => {
  ok(res, {
    login_mode: configService.get('login_mode', 'password'),
    company_name: configService.get('company_name', '自研 CRM'),
  });
});

/** 登录（P01 登录页）；返回会话令牌，前端以 Authorization: Bearer <token> 访问 */
router.post('/auth/login', (req, res) => {
  const body = bodyOf(req);
  const username = requireString(body, 'username', '账号').trim();
  const password = requireString(body, 'password', '密码');

  const mode = configService.get('login_mode', 'password');
  if (mode === 'ad_ldap') {
    throw badRequest('当前已启用 AD/LDAP 域账号登录，请使用域账号登录入口');
  }

  const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_deleted = 0').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw unauthorized('账号或密码错误');
  }
  if (row.status !== 'enabled') throw unauthorized('账号已被停用，请联系管理员');

  const session = createSession(row.id, mode);
  req.user = { id: row.id, name: row.name };  // 供操作日志记录登录人
  logOperation(req, { action: 'LOGIN', targetType: 'User', targetId: row.id, detail: { username }, logType: 'config' });
  ok(res, {
    token: session.token,
    expires_at: session.expires_at,
    user: { id: row.id, username: row.username, name: row.name },
  });
});

/** 退出登录 */
router.post('/auth/logout', (req, res) => {
  destroySession(req.sessionToken);
  ok(res, { success: true });
});

/** 修改本人密码 */
router.put('/auth/password', (req, res) => {
  const body = bodyOf(req);
  const oldPassword = requireString(body, 'old_password', '原密码');
  const newPassword = requireString(body, 'new_password', '新密码');
  if (String(newPassword).length < 6) throw badRequest('新密码长度不得少于 6 位');

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row || !verifyPassword(oldPassword, row.password_hash)) throw badRequest('原密码不正确');

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(newPassword), now(), req.user.id);
  logOperation(req, { action: 'CHANGE_PASSWORD', targetType: 'User', targetId: req.user.id, logType: 'config' });
  ok(res, { success: true });
});

// ---------------------------------------------------------------- 用户管理
router.get('/users', requirePermission('user:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['u.is_deleted = 0'];
  const params = [];
  if (req.query.keyword) {
    conditions.push('(u.username LIKE ? OR u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)');
    const kw = `%${req.query.keyword}%`;
    params.push(kw, kw, kw, kw);
  }
  if (req.query.role_id) {
    conditions.push('u.role_id = ?');
    params.push(req.query.role_id);
  }
  if (req.query.department_id) {
    conditions.push('u.department_id = ?');
    params.push(req.query.department_id);
  }
  if (req.query.status) {
    conditions.push('u.status = ?');
    params.push(req.query.status);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM users u WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, ['created_at', 'username', 'name'], 'created_at', 'u');
  const list = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.role_id, u.department_id, u.phone, u.email, u.status, u.created_at, u.updated_at,
              r.role_name, d.name AS department_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

router.post('/users', requirePermission('user:manage'), (req, res) => {
  const body = bodyOf(req);
  const username = requireString(body, 'username', '用户名');
  const name = requireString(body, 'name', '姓名');
  const password = requireString(body, 'password', '密码');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    throw conflict(`用户名「${username}」已存在`);
  }
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role_id, department_id, phone, email, status, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled', 0, ?, ?)`
  ).run(
    id, username, name, hashPassword(password),
    optional(body, 'role_id'), optional(body, 'department_id'), optional(body, 'phone'), optional(body, 'email'), t, t
  );
  logOperation(req, { action: 'CREATE_USER', targetType: 'User', targetId: id, detail: { username } });
  created(res, db.prepare('SELECT id, username, name, role_id, department_id, phone, email, status, created_at FROM users WHERE id = ?').get(id));
});

router.get('/users/:id', requirePermission('user:view'), (req, res) => {
  const user = db
    .prepare('SELECT id, username, name, role_id, department_id, phone, email, status, created_at, updated_at FROM users WHERE id = ? AND is_deleted = 0')
    .get(req.params.id);
  if (!user) throw notFound('用户不存在');
  user.role_name = user.role_id ? (db.prepare('SELECT role_name FROM roles WHERE id = ?').get(user.role_id) || {}).role_name : null;
  user.department_name = user.department_id ? (db.prepare('SELECT name FROM departments WHERE id = ?').get(user.department_id) || {}).name : null;
  ok(res, user);
});

router.put('/users/:id', requirePermission('user:manage'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!user) throw notFound('用户不存在');
  const body = bodyOf(req);
  const fields = {};
  USER_FIELDS.forEach((f) => {
    if (body[f] !== undefined) fields[f] = body[f];
  });
  if (!Object.keys(fields).length) throw badRequest('没有可更新的字段');
  const sets = Object.keys(fields).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE users SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...fields, id: user.id, t: now() });
  logOperation(req, { action: 'UPDATE_USER', targetType: 'User', targetId: user.id, detail: fields });
  ok(res, db.prepare('SELECT id, username, name, role_id, department_id, phone, email, status, created_at, updated_at FROM users WHERE id = ?').get(user.id));
});

router.post('/users/:id/disable', requirePermission('user:manage'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!user) throw notFound('用户不存在');
  const status = String(bodyOf(req).status || '');
  if (!['enabled', 'disabled'].includes(status)) throw badRequest('status 仅支持 enabled / disabled');
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), user.id);
  logOperation(req, { action: 'TOGGLE_USER_STATUS', targetType: 'User', targetId: user.id, detail: { status } });
  ok(res, db.prepare('SELECT id, username, name, status FROM users WHERE id = ?').get(user.id));
});

router.post('/users/:id/reset-password', requirePermission('user:manage'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!user) throw notFound('用户不存在');
  const newPassword = requireString(bodyOf(req), 'new_password', '新密码');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(newPassword), now(), user.id);
  logOperation(req, { action: 'RESET_USER_PASSWORD', targetType: 'User', targetId: user.id });
  ok(res, { id: user.id, reset: true });
});

// ---------------------------------------------------------------- 部门管理
router.get('/departments', requirePermission('user:view'), (req, res) => {
  ok(res, org.departmentTree());
});

router.post('/departments', requirePermission('user:manage'), (req, res) => {
  const body = bodyOf(req);
  const name = requireString(body, 'name', '部门名称');
  const parentId = optional(body, 'parent_id');
  if (parentId && !db.prepare('SELECT id FROM departments WHERE id = ? AND is_deleted = 0').get(parentId)) {
    throw notFound('上级部门不存在');
  }
  const id = newId();
  const t = now();
  db.prepare(
    'INSERT INTO departments (id, name, parent_id, sort_order, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(id, name, parentId, Number(body.sort_order) || 0, t, t);
  logOperation(req, { action: 'CREATE_DEPARTMENT', targetType: 'Department', targetId: id, detail: { name } });
  created(res, db.prepare('SELECT * FROM departments WHERE id = ?').get(id));
});

router.put('/departments/:id', requirePermission('user:manage'), (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!dept) throw notFound('部门不存在');
  const body = bodyOf(req);
  const fields = {};
  if (body.name !== undefined) fields.name = body.name;
  if (body.parent_id !== undefined) fields.parent_id = body.parent_id;
  if (body.sort_order !== undefined) fields.sort_order = Number(body.sort_order) || 0;
  if (!Object.keys(fields).length) throw badRequest('没有可更新的字段');
  const sets = Object.keys(fields).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE departments SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...fields, id: dept.id, t: now() });
  logOperation(req, { action: 'UPDATE_DEPARTMENT', targetType: 'Department', targetId: dept.id, detail: fields });
  ok(res, db.prepare('SELECT * FROM departments WHERE id = ?').get(dept.id));
});

router.delete('/departments/:id', requirePermission('user:manage'), (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!dept) throw notFound('部门不存在');
  const children = db.prepare('SELECT COUNT(*) c FROM departments WHERE parent_id = ? AND is_deleted = 0').get(dept.id).c;
  if (children > 0) throw conflict(`该部门下存在 ${children} 个下级部门，无法删除`);
  const members = db.prepare('SELECT COUNT(*) c FROM users WHERE department_id = ? AND is_deleted = 0').get(dept.id).c;
  if (members > 0) throw conflict(`该部门下存在 ${members} 名成员，无法删除`);
  db.prepare('UPDATE departments SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), dept.id);
  logOperation(req, { action: 'DELETE_DEPARTMENT', targetType: 'Department', targetId: dept.id, detail: { name: dept.name } });
  ok(res, { id: dept.id, deleted: true });
});

// ---------------------------------------------------------------- 系统配置
router.get('/system/configs', requirePermission('system_config:view'), (req, res) => {
  ok(res, req.query.config_group ? configService.group(req.query.config_group) : configService.all());
});

// ⚠️ 静态子路径 /system/configs/sea 必须写在 /system/configs/:key 之前
router.get('/system/configs/sea', requirePermission('system_config:view'), (req, res) => {
  ok(res, configService.seaRules());
});

router.put('/system/configs/sea', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const map = {
    protection_days: 'sea_protection_days',
    is_pickup_mode: 'sea_pickup_mode',
    personal_max: 'sea_personal_max',
    daily_pickup_max: 'sea_daily_pickup_max',
    lead_recycle_days: 'lead_unconverted_recycle_days',
    fallback_days_after_alert: 'sea_fallback_days_after_alert',
  };
  const applied = [];
  Object.entries(map).forEach(([field, key]) => {
    if (body[field] === undefined) return;
    configService.set(key, body[field], req.user.id, { createIfMissing: true });
    applied.push(key);
  });
  if (!applied.length) throw badRequest('没有可更新的公海规则字段');
  logOperation(req, { action: 'UPDATE_SEA_RULES', targetType: 'SystemConfig', targetId: 'sea', detail: body, logType: 'config' });
  ok(res, configService.seaRules());
});

router.get('/system/login-config', requirePermission('system_config:view'), (req, res) => {
  ok(res, { mode: configService.get('login_mode', 'password'), ad_ldap: configService.get('ad_ldap_config', {}) });
});

router.put('/system/login-config', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const mode = String(body.mode || '');
  if (!['password', 'ad_ldap'].includes(mode)) throw badRequest('mode 仅支持 password / ad_ldap');
  configService.set('login_mode', mode, req.user.id, { createIfMissing: true });
  if (body.ad_ldap !== undefined) configService.set('ad_ldap_config', body.ad_ldap, req.user.id, { createIfMissing: true });
  logOperation(req, { action: 'UPDATE_LOGIN_CONFIG', targetType: 'SystemConfig', targetId: 'login_mode', detail: { mode }, logType: 'config' });
  ok(res, { mode, ad_ldap: configService.get('ad_ldap_config', {}) });
});

router.put('/system/configs', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw badRequest('items 为必填数组');
  const applied = [];
  items.forEach((it) => {
    if (!it || !it.config_key) return;
    applied.push(configService.set(it.config_key, it.config_value, req.user.id, { createIfMissing: false }));
  });
  logOperation(req, {
    action: 'BATCH_UPDATE_SYSTEM_CONFIG',
    targetType: 'SystemConfig',
    targetId: null,
    detail: { keys: items.map((i) => i.config_key) },
    logType: 'config',
  });
  ok(res, applied);
});

router.put('/system/configs/:key', requirePermission('system_config:manage'), (req, res) => {
  const body = bodyOf(req);
  if (body.config_value === undefined) throw badRequest('config_value 为必填项');
  const row = configService.set(req.params.key, body.config_value, req.user.id, { createIfMissing: false });
  logOperation(req, {
    action: 'UPDATE_SYSTEM_CONFIG',
    targetType: 'SystemConfig',
    targetId: row.id,
    detail: { config_key: req.params.key, config_value: body.config_value },
    logType: 'config',
  });
  ok(res, row);
});

// ---------------------------------------------------------------- 数据备份
router.get('/system/backups', requirePermission('system_config:view'), (req, res) => {
  const list = db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 100').all();
  ok(res, list);
});

router.post('/system/backups', requirePermission('system_config:manage'), (req, res) => {
  ensureBackupDir();
  const id = newId();
  const t = now();
  const file = path.join(BACKUP_DIR, `crm-${t.replace(/[:.]/g, '-')}.db`);
  fs.copyFileSync(DB_FILE, file);
  const size = fs.statSync(file).size;
  db.prepare(
    'INSERT INTO backups (id, file_path, file_size, backup_type, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, file, size, 'manual', 'success', req.user.id, t);
  logOperation(req, { action: 'CREATE_BACKUP', targetType: 'Backup', targetId: id, detail: { file }, logType: 'config' });
  created(res, db.prepare('SELECT * FROM backups WHERE id = ?').get(id));
});

router.post('/system/backups/:id/restore', requirePermission('system_config:manage'), (req, res) => {
  const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!backup) throw notFound('备份记录不存在');
  if (!backup.file_path || !fs.existsSync(backup.file_path)) throw notFound('备份文件不存在或已被移除');
  try {
    fs.copyFileSync(backup.file_path, DB_FILE);
  } catch (e) {
    throw badRequest(`恢复失败（生产环境需停机恢复）：${e.message}`);
  }
  logOperation(req, { action: 'RESTORE_BACKUP', targetType: 'Backup', targetId: backup.id, detail: { file: backup.file_path }, logType: 'config' });
  ok(res, { id: backup.id, restored: true, note: '数据库文件已回写，建议重启服务以生效' });
});

// ---------------------------------------------------------------- 操作日志
router.get('/operation-logs', requirePermission('operation_log:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['1 = 1'];
  const params = [];
  if (req.query.user_id) {
    conditions.push('l.user_id = ?');
    params.push(req.query.user_id);
  }
  if (req.query.type) {
    conditions.push('l.log_type = ?');
    params.push(req.query.type);
  }
  if (req.query.start_date) {
    conditions.push('l.created_at >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('l.created_at <= ?');
    params.push(`${req.query.end_date}T23:59:59.999Z`);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM operation_logs l WHERE ${where}`).get(...params).c;
  const list = db
    .prepare(`SELECT l.* FROM operation_logs l WHERE ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

// ---------------------------------------------------------------- 健康检查
router.get('/health', (req, res) => {
  let dbOk = true;
  try {
    db.prepare('SELECT 1').get();
  } catch (e) {
    dbOk = false;
  }
  // eslint-disable-next-line global-require
  const jobs = require('../jobs');
  ok(res, { status: dbOk ? 'ok' : 'degraded', db: DB_FILE, jobs: Object.keys(jobs.triggers) });
});

module.exports = router;
