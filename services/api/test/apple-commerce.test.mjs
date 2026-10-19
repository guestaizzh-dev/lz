import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ServiceUnavailableException} from '@nestjs/common';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {AppleStoreService} from '../dist/apple-store.js';
import {AppleCommerceService} from '../dist/apple-commerce.js';
import {clearCourses} from './fixture-cleanup.mjs';

if(process.env.NODE_ENV!=='test')throw Error('Apple workflow fixtures require the isolated test runner');
test('Apple course workflow: owned receipts, immutable mappings, balanced ledger and revocation',async t=>{
  const names=['APPLE_IAP_ENABLED','APPLE_NATIVE_PURCHASE_READY','COURSE_WECHAT_ENABLED','COURSE_ALIPAY_ENABLED','COURSE_PAYMENT_WORKER_ENABLED','CORS_ORIGINS'],previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  Object.assign(process.env,{APPLE_IAP_ENABLED:'false',APPLE_NATIVE_PURCHASE_READY:'false',COURSE_WECHAT_ENABLED:'false',COURSE_ALIPAY_ENABLED:'false',COURSE_PAYMENT_WORKER_ENABLED:'false',CORS_ORIGINS:'http://127.0.0.1:5173'});
  const app=await createApp(false),db=new Database(),users=[],courses=[],teachers=[],assets=[],eventIds=[],prefix='qa-apple-'+randomUUID();
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),store=app.get(AppleStoreService),commerce=app.get(AppleCommerceService),auth=app.get(AuthService),scope='com.academy.test:Sandbox',facts=new Map();
  const identity={bundleId:'com.academy.test',environment:'Sandbox',appScope:scope};let failure=false;
  mock.method(store,'identity',()=>identity);
  mock.method(store,'latest',async id=>{if(failure)throw new ServiceUnavailableException('Apple API unavailable');if(!facts.has(id))throw Error('Missing verified fixture');return facts.get(id);});
  mock.method(store,'restore',async(signed,token)=>{const fact=facts.get(signed);if(!fact||fact.accountToken!==token)throw Error('此Apple交易属于其他书院账号');return store.latest(signed);});
  let event;
  mock.method(store,'notification',async()=>event);
  async function session(role,kind){const user=await db.user.create({data:{nickname:prefix+role+users.length,roles:[role],tags:[]}});users.push(user.id);const credentials=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:credentials.accessHash,refreshHash:credentials.refreshHash,accessExpiresAt:credentials.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return{user,access:credentials.access,csrfToken,kind};}
  async function call(path,session,method='GET',body){const response=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Origin:process.env.CORS_ORIGINS,...(session?.kind==='APP'?{Authorization:'Bearer '+session.access}:session?{Cookie:'daoxue_access='+session.access,'X-CSRF-Token':session.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const content=await response.text();return{status:response.status,body:content?JSON.parse(content):null};}
  let root,support,operator,a,b,teacher,asset;
  async function course(days=null){
    const created=await call('/admin/courses',root,'POST',{title:prefix+courses.length,subtitle:'Apple流程测试',description:'集成测试专用课程',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:8800,teacherId:teacher.id,membershipTier:null,accessDays:days,refundPolicy:'Apple审核退款',tags:[],featured:false,chapters:[{title:'付费课件',format:'VIDEO',body:'',mediaId:asset.id,durationSeconds:120,trial:false,required:true}]});assert.equal(created.status,201,JSON.stringify(created.body));courses.push(created.body.id);
    const submitted=await call('/admin/courses/'+created.body.id+'/transition',root,'POST',{action:'submit',expectedVersion:created.body.version,reason:'测试提交'});assert.equal(submitted.status,201);
    const published=await call('/admin/courses/'+created.body.id+'/transition',root,'POST',{action:'publish',expectedVersion:submitted.body.version,reason:'测试发布'});assert.equal(published.status,201);return published.body;
  }
  async function mapped(c){const offer=await db.saleOffer.findFirstOrThrow({where:{courseReleaseId:c.publishedReleaseId}}),created=await call('/admin/apple-products',root,'POST',{offerId:offer.id,bundleId:identity.bundleId,environment:'Sandbox',externalProductId:'academy.course.'+randomUUID(),priceMinor:8800,reason:'测试真实流程映射'});assert.equal(created.status,201,JSON.stringify(created.body));const active=await call('/admin/apple-products/'+created.body.id+'/activation',root,'POST',{active:true,expectedVersion:created.body.version,reason:'正式产品配置已核查'});assert.equal(active.status,201,JSON.stringify(active.body));return active.body;}
  async function prepare(mapping,owner=a){const response=await call('/commerce/apple/prepare',owner,'POST',{mappingId:mapping.id,expectedVersion:mapping.version,accepted:true});assert.equal(response.status,201,JSON.stringify(response.body));return response.body;}
  function receipt(mapping,token,change={}){const id=String(2000000000000+facts.size),purchasedAt=new Date(Date.now()+20),fact={transactionId:id,originalTransactionId:id,productId:mapping.externalProductId,accountToken:token,bundleId:identity.bundleId,environment:'Sandbox',type:'Non-Consumable',amount:8800n,currency:'CNY',purchasedAt,signedAt:new Date(purchasedAt.getTime()+10),revokedAt:null,revocationType:null,revocationPercentage:null,...change};facts.set(id,fact);return fact;}
  async function restore(fact,owner=a){return call('/commerce/apple/restore',owner,'POST',{signedTransaction:fact.transactionId});}
  try{
    root=await session('ADMIN','ADMIN');support=await session('SUPPORT','ADMIN');operator=await session('OPERATOR','ADMIN');a=await session('USER','APP');b=await session('USER','APP');
    teacher=await db.teacher.create({data:{name:prefix,title:'流程测试名师',bio:'测试简介',expertise:[],status:'PUBLISHED'}});teachers.push(teacher.id);
    const bytes=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109]);asset=await db.mediaAsset.create({data:{storageKey:randomUUID(),name:prefix+'.mp4',mime:'video/mp4',bytes:bytes.length,uploaderId:root.user.id,status:'READY',visibility:'PRIVATE'}});assets.push(asset.id);await writeFile(join(process.env.MEDIA_DIR,asset.storageKey),bytes);
    let primary,mapping,prepared,fact,orderId;
    await t.test('native gate, admin permission and immutable mapping prevent accidental charging',async()=>{
      primary=await course();mapping=await mapped(primary);
      assert.equal((await call('/commerce/apple/prepare',a,'POST',{mappingId:mapping.id,expectedVersion:mapping.version,accepted:true})).status,503);
      assert.equal((await call('/admin/apple-products/'+mapping.id+'/activation',operator,'POST',{active:false,expectedVersion:mapping.version,reason:'越权停售测试'})).status,403);
      assert.equal((await call('/admin/data/channel_product_mapping/'+mapping.id,root,'PATCH',{active:false})).status,403);
      await assert.rejects(db.channelProductMapping.update({where:{id:mapping.id},data:{priceMinor:9900n}}),/immutable/);
      const repeat=await call('/admin/apple-products',root,'POST',{offerId:mapping.offerId,bundleId:identity.bundleId,environment:'Sandbox',externalProductId:mapping.externalProductId,priceMinor:8800,reason:'不可重新绑定'});assert.equal(repeat.status,409);
      const finite=await course(30),offer=await db.saleOffer.findFirstOrThrow({where:{courseReleaseId:finite.publishedReleaseId}});assert.equal((await call('/admin/apple-products',root,'POST',{offerId:offer.id,bundleId:identity.bundleId,environment:'Sandbox',externalProductId:'academy.finite',priceMinor:8800,reason:'限期课程不冒充长期产品'})).status,400);
      process.env.APPLE_NATIVE_PURCHASE_READY='true';prepared=await prepare(mapping);const same=await prepare(mapping);assert.equal(same.appAccountToken,prepared.appAccountToken);assert.match(prepared.appAccountToken,/^[a-f0-9-]{36}$/);
      assert.equal((await call('/commerce/apple/prepare',a,'POST',{mappingId:mapping.id,expectedVersion:mapping.version,accepted:false})).status,400);
    });
    await t.test('concurrent restore produces one immutable order, receipt, balanced journal and original grant',async()=>{
      fact=receipt(mapping,prepared.appAccountToken);const results=await Promise.all([restore(fact),restore(fact)]);for(const r of results)assert.equal(r.status,201,JSON.stringify(r.body));orderId=results[0].body.orderId;assert.equal(results[1].body.orderId,orderId);assert.equal(results[0].body.state,'DELIVERED');
      assert.equal(await db.paymentTransaction.count({where:{orderId}}),1);assert.equal(await db.financeJournal.count({where:{orderId}}),1);const journals=await db.financeJournal.findMany({where:{orderId},select:{id:true}}),entries=await db.financeEntry.findMany({where:{journalId:{in:journals.map(j=>j.id)}}});assert.equal(entries.reduce((sum,r)=>sum+r.debit-r.credit,0n),0n);assert.equal(entries.find(e=>e.debit>0n).accountCode,'APPLE_RECEIVABLE');
      const grant=await db.enrollment.findUniqueOrThrow({where:{userId_courseId:{userId:a.user.id,courseId:primary.id}}});assert.equal(grant.startsAt.getTime(),fact.purchasedAt.getTime());await db.enrollment.update({where:{id:grant.id},data:{startedAt:new Date()}});assert.equal((await restore(fact)).status,201);const preserved=await db.enrollment.findUniqueOrThrow({where:{id:grant.id}});assert.equal(preserved.grantKey,grant.grantKey);assert.ok(preserved.startedAt);
      const detail=await call('/commerce/course-orders/'+orderId,a);assert.equal(detail.status,200);assert.equal(detail.body.channel,'APPLE_IAP');assert.equal(detail.body.canRefund,false);assert.match(detail.body.refundUnavailableReason,/Apple/);assert.equal((await call('/commerce/course-orders/'+orderId+'/refund',a,'POST',{requestKey:randomUUID(),reason:'不走错误支付渠道'})).status,400);
      assert.equal((await call('/commerce/course-orders/'+orderId+'/refresh',a,'POST',{})).status,201);
    });
    await t.test('cross-account restore and immutable original ownership cannot transfer transactions',async()=>{
      const other=await prepare(mapping,b);await assert.rejects(commerce.restore(b.user.id,fact.transactionId),/其他书院账号/);
      const forged={...fact,accountToken:other.appAccountToken,signedAt:new Date(fact.signedAt.getTime()+100)};await assert.rejects(commerce.process(forged),/不可改变/);
      const different={...fact,transactionId:fact.transactionId+'9',accountToken:other.appAccountToken,signedAt:new Date(fact.signedAt.getTime()+100)};await assert.rejects(commerce.process(different),/绑定其他账号/);
      assert.equal(await db.enrollment.count({where:{userId:b.user.id,courseId:primary.id}}),0);
      const binding=await db.appleAccountBinding.findFirstOrThrow({where:{userId:a.user.id}});await assert.rejects(db.appleAccountBinding.update({where:{id:binding.id},data:{userId:b.user.id}}),/immutable/);
    });
    await t.test('unmapped or mismatched signed facts are retained for actionable recovery without fake delivery',async()=>{
      const unknown=receipt(mapping,prepared.appAccountToken,{productId:'academy.unknown'}),result=await commerce.process(unknown);assert.equal(result.state,'REVIEW');assert.equal(result.issueCode,'PRODUCT_NOT_MAPPED');assert.equal(result.paymentId,null);
      const price=receipt(mapping,prepared.appAccountToken,{amount:8700n}),bad=await commerce.process(price);assert.equal(bad.issueCode,'MAPPING_OR_PRICE_MISMATCH');assert.equal(bad.paymentId,null);
      const tooEarly=receipt(mapping,prepared.appAccountToken,{purchasedAt:new Date(Date.parse(mapping.activatedAt)-1)});assert.equal((await commerce.process(tooEarly)).issueCode,'MAPPING_OR_PRICE_MISMATCH');
      const unbound=receipt(mapping,randomUUID()),unowned=await commerce.process(unbound);assert.equal(unowned.issueCode,'ACCOUNT_NOT_BOUND');
      assert.equal((await call('/admin/apple-transactions?state=REVIEW',support)).status,200);assert.equal((await call('/admin/apple-transactions/'+result.id+'/refresh',support,'POST',{})).status,403);
      assert.equal((await call('/admin/apple-transactions?state=garbage',root)).status,400);
    });
    await t.test('full revocation posts once, stale replay cannot resurrect, query failures retain state',async()=>{
      const revoked={...fact,revokedAt:new Date(fact.signedAt.getTime()+100),signedAt:new Date(fact.signedAt.getTime()+200),revocationType:'REFUND_FULL'};facts.set(fact.transactionId,revoked);const results=await Promise.all([restore(revoked),restore(revoked)]);for(const r of results)assert.equal(r.body.state,'REVOKED');
      assert.equal(await db.refundTransaction.count({where:{paymentTransactionId:(await db.appleTransactionState.findFirstOrThrow({where:{transactionId:fact.transactionId}})).paymentId}}),1);assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:orderId}})).refundedTotal,8800n);assert.ok((await db.enrollment.findFirstOrThrow({where:{userId:a.user.id,courseId:primary.id}})).revokedAt);
      assert.equal((await commerce.process(fact)).state,'REVOKED');assert.equal(await db.financeJournal.count({where:{orderId}}),2);
      failure=true;assert.equal((await call('/commerce/course-orders/'+orderId+'/refresh',a,'POST',{})).status,503);failure=false;assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:orderId}})).refundedTotal,8800n);
    });
    await t.test('verified reversal posts an immutable counter-journal once, restores original learning and supports a new refund cycle',async()=>{
      const revoked=facts.get(fact.transactionId),before=await db.enrollment.findFirstOrThrow({where:{userId:a.user.id,courseId:primary.id}}),clear={...fact,signedAt:new Date(revoked.signedAt.getTime()+100)};
      facts.set(fact.transactionId,clear);const restored=await Promise.all([restore(clear),restore(clear)]);for(const r of restored)assert.equal(r.body.state,'DELIVERED',JSON.stringify(r.body));
      assert.equal(await db.financeJournal.count({where:{orderId}}),3);assert.equal(await db.refund.count({where:{orderId,state:'REVERSED'}}),1);assert.equal(await db.refundTransaction.count({where:{paymentTransactionId:(await db.appleTransactionState.findFirstOrThrow({where:{transactionId:fact.transactionId}})).paymentId}}),1);
      assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:orderId}})).refundedTotal,0n);const grant=await db.enrollment.findUniqueOrThrow({where:{id:before.id}});assert.equal(grant.revokedAt,null);assert.equal(grant.startsAt.getTime(),before.startsAt.getTime());assert.equal(grant.startedAt.getTime(),before.startedAt.getTime());assert.equal(grant.releaseId,before.releaseId);assert.equal(grant.grantKey,before.grantKey);
      const refundJournal=await db.financeJournal.findFirstOrThrow({where:{orderId,kind:'COURSE_REFUND'}}),reversal=await db.financeJournal.findUniqueOrThrow({where:{reversalOfId:refundJournal.id}}),originalEntries=await db.financeEntry.findMany({where:{journalId:refundJournal.id}}),reverseEntries=await db.financeEntry.findMany({where:{journalId:reversal.id}});
      for(const entry of originalEntries){const opposite=reverseEntries.find(e=>e.accountCode===entry.accountCode);assert.equal(opposite.debit,entry.credit);assert.equal(opposite.credit,entry.debit);}
      const overview=await call('/admin/overview',root);assert.equal(overview.status,200);assert.equal(overview.body.finance.trend.reduce((sum,r)=>sum+BigInt(r.refunded),0n),0n);
      assert.equal((await commerce.process(revoked)).state,'DELIVERED');assert.equal(await db.financeJournal.count({where:{orderId}}),3);
      const next={...revoked,revokedAt:new Date(clear.signedAt.getTime()+100),signedAt:new Date(clear.signedAt.getTime()+200)};facts.set(fact.transactionId,next);const results=await Promise.all([restore(next),restore(next)]);for(const r of results)assert.equal(r.body.state,'REVOKED');assert.equal(await db.refundTransaction.count({where:{paymentTransactionId:(await db.appleTransactionState.findFirstOrThrow({where:{transactionId:fact.transactionId}})).paymentId}}),2);assert.equal(await db.financeJournal.count({where:{orderId}}),4);assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:orderId}})).refundedTotal,8800n);
    });
    await t.test('refund reversal recovers withheld original delivery when the course becomes available without reposting money',async()=>{
      const c=await course(),m=await mapped(c),p=await prepare(m),f=receipt(m,p.appAccountToken),revoked={...f,revokedAt:new Date(f.signedAt.getTime()+100),signedAt:new Date(f.signedAt.getTime()+200),revocationType:'REFUND_FULL'};
      const row=await commerce.process(revoked),payment=await db.paymentTransaction.findUniqueOrThrow({where:{id:row.paymentId}});assert.equal(await db.enrollment.count({where:{userId:a.user.id,courseId:c.id}}),0);
      await db.courseRelease.update({where:{id:c.publishedReleaseId},data:{withdrawnAt:new Date(),withdrawalReason:'测试停止交付'}});const clear={...f,signedAt:new Date(revoked.signedAt.getTime()+100)};
      assert.equal((await commerce.process(clear)).issueCode,'REFUND_REVERSAL_DELIVERY_UNAVAILABLE');assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}})).refundedTotal,0n);assert.equal(await db.financeJournal.count({where:{orderId:payment.orderId}}),3);assert.equal(await db.enrollment.count({where:{userId:a.user.id,courseId:c.id}}),0);
      await db.courseRelease.update({where:{id:c.publishedReleaseId},data:{withdrawnAt:null,withdrawalReason:null}});assert.equal((await commerce.process(clear)).state,'DELIVERED');assert.equal(await db.financeJournal.count({where:{orderId:payment.orderId}}),3);assert.equal((await db.enrollment.findFirstOrThrow({where:{userId:a.user.id,courseId:c.id}})).startsAt.getTime(),f.purchasedAt.getTime());
    });
    await t.test('reversal preserves replacement grants and closed accounts while reversing verified money',async()=>{
      for(const closed of [false,true]){
        const owner=closed?await session('USER','APP'):a,c=await course(),m=await mapped(c),p=await prepare(m,owner),f=receipt(m,p.appAccountToken),row=await commerce.process(f),payment=await db.paymentTransaction.findUniqueOrThrow({where:{id:row.paymentId}}),revoked={...f,revokedAt:new Date(f.signedAt.getTime()+100),signedAt:new Date(f.signedAt.getTime()+200),revocationType:'REFUND_FULL'};
        await commerce.process(revoked);const grant=await db.enrollment.findFirstOrThrow({where:{userId:owner.user.id,courseId:c.id}});
        if(closed)await db.user.update({where:{id:owner.user.id},data:{status:'DELETED',deletedAt:new Date()}});
        else await db.enrollment.update({where:{id:grant.id},data:{source:'ADMIN_COMPENSATION',orderItemId:null,grantKey:randomUUID(),revokedAt:null}});
        const before=await db.enrollment.findUniqueOrThrow({where:{id:grant.id}}),clear={...f,signedAt:new Date(revoked.signedAt.getTime()+100)},result=await commerce.process(clear);assert.equal(result.issueCode,closed?'REFUND_REVERSAL_ACCOUNT_UNAVAILABLE':'REFUND_REVERSAL_GRANT_CONFLICT');assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}})).refundedTotal,0n);assert.deepEqual(await db.enrollment.findUniqueOrThrow({where:{id:grant.id}}),before);assert.equal(await db.financeJournal.count({where:{orderId:payment.orderId}}),3);
        await commerce.process(clear);assert.equal(await db.financeJournal.count({where:{orderId:payment.orderId}}),3);
      }
    });
    await t.test('partial or unspecified revocations revoke only the original grant without inventing full refunds',async()=>{
      const c=await course(),m=await mapped(c),p=await prepare(m),f=receipt(m,p.appAccountToken),row=await commerce.process(f),payment=await db.paymentTransaction.findUniqueOrThrow({where:{id:row.paymentId}});
      const enrollment=await db.enrollment.findFirstOrThrow({where:{userId:a.user.id,courseId:c.id}});await db.enrollment.update({where:{id:enrollment.id},data:{source:'ADMIN_COMPENSATION',grantKey:randomUUID(),orderItemId:null}});
      const partial={...f,revokedAt:new Date(f.signedAt.getTime()+100),signedAt:new Date(f.signedAt.getTime()+200),revocationType:'REFUND_PRORATED',revocationPercentage:50000};const reviewed=await commerce.process(partial);assert.equal(reviewed.issueCode,'REVOCATION_AMOUNT_REQUIRES_REVIEW');assert.equal(await db.refundTransaction.count({where:{paymentTransactionId:payment.id}}),0);assert.equal((await db.enrollment.findUniqueOrThrow({where:{id:enrollment.id}})).revokedAt,null);
      assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}})).refundedTotal,0n);
    });
    await t.test('disabled mapping restores pre-stop receipts but rejects new purchases and reactivation',async()=>{
      const c=await course(),m=await mapped(c),p=await prepare(m),before=receipt(m,p.appAccountToken,{purchasedAt:new Date(Date.now()-1)});before.signedAt=new Date();await new Promise(r=>setTimeout(r,30));const stop=await call('/admin/apple-products/'+m.id+'/activation',root,'POST',{active:false,expectedVersion:m.version,reason:'停止新购保留旧凭证'});assert.equal(stop.status,201);
      assert.equal((await commerce.process(before)).state,'DELIVERED');const late=receipt(m,p.appAccountToken);assert.equal((await commerce.process(late)).issueCode,'MAPPING_OR_PRICE_MISMATCH');assert.equal((await call('/admin/apple-products/'+m.id+'/activation',root,'POST',{active:true,expectedVersion:stop.body.version,reason:'不能改写停售期间的事实'})).status,409);
    });
    await t.test('V2 notifications deduplicate receipts and reject changed event payloads before applying money',async()=>{
      const id=randomUUID();eventIds.push(id);event={id,kind:'REFUND',payloadHash:'a'.repeat(64),fact:facts.get(fact.transactionId)};
      const notify=()=>call('/payments/apple/notify',null,'POST',{signedPayload:'authenticated-fixture'});assert.equal((await notify()).status,200);assert.equal((await notify()).status,200);assert.equal(await db.providerCallback.count({where:{provider:'APPLE_IAP',externalEventId:id}}),1);
      event={...event,payloadHash:'b'.repeat(64)};assert.equal((await notify()).status,409);assert.equal(await db.financeJournal.count({where:{orderId}}),4);
    });
    await t.test('closed accounts retain binding and paid facts without receiving new course grants',async()=>{
      const closing=await session('USER','APP'),c=await course(),m=await mapped(c),p=await prepare(m,closing),f=receipt(m,p.appAccountToken);await db.user.update({where:{id:closing.user.id},data:{status:'DELETED',deletedAt:new Date()}});
      const result=await commerce.process(f);assert.equal(result.issueCode,'REFUND_REQUIRED');assert.equal(await db.enrollment.count({where:{userId:closing.user.id}}),0);assert.equal(await db.appleAccountBinding.count({where:{userId:closing.user.id}}),1);
    });
  }finally{
    await app.close();mock.restoreAll();
    const orders=await db.tradeOrder.findMany({where:{userId:{in:users}},select:{id:true}}),orderIds=orders.map(o=>o.id),refunds=await db.refund.findMany({where:{orderId:{in:orderIds}},select:{id:true}}),refundIds=refunds.map(r=>r.id),journals=await db.financeJournal.findMany({where:{orderId:{in:orderIds}},select:{id:true}});
    await db.appleTransactionState.deleteMany({where:{appScope:scope}});await db.appleOriginalPurchase.deleteMany({where:{appScope:scope}});await db.appleAccountBinding.deleteMany({where:{userId:{in:users}}});await db.enrollment.deleteMany({where:{userId:{in:users}}});await db.financeEntry.deleteMany({where:{journalId:{in:journals.map(j=>j.id)}}});await db.financeJournal.deleteMany({where:{orderId:{in:orderIds}}});await db.refundTransaction.deleteMany({where:{refundId:{in:refundIds}}});await db.refundItem.deleteMany({where:{refundId:{in:refundIds}}});await db.refund.deleteMany({where:{id:{in:refundIds}}});await db.paymentTransaction.deleteMany({where:{orderId:{in:orderIds}}});await db.paymentAttempt.deleteMany({where:{orderId:{in:orderIds}}});await db.notification.deleteMany({where:{userId:{in:users}}});await db.tradeOrderItem.deleteMany({where:{orderId:{in:orderIds}}});await db.tradeOrder.deleteMany({where:{id:{in:orderIds}}});await db.providerCallback.deleteMany({where:{externalEventId:{in:eventIds}}});await clearCourses(db,courses);await db.course.deleteMany({where:{id:{in:courses}}});await db.teacher.deleteMany({where:{id:{in:teachers}}});await db.mediaAsset.deleteMany({where:{id:{in:assets}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
    for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];
  }
});
