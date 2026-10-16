'use strict';

/**
 * 提交数据库前执行：把 WAL 日志合并回主库文件
 *
 * 背景：SQLite 默认开启 WAL 模式，最新写入可能还在 crm.db-wal 里。
 *      如果直接提交运行中的 crm.db，换台电脑拉下来会丢失最近的数据。
 * 用法：npm run db:snapshot  然后 git add server/data/crm.db
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(__dirname, '../data/crm.db');

if (!fs.existsSync(dbPath)) {
  console.error(`[db:snapshot] 未找到数据库文件：${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('busy_timeout = 8000');

const sizeBefore = fs.statSync(dbPath).size;
let result;
try {
  result = db.pragma('wal_checkpoint(TRUNCATE)');
} catch (e) {
  result = [{ error: e.message }];
}
const quickCheck = db.pragma('quick_check');
const counts = {
  users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  customers: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
  leads: db.prepare('SELECT COUNT(*) c FROM leads').get().c,
  opportunities: db.prepare('SELECT COUNT(*) c FROM opportunities').get().c,
};
db.close();

const sizeAfter = fs.statSync(dbPath).size;
const mb = (n) => (n / 1024 / 1024).toFixed(2);

console.log('[db:snapshot] WAL 合并结果：', JSON.stringify(result));
console.log(`[db:snapshot] 完整性检查：${quickCheck[0]?.quick_check || JSON.stringify(quickCheck)}`);
console.log('[db:snapshot] 数据量：', JSON.stringify(counts));
console.log(`[db:snapshot] 文件大小：${mb(sizeBefore)} MB → ${mb(sizeAfter)} MB`);

const busy = Array.isArray(result) && result[0] && Number(result[0].busy) === 1;
if (busy) {
  console.log('[db:snapshot] 提示：数据库被占用（后端可能正在运行），已尽量合并但仍可能残留 WAL。');
  console.log('           建议先停掉后端服务，再执行一次 npm run db:snapshot。');
} else {
  console.log('[db:snapshot] 完成，现在可以提交：git add server/data/crm.db');
}
