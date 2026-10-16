'use strict';

const fs = require('fs');
const path = require('path');
const { db, DB_FILE, migrate } = require('./index');
const { seedAll } = require('./seed');

const force = process.argv.includes('--force');

if (force) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  db.pragma('foreign_keys = OFF');
  tables.forEach((t) => db.exec(`DROP TABLE IF EXISTS "${t.name}"`));
  console.log(`已清空 ${tables.length} 张表`);
}

migrate();
seedAll();

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const admin = db.prepare("SELECT id, username, name FROM users WHERE username = 'admin'").get();

console.log('--- CRM 数据库初始化完成 ---');
console.log('数据库文件:', DB_FILE);
console.log('数据库大小:', (fs.statSync(DB_FILE).size / 1024).toFixed(1), 'KB');
[
  'departments', 'users', 'roles', 'permissions', 'role_permissions',
  'stage_configs', 'stage_action_rules', 'system_configs',
  'dictionary_types', 'dictionary_items', 'custom_field_definitions',
  'view_configs', 'report_templates', 'implementation_templates',
].forEach((t) => console.log(`  ${t}: ${count(t)}`));

console.log('\n可用测试账号（请求头 X-User-Id 传 username 或 id）：');
db.prepare(
  `SELECT u.username, u.name, r.role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.username`
)
  .all()
  .forEach((u) => console.log(`  ${u.username.padEnd(12)} ${u.name.padEnd(8)} ${u.role_name || ''}`));
console.log(`\n管理员 ID: ${admin ? admin.id : '-'}`);
console.log('例如：curl -H "X-User-Id: admin" http://localhost:3000/api/v1/me');
