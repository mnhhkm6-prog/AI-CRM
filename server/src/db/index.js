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
  ensureColumn('sea_pool_records', 'previous_owner', 'previous_owner TEXT');
}

module.exports = { db, DB_FILE, DATA_DIR, migrate };
