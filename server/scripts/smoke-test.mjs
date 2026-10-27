/**
 * 端到端冒烟测试（覆盖 M1–M16 主链路 + 定时任务 + 导出）
 * 用法：先启动服务（npm start），再执行 npm run smoke
 * 也可指定地址：BASE=http://localhost:3000/api/v1 npm run smoke
 */
const BASE = process.env.BASE || 'http://localhost:3000/api/v1';
const stamp = Date.now().toString().slice(-6);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, extra) {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ❌ ${name}${extra ? ` → ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
  }
}

async function api(method, path, { body, user = 'admin', raw = false } = {}) {
  const headers = { 'X-User-Id': user };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

async function main() {
  console.log(`\n=== CRM 后端冒烟测试（BASE=${BASE}）===\n`);

  // ---------------------------------------------------------------- 基础
  console.log('【M10 基础】');
  const health = await api('GET', '/health', { user: null });
  check('GET /health 免登录可用', health.status === 200 && health.body.data.status === 'ok', health.body);

  const me = await api('GET', '/me', { user: 'sales01' });
  check('GET /me 返回销售身份与数据范围', me.status === 200 && me.body.data.role_code === 'sales', me.body);

  const noAuth = await api('GET', '/customers', { user: null });
  check('缺少 X-User-Id 时返回 401', noAuth.status === 401, noAuth.body);

  // ---------------------------------------------------------------- M1 客户
  console.log('\n【M1 客户管理】');
  const customerName = `冒烟客户${stamp}`;
  // 手机号按运行批次唯一，避免多次运行相互干扰查重断言
  const uniquePhone = `138${stamp.padEnd(8, '0')}`;
  const dupCheck = await api('POST', '/customers/check-duplicate', {
    user: 'sales01',
    body: { name: customerName, phone: uniquePhone },
  });
  check('POST /customers/check-duplicate 查重可用', dupCheck.status === 200 && dupCheck.body.data.duplicated === false, dupCheck.body);

  const customer = await api('POST', '/customers', {
    user: 'sales01',
    body: {
      name: customerName,
      type: '企业',
      industry: '互联网',
      scale: '中型',
      source_channel: '转介绍',
      custom_fields: { biz_needs: '需要一套 CRM' },
    },
  });
  const customerId = customer.body?.data?.id;
  check('POST /customers 新增客户（含自定义字段）', customer.status === 201 && !!customerId, customer.body);

  const dupAgain = await api('POST', '/customers', {
    user: 'sales01',
    body: { name: customerName, source_channel: '电话' },
  });
  check('同名客户返回 1005 重复码', dupAgain.status === 409 && dupAgain.body.code === 1005, dupAgain.body);

  const contact = await api('POST', `/customers/${customerId}/contacts`, {
    user: 'sales01',
    body: { name: '刘经理', phone: '13800000000', title: 'IT 总监', is_primary: true },
  });
  check('POST /customers/{id}/contacts 新增联系人', contact.status === 201, contact.body);

  const customer360 = await api('GET', `/customers/${customerId}/360`, { user: 'sales01' });
  check('GET /customers/{id}/360 汇总可用', customer360.status === 200 && !!customer360.body.data.customer, customer360.body);

  const salesList = await api('GET', '/customers?page=1&page_size=5', { user: 'sales01' });
  const hrList = await api('GET', '/customers', { user: 'hr01' });
  check('客户列表按数据权限过滤（销售仅见本人）', salesList.status === 200 && salesList.body.data.total >= 1, salesList.body);
  check('无客户权限的角色被拒绝（人事）', hrList.status === 403, hrList.body);

  // ---------------------------------------------------------------- M2 线索
  console.log('\n【M2 线索管理】');
  const lead = await api('POST', '/leads', {
    user: 'sales01',
    body: {
      name: `冒烟线索${stamp}`,
      source_channel: '展会',
      customer_id: customerId,
      contact_name: '冒烟联系人',
      contact_phone: '13800000000',
    },
  });
  const leadId = lead.body?.data?.id;
  check('POST /leads 线索录入', lead.status === 201 && !!leadId, lead.body);

  const assigned = await api('POST', `/leads/${leadId}/assign`, { user: 'manager01', body: { owner_id: me.body.data.id } });
  check('POST /leads/{id}/assign 分配线索', assigned.status === 200, assigned.body);

  const converted = await api('POST', `/leads/${leadId}/convert`, {
    user: 'sales01',
    body: { opportunity_name: `冒烟商机${stamp}`, amount: 500000 },
  });
  const opportunityId = converted.body?.data?.opportunity_id;
  check('POST /leads/{id}/convert 转商机', converted.status === 201 && !!opportunityId, converted.body);

  // ---------------------------------------------------------------- M3 商机
  console.log('\n【M3 商机管理 + 固定动作校验引擎】');
  const opp = await api('GET', `/opportunities/${opportunityId}`, { user: 'sales01' });
  check('GET /opportunities/{id} 返回当前阶段与完成度', opp.status === 200 && !!opp.body.data.stage, opp.body);

  const check1 = await api('GET', `/opportunities/${opportunityId}/advance-check`, { user: 'sales01' });
  check('GET /opportunities/{id}/advance-check 返回固定动作清单', check1.status === 200 && check1.body.data.items.length > 0, check1.body);

  // S0（纯客户信息录入）无固定动作，可直接推进至 S1
  const advanceS0 = await api('POST', `/opportunities/${opportunityId}/advance`, { user: 'sales01', body: { to_stage: 'S1' } });
  check('S0→S1 推进成功（起点阶段无固定动作）', advanceS0.status === 200 && advanceS0.body.data.opportunity.stage_name_snapshot === '客户触达', advanceS0.body);

  // S1 固定动作未完成时推进被拦截
  const badAdvance = await api('POST', `/opportunities/${opportunityId}/advance`, { user: 'sales01', body: { to_stage: 'S2' } });
  check('未完成固定动作时推进被拦截（1001）', badAdvance.status === 409 && badAdvance.body.code === 1001, badAdvance.body);

  const skipAdvance = await api('POST', `/opportunities/${opportunityId}/advance`, { user: 'sales01', body: { to_stage: 'S3' } });
  check('跳阶段推进被拒绝', skipAdvance.status === 400, skipAdvance.body);

  // 行为记录
  const activity = await api('POST', '/activities', {
    user: 'sales01',
    body: {
      opportunity_id: opportunityId,
      activity_type: '电话沟通',
      activity_time: new Date().toISOString(),
      follow_up_time: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      content: '首次电话沟通，确认有初步业务诉求',
    },
  });
  check('POST /activities 新增行为记录', activity.status === 201, activity.body);

  // S1 -> S2
  const advanceS1 = await api('POST', `/opportunities/${opportunityId}/advance`, {
    user: 'sales01',
    body: {
      to_stage: 'S2',
      action_values: {
        customer_background: '互联网行业，员工 300 人，主营 SaaS',
        demand_biz_types: ['云计算', '数据中台'],
        expected_close_date: '2026-12-31',
        demand_desc: '需要统一客户管理与销售流程管理',
      },
    },
  });
  check('S1→S2 固定动作齐备后推进成功', advanceS1.status === 200 && advanceS1.body.data.opportunity.stage_name_snapshot === '需求匹配与方案制定', advanceS1.body);

  // S2 所需材料：初步方案 / 产品价格 / 竞争对手字段
  const proposalPre = await api('POST', `/opportunities/${opportunityId}/proposals`, {
    user: 'sales01',
    body: { proposal_type: 'preliminary', file_name: '初步方案v1.pdf', file_url: '/uploads/demo.pdf' },
  });
  check('POST /opportunities/{id}/proposals 上传初步方案', proposalPre.status === 201, proposalPre.body);

  const price = await api('POST', '/products/prices', { user: 'purchase01', body: { product_type: '云计算', price: 300000, remark: '冒烟测试价格' } });
  check('POST /products/prices 录入产品价格', price.status === 201, price.body);

  const advanceS2 = await api('POST', `/opportunities/${opportunityId}/advance`, {
    user: 'sales01',
    body: {
      to_stage: 'S3',
      action_values: {
        demand_survey_done: true,
        real_demand_list: '客户真实需求：客户主数据 + 销售流程 + 报表',
        competitor_name: '某某云',
      },
    },
  });
  check('S2→S3 推进成功', advanceS2.status === 200 && advanceS2.body.data.opportunity.stage_name_snapshot === '方案确定与跟进', advanceS2.body);

  const proposalFormal = await api('POST', `/opportunities/${opportunityId}/proposals`, {
    user: 'sales01',
    body: { proposal_type: 'formal', file_name: '正式方案v2.pdf', file_url: '/uploads/demo2.pdf' },
  });
  const quotationFinal = await api('POST', `/opportunities/${opportunityId}/quotations`, {
    user: 'sales01',
    body: { quotation_type: 'final', amount: 480000, product_type: '云计算', file_name: '最终报价.xlsx' },
  });
  check('正式方案 + 最终报价上传成功', proposalFormal.status === 201 && quotationFinal.status === 201, { proposalFormal: proposalFormal.body, quotationFinal: quotationFinal.body });

  const competitor = await api('POST', '/competitor-masters', { user: 'sales01', body: { name: `某某云${stamp}`, industry: '云计算' } });
  const competitorOpp = await api('POST', `/opportunities/${opportunityId}/competitors`, {
    user: 'sales01',
    body: { name: '某某云', strengths: '价格低', weaknesses: '服务差' },
  });
  check('竞争对手主数据与商机竞对录入', competitor.status === 201 && competitorOpp.status === 201, { competitor: competitor.body, competitorOpp: competitorOpp.body });

  const advanceS3 = await api('POST', `/opportunities/${opportunityId}/advance`, {
    user: 'sales01',
    body: {
      to_stage: 'S4',
      action_values: { customer_price_demand: '希望整体下浮 5%', compare_test_done: true },
    },
  });
  check('S3→S4 推进成功', advanceS3.status === 200 && advanceS3.body.data.opportunity.stage_name_snapshot === '合同推进', advanceS3.body);

  const closeWin = await api('POST', `/opportunities/${opportunityId}/close-win`, {
    user: 'sales01',
    body: { contract: { contract_no: `HT-${stamp}`, amount: 480000, signed_date: '2026-10-16' } },
  });
  check('POST /opportunities/{id}/close-win 赢单并落合同', closeWin.status === 200 && closeWin.body.data.opportunity.status === '赢单', closeWin.body);

  const closedAdvance = await api('POST', `/opportunities/${opportunityId}/advance`, { user: 'sales01', body: { to_stage: 'S1' } });
  check('终态商机不可再变更阶段', closedAdvance.status === 400, closedAdvance.body);

  const progress = await api('GET', `/opportunities/${opportunityId}/stage-progress`, { user: 'sales01' });
  const timeline = await api('GET', `/opportunities/${opportunityId}/timeline`, { user: 'sales01' });
  check('阶段进度与流转历史可查', progress.status === 200 && timeline.status === 200 && timeline.body.data.length >= 5, { progress: progress.status, timeline: timeline.body?.data?.length });

  const rollbackNoPerm = await api('POST', `/opportunities/${opportunityId}/rollback`, { user: 'sales01', body: { to_stage: 'S3', reason: '客户反悔' } });
  check('销售无阶段回退权限（403）', rollbackNoPerm.status === 403, rollbackNoPerm.body);

  // ---------------------------------------------------------------- 失效流程
  console.log('\n【M8 商机失效（含审批）】');
  const opp2 = await api('POST', '/opportunities', {
    user: 'sales01',
    body: { name: `冒烟失效商机${stamp}`, customer_id: customerId, amount: 100000 },
  });
  const opportunity2Id = opp2.body?.data?.id;
  check('POST /opportunities 新建商机（默认起点阶段）', opp2.status === 201 && !!opportunity2Id, opp2.body);

  const closeLoss = await api('POST', `/opportunities/${opportunity2Id}/close-loss`, {
    user: 'sales01',
    body: { loss_reason: '价格过高', loss_detail: '客户预算仅 5 万', competitor_name: '低价竞争对手' },
  });
  check('POST /opportunities/{id}/close-loss 生成失效申请', closeLoss.status === 200 && closeLoss.body.data.approval_status === 'pending', closeLoss.body);

  const lossList = await api('GET', '/loss-records?approval_status=pending', { user: 'manager01' });
  check('GET /loss-records 待审批列表', lossList.status === 200 && lossList.body.data.total >= 1, lossList.body);

  const lossId = closeLoss.body?.data?.id;
  const approveLoss = await api('POST', `/loss-records/${lossId}/approve`, { user: 'manager01', body: { comment: '同意失效' } });
  check('POST /loss-records/{id}/approve 审批通过后商机转失效', approveLoss.status === 200 && approveLoss.body.data.opportunity.status === '失败', approveLoss.body);

  // ---------------------------------------------------------------- M6 公海
  console.log('\n【M6 公海管理】');
  const release = await api('POST', `/customers/${customerId}/release-to-sea`, { user: 'sales01', body: { reason: '长期无跟进' } });
  check('POST /customers/{id}/release-to-sea 转公海', release.status === 200, release.body);

  const seaList = await api('GET', '/sea-pool?type=customer', { user: 'manager01' });
  check('GET /sea-pool 公海池列表', seaList.status === 200 && seaList.body.data.total >= 1, seaList.body);

  const seaRules = await api('GET', '/sea-pool/rules', { user: 'manager01' });
  check('GET /sea-pool/rules 公海规则', seaRules.status === 200 && seaRules.body.data.personal_max === 20, seaRules.body);

  const pickupBySelf = await api('POST', `/sea-pool/customer/${customerId}/pickup`, { user: 'sales01' });
  check('POST /sea-pool/{type}/{id}/pickup 领取（保护期/上限校验生效）', pickupBySelf.status === 200, pickupBySelf.body);

  const assignBack = await api('POST', `/sea-pool/customer/${customerId}/assign`, { user: 'manager01', body: { owner_id: me.body.data.id } });
  check('POST /sea-pool/{type}/{id}/assign 主管分配', assignBack.status === 200, assignBack.body);

  const autoAssign = await api('POST', '/sea-pool/auto-assign/run', { user: 'manager01' });
  check('POST /sea-pool/auto-assign/run 自动分配（P2）', autoAssign.status === 200, autoAssign.body);

  // ---------------------------------------------------------------- M7 停滞预警
  console.log('\n【M7 停滞预警 + 定时任务】');
  // 停滞检测只扫描「进行中」商机，此处补一条在途商机以保证扫描命中
  const oppInFlight = await api('POST', '/opportunities', {
    user: 'admin',
    body: { name: `冒烟在途商机${stamp}`, customer_id: customerId, amount: 200000 },
  });
  check('POST /opportunities 新建在途商机（供停滞检测）', oppInFlight.status === 201, oppInFlight.body);

  const jobRun = await api('POST', '/jobs/stale-alert/run', { user: 'admin' });
  check('POST /jobs/stale-alert/run 手工触发停滞检测', jobRun.status === 200 && jobRun.body.data.scanned >= 1, jobRun.body);

  const alerts = await api('GET', '/alerts', { user: 'manager01' });
  check('GET /alerts 预警列表', alerts.status === 200, alerts.body);

  const unadvanced = await api('GET', '/alerts/unadvanced?min_days=0', { user: 'manager01' });
  check('GET /alerts/unadvanced 未推进商机列表', unadvanced.status === 200 && Array.isArray(unadvanced.body.data.list), unadvanced.body);

  const explain = await api('POST', `/opportunities/${opportunity2Id}/stagnation-explain`, {
    user: 'sales01',
    body: { reason: '客户预算未批复', detail: '等待客户内部审批', expected_date: '2026-11-30' },
  });
  check('POST /opportunities/{id}/stagnation-explain 停滞说明申请', explain.status === 200 || explain.status === 201, explain.body);

  if (explain.body?.data?.id) {
    const approveExplain = await api('POST', `/stagnation-explains/${explain.body.data.id}/approve`, { user: 'manager01' });
    check('POST /stagnation-explains/{id}/approve 审批通过解除预警', approveExplain.status === 200, approveExplain.body);
  }

  const alertCfg = await api('GET', '/system/configs/alert', { user: 'admin' });
  check('GET /system/configs/alert 预警阈值配置', alertCfg.status === 200, alertCfg.body);

  const alertCfgNoConfirm = await api('PUT', '/system/configs/alert', { user: 'admin', body: { level1_days: 5 } });
  check('修改预警阈值未二次确认被拒绝', alertCfgNoConfirm.status === 409, alertCfgNoConfirm.body);

  const alertCfgPut = await api('PUT', '/system/configs/alert', {
    user: 'admin',
    body: { level1_days: 7, level2_days: 14, level3_days: 21, fallback_days: 7, confirm: true },
  });
  check('PUT /system/configs/alert 二次确认后写入', alertCfgPut.status === 200, alertCfgPut.body);

  // ---------------------------------------------------------------- M9 报表
  console.log('\n【M9 报表复盘 + 导出】');
  const funnel = await api('GET', '/reports/funnel', { user: 'manager01' });
  check('GET /reports/funnel 漏斗报表（按阶段快照分组）', funnel.status === 200 && Array.isArray(funnel.body.data.list ?? funnel.body.data), funnel.body);

  const stagnation = await api('GET', '/reports/stagnation', { user: 'manager01' });
  check('GET /reports/stagnation 停滞复盘', stagnation.status === 200, stagnation.body);

  const lossReport = await api('GET', '/reports/loss', { user: 'manager01' });
  check('GET /reports/loss 失效复盘', lossReport.status === 200, lossReport.body);

  const personal = await api('GET', '/reports/personal', { user: 'sales01' });
  check('GET /reports/personal 个人报表', personal.status === 200, personal.body);

  const team = await api('GET', '/reports/team', { user: 'manager01' });
  check('GET /reports/team 团队报表', team.status === 200, team.body);

  const exportRes = await api('GET', '/reports/funnel/export?format=excel', { user: 'manager01', raw: true });
  check('GET /reports/{type}/export Excel 导出', exportRes.status === 200 && String(exportRes.headers.get('content-type')).includes('spreadsheet'), exportRes.headers.get('content-type'));

  const exportHtml = await api('GET', '/reports/funnel/export?format=html', { user: 'manager01', raw: true });
  check('GET /reports/{type}/export HTML（可打印 PDF）', exportHtml.status === 200, exportHtml.headers.get('content-type'));

  // ---------------------------------------------------------------- M10 系统管理
  console.log('\n【M10 系统管理与权限】');
  const users = await api('GET', '/users?page=1&page_size=5', { user: 'admin' });
  check('GET /users 用户列表', users.status === 200 && users.body.data.total >= 8, users.body);

  const newUser = await api('POST', '/users', {
    user: 'admin',
    body: { username: `smoke${stamp}`, name: '冒烟账号', password: '123456', role_id: me.body.data.role_id, department_id: me.body.data.department_id },
  });
  check('POST /users 新增用户', newUser.status === 201, newUser.body);

  const disableUser = await api('POST', `/users/${newUser.body?.data?.id}/disable`, { user: 'admin', body: { status: 'disabled' } });
  check('POST /users/{id}/disable 禁用用户', disableUser.status === 200, disableUser.body);

  const depts = await api('GET', '/departments', { user: 'admin' });
  check('GET /departments 部门树', depts.status === 200 && Array.isArray(depts.body.data), depts.body);

  const seaCfg = await api('GET', '/system/configs/sea', { user: 'admin' });
  check('GET /system/configs/sea 公海规则', seaCfg.status === 200, seaCfg.body);

  const loginCfg = await api('GET', '/system/login-config', { user: 'admin' });
  check('GET /system/login-config 登录方式配置', loginCfg.status === 200, loginCfg.body);

  const pubLoginCfg = await api('GET', '/auth/login-config', { user: 'admin' });
  check('GET /auth/login-config 登录页公开配置（免登录）', pubLoginCfg.status === 200 && !!pubLoginCfg.body.data.login_mode, pubLoginCfg.body);

  const badLogin = await api('POST', '/auth/login', { body: { username: 'admin', password: 'wrong-password' } });
  check('POST /auth/login 密码错误返回 401', badLogin.status === 401, badLogin.body);

  const login = await api('POST', '/auth/login', { body: { username: 'admin', password: '123456' } });
  check('POST /auth/login 登录成功并返回令牌', login.status === 200 && !!login.body.data.token, login.body);

  const token = login.body.data.token;
  const meByToken = await fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meByTokenBody = await meByToken.json();
  check('Bearer 令牌可访问受保护接口 /me', meByToken.status === 200 && meByTokenBody.data.username === 'admin', meByTokenBody);

  const logout = await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  check('POST /auth/logout 退出登录', logout.status === 200, null);

  const afterLogout = await fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
  check('退出登录后令牌失效（401）', afterLogout.status === 401, null);

  const logs = await api('GET', '/operation-logs?page=1&page_size=5', { user: 'admin' });
  check('GET /operation-logs 操作日志', logs.status === 200 && logs.body.data.total >= 1, logs.body);

  const backup = await api('POST', '/system/backups', { user: 'admin' });
  check('POST /system/backups 立即备份', backup.status === 201 || backup.status === 200, backup.body);

  // ---------------------------------------------------------------- M11 漏斗配置
  console.log('\n【M11 漏斗配置管理】');
  const stages = await api('GET', '/stage-configs', { user: 'admin' });
  check('GET /stage-configs 阶段列表（含内置终态）', stages.status === 200 && stages.body.data.length === 7, stages.body);

  const stageRules = await api('GET', `/stage-configs/${stages.body.data[1].id}/action-rules`, { user: 'admin' });
  check('GET /stage-configs/{id}/action-rules 固定动作清单', stageRules.status === 200 && stageRules.body.data.length >= 5, stageRules.body);

  const delSystemStage = await api('DELETE', `/stage-configs/${stages.body.data[0].id}`, { user: 'admin' });
  check('内置起点阶段禁止删除', delSystemStage.status === 409, delSystemStage.body);

  const newStage = await api('POST', '/stage-configs', { user: 'admin', body: { name: '冒烟阶段', code: `X${stamp}`, sort_order: 55 } });
  check('POST /stage-configs 新增阶段', newStage.status === 201, newStage.body);

  const addRule = await api('POST', `/stage-configs/${newStage.body?.data?.id}/action-rules`, {
    user: 'admin',
    body: { action_name: '冒烟必填项', field_key: 'demand_desc', field_type: 'textarea', is_required: true },
  });
  check('POST /stage-configs/{id}/action-rules 新增固定动作', addRule.status === 201, addRule.body);

  const versions = await api('GET', '/stage-configs/versions', { user: 'admin' });
  check('GET /stage-configs/versions 配置版本历史', versions.status === 200 && Array.isArray(versions.body.data), versions.body);

  const mappingPreview = await api('POST', '/stage-configs/mapping/preview', { user: 'admin', body: { changes: [] } });
  check('POST /stage-configs/mapping/preview 存量映射预览', mappingPreview.status === 200, mappingPreview.body);

  const toggleNoPerm = await api('POST', `/stage-configs/${newStage.body?.data?.id}/toggle`, { user: 'manager01', body: { is_enabled: false } });
  check('非系统管理员无漏斗配置权限（403）', toggleNoPerm.status === 403, toggleNoPerm.body);

  const deleteStage = await api('DELETE', `/stage-configs/${newStage.body?.data?.id}`, { user: 'admin' });
  check('DELETE /stage-configs/{id} 删除自定义阶段', deleteStage.status === 200, deleteStage.body);

  // ---------------------------------------------------------------- M12 自定义字段
  console.log('\n【M12 自定义字段管理】');
  const fields = await api('GET', '/custom-fields?entity_type=opportunity', { user: 'admin' });
  check('GET /custom-fields 商机自定义字段（出厂 9 个）', fields.status === 200 && fields.body.data.length >= 9, fields.body);

  const stageOptions = await api('GET', '/stage-options', { user: 'admin' });
  const stageS1 = (stageOptions.body?.data || []).find((s) => s.code === 'S1');
  const newField = await api('POST', '/custom-fields', {
    user: 'admin',
    body: { entity_type: 'opportunity', field_code: `smoke_field_${stamp}`, field_name: '冒烟字段', field_type: 'text', stage_config_id: stageS1?.id },
  });
  check('POST /custom-fields 新增字段定义', newField.status === 201, newField.body);

  const fieldRefs = await api('GET', `/custom-fields/${newField.body?.data?.id}/references`, { user: 'admin' });
  check('GET /custom-fields/{id}/references 引用检查', fieldRefs.status === 200, fieldRefs.body);

  const usedField = fields.body.data.find((f) => f.field_code === 'demand_desc');
  const delUsedField = await api('DELETE', `/custom-fields/${usedField.id}`, { user: 'admin' });
  check('被阶段固定动作引用的字段禁止删除（1007）', delUsedField.status === 409 && delUsedField.body.code === 1007, delUsedField.body);

  const fieldValues = await api('GET', `/custom-fields/values/opportunity/${opportunityId}`, { user: 'admin' });
  check('GET /custom-fields/values/{entity_type}/{id} 读取值', fieldValues.status === 200 && fieldValues.body.data.demand_desc, fieldValues.body);

  const putValues = await api('PUT', `/custom-fields/values/opportunity/${opportunityId}`, {
    user: 'admin',
    body: { values: { demand_desc: '冒烟测试更新后的需求描述' } },
  });
  check('PUT /custom-fields/values/... 写入值', putValues.status === 200, putValues.body);

  const delNewField = await api('DELETE', `/custom-fields/${newField.body?.data?.id}`, { user: 'admin' });
  check('未被引用字段可删除', delNewField.status === 200, delNewField.body);

  // ---------------------------------------------------------------- M13 角色权限
  console.log('\n【M13 角色与权限配置】');
  const roles = await api('GET', '/roles', { user: 'admin' });
  check('GET /roles 预置 7+1 角色', roles.status === 200 && roles.body.data.length >= 8, roles.body);

  const perms = await api('GET', '/permissions', { user: 'admin' });
  check('GET /permissions 权限点清单', perms.status === 200 && perms.body.data.length >= 60, perms.body);

  const salesRole = roles.body.data.find((r) => r.role_code === 'sales');
  const rolePerms = await api('GET', `/roles/${salesRole.id}/permissions`, { user: 'admin' });
  check('GET /roles/{id}/permissions 功能权限矩阵', rolePerms.status === 200, rolePerms.body);

  const roleScopes = await api('GET', `/roles/${salesRole.id}/data-scopes`, { user: 'admin' });
  check('GET /roles/{id}/data-scopes 数据权限（销售=self）', roleScopes.status === 200, roleScopes.body);

  const scopePut = await api('PUT', `/roles/${salesRole.id}/data-scopes`, {
    user: 'admin',
    body: { scopes: [{ resource_type: 'opportunity', data_scope: 'self' }], confirm: true },
  });
  check('PUT /roles/{id}/data-scopes 保存数据权限', scopePut.status === 200, scopePut.body);

  const rolePreview = await api('GET', `/roles/${salesRole.id}/permission-change-preview`, { user: 'admin' });
  check('GET /roles/{id}/permission-change-preview 变更影响预览', rolePreview.status === 200, rolePreview.body);

  const roleMembers = await api('GET', `/roles/${salesRole.id}/members`, { user: 'admin' });
  check('GET /roles/{id}/members 角色成员', roleMembers.status === 200 && roleMembers.body.data.length >= 1, roleMembers.body);

  const newRole = await api('POST', '/roles', { user: 'admin', body: { role_name: `冒烟角色${stamp}` } });
  check('POST /roles 新增自定义角色', newRole.status === 201, newRole.body);

  const copyRole = await api('POST', `/roles/${salesRole.id}/copy`, { user: 'admin', body: { role_name: `冒烟副本${stamp}` } });
  check('POST /roles/{id}/copy 复制角色', copyRole.status === 201, copyRole.body);

  const delCopy = await api('DELETE', `/roles/${copyRole.body?.data?.id}`, { user: 'admin' });
  check('DELETE /roles/{id} 删除自定义角色', delCopy.status === 200, delCopy.body);

  const delSystemRole = await api('DELETE', `/roles/${salesRole.id}`, { user: 'admin' });
  check('系统内置角色禁止删除', delSystemRole.status === 409, delSystemRole.body);

  // ---------------------------------------------------------------- M14 字典
  console.log('\n【M14 系统字典】');
  const dicts = await api('GET', '/dictionaries', { user: 'admin' });
  check('GET /dictionaries 预置 6 类字典', dicts.status === 200 && dicts.body.data.length >= 6, dicts.body);

  const dictId = dicts.body.data.find((d) => d.dict_code === 'lead_source_channel').id;
  const dictItems = await api('GET', `/dictionaries/${dictId}/items`, { user: 'admin' });
  check('GET /dictionaries/{id}/items 字典项', dictItems.status === 200 && dictItems.body.data.length >= 5, dictItems.body);

  const newItem = await api('POST', `/dictionaries/${dictId}/items`, { user: 'admin', body: { item_code: `it_${stamp}`, item_name: '冒烟渠道' } });
  check('POST /dictionaries/{id}/items 新增字典项', newItem.status === 201 || newItem.status === 200, newItem.body);

  const usedItem = dictItems.body.data.find((i) => i.item_name === '转介绍');
  const delUsedItem = await api('DELETE', `/dictionary-items/${usedItem.id}`, { user: 'admin' });
  check('被业务数据引用的字典项删除需二次确认（1006）', delUsedItem.status === 409 && delUsedItem.body.code === 1006, delUsedItem.body);

  const dictRefs = await api('GET', `/dictionaries/${dictId}/references`, { user: 'admin' });
  check('GET /dictionaries/{id}/references 引用明细', dictRefs.status === 200, dictRefs.body);

  const delNewItem = await api('DELETE', `/dictionary-items/${newItem.body?.data?.id}`, { user: 'admin' });
  check('新增字典项可删除', delNewItem.status === 200, delNewItem.body);

  // ---------------------------------------------------------------- M15 视图报表配置
  console.log('\n【M15 视图与报表配置】');
  const views = await api('GET', '/views?entity_type=customer', { user: 'sales01' });
  check('GET /views 返回默认+个人+共享视图', views.status === 200 && views.body.data.length >= 2, views.body);

  const newView = await api('POST', '/views', {
    user: 'sales01',
    body: { view_name: `冒烟视图${stamp}`, entity_type: 'customer', columns: ['name', 'industry'], default_filter: [] },
  });
  check('POST /views 新增个人视图', newView.status === 201, newView.body);

  const setDefault = await api('POST', `/views/${newView.body?.data?.id}/set-default`, { user: 'sales01' });
  check('POST /views/{id}/set-default 设为默认视图', setDefault.status === 200, setDefault.body);

  const templates = await api('GET', '/report-templates', { user: 'manager01' });
  check('GET /report-templates 预置 5 张报表模板', templates.status === 200 && templates.body.data.length >= 5, templates.body);

  const previewTpl = await api('POST', `/report-templates/${templates.body.data[0].id}/preview`, { user: 'manager01' });
  check('POST /report-templates/{id}/preview 模板预览', previewTpl.status === 200 && Array.isArray(previewTpl.body.data.rows), previewTpl.body);

  const subscription = await api('POST', '/report-subscriptions', {
    user: 'manager01',
    body: { template_id: templates.body.data[0].id, frequency: 'weekly', receivers: ['manager01@example.com'], format: 'excel' },
  });
  check('POST /report-subscriptions 新增订阅', subscription.status === 201 || subscription.status === 200, subscription.body);

  const subscriptions = await api('GET', '/report-subscriptions', { user: 'manager01' });
  check('GET /report-subscriptions 订阅列表', subscriptions.status === 200, subscriptions.body);

  // ---------------------------------------------------------------- M16 实施向导
  console.log('\n【M16 实施配置向导】');
  const wizardState = await api('GET', '/implementation/wizard/state', { user: 'admin' });
  check('GET /implementation/wizard/state 向导状态', wizardState.status === 200, wizardState.body);

  const wizardStep = await api('POST', '/implementation/wizard/step', {
    user: 'admin',
    body: { step: 'basic', mode: 'default', payload: { company_name: '冒烟测试企业' } },
  });
  check('POST /implementation/wizard/step 提交步骤', wizardStep.status === 200, wizardStep.body);

  const tpls = await api('GET', '/implementation/templates', { user: 'admin' });
  check('GET /implementation/templates 模板包列表（含出厂模板）', tpls.status === 200 && tpls.body.data.length >= 1, tpls.body);

  const exportTpl = await api('POST', '/implementation/templates/export', {
    user: 'admin',
    body: { template_name: `冒烟模板${stamp}`, template_version: '1.0.0', description: '冒烟测试导出' },
  });
  check('POST /implementation/templates/export 导出配置模板包', exportTpl.status === 201 || exportTpl.status === 200, exportTpl.body);

  const importPreview = await api('POST', '/implementation/templates/import', {
    user: 'admin',
    body: { config_data: { stage_configs: [{ code: 'S0', name: '客户数据录入' }], dictionary_types: [] } },
  });
  check('POST /implementation/templates/import 冲突预览', importPreview.status === 200 && Array.isArray(importPreview.body.data.conflicts), importPreview.body);

  const wizardFinish = await api('POST', '/implementation/wizard/finish', { user: 'admin' });
  check('POST /implementation/wizard/finish 完成向导并生成清单', wizardFinish.status === 200, wizardFinish.body);

  const delTpl = await api('DELETE', `/implementation/templates/${exportTpl.body?.data?.id}`, { user: 'admin' });
  check('DELETE /implementation/templates/{id} 删除模板包', delTpl.status === 200, delTpl.body);

  // ---------------------------------------------------------------- 全局能力（全局搜索 / 通知中心 / 审批中心）
  console.log('\n【全局能力：搜索 / 通知 / 审批中心】');
  const searchShort = await api('GET', '/search?keyword=%E5%86%92', { user: 'admin' });
  check('GET /search 关键字不足 2 字符返回空分组', searchShort.status === 200 && searchShort.body.data.customers.length === 0, searchShort.body);

  const search = await api('GET', `/search?keyword=${encodeURIComponent(customerName)}`, { user: 'admin' });
  check(
    'GET /search 全局搜索命中客户分组',
    search.status === 200 && search.body.data.customers.length >= 1 && Array.isArray(search.body.data.contacts),
    search.body
  );

  const noticeList = await api('GET', '/notifications?page=1&page_size=10', { user: 'sales01' });
  check('GET /notifications 消息通知中心（含未读数）', noticeList.status === 200 && typeof noticeList.body.data.unread === 'number', noticeList.body);

  const noticeReadAll = await api('POST', '/notifications/read-all', { user: 'sales01' });
  check('POST /notifications/read-all 全部标记已读', noticeReadAll.status === 200, noticeReadAll.body);

  const noticeUnread = await api('GET', '/notifications/unread-count', { user: 'sales01' });
  check('GET /notifications/unread-count 未读数', noticeUnread.status === 200 && typeof noticeUnread.body.data.unread === 'number', noticeUnread.body);

  const approvalSummary = await api('GET', '/approvals/summary', { user: 'admin' });
  check('GET /approvals/summary 审批中心角标', approvalSummary.status === 200 && typeof approvalSummary.body.data.pending === 'number', approvalSummary.body);

  const approvalsPending = await api('GET', '/approvals?status=pending', { user: 'admin' });
  check('GET /approvals 待办列表', approvalsPending.status === 200 && Array.isArray(approvalsPending.body.data.list), approvalsPending.body);

  const approvalsDone = await api('GET', '/approvals?status=done', { user: 'manager01' });
  check('GET /approvals 已办列表', approvalsDone.status === 200 && Array.isArray(approvalsDone.body.data.list), approvalsDone.body);

  const timeline360 = await api('GET', `/customers/${customerId}/360`, { user: 'admin' });
  const tl = timeline360.body?.data?.timeline;
  check(
    'GET /customers/{id}/360 返回全生命周期时间轴',
    timeline360.status === 200 && Array.isArray(tl) && tl.some((e) => e.category === 'activity') && tl.some((e) => e.category === 'stage'),
    { timeline_len: tl ? tl.length : null }
  );

  // ---------------------------------------------------------------- 汇总
  console.log(`\n=== 冒烟测试结果：通过 ${pass} / 失败 ${fail} ===`);
  if (failures.length) {
    console.log('失败用例：');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('冒烟测试异常终止：', e);
  process.exitCode = 1;
});
