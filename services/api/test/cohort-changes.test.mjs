import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {CohortsService} from '../dist/cohorts.js';

if(process.env.NODE_ENV==='production')throw Error('Use isolated database');
test('unopened free cohorts postpone with explicit consent, immutable teaching dates and durable notices',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),day=86400000,tag='qa-change-'+randomUUID().slice(0,8),future=n=>new Date(Date.now()+n*day).toISOString();
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
  async function login(){const phone='195'+String(randomInt(0,100000000)).padStart(8,'0'),otp=await call('/auth/sms',null,'POST',{phone}),r=await call('/auth/login',null,'POST',{phone,challengeId:otp.body.challengeId,code:'123456'});assert.equal(r.status,200);return{...r.body,id:r.body.user.id};}
  try{
    const password=randomUUID()+'!A',operator=await db.user.create({data:{username:tag,nickname:'书院运营',passwordHash:await passwordHash(password),roles:['ADMIN']}}),signed=await call('/admin/auth/login',null,'POST',{username:tag,password}),admin={cookie:signed.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:signed.body.csrfToken},a=await login(),b=await login(),c=await login();
    const teacher=await db.teacher.create({data:{name:tag,title:'经典',bio:tag,expertise:[],status:'PUBLISHED'}}),course=await db.course.create({data:{teacherId:teacher.id,title:tag,subtitle:'共学',category:'经典',description:'共学',cover:'',price:0,tags:[],status:'PUBLISHED'}}),release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:tag,lessons:{create:{sourceId:randomUUID(),title:'共读',format:'TEXT',position:1,body:'研习正文',durationSeconds:0,trial:false,required:true}}},include:{lessons:true}});
    await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});await db.enrollment.create({data:{userId:a.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
    const made=await call('/admin/cohorts',admin,'POST',{courseId:course.id,title:'共读营期',startsAt:future(2),endsAt:future(7),enrollDeadline:future(1),capacity:100});assert.equal(made.status,201);const id=made.body.id,path='/admin/cohorts/'+id;await call(path+'/state',admin,'POST',{expectedVersion:1,state:'OPEN',reason:'开放报名'});
    for(const u of [a,b])assert.equal((await call('/me/cohorts/'+id+'/join',u,'POST')).status,201);
    const before=await db.courseCohort.findUniqueOrThrow({where:{id}}),registration=await db.cohortRegistration.findUniqueOrThrow({where:{userId_cohortId:{userId:a.id,cohortId:id}}});
    const saved=await call('/admin/teaching/courses/'+course.id+'/assignments?cohortId='+id,admin,'POST',{title:'本期作业',instructions:'记下实践体会',dueAt:future(5),required:true});assert.equal(saved.status,201);const assignment=saved.body;
    assert.equal((await call('/admin/teaching/assignments/'+assignment.id+'/transition',admin,'POST',{expectedVersion:1,action:'publish',reason:'发布'})).status,201);
    const created=await call('/admin/teaching/courses/'+course.id+'/practices?cohortId='+id,admin,'POST',{title:'本期打卡',instructions:'今日观照',requiredDays:2,required:true});assert.equal(created.status,201);const task=created.body;
    await t.test('postponement preserves snapshots, teaching requirements and whole-day opening offsets',async()=>{
      assert.equal((await call(path+'/postpone',a,'POST',{expectedVersion:before.version,days:7,reason:'调整时间'})).status,403);
      assert.equal((await call(path+'/postpone',admin,'POST',{expectedVersion:before.version,days:0,reason:'调整时间'})).status,400);
      const r=await call(path+'/postpone',admin,'POST',{expectedVersion:before.version,days:7,reason:'讲师行程调整'});assert.equal(r.status,201);assert.equal(+new Date(r.body.startsAt)-+before.startsAt,7*day);assert.equal(r.body.state,'OPEN');assert.equal(r.body.scheduleVersion,2);
      const item=(await call('/admin/teaching/courses/'+course.id+'/assignments?cohortId='+id,admin)).body.items[0];assert.equal(+new Date(item.dueAt)-+new Date(assignment.dueAt),7*day);
      const practice=(await call('/admin/teaching/courses/'+course.id+'/practices?cohortId='+id,admin)).body.items[0];assert.equal(+new Date(practice.startsOn)-+new Date(task.startsOn),7*day);assert.equal(+new Date(practice.endsOn)-+new Date(task.endsOn),7*day);
      assert.equal((await db.assignment.findUniqueOrThrow({where:{id:assignment.id}})).dueAt.toISOString(),assignment.dueAt);assert.equal((await db.practiceTask.findUniqueOrThrow({where:{id:task.id}})).startsOn.toISOString(),task.startsOn);
      assert.deepEqual((await db.cohortRegistration.findUniqueOrThrow({where:{id:registration.id}})).originalScheduleSnapshot,registration.originalScheduleSnapshot);
      await assert.rejects(db.cohortScheduleChange.updateMany({where:{cohortId:id},data:{reason:'改写事实'}}));await assert.rejects(db.cohortRegistration.update({where:{id:registration.id},data:{originalScheduleSnapshot:{}}}));
      await assert.rejects(db.assignment.update({where:{id:assignment.id},data:{scheduleStartsAt:new Date()}}));
    });
    await t.test('new schedule consent is isolated from ordinary access and newest-version conflicts',async()=>{
      let detail=(await call('/cohorts/'+id,a)).body;assert.equal(detail.schedulePending,true);assert.equal(detail.canAcceptSchedule,true);assert.equal(detail.sectionId,null);
      assert.equal((await call('/learning/courses/'+course.id,a)).status,200);
      for(const suffix of ['', '/assignments','/practices'])assert.equal((await call('/learning/courses/'+course.id+suffix+'?cohortId='+id,a)).status,403);
      const section=await db.forumSection.findFirstOrThrow({where:{cohortId:id}});assert.equal((await call('/forum/sections?cohortId='+id,a)).status,403);
      assert.equal((await call('/me/cohorts/'+id+'/accept-schedule',c,'POST',{expectedScheduleVersion:2})).status,404);
      assert.equal((await call('/me/cohorts/'+id+'/accept-schedule',a,'POST',{expectedScheduleVersion:1})).status,409);
      const row=await db.courseCohort.findUniqueOrThrow({where:{id}}),r=await call(path+'/postpone',admin,'POST',{expectedVersion:row.version,days:2,reason:'再次调整'});assert.equal(r.status,201);
      assert.equal((await call('/me/cohorts/'+id+'/accept-schedule',a,'POST',{expectedScheduleVersion:2})).status,409);
      const results=await Promise.all([call('/me/cohorts/'+id+'/accept-schedule',a,'POST',{expectedScheduleVersion:3}),call('/me/cohorts/'+id+'/accept-schedule',a,'POST',{expectedScheduleVersion:3})]);assert.ok(results.every(r=>r.status===201));
      detail=(await call('/cohorts/'+id,a)).body;assert.equal(detail.schedulePending,false);assert.equal(detail.sectionId,section.id);
      assert.equal((await call('/me/cohorts/'+id+'/join',c,'POST')).status,201);assert.equal((await call('/cohorts/'+id,c)).body.schedulePending,false);
      assert.equal((await call('/cohorts/'+id,b)).body.schedulePending,true);
    });
    await t.test('concurrent changes and user withdrawal release one seat and preserve terminal history',async()=>{
      const row=await db.courseCohort.findUniqueOrThrow({where:{id}}),results=await Promise.all([call(path+'/postpone',admin,'POST',{expectedVersion:row.version,days:1,reason:'统一顺延'}),call(path+'/postpone',admin,'POST',{expectedVersion:row.version,days:1,reason:'统一顺延'})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      const exits=await Promise.all([call('/me/cohorts/'+id+'/cancel',b,'POST'),call('/me/cohorts/'+id+'/cancel',b,'POST')]);assert.ok(exits.every(r=>r.status===201));assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id}})).confirmed,2);
      const snap=(await db.cohortRegistration.findUniqueOrThrow({where:{userId_cohortId:{userId:b.id,cohortId:id}}})).scheduleSnapshot;
      const next=await db.courseCohort.findUniqueOrThrow({where:{id}});assert.equal((await call(path+'/postpone',admin,'POST',{expectedVersion:next.version,days:1,reason:'最终安排'})).status,201);
      assert.deepEqual((await db.cohortRegistration.findUniqueOrThrow({where:{userId_cohortId:{userId:b.id,cohortId:id}}})).scheduleSnapshot,snap);
      assert.equal((await call('/me/cohorts/'+id+'/cancel',b,'POST')).status,201);
    });
    await t.test('pending participants may refuse after the new start; started cohorts reject operator changes',async()=>{
      assert.equal((await call('/me/cohorts/'+id+'/accept-schedule',c,'POST',{expectedScheduleVersion:5})).status,201);
      await db.courseCohort.update({where:{id},data:{startsAt:new Date(Date.now()-1000)}});
      assert.equal((await call('/me/cohorts/'+id+'/accept-schedule',a,'POST',{expectedScheduleVersion:5})).status,409);
      const row=await db.courseCohort.findUniqueOrThrow({where:{id}});assert.equal((await call(path+'/postpone',admin,'POST',{expectedVersion:row.version,days:1,reason:'已开营不能整体顺延'})).status,409);
      assert.equal((await call('/me/cohorts/'+id+'/cancel',a,'POST')).status,201);assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id}})).confirmed,1);
    });
    await t.test('bulk cancellation and leased notification recovery preserve registration facts and deduplicate',async()=>{
      const made=await call('/admin/cohorts',admin,'POST',{courseId:course.id,title:'待取消营期',startsAt:future(2),endsAt:future(5),enrollDeadline:future(1),capacity:100});assert.equal(made.status,201);const cid=made.body.id;
      await call('/admin/cohorts/'+cid+'/state',admin,'POST',{expectedVersion:1,state:'OPEN',reason:'开放'});
      const users=[];for(let i=0;i<55;i++)users.push(await db.user.create({data:{nickname:'通知学员'+i,roles:['USER']}}));
      await db.cohortRegistration.createMany({data:users.map(u=>({userId:u.id,cohortId:cid,courseId:course.id,releaseId:release.id}))});await db.courseCohort.update({where:{id:cid},data:{confirmed:55}});
      const row=await db.courseCohort.findUniqueOrThrow({where:{id:cid}});assert.equal((await call('/admin/cohorts/'+cid+'/cancel',admin,'POST',{expectedVersion:row.version,reason:'场地安排取消'})).status,201);
      assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:cid}})).confirmed,0);assert.equal(await db.cohortRegistration.count({where:{cohortId:cid,revokedAt:{not:null}}}),55);
      assert.equal((await call('/admin/cohorts/'+cid+'/state',admin,'POST',{expectedVersion:row.version+1,state:'OPEN',reason:'重新开放'})).status,409);
      const job=await db.outboxJob.findFirstOrThrow({where:{aggregateId:cid,kind:'COHORT_CHANGE_NOTICE'}});await db.outboxJob.update({where:{id:job.id},data:{state:'RUNNING',lockedUntil:new Date(Date.now()-1000),attempts:1}});
      const worker=app.get(CohortsService);await Promise.all([worker.runNoticeJobs(),worker.runNoticeJobs()]);await worker.runNoticeJobs();
      assert.equal(await db.notification.count({where:{cohortId:cid,kind:'COHORT'}}),55);assert.equal((await db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).state,'DONE');
      const count=await db.notification.count({where:{cohortId:cid}});await worker.runNoticeJobs();assert.equal(await db.notification.count({where:{cohortId:cid}}),count);
      assert.equal((await db.forumSection.findFirstOrThrow({where:{cohortId:cid}})).active,false);
    });
    await t.test('ending notices use the newest period once and retain private teaching history',async()=>{
      await db.courseCohort.update({where:{id},data:{endsAt:new Date(Date.now()-100)}});
      await db.outboxJob.updateMany({where:{aggregateId:id,kind:'COHORT_END_NOTICE'},data:{availableAt:new Date(Date.now()-1000)}});
      const worker=app.get(CohortsService);await worker.runNoticeJobs();await worker.runNoticeJobs();
      const notices=await db.notification.findMany({where:{cohortId:id,title:'本期训练营已结营'}});assert.equal(notices.length,1);assert.equal(notices[0].userId,c.id);assert.ok(notices[0].eventKey.endsWith(':5'));
      const history=await call('/learning/courses/'+course.id+'/assignments?cohortId='+id,c);assert.equal(history.status,200);assert.equal(history.body.canParticipate,false);
      assert.equal((await call('/learning/courses/'+course.id+'?cohortId='+id,c)).status,403);
    });
  }finally{await app.close();await db.$disconnect();}
});
