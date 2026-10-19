import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';import {Database} from '../dist/database.js';import {MarketingService} from '../dist/marketing.js';import {PointsRedemptions} from '../dist/points-redemptions.js';
if(!new URL(process.env.DATABASE_URL).pathname.startsWith('/academy_test_'))throw Error('Use isolated test/run-tests.mjs');
test('R1 coupon exchange charges once and cannot be bypassed through public claims',async t=>{
 const db=new Database(),app=await createApp(false);await app.init();const marketing=app.get(MarketingService),points=app.get(PointsRedemptions),actor=await db.user.create({data:{nickname:'积分兑券运营',roles:['ADMIN']}}),user=await db.user.create({data:{nickname:'积分兑券学员'}}),other=await db.user.create({data:{nickname:'其他兑券学员'}});
 const terms={title:'研习课程立减券',claimPolicy:'POINTS',discountKind:'FIXED',discountValue:1000,threshold:2000,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),validDays:1,totalLimit:1,perUserLimit:1,allowedChannels:['WECHAT_APP','ALIPAY_APP'],courseIds:[],active:true,reason:'独立自动测试，积分券不能免费领'};
 let template,publicTemplate,reward,redemption;
 try{
 await db.pointsAccount.create({data:{userId:user.id,balance:500n}});await db.pointsAccount.create({data:{userId:other.id,balance:200n}});
 await t.test('public and points templates have distinct distribution channels',async()=>{
  template=await marketing.createCoupon(actor.id,terms);publicTemplate=await marketing.createCoupon(actor.id,{...terms,claimPolicy:'PUBLIC',title:'公开领取课程券'});
  assert.equal((await marketing.coupons(undefined,{page:1,size:50})).items.some(c=>c.id===template.id),false);assert.equal((await marketing.coupons(undefined,{page:1,size:50},true)).items.some(c=>c.id===template.id),true);
  await assert.rejects(()=>marketing.claim(template.id,user.id,randomUUID()));assert.equal((await db.couponTemplate.findUniqueOrThrow({where:{id:template.id}})).issuedCount,0);
  await assert.rejects(()=>points.create(actor.id,{title:'不能用免费券扣积分',kind:'COUPON',couponTemplateId:publicTemplate.id,pointsCost:100,stock:3,perUserDaily:3,active:true,reason:'验证错误目标'}));
  assert.ok(!(await points.options()).coupons.some(c=>c.id===publicTemplate.id));reward=await points.create(actor.id,{title:'100积分兑换课程券',kind:'COUPON',couponTemplateId:template.id,pointsCost:100,stock:3,perUserDaily:3,active:true,reason:'验证真实扣分发券'});
 });
 await t.test('concurrent retries exchange the same coupon once without cash orders',async()=>{
  const dto={requestKey:randomUUID(),expectedVersion:reward.version,consent:true},rows=await Promise.all([points.redeem(reward.id,{actor:user},dto),points.redeem(reward.id,{actor:user},dto)]);redemption=rows[0];assert.equal(rows[0].id,rows[1].id);assert.equal(redemption.state,'COMPLETED');assert.ok(redemption.userCouponId);assert.equal(redemption.orderId,null);
  assert.equal((await db.pointsAccount.findUniqueOrThrow({where:{userId:user.id}})).balance,400n);assert.equal(await db.pointsLedger.count({where:{eventKey:'points.redeem:'+redemption.id}}),1);assert.equal((await db.couponTemplate.findUniqueOrThrow({where:{id:template.id}})).issuedCount,1);assert.equal(await db.tradeOrder.count({where:{userId:user.id}}),0);
  await assert.rejects(()=>points.redeem(reward.id,{actor:user},{...dto,consent:false}));await assert.rejects(()=>marketing.claim(template.id,user.id,dto.requestKey));
 });
 await t.test('coupon exhaustion rolls back reward stock and points even if reward stock remains',async()=>{
  const current=await db.pointsReward.findUniqueOrThrow({where:{id:reward.id}}),before=await db.pointsAccount.findUniqueOrThrow({where:{userId:other.id}});
  await assert.rejects(()=>points.redeem(reward.id,{actor:other},{requestKey:randomUUID(),expectedVersion:current.version,consent:true}));assert.deepEqual(await db.pointsAccount.findUniqueOrThrow({where:{userId:other.id}}),before);assert.equal((await db.pointsReward.findUniqueOrThrow({where:{id:reward.id}})).stock,2);assert.equal(await db.pointsRedemption.count({where:{userId:other.id}}),0);const visible=(await points.list({page:1,size:50},false,other.id)).items.find(r=>r.id===reward.id);assert.equal(visible.remaining,0);assert.equal(visible.available,false);const owned=(await points.list({page:1,size:50},false,user.id)).items.find(r=>r.id===reward.id);assert.equal(owned.unavailableReason,'已达领取上限');
 });
 await t.test('issued terms, expiry, wallet and Android use remain frozen after distribution stops',async()=>{
  await marketing.couponState(template.id,actor.id,{expectedVersion:(await db.couponTemplate.findUniqueOrThrow({where:{id:template.id}})).version,active:false,reason:'停止新兑换，原券继续有效'});
  const wallet=await marketing.wallet(user.id,{page:1,size:20}),coupon=wallet.items.find(c=>c.id===redemption.userCouponId);assert.equal(coupon.state,'AVAILABLE');assert.equal(coupon.termsSnapshot.threshold,'2000');assert.equal(coupon.expiresAt,template.endsAt);
  const courseId=randomUUID();assert.equal((await marketing.coursePrice(db,user.id,courseId,5000n,'ANDROID','WECHAT_APP')).discount,1000n);assert.equal((await marketing.coursePrice(db,user.id,courseId,1000n,'ANDROID','WECHAT_APP')).discount,0n);assert.equal((await marketing.coursePrice(db,user.id,courseId,5000n,'IOS','APPLE_IAP')).discount,0n);
  await db.$transaction(tx=>marketing.freeze(tx,user.id,redemption.id,{id:coupon.id,version:coupon.version})).catch(error=>{assert.match(String(error),/foreign key|constraint/i);});
  assert.equal((await db.userCoupon.findUniqueOrThrow({where:{id:coupon.id}})).state,'AVAILABLE');
 });
 await t.test('outstanding reversal debt denies new exchanges without touching balances or stock',async()=>{
  const extra=await marketing.createCoupon(actor.id,{...terms,title:'待抵扣保护测试券',totalLimit:2}),r=await points.create(actor.id,{title:'待抵扣期间不可兑换',kind:'COUPON',couponTemplateId:extra.id,pointsCost:100,stock:2,perUserDaily:2,active:true,reason:'保护待抵扣积分'});
  await db.pointsAccount.update({where:{userId:other.id},data:{debt:1n}});await assert.rejects(()=>points.redeem(r.id,{actor:other},{requestKey:randomUUID(),expectedVersion:r.version,consent:true}));assert.equal((await db.pointsAccount.findUniqueOrThrow({where:{userId:other.id}})).balance,200n);assert.equal((await db.couponTemplate.findUniqueOrThrow({where:{id:extra.id}})).issuedCount,0);
 });
 }finally{await app.close();await db.$disconnect();}
});
