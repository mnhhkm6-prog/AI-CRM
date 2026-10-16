'use strict';

/** 业务语义错误码（详见 docs/后端API接口清单.md 1.5） */
const CODE = {
  FIXED_ACTION: 1001,          // 固定动作未完成，禁止推进
  STAGE_MAPPING: 1002,         // 阶段配置变更未映射存量商机
  SEA_LIMIT: 1003,             // 公海领取超上限
  IN_PROTECTION: 1004,         // 数据在保护期内
  DUPLICATE: 1005,             // 客户/线索重复
  DICT_REFERENCED: 1006,       // 字典项被引用，禁止删除
  FIELD_REFERENCED: 1007,      // 自定义字段被引用，禁止删除
  ROLE_PERMISSION_CONFIRM: 1008, // 角色权限变更需二次确认
  LOSS_APPROVAL: 1009,         // 失效审批未通过
};

class BizError extends Error {
  /**
   * @param {string} message 错误文案
   * @param {number} httpStatus HTTP 状态码
   * @param {number|null} code 业务错误码
   * @param {any} details 附加明细（如未完成的固定动作清单）
   */
  constructor(message, httpStatus = 400, code = null, details = null) {
    super(message);
    this.name = 'BizError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, code = null, details = null) => new BizError(message, 400, code, details);
const unauthorized = (message = '缺少身份信息，请携带请求头 X-User-Id') => new BizError(message, 401);
const forbidden = (message = '无权访问该数据范围') => new BizError(message, 403);
const notFound = (message = '资源不存在') => new BizError(message, 404);
const conflict = (message, code = null, details = null) => new BizError(message, 409, code, details);

module.exports = { CODE, BizError, badRequest, unauthorized, forbidden, notFound, conflict };
