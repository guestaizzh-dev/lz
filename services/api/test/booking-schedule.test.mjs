import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {BookingsService} from '../dist/bookings.js';
import {encryptPrivate,decryptPrivate} from '../dist/private-data.js';

test('booking schedule changes preserve history, consent, capacity and durable notifications',async t=>{
  assert.notEqual(process.env.NODE_ENV,'production');
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='schedule-'+randomUUID(),password=randomUUID()+'!A',day=86400000,future=n=>new Date(Date.now()+n*day).toISOString();
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=await app.getUrl(),ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',data){const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
  async function admin(role){const user=await db.user.create({data:{username:tag+role,nickname:tag,roles:[role],passwordHash:await passwordHash(password)}}),r=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(r.status,200);return {id:user.id,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function login(){const phone='198'+String(randomInt(0,100000000)).padStart(8,'0'),c=await call('/auth/sms',null,'POST',{phone}),r=await call('/auth/login',null,'POST',{phone,challengeId:c.body.challengeId,code:'123456'});assert.equal(r.status,200);return r.body;}
  try{
    const operator=await admin('OPERATOR'),support=await admin('SUPPORT'),teacherAuth=await admin('TEACHER'),a=await login(),b=await login(),service=app.get(BookingsService);
    const teacher=await db.teacher.create({data:{name:tag,title:'经典研习',bio:'隔离测试',expertise:['经典'],status:'PUBLISHED',userId:teacherAuth.id}});
    const offering=(await call('/admin/services',operator,'POST',{teacherId:teacher.id,title:'研习交流',mode:'PHONE',durationMinutes:30,leadMinutes:0,cancelBeforeMinutes:2880,locationPolicy:'电话交流',deliveryPolicy:'原始服务说明',price:0,active:true})).body;
    async function createSlot(n){const r=await call('/admin/services/'+offering.id+'/slots',operator,'POST',{startsAt:future(n)});assert.equal(r.status,201);return r.body;}
    async function book(slot,auth=a){const r=await call('/me/bookings/appointments',auth,'POST',{slotId:slot.id,requestKey:randomUUID(),expectedVersion:offering.version,name:'测试学员',phone:'19900001002',contactConsent:true});assert.equal(r.status,201);return r.body;}
    async function row(kind,id){return kind==='appointment'?db.appointment.findUniqueOrThrow({where:{id}}):db.eventRegistration.findUniqueOrThrow({where:{id}});}
    async function mine(auth,id){const r=await call('/me/bookings',auth);assert.equal(r.status,200);return r.body.items.find(i=>i.id===id);}
    let slot=await createSlot(1),appointment=await book(slot),original=(await row('appointment',appointment.id)).serviceSnapshot;
    await t.test('only authorized operators can change future schedules, preserving optimistic versions',async()=>{
      const body={expectedVersion:2,startsAt:future(2),reason:'老师行程调整'};
      assert.equal((await call('/admin/services/slots/'+slot.id+'/reschedule',support,'POST',body)).status,403);
      assert.equal((await call('/admin/services/slots/'+slot.id+'/reschedule',operator,'POST',{...body,expectedVersion:1})).status,409);
      assert.equal((await call('/admin/services/slots/'+slot.id+'/reschedule',operator,'POST',{...body,startsAt:future(.5)})).status,400);
      const collision=await createSlot(2);assert.equal((await call('/admin/services/slots/'+slot.id+'/reschedule',operator,'POST',{...body,startsAt:collision.startsAt})).status,409);
      const r=await call('/admin/services/slots/'+slot.id+'/reschedule',operator,'POST',{...body,startsAt:future(3)});assert.equal(r.status,201);slot=r.body;
      assert.equal(slot.scheduleVersion,2);assert.deepEqual((await row('appointment',appointment.id)).serviceSnapshot,original);
      const shown=await mine(a,appointment.id);assert.equal(shown.startsAt,slot.startsAt);assert.equal(shown.originalStartsAt,original.startsAt);assert.equal(shown.schedulePending,true);assert.equal(shown.canCancel,true);assert.equal(shown.cancelAt,slot.startsAt);
      assert.equal((await call('/admin/teaching/appointments',teacherAuth)).body.items[0].schedulePending,true);
      assert.equal((await call('/bookings/offerings/'+offering.id+'/slots')).body.find(r=>r.id===slot.id).changeReason,undefined);
    });
    await t.test('latest-schedule consent is owned, idempotent and cannot approve an older change',async()=>{
      const path='/me/bookings/appointments/'+appointment.id+'/accept-schedule',body={expectedScheduleVersion:2};
      assert.equal((await call(path,b,'POST',body)).status,404);
      assert.equal((await call(path,a,'POST',{expectedScheduleVersion:1})).status,409);
      assert.equal((await call(path,a,'POST',body)).status,201);assert.equal((await call(path,a,'POST',body)).status,201);
      assert.equal(await db.auditLog.count({where:{resourceId:appointment.id,action:'appointment.schedule.accept'}}),1);
      assert.equal((await mine(a,appointment.id)).schedulePending,false);
      const r=await call('/admin/services/slots/'+slot.id+'/reschedule',operator,'POST',{expectedVersion:slot.version,startsAt:future(4),reason:'再次延期'});assert.equal(r.status,201);slot=r.body;
      assert.equal((await call(path,a,'POST',body)).status,409);assert.equal((await mine(a,appointment.id)).schedulePending,true);
    });
    await t.test('unaccepted changes cannot be marked fulfilled even after the new end',async()=>{
      await db.appointmentSlot.update({where:{id:slot.id},data:{startsAt:new Date(Date.now()-3600000),endsAt:new Date(Date.now()-1800000)}});
      const current=await row('appointment',appointment.id);
      const r=await call('/admin/teaching/appointments/'+appointment.id+'/fulfil',teacherAuth,'POST',{expectedVersion:current.version,state:'COMPLETED',reason:'测试拒绝未确认安排'});assert.equal(r.status,409);
      await db.appointmentSlot.update({where:{id:slot.id},data:{startsAt:new Date(slot.startsAt),endsAt:new Date(slot.endsAt)}});
    });
    await t.test('self cancellation after a delay releases once and freezes the final schedule',async()=>{
      const r=await Promise.all([call('/me/bookings/appointments/'+appointment.id+'/cancel',a,'POST',{reason:'新时间不方便'}),call('/me/bookings/appointments/'+appointment.id+'/cancel',a,'POST',{reason:'重复取消'})]);assert.deepEqual(r.map(x=>x.status),[201,201]);
      assert.equal((await db.appointmentSlot.findUniqueOrThrow({where:{id:slot.id}})).confirmed,0);
      const shown=await mine(a,appointment.id);assert.equal(shown.state,'CANCELLED');assert.equal(shown.startsAt,slot.startsAt);assert.equal(shown.originalStartsAt,original.startsAt);
      const current=await db.appointmentSlot.findUniqueOrThrow({where:{id:slot.id}});assert.equal((await call('/admin/services/slots/'+slot.id+'/reschedule',operator,'POST',{expectedVersion:current.version,startsAt:future(5),reason:'仅调整空时段'})).status,201);
      assert.equal((await mine(a,appointment.id)).startsAt,slot.startsAt);
    });
    await t.test('accepted rescheduled services can complete, with the actual arrangement preserved',async()=>{
      const s=await createSlot(10),booking=await book(s),delayed=await call('/admin/services/slots/'+s.id+'/reschedule',operator,'POST',{expectedVersion:2,startsAt:future(11),reason:'服务延期'});assert.equal(delayed.status,201);
      assert.equal((await call('/me/bookings/appointments/'+booking.id+'/accept-schedule',a,'POST',{expectedScheduleVersion:2})).status,201);
      const start=new Date(Date.now()-3600000),end=new Date(Date.now()-1800000);await db.appointmentSlot.update({where:{id:s.id},data:{startsAt:start,endsAt:end}});
      const current=await row('appointment',booking.id);assert.equal((await call('/admin/teaching/appointments/'+booking.id+'/fulfil',teacherAuth,'POST',{expectedVersion:current.version,state:'COMPLETED',reason:'已完成研习交流'})).status,201);
      const shown=await mine(a,booking.id);assert.equal(shown.state,'COMPLETED');assert.equal(shown.startsAt,start.toISOString());assert.equal(shown.schedulePending,false);assert.equal((await call('/admin/teaching/appointments/'+booking.id+'/contact',teacherAuth,'POST')).status,403);
    });
    await t.test('an unaccepted delayed arrangement can still be rejected after start without recording absence',async()=>{
      const s=await createSlot(12),booking=await book(s),delayed=await call('/admin/services/slots/'+s.id+'/reschedule',operator,'POST',{expectedVersion:2,startsAt:future(13),reason:'尚未确认的延期'});assert.equal(delayed.status,201);
      await db.appointmentSlot.update({where:{id:s.id},data:{startsAt:new Date(Date.now()-1800000),endsAt:new Date(Date.now()-60000)}});
      assert.equal((await mine(a,booking.id)).canCancel,true);
      assert.equal((await call('/me/bookings/appointments/'+booking.id+'/cancel',a,'POST',{reason:'不接受改期'})).status,201);
      assert.equal((await row('appointment',booking.id)).state,'CANCELLED');assert.equal((await db.appointmentSlot.findUniqueOrThrow({where:{id:s.id}})).confirmed,0);
    });
    await t.test('operator cancellation preserves records, releases capacity once and prevents reopening',async()=>{
      const cancelSlot=await createSlot(6),booking=await book(cancelSlot),path='/admin/services/slots/'+cancelSlot.id+'/cancel',dto={expectedVersion:2,reason:'老师临时无法出席'};
      const responses=await Promise.all([call(path,operator,'POST',dto),call(path,operator,'POST',dto)]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
      const cancelled=await db.appointmentSlot.findUniqueOrThrow({where:{id:cancelSlot.id}});assert.equal(cancelled.confirmed,0);assert.equal((await row('appointment',booking.id)).state,'CANCELLED');assert.equal((await mine(a,booking.id)).changeReason,dto.reason);
      assert.equal((await call('/admin/services/slots/'+cancelSlot.id+'/state',operator,'POST',{expectedVersion:cancelled.version,state:'OPEN',reason:'非法重开'})).status,409);
      await service.runNoticeJobs();await service.runNoticeJobs();assert.equal(await db.notification.count({where:{appointmentId:booking.id,eventKey:{startsWith:'booking.change:'}}}),1);
      const reserved=await createSlot(7);await db.appointmentSlot.update({where:{id:reserved.id},data:{reserved:1}});assert.equal((await call('/admin/services/slots/'+reserved.id+'/cancel',operator,'POST',{expectedVersion:1,reason:'不能丢失预占'})).status,409);
    });
    await t.test('delayed notices do not ask already accepted, completed or self-cancelled students to confirm',async()=>{
      const s=await createSlot(14),booking=await book(s,b);assert.equal((await call('/admin/services/slots/'+s.id+'/reschedule',operator,'POST',{expectedVersion:2,startsAt:future(15),reason:'已阅读的新安排'})).status,201);
      assert.equal((await call('/me/bookings/appointments/'+booking.id+'/accept-schedule',b,'POST',{expectedScheduleVersion:2})).status,201);
      const cancelledSlot=await createSlot(16),cancelledBooking=await book(cancelledSlot,b);assert.equal((await call('/admin/services/slots/'+cancelledSlot.id+'/reschedule',operator,'POST',{expectedVersion:2,startsAt:future(17),reason:'已拒绝的新安排'})).status,201);
      assert.equal((await call('/me/bookings/appointments/'+cancelledBooking.id+'/cancel',b,'POST',{reason:'拒绝改期'})).status,201);
      await service.runNoticeJobs();
      const completed=(await db.appointment.findMany({where:{userId:a.user.id,state:'COMPLETED'},select:{id:true}})).map(r=>r.id);
      assert.equal(await db.notification.count({where:{appointmentId:{in:[booking.id,cancelledBooking.id,...completed]},eventKey:{startsWith:'booking.change:'}}}),0);
    });
    const event=await db.event.create({data:{title:'共读会',description:'隔离测试',category:'共读',cover:'/static/art/books.svg',location:'书院',startsAt:new Date(future(.5)),endsAt:new Date(future(10)),capacity:100,price:0,status:'PUBLISHED',responsibleUserId:operator.id}});
    const sessionBody={startsAt:future(1),endsAt:future(1.1),publicOpenAt:future(-2),cancelDeadline:future(-1),location:'一楼',capacity:100,ticketTitle:'共读席位',perUserLimit:2};
    let session=(await call('/admin/events/'+event.id+'/sessions',operator,'POST',sessionBody)).body;
    const ticket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:session.id}});
    const regResult=await call('/me/bookings/registrations',a,'POST',{ticketTypeId:ticket.id,requestKey:randomUUID(),quantity:2,name:'共读学员',phone:'19900001002',contactConsent:true});assert.equal(regResult.status,201);const registration=regResult.body,snapshot=decryptPrivate((await row('registration',registration.id)).attendeeSnapshotCipher);
    await t.test('event delays validate timing, expose a new location and restore cancellation choice',async()=>{
      const dto={expectedVersion:1,startsAt:future(2),endsAt:future(2.1),location:'二楼共读室',reason:'场地维护延期'};
      assert.equal((await call('/me/bookings/registrations/'+registration.id+'/cancel',a,'POST',{reason:'原规则超过截止'})).status,409);
      assert.equal((await call('/admin/events/sessions/'+session.id+'/reschedule',operator,'POST',{...dto,endsAt:future(1.5)})).status,400);
      const r=await call('/admin/events/sessions/'+session.id+'/reschedule',operator,'POST',dto);assert.equal(r.status,201);session=r.body;
      assert.equal(decryptPrivate((await row('registration',registration.id)).attendeeSnapshotCipher),snapshot);
      const shown=await mine(a,registration.id);assert.equal(shown.location,dto.location);assert.equal(shown.schedulePending,true);assert.equal(shown.canCancel,true);
      const adminRow=(await call('/admin/events/'+event.id+'/registrations',operator)).body.items[0];assert.equal(adminRow.startsAt,session.startsAt);assert.equal(adminRow.schedulePending,true);
      assert.equal((await call('/bookings/events/'+event.id+'/sessions')).body.find(r=>r.id===session.id).changeReason,undefined);
      await db.eventSession.update({where:{id:session.id},data:{startsAt:new Date(Date.now()-600000),endsAt:new Date(Date.now()+3600000)}});
      assert.equal((await mine(a,registration.id)).canCancel,true);
      assert.equal((await call('/admin/events/registrations/'+registration.id+'/checkin',operator,'POST',{attendeeNo:1,requestKey:randomUUID()})).status,409);
      await db.eventSession.update({where:{id:session.id},data:{startsAt:new Date(session.startsAt),endsAt:new Date(session.endsAt)}});
    });
    await t.test('confirmation and cancellation racing a second delay always leave a coherent record',async()=>{
      const r=await Promise.all([call('/me/bookings/registrations/'+registration.id+'/accept-schedule',a,'POST',{expectedScheduleVersion:2}),call('/admin/events/sessions/'+session.id+'/reschedule',operator,'POST',{expectedVersion:session.version,startsAt:future(3),endsAt:future(3.1),location:'二楼',reason:'最新安排'})]);assert.equal(r[1].status,201);assert.ok([201,409].includes(r[0].status));session=r[1].body;
      assert.equal((await mine(a,registration.id)).schedulePending,true);
      const cancellation=await Promise.all([call('/me/bookings/registrations/'+registration.id+'/cancel',a,'POST',{reason:'新安排不便参加'}),call('/admin/events/sessions/'+session.id+'/cancel',operator,'POST',{expectedVersion:session.version,reason:'活动取消'})]);assert.deepEqual(cancellation.map(r=>r.status),[201,201]);
      assert.equal((await db.eventTicketType.findUniqueOrThrow({where:{id:ticket.id}})).confirmed,0);assert.equal((await row('registration',registration.id)).state,'CANCELLED');assert.deepEqual(decryptPrivate((await row('registration',registration.id)).attendeeSnapshotCipher),snapshot);
    });
    await t.test('new bookings after delay inherit consent and keep the ordinary cancellation policy',async()=>{
      const s=(await call('/admin/events/'+event.id+'/sessions',operator,'POST',{...sessionBody,startsAt:future(4),endsAt:future(4.1)})).body;
      assert.equal((await call('/admin/events/sessions/'+s.id+'/reschedule',operator,'POST',{expectedVersion:s.version,startsAt:future(5),endsAt:future(5.1),location:'书院',reason:'开放前改期'})).status,201);
      const tk=await db.eventTicketType.findFirstOrThrow({where:{sessionId:s.id}}),r=await call('/me/bookings/registrations',b,'POST',{ticketTypeId:tk.id,requestKey:randomUUID(),quantity:1,name:'新报名学员',phone:'19900001003',contactConsent:true});assert.equal(r.status,201);
      const shown=await mine(b,r.body.id);assert.equal(shown.schedulePending,false);assert.equal(shown.canCancel,false);assert.equal((await row('registration',r.body.id)).acceptedScheduleVersion,2);
      await db.eventCheckin.create({data:{registrationId:r.body.id,attendeeNo:1,actorId:operator.id,requestKey:randomUUID(),checkedAt:new Date()}});
      assert.equal((await call('/admin/events/sessions/'+s.id+'/reschedule',operator,'POST',{expectedVersion:2,startsAt:future(5.5),endsAt:future(5.6),location:'书院',reason:'已签到不可直接改期'})).status,409);
      // M07 permits the organizer to cancel free early check-ins while retaining attendance.
      assert.equal((await call('/admin/events/sessions/'+s.id+'/cancel',operator,'POST',{expectedVersion:2,reason:'取消安排并保留已签到事实'})).status,201);
      assert.equal((await row('registration',r.body.id)).state,'CANCELLED');
      assert.equal((await db.eventTicketType.findUniqueOrThrow({where:{id:tk.id}})).confirmed,0);
      assert.equal(await db.eventCheckin.count({where:{registrationId:r.body.id,revokedAt:null}}),1);
    });
    await t.test('accepted event changes allow scoped arrival and keep the final schedule in history',async()=>{
      const s=(await call('/admin/events/'+event.id+'/sessions',operator,'POST',{...sessionBody,startsAt:future(6),endsAt:future(6.1)})).body,tk=await db.eventTicketType.findFirstOrThrow({where:{sessionId:s.id}});
      const r=await call('/me/bookings/registrations',b,'POST',{ticketTypeId:tk.id,requestKey:randomUUID(),quantity:1,name:'已确认新安排学员',phone:'19900001003',contactConsent:true});assert.equal(r.status,201);
      assert.equal((await call('/admin/events/sessions/'+s.id+'/reschedule',operator,'POST',{expectedVersion:1,startsAt:future(7),endsAt:future(7.1),location:'新共读室',reason:'延后共读'})).status,201);
      assert.equal((await call('/me/bookings/registrations/'+r.body.id+'/accept-schedule',b,'POST',{expectedScheduleVersion:2})).status,201);
      const start=new Date(Date.now()+600000),end=new Date(Date.now()+3600000);await db.eventSession.update({where:{id:s.id},data:{startsAt:start,endsAt:end}});
      const check=await call('/admin/events/registrations/'+r.body.id+'/checkin',operator,'POST',{attendeeNo:1,requestKey:randomUUID()});assert.equal(check.status,201);
      const shown=await mine(b,r.body.id);assert.equal(shown.state,'COMPLETED');assert.equal(shown.location,'新共读室');assert.equal(shown.startsAt,start.toISOString());assert.equal(shown.schedulePending,false);
    });
    await t.test('a published single-session event can postpone beyond its original end without editing sold terms',async()=>{
      const start=new Date(future(1)),end=new Date(future(1.1)),e=await db.event.create({data:{title:'单场共读',description:'原活动介绍',category:'共读',cover:'/static/art/books.svg',location:'原共读室',startsAt:start,endsAt:end,capacity:2,price:0,status:'PUBLISHED',responsibleUserId:operator.id}});
      const s=(await call('/admin/events/'+e.id+'/sessions',operator,'POST',{...sessionBody,startsAt:start.toISOString(),endsAt:end.toISOString(),location:e.location,capacity:2})).body;
      const r=await call('/admin/events/sessions/'+s.id+'/reschedule',operator,'POST',{expectedVersion:1,startsAt:future(2),endsAt:future(2.1),location:'新共读室',reason:'天气延期'});assert.equal(r.status,201);
      const current=await db.event.findUniqueOrThrow({where:{id:e.id}});assert.equal(current.startsAt.toISOString(),r.body.startsAt);assert.equal(current.endsAt.toISOString(),r.body.endsAt);assert.equal(current.location,'新共读室');assert.equal(current.description,e.description);assert.equal(current.version,2);
      assert.equal(await db.auditLog.count({where:{resourceId:e.id,action:'event.schedule.extend'}}),1);
    });
    await t.test('large-group notices batch, recover an expired lease and avoid duplicates or obsolete prompts',async()=>{
      const s=(await call('/admin/events/'+event.id+'/sessions',operator,'POST',{...sessionBody,startsAt:future(8),endsAt:future(8.1)})).body,tk=await db.eventTicketType.findFirstOrThrow({where:{sessionId:s.id}});
      const users=Array.from({length:55},()=>({id:randomUUID(),nickname:'批量通知学员',roles:['USER']}));await db.user.createMany({data:users});
      const records=users.map(u=>({id:randomUUID(),userId:u.id,ticketTypeId:tk.id,quantity:1,requestKey:randomUUID(),state:'CONFIRMED',checkinHash:randomUUID(),confirmedAt:new Date(Date.now()-1000),attendeeSnapshotCipher:encryptPrivate(JSON.stringify({title:'共读会',name:'通知学员',phone:'19900001002',startsAt:s.startsAt,endsAt:s.endsAt,location:s.location,cancelDeadline:s.cancelDeadline,price:0}))}));await db.eventRegistration.createMany({data:records});await db.eventTicketType.update({where:{id:tk.id},data:{confirmed:55}});
      assert.equal((await call('/admin/events/sessions/'+s.id+'/reschedule',operator,'POST',{expectedVersion:1,startsAt:future(9),endsAt:future(9.1),location:'新共读室',reason:'调整场地'})).status,201);
      assert.equal((await call('/admin/events/sessions/'+s.id+'/cancel',operator,'POST',{expectedVersion:2,reason:'安全原因取消'})).status,201);
      const job=await db.outboxJob.findFirstOrThrow({where:{aggregateId:s.id,kind:'BOOKING_CHANGE_NOTICE',eventKey:{endsWith:':3'}}});await db.outboxJob.update({where:{id:job.id},data:{state:'RUNNING',lockedUntil:new Date(Date.now()-1000)}});
      await service.runNoticeJobs();await service.runNoticeJobs();
      assert.equal(await db.notification.count({where:{registrationId:{in:records.map(r=>r.id)},eventKey:{startsWith:'booking.change:'}}}),55);
      assert.equal(await db.notification.count({where:{registrationId:{in:records.map(r=>r.id)},title:'预约 / 活动安排已延期'}}),0);
      assert.equal((await db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).state,'DONE');assert.equal((await db.eventTicketType.findUniqueOrThrow({where:{id:tk.id}})).confirmed,0);
    });
  }finally{await app.close();await db.$disconnect();}
});
