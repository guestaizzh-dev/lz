import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
async function edit(path,changes){const original=await readFile(path,'utf8'),eol=original.includes('\r\n')?'\r\n':'\n';let body=original.replace(/\r\n/g,'\n');for(const [from,to] of changes){assert.ok(body.includes(from),path+': '+from.slice(0,70));body=body.replace(from,to);}await writeFile(path,body.replace(/\n/g,eol));}
await edit('apps/admin/config/routes.ts',[["  { path: '/booking-orders'","  { path: '/cohort-orders', name: 'cohortOrders', icon: 'team', access: 'canViewOrders', component: './cohort-orders' },\n  { path: '/booking-orders'"]]);
await edit('apps/admin/src/locales/zh-CN/menu.ts',[["export default {","export default {\n  'menu.cohortOrders': '训练营订单',"]]);
await edit('apps/admin/src/pages/cohorts/index.tsx',[
  ['available:number;state:string;','available:number;price:string|null;paid:boolean;state:string;'],
  ["{...v,startsAt:chinaPickerIso(v.startsAt)","{...Object.fromEntries(Object.entries(v).filter(([key])=>key!=='priceYuan')),price:Math.round(Number(v.priceYuan??0)*100),startsAt:chinaPickerIso(v.startsAt)"],
  ["'开放本期免费报名？'","'开放本期报名？'"],
  ["{title:'状态',render:","{title:'本期费用',render:(_,r)=>r.price===null?'待配置':Number(r.price)===0?'免费':'¥'+(Number(r.price)/100).toFixed(2)},{title:'状态',render:"],
  ["setFieldsValue({capacity:30})","setFieldsValue({capacity:30,priceYuan:0})"],
  ["<Form.Item name=\"capacity\" label=\"名额\"","<Form.Item name=\"priceYuan\" label=\"本期报名费用（元）\" extra=\"营期独立定价，0元为免费；固定版本与本期教学权限在结营时到期。正式支付未验收时付费入口不收费。\" rules={[{required:true}]}><InputNumber min={0} max={1000000} precision={2} style={{width:'100%'}}/></Form.Item><Form.Item name=\"capacity\" label=\"名额\""],
  ['已接通免费报名、开营访问与营内讨论隔离。','已接通免费报名与独立营期定价、付费订单和开营前退出。渠道确认收款后才报名，退款成功后才释放名额；申请期间暂停本期学习与教学。'],
  ['付费及开营后补偿仍由后续售后处理。','付费整期延期取消、已开营补偿和实际交付结算继续完善，当前该变更入口仅处理未开营的免费营期。'],
  ['<Button type="link" onClick={()=>setSelected(r)}>学员名单</Button>','<Button type="link" onClick={()=>setSelected(r)}>学员名单</Button>{access.canViewOrders&&r.paid&&<Button type="link" onClick={()=>history.push(\'/cohort-orders\')}>本期订单</Button>}']]);
await edit('apps/mobile/lib/cohorts.ts',[["export type Cohort={id:string;","export type Cohort={price?:string|null;paid?:boolean;orderId?:string|null;suspended?:boolean;purchaseAvailable?:boolean;id:string;"]]);
await edit('apps/mobile/pages/cohort/detail.uvue',[
  ["{{cohort!.enrolled?'已报名 · '+phase:'书院共学'}}","{{cohort!.suspended?'退出与退款处理中':cohort!.enrolled?'已报名 · '+phase:'书院共学'}}"],
  ["<text class=\"meta\">以上时间均为北京时间</text>","<text class=\"meta\">以上时间均为北京时间</text><text class=\"body-copy\">本期费用：{{cohort!.price===null||cohort!.price===undefined?'待配置':Number(cohort!.price)===0?'免费':'¥'+money(Number(cohort!.price))}}</text>"],
  ['当前支持免费共学与分日学习；作业、打卡与老师点评均按本期独立保存。','报名费用仅用于本期研习与教学；作业、打卡与老师点评均按本期独立保存。'],
  ['<button v-if="cohort!.enrolled&&!cohort!.schedulePending"','<button v-if="cohort!.enrolled&&!cohort!.suspended&&!cohort!.schedulePending"'],
  ['<button v-if="cohort!.enrolled&&!cohort!.schedulePending"','<button v-if="cohort!.enrolled&&!cohort!.suspended&&!cohort!.schedulePending"'],
  ['<button v-if="cohort!.canCancel"','<text v-if="cohort!.suspended" class="footer-note">本期退出申请正在办理，学习、作业、打卡和讨论暂停；渠道退款成功后释放席位。</text><button v-if="cohort!.orderId" class="secondary-button" @click="openPage(\'cohort/purchase?orderId=\'+cohort!.orderId)">查看本期订单与售后</button><button v-if="cohort!.canCancel"'],
  ['<button v-else class="bar-primary"','<button v-else-if="cohort!.purchaseAvailable" class="bar-primary" @click="openPage(\'cohort/purchase?cohortId=\'+id)">查看费用与购买说明</button><button v-else class="bar-primary"'],
  ["import {request} from '../../lib/api'","import {request,money} from '../../lib/api'"]]);
await edit('apps/mobile/pages/cohort/index.uvue',[
  ['<ContentState v-if="loading||error"','<button class="text-button" @click="openPage(\'cohort/orders\')">训练营订单与售后</button><ContentState v-if="loading||error"'],
  ["c.schedulePending?'待确认新安排'","c.suspended?'售后处理中':c.schedulePending?'待确认新安排'"]]);
await edit('apps/mobile/pages/profile/messages.uvue',[
  ['<text v-if="item.kind===\'COHORT\'"','<text v-if="item.kind===\'COHORT_ORDER\'&&item.orderId" class="message-link">查看训练营订单 ›</text><text v-if="item.kind===\'COHORT\'"'],
  ["if(item.kind==='COHORT')","if(item.kind==='COHORT_ORDER'&&item.orderId)openPage('cohort/purchase?orderId='+item.orderId);if(item.kind==='COHORT')"]]);
let orders=await readFile('apps/mobile/pages/booking/orders.uvue','utf8');orders=orders.replaceAll('预约与活动订单','训练营订单').replaceAll('书院之约的账目','共学营期的账目').replaceAll('每笔订单保留原安排与取消规则','每笔报名保留本期安排与退出规则').replaceAll('还没有付费预约订单','还没有付费训练营订单').replaceAll('免费安排在我的预约与报名中查看。','免费报名在我的训练营中查看。').replaceAll('bookingOrderLabel','cohortOrderLabel').replaceAll('BookingOrder','CohortOrder').replaceAll('booking-sales','cohort-sales').replaceAll('o.booking.title','o.cohort.title').replaceAll('o.booking.startsAt','o.cohort.startsAt').replaceAll('o.booking.quantity','1').replaceAll('o.booking.location','o.cohort.courseTitle').replaceAll('booking/purchase','cohort/purchase').replaceAll('booking/orders','cohort/orders').replaceAll('/commerce/booking-orders','/commerce/cohort-orders');await writeFile('apps/mobile/pages/cohort/orders.uvue',orders);
const pages=JSON.parse(await readFile('apps/mobile/pages.json','utf8'));for(const path of ['pages/cohort/purchase','pages/cohort/orders']){assert.ok(!pages.pages.some(p=>p.path===path));pages.pages.push({path,style:{navigationStyle:'custom'}});}await writeFile('apps/mobile/pages.json',JSON.stringify(pages,null,2)+'\n');
await edit('services/api/.env.example',[["BOOKING_PAYMENT_WORKER_ENABLED=true","BOOKING_PAYMENT_WORKER_ENABLED=true\n# Training camp payments remain disabled until digital channel/native acceptance.\nCOHORT_SALES_ENABLED=false\nCOHORT_PAYMENT_WORKER_ENABLED=true"]]);
