import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,verify,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {offlineSigningConfig} from '../dist/offline-licenses.js';

const pair=generateKeyPairSync('rsa',{modulusLength:2048}),key=pair.privateKey.export({type:'pkcs8',format:'pem'});
const config={OFFLINE_LICENSE_ENABLED:'true',OFFLINE_LICENSE_KEY_ID:'qa-offline-1',OFFLINE_LICENSE_PRIVATE_KEY:key};
test('offline license signing requires an explicit switch and server-only RSA key',()=>{
  assert.equal(offlineSigningConfig({}),null);
  assert.equal(offlineSigningConfig(config).kid,'qa-offline-1');
  for(const change of [{OFFLINE_LICENSE_ENABLED:'yes'},{OFFLINE_LICENSE_KEY_ID:''},{OFFLINE_LICENSE_PRIVATE_KEY:''},{OFFLINE_LICENSE_PRIVATE_KEY:generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'})}])assert.throws(()=>offlineSigningConfig({...config,...change}));
});

test('offline license HTTP: fixed permissions, signed integrity, bounded expiry and ownership',async t=>{
  Object.assign(process.env,config);
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=await app.getUrl()+'/api/v1',auth=app.get(AuthService),deviceId=randomUUID();
  async function actor(){const user=await db.user.create({data:{nickname:'离线许可隔离检查',roles:['USER']}}),c=auth.credentials(),s=await db.authSession.create({data:{userId:user.id,kind:'APP',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:randomUUID()}});return{id:user.id,access:c.access,session:s.id};}
  async function call(path,who,method='GET',data){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.access}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:res.status,body:await res.json(),headers:res.headers};}
  const dto=extra=>({deviceId,consentToStart:true,...extra}),claims=token=>{const [header,body,signature]=token.split('.');assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'RS256');assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+body),pair.publicKey,Buffer.from(signature,'base64url')));return JSON.parse(Buffer.from(body,'base64url'));};
  let course,release,lesson,paidLesson,asset,enrollment,issued,a,b;
  const issue=(who=a,data=dto())=>call('/learning/lessons/'+lesson.id+'/offline-license',who,'POST',data);
  try{
    a=await actor();b=await actor();
    const teacher=await db.teacher.create({data:{name:'离线校验老师',title:'经典研习',bio:'隔离测试',status:'PUBLISHED'}});
    course=await db.course.create({data:{teacherId:teacher.id,title:'道德经离线研习',subtitle:'许可校验',description:'隔离测试',category:'经典',cover:'',price:100,tags:[],status:'PUBLISHED',membershipTier:1}});
    asset=await db.mediaAsset.create({data:{storageKey:randomUUID(),name:'上善若水.mp4',mime:'video/mp4',bytes:256000000,uploaderId:a.id,status:'READY',visibility:'PRIVATE',sha256:'ab'.repeat(32),variants:{delivery:'MP4_FASTSTART'}}});
    const chapter={sourceId:randomUUID(),title:'上善若水',position:1,format:'VIDEO',body:'本讲正文',mediaId:asset.id,durationSeconds:60,trial:true,required:true};
    release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,lessons:{create:[chapter,{...chapter,sourceId:randomUUID(),position:2,title:'道法自然',trial:false}]}},include:{lessons:{orderBy:{position:'asc'}}}});[lesson,paidLesson]=release.lessons;await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
    await t.test('service stays disabled without configuration; trial and unconfirmed downloads cannot acquire licenses',async()=>{
      assert.equal((await call('/learning/offline/capabilities')).status,401);
      process.env.OFFLINE_LICENSE_ENABLED='false';assert.equal((await issue()).status,503);process.env.OFFLINE_LICENSE_ENABLED='true';
      const caps=await call('/learning/offline/capabilities',a);assert.equal(caps.body.licenseServiceReady,true);assert.equal(caps.body.nativeDownloadReady,false);assert.equal(caps.body.maxOfflineHours,72);assert.equal(caps.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(caps.body).includes('PRIVATE KEY'));
      assert.equal((await issue()).status,403);assert.equal((await issue(a,{deviceId})).status,400);assert.equal((await issue(a,dto({userId:b.id}))).status,400);
      enrollment=await db.enrollment.create({data:{userId:a.id,courseId:course.id,releaseId:release.id,source:'ADMIN_GRANT'}});
    });
    await t.test('signed snapshot binds account, hashed device, release and file checksum with a 72-hour maximum',async()=>{
      issued=await issue();assert.equal(issued.status,201,JSON.stringify(issued.body));const c=claims(issued.body.token);
      assert.equal(c.userId,a.id);assert.notEqual(c.deviceHash,deviceId);assert.equal(c.lessonId,lesson.id);assert.equal(c.releaseId,release.id);assert.equal(c.sha256,asset.sha256);assert.equal(c.bytes,asset.bytes);assert.equal(c.purpose,'academy-offline-lesson');assert.equal(Date.parse(c.expiresAt)-Date.parse(c.issuedAt),72*3600000);
      const row=await db.offlineLicense.findUniqueOrThrow({where:{id:c.id}});assert.equal(row.licenseHash,createHash('sha256').update(issued.body.token).digest('hex'));assert.ok(!JSON.stringify(row).includes(deviceId));assert.ok(!JSON.stringify(issued.body).includes(asset.storageKey));
      const [header,body,signature]=issued.body.token.split('.'),altered=Buffer.from(JSON.stringify({...c,expiresAt:'2099-01-01T00:00:00Z'})).toString('base64url');assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+altered),pair.publicKey,Buffer.from(signature,'base64url')),false);
      assert.equal((await call('/learning/offline/licenses',b)).body.items.length,0);
    });
    await t.test('download chunks recheck ownership, active license hash, current entitlement and file boundaries',async()=>{
      const bytes=Buffer.alloc(4*1024*1024+17,0x52),checksum=createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(process.env.MEDIA_DIR,asset.storageKey),bytes);await db.mediaAsset.update({where:{id:asset.id},data:{bytes:bytes.length,sha256:checksum}});Object.assign(asset,{bytes:bytes.length,sha256:checksum});
      const previous=issued.body.token;issued=await issue();assert.equal(issued.status,201);
      async function chunk(who,index,token=issued.body.token,device=deviceId){const res=await fetch(base+'/learning/offline/licenses/'+issued.body.id+'/chunks/'+index+'?deviceId='+device,{headers:{Authorization:'Bearer '+who.access,'X-Offline-License':token}});return{status:res.status,headers:res.headers,bytes:Buffer.from(await res.arrayBuffer())};}
      assert.equal((await chunk(a,0,previous)).status,403);assert.equal((await chunk(b,0)).status,403);assert.equal((await chunk(a,0,issued.body.token,randomUUID())).status,403);
      const first=await chunk(a,0),last=await chunk(a,1);assert.equal(first.status,200);assert.equal(first.bytes.length,4*1024*1024);assert.equal(last.bytes.length,17);assert.deepEqual(Buffer.concat([first.bytes,last.bytes]),bytes);assert.equal(first.headers.get('x-chunk-sha256'),createHash('sha256').update(first.bytes).digest('hex'));assert.match(first.headers.get('cache-control'),/no-store/);
      assert.equal((await chunk(a,2)).status,404);assert.equal((await chunk(a,-1)).status,400);
      await db.enrollment.update({where:{id:enrollment.id},data:{revokedAt:new Date()}});assert.equal((await chunk(a,0)).status,403);await db.enrollment.update({where:{id:enrollment.id},data:{revokedAt:null}});
      await writeFile(join(process.env.MEDIA_DIR,asset.storageKey),bytes.subarray(0,-1));assert.equal((await chunk(a,0)).status,404);await writeFile(join(process.env.MEDIA_DIR,asset.storageKey),bytes);
    });
    await t.test('concurrent repeat acquisition retains one row and renewals cannot change account or device',async()=>{
      const results=await Promise.all([issue(),issue()]);for(const r of results)assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(results[0].body.id,issued.body.id);assert.equal(results[1].body.id,issued.body.id);assert.equal(await db.offlineLicense.count({where:{userId:a.id}}),1);
      const path='/learning/offline/licenses/'+issued.body.id+'/refresh';assert.equal((await call(path,b,'POST',dto())).status,404);assert.equal((await call(path,a,'POST',dto({deviceId:randomUUID()}))).status,404);
      const end=new Date(Date.now()+3600000);await db.enrollment.update({where:{id:enrollment.id},data:{expiresAt:end}});const renewed=await call(path,a,'POST',dto());assert.equal(renewed.status,201);assert.equal(claims(renewed.body.token).expiresAt,end.toISOString());
      await db.enrollment.update({where:{id:enrollment.id},data:{expiresAt:null}});
    });
    await t.test('revocation is idempotent, refresh is refused and the offline window is described honestly',async()=>{
      const path='/learning/offline/licenses/'+issued.body.id;assert.equal((await call(path,b,'DELETE')).status,404);
      const first=await call(path,a,'DELETE');assert.equal(first.status,200);assert.match(first.body.offlineWindowNotice,/原有效期/);assert.equal((await call(path,a,'DELETE')).status,200);assert.equal((await call(path+'/refresh',a,'POST',dto())).status,404);
      assert.equal(await db.auditLog.count({where:{actorId:a.id,action:'offline.license.revoke',resourceId:issued.body.id}}),1);issued=await issue();assert.equal(issued.status,201);assert.notEqual(issued.body.id,path.split('/').at(-1));
    });
    await t.test('three-device quota is serialized; an expired lease frees its device slot',async()=>{
      const r=await Promise.all([issue(a,dto({deviceId:randomUUID()})),issue(a,dto({deviceId:randomUUID()})),issue(a,dto({deviceId:randomUUID()}))]);assert.deepEqual(r.map(x=>x.status).sort(),[201,201,400]);
      const row=await db.offlineLicense.findFirstOrThrow({where:{userId:a.id,revokedAt:null,id:{not:issued.body.id}}});await db.offlineLicense.update({where:{id:row.id},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await issue(a,dto({deviceId:randomUUID()}))).status,201);
    });
    await t.test('refreshing an expired license cannot exceed the active-file limit',async()=>{
      const c=await actor();await db.enrollment.create({data:{userId:c.id,courseId:course.id,releaseId:release.id,source:'ADMIN_GRANT'}});
      const initial=await issue(c),original=await db.offlineLicense.findUniqueOrThrow({where:{id:initial.body.id}});await db.offlineLicense.update({where:{id:original.id},data:{expiresAt:new Date(Date.now()-1000)}});
      await db.offlineLicense.createMany({data:Array.from({length:500},()=>({userId:c.id,deviceId:original.deviceId,lessonId:lesson.id,assetId:asset.id,expiresAt:new Date(Date.now()+3600000),licenseHash:randomUUID(),entitlementSnapshot:{}}))});
      assert.equal((await call('/learning/offline/licenses/'+original.id+'/refresh',c,'POST',dto())).status,400);
      const one=await db.offlineLicense.findFirstOrThrow({where:{userId:c.id,id:{not:original.id}}});await call('/learning/offline/licenses/'+one.id,c,'DELETE');assert.equal((await call('/learning/offline/licenses/'+original.id+'/refresh',c,'POST',dto())).status,201);
      assert.equal(await db.offlineLicense.count({where:{userId:c.id,revokedAt:null,expiresAt:{gt:new Date()}}}),500);
    });
    await t.test('withdrawn versions, revoked grants, frozen accounts and unvalidated media cannot refresh',async()=>{
      const path='/learning/offline/licenses/'+issued.body.id+'/refresh';
      await db.enrollment.update({where:{id:enrollment.id},data:{revokedAt:new Date()}});assert.equal((await call(path,a,'POST',dto())).status,403);await db.enrollment.update({where:{id:enrollment.id},data:{revokedAt:null}});
      await db.courseRelease.update({where:{id:release.id},data:{withdrawnAt:new Date(),withdrawalReason:'隔离停止交付'}});assert.equal((await call(path,a,'POST',dto())).status,403);await db.courseRelease.update({where:{id:release.id},data:{withdrawnAt:null,withdrawalReason:null}});
      await db.user.update({where:{id:a.id},data:{status:'FROZEN'}});assert.equal((await call(path,a,'POST',dto())).status,401);await db.user.update({where:{id:a.id},data:{status:'ACTIVE'}});
      for(const changes of [{status:'PROCESSING'},{variants:{delivery:'MP4_FASTSTART',uploadPurpose:'FORUM_MEDIA'}},{sha256:''}]){await db.mediaAsset.update({where:{id:asset.id},data:changes});assert.equal((await call(path,a,'POST',dto())).status,400);await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY',sha256:asset.sha256,variants:asset.variants}});}
    });
    await t.test('membership expiration is a hard cap even when the default lease is longer',async()=>{
      const plan=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:1,days:30}}}),end=new Date(Date.now()+2*3600000),member=await db.membership.create({data:{userId:b.id,planId:plan.id,tier:1,source:'ADMIN_COMPENSATION',startsAt:new Date(Date.now()-1000),endsAt:end}});
      const result=await issue(b);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(claims(result.body.token).expiresAt,end.toISOString());await db.membership.update({where:{id:member.id},data:{revokedAt:new Date()}});assert.equal((await call('/learning/offline/licenses/'+result.body.id+'/refresh',b,'POST',dto())).status,403);
    });
    await t.test('cohort licenses cannot bypass chapter opening, accepted schedule, membership of the cohort or its end',async()=>{
      const c=await actor(),startsAt=new Date(Date.now()-3600000),endsAt=new Date(Date.now()+2*86400000),cohort=await db.courseCohort.create({data:{courseId:course.id,releaseId:release.id,title:'离线许可共学营',startsAt,endsAt,enrollDeadline:startsAt,capacity:10,state:'DRAFT'}});
      await db.cohortLessonSchedule.update({where:{cohortId_lessonId:{cohortId:cohort.id,lessonId:paidLesson.id}},data:{opensOnDay:2}});await db.courseCohort.update({where:{id:cohort.id},data:{state:'OPEN'}});
      const reg=await db.cohortRegistration.create({data:{userId:c.id,cohortId:cohort.id,courseId:course.id,releaseId:release.id}}),data=dto({cohortId:cohort.id});
      const result=await issue(c,data);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(claims(result.body.token).cohortId,cohort.id);assert.equal(claims(result.body.token).expiresAt,endsAt.toISOString());
      assert.equal((await call('/learning/lessons/'+paidLesson.id+'/offline-license',c,'POST',data)).status,403);assert.equal((await issue(b,data)).status,403);
      await db.courseCohort.update({where:{id:cohort.id},data:{scheduleVersion:2}});assert.equal((await issue(c,data)).status,403);
      await db.cohortRegistration.update({where:{id:reg.id},data:{acceptedScheduleVersion:2,revokedAt:new Date()}});assert.equal((await issue(c,data)).status,403);
    });
    await t.test('offline authorization starts paid delivery in its transaction and pending or failed refunds block refresh',async()=>{
      const c=await actor(),now=new Date(),offer=await db.saleOffer.create({data:{kind:'COURSE',courseReleaseId:release.id,price:100n,active:true,policySnapshot:{}}});
      const order=await db.tradeOrder.create({data:{userId:c.id,orderNo:'QA-OFFLINE-'+randomUUID(),kind:'COURSE',state:'PAID',requestKey:randomUUID(),requestHash:'qa',currency:'CNY',subtotal:100n,payableTotal:100n,paidTotal:100n,pricingSnapshot:{},quoteHash:'qa',expiresAt:new Date(Date.now()+60000),paidAt:now}});
      const item=await db.tradeOrderItem.create({data:{orderId:order.id,lineNo:1,offerId:offer.id,quantity:1,unitPrice:100n,subtotal:100n,payable:100n,itemSnapshot:{},benefitSnapshot:{},state:'DELIVERED',courseReleaseId:release.id}});
      const payment=await db.paymentTransaction.create({data:{orderId:order.id,channel:'WECHAT_APP',appScope:'qa',externalTransactionId:randomUUID(),amount:100n,currency:'CNY',verifiedAt:now,paidAt:now,disposition:'ACCEPTED',receiptHash:'qa'}});
      const grant=await db.enrollment.create({data:{userId:c.id,courseId:course.id,releaseId:release.id,source:'PURCHASE',orderItemId:item.id}}),path='/learning/lessons/'+paidLesson.id+'/offline-license';
      assert.equal((await call(path,c,'POST',dto({consentToStart:false}))).status,400);assert.equal((await db.enrollment.findUniqueOrThrow({where:{id:grant.id}})).startedAt,null);
      const result=await call(path,c,'POST',dto());assert.equal(result.status,201,JSON.stringify(result.body));assert.ok((await db.enrollment.findUniqueOrThrow({where:{id:grant.id}})).startedAt);const started=(await db.tradeOrderItem.findUniqueOrThrow({where:{id:item.id}})).benefitSnapshot.startedAt;assert.ok(started);
      const refund=await db.refund.create({data:{userId:c.id,orderId:order.id,requestKey:randomUUID(),kind:'REFUND_ONLY',state:'APPROVED',requestedAmount:100n,approvedAmount:100n,reasonCode:'QA',description:'隔离退款',paymentTransactionId:payment.id}});
      const refresh='/learning/offline/licenses/'+result.body.id+'/refresh';for(const state of ['APPROVED','REFUNDING','FAILED']){await db.refund.update({where:{id:refund.id},data:{state}});assert.equal((await call(refresh,c,'POST',dto())).status,403);assert.equal((await issue(c)).status,403);}
      await db.refund.update({where:{id:refund.id},data:{state:'REJECTED'}});assert.equal((await call(refresh,c,'POST',dto())).status,201);assert.equal((await db.tradeOrderItem.findUniqueOrThrow({where:{id:item.id}})).benefitSnapshot.startedAt,started);
    });
    await t.test('closing an account deletes its license rows and invalidates the active session',async()=>{
      assert.ok(await db.offlineLicense.count({where:{userId:b.id}}));const result=await call('/me/close-account',b,'POST',{confirmation:'确认注销'});assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(await db.offlineLicense.count({where:{userId:b.id}}),0);assert.equal((await call('/learning/offline/licenses',b)).status,401);
    });
  }finally{await app.close();await db.$disconnect();for(const key of Object.keys(config))delete process.env[key];}
});
