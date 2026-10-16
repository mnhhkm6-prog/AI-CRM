'use strict';

const { createApp } = require('./app');
const { DB_FILE } = require('./db');
const jobs = require('./jobs');

const PORT = Number(process.env.PORT) || 3000;

const app = createApp();

app.listen(PORT, () => {
  console.log('==============================================');
  console.log(' 自研 CRM 后端服务已启动');
  console.log(` 地址：http://localhost:${PORT}/api/v1`);
  console.log(` 健康检查：http://localhost:${PORT}/api/v1/health`);
  console.log(` 数据库：${DB_FILE}`);
  console.log(' 身份模拟：请求头 X-User-Id: admin（或 sales01 / manager01 ...）');
  console.log('==============================================');
  if (process.env.CRM_JOBS !== 'off') jobs.start();
  else console.log('定时任务已关闭（CRM_JOBS=off）');
});

module.exports = app;
