import {readFileSync,writeFileSync} from 'node:fs';
const current='2026-10-13当前续办（53）：付费营期整体延期/取消、已开营延长结营期限及本人同意协商退款已实现并本地验证；原安排/教学日期/学习成果保留，取消补退余额且一次释放。180关联回归、9实际页面及API/Pro/App Web通过；第40本地迁移已应用，161表/160模型和规范数据保持。下一A05付费实际履约、预收收入/结算积分，再iOS营期及A01/M07差异票价优惠和A07/A08联动验收。完整M04/CO05及商用38/131保持未验收，未部署/更新APK，见[53](53-cohort-schedule-and-compensation.md)。';
for(const name of ['01-product-requirements.md','02-technical-research-and-decisions.md','03-development-progress.md','07-database-and-crud.md','19-current-progress.md','26-remaining-development-plan.md','33-development-status-summary.md','README.md']){
  const path='docs/'+name;let text=readFileSync(path,'utf8');if(text.includes(current))throw Error('Already updated: '+path);text=text.replace('2026-10-13当前续办（52）','2026-10-13历史记录续办（52）');writeFileSync(path,current+'\n\n'+text);
}
function edit(path,changes){let text=readFileSync(path,'utf8');for(const [before,after] of changes){if(!text.includes(before))throw Error('Missing documentation match: '+before.slice(0,80));text=text.replace(before,after);}writeFileSync(path,text);}
edit('docs/26-remaining-development-plan.md',[
  ['- [ ] 付费整期延期/取消、已开营退出、实际交付依据与协商补偿。', '- [x] 付费整期延期/取消、已开营延长/退出、实际交付核查依据与本人同意协商补偿（53；180关联/9实际页面与三端构建通过，第40迁移本地应用）。'],
  ['- [ ] 付费营期及实际履约/预收转收入、结算积分与退款冲回。', '- [x] 付费营期独立订单、延期取消与本人同意协商补偿（52—53）。\n- [ ] 付费实际履约/预收转收入、结算积分与退款冲回（A05下一项）。'],
  ['**当前停点（2026-10-13，52）：', '**上批停点（2026-10-13，52）：'],
  ['## 7. 执行记录与下一步', '## 7. 执行记录与下一步\n\n**当前停点（2026-10-13，53）：营期付费变更及已开营退出协商补偿子流程本地验证完成；180关联/9实际页面与API/Pro/App Web通过，第40迁移本地应用，规范数据保持。下一A05付费实际履约、财务结算积分前置，再iOS营期/差异票价会员优惠与A07/A08。完整任务状态及商用38/131不提高，未部署或更新APK。**'],
  ['下一付费整期延期取消、已开营退出/补偿与iOS营期内购，正式云媒体/原生及完整商用仍未齐', '53付费延期取消、已开营延长及本人同意协商补偿本地验证完成；iOS营期内购、付费实际履约、正式云媒体/原生及完整商用仍未齐'],
  ['| 52；126关联、3生产配置专项、8实际页面及API/Pro/App Web通过，第39迁移本地应用，161表/160模型；规范数据保持，隔离渠道不是商用证据 |', '| 53；180关联回归、9实际页面及API/Pro/App Web通过，第40本地迁移、161表/160模型；规范数据保持，隔离渠道不是商用证据 |'],
  ['App营期购买说明/订单/退出弹窗/状态刷新及Pro订单财务审核和暂停学员状态（52）本地通过', 'App原订单新安排确认/全额退出/核查提案本人同意拒绝、Pro延期延长取消/金额依据及部分退出状态（53）本地通过'],
  ['整期付费变更、已开营补偿、iOS及正式交付仍未完成', '53付费整期变更、已开营延长和本人同意补偿本地通过；iOS、实际履约结算及正式交付仍未完成'],
]);
const plan='docs/26-remaining-development-plan.md';writeFileSync(plan,readFileSync(plan,'utf8')+'\n\n| 2026-10-13 | A03/A04/A06营期变更与协商补偿 | 子流程实现并本地验证完成；完整任务仍进行中 | 180关联/9实际页面及API/Pro/App Web通过；第40迁移本地应用，原规范数据与摘要保持。未开营延期、已开营只延长期限、本人确认或全额退出、协商金额本人同意、取消补余款/一次释放、旧学习成果保留与持久恢复，见53 | 下一A05付费实际履约、预收收入/结算积分；iOS营期/差异票价优惠、直播现场及正式双端仍待；未部署/更新APK，商用38/131保持 |\n');
edit('docs/33-development-status-summary.md',[
  ['付费营期整体变更/已开营补偿、部分实际交付、预收结算', '付费实际交付与更正、预收结算'],
  ['剩付费营期/已开营补偿、部分交付、结算积分', '53付费营期变更/已开营延长及本人同意补偿已本地验证；剩iOS营期、实际交付、结算积分'],
]);
edit('docs/README.md',[[
  '最新营期交易交付：[52付费营期订单与开营前退出](52-paid-cohort-orders.md)；126关联/3生产门禁专项/8页面、三端构建与39本地迁移通过。下一付费整期延期取消、已开营退出/补偿及A05履约结算。此前预约协商退款见51。',
  '最新营期售后交付：[53营期变更与本人确认补偿](53-cohort-schedule-and-compensation.md)；180关联/9实际页面、三端构建及40本地迁移通过。下一A05付费实际履约与结算积分。此前营期交易见52，预约协商退款见51。'
]]);
