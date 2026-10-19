import {readFileSync,writeFileSync} from 'node:fs';
function edit(path,changes){let text=readFileSync(path,'utf8');for(const [before,after] of changes){if(!text.includes(before))throw Error('Missing match: '+before.slice(0,70));text=text.replace(before,after);}writeFileSync(path,text);}
edit('apps/mobile/pages/cohort/purchase.uvue',[
  ['{{purchase!.refundPolicy}}</text>', "{{policyExpanded?purchase!.refundPolicy:'开营前可全额退出；安排变更可确认或全额退出。开营后核查实际交付，由你确认退款方案；书院取消全额退回。申请期间暂停本期交付，渠道退款成功后释放席位。'}}</text><button class=\"text-button\" @click=\"policyExpanded=!policyExpanded\">{{policyExpanded?'收起完整规则':'查看完整退出与退款规则'}}</button>"],
  ["dispute=ref(false),refundReason", "dispute=ref(false),policyExpanded=ref(false),refundReason"],
  ['>拟退款 ¥{{money(Number(r.approvedAmount))}}', ">{{r.state==='APPROVED'?'拟退款':'方案退款'}} ¥{{money(Number(r.approvedAmount))}}"],
]);
edit('scripts/browser/cohort-compensation.mjs',[["拟退款 ¥50.00 · 保留款 ¥70.00", "拟退款 ¥50 · 保留款 ¥70"]]);
