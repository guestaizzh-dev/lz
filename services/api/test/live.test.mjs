import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDecipheriv,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService,passwordHash} from '../dist/auth.js';
import {LiveService} from '../dist/live.js';
import {ZegoService,zegoToken04,zegoCallbackSignature,rtcRoomId,rtcStreamId} from '../dist/zego.js';
import {WebSocket} from 'ws';

const secret='12345678901234567890123456789012',callbackSecret='test-callback-secret';
function decode(token){
  const packet=Buffer.from(token.slice(2),'base64'),ivLength=packet.readUInt16BE(8),iv=packet.subarray(10,10+ivLength),length=packet.readUInt16BE(10+ivLength),encrypted=packet.subarray(12+ivLength,12+ivLength+length);
  assert.equal(packet.at(-1),1);
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(secret),iv);decipher.setAuthTag(encrypted.subarray(-16));
  const data=JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]).toString());
  assert.equal(Number(packet.readBigInt64BE()),data.expire);return data;
}
test('ZEGO Token04 uses official GCM packet and callback signature example',()=>{
  const body=decode(zegoToken04(123,'viewer',secret,120,'{"room_id":"private"}',1700000000));
  assert.equal(body.app_id,123);assert.equal(body.user_id,'viewer');assert.equal(body.expire,1700000120);assert.equal(body.payload,'{"room_id":"private"}');
  assert.equal(zegoCallbackSignature('secret','1470820198','123412'),'5bd59fd62953a8059fb7eaba95720f66d19e4517');
  assert.throws(()=>zegoToken04(123,'viewer','short',120,''));assert.throws(()=>zegoToken04(123,'viewer',secret,0,''));
});
test('simultaneous provider lookups use strictly increasing sequences in the single API process',async()=>{
  const env={...process.env},originalFetch=globalThis.fetch,originalNow=Date.now,sequences=[];
  Object.assign(process.env,{ZEGO_RTC_ENABLED:'true',ZEGO_APP_ID:'123',ZEGO_SERVER_SECRET:secret,ZEGO_RTC_SERVER:'wss://test.zego.im/ws'});
  Date.now=()=>1700000000000;
  globalThis.fetch=async url=>{sequences.push(Number(new URL(url).searchParams.get('Sequence')));return new Response('{"Code":41004}',{status:200});};
  try{const zego=new ZegoService();await Promise.all([1,2,3].map(()=>zego.request('DescribeRTCStreamState',{StreamId:'same-stream'})));assert.deepEqual(sequences,[1700000000000,1700000000001,1700000000002]);}
  finally{globalThis.fetch=originalFetch;Date.now=originalNow;for(const name of Object.keys(process.env))if(!(name in env))delete process.env[name];Object.assign(process.env,env);}
});
test('live RTC: real HTTP/state/permissions/reservations/callback/replay with an isolated provider adapter',async t=>{
  const original={...process.env};Object.assign(process.env,{ZEGO_APP_ID:'123',ZEGO_SERVER_SECRET:secret,ZEGO_CALLBACK_SECRET:callbackSecret,ZEGO_RTC_SERVER:'wss://test-api.zego.im/ws',ZEGO_RTC_ENABLED:'true',ZEGO_ROOM_TOKEN_AUTH_ENABLED:'true',ZEGO_ALLOW_UNVERIFIED_TOKEN_AUTH:'false',CORS_ORIGINS:'http://127.0.0.1:5173'});
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');
  const base=await app.getUrl(),origin='http://127.0.0.1:5173',password=randomUUID()+'Aa!',prefix='live-'+randomUUID();
  const live=app.get(LiveService),zego=app.get(ZegoService),auth=app.get(AuthService),kicks=[];
  zego.kick=async(sessionId,userId)=>{kicks.push({sessionId,userId});return {Code:0};};
  zego.request=async()=>({Code:0,RequestId:'isolated-provider'});
  async function call(path,actor,method='GET',data){const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(actor?.accessToken?{Authorization:'Bearer '+actor.accessToken}:actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrfToken}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});let body;const text=await r.text();try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body,cookies:r.headers.getSetCookie()};}
  async function admin(role){const user=await db.user.create({data:{username:prefix+role,nickname:role,roles:[role],passwordHash:await passwordHash(password)}});const r=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(r.status,200);return {id:user.id,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function student(){const user=await db.user.create({data:{nickname:prefix,roles:['USER']}}),c=auth.credentials(),s=await db.authSession.create({data:{userId:user.id,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:'test',kind:'APP'}});return {id:user.id,sessionId:s.id,accessToken:c.access};}
  async function post(path,data,actor=root){const r=await call(path,actor,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  let originalMembershipPlan;
  let root,operator,moderator,a,b,teacher,room,session,host,viewer,course,memberRoom,memberSession,memberPeriod;
  const createBody=(overrides={})=>({title:'道德经 · 上善若水',summary:'从经典原文理解不争与生活实践',teacherId:teacher.id,categoryCode:'CULTURE',accessMode:'PUBLIC',...overrides});
  async function publication(r){return post('/admin/live-discovery/'+r.id+'/publication',{title:'道德经 · 上善若水',summary:'从经典原文理解不争与生活实践',state:'PUBLISHED',expectedVersion:1,reason:'隔离测试展示审核'});}
  async function schedule(r){return post('/admin/live/rooms/'+r.id+'/sessions',{title:'上善若水研习',hostUserId:root.id,scheduledAt:new Date(Date.now()+300000).toISOString()});}
  function event(s,h,kind='stream_create',seq='1',offset=0,extra={}){
    const timestamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID(),time=Date.now()+offset;
    return {event:kind,appid:'123',timestamp,nonce,signature:zegoCallbackSignature(callbackSecret,timestamp,nonce),room_id:rtcRoomId(s.id),stream_id:rtcStreamId(s.id),user_id:h.userId,stream_sid:'server-stream-1',stream_seq:seq,create_time_ms:String(time),close_time_ms:String(time),type:'0',...extra};
  }
  try{
    root=await admin('ADMIN');operator=await admin('OPERATOR');moderator=await admin('MODERATOR');a=await student();b=await student();
    teacher=await post('/admin/teachers',{name:prefix,title:'道学导师',bio:'经典研习讲解',expertise:['道德经'],portrait:'https://example.org/test-teacher.png'});
    teacher=await post('/admin/teachers/'+teacher.id+'/transition',{action:'submit',expectedVersion:teacher.version,reason:'测试'});
    teacher=await post('/admin/teachers/'+teacher.id+'/transition',{action:'publish',expectedVersion:teacher.version,reason:'测试'});
    await t.test('dedicated room workflow validates five categories, entitlement and host identity',async()=>{
      assert.equal((await call('/admin/live',moderator,'POST',createBody())).status,403);
      assert.equal((await call('/admin/live',root,'POST',createBody({accessMode:'COURSE'}))).status,400);
      assert.equal((await call('/admin/live',root,'POST',createBody({categoryCode:'MEMBER'}))).status,400);
      room=await post('/admin/live',createBody());assert.equal((await call('/live/rooms/'+room.id)).status,404);await publication(room);
      assert.equal((await call('/admin/live/rooms/'+room.id+'/sessions',root,'POST',{title:'错误主播',hostUserId:a.id,scheduledAt:new Date().toISOString()})).status,400);
      session=await schedule(room);assert.equal((await call('/live/rooms/'+room.id,a)).body.sessions[0].state,'SCHEDULED');
      assert.equal((await call('/admin/data/live_session',root,'POST',{data:{},reason:'绕过'})).status,403);
    });
    await t.test('concurrent reservations and reminders are idempotent, and can be cancelled',async()=>{
      const results=await Promise.all([1,2].map(()=>call('/live/sessions/'+session.id+'/reservation',a,'POST',{action:'RESERVE'})));assert.ok(results.every(r=>r.status===201));
      assert.equal(await db.liveReservation.count({where:{sessionId:session.id,userId:a.id}}),1);
      await live.runJobs();await live.runJobs();assert.equal(await db.notification.count({where:{userId:a.id,eventKey:{startsWith:'live:'+session.id+':reminder:'}}}),1);
      assert.equal((await call('/live/rooms/'+room.id,a)).body.sessions[0].reserved,true);
      await post('/live/sessions/'+session.id+'/reservation',{action:'CANCEL'},a);assert.equal((await call('/live/rooms/'+room.id,a)).body.sessions[0].reserved,false);
      await post('/live/sessions/'+session.id+'/reservation',{action:'RESERVE'},a);
    });
    await t.test('rescheduling preserves reservations and notifies a new arrangement once',async()=>{
      const old=session.scheduledAt,next=new Date(Date.now()+360000).toISOString();
      session=await post('/admin/live/sessions/'+session.id+'/reschedule',{scheduledAt:next,expectedVersion:session.version,reason:'调整研习安排'});
      assert.notEqual(session.scheduledAt,old);assert.equal(await db.liveReservation.count({where:{sessionId:session.id,cancelledAt:null}}),1);
      assert.equal((await call('/admin/live/sessions/'+session.id+'/reschedule',root,'POST',{scheduledAt:next,expectedVersion:1,reason:'重复旧版本'})).status,409);
      await live.runJobs();assert.equal(await db.notification.count({where:{userId:a.id,eventKey:{startsWith:'live:'+session.id+':reminder:'}}}),2);
    });
    await t.test('legal states, host ownership and configured capability are enforced',async()=>{
      assert.equal((await call('/admin/live/sessions/'+session.id+'/state',root,'POST',{action:'LIVE',expectedVersion:1,reason:'假开播'})).status,400);
      assert.equal((await call('/live/sessions/'+session.id+'/join',a,'POST',{})).status,409);
      session=await post('/admin/live/sessions/'+session.id+'/state',{action:'PREPARE',expectedVersion:session.version,reason:'准备教学'});
      assert.equal((await call('/admin/live/sessions/'+session.id+'/host',operator,'POST',{})).status,403);
      process.env.ZEGO_ROOM_TOKEN_AUTH_ENABLED='false';assert.equal((await call('/admin/live/sessions/'+session.id+'/host',root,'POST',{})).status,503);process.env.ZEGO_ROOM_TOKEN_AUTH_ENABLED='true';
      const h=await post('/admin/live/sessions/'+session.id+'/host',{});host=await post('/live/rtc/refresh',{key:h.key},null);assert.equal(host.role,'HOST');
      const payload=JSON.parse(decode(host.token).payload);assert.deepEqual(payload.privilege,{'1':1,'2':1});assert.deepEqual(payload.stream_id_list,[rtcStreamId(session.id)]);
      assert.equal(JSON.stringify(host).includes(secret),false);
    });
    await t.test('signed callback validates identity, unknown streams, replay window and duplicate delivery',async()=>{
      const valid=event(session,host),bad={...valid,signature:'0'.repeat(40)};
      assert.equal((await call('/live/zego/callback',null,'POST',bad)).status,401);
      assert.equal((await call('/live/zego/callback',null,'POST',{...valid,appid:'456'})).status,401);
      const old={...valid,timestamp:String(Math.floor(Date.now()/1000)-600)};old.signature=zegoCallbackSignature(callbackSecret,old.timestamp,old.nonce);assert.equal((await call('/live/zego/callback',null,'POST',old)).status,401);
      assert.equal((await post('/live/zego/callback',event(session,{userId:'impostor'}),null)).handled,false);
      const results=await Promise.all([call('/live/zego/callback',null,'POST',valid),call('/live/zego/callback',null,'POST',valid)]);assert.ok(results.every(r=>r.status===201));assert.equal(results.filter(r=>r.body.duplicate).length,1);
      session=await db.liveSession.findUniqueOrThrow({where:{id:session.id}});assert.equal(session.state,'LIVE');assert.equal(await db.notification.count({where:{userId:a.id,eventKey:'live:'+session.id+':started'}}),1);
    });
    await t.test('room discussion quotes authoritative text, hides pending messages and enforces review/mute/report/deletion',async()=>{
      let article=await post('/admin/articles',{title:prefix+'经典',summary:'公开经典引用',category:'经典原文',author:'测试编者',source:'测试版本，不作为真实授权',cover:'/static/art/books.svg',tags:[],visibility:'PUBLIC',membershipTier:1,featured:false,blocks:[{id:'water',type:'paragraph',text:'上善若水。水善利万物而不争。'}]});
      for(const action of ['submit','publish'])article=await post('/admin/articles/'+article.id+'/transition',{action,reason:'隔离测试',expectedVersion:article.version});
      const requestKey=randomUUID(),data={requestKey,body:'请老师讲解不争与日常实践。',articleId:article.id,blockKey:'water'};
      const row=await post('/live/sessions/'+session.id+'/messages',data,a);
      assert.equal((await post('/live/sessions/'+session.id+'/messages',data,a)).id,row.id);
      assert.equal((await call('/live/sessions/'+session.id+'/messages',b)).body.items.length,0);
      assert.equal((await call('/live/sessions/'+session.id+'/messages',a)).body.items[0].reviewState,'PENDING');
      assert.equal((await call('/live/sessions/'+session.id+'/messages',a,'POST',{...data,body:'同编号篡改'})).status,409);
      assert.equal((await call('/live/sessions/'+session.id+'/messages',a,'POST',{...data,requestKey:randomUUID(),blockKey:'伪造原文'})).status,409);
      assert.ok((await call('/live/sessions/'+session.id+'/quote-articles',a)).body.items.some(r=>r.id===article.id));
      assert.equal((await call('/admin/live/sessions/'+session.id+'/messages/'+row.id+'/review',operator,'POST',{state:'APPROVED',expectedVersion:1,reason:'绕过审核'})).status,403);
      const l=await post('/live/sessions/'+session.id+'/join',{},b),socket=new WebSocket(base.replace(/^http/,'ws')+'/api/v1/live/socket',{origin});
      const frame=()=>new Promise((ok,fail)=>{const timeout=setTimeout(()=>fail(Error('Socket timed out')),5000);socket.once('message',raw=>{clearTimeout(timeout);ok(JSON.parse(raw));});});
      const ready=frame();socket.once('open',()=>socket.send(JSON.stringify({type:'auth',key:l.key})));assert.equal((await ready).type,'ready');
      const update=frame();await post('/admin/live/sessions/'+session.id+'/messages/'+row.id+'/review',{state:'APPROVED',expectedVersion:1,reason:'符合公开讨论规范'},moderator);assert.equal((await update).type,'refresh');
      assert.equal((await call('/live/sessions/'+session.id+'/messages',b)).body.items[0].quoteSnapshot,'上善若水。水善利万物而不争。');
      assert.equal((await call('/admin/live/rooms/'+room.id+'/mute',operator,'POST',{userId:a.id,days:1,reason:'越权禁言'})).status,403);
      const mute=await post('/admin/live/rooms/'+room.id+'/mute',{userId:a.id,days:1,reason:'多次干扰讨论'},moderator);
      assert.equal((await call('/live/sessions/'+session.id+'/messages',a,'POST',{requestKey:randomUUID(),body:'禁言期间发言'})).status,403);
      assert.equal((await call('/live/sessions/'+session.id+'/messages',a)).body.canPost,false);assert.equal((await call('/live/sessions/'+session.id+'/messages',b)).body.canPost,true);
      const issue=await post('/live/sessions/'+session.id+'/messages/'+row.id+'/reports',{reason:'OTHER',description:'请核查引用'},b);
      assert.equal((await post('/live/sessions/'+session.id+'/messages/'+row.id+'/reports',{reason:'OTHER',description:'重复'},b)).id,issue.id);
      assert.equal((await call('/admin/live/rooms/'+room.id+'/reports',moderator)).body.items.length,1);
      await post('/admin/live/rooms/'+room.id+'/reports/'+issue.id+'/review',{expectedVersion:1,reason:'已核查，引用准确'},moderator);
      await post('/admin/live/rooms/'+room.id+'/restrictions/'+mute.id+'/review',{expectedVersion:mute.version,reason:'已完成解释沟通'},moderator);
      assert.equal((await call('/live/sessions/'+session.id+'/messages',a)).body.canPost,true);
      await post('/admin/live/sessions/'+session.id+'/messages/'+row.id+'/review',{state:'DELETE',expectedVersion:2,reason:'移除重复讨论'},moderator);
      assert.equal((await call('/live/sessions/'+session.id+'/messages',b)).body.items.length,0);
      await new Promise(ok=>{socket.once('close',ok);socket.close();});
      const invalid=new WebSocket(base.replace(/^http/,'ws')+'/api/v1/live/socket',{origin});invalid.once('open',()=>invalid.send(JSON.stringify({type:'auth',key:'x'.repeat(43)})));
      assert.equal(await new Promise(ok=>invalid.once('close',code=>ok(code))),4401);
    });
    await t.test('viewer token permits only its room and never publishing; logout and stale leases are revoked',async()=>{
      viewer=await post('/live/sessions/'+session.id+'/join',{},a);const credentials=await post('/live/rtc/refresh',{key:viewer.key},null),payload=JSON.parse(decode(credentials.token).payload);
      assert.equal(payload.room_id,rtcRoomId(session.id));assert.deepEqual(payload.privilege,{'1':1,'2':0});assert.equal(payload.stream_id_list,null);
      await db.authSession.update({where:{id:a.sessionId},data:{revokedAt:new Date()}});
      assert.equal((await call('/live/rtc/refresh',null,'POST',{key:viewer.key})).status,401);await live.runJobs();assert.ok(kicks.some(k=>k.userId===credentials.userId));
      a=await student();
    });
    await t.test('abnormal disconnect is recoverable, stale close and different stream SID cannot end a fresh stream',async()=>{
      const base=Date.now()-1000;
      await post('/live/zego/callback',event(session,host,'stream_create','2',0,{create_time_ms:String(base),stream_sid:'server-stream-2'}),null);
      // Use times newer than the first callback, without sleeping.
      const mark=Date.now()+1000;
      await post('/live/zego/callback',event(session,host,'stream_close','3',0,{close_time_ms:String(mark),stream_sid:'server-stream-1',type:'1'}),null);
      assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:session.id}})).state,'LIVE');
      const fresh=event(session,host,'stream_create','4',0,{create_time_ms:String(mark+1000),stream_sid:'server-stream-2'});await post('/live/zego/callback',fresh,null);
      await post('/live/zego/callback',event(session,host,'stream_close','5',0,{close_time_ms:String(mark+2000),stream_sid:'server-stream-1'}),null);
      assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:session.id}})).state,'LIVE');
      await post('/live/zego/callback',event(session,host,'stream_close','6',0,{close_time_ms:String(mark+3000),stream_sid:'server-stream-2',type:'1'}),null);
      const lost=await db.liveSession.findUniqueOrThrow({where:{id:session.id}});assert.equal(lost.state,'LIVE');assert.ok(lost.disconnectedAt);
      await post('/live/zego/callback',event(session,host,'stream_create','7',0,{create_time_ms:String(mark+4000),stream_sid:'server-stream-3'}),null);
      assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:session.id}})).disconnectedAt,null);
    });
    await t.test('member access follows actual content benefits; expired or revoked membership cannot refresh',async()=>{
      memberRoom=await post('/admin/live',createBody({categoryCode:'MEMBER',accessMode:'MEMBER',membershipTier:2}));await publication(memberRoom);memberSession=await schedule(memberRoom);
      memberSession=await post('/admin/live/sessions/'+memberSession.id+'/state',{action:'PREPARE',expectedVersion:1,reason:'准备'});
      const h=await post('/admin/live/sessions/'+memberSession.id+'/host',{}),c=await post('/live/rtc/refresh',{key:h.key},null);await post('/live/zego/callback',event(memberSession,c),null);
      assert.equal((await call('/live/sessions/'+memberSession.id+'/join',a,'POST',{})).status,403);
      const existing=await db.membershipPlan.findUnique({where:{tier_days:{tier:2,days:30}}});originalMembershipPlan=existing;const plan=await post('/admin/memberships/plans',{title:prefix+'会员',tier:2,days:30,price:100,description:'测试套餐',active:true,...(existing?{expectedVersion:existing.version}:{})});
      memberPeriod=await post('/admin/memberships/grant',{userId:a.id,planId:plan.id,reason:'测试准入'});
      const l=await post('/live/sessions/'+memberSession.id+'/join',{},a);await post('/live/rtc/refresh',{key:l.key},null);
      await post('/admin/memberships/'+memberPeriod.id+'/revoke',{reason:'测试撤权'});
      assert.equal((await call('/live/rtc/refresh',null,'POST',{key:l.key})).status,403);await live.runJobs();
    });
    await t.test('course access uses delivered enrollment; independent ownership survives membership expiry',async()=>{
      course=await post('/admin/courses',{title:prefix+'课程',subtitle:'研习',description:'隔离测试',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:100,teacherId:teacher.id,membershipTier:2,accessDays:null,refundPolicy:'测试',featured:false,tags:[],chapters:[{title:'章节',format:'TEXT',body:'正文',durationSeconds:0,trial:false,required:true}]});
      course=await post('/admin/courses/'+course.id+'/transition',{action:'submit',expectedVersion:course.version,reason:'测试'});course=await post('/admin/courses/'+course.id+'/transition',{action:'publish',expectedVersion:course.version,reason:'测试'});
      const r=await post('/admin/live',createBody({accessMode:'COURSE',courseId:course.id}));await publication(r);let s=await schedule(r);s=await post('/admin/live/sessions/'+s.id+'/state',{action:'PREPARE',expectedVersion:s.version,reason:'测试'});const h=await post('/admin/live/sessions/'+s.id+'/host',{}),c=await post('/live/rtc/refresh',{key:h.key},null);await post('/live/zego/callback',event(s,c),null);
      assert.equal((await call('/live/sessions/'+s.id+'/join',a,'POST',{})).status,403);await post('/admin/courses/'+course.id+'/grant',{userId:a.id,reason:'测试独立课程准入'});
      const l=await post('/live/sessions/'+s.id+'/join',{},a);await post('/live/rtc/refresh',{key:l.key},null);
      await db.enrollment.updateMany({where:{courseId:course.id,userId:a.id},data:{revokedAt:new Date()}});assert.equal((await call('/live/rtc/refresh',null,'POST',{key:l.key})).status,403);
    });
    await t.test('room ordering retains an active session despite many future announcements',async()=>{
      const rows=Array.from({length:55},(_,i)=>({roomId:room.id,hostUserId:root.id,title:'future '+i,scheduledAt:new Date(Date.now()+(i+1)*86400000),accessRuleSnapshot:{mode:'PUBLIC'}}));
      await db.liveSession.createMany({data:rows});
      const list=(await call('/live/rooms/'+room.id,a)).body.sessions;
      assert.equal(list.length,50);assert.equal(list[0].id,session.id);assert.equal(list[1].title,'future 0');assert.equal(list[2].title,'future 1');
      await db.liveSession.deleteMany({where:{roomId:room.id,title:{startsWith:'future '}}});
    });
    await t.test('live offers require approved links, released courses and actual available physical inventory',async()=>{
      const product=await db.product.create({data:{title:prefix+'文创',subtitle:'标准款',description:'测试商品',category:'文创',type:'PHYSICAL',cover:'/static/art/ink.svg',price:333,culturalOrigin:'经典',status:'PUBLISHED',skus:{create:{title:'标准款',price:333,stock:1,reserved:1,active:true}}},include:{skus:true}});
      const event=await db.event.create({data:{title:prefix+'活动',description:'测试活动',responsibleUserId:root.id,capacity:20,location:'书院',startsAt:new Date(Date.now()+86400000),endsAt:new Date(Date.now()+90000000),cover:'/static/art/books.svg',price:0,category:'线下活动',status:'PUBLISHED'}});
      for(const [type,id] of [['COURSE',course.id],['PRODUCT',product.id],['EVENT',event.id]])await db.contentRelation.create({data:{fromId:room.id,toId:id,relationType:'LIVE_'+type,approvedBy:root.id}});
      let result=(await call('/live/sessions/'+session.id+'/offers',a)).body;assert.ok(result.items.some(i=>i.id===course.id));assert.ok(!result.items.some(i=>i.id===product.id));assert.ok(!result.items.some(i=>i.id===event.id));
      await db.productSku.update({where:{id:product.skus[0].id},data:{reserved:0}});result=(await call('/live/sessions/'+session.id+'/offers',a)).body;assert.equal(result.items.find(i=>i.id===product.id).price,333);
      await db.contentRelation.updateMany({where:{fromId:room.id,toId:course.id},data:{approvedBy:null}});result=(await call('/live/sessions/'+session.id+'/offers',a)).body;assert.ok(!result.items.some(i=>i.id===course.id));
      await db.product.update({where:{id:product.id},data:{status:'ARCHIVED'}});result=(await call('/live/sessions/'+session.id+'/offers',a)).body;assert.ok(!result.items.some(i=>i.id===product.id));
    });
    await t.test('normal provider close ends the session permanently; late creation cannot reopen it',async()=>{
      await post('/live/zego/callback',event(session,host,'stream_close','8',0,{close_time_ms:String(Date.now()+10000),stream_sid:'server-stream-3'}),null);
      session=await db.liveSession.findUniqueOrThrow({where:{id:session.id}});assert.equal(session.state,'ENDED');
      await post('/live/zego/callback',event(session,host,'stream_create','9',0,{create_time_ms:String(Date.now()+11000),stream_sid:'server-stream-4'}),null);
      assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:session.id}})).state,'ENDED');assert.equal((await call('/live/sessions/'+session.id+'/join',b,'POST',{})).status,409);
    });
    await t.test('independent replay review and signed ranged delivery reject stale tickets immediately',async()=>{
      const bytes=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex'),storageKey=randomUUID()+'.mp4';
      await writeFile(resolve(process.env.MEDIA_DIR,storageKey),bytes);
      const asset=await db.mediaAsset.create({data:{storageKey,name:'隔离回放.mp4',mime:'video/mp4',bytes:bytes.length,uploaderId:root.id,status:'READY',visibility:'PRIVATE'}});
      const submitted=await post('/admin/live/sessions/'+session.id+'/replay',{assetId:asset.id,expectedVersion:session.version,reason:'测试回放'});
      assert.equal((await call('/live/sessions/'+session.id+'/replay-ticket',a,'POST',{})).status,404);
      assert.equal((await call('/admin/live/sessions/'+session.id+'/replay/review',operator,'POST',{state:'APPROVED',expectedVersion:1,reason:'绕过'})).status,403);
      const approved=await post('/admin/live/sessions/'+session.id+'/replay/review',{state:'APPROVED',expectedVersion:submitted.version,reason:'核查通过'});
      const ticket=await post('/live/sessions/'+session.id+'/replay-ticket',{},a),response=await fetch(base+'/api/v1'+ticket.path,{headers:{Range:'bytes=0-7'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,8);
      await post('/admin/live/sessions/'+session.id+'/replay/review',{state:'REJECTED',expectedVersion:approved.version,reason:'撤下'});
      assert.equal((await fetch(base+'/api/v1'+ticket.path)).status,404);
      assert.equal((await call('/admin/live/sessions/'+session.id+'/replay/review',root,'POST',{state:'APPROVED',expectedVersion:approved.version,reason:'旧版本'})).status,409);
    });
    await t.test('cancellation records a reason and notifies once; ended rooms are not editable through generic CRUD',async()=>{
      const s=await schedule(room);await post('/live/sessions/'+s.id+'/reservation',{action:'RESERVE'},b);
      await post('/admin/live/sessions/'+s.id+'/state',{action:'CANCEL',expectedVersion:1,reason:'主讲临时停课'});
      assert.equal(await db.notification.count({where:{userId:b.id,eventKey:'live:'+s.id+':CANCELLED'}}),1);
      assert.equal((await call('/admin/live/sessions/'+s.id+'/state',root,'POST',{action:'PREPARE',expectedVersion:2,reason:'重新开播'})).status,409);
      assert.equal((await call('/admin/data/live_replay',root,'POST',{data:{},reason:'绕过'})).status,403);
    });
    await t.test('lease issuance racing with end cannot leave a usable credential',async()=>{
      let s=await schedule(room);s=await post('/admin/live/sessions/'+s.id+'/state',{action:'PREPARE',expectedVersion:s.version,reason:'准备'});
      const h=await post('/admin/live/sessions/'+s.id+'/host',{}),c=await post('/live/rtc/refresh',{key:h.key},null);await post('/live/zego/callback',event(s,c),null);s=await db.liveSession.findUniqueOrThrow({where:{id:s.id}});
      const [joined,ended]=await Promise.all([call('/live/sessions/'+s.id+'/join',b,'POST',{}),call('/admin/live/sessions/'+s.id+'/state',root,'POST',{action:'END',expectedVersion:s.version,reason:'结束研习'})]);
      assert.equal(ended.status,201);assert.ok([201,409].includes(joined.status));if(joined.status===201)assert.equal((await call('/live/rtc/refresh',null,'POST',{key:joined.body.key})).status,401);
      assert.equal(await db.liveRtcLease.count({where:{sessionId:s.id,revokedAt:null}}),0);
    });
    await t.test('provider-confirmed prolonged disconnect ends a stale session; transient lookup failure preserves it',async()=>{
      let s=await schedule(room);s=await post('/admin/live/sessions/'+s.id+'/state',{action:'PREPARE',expectedVersion:s.version,reason:'准备'});
      const h=await post('/admin/live/sessions/'+s.id+'/host',{}),c=await post('/live/rtc/refresh',{key:h.key},null);await post('/live/zego/callback',event(s,c),null);
      await db.liveSession.update({where:{id:s.id},data:{disconnectedAt:new Date(Date.now()-4*60000)}});
      zego.request=async()=>{throw Error('isolated provider outage');};await live.runJobs();assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:s.id}})).state,'LIVE');
      zego.request=async()=>({Code:41004});await live.runJobs();assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:s.id}})).state,'ENDED');assert.equal(await db.liveRtcLease.count({where:{sessionId:s.id,revokedAt:null}}),0);
      zego.request=async()=>({Code:0,RequestId:'isolated-provider'});
    });
    await t.test('worker confirms start, detects silent stream loss and recovers without duplicate reminders',async()=>{
      let s=await schedule(room);await post('/live/sessions/'+s.id+'/reservation',{action:'RESERVE'},b);
      s=await post('/admin/live/sessions/'+s.id+'/state',{action:'PREPARE',expectedVersion:s.version,reason:'准备'});await post('/admin/live/sessions/'+s.id+'/host',{});
      zego.request=async()=>({Code:0});await live.runJobs();s=await db.liveSession.findUniqueOrThrow({where:{id:s.id}});assert.equal(s.state,'LIVE');assert.equal(await db.notification.count({where:{userId:b.id,eventKey:'live:'+s.id+':started'}}),1);
      await db.liveSession.update({where:{id:s.id},data:{providerCheckedAt:new Date(Date.now()-60000)}});zego.request=async()=>({Code:41004});await live.runJobs();s=await db.liveSession.findUniqueOrThrow({where:{id:s.id}});assert.equal(s.state,'LIVE');assert.ok(s.disconnectedAt);
      await db.liveSession.update({where:{id:s.id},data:{providerCheckedAt:new Date(Date.now()-60000)}});zego.request=async()=>{throw Error('provider outage');};await live.runJobs();assert.ok((await db.liveSession.findUniqueOrThrow({where:{id:s.id}})).disconnectedAt);
      zego.request=async()=>({Code:0});await live.runJobs();s=await db.liveSession.findUniqueOrThrow({where:{id:s.id}});assert.equal(s.state,'LIVE');assert.equal(s.disconnectedAt,null);assert.equal(await db.notification.count({where:{userId:b.id,eventKey:'live:'+s.id+':started'}}),1);
      assert.equal(await db.auditLog.count({where:{resourceId:s.id,action:'live.session.recover-stream'}}),1);
      await db.liveSession.update({where:{id:s.id},data:{providerCheckedAt:new Date(Date.now()-60000)}});zego.request=async()=>({Code:41006});await live.runJobs();s=await db.liveSession.findUniqueOrThrow({where:{id:s.id}});assert.ok(s.disconnectedAt);
      await db.liveSession.update({where:{id:s.id},data:{disconnectedAt:new Date(Date.now()-4*60000)}});await live.runJobs();assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:s.id}})).state,'ENDED');assert.equal(await db.liveRtcLease.count({where:{sessionId:s.id,revokedAt:null}}),0);
      zego.request=async()=>({Code:0,RequestId:'isolated-provider'});
    });
    await t.test('player assets are real, credential-free and iframe header permits configured App origin',async()=>{
      const html=await fetch(base+'/api/v1/live/player');assert.equal(html.status,200);assert.equal(html.headers.get('x-frame-options'),null);assert.match(html.headers.get('content-security-policy'),/frame-ancestors/);assert.match(html.headers.get('content-security-policy'),/wss:\/\/\*\.coolgcloud\.com/);assert.match(html.headers.get('content-security-policy'),/wasm-unsafe-eval/);assert.equal((await html.text()).includes(secret),false);
      assert.equal((await fetch(base+'/api/v1/live/player/sdk.js')).status,200);
    });
  }finally{if(originalMembershipPlan){const p=originalMembershipPlan;await db.membershipPlan.update({where:{id:p.id},data:{title:p.title,description:p.description,price:p.price,active:p.active,currentVersionId:p.currentVersionId,version:{increment:1}}});}await app.close();await db.$disconnect();for(const name of Object.keys(process.env))if(!(name in original))delete process.env[name];Object.assign(process.env,original);}
});
