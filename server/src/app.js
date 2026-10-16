'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const { migrate } = require('./db');
const { seedAll } = require('./db/seed');
const { auth } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const routes = require('./routes');

const UPLOAD_DIR = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function createApp() {
  migrate();
  seedAll();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 附件静态访问（预览/下载）
  app.use('/uploads', express.static(UPLOAD_DIR));

  app.get('/', (req, res) => {
    res.json({ data: { name: '自研 CRM 后端 API', version: 'v1', base: '/api/v1', health: '/api/v1/health' } });
  });

  // 免登录白名单：健康检查、登录、登录页所需的登录方式配置
  const PUBLIC_PATHS = new Set(['/health', '/auth/login', '/auth/login-config']);
  app.use('/api/v1', (req, res, next) => (PUBLIC_PATHS.has(req.path) ? next() : auth(req, res, next)), routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, UPLOAD_DIR };
