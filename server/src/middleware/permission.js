'use strict';

const { forbidden } = require('../utils/errors');

/** 功能权限校验 */
function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return next(forbidden('未识别身份'));
    if (req.user.isAdmin) return next();
    if (!req.user.permissions.has(code)) return next(forbidden(`缺少功能权限：${code}`));
    next();
  };
}

/** 满足任意一个权限即可 */
function requireAnyPermission(codes) {
  return (req, res, next) => {
    if (!req.user) return next(forbidden('未识别身份'));
    if (req.user.isAdmin) return next();
    if (!codes.some((c) => req.user.permissions.has(c))) {
      return next(forbidden(`缺少功能权限：${codes.join(' 或 ')}`));
    }
    next();
  };
}

/** 有权限则放行（用于同一接口按权限返回不同范围的场景） */
function hasPermission(req, code) {
  return !!req.user && (req.user.isAdmin || req.user.permissions.has(code));
}

module.exports = { requirePermission, requireAnyPermission, hasPermission };
