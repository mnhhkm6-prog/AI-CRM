'use strict';

/**
 * 数据权限过滤引擎（五级：self / department / sub_department / all / custom）
 * 列表：把 scopeFragment(user, resource).sql 拼进 WHERE 后即可；
 * 详情：用 findScoped(...) 按同一规则取数（越权等同于不存在，返回 404）。
 */
const { db } = require('../db');
const { SCOPED_RESOURCES } = require('../constants/permissions');
const { subtreeIds, userIdsInDepartments } = require('./org');

/** 资源 → 归属人字段 */
const OWNER_COLUMN = {
  customer: 'owner_id',
  lead: 'owner_id',
  opportunity: 'owner_id',
  activity: 'created_by',
  proposal: 'uploaded_by',
  quotation: 'uploaded_by',
  contract: 'created_by',
};

const isScoped = (resource) => SCOPED_RESOURCES.includes(resource);

/** 解析用户在某资源上的数据范围 */
function scopeOf(user, resource) {
  if (!user) return 'self';
  if (user.isAdmin) return 'all';
  if (!isScoped(resource)) return 'all';
  return user.dataScopes[resource] || 'self';
}

const customConfigOf = (user, resource) => (user && user.customScopes && user.customScopes[resource]) || {};

/** 生成 SQL 片段（以 " AND " 开头） */
function scopeFragment(user, resource, ownerColumn) {
  if (!user) return { sql: ' AND 1 = 0', params: [] };
  if (!isScoped(resource)) return { sql: '', params: [] };
  const col = ownerColumn || OWNER_COLUMN[resource] || 'owner_id';
  const scope = scopeOf(user, resource);

  if (scope === 'all') return { sql: '', params: [] };
  if (scope === 'self') {
    // 商机：本人负责的 + 被分享给我的（分享即可见，写操作另行校验分享权限）
    if (resource === 'opportunity') {
      const prefix = col.includes('.') ? `${col.split('.')[0]}.` : '';
      return {
        sql: ` AND (${col} = ? OR ${prefix}id IN (SELECT opportunity_id FROM opportunity_shares WHERE shared_to = ? AND is_revoked = 0))`,
        params: [user.id, user.id],
      };
    }
    return { sql: ` AND ${col} = ?`, params: [user.id] };
  }

  if (scope === 'department') {
    const ids = [user.id, ...userIdsInDepartments(user.department_id ? [user.department_id] : [])];
    return { sql: ` AND ${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
  }

  if (scope === 'sub_department') {
    const ids = [user.id, ...userIdsInDepartments(subtreeIds(user.department_id))];
    return { sql: ` AND ${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
  }

  if (scope === 'custom') {
    const cfg = customConfigOf(user, resource);
    const parts = [];
    const params = [];
    if (cfg.include_self !== false) {
      parts.push(`${col} = ?`);
      params.push(user.id);
    }
    if (Array.isArray(cfg.departments) && cfg.departments.length) {
      const ids = userIdsInDepartments(cfg.departments);
      if (ids.length) {
        parts.push(`${col} IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
      }
    }
    if (cfg.collaborated) {
      if (resource === 'opportunity') {
        parts.push('id IN (SELECT opportunity_id FROM opportunity_shares WHERE shared_to = ? AND is_revoked = 0)');
      } else if (resource === 'customer') {
        parts.push(
          `id IN (SELECT o.customer_id FROM opportunities o
                  JOIN opportunity_shares s ON s.opportunity_id = o.id
                  WHERE s.shared_to = ? AND s.is_revoked = 0)`
        );
      } else {
        parts.push('opportunity_id IN (SELECT opportunity_id FROM opportunity_shares WHERE shared_to = ? AND is_revoked = 0)');
      }
      params.push(user.id);
    }
    if (!parts.length) return { sql: ' AND 1 = 0', params: [] };
    return { sql: ` AND (${parts.join(' OR ')})`, params };
  }

  return { sql: ' AND 1 = 0', params: [] };
}

/**
 * 按数据权限取单条记录；无权限或不存在均返回 null
 * @param {string} resource 资源类型（customer/lead/opportunity/activity/...）
 * @param {string} table 表名
 * @param {string} id 主键
 */
function findScoped(resource, table, id, user, { deletedColumn = 'is_deleted' } = {}) {
  const frag = scopeFragment(user, resource);
  const deletedSql = deletedColumn ? ` AND ${deletedColumn} = 0` : '';
  return db
    .prepare(`SELECT * FROM ${table} WHERE id = ?${deletedSql}${frag.sql}`)
    .get(id, ...frag.params) || null;
}

/** 当前用户可访问的商机 ID 子查询（供关联资源过滤） */
function accessibleOpportunityIds(user) {
  const frag = scopeFragment(user, 'opportunity');
  return { sql: `SELECT id FROM opportunities WHERE is_deleted = 0${frag.sql}`, params: frag.params };
}

module.exports = { OWNER_COLUMN, isScoped, scopeOf, scopeFragment, findScoped, accessibleOpportunityIds };
