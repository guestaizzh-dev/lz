import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {rolePermissions} from '../dist/admin-permissions.js';

if(process.env.NODE_ENV==='production')throw Error('Use isolated database');
test('event staff, short-lived credentials, attendance and reversals enforce per-session scope',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='qa-arrival-'+randomUUID().slice(0,8),minute=60000;
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
  async function staff(role){const phone='194'+String(randomInt(0,100000000)).padStart(8,'0'),password=randomUUID()+'!A',user=await db.user.create({data:{username:tag+'-'+randomUUID().slice(0,6),phone,nickname:'书院'+role,roles:[role],passwordHash:await passwordHash(password)}}),r=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(r.status,200);return{id:user.id,phone,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function login(phone='193'+String(randomInt(0,100000000)).padStart(8,'0')){const otp=await call('/auth/sms',null,'POST',{phone}),r=await call('/auth/login',null,'POST',{phone,challengeId:otp.body.challengeId,code:'123456'});assert.equal(r.status,200);return{...r.body,id:r.body.user.id};}
  try{
    await db.accessRole.upsert({where:{code:'TEACHER'},create:{code:'TEACHER',name:'老师',active:true,permissionCodes:rolePermissions.TEACHER},update:{}});
    const admin=await staff('ADMIN'),worker=await staff('TEACHER'),other=await staff('TEACHER'),a=await login(),b=await login(),workerApp=await login(worker.phone);
    const startsAt=new Date(Date.now()+30*minute),endsAt=new Date(Date.now()+120*minute),event=await db.event.create({data:{title:tag,category:'研学',description:'书院相逢',cover:'',location:'书院',startsAt,endsAt,capacity:20,price:0,status:'PUBLISHED',responsibleUserId:admin.id}});
    const sessions=[];for(let i=0;i<2;i++){const r=await call('/admin/events/'+event.id+'/sessions',admin,'POST',{startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),publicOpenAt:new Date(Date.now()-minute).toISOString(),cancelDeadline:new Date(Date.now()+20*minute).toISOString(),location:'书院第'+i+'厅',capacity:10,ticketTitle:'普通席位',perUserLimit:2});assert.equal(r.status,201);sessions.push(r.body);}
    const [first,second]=sessions,ticket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:first.id}}),made=await call('/me/bookings/registrations',a,'POST',{ticketTypeId:ticket.id,quantity:2,name:'共学学员',phone:'19900001002',contactConsent:true,requestKey:randomUUID()});assert.equal(made.status,201);const id=made.body.id,basePath='/admin/teaching/event-workbench',staffPath='/admin/events/sessions/'+first.id+'/staff';let grant,credential,firstCheck,firstKey;
    await t.test('only operators delegate valid teacher accounts; grants are unique and scoped',async()=>{
      assert.equal((await call(staffPath,worker,'POST',{userId:other.id,scopeCodes:['CHECKIN'],reason:'自行委派'})).status,403);
      assert.equal((await call(staffPath,admin,'POST',{userId:a.id,scopeCodes:['CHECKIN'],reason:'普通用户'})).status,400);
      assert.equal((await call(staffPath,admin,'POST',{userId:worker.id,scopeCodes:['REVOKE'],reason:'缺签到权限'})).status,400);
      const grants=await Promise.all([call(staffPath,admin,'POST',{userId:worker.id,scopeCodes:['CHECKIN','REVOKE'],reason:'现场值守'}),call(staffPath,admin,'POST',{userId:worker.id,scopeCodes:['CHECKIN','REVOKE'],reason:'现场值守'})]);assert.deepEqual(grants.map(r=>r.status).sort(),[201,409]);grant=grants.find(r=>r.status===201).body;
      assert.equal((await call('/admin/events/sessions/'+second.id+'/staff',admin,'POST',{userId:other.id,scopeCodes:['CHECKIN'],reason:'另场值守'})).status,201);
      assert.deepEqual((await call(basePath,worker)).body.map(s=>s.id),[first.id]);assert.equal((await call(basePath+'/sessions/'+second.id+'/roster',worker)).status,403);
      assert.equal((await call('/admin/data/event_staff',admin,'POST',{data:{sessionId:first.id,userId:other.id,scopeCodes:['CHECKIN']},reason:'绕过委派'})).status,403);
    });
    await t.test('private credentials disclose no hash, render PNG and reject forged, foreign and replaced tokens',async()=>{
      assert.equal((await call('/me/bookings/registrations/'+id+'/checkin-code',b,'POST')).status,404);
      const r=await call('/me/bookings/registrations/'+id+'/checkin-code',a,'POST');assert.equal(r.status,201);credential=r.body;assert.ok(credential.qr.startsWith('data:image/png;base64,'));assert.equal(credential.checkinHash,undefined);
      const inspected=await call(basePath+'/inspect',worker,'POST',{code:credential.code});assert.equal(inspected.status,201);assert.equal(inspected.body.phone,'199****1002');assert.equal(inspected.body.quantity,2);
      assert.equal((await call(basePath+'/inspect',other,'POST',{code:credential.code})).status,403);
      assert.equal((await call('/me/event-workbench/inspect',a,'POST',{code:credential.code})).status,403);
      assert.equal((await call(basePath+'/inspect',worker,'POST',{code:'X'.repeat(45)})).status,400);
      const old=credential;credential=(await call('/me/bookings/registrations/'+id+'/checkin-code',a,'POST')).body;assert.equal((await call(basePath+'/inspect',worker,'POST',{code:old.code})).status,409);
      await db.eventRegistration.update({where:{id},data:{checkinExpiresAt:new Date(Date.now()-1)}});assert.equal((await call(basePath+'/checkin',worker,'POST',{code:credential.code,attendeeNo:1,requestKey:randomUUID()})).status,409);credential=(await call('/me/bookings/registrations/'+id+'/checkin-code',a,'POST')).body;
    });
    await t.test('simultaneous scans record each attendee once, with time and quantity guards',async()=>{
      firstKey=randomUUID();const payload={code:credential.code,attendeeNo:1,requestKey:firstKey},responses=await Promise.all([call(basePath+'/checkin',worker,'POST',payload),call(basePath+'/checkin',worker,'POST',payload)]);assert.ok(responses.every(r=>r.status===201));assert.equal(responses[0].body.id,responses[1].body.id);firstCheck=responses[0].body;
      assert.equal((await call(basePath+'/checkin',other,'POST',payload)).status,403);assert.equal((await call(basePath+'/checkin',worker,'POST',{...payload,attendeeNo:3,requestKey:randomUUID()})).status,409);
      assert.equal((await call('/me/event-workbench/checkin',workerApp,'POST',{code:credential.code,attendeeNo:2,requestKey:randomUUID()})).status,201);assert.equal((await db.eventRegistration.findUniqueOrThrow({where:{id}})).state,'COMPLETED');
      assert.equal(await db.eventCheckin.count({where:{registrationId:id,revokedAt:null}}),2);assert.equal((await call('/me/bookings',a)).body.items.find(r=>r.id===id).checkedCount,2);
    });
    await t.test('mistaken checkins reverse once without rewriting attendance facts; re-entry has a new fact',async()=>{
      assert.equal((await call(basePath+'/checkins/'+firstCheck.id+'/revoke',other,'POST',{reason:'跨场撤销'})).status,403);
      const replies=await Promise.all([call(basePath+'/checkins/'+firstCheck.id+'/revoke',worker,'POST',{reason:'误点第一位'}),call(basePath+'/checkins/'+firstCheck.id+'/revoke',worker,'POST',{reason:'误点第一位'})]);assert.ok(replies.every(r=>r.status===201));
      const stored=await db.eventCheckin.findUniqueOrThrow({where:{id:firstCheck.id}});assert.equal(stored.actorId,worker.id);assert.equal(stored.checkedAt.toISOString(),firstCheck.checkedAt);assert.equal(stored.revokeReason,'误点第一位');assert.equal((await db.eventRegistration.findUniqueOrThrow({where:{id}})).state,'CONFIRMED');
      assert.equal((await call('/me/bookings',a)).body.items.find(r=>r.id===id).checkedCount,1);
      assert.equal((await call(basePath+'/checkin',worker,'POST',{code:credential.code,attendeeNo:1,requestKey:firstKey})).status,409);
      assert.equal((await call(basePath+'/checkin',worker,'POST',{code:credential.code,attendeeNo:1,requestKey:randomUUID()})).status,201);assert.equal(await db.eventCheckin.count({where:{registrationId:id}}),3);
      await assert.rejects(db.eventCheckin.update({where:{id:firstCheck.id},data:{revokeReason:'改写撤销原因'}}));await assert.rejects(db.eventCheckin.delete({where:{id:firstCheck.id}}));
    });
    await t.test('capability restrictions and staff revocation apply to app and admin sessions immediately',async()=>{
      const policy=await db.accessRole.findUniqueOrThrow({where:{code:'TEACHER'}});await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes.filter(p=>p!=='teaching.write')}});
      try{assert.equal((await call('/me/event-workbench/checkin',workerApp,'POST',{code:credential.code,attendeeNo:1,requestKey:randomUUID()})).status,403);}finally{await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes}});}
      assert.equal((await call(staffPath+'/'+grant.id+'/revoke',admin,'POST',{expectedVersion:grant.version,reason:'值守结束'})).status,201);
      assert.equal((await call(basePath+'/inspect',worker,'POST',{code:credential.code})).status,403);assert.equal((await call('/me/event-workbench',workerApp)).body.length,0);
      assert.equal((await call(basePath+'/checkin',worker,'POST',{code:credential.code,attendeeNo:1,requestKey:randomUUID()})).status,403);
    });
    await t.test('ended sessions reject new checkins and reversals, even with a valid credential',async()=>{
      await db.eventSession.update({where:{id:first.id},data:{startsAt:new Date(Date.now()-2*minute),endsAt:new Date(Date.now()-minute)}});
      assert.equal((await call('/admin/events/workbench/checkin',admin,'POST',{code:credential.code,attendeeNo:2,requestKey:randomUUID()})).status,409);
      const current=await db.eventCheckin.findFirstOrThrow({where:{registrationId:id,revokedAt:null}});assert.equal((await call('/admin/events/workbench/checkins/'+current.id+'/revoke',admin,'POST',{reason:'事后撤销'})).status,409);
      assert.equal((await call('/me/bookings/registrations/'+id+'/checkin-code',a,'POST')).status,409);
    });
  }finally{await app.close();await db.$disconnect();}
});
