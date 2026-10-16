'use strict';

const { randomUUID } = require('crypto');

const newId = () => randomUUID();
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

/** 生成业务单据号，如 CUS-20261016-8F3A */
function newBizNo(prefix) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${ymd}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

module.exports = { newId, now, today, newBizNo };
