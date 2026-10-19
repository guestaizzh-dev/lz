import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const output='outputs/cohort-sales-2026-10-13/';
const browser=JSON.parse(await readFile(output+'browser-checks.json','utf8'));assert.equal(browser.status,'passed');assert.equal(browser.errors.length,0);assert.equal(browser.checks.length,8);
const tests=await readFile(output+'targeted-tests-final.log','utf8'),runtime=await readFile(output+'runtime-tests-final.log','utf8');assert.match(tests,/# pass 126\b/);assert.match(tests,/# fail 0\b/);assert.match(runtime,/# pass 3\b/);assert.match(runtime,/# fail 0\b/);
const before=JSON.parse(await readFile(output+'local-before.json','utf8')),after=JSON.parse(await readFile(output+'local-after.json','utf8'));assert.equal(before.migrations,38);assert.equal(after.migrations,39);for(const key of Object.keys(before))if(key!=='migrations')assert.deepEqual(after[key],before[key],key);
assert.match(await readFile(output+'app-web-build.log','utf8'),/编译成功/);assert.match(await readFile(output+'api-build.log','utf8'),/tsc -p tsconfig/);assert.match(await readFile(output+'admin-build.log','utf8'),/Build index.html/);
const digest=createHash('sha256').update(await readFile('docs/25-commercial-readiness-review.md')).digest('hex');assert.equal(digest,'c24a94ff6fb6e1735cc85b57a0412a249858dd2d77d1cfd46edf771958222d04');
const headline='2026-10-13当前续办（52）：独立付费营期报价/占位、可信收款报名、异常款补偿及开营前全额退出已实现并本地验证；退款暂停本期正文媒体/教学讨论，拒绝恢复、成功一次释放。126关联、3生产门禁专项及8实际页面通过，API/Pro/App Web构建通过；第39本地迁移已应用，161表/160模型和规范数据保持。下一A03付费整期延期取消与已开营退出/补偿，再A05实际交付结算；完整M04/CO05及商用38/131未验收，未部署/更新APK，见[52](52-paid-cohort-orders.md)。';
const evidence='52；126关联、3生产配置专项、8实际页面及API/Pro/App Web通过，第39迁移本地应用，161表/160模型；规范数据保持，隔离渠道不是商用证据';
const paths=['docs/01-product-requirements.md','docs/02-technical-research-and-decisions.md','docs/07-database-and-crud.md','docs/26-remaining-development-plan.md','docs/33-development-status-summary.md','docs/README.md'];
for(const path of paths){let body=await readFile(path,'utf8');assert.ok(!body.includes('当前续办（52）'),path+' already finalized');body=headline+'\n\n'+body.replace('2026-10-13当前续办（51）','2026-10-13历史记录续办（51）');
  if(path==='docs/26-remaining-development-plan.md'){
    const updates={A03:'固定版本独立报名/学习、分日教学、免费延期及52付费营期报价/库存/可信报名、开营前退款与交付暂停恢复已本地验证；下一付费整期延期取消、已开营退出/补偿与iOS营期内购，正式云媒体/原生及完整商用仍未齐',A04:'预约原价订单、付费变更及本人同意协商补偿（49—51）与52付费营期收退款本地通过；M07优惠配额、实际交付结算及正式资源仍未完成',A06:'App营期购买说明/订单/退出弹窗/状态刷新及Pro订单财务审核和暂停学员状态（52）本地通过；保留书院版式，实际交付结算和原生仍待'};
    body=body.split('\n').map(line=>{const match=line.match(/^\| (A03|A04|A06) \|/);if(!match)return line;const cells=line.split(' | ');assert.equal(cells.length,8);cells[6]=updates[match[1]];cells[7]=evidence+' |';return cells.join(' | ');}).join('\n');
    body=body.replace(/^\*\*当前停点[^\r\n]*/m,'**当前停点（2026-10-13，52）：付费营期订单与开营前退款子流程实现并完成本地验证；126关联/3生产门禁专项/8实际页面与三端构建通过。39迁移已本地应用、规范数据保持。下一A03付费整期延期取消、已开营退出与实际交付依据/协商补偿，再A05履约及预收转收入/结算积分。完整M04/CO05仍未验收，未部署/更新APK，详见52。**');
    body=body.replace('- [ ] 付费营期和已开营退出/延期、退款及补偿。','- [x] 独立付费营期报价、并发占位、可信收款报名、异常款补偿、原订单售后和开营前全额退出（52）。\n- [ ] 付费整期延期/取消、已开营退出、实际交付依据与协商补偿。\n- [ ] iOS营期Apple产品映射、购买与恢复验证。');
    body=body.replace('- [ ] 付费训练营、正式云媒体/原生与完整商用验收。','- [ ] 正式付费营期、云媒体/双端原生与完整商用验收。');
    body=body.split('\n').map(line=>line.startsWith('| CO05 |')?'| CO05 | R1 | 训练营课程交付 | A03、A08 | 未完成 | 42—45固定营期/章节/教学与免费变更已本地验证；52付费订单/可信报名/开营前退出和暂停恢复已本地通过；整期付费变更、已开营补偿、iOS及正式交付仍未完成 |':line).join('\n');
    body+='\n\n| 2026-10-13 | A03/A04/A06付费营期交易子流程 | 子项实现并本地验证完成；完整任务仍进行中 | 126关联/3生产门禁专项/8实际页面及API/Pro/App Web通过；修复数据库COHORT约束、跨渠道异常资金、退款弹窗属性、恢复任务和旧媒体票据暂停；39迁移本地应用、规范数据保持，见52 | 下一付费营期整体变更/已开营补偿，再A05付费履约结算；未上线/更新APK，商用38/131保持 |\n';
  }
  if(path==='docs/33-development-status-summary.md'){
    body=body.replace('付费营期、部分实际交付、预收结算','付费营期整体变更/已开营补偿、部分实际交付、预收结算');
    body=body.replace('## 最新交付与证据','## 最新交付与证据\n\n- 52阶段：独立营期定价/库存订单/可信报名、异常款原路补偿、开营前退出与交付暂停/拒绝恢复、Pro财务及App原订单售后已本地验证；126关联、3生产配置专项与8实际页面通过。39迁移、三端构建及规范数据保持，详见[52](52-paid-cohort-orders.md)。');
    body=body.replace(/^2\. A03付费营期[^\r\n]*/m,'2. A03付费营期购买与开营前退出已本地验证（52）；下一付费整期延期取消、已开营退出/实际交付依据与协商补偿，再补iOS营期Apple购买验证。');
  }
  if(path==='docs/README.md')body=body.replace(/^最新预约售后交付：[^\r\n]*/m,'最新营期交易交付：[52付费营期订单与开营前退出](52-paid-cohort-orders.md)；126关联/3生产门禁专项/8页面、三端构建与39本地迁移通过。下一付费整期延期取消、已开营退出/补偿及A05履约结算。此前预约协商退款见51。');
  if(path==='docs/01-product-requirements.md')body+='\n\n2026-10-13付费营期规则（52）：本期费用与普通课程独立，购买冻结固定版本、安排及规则，仅发本期教学权限。开营前全额退出暂停本期交付；拒绝恢复，渠道确认成功一次释放席位。收款为预收负债，正式交付后另结算；Web/iOS禁收款，iOS须后续Apple营期映射验证。已退出付费同一期不直接重购，其他营期可选择。整期付费变更和已开营补偿续办。\n';
  if(path==='docs/02-technical-research-and-decisions.md'||path==='docs/07-database-and-crud.md')body+='\n\n2026-10-13第39迁移（52）：复用TradeOrder/SaleOffer/InventoryReservation/PaymentTransaction/Refund和账本，新增COHORT类型及CohortRegistration.orderItemId唯一外键/suspendedAt；购买身份/原安排与订单项快照不可变，报名需匹配可信收款。新增营期预收及异常待退/收入科目、有效售卖项唯一和订单索引；无新模型/表。39迁移本地应用，161表/160模型，规范数据和普通课程/教学摘要不变。COHORT_SALES_ENABLED默认false，worker持久恢复；正式渠道/iOS/原生和实际履约仍待验收。\n';
  await writeFile(path,body);
}
const plan=await readFile('docs/26-remaining-development-plan.md','utf8'),rows=[...plan.matchAll(/^\| ([FCMSALNORVEDB]\d{2}) \| ([^|]+) \|/gm)],counts={};assert.equal(rows.length,110);for(const r of rows)counts[r[2].trim()]=(counts[r[2].trim()]??0)+1;
assert.deepEqual(counts,{'已完成':5,'待验收':1,'阻塞':16,'实现完成·待验证':13,'进行中':12,'待执行':63});
await writeFile(output+'validation.json',JSON.stringify({stage:52,date:'2026-10-13',status:'implemented-and-locally-validated',relatedTests:{passed:126,failed:0,log:'targeted-tests-final.log'},runtimeTests:{passed:3,failed:0,log:'runtime-tests-final.log',overlapsRelatedTests:false},browserChecks:{passed:8,failed:0,log:'browser-checks.json'},builds:{api:'passed',adminTypes:'passed',adminProduction:'passed',appWeb:'passed',appWebMode:'HBuilderX 5.26 VDOM',native:false},migration:{appliedLocally:true,count:39,tables:161,businessModels:160},dataPreserved:true,reviewSnapshotSha256:digest,taskCounts:counts,commercial:{completed:38,total:131,percentage:29.0,formalPaymentEnabled:false},deployed:false,apkUpdated:false,phoneAcceptance:false,next:'A03 paid whole-cohort schedule changes and started-term exit/compensation',limits:['Payment adapters were isolated test implementations','Paid term schedule changes and started-term compensation remain','Apple cohort purchase remains disabled and unimplemented','Funds stay advance liability pending A05 actual fulfilment','Formal cloud media, native and actual delivery not accepted']},null,2));
const report='docs/52-paid-cohort-orders.md';await writeFile(report,(await readFile(report,'utf8'))+'\n\n最终收尾：8项真实浏览器流程、3项生产门禁专项及API/Pro/App Web构建通过。App退出弹窗已按既有ComposeSheet真实属性修复，登录允许返回原营期订单；截图已查看，保留既有书院风格与官方Pro模板。测试临时诊断runner收尾删除，后续使用既有run-tests.mjs。\n');
console.log(JSON.stringify({stage:52,relatedTests:126,runtimeTests:3,browserChecks:8,dataPreserved:true,counts}));
