import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {PaymentChannels} from '../dist/payment-channels.js';
import {ConsumptionRewards} from '../dist/consumption-rewards.js';
import {DigitalSales} from '../dist/digital-sales.js';
import {CourseSalesService} from '../dist/course-sales.js';
import {ZegoService} from '../dist/zego.js';

test('digital goods end-to-end ownership, frozen versions, callbacks, refunds and recovery',async t=>{
  process.env.PRODUCT_SALES_ENABLED='false';
  const app=await createApp(false);app.useLogger(['error']);await app.listen(0,'127.0.0.1');
  const db=app.get(Database),auth=app.get(AuthService),sales=app.get(DigitalSales),channels=app.get(PaymentChannels),base=await app.getUrl();
  const accounts=[];
  async function actor(kind,roles=[]){const user=await db.user.create({data:{nickname:'资料闭环验证',...(roles.length?{roles}:{})}}),cred=auth.credentials(),csrf=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:cred.accessHash,refreshHash:cred.refreshHash,accessExpiresAt:cred.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});const headers=kind==='ADMIN'?{Origin:'http://127.0.0.1:5173',Cookie:'daoxue_access='+cred.access,'X-CSRF-Token':csrf}:{Authorization:'Bearer '+cred.access};const row={user,headers};accounts.push(row);return row;}
  process.env.PRODUCT_SALES_ENABLED='true';
  const admin=await actor('ADMIN',['ADMIN']),student=await actor('APP'),stranger=await actor('APP'),trades=new Map(),refunds=new Map();let loseConnection=false;
  mock.method(channels,'resolve',channel=>({identity:()=>({appid:'TEST_'+channel,mchid:'MERCHANT'}),availability:()=>({enabled:true,reason:''}),prepay:async no=>{if(loseConnection)throw Error('Lost provider response');trades.set(no,{appid:'TEST_'+channel,mchid:'MERCHANT',out_trade_no:no,trade_type:'APP',trade_state:'NOTPAY'});return 'signed-test-payment';},query:async no=>{if(loseConnection)throw Error('Lost provider response');return trades.get(no)??{trade_state:'NOTFOUND'};},close:async no=>{const row=trades.get(no);if(row)row.trade_state='CLOSED';},refund:async(transactionId,no,amount,total,orderNo)=>{if(loseConnection)throw Error('Lost provider response');const r={mchid:'MERCHANT',out_refund_no:no,refund_id:'R'+no,out_trade_no:orderNo,transaction_id:transactionId,refund_status:'SUCCESS',success_time:new Date().toISOString(),amount:{refund:amount,total,currency:'CNY'}};refunds.set(no,r);return r;},queryRefund:async no=>refunds.get(no)}));
  async function call(path,who=student,method='GET',body){const response=await fetch(base+'/api/v1'+path,{method,headers:{...who.headers,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};}
  let product,sku,release,asset;
  async function checkout(){const q=await call('/commerce/digital-products/'+sku.id+'/quote?platform=ANDROID');assert.equal(q.status,200,JSON.stringify(q.body));const payload={skuId:sku.id,requestKey:randomUUID(),channel:'WECHAT_APP',platform:'ANDROID',quoteHash:q.body.quoteHash};const r=await call('/commerce/digital-orders',student,'POST',payload);assert.equal(r.status,201,JSON.stringify(r.body));return{order:r.body,payload};}
  function transaction(order,channel='WECHAT_APP',amount=Number(order.payableTotal)){return{appid:'TEST_'+channel,mchid:'MERCHANT',out_trade_no:order.orderNo,trade_type:'APP',trade_state:'SUCCESS',transaction_id:randomUUID(),success_time:new Date().toISOString(),amount:{total:amount,currency:'CNY'}};}
  try{
    await t.test('operator uploads a real private PDF and publishes a version with default SKU',async()=>{
      const r=await call('/admin/products',admin,'POST',{title:'道德经共读资料',subtitle:'隔离验证',description:'资料说明',category:'经典典籍',type:'DIGITAL',cover:'/static/art/books.svg',price:100,culturalOrigin:'测试',featured:false,memberDiscountEligible:false});assert.equal(r.status,201,JSON.stringify(r.body));product=r.body;
      const form=new FormData();form.append('file',new Blob(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'],{type:'application/pdf'}),'共读.pdf');const uploaded=await fetch(base+'/api/v1/admin/products/'+product.id+'/digital-files',{method:'POST',headers:admin.headers,body:form});asset=await uploaded.json();assert.equal(uploaded.status,201,JSON.stringify(asset));
      const p=await call('/admin/products/'+product.id+'/digital-releases',admin,'POST',{description:'第一版共读资料',accessDays:30,assetIds:[asset.id]});assert.equal(p.status,201,JSON.stringify(p.body));release=p.body;
      await db.product.update({where:{id:product.id},data:{status:'PUBLISHED'}});sku=await db.productSku.findFirstOrThrow({where:{productId:product.id}});assert.equal(sku.digitalReleaseId,release.id);
      const own=await call('/admin/products/'+product.id+'/digital-files',admin);assert.ok(own.body.some(a=>a.id===asset.id));
    });
    await t.test('quote conflicts, idempotent checkout and foreign ownership are enforced',async()=>{
      const {order,payload}=await checkout();const same=await call('/commerce/digital-orders',student,'POST',payload);assert.equal(same.body.id,order.id);assert.equal((await call('/commerce/digital-orders/'+order.id,stranger)).status,404);
      assert.equal((await call('/commerce/digital-orders',student,'POST',{...payload,requestKey:randomUUID(),quoteHash:'a'.repeat(64)})).status,409);
      assert.equal((await call('/commerce/digital-orders/'+order.id+'/cancel',student,'POST',{})).body.state,'CLOSED');
    });
    await t.test('order detail displays purchased refund terms instead of current policy',async()=>{
      const {order}=await checkout();const row=await db.tradeOrder.findUniqueOrThrow({where:{id:order.id}});
      await db.tradeOrder.update({where:{id:order.id},data:{pricingSnapshot:{...row.pricingSnapshot,refundPolicy:'购买时冻结条款'}}});
      assert.equal((await call('/commerce/digital-orders/'+order.id)).body.refundPolicy,'购买时冻结条款');
      assert.equal((await call('/commerce/digital-orders/'+order.id+'/cancel',student,'POST',{})).body.state,'CLOSED');
    });
    await t.test('trusted callbacks route to digital domain and duplicate channels grant only once',async()=>{
      const {order}=await checkout(),data=transaction(order);const router=app.get(CourseSalesService);assert.equal(await router.paymentDomain(order.orderNo),sales);
      const result=await Promise.all([sales.confirmPayment(data),sales.confirmPayment(data)]);assert.ok(result.every(r=>r.disposition==='ACCEPTED'));assert.equal(await db.digitalDelivery.count({where:{userId:student.user.id}}),1);
      const duplicate=await sales.confirmPayment(transaction(order,'ALIPAY_APP'),undefined,'ALIPAY_APP');assert.equal(duplicate.disposition,'DUPLICATE');assert.equal(await db.digitalDelivery.count({where:{userId:student.user.id}}),1);
      assert.equal((await sales.detail(order.id,student.user.id)).canReceive,true);
      await sales.runJobs();assert.ok(await db.refund.findFirst({where:{orderId:order.id,reasonCode:'DUPLICATE',state:'SUCCEEDED'}}));
    });
    await t.test('refund holds block file access; confirmed refund revokes old tickets and preserves other orders',async()=>{
      const {order}=await checkout();await sales.confirmPayment(transaction(order));const paid=(await call('/commerce/digital-orders/'+order.id)).body;
      const r=await call('/commerce/digital-orders/'+order.id+'/refunds',student,'POST',{requestKey:randomUUID(),reason:'尚未领取申请退款'});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal((await call('/me/digital/'+paid.delivery.id+'/files/'+asset.id,student,'POST',{})).status,403);
      const current=r.body.refunds[0];assert.equal((await call('/admin/digital-orders/refunds/'+current.id+'/review',admin,'POST',{expectedVersion:current.version,action:'APPROVE',reason:'核实未领取'})).status,201);await sales.runJobs();
      const refunded=(await call('/commerce/digital-orders/'+order.id)).body;assert.equal(refunded.refunds[0].state,'SUCCEEDED');assert.ok(refunded.delivery.revokedAt);assert.equal(refunded.canReceive,false);
      assert.equal((await call('/me/digital/'+paid.delivery.id+'/files/'+asset.id,stranger,'POST',{})).status,404);
    });
    await t.test('delivery starts explicitly and remains bound to the purchased version',async()=>{
      const {order}=await checkout();await sales.confirmPayment(transaction(order));const original=(await call('/commerce/digital-orders/'+order.id)).body;
      await call('/admin/products/'+product.id+'/digital-releases',admin,'POST',{description:'第二版资料',assetIds:[asset.id]});
      const current=(await call('/commerce/digital-orders/'+order.id)).body;assert.equal(current.pack.description,'第一版共读资料');assert.equal(current.delivery.releaseId,release.id);
      await app.get(ConsumptionRewards).refresh(student.user.id);assert.equal((await db.consumptionReward.findUniqueOrThrow({where:{orderId:order.id}})).state,'WAIT_DELIVERY');
      const ticket=await call('/me/digital/'+original.delivery.id+'/files/'+asset.id,student,'POST',{});assert.equal(ticket.status,201,JSON.stringify(ticket.body));const stream=await fetch(base+'/api/v1'+ticket.body.path);assert.equal(stream.status,200);assert.ok((await stream.text()).startsWith('%PDF-'));
      mock.timers.enable({apis:['Date'],now:Date.now()+8*86400000});await app.get(ConsumptionRewards).refresh(student.user.id);assert.equal((await db.consumptionReward.findUniqueOrThrow({where:{orderId:order.id}})).points,1n);mock.timers.reset();
      assert.equal((await call('/commerce/digital-orders/'+order.id+'/refunds',student,'POST',{requestKey:randomUUID(),reason:'已领取再尝试退款'})).status,409);
      const details=await sales.detail(order.id,student.user.id),payload={requestKey:randomUUID(),expectedVersion:details.version,reason:'核实资料存在质量问题，全额原路退回'};
      const first=await call('/admin/digital-orders/'+order.id+'/quality-refund',admin,'POST',payload);assert.equal(first.status,201,JSON.stringify(first.body));assert.equal((await call('/admin/digital-orders/'+order.id+'/quality-refund',admin,'POST',payload)).status,201);assert.equal((await fetch(base+'/api/v1'+ticket.body.path)).status,403);await sales.runJobs();assert.ok((await sales.detail(order.id,student.user.id)).delivery.revokedAt);await app.get(ConsumptionRewards).refresh(student.user.id);assert.equal((await db.consumptionReward.findUniqueOrThrow({where:{orderId:order.id}})).points,0n);
    });
    await t.test('unpaid expiry closes durably; failed anomaly compensation is visible and retryable',async()=>{
      const {order}=await checkout();await db.tradeOrder.update({where:{id:order.id},data:{expiresAt:new Date(Date.now()-1000)}});await db.outboxJob.updateMany({where:{aggregateId:order.id},data:{availableAt:new Date(0)}});await sales.runJobs();assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:order.id}})).state,'CLOSED');
      const {order:wrong}=await checkout();await sales.confirmPayment(transaction(wrong,'WECHAT_APP',Number(wrong.payableTotal)+1));loseConnection=true;await sales.runJobs();const job=await db.outboxJob.findFirstOrThrow({where:{kind:'DIGITAL_REFUND',state:'READY'}});assert.equal(job.lastErrorCode,'DIGITAL_PROVIDER_OR_PROCESSING_ERROR');loseConnection=false;await db.outboxJob.update({where:{id:job.id},data:{availableAt:new Date(0)}});await sales.runJobs();assert.equal((await db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).state,'DONE');
    });
    await t.test('retired rooms/users count as completed eviction; real errors still retry',async()=>{
      const zego=new ZegoService();let code=104;zego.request=async()=>({Code:code});for(code of [0,104,105,5024,50001])assert.equal((await zego.kickRoom('room','user')).Code,0);code=206;await assert.rejects(zego.kickRoom('room','user'),/退房仍待确认/);
    });
  }finally{mock.timers.reset();mock.restoreAll();await app.close();}
});
