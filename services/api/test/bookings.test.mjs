import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { passwordHash } from '../dist/auth.js';
import { decryptPrivate } from '../dist/private-data.js';

if(process.env.NODE_ENV==='production')throw Error('Isolated test database required');
test('service bookings, event seats and content linkage use real HTTP workflows',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='qa-bookings-'+randomUUID(),password=randomUUID()+'!A';
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=await app.getUrl(),ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
  async function admin(role){const user=await db.user.create({data:{username:tag+role+randomUUID().slice(0,8),nickname:tag,roles:[role],tags:[],passwordHash:await passwordHash(password)}});const r=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(r.status,200);return {id:user.id,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function login(){const phone='197'+String(randomInt(0,100000000)).padStart(8,'0'),c=await call('/auth/sms',null,'POST',{phone}),r=await call('/auth/login',null,'POST',{phone,challengeId:c.body.challengeId,code:'123456'});assert.equal(r.status,200);return r.body;}
  const future=ms=>new Date(Date.now()+ms).toISOString(),offeringBody={title:'经典研习咨询',mode:'PHONE',durationMinutes:30,leadMinutes:0,cancelBeforeMinutes:60,locationPolicy:'预约电话交流',deliveryPolicy:'交流本次研习疑问，不提供诊疗。',price:0,active:true};
  try {
    const operator=await admin('OPERATOR'),moderator=await admin('MODERATOR'),teacherAuth=await admin('TEACHER'),otherTeacher=await admin('TEACHER'),support=await admin('SUPPORT'),root=await admin('ADMIN'),a=await login(),b=await login();
    const teacher=await db.teacher.create({data:{name:tag,title:'研习讲师',bio:'测试资料',expertise:['经典'],status:'PUBLISHED',userId:teacherAuth.id}});
    let offering,slot,appointment,event,session,ticket,registration,product,sku;
    await t.test('service configuration uses capabilities, canonical prices and immutable identity',async()=>{
      const body={...offeringBody,teacherId:teacher.id};
      assert.equal((await call('/admin/services',support,'POST',body)).status,403);
      assert.equal((await call('/admin/services',moderator,'POST',body)).status,403);
      const r=await call('/admin/services',operator,'POST',body);assert.equal(r.status,201);offering=r.body;
      const shown=(await call('/bookings/offerings/'+offering.id)).body;assert.equal(shown.price,0);assert.equal(shown.bookingEnabled,true);assert.equal(shown.teacherName,tag);
      assert.equal((await call('/admin/services/'+offering.id,operator,'PATCH',{...body,expectedVersion:1,durationMinutes:60})).status,400);
      assert.equal((await call('/admin/data/service_offering',root,'POST',body)).status,403);
    });
    await t.test('teacher-wide scheduling rejects overlap across different services',async()=>{
      const start=future(86400000);slot=(await call('/admin/services/'+offering.id+'/slots',operator,'POST',{startsAt:start})).body;assert.ok(slot.id);
      const other=(await call('/admin/services',operator,'POST',{...offeringBody,teacherId:teacher.id,title:'另一咨询'})).body;
      const overlap=await call('/admin/services/'+other.id+'/slots',operator,'POST',{startsAt:start});assert.equal(overlap.status,409);assert.match(overlap.body.message,/重叠/);
      assert.equal((await call('/admin/services/'+offering.id+'/slots',operator,'POST',{startsAt:future(-60000)})).status,400);
    });
    const appointmentBody={slotId:null,requestKey:randomUUID(),expectedVersion:1,name:'测试学员',phone:'19900001002',contactConsent:true};
    await t.test('concurrent booking of the last slot confirms once without exposing contact',async()=>{
      appointmentBody.slotId=slot.id;
      assert.equal((await call('/me/bookings/appointments',a,'POST',{...appointmentBody,contactConsent:false})).status,400);
      const results=await Promise.all([call('/me/bookings/appointments',a,'POST',appointmentBody),call('/me/bookings/appointments',b,'POST',{...appointmentBody,requestKey:randomUUID()})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      const winner=results.findIndex(r=>r.status===201);if(winner===1){[a.accessToken,b.accessToken]=[b.accessToken,a.accessToken];[a.user,b.user]=[b.user,a.user];}
      appointment=results[winner].body;const stored=await db.appointment.findUniqueOrThrow({where:{id:appointment.id}});assert.ok(stored.contactCipher.startsWith('v1:'));assert.equal(JSON.parse(decryptPrivate(stored.contactCipher)).phone,'19900001002');assert.equal((await db.appointmentSlot.findUniqueOrThrow({where:{id:slot.id}})).confirmed,1);
      assert.equal((await call('/me/bookings?bookingId='+appointment.id,a)).body.items[0].id,appointment.id);assert.equal((await call('/me/bookings?bookingId='+appointment.id,b)).body.items.length,0);assert.equal((await call('/me/bookings?bookingId=invalid',a)).status,400);
      const mine=(await call('/me/bookings',a)).body;assert.equal(mine.items[0].title,offeringBody.title);assert.equal(mine.items[0].phone,undefined);assert.equal(mine.items[0].contactCipher,undefined);
    });
    await t.test('idempotent retry is payload bound and cancellation restores the slot once',async()=>{
      // Reuse the winning request key, whichever competing user obtained the seat.
      const stored=await db.appointment.findUniqueOrThrow({where:{id:appointment.id}});appointmentBody.requestKey=stored.requestKey;
      const retry=await call('/me/bookings/appointments',a,'POST',appointmentBody);assert.equal(retry.status,201);assert.equal(retry.body.id,appointment.id);
      assert.equal((await call('/me/bookings/appointments',a,'POST',{...appointmentBody,name:'另一人'})).status,409);
      assert.equal((await call('/me/bookings/appointments/'+appointment.id+'/cancel',b,'POST',{reason:'越权'})).status,404);
      const cancelled=await Promise.all([call('/me/bookings/appointments/'+appointment.id+'/cancel',a,'POST',{reason:'时间调整'}),call('/me/bookings/appointments/'+appointment.id+'/cancel',a,'POST',{reason:'时间调整'})]);assert.deepEqual(cancelled.map(r=>r.status),[201,201]);assert.equal((await db.appointmentSlot.findUniqueOrThrow({where:{id:slot.id}})).confirmed,0);assert.equal(await db.notification.count({where:{appointmentId:appointment.id,userId:a.user.id}}),2);
    });
    await t.test('service merchandise routes to the same slot; no duplicate SKU stock or cart purchase',async()=>{
      product=(await call('/admin/products',operator,'POST',{title:'咨询预约入口',subtitle:'选择老师时段',description:'免费经典咨询',category:'线下服务',type:'SERVICE',cover:'/static/art/books.svg',price:0,culturalOrigin:'经典研习',featured:false})).body;
      const skuBody={title:'30分钟电话咨询',serviceOfferingId:offering.id,price:0,stock:0,active:true,reason:'统一服务绑定'};
      assert.equal((await call('/admin/products/'+product.id+'/skus',operator,'POST',{...skuBody,stock:2})).status,400);
      sku=(await call('/admin/products/'+product.id+'/skus',operator,'POST',skuBody)).body;assert.ok(sku.id);
      assert.equal((await call('/admin/products/'+product.id+'/transition',operator,'POST',{action:'submit',expectedVersion:1,reason:'提交'})).status,201);
      assert.equal((await call('/admin/products/'+product.id+'/transition',moderator,'POST',{action:'publish',expectedVersion:2,reason:'发布'})).status,201);
      const detail=(await call('/catalog/products/'+product.id)).body;assert.equal(detail.skus[0].serviceOfferingId,offering.id);assert.equal(detail.checkoutEnabled,false);
      const r=await call('/me/bookings/appointments',a,'POST',{...appointmentBody,requestKey:randomUUID(),skuId:sku.id});assert.equal(r.status,201);appointment=r.body;assert.equal((await db.appointmentSlot.findUnique({where:{id:slot.id}})).confirmed,1);assert.equal((await db.productSku.findUnique({where:{id:sku.id}})).stock,0);
      assert.equal((await call('/shopping/cart/'+sku.id,a,'PUT',{quantity:1})).status,404);
    });
    await t.test('only the responsible teacher sees contact; fulfilment cannot be marked early',async()=>{
      const own=await call('/admin/teaching/appointments/'+appointment.id+'/contact',teacherAuth,'POST');assert.equal(own.status,201);assert.equal(own.body.phone,'19900001002');
      assert.equal((await call('/admin/teaching/appointments/'+appointment.id+'/contact',otherTeacher,'POST')).status,403);
      assert.equal((await call('/admin/services/appointments/'+appointment.id+'/contact',support,'POST')).status,403);
      assert.equal((await call('/admin/teaching/appointments',otherTeacher)).body.total,0);
      assert.equal((await call('/admin/services/appointments?status=CONFIRMED',operator)).status,200);
      assert.equal((await call('/admin/teaching/appointments/'+appointment.id+'/fulfil',teacherAuth,'POST',{expectedVersion:1,state:'COMPLETED',reason:'提前完成'})).status,400);
      assert.equal(await db.auditLog.count({where:{resourceId:appointment.id,action:'appointment.contact'}}),1);
    });
    await t.test('updating the offer preserves old service terms and blocks paid/free price tampering',async()=>{
      const changed=await call('/admin/services/'+offering.id,operator,'PATCH',{...offeringBody,teacherId:teacher.id,expectedVersion:1,price:1000,deliveryPolicy:'新版服务说明'});assert.equal(changed.status,200);
      const stored=await db.appointment.findUnique({where:{id:appointment.id}});assert.equal(stored.serviceSnapshot.deliveryPolicy,offeringBody.deliveryPolicy);assert.equal(stored.serviceSnapshot.price,0);
      const later=(await call('/admin/services/'+offering.id+'/slots',operator,'POST',{startsAt:future(172800000)})).body;
      assert.equal((await call('/me/bookings/appointments',a,'POST',{...appointmentBody,slotId:later.id,expectedVersion:2,requestKey:randomUUID()})).status,400);
      const visible=(await call('/bookings/offerings/'+offering.id)).body;assert.equal(visible.bookingEnabled,false);assert.equal(visible.price,1000);
      assert.equal((await call('/admin/services/'+offering.id,operator,'PATCH',{...offeringBody,teacherId:teacher.id,expectedVersion:1})).status,409);
    });
    await t.test('event sessions validate dates and use canonical event price',async()=>{
      event=await db.event.create({data:{title:'经典共读活动',description:'隔离测试',category:'共读',cover:'/static/art/books.svg',location:'书院',startsAt:new Date(Date.now()+80000000),endsAt:new Date(Date.now()+180000000),capacity:2,price:0,status:'PUBLISHED',responsibleUserId:operator.id}});
      const body={startsAt:future(86400000),endsAt:future(90000000),publicOpenAt:future(-60000),cancelDeadline:future(80000000),location:'书院一楼',capacity:2,ticketTitle:'共读席位',perUserLimit:2};
      assert.equal((await call('/admin/events/'+event.id+'/sessions',operator,'POST',{...body,capacity:3})).status,400);
      const r=await call('/admin/events/'+event.id+'/sessions',operator,'POST',body);assert.equal(r.status,201);session=r.body;
      assert.equal((await call('/admin/events/'+event.id+'/registrations?status=CANCELLED',operator)).status,200);
      const rows=(await call('/bookings/events/'+event.id+'/sessions')).body;ticket=rows[0].tickets[0];assert.equal(ticket.price,0);assert.equal(ticket.available,2);assert.equal(rows[0].contactCipher,undefined);
    });
    await t.test('event sessions support multiple ticket types within one shared capacity',async()=>{
      const multiEvent=await db.event.create({data:{title:'多票种共读活动',description:'隔离测试',category:'共读',cover:'/static/art/books.svg',location:'书院',startsAt:new Date(Date.now()+4*86400000),endsAt:new Date(Date.now()+5*86400000),capacity:5,price:0,status:'PUBLISHED',responsibleUserId:operator.id}});
      const body={startsAt:future(4*86400000+3600000),endsAt:future(4*86400000+7200000),publicOpenAt:future(-60000),cancelDeadline:future(4*86400000),location:'书院二楼',capacity:5,tickets:[{title:'普通席位',capacity:2,perUserLimit:1},{title:'共读席位',capacity:3,perUserLimit:2}]};
      assert.equal((await call('/admin/events/'+multiEvent.id+'/sessions',operator,'POST',{...body,tickets:[...body.tickets,{title:'候补席位',capacity:1,perUserLimit:1}]})).status,400);
      assert.equal((await call('/admin/events/'+multiEvent.id+'/sessions',operator,'POST',{...body,tickets:[body.tickets[0],{...body.tickets[1],title:'普通席位'}]})).status,400);
      const created=await call('/admin/events/'+multiEvent.id+'/sessions',operator,'POST',body);assert.equal(created.status,201);
      const publicSession=(await call('/bookings/events/'+multiEvent.id+'/sessions')).body[0];assert.equal(publicSession.tickets.length,2);assert.deepEqual(publicSession.tickets.map(row=>row.capacity),[3,2]);assert.equal(publicSession.available,5);
    });
    const registrationBody={ticketTypeId:null,requestKey:randomUUID(),quantity:2,name:'共读学员',phone:'19900001002',contactConsent:true};
    await t.test('shared session capacity prevents concurrent overselling and retry inflation',async()=>{
      registrationBody.ticketTypeId=ticket.id;
      const extra=await db.eventTicketType.create({data:{sessionId:session.id,title:'另一席位',capacity:2,perUserLimit:2,active:true}});await db.saleOffer.create({data:{kind:'EVENT',eventTicketId:extra.id,price:0n,active:true,policySnapshot:{}}});
      const r=await call('/me/bookings/registrations',a,'POST',registrationBody);assert.equal(r.status,201);registration=r.body;
      assert.equal((await call('/me/bookings/registrations',b,'POST',{...registrationBody,ticketTypeId:extra.id,quantity:1,requestKey:randomUUID()})).status,409);
      assert.equal((await call('/me/bookings/registrations',a,'POST',registrationBody)).body.id,registration.id);
      assert.equal((await call('/me/bookings/registrations',a,'POST',{...registrationBody,quantity:1})).status,409);
      assert.equal((await call('/bookings/events/'+event.id+'/sessions')).body[0].available,0);
      assert.equal((await call('/admin/events/'+event.id+'/registrations',operator)).body.items[0].phone,'199****1002');
      assert.equal((await call('/admin/events/'+event.id+'/registrations',support)).status,403);
    });
    await t.test('cancelled registration restores shared seats and checkin is scoped and idempotent',async()=>{
      assert.equal((await call('/me/bookings/registrations/'+registration.id+'/cancel',b,'POST',{reason:'越权'})).status,404);
      assert.equal((await call('/me/bookings/registrations/'+registration.id+'/cancel',a,'POST',{reason:'调整安排'})).status,201);
      assert.equal((await db.eventTicketType.findUnique({where:{id:ticket.id}})).confirmed,0);
      registration=(await call('/me/bookings/registrations',a,'POST',{...registrationBody,requestKey:randomUUID()})).body;
      const checkBody={attendeeNo:1,requestKey:randomUUID()};assert.equal((await call('/admin/events/registrations/'+registration.id+'/checkin',operator,'POST',checkBody)).status,409);
      await db.eventSession.update({where:{id:session.id},data:{startsAt:new Date(Date.now()-60000),endsAt:new Date(Date.now()+3600000)}});
      assert.equal((await call('/admin/events/registrations/'+registration.id+'/checkin',support,'POST',checkBody)).status,403);
      assert.equal((await call('/admin/events/registrations/'+registration.id+'/checkin',operator,'POST',checkBody)).status,201);
      assert.equal((await call('/admin/events/registrations/'+registration.id+'/checkin',operator,'POST',checkBody)).status,201);
      const partial=(await call('/me/bookings?status=CONFIRMED',a)).body.items.find(i=>i.id===registration.id);assert.equal(partial.canCancel,false);assert.equal(partial.checkedCount,1);
      assert.equal((await call('/me/bookings/registrations/'+registration.id+'/cancel',a,'POST',{reason:'签到后取消'})).status,409);
      assert.equal((await call('/admin/events/registrations/'+registration.id+'/checkin',operator,'POST',{attendeeNo:2,requestKey:randomUUID()})).status,201);
      assert.equal((await db.eventRegistration.findUnique({where:{id:registration.id}})).state,'COMPLETED');assert.equal(await db.eventCheckin.count({where:{registrationId:registration.id}}),2);
    });
    await t.test('free cohorts freeze a release, protect old learning rights and isolate discussions',async()=>{
      const course=await db.course.create({data:{teacherId:teacher.id,title:'经典共学课程',subtitle:'研习基础',description:'本期说明',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:0,tags:[],status:'PUBLISHED'}});
      const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,descriptionSnapshot:'固定的本期课程',lessons:{create:{sourceId:randomUUID(),title:'第一讲',position:1,format:'TEXT',body:'本期课件',durationSeconds:0,trial:false,required:true}}},include:{lessons:true}});
      await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
      const body={courseId:course.id,title:'共学第一期',startsAt:future(86400000),endsAt:future(604800000),enrollDeadline:future(80000000),capacity:1};
      const created=await call('/admin/cohorts',operator,'POST',body);assert.equal(created.status,201);const cohort=created.body;
      assert.equal((await call('/cohorts/'+cohort.id,a)).status,404);
      assert.equal((await call('/admin/cohorts/'+cohort.id+'/state',operator,'POST',{expectedVersion:1,state:'OPEN',reason:'免费开放'})).status,201);
      const joins=await Promise.all([call('/me/cohorts/'+cohort.id+'/join',a,'POST'),call('/me/cohorts/'+cohort.id+'/join',b,'POST')]);assert.deepEqual(joins.map(r=>r.status).sort(),[201,409]);
      const winner=joins[0].status===201?a:b,loser=winner===a?b:a;
      assert.equal((await call('/me/cohorts/'+cohort.id+'/join',winner,'POST')).body.id,joins.find(r=>r.status===201).body.id);
      assert.equal((await db.courseCohort.findUnique({where:{id:cohort.id}})).confirmed,1);
      assert.equal((await call('/learning/lessons/'+release.lessons[0].id,winner)).status,403);
      const details=(await call('/cohorts/'+cohort.id,winner)).body;assert.equal(details.canStudy,false);assert.ok(details.sectionId);
      assert.equal((await call('/forum/sections?cohortId='+cohort.id,winner)).status,200);
      assert.equal((await call('/forum/sections?cohortId='+cohort.id,loser)).status,403);
      const thread=await call('/forum/threads',winner,'POST',{requestKey:randomUUID(),sectionId:details.sectionId,title:'本期研习问题',body:'仅本期参与者可见',assetIds:[],tags:[]});assert.equal(thread.status,201);
      assert.equal((await call('/forum/threads?sectionId='+details.sectionId,loser)).status,403);
      const closure=await call('/me/close-account/status',winner);assert.ok(closure.body.pendingBookings>0);
      const enrollment=await db.cohortRegistration.findFirstOrThrow({where:{userId:winner.user.id,cohortId:cohort.id}});
      assert.equal((await call('/admin/enrollments/'+enrollment.id+'/revoke',root,'POST',{reason:'绕过营期席位'})).status,404);
      assert.equal((await call('/me/cohorts/'+cohort.id+'/cancel',winner,'POST')).status,201);assert.equal((await db.courseCohort.findUnique({where:{id:cohort.id}})).confirmed,0);
      assert.equal((await call('/forum/sections?cohortId='+cohort.id,winner)).status,403);
      assert.equal((await call('/me/cohorts/'+cohort.id+'/join',winner,'POST')).status,201);
      await db.courseCohort.update({where:{id:cohort.id},data:{startsAt:new Date(Date.now()-60000)}});
      assert.equal((await call('/learning/lessons/'+release.lessons[0].id+'?cohortId='+cohort.id,winner)).status,200);
      assert.equal((await call('/learning/courses/'+course.id+'/versions',winner)).status,404);
      assert.equal((await call('/me/cohorts/'+cohort.id+'/cancel',winner,'POST')).status,409);
      const second=(await call('/admin/cohorts',operator,'POST',{...body,title:'共学第二期',capacity:2})).body;assert.equal((await call('/admin/cohorts/'+second.id+'/state',operator,'POST',{expectedVersion:1,state:'OPEN',reason:'开放下一期'})).status,201);
      assert.equal((await call('/me/cohorts/'+second.id+'/join',winner,'POST')).status,201);
      await db.courseCohort.update({where:{id:cohort.id},data:{endsAt:new Date(Date.now()-1000),startsAt:new Date(Date.now()-120000)}});
      assert.equal((await call('/learning/lessons/'+release.lessons[0].id,winner)).status,403);assert.equal((await call('/forum/sections?cohortId='+cohort.id,winner)).status,403);
      const ordinary=await db.enrollment.create({data:{userId:loser.user.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
      assert.equal((await call('/me/cohorts/'+second.id+'/join',loser,'POST')).status,201);assert.equal((await db.enrollment.findUnique({where:{id:ordinary.id}})).cohortId,null);
    });
    await t.test('six-type relations are bidirectional, versioned, scheduled and publication filtered',async()=>{
      const source=await db.article.create({data:{title:'共读导读',summary:'文章关联',category:'经典',author:'书院',cover:'/static/art/books.svg',source:'书院',blocks:[{id:randomUUID(),type:'paragraph',text:'导读内容'}],tags:[],status:'PUBLISHED',visibility:'PUBLIC',publishedAt:new Date()}});
      const body={fromId:source.id,fromType:'ARTICLE',toId:event.id,type:'EVENT',rank:2,reason:'从阅读到实践'};
      assert.equal((await call('/admin/content-relations',operator,'POST',body)).status,403);
      const saved=await call('/admin/content-relations',moderator,'POST',body);assert.equal(saved.status,201);assert.ok(saved.body.id);
      assert.equal((await call('/discovery/related/'+source.id)).body.items[0].id,event.id);
      assert.equal((await call('/discovery/related/'+event.id)).body.items[0].id,source.id);
      assert.equal((await call('/admin/content-relations',moderator,'POST',{fromId:event.id,fromType:'EVENT',toId:source.id,type:'ARTICLE',rank:0,reason:'重复反向'})).status,409);
      assert.equal((await call('/admin/content-relations',moderator,'POST',body)).status,409);
      const updated=await call('/admin/content-relations',moderator,'POST',{...body,expectedVersion:1,startsAt:future(3600000)});assert.equal(updated.status,201);assert.equal((await call('/discovery/related/'+source.id)).body.items.length,0);
      assert.equal((await call('/admin/content-relations',moderator,'POST',{...body,expectedVersion:2})).status,201);
      await db.event.update({where:{id:event.id},data:{status:'ARCHIVED'}});assert.equal((await call('/discovery/related/'+source.id)).body.items.length,0);
      assert.equal((await call('/admin/content-relations/'+event.id+'/'+saved.body.id,moderator,'DELETE')).status,409);
      assert.equal((await call('/admin/content-relations/'+source.id+'/'+saved.body.id,moderator,'DELETE')).status,200);
      assert.equal((await call('/admin/content-relations/'+source.id,support)).status,403);
      await db.event.update({where:{id:event.id},data:{status:'PUBLISHED'}});
      const course=await db.course.findFirstOrThrow({where:{title:'经典共学课程'}}),liveResource=await db.resource.create({data:{kind:'LIVE',title:'共读直播',summary:'隔离验证',categoryCode:'共读',publishState:'PUBLISHED'}}),live=await db.liveRoom.create({data:{id:liveResource.id,teacherId:teacher.id,provider:'TEST',providerRoomId:randomUUID(),categoryCode:'共读',accessRule:{}}});
      await db.resource.update({where:{id:live.id},data:{title:'共读直播',summary:'隔离验证',publishState:'PUBLISHED'}});
      const targets=[{id:teacher.id,type:'TEACHER'},{id:course.id,type:'COURSE'},{id:live.id,type:'LIVE'},{id:product.id,type:'PRODUCT'},{id:event.id,type:'EVENT'}];
      for(const [rank,target] of targets.entries()){
        const r=await call('/admin/content-relations',moderator,'POST',{fromId:target.id,fromType:target.type,toId:source.id,type:'ARTICLE',rank,reason:'六类联动验证'});assert.equal(r.status,201,JSON.stringify(r.body));
        assert.equal((await call('/discovery/related/'+target.id)).body.items.some(i=>i.id===source.id),true);
      }
      const related=(await call('/discovery/related/'+source.id)).body.items;assert.deepEqual(related.map(i=>i.type),targets.map(i=>i.type));
      await db.event.update({where:{id:event.id},data:{endsAt:new Date(Date.now()-1000),startsAt:new Date(Date.now()-3600000)}});assert.equal((await call('/discovery/related/'+source.id)).body.items.some(i=>i.type==='EVENT'),false);
      const firstPage=(await call('/me/bookings?page=1&size=1',a)).body,secondPage=(await call('/me/bookings?page=2&size=1',a)).body;assert.equal(firstPage.items.length,1);assert.equal(firstPage.hasMore,true);assert.notEqual(firstPage.items[0].id,secondPage.items[0].id);
    });
  } finally {await app.close();await db.$disconnect();}
});
