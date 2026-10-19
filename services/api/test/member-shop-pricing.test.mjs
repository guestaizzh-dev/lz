import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {PaymentChannels} from '../dist/payment-channels.js';
import {ProductSalesService} from '../dist/product-sales.js';
if(process.env.NODE_ENV!=='test')throw Error('Member pricing requires the isolated test runner');

test('member shop prices preserve purchased terms, stock, actual payments and refund allocations',async t=>{
  const previous=process.env.PRODUCT_SALES_ENABLED;process.env.PRODUCT_SALES_ENABLED='false';
  const app=await createApp(false),db=new Database();await app.listen(0,'127.0.0.1');
  const sales=app.get(ProductSalesService),auth=app.get(AuthService),channels=app.get(PaymentChannels),base=(await app.getUrl())+'/api/v1',users=[],products=[],versions=[],tag='member-price-'+randomUUID(),facts=new Map();
  const identity={appid:'isolated-member-pricing',mchid:'1900000001'},adapter={identity:()=>identity,availability:()=>({enabled:true,reason:''}),prepay:async(no,title,total)=>{facts.set(no,{...identity,out_trade_no:no,trade_type:'APP',trade_state:'NOTPAY',amount:{total,currency:'CNY'}});return '{}';},query:async no=>facts.get(no)??{trade_state:'NOTFOUND'},close:async no=>{facts.get(no).trade_state='CLOSED';},refund:async(tx,no,amount,total,orderNo)=>({...identity,out_trade_no:orderNo,transaction_id:tx,out_refund_no:no,refund_id:'refund-'+randomUUID(),status:'SUCCESS',success_time:new Date().toISOString(),amount:{refund:amount,total,currency:'CNY'}})};
  mock.method(channels,'resolve',()=>adapter);mock.method(channels,'choices',()=>[{channel:'WECHAT_APP',provider:'wxpay',label:'微信',enabled:true,reason:''}]);process.env.PRODUCT_SALES_ENABLED='true';
  const plan=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:2,days:90}}}),zone=await db.deliveryZone.create({data:{province:'权益隔离'+randomUUID().slice(0,8),fee:101,surcharge:29,enabled:true}});
  async function session(role='USER'){
    const user=await db.user.create({data:{nickname:tag,roles:[role]}});users.push(user.id);const c=auth.credentials(),csrf=randomUUID();
    await db.authSession.create({data:{userId:user.id,kind:role==='USER'?'APP':'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});
    const address=await db.address.create({data:{userId:user.id,recipient:'隔离收件人',phone:'19900009999',province:zone.province,city:'测试市',district:'测试区',detail:'仅测试库',isDefault:true}});
    return{user,address,headers:role==='USER'?{authorization:'Bearer '+c.access}:{cookie:'daoxue_access='+c.access,'x-csrf-token':csrf}};
  }
  async function call(path,s,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5173',...s?.headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};}
  async function product(price=333,eligible=true){const p=await db.product.create({data:{title:tag,subtitle:'隔离测试商品',description:'不进入正式库',category:'文创',cover:'/static/art/ink.svg',price,culturalOrigin:'测试',status:'PUBLISHED',memberDiscountEligible:eligible,skus:{create:{title:'标准',price,stock:100,active:true}}},include:{skus:true}});products.push(p.id);return p.skus[0];}
  async function member(s,rate=9000,waiver=true,minimum=0,scope){
    const latest=await db.membershipPlanVersion.aggregate({where:{planId:plan.id},_max:{releaseNo:true}}),v=await db.membershipPlanVersion.create({data:{planId:plan.id,releaseNo:latest._max.releaseNo+1,tier:2,days:90,description:'隔离冻结商城权益',termsSnapshot:{price:plan.price},publishedAt:new Date()}});versions.push(v.id);
    for(const [code,parameters] of [['PRODUCT_DISCOUNT',{basisPoints:rate}],...(waiver?[['SHIPPING_WAIVER',{minimumSubtotal:minimum}]]:[])]){
      const d=await db.benefitDefinition.findUniqueOrThrow({where:{code}}),b=await db.planBenefit.create({data:{planVersionId:v.id,definitionId:d.id,parameters,quota:null,periodKind:'MEMBERSHIP'}});if(scope)await db.benefitScope.create({data:{planBenefitId:b.id,resourceId:scope}});
    }
    return db.membership.create({data:{userId:s.user.id,planId:plan.id,planVersionId:v.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});
  }
  const dto=(s,sku,quantity=1,extra=[])=>({platform:'ANDROID',addressId:s.address.id,items:[{skuId:sku.id,quantity},...extra]});
  async function checkout(s,data){const q=await sales.quote(s.user.id,data),order=await sales.checkout(s.user.id,{...data,channel:'WECHAT_APP',quoteHash:q.quoteHash,requestKey:randomUUID()});return{q,order};}
  async function pay(s,order){await sales.prepay(order.id,s.user.id);const fact={...facts.get(order.orderNo),trade_state:'SUCCESS',transaction_id:'tx-'+randomUUID(),success_time:new Date().toISOString()};facts.set(order.orderNo,fact);assert.equal((await sales.confirmPayment(fact)).disposition,'ACCEPTED');return fact;}
  const root=await session('ADMIN');
  try{
    await t.test('membership tier alone never invents unpurchased discounts; ineligible items keep their price',async()=>{
      const s=await session(),sku=await product(333,false);await db.membership.create({data:{userId:s.user.id,planId:plan.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});
      const ordinary=await sales.quote(s.user.id,dto(s,sku));assert.equal(ordinary.discount,0);assert.equal(ordinary.shipping,130);
      await db.membership.updateMany({where:{userId:s.user.id},data:{revokedAt:new Date()}});await member(s,8500);const q=await sales.quote(s.user.id,dto(s,sku));assert.equal(q.discount,0);assert.equal(q.shipping,29);assert.equal(q.shippingDiscount,101);
    });
    await t.test('frozen discount, scoped eligibility, freight thresholds and surcharge are exact',async()=>{
      const s=await session(),a=await product(),b=await product(777);await member(s,8500,true,500);
      const q=await sales.quote(s.user.id,dto(s,a,2,[{skuId:b.id,quantity:1}]));assert.equal(q.items[0].productId===a.productId?q.items[0].discount:q.items[1].discount,99);
      assert.equal(q.discount,215);assert.equal(q.subtotal,1443);assert.equal(q.shipping,29);assert.equal(q.total,1257);assert.equal(q.shippingSurcharge,29);
      const below=await sales.quote(s.user.id,dto(s,a));assert.equal(below.shipping,130);assert.equal(below.discount,49);
      const scoped=await session();await member(scoped,9000,true,0,a.productId);const limited=await sales.quote(scoped.user.id,dto(scoped,a,2,[{skuId:b.id,quantity:1}]));assert.equal(limited.discount,66);assert.equal(limited.shipping,130);
    });
    await t.test('expiry and revocation invalidate stale quotes before stock reservation',async()=>{
      for(const field of ['endsAt','revokedAt']){const s=await session(),sku=await product(),m=await member(s),data=dto(s,sku),q=await sales.quote(s.user.id,data);await db.membership.update({where:{id:m.id},data:{[field]:new Date(Date.now()-1)}});await assert.rejects(sales.checkout(s.user.id,{...data,quoteHash:q.quoteHash,channel:'WECHAT_APP',requestKey:randomUUID()}),/重新确认/);assert.equal((await db.productSku.findUniqueOrThrow({where:{id:sku.id}})).reserved,0);}
    });
    await t.test('discount usage holds until payment or cancellation; refunded actual money restores usage once',async()=>{
      const s=await session(),sku=await product();await member(s,9000);const data=dto(s,sku,3),cancelled=await checkout(s,data);
      assert.equal(await db.benefitUsage.count({where:{userId:s.user.id,state:'HELD'}}),2);await sales.cancel(cancelled.order.id,s.user.id);assert.equal(await db.benefitUsage.count({where:{userId:s.user.id,state:'HELD'}}),0);
      const {q,order}=await checkout(s,data);await db.product.update({where:{id:sku.productId},data:{memberDiscountEligible:false}});const fact=await pay(s,order);await sales.confirmPayment(fact);assert.equal(q.discount,99);assert.equal(q.total,929);assert.equal(await db.benefitUsage.count({where:{userId:s.user.id,state:'CONSUMED'}}),2);
      const row=await db.tradeOrder.findUniqueOrThrow({where:{id:order.id}}),item=await db.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}});assert.equal(row.discountTotal,99n);assert.equal(item.discountAllocated,99n);assert.equal(item.payable,929n);
      for(const quantity of [1,2]){await sales.requestRefund(order.id,s.user.id,{requestKey:randomUUID(),kind:'REFUND_ONLY',reason:'未发货部分按实付取消',items:[{orderItemId:item.id,quantity}]});const refund=await db.refund.findFirstOrThrow({where:{orderId:order.id,state:'REQUESTED'}});await sales.reviewRefund(refund.id,{actor:{id:root.user.id,roles:['ADMIN']}},{expectedVersion:refund.version,action:'APPROVE',reason:'核对实付与运费分摊'});await sales.runJobs();}
      assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:order.id}})).refundedTotal,929n);assert.equal(await db.benefitUsage.count({where:{userId:s.user.id,state:'CONSUMED'}}),0);assert.equal(await db.benefitUsage.count({where:{userId:s.user.id,state:'REVERSED'}}),2);assert.equal((await db.productSku.findUniqueOrThrow({where:{id:sku.id}})).stock,100);
    });
    await t.test('benefit revocation after checkout prevents collecting at the obsolete discounted amount',async()=>{
      const s=await session(),sku=await product(),m=await member(s),{order}=await checkout(s,dto(s,sku));await db.membership.update({where:{id:m.id},data:{revokedAt:new Date()}});assert.equal((await sales.detail(order.id,s.user.id)).canPay,false);assert.match((await sales.detail(order.id,s.user.id)).paymentNotice,/取消后重新下单/);await assert.rejects(sales.prepay(order.id,s.user.id),/优惠已失效/);assert.equal(await db.paymentAttempt.count({where:{orderId:order.id}}),0);await sales.cancel(order.id,s.user.id);
    });
    await t.test('trusted payment after benefit revocation is recorded and compensated without consuming inventory',async()=>{
      const s=await session(),sku=await product(),m=await member(s),{order}=await checkout(s,dto(s,sku));await sales.prepay(order.id,s.user.id);await db.membership.update({where:{id:m.id},data:{revokedAt:new Date(Date.now()-1)}});
      const fact={...facts.get(order.orderNo),trade_state:'SUCCESS',transaction_id:'tx-'+randomUUID(),success_time:new Date().toISOString()};assert.equal((await sales.confirmPayment(fact)).disposition,'REFUND_REQUIRED');await sales.confirmPayment(fact);
      assert.equal((await db.productSku.findUniqueOrThrow({where:{id:sku.id}})).stock,100);assert.equal(await db.benefitUsage.count({where:{userId:s.user.id,state:'HELD'}}),0);assert.equal(await db.paymentTransaction.count({where:{orderId:order.id}}),1);await sales.runJobs();assert.equal((await db.refund.findFirstOrThrow({where:{orderId:order.id}})).state,'SUCCEEDED');
    });
    await t.test('version publishing checks permissions and conflicts; old and new grants have different purchased prices',async()=>{
      const old=await session(),fresh=await session(),sku=await product();await db.membership.create({data:{userId:old.user.id,planId:plan.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});
      const path='/admin/membership-benefits/plans/'+plan.id+'/commerce',body={expectedVersion:plan.version,productBasisPoints:9500,shippingWaiver:true,minimumSubtotal:0,reason:'明确新售权益，旧授权保持不变'};
      assert.equal((await call(path,await session('OPERATOR'),'POST',body)).status,403);assert.equal((await call(path,root,'POST',{...body,productBasisPoints:0})).status,400);
      const changed=await call(path,root,'POST',body);assert.equal(changed.status,201,JSON.stringify(changed.body));versions.push(changed.body.currentVersionId);assert.equal((await call(path,root,'POST',body)).status,409);
      await db.membership.create({data:{userId:fresh.user.id,planId:plan.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});
      assert.equal((await sales.quote(old.user.id,dto(old,sku))).discount,0);assert.equal((await sales.quote(fresh.user.id,dto(fresh,sku))).discount,16);assert.equal((await sales.quote(fresh.user.id,dto(fresh,sku))).shipping,29);
      assert.equal(await db.auditLog.count({where:{actorId:root.user.id,action:'membership.commerce.version'}}),1);
    });
  }finally{
    mock.restoreAll();process.env.PRODUCT_SALES_ENABLED=previous??'false';await app.close();
    const orders=(await db.tradeOrder.findMany({where:{userId:{in:users}}})).map(o=>o.id),items=(await db.tradeOrderItem.findMany({where:{orderId:{in:orders}}})).map(i=>i.id),refunds=(await db.refund.findMany({where:{orderId:{in:orders}}})).map(r=>r.id),journals=(await db.financeJournal.findMany({where:{orderId:{in:orders}}})).map(j=>j.id);
    await db.benefitUsage.deleteMany({where:{userId:{in:users}}});await db.membership.deleteMany({where:{userId:{in:users}}});
    await db.membershipPlan.update({where:{id:plan.id},data:{description:plan.description,currentVersionId:plan.currentVersionId,version:{increment:1}}});
    const bs=(await db.planBenefit.findMany({where:{planVersionId:{in:versions}}})).map(b=>b.id);await db.benefitScope.deleteMany({where:{planBenefitId:{in:bs}}});await db.planBenefit.deleteMany({where:{id:{in:bs}}});await db.membershipPlanVersion.deleteMany({where:{id:{in:versions}}});
    await db.financeEntry.deleteMany({where:{journalId:{in:journals}}});await db.financeJournal.deleteMany({where:{id:{in:journals}}});await db.inventoryLedger.deleteMany({where:{orderItemId:{in:items}}});await db.inventoryReservation.deleteMany({where:{orderItemId:{in:items}}});await db.refundTransaction.deleteMany({where:{refundId:{in:refunds}}});await db.refundItem.deleteMany({where:{refundId:{in:refunds}}});await db.refund.deleteMany({where:{id:{in:refunds}}});await db.paymentTransaction.deleteMany({where:{orderId:{in:orders}}});await db.paymentAttempt.deleteMany({where:{orderId:{in:orders}}});await db.notification.deleteMany({where:{userId:{in:users}}});await db.outboxJob.deleteMany({where:{aggregateId:{in:[...orders,...refunds]}}});await db.tradeOrderItem.deleteMany({where:{id:{in:items}}});await db.tradeOrder.deleteMany({where:{id:{in:orders}}});
    const skus=(await db.productSku.findMany({where:{productId:{in:products}}})).map(s=>s.id);await db.saleOffer.deleteMany({where:{skuId:{in:skus}}});await db.product.deleteMany({where:{id:{in:products}}});await db.address.deleteMany({where:{userId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.deliveryZone.delete({where:{province:zone.province}});
    await db.$disconnect();
  }
});
