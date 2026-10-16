'use strict';

/**
 * M13 角色与权限配置管理（P39/P40，M13-R1~R5）
 * 覆盖：角色 CRUD/复制、功能权限矩阵、数据权限五级范围、变更影响预览、角色成员
 */
const express = require('express');

const router = express.Router();
const { db } = require('../db');
const { ok, created, requireString, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, conflict, CODE } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const { logOperation } = require('../services/operationLog');
const { SCOPED_RESOURCES } = require('../constants/permissions');

// 数据权限五级范围
const DATA_SCOPES = ['self', 'department', 'sub_department', 'all', 'custom'];

const getRole = (id) => db.prepare('SELECT * FROM roles WHERE id = ?').get(id) || null;
const needRole = (id) => {
  const role = getRole(id);
  if (!role) throw notFound('角色不存在');
  return role;
};

/** 角色成员数量 */
const memberCount = (roleId) =>
  db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ? AND is_deleted = 0').get(roleId).c;

/** 新增角色（M13-R2）。role_code 未传则用 custom_时间戳 */
function insertRole({ roleCode, roleName, description, sortOrder, isSystem }) {
  const dup = db.prepare('SELECT id FROM roles WHERE role_code = ?').get(roleCode);
  if (dup) throw badRequest(`角色编码已存在：${roleCode}`);
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO roles (id, role_code, role_name, role_type, description, sort_order, is_system, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'custom', ?, ?, ?, 1, ?, ?)`
  ).run(id, roleCode, roleName, description || null, sortOrder, isSystem ? 1 : 0, t, t);
  return id;
}

/** 角色列表（M13-R1）：附带权限数量与成员数量 */
router.get('/roles', requirePermission('role:view'), (req, res) => {
  const conditions = [];
  const params = [];
  if (req.query.is_enabled !== undefined) {
    conditions.push('is_enabled = ?');
    params.push(req.query.is_enabled === 'true' || req.query.is_enabled === '1' ? 1 : 0);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const roles = db.prepare(`SELECT * FROM roles${where} ORDER BY sort_order, created_at`).all(...params);

  const permCounts = {};
  db.prepare(
    "SELECT role_id, COUNT(*) c FROM role_permissions WHERE permission_type = 'function' AND is_enabled = 1 GROUP BY role_id"
  ).all().forEach((r) => { permCounts[r.role_id] = r.c; });
  const memberCounts = {};
  db.prepare('SELECT role_id, COUNT(*) c FROM users WHERE is_deleted = 0 AND role_id IS NOT NULL GROUP BY role_id')
    .all().forEach((r) => { memberCounts[r.role_id] = r.c; });

  ok(res, roles.map((r) => ({
    ...r,
    permission_count: permCounts[r.id] || 0,
    member_count: memberCounts[r.id] || 0,
  })));
});

/** 新增角色（M13-R2） */
router.post('/roles', requirePermission('role:manage'), (req, res) => {
  const body = bodyOf(req);
  const roleName = requireString(body, 'role_name', '角色名称');
  const roleCode = body.role_code ? String(body.role_code).trim() : `custom_${Date.now()}`;
  const id = insertRole({
    roleCode,
    roleName,
    description: optional(body, 'description'),
    sortOrder: optional(body, 'sort_order', 0),
    isSystem: false,
  });
  logOperation(req, { action: 'CREATE_ROLE', targetType: 'Role', targetId: id, detail: { role_code: roleCode, role_name: roleName } });
  created(res, getRole(id));
});

/** 复制角色（连同全部 role_permissions）M13-R2 */
router.post('/roles/:id/copy', requirePermission('role:manage'), (req, res) => {
  const source = needRole(req.params.id);
  const body = bodyOf(req);
  const roleName = requireString(body, 'role_name', '角色名称');
  const roleCode = body.role_code ? String(body.role_code).trim() : `custom_${Date.now()}`;
  if (db.prepare('SELECT id FROM roles WHERE role_code = ?').get(roleCode)) throw badRequest(`角色编码已存在：${roleCode}`);

  const newRoleId = newId();
  const t = now();
  const perms = db.prepare('SELECT * FROM role_permissions WHERE role_id = ?').all(source.id);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO roles (id, role_code, role_name, role_type, description, sort_order, is_system, is_enabled, created_at, updated_at)
       VALUES (?, ?, ?, 'custom', ?, ?, 0, 1, ?, ?)`
    ).run(newRoleId, roleCode, roleName, source.description, source.sort_order, t, t);
    const ins = db.prepare(
      `INSERT INTO role_permissions (id, role_id, permission_code, permission_type, data_scope, resource_type, action_type, scope_config_json, is_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    perms.forEach((p) => ins.run(
      newId(), newRoleId, p.permission_code, p.permission_type, p.data_scope, p.resource_type,
      p.action_type, p.scope_config_json, p.is_enabled, t, t
    ));
  })();
  logOperation(req, { action: 'COPY_ROLE', targetType: 'Role', targetId: newRoleId, detail: { from: source.id, role_code: roleCode } });
  created(res, getRole(newRoleId));
});

/** 编辑角色 */
router.put('/roles/:id', requirePermission('role:manage'), (req, res) => {
  const role = needRole(req.params.id);
  const body = bodyOf(req);
  const after = {};
  ['role_name', 'description', 'sort_order', 'is_enabled'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (body.role_code !== undefined) {
    if (role.is_system === 1) throw conflict('系统内置角色不允许修改角色编码');
    const code = String(body.role_code).trim();
    if (db.prepare('SELECT id FROM roles WHERE role_code = ? AND id <> ?').get(code, role.id)) {
      throw badRequest(`角色编码已存在：${code}`);
    }
    after.role_code = code;
  }
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE roles SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: role.id, t: now() });
  logOperation(req, { action: 'UPDATE_ROLE', targetType: 'Role', targetId: role.id, detail: after });
  ok(res, getRole(role.id));
});

/** 删除角色（系统内置禁止；有成员时需先转移） */
router.delete('/roles/:id', requirePermission('role:manage'), (req, res) => {
  const role = needRole(req.params.id);
  if (role.is_system === 1) throw conflict('系统内置角色不可删除');
  const mc = memberCount(role.id);
  if (mc > 0) throw conflict(`该角色下存在 ${mc} 名成员，请先转移成员后再删除`);

  db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id);
    db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
  })();
  logOperation(req, { action: 'DELETE_ROLE', targetType: 'Role', targetId: role.id, detail: { role_code: role.role_code } });
  ok(res, { id: role.id, deleted: true });
});

/** 权限点清单（M13-R3） */
router.get('/permissions', requirePermission('role:view'), (req, res) => {
  const conditions = [];
  const params = [];
  if (req.query.module) {
    conditions.push('module = ?');
    params.push(req.query.module);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  ok(res, db.prepare(`SELECT * FROM permissions${where} ORDER BY module, sort_order`).all(...params));
});

/** 角色功能权限矩阵（M13-R3） */
router.get('/roles/:id/permissions', requirePermission('role:view'), (req, res) => {
  const role = needRole(req.params.id);
  const all = db.prepare('SELECT code, module FROM permissions ORDER BY module, sort_order').all();
  const rows = db.prepare(
    "SELECT permission_code, is_enabled FROM role_permissions WHERE role_id = ? AND permission_type = 'function'"
  ).all(role.id);
  const enabled = new Set(rows.filter((r) => r.is_enabled === 1).map((r) => r.permission_code));

  const modules = {};
  all.forEach((p) => {
    const m = p.module || 'other';
    if (!modules[m]) modules[m] = {};
    modules[m][p.code] = enabled.has(p.code);
  });
  ok(res, { role_id: role.id, modules, granted: [...enabled] });
});

/** 保存角色功能权限（M13-R3） */
router.put('/roles/:id/permissions', requirePermission('role:manage'), (req, res) => {
  const role = needRole(req.params.id);
  const body = bodyOf(req);
  const list = Array.isArray(body.permissions) ? body.permissions : [];
  if (!list.length) throw badRequest('permissions 不能为空');
  if (memberCount(role.id) > 0 && body.confirm !== true) {
    throw conflict('角色权限变更需二次确认', CODE.ROLE_PERMISSION_CONFIRM);
  }

  const t = now();
  db.transaction(() => {
    list.forEach((p) => {
      const code = p.permission_code;
      if (!code) return;
      const isEnabled = p.is_enabled === true || p.is_enabled === 1 || p.is_enabled === 'true';
      const existing = db.prepare(
        "SELECT id FROM role_permissions WHERE role_id = ? AND permission_code = ? AND permission_type = 'function'"
      ).get(role.id, code);
      if (isEnabled) {
        if (existing) {
          db.prepare('UPDATE role_permissions SET is_enabled = 1, updated_at = ? WHERE id = ?').run(t, existing.id);
        } else {
          db.prepare(
            `INSERT INTO role_permissions (id, role_id, permission_code, permission_type, is_enabled, created_at, updated_at)
             VALUES (?, ?, ?, 'function', 1, ?, ?)`
          ).run(newId(), role.id, code, t, t);
        }
      } else if (existing) {
        db.prepare('DELETE FROM role_permissions WHERE id = ?').run(existing.id);
      }
    });
  })();
  logOperation(req, { action: 'UPDATE_ROLE_PERMISSIONS', targetType: 'Role', targetId: role.id, detail: { count: list.length } });
  ok(res, { role_id: role.id, saved: list.length });
});

/** 角色数据权限（M13-R4） */
router.get('/roles/:id/data-scopes', requirePermission('role:view'), (req, res) => {
  const role = needRole(req.params.id);
  const rows = db.prepare(
    "SELECT * FROM role_permissions WHERE role_id = ? AND permission_type = 'data'"
  ).all(role.id);
  const map = {};
  rows.forEach((r) => { if (r.resource_type) map[r.resource_type] = r; });

  const scopes = SCOPED_RESOURCES.map((resource) => {
    const row = map[resource];
    let scopeConfig = null;
    if (row && row.scope_config_json) {
      try {
        scopeConfig = JSON.parse(row.scope_config_json);
      } catch (e) {
        scopeConfig = null;
      }
    }
    return { resource_type: resource, data_scope: row ? row.data_scope || 'self' : 'self', scope_config: scopeConfig };
  });
  ok(res, { role_id: role.id, scopes });
});

/** 保存角色数据权限（M13-R4） */
router.put('/roles/:id/data-scopes', requirePermission('role:manage'), (req, res) => {
  const role = needRole(req.params.id);
  const body = bodyOf(req);
  const list = Array.isArray(body.scopes) ? body.scopes : [];
  if (!list.length) throw badRequest('scopes 不能为空');
  if (memberCount(role.id) > 0 && body.confirm !== true) {
    throw conflict('角色权限变更需二次确认', CODE.ROLE_PERMISSION_CONFIRM);
  }

  const t = now();
  db.transaction(() => {
    list.forEach((s) => {
      const resource = s.resource_type;
      if (!SCOPED_RESOURCES.includes(resource)) throw badRequest(`不支持的数据权限资源：${resource}`);
      const scope = s.data_scope;
      if (!DATA_SCOPES.includes(scope)) throw badRequest(`data_scope 非法：${scope}`);
      if (scope === 'custom' && (!s.scope_config || typeof s.scope_config !== 'object')) {
        throw badRequest('custom 范围必须提供 scope_config');
      }
      const configJson = scope === 'custom'
        ? JSON.stringify({
          departments: s.scope_config.departments || [],
          include_self: s.scope_config.include_self !== undefined ? s.scope_config.include_self : true,
          collaborated: s.scope_config.collaborated !== undefined ? s.scope_config.collaborated : false,
        })
        : (s.scope_config ? JSON.stringify(s.scope_config) : null);
      const code = `data_scope:${resource}`;
      const existing = db.prepare(
        'SELECT id FROM role_permissions WHERE role_id = ? AND permission_code = ? AND resource_type = ?'
      ).get(role.id, code, resource);
      if (existing) {
        db.prepare(
          'UPDATE role_permissions SET data_scope = ?, scope_config_json = ?, is_enabled = 1, updated_at = ? WHERE id = ?'
        ).run(scope, configJson, t, existing.id);
      } else {
        db.prepare(
          `INSERT INTO role_permissions (id, role_id, permission_code, permission_type, data_scope, resource_type, scope_config_json, is_enabled, created_at, updated_at)
           VALUES (?, ?, ?, 'data', ?, ?, ?, 1, ?, ?)`
        ).run(newId(), role.id, code, scope, resource, configJson, t, t);
      }
    });
  })();
  logOperation(req, { action: 'UPDATE_ROLE_DATA_SCOPES', targetType: 'Role', targetId: role.id, detail: { count: list.length } });
  ok(res, { role_id: role.id, saved: list.length });
});

/** 变更影响预览（M13-R5）：成员数量 + 归属数据量 */
router.get('/roles/:id/permission-change-preview', requirePermission('role:view'), (req, res) => {
  const role = needRole(req.params.id);
  const ids = db.prepare('SELECT id FROM users WHERE role_id = ? AND is_deleted = 0').all(role.id).map((u) => u.id);
  const owned = (table) => {
    if (!ids.length) return 0;
    const ph = ids.map(() => '?').join(',');
    return db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE owner_id IN (${ph}) AND is_deleted = 0`).all(...ids)[0].c;
  };
  ok(res, {
    role_id: role.id,
    role_name: role.role_name,
    member_count: ids.length,
    affected: {
      customers: owned('customers'),
      leads: owned('leads'),
      opportunities: owned('opportunities'),
    },
  });
});

/** 角色成员（M13-R5） */
router.get('/roles/:id/members', requirePermission('role:view'), (req, res) => {
  const role = needRole(req.params.id);
  ok(res, db.prepare(
    `SELECT u.id, u.username, u.name, u.status, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.role_id = ? AND u.is_deleted = 0
     ORDER BY u.created_at`
  ).all(role.id));
});

module.exports = router;
