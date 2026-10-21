import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {OfflineCourses} from '../dist/offline-courses.js';

test('offline course registration, reschedule, fulfilment, certificate and withdrawal linkage',async t=>{
  const app=await createApp(false);app.useLogger(['error']);await app.listen(0,'127.0.0.1');const db=app.get(Database),auth=app.get(AuthService),offline=app.get(OfflineCourses),base=await app.getUrl();
  async function actor(kind,roles=[]){const user=await db.user.create({data:{nickname:'线下联动验证',...(roles.length?{roles}:{})}}),cred=auth.credentials(),csrf=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:cred.accessHash,refreshHash:cred.refreshHash,accessExpiresAt:cred.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});return{user,headers:kind==='ADMIN'?{Origin:'http://127.0.0.1:5173',Cookie:'daoxue_access='+cred.access,'X-CSRF-Token':csrf}:{Authorization:'Bearer '+cred.access}};}
  const admin=await actor('ADMIN',['ADMIN']),student=await actor('APP'),other=await actor('APP');
  async function call(path,who=admin,method='GET',body){const response=await fetch(base+'/api/v1'+path,{method,headers:{...who.headers,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};}
  let teacher,event,session,ticket,course,registration;
  try{
    await t.test('one real class is shared by the course, teacher calendar and activity inventory',async()=>{
      const created=await call('/admin/teachers',admin,'POST',{name:'线下共读讲师',title:'经典研习',bio:'隔离验证资料',expertise:[],portrait:'/static/art/teacher.svg'});assert.equal(created.status,201,JSON.stringify(created.body));teacher=created.body;assert.equal((await call('/admin/teachers/'+teacher.id+'/transition',admin,'POST',{action:'publish',expectedVersion:teacher.version})).status,201);
      event=(await call('/admin/events',admin,'POST',{title:'周末经典共读',description:'线下共读实际课堂的隔离验证',category:'线下活动',teacherId:teacher.id,cover:'/static/art/mountains.svg',location:'书院共读室',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+90000000).toISOString(),capacity:2,price:0})).body;
      const published=await call('/admin/events/'+event.id+'/transition',admin,'POST',{action:'publish',expectedVersion:event.version});assert.equal(published.status,201,JSON.stringify(published.body));session=await db.eventSession.findFirstOrThrow({where:{eventId:event.id}});ticket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:session.id}});
      const draft=await call('/admin/courses',admin,'POST',{title:'线下经典共读课程',subtitle:'与活动共用真实场次',description:'含真实课堂的固定课程版本',category:'经典研习',format:'OFFLINE',cover:'/static/art/books.svg',price:0,teacherId:teacher.id,refundPolicy:'按原活动规则',tags:[],featured:false,chapters:[{title:'本次共读课堂',format:'OFFLINE',body:'请按预约时间到场',eventSessionId:session.id,durationSeconds:0,trial:false,required:true}]});assert.equal(draft.status,201,JSON.stringify(draft.body));course=draft.body;
      const release=await call('/admin/courses/'+course.id+'/transition',admin,'POST',{action:'publish',expectedVersion:course.version});assert.equal(release.status,201,JSON.stringify(release.body));course=await db.course.findUniqueOrThrow({where:{id:course.id}});assert.equal((await db.offlineCourseSession.findUniqueOrThrow({where:{sessionId:session.id}})).courseId,course.id);
    });
    await t.test('registration freezes course version and cannot create extra seats or leak learning',async()=>{
      const body={ticketTypeId:ticket.id,requestKey:randomUUID(),quantity:1,name:'共读学员',phone:'19900001002',contactConsent:true};const r=await call('/me/bookings/registrations',student,'POST',body);assert.equal(r.status,201,JSON.stringify(r.body));registration=await db.eventRegistration.findUniqueOrThrow({where:{id:r.body.id}});assert.equal(registration.courseReleaseId,course.publishedReleaseId);
      assert.equal((await call('/me/bookings/registrations',student,'POST',body)).body.id,registration.id);assert.equal((await db.eventTicketType.findUniqueOrThrow({where:{id:ticket.id}})).confirmed,1);assert.equal((await offline.curriculum(course.id,student.user.id,registration.id)).access,'ENROLLED');await assert.rejects(offline.context(registration.id,other.user.id),/报名不存在/);
      await assert.rejects(offline.certificate(course.id,student.user.id,registration.id),/实际课堂/);
    });
    await t.test('rescheduling suspends learning until the learner accepts the actual schedule',async()=>{
      await db.eventSession.update({where:{id:session.id},data:{scheduleVersion:2,changeReason:'实际课堂时间调整'}});assert.ok((await offline.context(registration.id,student.user.id)).lockedReason);
      const result=await call('/me/bookings/registrations/'+registration.id+'/accept-schedule',student,'POST',{expectedScheduleVersion:2});assert.equal(result.status,201,JSON.stringify(result.body));assert.equal((await offline.context(registration.id,student.user.id)).lockedReason,null);
    });
    await t.test('attendance alone cannot complete a course; actual fulfilment and its correction govern certificates',async()=>{
      await db.eventSession.update({where:{id:session.id},data:{startsAt:new Date(Date.now()-7200000),endsAt:new Date(Date.now()-3600000)}});
      await db.eventCheckin.create({data:{registrationId:registration.id,attendeeNo:1,actorId:admin.user.id,requestKey:randomUUID(),checkedAt:new Date(Date.now()-5400000)}});await assert.rejects(offline.certificate(course.id,student.user.id,registration.id),/实际课堂/);
      const proof={registrationId:registration.id,sessionId:session.id,revision:1,requestKey:randomUUID(),requestHash:'f'.repeat(64),actorId:admin.user.id,outcome:'COMPLETED',quantity:1,attendanceCount:1,deliveredCount:1,evidence:'隔离测试中的实际共读记录',publicSummary:'本次共读课堂已完成',reason:'核对实际课堂',scheduleSnapshot:{},attendanceSnapshot:[]};await db.eventFulfilment.create({data:proof});
      const first=await offline.certificate(course.id,student.user.id,registration.id),repeat=await offline.certificate(course.id,student.user.id,registration.id);assert.equal(first.id,repeat.id);assert.equal(first.valid,true);
      await db.eventFulfilment.create({data:{...proof,revision:2,requestKey:randomUUID(),outcome:'NOT_DELIVERED',deliveredCount:0,publicSummary:'更正：本次未实际交付'}});const corrected=await offline.certificate(course.id,student.user.id,registration.id);assert.equal(corrected.id,first.id);assert.equal(corrected.valid,false);assert.ok(corrected.correctionReason);
    });
    await t.test('cancelled registration loses companion access while original history is preserved',async()=>{
      await db.eventRegistration.update({where:{id:registration.id},data:{state:'CANCELLED'}});assert.ok((await offline.context(registration.id,student.user.id)).lockedReason);assert.equal((await db.eventRegistration.findUniqueOrThrow({where:{id:registration.id}})).courseReleaseId,course.publishedReleaseId);
    });
  }finally{await app.close();}
});
