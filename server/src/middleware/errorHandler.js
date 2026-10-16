'use strict';

const { BizError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ error: `接口不存在：${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof BizError) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    if (err.details) body.details = err.details;
    return res.status(err.httpStatus).json(body);
  }

  // SQLite 约束错误统一转 400
  if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_')) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: '数据重复，违反唯一性约束' });
    }
    return res.status(400).json({ error: `数据操作失败：${err.message}` });
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法 JSON' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '上传文件超过大小限制' });
  }

  console.error('[UNHANDLED]', req.method, req.originalUrl, err);
  return res.status(500).json({ error: err && err.message ? `服务器内部错误：${err.message}` : '服务器内部错误' });
}

module.exports = { notFoundHandler, errorHandler };
