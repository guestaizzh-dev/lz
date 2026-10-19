import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {Notifications,pushConfiguration} from '../dist/notifications.js';
import {messageTarget} from '../dist/message-target.js';
import {decryptPrivate} from '../dist/private-data.js';

test('unified notifications, consent, sessions and durable provider delivery',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService),service=app.get(Notifications),originalFetch=global.fetch;
  async function actor(){const user=await db.user.create({data:{nickname:'消息测试',roles:['USER']}}),c=auth.credentials(),session=await db.authSession.create({data:{userId:user.id,kind:'APP',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:randomUUID()}});return{user,session,headers:{Authorization:'Bearer '+c.access,'Content-Type':'application/json'}};}
  const call=async(who,path,method='GET',body)=>{const r=await originalFetch(base+path,{method,headers:who.headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};};
  const prefs=(version,changes={})=>({expectedVersion:version,pushEnabled:true,transactions:true,learning:true,community:true,...changes}),cid='client_'+randomUUID().replaceAll('-','');
  let a,b,notice,sent=[];
  try{
    a=await actor();b=await actor();
    await t.test('defaults are private, preference edits have optimistic concurrency, system denial keeps inbox',async()=>{
      assert.equal((await call(a,'/me/notification-preferences')).body.pushEnabled,false);
      assert.equal((await call(a,'/me/notification-preferences','PATCH',prefs(0))).status,200);
      assert.equal((await call(a,'/me/notification-preferences','PATCH',prefs(0))).status,409);
      const bound=await call(a,'/me/push-device','POST',{clientId:cid,platform:'ANDROID',permissionGranted:false});assert.equal(bound.status,201,JSON.stringify(bound.body));assert.equal(bound.body.registered,false);
      assert.equal((await call(a,'/me/push-device','POST',{clientId:cid,platform:'ANDROID',permissionGranted:true})).body.registered,true);
      const row=await db.deviceToken.findFirstOrThrow({where:{sessionId:a.session.id}});assert.equal(decryptPrivate(row.tokenCipher),cid);assert.ok(!JSON.stringify(row).includes(cid));
    });
    await t.test('all actual message kinds have safe destinations, product orders work, foreign/expired messages stay private',async()=>{
      for(const kind of ['PRODUCT_ORDER','COURSE_ORDER','MEMBERSHIP_ORDER','COHORT_ORDER','BOOKING','BOOKING_STAFF','COHORT','LIVE','FORUM_REVIEW','FEEDBACK_REPLY','TEACHER_ANSWER','COURSE_VERSION','COURSE_REVIEW','PRACTICE_REVIEW','ASSIGNMENT_REVIEW'])assert.ok(messageTarget({kind,resourceId:randomUUID(),orderId:randomUUID(),cohortId:randomUUID()}),kind);
      const bookingId=randomUUID();assert.equal(messageTarget({kind:'BOOKING',appointmentId:bookingId}).path,'/pages/booking/mine?bookingId='+bookingId);assert.equal(messageTarget({kind:'LIVE',resourceId:'../evil'}),null);assert.equal(messageTarget({kind:'EVIL',resourceId:randomUUID()}),null);
      notice=await db.notification.create({data:{userId:a.user.id,eventKey:randomUUID(),kind:'PRODUCT_ORDER',title:'商品已发货',body:'私人订单详情'}});
      assert.equal(await db.outboxJob.count({where:{eventKey:'notification.push:'+notice.id}}),1);
      const owned=(await call(a,'/me/messages/'+notice.id)).body;assert.equal(owned.target.path,'/pages/shop/orders');assert.equal((await call(b,'/me/messages/'+notice.id)).status,404);
      const expired=await db.notification.create({data:{userId:a.user.id,eventKey:randomUUID(),kind:'LIVE',title:'过期',body:'过期',expiresAt:new Date(Date.now()-1000)}});assert.equal((await call(a,'/me/messages/'+expired.id)).status,404);
    });
    await t.test('missing gateway is a durable retry, never a fake successful push',async()=>{
      delete process.env.PUSH_ENABLED;await service.runJobs(2000);
      const job=await db.outboxJob.findUniqueOrThrow({where:{eventKey:'notification.push:'+notice.id}});assert.equal(job.state,'READY');assert.equal(job.lastErrorCode,'PUSH_NOT_CONFIGURED');
      assert.equal(await db.notificationDelivery.count({where:{notificationId:notice.id,state:'ACCEPTED'}}),0);
    });
    await t.test('provider acceptance is idempotent and generic; signatures and deterministic request IDs are stable',async()=>{
      process.env.PUSH_ENABLED='true';process.env.PUSH_GATEWAY_URL='https://push.test.example/gateway';process.env.PUSH_GATEWAY_SECRET='test-secret-'+randomUUID();
      global.fetch=async(url,options)=>{if(String(url)!==process.env.PUSH_GATEWAY_URL)return originalFetch(url,options);const data=JSON.parse(options.body);assert.equal(options.headers['X-Academy-Signature'],createHmac('sha256',process.env.PUSH_GATEWAY_SECRET).update(options.headers['X-Academy-Timestamp']+'.'+options.body).digest('hex'));assert.ok(!options.body.includes('私人订单详情'));sent.push(data);return Response.json({state:'ACCEPTED',messageId:'provider-task-1'});};
      await db.outboxJob.update({where:{eventKey:'notification.push:'+notice.id},data:{availableAt:new Date()}});await Promise.all([service.runJobs(2000),service.runJobs(2000)]);assert.equal(sent.length,1);
      await db.outboxJob.update({where:{eventKey:'notification.push:'+notice.id},data:{state:'READY',availableAt:new Date()}});await service.runJobs(2000);assert.equal(sent.length,1);assert.equal((await db.notificationDelivery.findFirstOrThrow({where:{notificationId:notice.id}})).state,'ACCEPTED');
    });
    await t.test('device transfer, logout, category opt-out and read-all prevent further dispatch',async()=>{
      await call(b,'/me/notification-preferences','PATCH',prefs(0));await call(b,'/me/push-device','POST',{clientId:cid,platform:'ANDROID',permissionGranted:true});
      const old=await db.notification.create({data:{userId:a.user.id,eventKey:randomUUID(),kind:'PRODUCT_ORDER',title:'旧账号',body:'不可发给新账号'}});await service.runJobs(2000);assert.equal(sent.length,1);
      assert.equal(await db.notificationDelivery.count({where:{notificationId:old.id}}),0);
      await call(b,'/me/notification-preferences','PATCH',prefs(1,{learning:false}));await db.notification.create({data:{userId:b.user.id,eventKey:randomUUID(),kind:'LIVE',title:'直播',body:'不提醒'}});await service.runJobs(2000);assert.equal(sent.length,1);
      const read=await db.notification.create({data:{userId:b.user.id,eventKey:randomUUID(),kind:'PRODUCT_ORDER',title:'已读',body:'不提醒'}});assert.equal((await call(b,'/me/messages/read-all','POST')).status,201);await service.runJobs(2000);assert.equal(sent.length,1);assert.ok((await db.notification.findUniqueOrThrow({where:{id:read.id}})).readAt);assert.equal((await call(a,'/me/messages/'+old.id)).body.readAt,null);
      await call(b,'/auth/logout','POST');assert.equal((await db.deviceToken.findFirstOrThrow({where:{sessionId:b.session.id}})).enabled,false);
    });
    await t.test('ambiguous transport result is recorded for reconciliation, never blindly resent',async()=>{
      const c=await actor();await call(c,'/me/notification-preferences','PATCH',prefs(0));await call(c,'/me/push-device','POST',{clientId:'client_'+randomUUID().replaceAll('-',''),platform:'IOS',permissionGranted:true});const n=await db.notification.create({data:{userId:c.user.id,eventKey:randomUUID(),kind:'COURSE_ORDER',title:'订单',body:'正文'}});
      let attempts=0;global.fetch=async(url,options)=>{if(String(url)===process.env.PUSH_GATEWAY_URL){attempts++;throw Error('Response lost after send');}return originalFetch(url,options);};await service.runJobs(2000);assert.equal(attempts,1);assert.equal((await db.outboxJob.findUniqueOrThrow({where:{eventKey:'notification.push:'+n.id}})).state,'DEAD');assert.equal((await db.notificationDelivery.findFirstOrThrow({where:{notificationId:n.id}})).state,'UNKNOWN');await service.runJobs(2000);assert.equal(attempts,1);
    });
  }finally{global.fetch=originalFetch;for(const key of ['PUSH_ENABLED','PUSH_GATEWAY_URL','PUSH_GATEWAY_SECRET'])delete process.env[key];await app.close();await db.$disconnect();}
});

test('push gateway rejects tampering and deduplicates accepted or uncertain requests',async()=>{
  assert.throws(()=>pushConfiguration({PUSH_ENABLED:'true',PUSH_GATEWAY_URL:'http://bad'}));
  const require=createRequire(import.meta.url),gateway=require('../../../infra/unicloud/academy-push/index.js'),records=new Map();
  process.env.ACADEMY_PUSH_SECRET='test-gateway-secret-'+randomUUID();process.env.ACADEMY_PUSH_APP_ID='test-app';let sends=0,fail=false;
  global.uniCloud={database:()=>({collection:()=>({add:async row=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,{...row});},doc:id=>({get:async()=>({data:records.has(id)?[records.get(id)]:[]}),update:async value=>{Object.assign(records.get(id),value);}})})}),getPushManager:()=>({sendMessage:async data=>{sends++;assert.equal(data.content,'你有一条新的书院消息，请登录查看。');assert.deepEqual(Object.keys(data.payload),['notificationId']);if(fail)throw Error('uncertain');return{errCode:0,data:{$taskid:'provider-1'}};}})};
  const event=()=>{const body=JSON.stringify({requestId:randomUUID().replaceAll('-',''),clientId:'valid_client_id_123',notificationId:randomUUID()}),timestamp=String(Date.now());return{httpMethod:'POST',body,headers:{'X-Academy-Timestamp':timestamp,'X-Academy-Signature':createHmac('sha256',process.env.ACADEMY_PUSH_SECRET).update(timestamp+'.'+body).digest('hex')}};};
  try{const e=event();assert.equal((await gateway.main({...e,body:e.body+' '})).statusCode,401);assert.equal((await gateway.main(e)).statusCode,200);assert.equal((await gateway.main(e)).statusCode,200);assert.equal(sends,1);fail=true;const uncertain=event();assert.equal((await gateway.main(uncertain)).statusCode,409);assert.equal((await gateway.main(uncertain)).statusCode,409);assert.equal(sends,2);}finally{delete global.uniCloud;delete process.env.ACADEMY_PUSH_SECRET;delete process.env.ACADEMY_PUSH_APP_ID;}
});
