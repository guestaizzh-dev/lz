import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {encryptPrivate,phoneLookup} from '../dist/private-data.js';
import {membershipRefundHolds} from '../dist/membership-benefits.js';

test('member directory counts registered people, current tiers and protected searchable records',async t=>{
 const app=await createApp(false);app.useLogger(['error']);await app.listen(0,'127.0.0.1');const db=app.get(Database),auth=app.get(AuthService),base=await app.getUrl(),prefix='directory-'+randomUUID(),people=[];
 async function user(name,fields={}){const u=await db.user.create({data:{nickname:prefix+name,roles:['USER'],...fields}});people.push(u);return u;}
 async function actor(role){const u=await user(role,{roles:[role]}),c=auth.credentials(),csrf=randomUUID();await db.authSession.create({data:{userId:u.id,kind:'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});return{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrf};}
 async function get(query='',headers=root){const r=await fetch(base+'/api/v1/admin/memberships/users'+query,{headers:{Origin:'http://127.0.0.1:5173',...headers}});return{status:r.status,body:await r.json()};}
 const root=await actor('ADMIN'),support=await actor('SUPPORT'),baseline=(await get()).body.summary,plans=[];
 for(let tier=1;tier<=4;tier++)plans[tier]=await db.membershipPlan.upsert({where:{tier_days:{tier,days:30}},create:{tier,days:30,title:'测试档'+tier,price:100,description:'隔离验证',active:false},update:{}});
 async function grant(u,tier,extra={}){return db.membership.create({data:{userId:u.id,planId:plans[tier].id,tier,source:'ADMIN',startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),...extra}});}
 try{
  const phone='19988887777',basic=await user('基础',{phone:null,phoneCipher:encryptPrivate(phone),phoneHash:phoneLookup(phone)}),bronze=await user('铜牌'),silver=await user('银牌'),diamond=await user('钻石'),expired=await user('过期'),revoked=await user('撤销'),queued=await user('待生效'),frozen=await user('冻结',{status:'FROZEN'}),mixed=await user('100%_名字',{roles:['USER','TEACHER']}),deleted=await user('已注销',{status:'DELETED',deletedAt:new Date()}),held=await user('退款暂停');
  await grant(bronze,1);await grant(bronze,1,{startsAt:new Date(Date.now()+86401000),endsAt:new Date(Date.now()+172800000)});await grant(silver,2);await grant(diamond,3,{startsAt:new Date(Date.now()-172800000),endsAt:new Date(Date.now()-86400000)});await grant(diamond,4);await grant(expired,3,{endsAt:new Date(Date.now()-1)});await grant(revoked,4,{revokedAt:new Date()});await grant(queued,2,{startsAt:new Date(Date.now()+3600000)});await grant(frozen,1);
  await t.test('registration needs no grant and each person has one current highest tier',async()=>{
   const result=await get('?q='+prefix);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.total,10);const tier=id=>result.body.items.find(r=>r.id===id)?.tier;
   assert.equal(tier(basic.id),0);assert.equal(tier(bronze.id),1);assert.equal(tier(silver.id),2);assert.equal(tier(diamond.id),4);for(const u of [expired,revoked,queued,mixed,held])assert.equal(tier(u.id),0);assert.equal(tier(frozen.id),1);assert.ok(!result.body.items.some(r=>r.id===deleted.id));
   assert.equal(result.body.summary.registeredTotal-baseline.registeredTotal,10);assert.equal(result.body.summary.tiers.reduce((n,r)=>n+r.count,0),result.body.summary.registeredTotal);
  });
  await t.test('tier, status, exact encrypted phone and literal wildcard search are paginated and masked',async()=>{
   assert.equal((await get('?q='+prefix+'&tier=0')).body.total,6);assert.equal((await get('?q='+prefix+'&status=FROZEN')).body.items[0].id,frozen.id);
   const phoneResult=await get('?q='+phone);assert.equal(phoneResult.body.items[0].id,basic.id);assert.equal(phoneResult.body.items[0].phone,'199****7777');assert.ok(!JSON.stringify(phoneResult.body).includes(phone));assert.ok(!JSON.stringify(phoneResult.body).includes('phoneCipher'));
   assert.equal((await get('?q='+encodeURIComponent('100%_'))).body.total,1);const first=await get('?q='+prefix+'&size=3'),second=await get('?q='+prefix+'&size=3&page=2');assert.equal(first.body.total,10);assert.equal(first.body.items.length,3);assert.ok(!first.body.items.some(a=>second.body.items.some(b=>a.id===b.id)));
  });
  await t.test('refund-held grants follow the learning access rule and return to base tier',async()=>{
   const p=plans[1],order=await db.tradeOrder.create({data:{orderNo:randomUUID(),userId:held.id,kind:'MEMBERSHIP',requestKey:randomUUID(),requestHash:'a'.repeat(64),currency:'CNY',state:'COMPLETED',subtotal:100n,payableTotal:100n,paidTotal:100n,pricingSnapshot:{},quoteHash:'b'.repeat(64),expiresAt:new Date(Date.now()+100000)}}),offer=await db.saleOffer.create({data:{kind:'MEMBERSHIP',membershipVersionId:p.currentVersionId,price:100n,policySnapshot:{}}}),item=await db.tradeOrderItem.create({data:{orderId:order.id,offerId:offer.id,lineNo:1,quantity:1,unitPrice:100n,subtotal:100n,payable:100n,itemSnapshot:{},benefitSnapshot:{},membershipVersionId:p.currentVersionId,state:'FULFILLED'}}),payment=await db.paymentTransaction.create({data:{orderId:order.id,channel:'WECHAT_APP',appScope:'test',externalTransactionId:randomUUID(),amount:100n,currency:'CNY',disposition:'ACCEPTED',receiptHash:'c'.repeat(64),verifiedAt:new Date(),paidAt:new Date()}}),m=await grant(held,1,{source:'PURCHASE',planVersionId:p.currentVersionId,orderItemId:item.id,grantKey:'membership.payment:'+payment.id}),refund=await db.refund.create({data:{orderId:order.id,userId:held.id,requestKey:randomUUID(),kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:100n,approvedAmount:100n,reasonCode:'MEMBERSHIP_RETURN',description:'隔离测试',paymentTransactionId:payment.id}});
   await db.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:100n,revokeQuantity:1}});assert.ok((await membershipRefundHolds(held.id,db)).includes(m.id));assert.equal((await get('?q='+prefix+'退款暂停')).body.items[0].tier,0);
  });
  await t.test('unauthorized accounts and invalid filters are rejected',async()=>{assert.equal((await get('',support)).status,403);for(const q of ['?tier=-1','?tier=5','?size=101','?page=0'])assert.equal((await get(q)).status,400);});
 }finally{await app.close();}
});
