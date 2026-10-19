import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {rolePermissions} from '../dist/admin-permissions.js';

if(process.env.NODE_ENV==='production')throw Error('Use isolated database');
test('free event actual fulfilment is separate from attendance, versioned and auditable',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='qa-fulfil-'+randomUUID().slice(0,8),minute=60000;
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
  async function staff(role){const password=randomUUID()+'!A',user=await db.user.create({data:{username:tag+'-'+role,nickname:'书院'+role,roles:[role],passwordHash:await passwordHash(password)}}),r=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(r.status,200);return{id:user.id,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function login(){const phone='193'+String(randomInt(0,100000000)).padStart(8,'0'),otp=await call('/auth/sms',null,'POST',{phone}),r=await call('/auth/login',null,'POST',{phone,challengeId:otp.body.challengeId,code:'123456'});assert.equal(r.status,200);return{...r.body,id:r.body.user.id,phone};}
  const path=id=>'/admin/events/workbench/registrations/'+id+'/fulfilments';
  const payload=(deliveredCount,expectedRevision=0)=>({deliveredCount,expectedRevision,publicSummary:'已完成本次共读服务，请查看书院后续说明。',evidence:'隔离验证：实际共读交付和工作人员登记依据。',reason:expectedRevision?'按实际交付复核更正':'记录本次实际交付',requestKey:randomUUID()});
  try{
    await db.accessRole.upsert({where:{code:'TEACHER'},create:{code:'TEACHER',name:'老师',active:true,permissionCodes:rolePermissions.TEACHER},update:{}});
    const admin=await staff('ADMIN'),worker=await staff('TEACHER'),operator=await staff('OPERATOR'),a=await login(),b=await login(),c=await login();
    const event=await db.event.create({data:{title:tag,description:'隔离验证',category:'共读',cover:'/static/art/books.svg',location:'共学厅',startsAt:new Date(Date.now()-86400000),endsAt:new Date(Date.now()+86400000),capacity:20,price:0,status:'PUBLISHED',responsibleUserId:admin.id}});
    const created=await call('/admin/events/'+event.id+'/sessions',admin,'POST',{startsAt:new Date(Date.now()+20*minute).toISOString(),endsAt:new Date(Date.now()+90*minute).toISOString(),publicOpenAt:new Date(Date.now()-minute).toISOString(),cancelDeadline:new Date(Date.now()+10*minute).toISOString(),location:'共学厅',capacity:20,ticketTitle:'免费席位',perUserLimit:2});assert.equal(created.status,201,JSON.stringify(created.body));
    const session=created.body,ticket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:session.id}}),registrations=[];
    for(const student of [a,b,c]){const r=await call('/me/bookings/registrations',student,'POST',{ticketTypeId:ticket.id,requestKey:randomUUID(),quantity:2,name:'共学学员',phone:student.phone,contactConsent:true});assert.equal(r.status,201);registrations.push(r.body.id);}
    const [first,partial,absent]=registrations;
    await call('/admin/events/sessions/'+session.id+'/staff',admin,'POST',{userId:worker.id,scopeCodes:['CHECKIN','REVOKE'],reason:'本场协助'});
    for(const [id,no] of [[first,1],[first,2],[partial,1]])assert.equal((await call('/admin/events/registrations/'+id+'/checkin',admin,'POST',{attendeeNo:no,requestKey:randomUUID()})).status,201);
    await t.test('attendance cannot finalize service before the session ends',async()=>{
      assert.equal((await db.eventRegistration.findUniqueOrThrow({where:{id:first}})).state,'COMPLETED');
      assert.equal((await call(path(first),admin,'POST',payload(2))).status,409);assert.equal(await db.eventFulfilment.count(),0);
      assert.equal((await call('/me/bookings',a)).body.items[0].fulfilment,null);
    });
    await db.eventSession.update({where:{id:session.id},data:{startsAt:new Date(Date.now()-90*minute),endsAt:new Date(Date.now()-minute)}});
    let recorded;
    await t.test('one actual completion is committed with notice and audit under duplicate submissions',async()=>{
      const data=payload(2),responses=await Promise.all([call(path(first),admin,'POST',data),call(path(first),admin,'POST',data)]);assert.ok(responses.every(r=>r.status===201),JSON.stringify(responses));recorded=responses[0].body;assert.equal(recorded.id,responses[1].body.id);assert.equal(recorded.outcome,'COMPLETED');assert.equal(recorded.revision,1);
      assert.equal(await db.notification.count({where:{eventKey:'event.fulfilment:'+recorded.id}}),1);assert.equal(await db.auditLog.count({where:{action:'event.fulfilment.record',changes:{path:['fulfilmentId'],equals:recorded.id}}}),1);
      assert.equal((await call(path(first),admin,'POST',{...data,deliveredCount:1})).status,409);
    });
    await t.test('partial delivery, arrived but undelivered and no-show remain distinct, with no free points',async()=>{
      assert.equal((await call(path(partial),operator,'POST',payload(2))).status,400);
      assert.equal((await call(path(partial),operator,'POST',payload(1))).body.outcome,'PARTIAL');
      assert.equal((await call(path(absent),operator,'POST',payload(0))).body.outcome,'NO_SHOW');
      const notDelivered=await call(path(first),admin,'POST',payload(0,1));assert.equal(notDelivered.status,201);assert.equal(notDelivered.body.outcome,'NOT_DELIVERED');
      const accounts=await db.pointsAccount.findMany({where:{userId:{in:[a.id,b.id,c.id]}},select:{id:true}});assert.equal(await db.pointsLedger.count({where:{accountId:{in:accounts.map(x=>x.id)}}}),0);
    });
    await t.test('corrections append immutable history, reject stale revisions and notify once per fact',async()=>{
      const submissions=await Promise.all([call(path(first),admin,'POST',payload(1,2)),call(path(first),admin,'POST',payload(2,2))]);assert.deepEqual(submissions.map(r=>r.status).sort(),[201,409]);
      const history=(await call(path(first),admin)).body;assert.deepEqual(history.map(r=>r.revision),[3,2,1]);assert.equal(history[2].evidence,recorded.evidence);assert.equal(history[2].deliveredCount,2);
      await assert.rejects(db.eventFulfilment.update({where:{id:recorded.id},data:{reason:'篡改旧依据'}}));await assert.rejects(db.eventFulfilment.delete({where:{id:recorded.id}}));
      await assert.rejects(db.eventFulfilment.create({data:{...recorded,id:randomUUID(),createdAt:new Date(),requestKey:randomUUID(),revision:8}}));
    });
    await t.test('only operators finalize; participants see their own public summary, never internal evidence',async()=>{
      assert.equal((await call('/admin/teaching/event-workbench/registrations/'+first+'/fulfilments',worker,'POST',payload(2,3))).status,403);
      assert.equal((await call('/admin/teaching/event-workbench/registrations/'+first+'/fulfilments',worker)).status,200);
      const mine=(await call('/me/bookings',a)).body.items.find(r=>r.id===first);assert.equal(mine.fulfilment.revision,3);assert.equal(mine.fulfilment.evidence,undefined);assert.equal(mine.fulfilment.reason,undefined);assert.equal((await call('/me/bookings',b)).body.items.some(r=>r.id===first),false);
      const policy=await db.accessRole.findUniqueOrThrow({where:{code:'OPERATOR'}});await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes.filter(p=>p!=='events.write')}});
      try{assert.equal((await call(path(partial),operator,'POST',payload(1,1))).status,403);}finally{await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes}});}
    });
    await t.test('cancelled and unaccepted arrangements cannot produce fulfilment facts',async()=>{
      const offer=await db.saleOffer.findFirstOrThrow({where:{eventTicketId:ticket.id}}),order=await db.tradeOrder.create({data:{orderNo:tag,userId:c.id,kind:'EVENT',requestKey:randomUUID(),requestHash:'isolated-paid-fixture',currency:'CNY',subtotal:1000n,payableTotal:1000n,pricingSnapshot:{},quoteHash:'fixture',expiresAt:new Date(Date.now()+minute)}}),item=await db.tradeOrderItem.create({data:{orderId:order.id,lineNo:1,offerId:offer.id,quantity:1,unitPrice:1000n,subtotal:1000n,payable:1000n,itemSnapshot:{},benefitSnapshot:{},state:'PENDING'}});
      await db.eventRegistration.update({where:{id:absent},data:{orderItemId:item.id}});assert.equal((await call(path(absent),admin,'POST',payload(0,1))).status,409);
      await db.eventRegistration.update({where:{id:absent},data:{orderItemId:null}});
      await db.eventSession.update({where:{id:session.id},data:{scheduleVersion:2}});assert.equal((await call(path(absent),admin,'POST',payload(0,1))).status,409);
      await db.eventSession.update({where:{id:session.id},data:{state:'CANCELLED'}});assert.equal((await call(path(first),admin,'POST',payload(2,3))).status,409);
    });
  }finally{await app.close();await db.$disconnect();}
});
