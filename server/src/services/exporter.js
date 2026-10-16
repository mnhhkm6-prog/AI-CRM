'use strict';

/** 报表导出：Excel 用 exceljs；PDF 本期输出可打印 HTML（浏览器打印为 PDF） */
const ExcelJS = require('exceljs');

async function buildExcel({ sheetName = 'Sheet1', columns, rows }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '自研 CRM';
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  return wb.xlsx.writeBuffer();
}

async function writeExcel(res, { filename = 'export.xlsx', sheetName, columns, rows }) {
  const buf = await buildExcel({ sheetName, columns, rows });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  return res.end(Buffer.from(buf));
}

function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function writeHtml(res, { filename = 'export.html', title = '报表', columns, rows, extraHtml = '' }) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;padding:24px;color:#1f2329}
  h1{font-size:18px;margin:0 0 4px}
  .meta{color:#8a9099;font-size:12px;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{border:1px solid #e5e6eb;padding:6px 8px;text-align:left}
  th{background:#f5f7fa}
  @media print{ .noprint{display:none} }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">导出时间：${new Date().toLocaleString('zh-CN')}　（浏览器内 Ctrl/Cmd+P 可另存为 PDF）</div>
${extraHtml}
<table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>
</body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  return res.end(html);
}

module.exports = { buildExcel, writeExcel, writeHtml };
