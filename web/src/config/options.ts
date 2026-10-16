/**
 * 业务枚举与下拉选项
 * 来源：种子字典（PRD 4.8.2）与表结构枚举值
 * 说明：字典接口（/dictionaries）需 dictionary:view 权限，普通销售角色不可用，
 *       故此处内置与出厂字典一致的默认项，保证各角色均可正常录入。
 */
import * as api from '@/api'

export interface Option {
  label: string
  value: string
}

const toOptions = (arr: string[]): Option[] => arr.map((v) => ({ label: v, value: v }))

/** 客户类型 */
export const CUSTOMER_TYPES = toOptions(['企业', '个人'])

/** 客户状态（customers.status） */
export const CUSTOMER_STATUS: Option[] = [
  { label: '活跃', value: 'active' },
  { label: '公海', value: 'sea' },
  { label: '无效', value: 'invalid' },
]

/** 客户等级 */
export const CUSTOMER_LEVELS = toOptions(['A', 'B', 'C', 'D'])

/** 客户行业（字典 customer_industry） */
export const CUSTOMER_INDUSTRIES = toOptions(['互联网', '制造业', '金融', '政府', '教育', '医疗', '其他'])

/** 客户规模（字典 customer_scale） */
export const CUSTOMER_SCALES = toOptions(['微型', '小型', '中型', '大型', '集团'])

/** 来源渠道（字典 lead_source_channel） */
export const SOURCE_CHANNELS = toOptions(['电话', '展会', '线上推广', '转介绍', '其他'])

/** 线索状态（leads.status） */
export const LEAD_STATUS: Option[] = [
  { label: '新建', value: 'new' },
  { label: '跟进中', value: 'following' },
  { label: '已转商机', value: 'converted' },
  { label: '已回收', value: 'recycled' },
]

/** 行动类型（字典 activity_type） */
export const ACTIVITY_TYPES = toOptions(['电话沟通', '线下拜访', '邮件往来', '微信沟通', '其他'])

/** 商机状态（opportunities.status） */
export const OPPORTUNITY_STATUS: Option[] = [
  { label: '进行中', value: '进行中' },
  { label: '赢单', value: '赢单' },
  { label: '失败', value: '失败' },
  { label: '公海', value: '公海' },
]

/** 商机失败原因（字典 opportunity_loss_reason） */
export const LOSS_REASONS = toOptions([
  '价格过高', '方案不匹配', '客户预算不足', '竞争对手胜出', '客户项目暂停', '其他',
])

/** 产品类型（字典 product_type） */
export const PRODUCT_TYPES = ['上网链路', '数据专线', 'IDC', '云计算', '数据中台', '软件定制', '定制项目']

/** 字典编码 → 本地默认字典项（自定义字段 options 引用字典编码时使用） */
export const DICT_LOCAL: Record<string, string[]> = {
  product_type: PRODUCT_TYPES,
  customer_industry: CUSTOMER_INDUSTRIES.map((o) => o.value),
  customer_scale: CUSTOMER_SCALES.map((o) => o.value),
  lead_source_channel: SOURCE_CHANNELS.map((o) => o.value),
  activity_type: ACTIVITY_TYPES.map((o) => o.value),
  opportunity_loss_reason: LOSS_REASONS.map((o) => o.value),
}

export const labelOf = (options: Option[], value?: string | null) =>
  options.find((o) => o.value === value)?.label || value || ''

/**
 * 负责人候选列表
 * - 拥有 user:view 权限时拉取全部在职用户；否则仅返回当前用户（销售自助场景）
 */
export async function loadOwnerOptions(hasUserView: boolean, current?: { id: string; name: string }): Promise<Option[]> {
  if (hasUserView) {
    try {
      const res = await api.listUsers({ page_size: 200, status: 'enabled' })
      const list = (res.list || []).map((u: any) => ({ label: `${u.name}（${u.username}）`, value: u.id }))
      if (list.length) return list
    } catch (e) {
      /* 无权限或接口异常时回退为仅本人 */
    }
  }
  return current ? [{ label: `${current.name}（我）`, value: current.id }] : []
}
