'use strict';

/** 系统配置读写（PRD 11.2.17），值以字符串存储并按 value_type 转换 */
const { db } = require('../db');
const { newId, now } = require('../utils/ids');
const { notFound, conflict } = require('../utils/errors');

function parse(row) {
  if (!row) return null;
  let value = row.config_value;
  if (row.value_type === 'number') value = Number(row.config_value);
  else if (row.value_type === 'boolean') value = row.config_value === 'true' || row.config_value === '1';
  else if (row.value_type === 'json') {
    try {
      value = JSON.parse(row.config_value);
    } catch (e) {
      value = null;
    }
  }
  return { ...row, value };
}

function getRow(key) {
  return db.prepare('SELECT * FROM system_configs WHERE config_key = ?').get(key) || null;
}

function get(key, fallback = null) {
  const row = getRow(key);
  if (!row) return fallback;
  return parse(row).value;
}

const getNumber = (key, fallback) => {
  const v = Number(get(key, fallback));
  return Number.isNaN(v) ? fallback : v;
};

function group(groupName) {
  return db
    .prepare('SELECT * FROM system_configs WHERE config_group = ? ORDER BY config_key')
    .all(groupName)
    .map(parse);
}

function all() {
  return db.prepare('SELECT * FROM system_configs ORDER BY config_group, config_key').all().map(parse);
}

/** 乐观锁校验：expected 为空时跳过（兼容不带 version 的调用） */
function checkVersion(key, expected) {
  if (expected === undefined || expected === null || expected === '') return;
  const row = getRow(key);
  if (!row) return;
  const current = Number(row.version || 1);
  if (Number(expected) !== current) {
    throw conflict(`参数「${row.description || key}」已被他人修改，请刷新后重试`, null, {
      config_key: key,
      current_value: row.config_value,
      current_version: current,
    });
  }
}

function set(key, value, userId, { createIfMissing = true, expectedVersion = null } = {}) {
  const row = getRow(key);
  const str = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  if (row) {
    checkVersion(key, expectedVersion);
    db.prepare(
      'UPDATE system_configs SET config_value = ?, updated_by = ?, version = COALESCE(version, 1) + 1, updated_at = ? WHERE config_key = ?'
    ).run(str, userId || null, now(), key);
    return parse(getRow(key));
  }
  if (!createIfMissing) throw notFound(`配置项不存在：${key}`);
  db.prepare(
    `INSERT INTO system_configs (id, config_key, config_value, config_group, value_type, description, updated_by, version, created_at, updated_at)
     VALUES (?, ?, ?, 'system', 'string', NULL, ?, 1, ?, ?)`
  ).run(newId(), key, str, userId || null, now(), now());
  return parse(getRow(key));
}

/** 停滞预警阈值（阶段未单独配置时回落全局） */
function alertThresholds(stageConfig) {
  const global = {
    level1: getNumber('stale_alert_level1_days', 7),
    level2: getNumber('stale_alert_level2_days', 14),
    level3: getNumber('stale_alert_level3_days', 21),
  };
  if (!stageConfig || !stageConfig.alert_thresholds) return global;
  try {
    const cfg = JSON.parse(stageConfig.alert_thresholds);
    return {
      level1: Number(cfg.level1 || global.level1),
      level2: Number(cfg.level2 || global.level2),
      level3: Number(cfg.level3 || global.level3),
    };
  } catch (e) {
    return global;
  }
}

/** 公海规则汇总 */
function seaRules() {
  return {
    is_pickup_mode: get('sea_pickup_mode', true),
    protection_days: getNumber('sea_protection_days', 3),
    personal_max: getNumber('sea_personal_max', 20),
    daily_pickup_max: getNumber('sea_daily_pickup_max', 5),
    fallback_days_after_alert: getNumber('sea_fallback_days_after_alert', 7),
    lead_recycle_days: getNumber('lead_unconverted_recycle_days', 60),
    customer_recycle_days: getNumber('customer_inactive_recycle_days', 90),
  };
}

module.exports = { get, getNumber, group, all, set, getRow, checkVersion, alertThresholds, seaRules };
