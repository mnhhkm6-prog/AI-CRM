'use strict';

/** 路由总入口：按 M1–M16 模块挂载 */
const express = require('express');

const router = express.Router();

const modules = [
  ['./m1-customers', 'M1 客户管理'],
  ['./m2-leads', 'M2 线索管理'],
  ['./m3-opportunities', 'M3 商机管理'],
  ['./m4-activities', 'M4 销售行为记录'],
  ['./m5-sales-assets', 'M5 方案与报价管理'],
  ['./m6-sea', 'M6 公海管理'],
  ['./m7-alerts', 'M7 停滞预警'],
  ['./m8-loss', 'M8 商机失效'],
  ['./m9-reports', 'M9 报表复盘'],
  ['./m10-system', 'M10 系统管理与权限'],
  ['./m11-stage-config', 'M11 漏斗配置管理'],
  ['./m12-custom-fields', 'M12 自定义字段管理'],
  ['./m13-roles', 'M13 角色与权限配置管理'],
  ['./m14-dictionaries', 'M14 系统字典管理'],
  ['./m15-views', 'M15 视图与报表配置'],
  ['./m16-implementation', 'M16 实施配置向导'],
  ['./m17-global', '全局搜索 / 通知中心 / 审批中心'],
  ['./m18-approvals', 'M18 审批流配置与审批操作'],
];

const loaded = [];
modules.forEach(([p, label]) => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  router.use(require(p));
  loaded.push(label);
});

module.exports = router;
module.exports.MODULES = loaded;
