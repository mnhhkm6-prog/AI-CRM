'use strict';

/** 组织架构：部门树与部门子树查询 */
const { db } = require('../db');

function allDepartments() {
  return db.prepare('SELECT * FROM departments WHERE is_deleted = 0 ORDER BY sort_order').all();
}

function departmentTree() {
  const rows = allDepartments();
  const map = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) map.get(node.parent_id).children.push(node);
    else roots.push(node);
  });
  return roots;
}

/** 含自身的部门子树 ID 列表 */
function subtreeIds(departmentId) {
  if (!departmentId) return [];
  const rows = allDepartments();
  const result = [departmentId];
  let frontier = [departmentId];
  while (frontier.length) {
    const next = rows.filter((r) => frontier.includes(r.parent_id)).map((r) => r.id);
    const fresh = next.filter((id) => !result.includes(id));
    result.push(...fresh);
    frontier = fresh;
  }
  return result;
}

/** 某部门下的用户 ID 列表 */
function userIdsInDepartments(deptIds) {
  if (!deptIds.length) return [];
  const ph = deptIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT id FROM users WHERE department_id IN (${ph}) AND is_deleted = 0`)
    .all(...deptIds)
    .map((u) => u.id);
}

function userById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ? AND is_deleted = 0').get(id) || null;
}

module.exports = { allDepartments, departmentTree, subtreeIds, userIdsInDepartments, userById };
