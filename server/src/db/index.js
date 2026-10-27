'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'crm.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

/** 已有库补列（schema.sql 的 CREATE TABLE IF NOT EXISTS 不会给旧表加列） */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** 执行 schema.sql（幂等） */
function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  ensureColumn('leads', 'wechat', 'wechat TEXT');
  ensureColumn('leads', 'customer_name', 'customer_name TEXT');
  ensureColumn('sea_pool_records', 'previous_owner', 'previous_owner TEXT');
  ensureColumn('quotations', 'approval_status', "approval_status TEXT DEFAULT 'none'");
  ensureColumn('quotations', 'approval_instance_id', 'approval_instance_id TEXT');
  ensureColumn('contracts', 'approval_status', "approval_status TEXT DEFAULT 'none'");
  ensureColumn('contracts', 'approval_instance_id', 'approval_instance_id TEXT');
  ensureColumn('custom_field_definitions', 'stage_config_id', 'stage_config_id TEXT');

  // 存量商机自定义字段按固定动作规则回填所属阶段（仅回填一次，不覆盖人工调整）
  db.exec(`
    UPDATE custom_field_definitions
    SET stage_config_id = (
      SELECT r.stage_config_id
      FROM stage_action_rules r
      JOIN stage_configs s ON s.id = r.stage_config_id
      WHERE r.field_key = custom_field_definitions.field_code
      ORDER BY s.sort_order
      LIMIT 1
    )
    WHERE entity_type = 'opportunity'
      AND (stage_config_id IS NULL OR stage_config_id = '')
      AND EXISTS (SELECT 1 FROM stage_action_rules r WHERE r.field_key = custom_field_definitions.field_code)
  `);

  // 起点阶段 S0 门槛低：默认使用更短的停滞阈值（占位商机更快暴露），已单独配置的不覆盖
  const s0 = db.prepare("SELECT id, alert_thresholds FROM stage_configs WHERE code = 'S0'").get();
  if (s0 && !s0.alert_thresholds) {
    db.prepare('UPDATE stage_configs SET alert_thresholds = ? WHERE id = ?')
      .run(JSON.stringify({ level1: 3, level2: 5, level3: 7 }), s0.id);
  }
}

module.exports = { db, DB_FILE, DATA_DIR, migrate };
