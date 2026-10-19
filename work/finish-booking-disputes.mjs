import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output='outputs/booking-disputes-2026-10-13/';
const [before,after,browser]=await Promise.all(['local-before.json','local-after.json','browser-checks.json'].map(async p=>JSON.parse(await readFile(output+p,'utf8'))));
assert.equal(before.migrations,37);assert.equal(after.migrations,38);
for(const key of Object.keys(before))if(key!=='migrations')assert.deepEqual(after[key],before[key],key);
assert.equal(browser.status,'passed');assert.equal(browser.checks.length,15);assert.equal(browser.errors.length,0);
const snapshotHash=createHash('sha256').update(await readFile('docs/25-commercial-readiness-review.md')).digest('hex');
assert.equal(snapshotHash,'c24a94ff6fb6e1735cc85b57a0412a249858dd2d77d1cfd46edf771958222d04');
const current='2026-10-13当前续办（51）：个人预约拒绝与服务争议协商退款已实现并本地验证；负责老师单次拒约全额补偿，财务提出金额/依据、本人确认后退款，拒绝恢复原参加状态，整场取消补齐余额且一次释放。104关联及54末次同意约束专项（重叠）、15实际页面和API/Pro/App Web通过；第38本地迁移已应用，161表/160模型与规范数据保持。完整A04/A06仍进行中，下一A03付费营期/已开营退出延期补偿，再A05付费实际履约结算；商用38/131保持，未部署/更新APK，见[51](51-booking-disputes-and-refusals.md)。';
for(const path of ['docs/01-product-requirements.md','docs/02-technical-research-and-decisions.md','docs/07-database-and-crud.md','docs/26-remaining-development-plan.md','docs/33-development-status-summary.md','docs/README.md']){
  let body=await readFile(path,'utf8');
  if(body.includes(current))continue;
  assert.ok(body.includes('2026-10-13当前续办（50）'),path);
  body=body.replace(/^2026-10-13当前续办（50）[^\r\n]*/m,current);
  body=body.replace(/^2026-10-(12|13)(当前续办|最新营期续办|最新教学续办|最新A03|上批A03)/gm,'2026-10-$1历史记录$2');
  // Keep a single current checkpoint; dated historical evidence remains intact.
  body=body.replace('2026-10-13历史记录当前续办（51）','2026-10-13当前续办（51）');
  if(path==='docs/26-remaining-development-plan.md'){
    const evidence='51；104关联及54末次同意约束专项（重叠）/15实际页面与API/Pro/App Web通过；第38本地迁移应用，161表/160模型，规范数据保持；隔离渠道不替代正式收退款';
    const updates={
      A02:['统一占位/可信收款/超时晚付、付费延期退出/整场取消及个人拒约/争议退款一次释放已本地验证；会员优惠/配额售后、付费营期和正式渠道仍待',evidence],
      A03:['固定版本独立报名/学习、分日解锁、专属老师助教/作业打卡点评及未开营免费延期取消结营通知已本地验证（42—45）；下一付费营期/已开营退出延期补偿，正式云媒体/原生和完整交付待补','42—45；146关联及18迁移边界专项（重叠）/7实际页面与三端构建通过；最新本地38迁移，161表/160模型，原规范数据保持；完整A03商用未验收'],
      A04:['原价订单/通知与50延期取消已本地验证；51个人拒约全额退款、服务核查/金额依据/本人同意、拒绝恢复、取消补余款及失败重试已本地验证；M07优惠/配额消费、实际交付结算及正式X03/X07/X08待补',evidence],
      A06:['App原订单核查弹窗/方案确认拒绝/退出范围/原路结果及Pro提案/个人拒约接通（51），保留既有书院版式；实际付费履约、营期及结算/原生仍待补',evidence],
      S07:['服务商品/老师共用时段、免费及原价付费预约订单/退约/延期取消和个人拒绝/争议补偿已本地验证；实际付费服务/预收结算、正式渠道及完整商用未验收',evidence],
    };
    body=body.split('\n').map(line=>{const match=line.match(/^\| (A02|A03|A04|A06|S07) \|/);if(!match)return line;const cells=line.split(' | ');assert.equal(cells.length,8,match[1]);cells[6]=updates[match[1]][0];cells[7]=updates[match[1]][1]+' |';return cells.join(' | ');}).join('\n');
    body=body.replace(/^\*\*当前停点[^\r\n]*/m,'**当前停点（2026-10-13，51）：个人预约拒绝/争议核查与本人同意协商退款子流程实现与本地验证完成，104关联及54末次约束专项（重叠）、15实际页面和三端构建通过。第38迁移本地应用，161表/160模型与规范数据保持。下一A03付费营期及已开营退出/延期补偿，再A05付费实际交付、预收转收入/结算积分；完整M04与商用未验收，未部署/更新APK，详见51。**');
    body=body.replace('- [ ] 付费延期/整场取消、确认退出、老师拒绝及争议补偿。','- [x] 付费延期/整场取消与确认退出（50）。\n- [x] 负责老师单次拒约、争议核查/本人同意协商退款、拒绝恢复/失败重试及取消补余款（51）。');
    body=body.replace('- [ ] A04付费预约/活动订单与A02占位超时、晚付补偿。','- [x] A04付费预约/活动订单与A02占位超时、晚付补偿（49）。');
    body=body.replace('进行中11','进行中12').replace('待执行64','待执行63');
    body=body.replace(/个人拒绝\/争议、部分履约补偿、真实交付\/正式渠道\/原生及完整商用未验收/g,'51个人拒约/争议协商补偿本地通过；付费实际交付/预收结算/正式渠道/原生及完整商用未验收');
    body+='\n\n| 2026-10-13 | A04/A06个人拒约与协商补偿 | 子流程实现与本地验证完成；完整任务仍进行中 | 老师单次拒约全额退款、核查方案/本人确认、原状态恢复、失败重试/取消补余款；104关联/54末次专项（重叠）/15实际页面和三端构建通过，第38迁移本地应用，原规范数据保持，见51 | 下一A03付费营期/已开营退出延期，再A05付费实际履约结算；未部署/更新APK，商用38/131保持 |\n';
  }
  if(path==='docs/33-development-status-summary.md'){
    body=body.replace('个人拒绝/争议补偿、付费营期、部分履约补偿、实际交付结算','付费营期、部分实际交付、预收结算');
    body=body.replace('个人拒绝/争议、实际履约、数字交付','实际付费履约、数字交付');
    body=body.replace('剩个人拒绝/争议及协商补偿、付费营期/已开营补偿','个人拒约/本人同意协商补偿已本地通过；剩付费营期/已开营补偿');
    body=body.replace('## 最新交付与证据','## 最新交付与证据\n\n- 51阶段：老师单次拒约全额退款、服务争议核查/方案与本人确认、拒绝恢复参加事实、失败重试、取消补余款及一次释放已本地验证；104关联/54末次约束专项（重叠）/15实际页面与三端构建通过。第38本地迁移应用，原规范数据保持；保留款仍为预收、实际交付结算未实现，未部署/更新APK，详见[51](51-booking-disputes-and-refusals.md)。');
    body=body.replace(/^1\. A04付费安排[^\r\n]*/m,'1. A04个人拒约/服务争议与本人同意退款已本地验证（51）；该子流程收尾，完整A04/A06继续进行中。');
  }
  if(path==='docs/README.md'){
    body=body.replace(/^最新付费安排变更实现与验证：[^\r\n]*/m,'最新预约售后交付：[51单次拒约与服务争议退款](51-booking-disputes-and-refusals.md)；全额拒约、核查协商/本人同意、拒绝恢复、失败重试及取消补余款已本地验证。下一付费营期与实际履约结算。');
    body=body.replace('下一A04付费安排变更/补偿，再付费营期和履约结算。','单次拒约与本人同意协商退款（51）已本地验证，下一A03付费营期/已开营补偿，再A05付费实际履约结算。');
  }
  if(path==='docs/01-product-requirements.md')body+='\n\n2026-10-13个人拒约/协商补偿决定：老师未来单次拒约全额自动退，不取消整个时段；学员服务争议核查暂停继续交付且保留原参加事实，财务须说明金额/扣除依据，本人接受冻结方案后才退款。拒绝恢复原状态，渠道成功才终止剩余服务/释放一次库存；书院整场取消未接受方案全额升级，已接受方案另补退剩余实付。保留款仍为预收，实际交付结算待A05，不以签到冒充消费；详见51。\n';
  if(path==='docs/02-technical-research-and-decisions.md'||path==='docs/07-database-and-crud.md')body+='\n\n2026-10-13协商退款约束（51）：复用原预约/报名、Refund/RefundItem和预收账本；第38迁移扩展acceptedAt约束，添加BOOKING_DISPUTE同意状态检查与已确认方案不可变触发器、暂停预约索引。金额整数分，沿原用户/订单/资源锁序、幂等请求、持久任务/渠道确认及审计通知。无新表/模型，161表含元数据/160模型保持；38迁移本地应用、规范数据摘要一致。部分退款保留额不自动确认收入；付费履约依A05。\n';
  await writeFile(path,body);
}
const plan=await readFile('docs/26-remaining-development-plan.md','utf8'),rows=[...plan.matchAll(/^\| ([FCMSALNORVEDB]\d{2}) \| ([^|]+) \|/gm)],counts={};
assert.equal(rows.length,110);
for(const row of rows)counts[row[2].trim()]=(counts[row[2].trim()]??0)+1;
assert.deepEqual(counts,{'已完成':5,'待验收':1,'阻塞':16,'实现完成·待验证':13,'进行中':12,'待执行':63});
await writeFile(output+'validation.json',JSON.stringify({stage:51,date:'2026-10-13',status:'implemented-and-locally-validated',relatedTests:{passed:104,failed:0,log:'targeted-tests-final.log'},finalConsentTests:{passed:54,failed:0,log:'consent-tests-final.log',overlapsRelatedTests:true},browserChecks:{passed:15,failed:0,log:'browser-checks.json'},builds:{api:'passed',adminTypes:'passed',adminProduction:'passed',appWeb:'passed',native:false},migration:{appliedLocally:true,count:38,tables:161,businessModels:160},dataPreserved:true,reviewSnapshotSha256:snapshotHash,taskCounts:counts,commercial:{completed:38,total:131,percentage:29.0,formalPaymentEnabled:false},deployed:false,apkUpdated:false,phoneAcceptance:false,next:'A03 paid cohorts and started-cohort exit/delay compensation',limits:['Retained booking amount stays advance liability until A05 fulfilment','Benefit-funded cancellation awaits owning benefit workflow','Formal payment, native and actual service evidence not verified']},null,2));
console.log(JSON.stringify({counts,localMigration:38,browserChecks:15,dataPreserved:true}));
