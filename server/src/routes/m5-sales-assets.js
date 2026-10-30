'use strict';

/**
 * M5 方案与报价管理（P17/P18/P19/P20）
 * 覆盖：附件上传/下载、方案、报价、产品价格记录、竞争对手（含主数据）、合同
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const router = express.Router();
const { db } = require('../db');
const { ok, created, getPaging, paged, buildSort, requireString, requireNumber, optional, bodyOf } = require('../utils/http');
const { notFound, badRequest, forbidden, conflict } = require('../utils/errors');
const { newId, now } = require('../utils/ids');
const { requirePermission } = require('../middleware/permission');
const dataScope = require('../services/dataScope');
const stageEngine = require('../services/stageEngine');
const approvalFlow = require('../services/approvalFlow');
const { logOperation } = require('../services/operationLog');

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname) || ''}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/** 商机可访问性校验（附件类资源均先校验所属商机） */
function requireOpportunity(req, id) {
  const opp = dataScope.findScoped('opportunity', 'opportunities', id, req.user);
  if (!opp) throw notFound('商机不存在或无权访问');
  return opp;
}

/** 附件记录校验 */
function requireFileStorage(id) {
  const file = db.prepare('SELECT * FROM file_storages WHERE id = ? AND is_deleted = 0').get(id);
  if (!file) throw notFound('附件不存在');
  return file;
}

/** storage_path（uploads/xxx）→ 访问地址（/uploads/xxx） */
const fileUrlOf = (file) => `/${String(file.storage_path).replace(/^\/+/, '')}`;

/**
 * multipart 的 filename 默认按 latin1 解码，中文文件名会变成乱码；
 * 这里在必要时还原为 UTF-8（ASCII 文件名不受影响）
 */
function decodeOriginalName(name) {
  if (!name) return name;
  if (/[^\u0000-\u00ff]/.test(name)) return name; // 已含非 latin1 字符，说明已是正确解码结果
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

// ---------------------------------------------------------------- 附件
/** 上传附件（multipart，字段名 file） */
router.post('/files', requirePermission('file:upload'), upload.single('file'), (req, res) => {
  if (!req.file) throw badRequest('请上传文件（字段名 file）');
  const body = bodyOf(req);
  const id = newId();
  const originalName = decodeOriginalName(req.file.originalname);
  db.prepare(
    `INSERT INTO file_storages (id, original_name, storage_path, mime_type, file_size, uploader_id, related_type, related_id, is_deleted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id, originalName, `uploads/${req.file.filename}`, req.file.mimetype, req.file.size,
    req.user.id, optional(body, 'related_type'), optional(body, 'related_id'), now()
  );
  logOperation(req, { action: 'UPLOAD_FILE', targetType: 'FileStorage', targetId: id, detail: { original_name: originalName } });
  created(res, {
    file_storage_id: id,
    file_url: `/uploads/${req.file.filename}`,
    file_name: originalName,
    file_size: req.file.size,
  });
});

/** 下载/预览附件（M5-R4） */
router.get('/files/:id/download', requirePermission('file:view'), (req, res) => {
  const file = db.prepare('SELECT * FROM file_storages WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!file) throw notFound('附件不存在');
  const abs = path.resolve(__dirname, '../../', file.storage_path);
  if (!fs.existsSync(abs)) throw notFound('附件文件不存在');
  res.download(abs, file.original_name);
});

/** 删除未被业务记录引用的附件（上传成功但创建业务记录失败时，前端回滚调用） */
router.delete('/files/:id', requirePermission('file:upload'), (req, res) => {
  const file = requireFileStorage(req.params.id);
  if (!req.user.isAdmin && file.uploader_id !== req.user.id) throw forbidden('只能删除本人上传的附件');
  const used = ['proposals', 'quotations', 'contracts'].some((table) =>
    db.prepare(`SELECT 1 FROM ${table} WHERE file_storage_id = ? AND is_deleted = 0`).get(file.id)
  );
  if (used) throw conflict('附件已被业务记录引用，不能删除');
  const abs = path.resolve(__dirname, '../../', file.storage_path);
  if (!abs.startsWith(UPLOAD_DIR + path.sep)) throw badRequest('附件路径不合法');
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  db.prepare('UPDATE file_storages SET is_deleted = 1 WHERE id = ?').run(file.id);
  logOperation(req, { action: 'DELETE_FILE', targetType: 'FileStorage', targetId: file.id, detail: { original_name: file.original_name } });
  ok(res, { id: file.id, deleted: true });
});

// ---------------------------------------------------------------- 方案
/** 方案列表（P17 全局列表，按方案数据权限过滤） */
router.get('/proposals', requirePermission('proposal:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];
  const scope = dataScope.scopeFragment(req.user, 'proposal');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  if (req.query.opportunity_id) {
    conditions.push('t.opportunity_id = ?');
    params.push(req.query.opportunity_id);
  }
  if (req.query.customer_id) {
    conditions.push('o.customer_id = ?');
    params.push(req.query.customer_id);
  }
  if (req.query.proposal_type) {
    conditions.push('t.proposal_type = ?');
    params.push(req.query.proposal_type);
  }
  if (req.query.keyword) {
    conditions.push('(t.file_name LIKE ? OR o.name LIKE ? OR c.name LIKE ?)');
    const kw = `%${req.query.keyword}%`;
    params.push(kw, kw, kw);
  }
  const where = conditions.join(' AND ');
  const base = `FROM proposals t
     LEFT JOIN opportunities o ON o.id = t.opportunity_id
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users u ON u.id = t.uploaded_by`;
  const total = db.prepare(`SELECT COUNT(*) c ${base} WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, ['created_at'], 'created_at');
  const list = db
    .prepare(
      `SELECT t.*, o.name AS opportunity_name, o.customer_id, c.name AS customer_name, u.name AS uploaded_by_name
       ${base} WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

router.get('/opportunities/:id/proposals', requirePermission('proposal:view'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const list = db
    .prepare(
      `SELECT p.*, u.name AS uploaded_by_name FROM proposals p
       LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.opportunity_id = ? AND p.is_deleted = 0 ORDER BY p.created_at DESC`
    )
    .all(opp.id);
  ok(res, list);
});

router.post('/opportunities/:id/proposals', requirePermission('proposal:create'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const body = bodyOf(req);
  const proposalType = requireString(body, 'proposal_type', '方案类型');
  if (!['preliminary', 'formal'].includes(proposalType)) throw badRequest('proposal_type 仅支持 preliminary 或 formal');

  let fileStorageId = optional(body, 'file_storage_id');
  let fileUrl = optional(body, 'file_url');
  let fileName = optional(body, 'file_name');
  if (fileStorageId) {
    const file = requireFileStorage(fileStorageId);
    fileStorageId = file.id;
    fileUrl = fileUrlOf(file);
    fileName = file.original_name;
  }
  if (!fileStorageId && !fileUrl && !fileName) throw badRequest('方案附件 为必填项');

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO proposals (id, opportunity_id, proposal_type, file_storage_id, file_url, file_name, version, uploaded_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, opp.id, proposalType, fileStorageId, fileUrl, fileName, optional(body, 'version'), req.user.id, t, t);

  stageEngine.touchOpportunity(opp.id, req);
  logOperation(req, { action: 'CREATE_PROPOSAL', targetType: 'Proposal', targetId: id, detail: { opportunity_id: opp.id, proposal_type: proposalType } });
  created(res, db.prepare('SELECT * FROM proposals WHERE id = ?').get(id));
});

router.delete('/proposals/:id', requirePermission('proposal:delete'), (req, res) => {
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!proposal) throw notFound('方案不存在');
  requireOpportunity(req, proposal.opportunity_id);
  db.prepare('UPDATE proposals SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), proposal.id);
  logOperation(req, { action: 'DELETE_PROPOSAL', targetType: 'Proposal', targetId: proposal.id, detail: { opportunity_id: proposal.opportunity_id } });
  ok(res, { id: proposal.id, deleted: true });
});

// ---------------------------------------------------------------- 报价
/** 报价列表（P18 全局列表，按报价数据权限过滤） */
router.get('/quotations', requirePermission('quotation:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];
  const scope = dataScope.scopeFragment(req.user, 'quotation');
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  if (req.query.opportunity_id) {
    conditions.push('t.opportunity_id = ?');
    params.push(req.query.opportunity_id);
  }
  if (req.query.customer_id) {
    conditions.push('o.customer_id = ?');
    params.push(req.query.customer_id);
  }
  ['quotation_type', 'product_type'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.keyword) {
    conditions.push('(o.name LIKE ? OR c.name LIKE ?)');
    const kw = `%${req.query.keyword}%`;
    params.push(kw, kw);
  }
  const where = conditions.join(' AND ');
  const base = `FROM quotations t
     LEFT JOIN opportunities o ON o.id = t.opportunity_id
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users u ON u.id = t.uploaded_by`;
  const total = db.prepare(`SELECT COUNT(*) c ${base} WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, ['created_at', 'amount'], 'created_at');
  const list = db
    .prepare(
      `SELECT t.*, o.name AS opportunity_name, o.customer_id, c.name AS customer_name, u.name AS uploaded_by_name
       ${base} WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

router.get('/opportunities/:id/quotations', requirePermission('quotation:view'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const list = db
    .prepare(
      `SELECT q.*, u.name AS uploaded_by_name FROM quotations q
       LEFT JOIN users u ON u.id = q.uploaded_by
       WHERE q.opportunity_id = ? AND q.is_deleted = 0 ORDER BY q.created_at DESC`
    )
    .all(opp.id);
  ok(res, list);
});

router.post('/opportunities/:id/quotations', requirePermission('quotation:create'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const body = bodyOf(req);
  const quotationType = requireString(body, 'quotation_type', '报价类型');
  if (!['preliminary', 'final'].includes(quotationType)) throw badRequest('quotation_type 仅支持 preliminary 或 final');
  const amount = requireNumber(body, 'amount', '报价金额');
  const productType = requireString(body, 'product_type', '产品类型');

  let fileStorageId = optional(body, 'file_storage_id');
  let fileUrl = null;
  let fileName = null;
  if (fileStorageId) {
    const file = requireFileStorage(fileStorageId);
    fileStorageId = file.id;
    fileUrl = fileUrlOf(file);
    fileName = file.original_name;
  }

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO quotations (id, opportunity_id, quotation_type, amount, product_type, file_storage_id, file_url, file_name, remark, uploaded_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, opp.id, quotationType, amount, productType, fileStorageId, fileUrl, fileName, optional(body, 'remark'), req.user.id, t, t);

  stageEngine.touchOpportunity(opp.id, req);
  approvalFlow.startFor('quotation', id, req);
  logOperation(req, { action: 'CREATE_QUOTATION', targetType: 'Quotation', targetId: id, detail: { opportunity_id: opp.id, amount } });
  created(res, db.prepare('SELECT * FROM quotations WHERE id = ?').get(id));
});

/** 删除不再被任何业务记录引用的附件（替换报价附件时清理旧文件） */
function removeFileIfUnused(fileId) {
  if (!fileId) return;
  const file = db.prepare('SELECT * FROM file_storages WHERE id = ? AND is_deleted = 0').get(fileId);
  if (!file) return;
  const used = ['proposals', 'quotations', 'contracts'].some((table) =>
    db.prepare(`SELECT 1 FROM ${table} WHERE file_storage_id = ? AND is_deleted = 0`).get(file.id)
  );
  if (used) return;
  const abs = path.resolve(__dirname, '../../', file.storage_path);
  if (abs.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(abs)) fs.unlinkSync(abs);
  db.prepare('UPDATE file_storages SET is_deleted = 1 WHERE id = ?').run(file.id);
}

/** 编辑报价：审批中或已通过不可修改；撤回/驳回后可修改再重新提交审批 */
router.put('/quotations/:id', requirePermission('quotation:update'), (req, res) => {
  const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!quotation) throw notFound('报价不存在');
  requireOpportunity(req, quotation.opportunity_id);
  if (quotation.approval_status === 'pending') throw badRequest('报价审批中，请先撤回后再修改');
  if (quotation.approval_status === 'approved') throw badRequest('报价已审批通过，不可修改');

  const body = bodyOf(req);
  const quotationType =
    body.quotation_type === undefined ? quotation.quotation_type : requireString(body, 'quotation_type', '报价类型');
  if (!['preliminary', 'final'].includes(quotationType)) throw badRequest('quotation_type 仅支持 preliminary 或 final');
  const amount = body.amount === undefined ? quotation.amount : requireNumber(body, 'amount', '报价金额');
  if (!(amount > 0)) throw badRequest('报价金额必须大于 0');
  const productType =
    body.product_type === undefined ? quotation.product_type : requireString(body, 'product_type', '产品类型');

  let { file_storage_id: fileStorageId, file_url: fileUrl, file_name: fileName } = quotation;
  let replacedFileId = '';
  if (body.file_storage_id && body.file_storage_id !== quotation.file_storage_id) {
    const file = requireFileStorage(body.file_storage_id);
    replacedFileId = quotation.file_storage_id || '';
    fileStorageId = file.id;
    fileUrl = fileUrlOf(file);
    fileName = file.original_name;
  }

  const remark = body.remark === undefined ? quotation.remark : optional(body, 'remark');
  db.prepare(
    `UPDATE quotations SET quotation_type = ?, amount = ?, product_type = ?, file_storage_id = ?, file_url = ?, file_name = ?, remark = ?, updated_at = ? WHERE id = ?`
  ).run(quotationType, amount, productType, fileStorageId, fileUrl, fileName, remark, now(), quotation.id);
  removeFileIfUnused(replacedFileId);
  logOperation(req, {
    action: 'UPDATE_QUOTATION',
    targetType: 'Quotation',
    targetId: quotation.id,
    detail: { opportunity_id: quotation.opportunity_id, amount },
  });
  ok(res, db.prepare('SELECT * FROM quotations WHERE id = ?').get(quotation.id));
});

router.delete('/quotations/:id', requirePermission('quotation:delete'), (req, res) => {
  const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!quotation) throw notFound('报价不存在');
  requireOpportunity(req, quotation.opportunity_id);
  if (quotation.approval_status === 'pending') throw badRequest('报价审批中，暂不可删除');
  db.prepare('UPDATE quotations SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), quotation.id);
  logOperation(req, { action: 'DELETE_QUOTATION', targetType: 'Quotation', targetId: quotation.id, detail: { opportunity_id: quotation.opportunity_id } });
  ok(res, { id: quotation.id, deleted: true });
});

// ---------------------------------------------------------------- 产品价格记录
router.get('/products/prices', requirePermission('quotation:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];
  if (req.query.product_type) {
    conditions.push('t.product_type = ?');
    params.push(req.query.product_type);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM product_prices t WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, ['created_at', 'updated_at', 'price', 'effective_date'], 'created_at');
  const list = db
    .prepare(`SELECT t.* FROM product_prices t WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`)
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

router.post('/products/prices', requirePermission('quotation:create'), (req, res) => {
  const body = bodyOf(req);
  const productType = requireString(body, 'product_type', '产品类型');
  const price = requireNumber(body, 'price', '价格');
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO product_prices (id, product_id, product_type, price, currency, effective_date, remark, created_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id, optional(body, 'product_id'), productType, price, optional(body, 'currency', 'CNY'),
    optional(body, 'effective_date'), optional(body, 'remark'), req.user.id, t, t
  );
  logOperation(req, { action: 'CREATE_PRODUCT_PRICE', targetType: 'ProductPrice', targetId: id, detail: { product_type: productType, price } });
  created(res, db.prepare('SELECT * FROM product_prices WHERE id = ?').get(id));
});

router.put('/products/prices/:id', requirePermission('quotation:update'), (req, res) => {
  const row = db.prepare('SELECT * FROM product_prices WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('产品价格记录不存在');
  const body = bodyOf(req);
  const after = {};
  ['product_id', 'product_type', 'price', 'currency', 'effective_date', 'remark'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');
  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE product_prices SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: row.id, t: now() });
  logOperation(req, { action: 'UPDATE_PRODUCT_PRICE', targetType: 'ProductPrice', targetId: row.id, detail: after });
  ok(res, db.prepare('SELECT * FROM product_prices WHERE id = ?').get(row.id));
});

router.delete('/products/prices/:id', requirePermission('quotation:delete'), (req, res) => {
  const row = db.prepare('SELECT * FROM product_prices WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('产品价格记录不存在');
  db.prepare('UPDATE product_prices SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_PRODUCT_PRICE', targetType: 'ProductPrice', targetId: row.id });
  ok(res, { id: row.id, deleted: true });
});

// ---------------------------------------------------------------- 竞争对手
/** 竞品记录沉淀列表（P20 全局，按所属商机过滤） */
router.get('/competitors', requirePermission('competitor:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];
  const scope = dataScope.scopeFragment(req.user, 'opportunity');
  if (scope.sql) {
    conditions.push(`t.opportunity_id IN (SELECT id FROM opportunities WHERE is_deleted = 0${scope.sql})`);
    params.push(...scope.params);
  }
  if (req.query.opportunity_id) {
    conditions.push('t.opportunity_id = ?');
    params.push(req.query.opportunity_id);
  }
  if (req.query.customer_id) {
    conditions.push('o.customer_id = ?');
    params.push(req.query.customer_id);
  }
  if (req.query.competitor_master_id) {
    conditions.push('t.competitor_master_id = ?');
    params.push(req.query.competitor_master_id);
  }
  if (req.query.keyword) {
    conditions.push('(t.name LIKE ? OR o.name LIKE ?)');
    const kw = `%${req.query.keyword}%`;
    params.push(kw, kw);
  }
  const where = conditions.join(' AND ');
  const base = `FROM competitors t
     LEFT JOIN opportunities o ON o.id = t.opportunity_id
     LEFT JOIN users u ON u.id = t.created_by`;
  const total = db.prepare(`SELECT COUNT(*) c ${base} WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, ['created_at'], 'created_at');
  const list = db
    .prepare(
      `SELECT t.*, o.name AS opportunity_name, o.customer_id, u.name AS created_by_name
       ${base} WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

router.get('/opportunities/:id/competitors', requirePermission('competitor:view'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const list = db
    .prepare(
      `SELECT c.*, u.name AS created_by_name FROM competitors c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.opportunity_id = ? AND c.is_deleted = 0 ORDER BY c.created_at DESC`
    )
    .all(opp.id);
  ok(res, list);
});

router.post('/opportunities/:id/competitors', requirePermission('competitor:create'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const body = bodyOf(req);
  const name = requireString(body, 'name', '竞争对手名称');
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO competitors (id, opportunity_id, competitor_master_id, name, strengths, weaknesses, created_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, opp.id, optional(body, 'competitor_master_id'), name, optional(body, 'strengths'), optional(body, 'weaknesses'), req.user.id, t, t);
  stageEngine.touchOpportunity(opp.id, req);
  logOperation(req, { action: 'CREATE_COMPETITOR', targetType: 'Competitor', targetId: id, detail: { opportunity_id: opp.id, name } });
  created(res, db.prepare('SELECT * FROM competitors WHERE id = ?').get(id));
});

/** 编辑商机竞争对手：仅更新当前商机内的快照，不回写竞品主数据 */
router.put('/competitors/:id', requirePermission('competitor:update'), (req, res) => {
  const row = db.prepare('SELECT * FROM competitors WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('竞争对手记录不存在');
  requireOpportunity(req, row.opportunity_id);
  const body = bodyOf(req);
  const name = body.name === undefined ? row.name : requireString(body, 'name', '竞争对手名称');
  const strengths = body.strengths === undefined ? row.strengths : optional(body, 'strengths');
  const weaknesses = body.weaknesses === undefined ? row.weaknesses : optional(body, 'weaknesses');
  let masterId = row.competitor_master_id;
  if (body.competitor_master_id !== undefined) {
    masterId = body.competitor_master_id || null;
    if (masterId) {
      const master = db.prepare('SELECT id FROM competitor_masters WHERE id = ? AND is_deleted = 0').get(masterId);
      if (!master) throw badRequest('竞品主数据不存在');
    }
  }
  db.prepare(
    'UPDATE competitors SET name = ?, strengths = ?, weaknesses = ?, competitor_master_id = ?, updated_at = ? WHERE id = ?'
  ).run(name, strengths, weaknesses, masterId, now(), row.id);
  logOperation(req, {
    action: 'UPDATE_COMPETITOR',
    targetType: 'Competitor',
    targetId: row.id,
    detail: { opportunity_id: row.opportunity_id, name },
  });
  ok(res, db.prepare('SELECT * FROM competitors WHERE id = ?').get(row.id));
});

router.delete('/competitors/:id', requirePermission('competitor:delete'), (req, res) => {
  const row = db.prepare('SELECT * FROM competitors WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('竞争对手记录不存在');
  requireOpportunity(req, row.opportunity_id);
  db.prepare('UPDATE competitors SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_COMPETITOR', targetType: 'Competitor', targetId: row.id, detail: { opportunity_id: row.opportunity_id } });
  ok(res, { id: row.id, deleted: true });
});

// ---------------------------------------------------------------- 竞争对手主数据
router.get('/competitor-masters', requirePermission('competitor:view'), (req, res) => {
  const conditions = ['t.is_deleted = 0'];
  const params = [];
  if (req.query.keyword) {
    conditions.push('t.name LIKE ?');
    params.push(`%${req.query.keyword}%`);
  }
  if (req.query.is_enabled !== undefined) {
    conditions.push('t.is_enabled = ?');
    params.push(req.query.is_enabled === 'true' || req.query.is_enabled === '1' ? 1 : 0);
  }
  const list = db
    .prepare(`SELECT t.* FROM competitor_masters t WHERE ${conditions.join(' AND ')} ORDER BY t.created_at DESC`)
    .all(...params);
  ok(res, list);
});

router.post('/competitor-masters', requirePermission('competitor:create'), (req, res) => {
  const body = bodyOf(req);
  const name = requireString(body, 'name', '竞争对手名称');
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO competitor_masters (id, name, industry, strengths, weaknesses, typical_cases, is_enabled, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  ).run(id, name, optional(body, 'industry'), optional(body, 'strengths'), optional(body, 'weaknesses'), optional(body, 'typical_cases'), t, t);
  logOperation(req, { action: 'CREATE_COMPETITOR_MASTER', targetType: 'CompetitorMaster', targetId: id, detail: { name } });
  created(res, db.prepare('SELECT * FROM competitor_masters WHERE id = ?').get(id));
});

router.put('/competitor-masters/:id', requirePermission('competitor:update'), (req, res) => {
  const row = db.prepare('SELECT * FROM competitor_masters WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('竞争对手主数据不存在');
  const body = bodyOf(req);
  const after = {};
  ['name', 'industry', 'strengths', 'weaknesses', 'typical_cases', 'is_enabled'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');
  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE competitor_masters SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: row.id, t: now() });
  logOperation(req, { action: 'UPDATE_COMPETITOR_MASTER', targetType: 'CompetitorMaster', targetId: row.id, detail: after });
  ok(res, db.prepare('SELECT * FROM competitor_masters WHERE id = ?').get(row.id));
});

router.post('/competitor-masters/:id/disable', requirePermission('competitor:update'), (req, res) => {
  const row = db.prepare('SELECT * FROM competitor_masters WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('竞争对手主数据不存在');
  db.prepare('UPDATE competitor_masters SET is_enabled = 0, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DISABLE_COMPETITOR_MASTER', targetType: 'CompetitorMaster', targetId: row.id });
  ok(res, db.prepare('SELECT * FROM competitor_masters WHERE id = ?').get(row.id));
});

/** 删除竞品主数据：已被商机竞争对手引用时不允许删除，改用停用 */
router.delete('/competitor-masters/:id', requirePermission('competitor:delete'), (req, res) => {
  const row = db.prepare('SELECT * FROM competitor_masters WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!row) throw notFound('竞争对手主数据不存在');
  const used = db
    .prepare('SELECT COUNT(*) AS c FROM competitors WHERE competitor_master_id = ? AND is_deleted = 0')
    .get(row.id).c;
  if (used > 0) throw badRequest(`该竞品主数据已被 ${used} 条商机竞争对手记录引用，请改为停用`);
  db.prepare('UPDATE competitor_masters SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, {
    action: 'DELETE_COMPETITOR_MASTER',
    targetType: 'CompetitorMaster',
    targetId: row.id,
    detail: { name: row.name },
  });
  ok(res, { id: row.id });
});

// ---------------------------------------------------------------- 合同
router.get('/opportunities/:id/contracts', requirePermission('contract:view'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const list = db
    .prepare('SELECT * FROM contracts WHERE opportunity_id = ? AND is_deleted = 0 ORDER BY created_at DESC')
    .all(opp.id);
  ok(res, list);
});

router.post('/opportunities/:id/contracts', requirePermission('contract:create'), (req, res) => {
  const opp = requireOpportunity(req, req.params.id);
  const body = bodyOf(req);
  const contractNo = requireString(body, 'contract_no', '合同编号');
  const amount = requireNumber(body, 'amount', '合同金额');
  const file = requireFileStorage(requireString(body, 'file_storage_id', '合同附件'));
  const signedDate = requireString(body, 'signed_date', '签订日期');
  const signedBy = requireString(body, 'signed_by', '签订人');

  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO contracts (id, opportunity_id, customer_id, contract_no, contract_name, amount, product_type, file_storage_id,
      file_url, file_name, signed_date, signed_by, status, created_by, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`
  ).run(
    id, opp.id, opp.customer_id, contractNo, optional(body, 'contract_name'), amount, optional(body, 'product_type'),
    file.id, fileUrlOf(file), file.original_name, signedDate, signedBy, req.user.id, t, t
  );
  logOperation(req, { action: 'CREATE_CONTRACT', targetType: 'Contract', targetId: id, detail: { opportunity_id: opp.id, contract_no: contractNo } });
  approvalFlow.startFor('contract', id, req);
  created(res, db.prepare('SELECT * FROM contracts WHERE id = ?').get(id));
});

router.get('/contracts', requirePermission('contract:view'), (req, res) => {
  const paging = getPaging(req);
  const conditions = ['t.is_deleted = 0'];
  const params = [];

  const frag = dataScope.scopeFragment(req.user, 'contract');
  if (frag.sql) {
    conditions.push(frag.sql.replace(/^ AND /, ''));
    params.push(...frag.params);
  }
  if (req.query.keyword) {
    conditions.push('(t.contract_no LIKE ? OR t.contract_name LIKE ?)');
    const kw = `%${req.query.keyword}%`;
    params.push(kw, kw);
  }
  ['customer_id', 'opportunity_id', 'status'].forEach((f) => {
    if (req.query[f]) {
      conditions.push(`t.${f} = ?`);
      params.push(req.query[f]);
    }
  });
  if (req.query.start_date) {
    conditions.push('t.signed_date >= ?');
    params.push(req.query.start_date);
  }
  if (req.query.end_date) {
    conditions.push('t.signed_date <= ?');
    params.push(req.query.end_date);
  }

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM contracts t WHERE ${where}`).get(...params).c;
  const sort = buildSort(req, ['created_at', 'updated_at', 'signed_date', 'amount'], 'created_at');
  const list = db
    .prepare(
      `SELECT t.*, c.name AS customer_name, u.name AS signed_by_name, o.name AS opportunity_name FROM contracts t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = t.signed_by
       LEFT JOIN opportunities o ON o.id = t.opportunity_id
       WHERE ${where}${sort.clause} LIMIT ? OFFSET ?`
    )
    .all(...params, paging.limit, paging.offset);
  ok(res, paged(list, total, paging));
});

router.get('/contracts/:id', requirePermission('contract:view'), (req, res) => {
  const row = dataScope.findScoped('contract', 'contracts', req.params.id, req.user);
  if (!row) throw notFound('合同不存在或无权访问');
  row.customer_name = row.customer_id ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(row.customer_id) || {}).name : null;
  row.signed_by_name = row.signed_by ? (db.prepare('SELECT name FROM users WHERE id = ?').get(row.signed_by) || {}).name : null;
  ok(res, row);
});

router.put('/contracts/:id', requirePermission('contract:update'), (req, res) => {
  const before = dataScope.findScoped('contract', 'contracts', req.params.id, req.user);
  if (!before) throw notFound('合同不存在或无权访问');
  if (before.approval_status === 'pending') throw badRequest('合同审批中，暂不可修改');
  const body = bodyOf(req);

  const after = {};
  ['contract_no', 'contract_name', 'amount', 'product_type', 'signed_date', 'signed_by', 'status'].forEach((f) => {
    if (body[f] !== undefined) after[f] = body[f];
  });
  if (body.file_storage_id) {
    const file = requireFileStorage(body.file_storage_id);
    after.file_storage_id = file.id;
    after.file_url = fileUrlOf(file);
    after.file_name = file.original_name;
  }
  if (!Object.keys(after).length) throw badRequest('没有可更新的字段');

  const sets = Object.keys(after).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE contracts SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...after, id: before.id, t: now() });

  // 合同金额发生变化时重新判定审批：命中条件则重新提交审批，否则视为无需审批
  if (after.amount !== undefined && Number(after.amount) !== Number(before.amount)) {
    db.prepare("UPDATE contracts SET approval_status = 'none', approval_instance_id = NULL WHERE id = ?").run(before.id);
    approvalFlow.startFor('contract', before.id, req);
  }

  logOperation(req, { action: 'UPDATE_CONTRACT', targetType: 'Contract', targetId: before.id, detail: { fields: Object.keys(after) } });
  ok(res, db.prepare('SELECT * FROM contracts WHERE id = ?').get(before.id));
});

router.delete('/contracts/:id', requirePermission('contract:delete'), (req, res) => {
  const row = dataScope.findScoped('contract', 'contracts', req.params.id, req.user);
  if (!row) throw notFound('合同不存在或无权访问');
  if (row.approval_status === 'pending') throw badRequest('合同审批中，暂不可删除');
  db.prepare('UPDATE contracts SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
  logOperation(req, { action: 'DELETE_CONTRACT', targetType: 'Contract', targetId: row.id, detail: { contract_no: row.contract_no } });
  ok(res, { id: row.id, deleted: true });
});

module.exports = router;
