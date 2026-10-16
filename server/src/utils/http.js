'use strict';

const { badRequest } = require('./errors');

/** 200 查询/更新成功 */
function ok(res, data) {
  return res.status(200).json({ data: data === undefined ? null : data });
}

/** 201 创建成功 */
function created(res, data) {
  return res.status(201).json({ data: data === undefined ? null : data });
}

/** 解析分页参数：page 默认 1、page_size 默认 20 上限 200 */
function getPaging(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  let pageSize = Number.parseInt(req.query.page_size, 10) || 20;
  pageSize = Math.min(200, Math.max(1, pageSize));
  return { page, page_size: pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/** 统一分页响应体 */
function paged(list, total, paging) {
  return { list, total, page: paging.page, page_size: paging.page_size };
}

/**
 * 白名单排序：避免 SQL 注入
 * @param {object} req express req
 * @param {string[]} allowed 允许排序的列
 * @param {string} fallback 默认列
 * @param {string} alias 可选表别名（多表 JOIN 时避免列名歧义）
 * @returns {{clause:string}} 形如 ` ORDER BY created_at DESC`
 */
function buildSort(req, allowed, fallback = 'created_at', alias = '') {
  const col = allowed.includes(req.query.sort) ? req.query.sort : fallback;
  const dir = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { clause: ` ORDER BY ${alias ? `${alias}.` : ''}${col} ${dir}` };
}

/** 读取必填字符串字段 */
function requireString(body, field, label) {
  const v = body ? body[field] : undefined;
  if (v === undefined || v === null || String(v).trim() === '') {
    throw badRequest(`${label || field} 为必填项`);
  }
  return String(v).trim();
}

/** 读取必填数字字段 */
function requireNumber(body, field, label) {
  const v = body ? body[field] : undefined;
  const n = Number(v);
  if (v === undefined || v === null || v === '' || Number.isNaN(n)) {
    throw badRequest(`${label || field} 必须为数字`);
  }
  return n;
}

/** 可空字段：undefined 时返回 fallback */
function optional(body, field, fallback = null) {
  const v = body ? body[field] : undefined;
  return v === undefined ? fallback : v;
}

/** 取请求体（容错） */
function bodyOf(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

module.exports = { ok, created, getPaging, paged, buildSort, requireString, requireNumber, optional, bodyOf };
