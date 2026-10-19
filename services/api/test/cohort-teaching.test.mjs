import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';

if(process.env.NODE_ENV==='production')throw Error('Use isolated database');
test('cohort staff, homework, private attachments and checkins follow the fixed teaching context',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='qa-cohort-teaching-'+randomUUID(),day=86400000;
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const form=body instanceof FormData,res=await fetch(base+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,...(!form?{'Content-Type':'application/json'}:{}),...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:form?body:JSON.stringify(body)})});return {status:res.status,body:await res.json(),cookies:res.headers.getSetCookie()};}
  async function staff(role){const password=randomUUID()+'!A',u=await db.user.create({data:{username:tag.slice(0,45)+randomUUID().slice(0,8),nickname:role,roles:[role],passwordHash:await passwordHash(password)}}),r=await call('/admin/auth/login',null,'POST',{username:u.username,password});assert.equal(r.status,200);return{id:u.id,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function user(){const phone='196'+String(randomInt(0,100000000)).padStart(8,'0'),otp=await call('/auth/sms',null,'POST',{phone}),r=await call('/auth/login',null,'POST',{phone,challengeId:otp.body.challengeId,code:'123456'});assert.equal(r.status,200);return{...r.body,id:r.body.user.id};}
  const future=ms=>new Date(Date.now()+ms).toISOString(),submission=(body='从生活中体会知足。',expectedRevision=0)=>({requestKey:randomUUID(),body,expectedRevision,assetIds:[]}),imageForm=()=>{const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'practice.png');return form;};
  try{
    const root=await staff('ADMIN'),ordinaryTeacher=await staff('TEACHER'),assistant=await staff('TEACHER'),otherTeacher=await staff('TEACHER'),a=await user(),b=await user();
    const teacher=await db.teacher.create({data:{name:tag,title:'经典老师',bio:tag,expertise:[],status:'PUBLISHED'}}),course=await db.course.create({data:{teacherId:teacher.id,title:tag,subtitle:'营期实践',category:'经典',description:'分日共学',cover:'',price:0,tags:[],status:'PUBLISHED'}});
    const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,lessons:{create:[{sourceId:randomUUID(),title:'开营导读',position:1,format:'TEXT',body:'正文',durationSeconds:0,trial:false,required:true},{sourceId:randomUUID(),title:'第二天',position:2,format:'TEXT',body:'正文',durationSeconds:0,trial:false,required:true}]}},include:{lessons:true}});release.lessons.sort((x,y)=>x.position-y.position);
    await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
    await db.enrollment.create({data:{userId:a.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
    const cohorts=[];for(let i=0;i<2;i++){const made=await call('/admin/cohorts',root,'POST',{courseId:course.id,title:'营期'+i,startsAt:future(day),endsAt:future(5*day),enrollDeadline:future(day-60000),capacity:10});assert.equal(made.status,201);cohorts.push(made.body);const saved=await call('/admin/cohorts/'+made.body.id+'/schedule',root,'POST',{expectedVersion:1,lessons:release.lessons.map((l,i)=>({lessonId:l.id,opensOnDay:i+1})),reason:'分日安排'});assert.equal(saved.status,201);assert.equal((await call('/admin/cohorts/'+made.body.id+'/state',root,'POST',{expectedVersion:2,state:'OPEN',reason:'开放共学'})).status,201);assert.equal((await call('/me/cohorts/'+made.body.id+'/join',a,'POST')).status,201);}
    const [first,second]=cohorts,query='?cohortId='+first.id,otherQuery='?cohortId='+second.id,staffPath='/admin/teaching/courses/'+course.id+'/staff',tasksPath='/admin/teaching/courses/'+course.id+'/assignments';let teachingStaff,assignment,lockedAssignment,task,submitted,attachment;
    await t.test('ordinary and cohort teaching grants are independent, including duplicate grants and revocation',async()=>{
      const ordinary=await call(staffPath,root,'POST',{userId:ordinaryTeacher.id,role:'TEACHER',reason:'普通教学'});assert.equal(ordinary.status,201);
      const grants=await Promise.all([call(staffPath+query,root,'POST',{userId:assistant.id,role:'ASSISTANT',reason:'本期助教'}),call(staffPath+query,root,'POST',{userId:assistant.id,role:'ASSISTANT',reason:'本期助教'})]);assert.deepEqual(grants.map(r=>r.status).sort(),[201,409]);teachingStaff=grants.find(r=>r.status===201).body;
      assert.equal((await call(tasksPath+query,ordinaryTeacher)).status,403);assert.equal((await call(tasksPath,assistant)).status,403);assert.equal((await call(tasksPath+otherQuery,assistant)).status,403);assert.equal((await call(tasksPath+query,otherTeacher)).status,403);
      const scope=(await call('/admin/teaching/courses',assistant)).body.find(c=>c.id===course.id);assert.equal(scope.ordinaryAllowed,false);assert.deepEqual((await call('/admin/teaching/courses/'+course.id+'/cohorts',assistant)).body.map(c=>c.id),[first.id]);
      assert.equal((await call(staffPath+'/'+ordinary.body.id+'/revoke'+query,root,'POST',{expectedVersion:1,reason:'跨范围撤销'})).status,409);assert.equal((await db.courseStaff.findUniqueOrThrow({where:{id:ordinary.body.id}})).revokedAt,null);
      assert.equal((await call(staffPath+query,assistant,'POST',{userId:otherTeacher.id,role:'ASSISTANT',reason:'自行分配'})).status,403);
    });
    await t.test('cohort tasks bind their frozen release, not the newly published ordinary course version',async()=>{
      const updated=await db.courseRelease.create({data:{courseId:course.id,version:2,title:'新的普通版本',lessons:{create:{sourceId:randomUUID(),title:'新课件',position:1,format:'TEXT',body:'新正文',durationSeconds:0,trial:false,required:true}}},include:{lessons:true}});await db.course.update({where:{id:course.id},data:{publishedReleaseId:updated.id}});
      const make=(lessonId,title)=>call(tasksPath+query,assistant,'POST',{title,instructions:'结合日常生活写出体会。',required:true,lessonId,dueAt:future(3*day)});
      assert.equal((await make(updated.lessons[0].id,'错版作业')).status,400);
      const created=await make(release.lessons[0].id,'开营研习');assert.equal(created.status,201);assignment=created.body;
      const locked=await make(release.lessons[1].id,'次日研习');assert.equal(locked.status,201);lockedAssignment=locked.body;
      assert.equal((await call(tasksPath+query,assistant,'POST',{title:'超期作业',instructions:'研习',required:true,dueAt:future(6*day)})).status,400);
      for(const item of [assignment,lockedAssignment])assert.equal((await call('/admin/teaching/assignments/'+item.id+'/transition',assistant,'POST',{expectedVersion:1,action:'publish',reason:'正式发布'})).status,201);
      assert.equal((await call('/learning/courses/'+course.id+'/assignments'+query,a)).body.items.length,0);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions'+query,a,'POST',submission())).status,403);
    });
    await t.test('chapter opening and explicit enrolment scope gate submissions even with ordinary course access',async()=>{
      await db.courseCohort.update({where:{id:first.id},data:{startsAt:new Date(Date.now()-60000)}});
      assert.deepEqual((await call('/learning/courses/'+course.id+'/assignments'+query,a)).body.items.map(r=>r.id),[assignment.id]);
      assert.equal((await call('/learning/assignments/'+lockedAssignment.id+'/submissions'+query,a,'POST',submission())).status,403);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions',a,'POST',submission())).status,404);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions'+otherQuery,a,'POST',submission())).status,404);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions'+query,b,'POST',submission())).status,403);
      const uploaded=await call('/learning/submission-images',a,'POST',imageForm());assert.equal(uploaded.status,201);attachment=uploaded.body;
      const payload={...submission(),assetIds:[attachment.id]},results=await Promise.all([call('/learning/assignments/'+assignment.id+'/submissions'+query,a,'POST',payload),call('/learning/assignments/'+assignment.id+'/submissions'+query,a,'POST',payload)]);assert.ok(results.every(r=>r.status===201));assert.equal(results[0].body.id,results[1].body.id);submitted=results[0].body;
    });
    await t.test('private homework images and review history cannot cross teaching periods',async()=>{
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id,otherTeacher)).status,403);assert.equal((await call('/learning/submissions/'+submitted.id,b)).status,403);
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id+'/images/'+attachment.id,ordinaryTeacher,'POST')).status,403);
      const own=await call('/learning/submissions/'+submitted.id+'/images/'+attachment.id,a,'POST');assert.equal(own.status,201);assert.equal((await fetch(base+own.body.path)).status,200);
      const returned=await call('/admin/teaching/submissions/'+submitted.id+'/review',assistant,'POST',{expectedVersion:1,reason:'补充实践',body:'请补充一个生活例子。',outcome:'RETURNED'});assert.equal(returned.status,201);
      assert.equal((await call('/me/messages',a)).body.items.find(m=>m.kind==='ASSIGNMENT_REVIEW').cohortId,first.id);
      const revised=await call('/learning/assignments/'+assignment.id+'/submissions'+query,a,'POST',submission('补充了具体的实践例子。',1));assert.equal(revised.status,201);assert.equal(revised.body.revision,2);
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id+'/review',assistant,'POST',{expectedVersion:2,reason:'重复点评',body:'重复',outcome:'REVIEWED'})).status,409);
      const reviewed=await Promise.all([call('/admin/teaching/submissions/'+revised.body.id+'/review',assistant,'POST',{expectedVersion:1,reason:'实践完成',body:'体会具体，继续保持。',outcome:'REVIEWED'}),call('/admin/teaching/submissions/'+revised.body.id+'/review',assistant,'POST',{expectedVersion:1,reason:'实践完成',body:'体会具体，继续保持。',outcome:'REVIEWED'})]);assert.deepEqual(reviewed.map(r=>r.status).sort(),[201,409]);
      assert.equal((await call('/learning/submissions/'+submitted.id,a)).body.body,'从生活中体会知足。');
      assert.equal((await call('/learning/courses/'+course.id+'/assignments'+query,a)).body.summary.reviewed,1);
      assert.equal((await call('/learning/courses/'+course.id+'/assignments'+otherQuery,a)).body.items.length,0);
    });
    await t.test('cohort checkins have bounded dates, private images and one daily reward across ordinary and cohort tasks',async()=>{
      const practicePath='/admin/teaching/courses/'+course.id+'/practices';
      assert.equal((await call(practicePath+query,assistant,'POST',{title:'超额天数',instructions:'实践',requiredDays:365,required:true})).status,400);
      const created=await call(practicePath+query,assistant,'POST',{title:'每日观照',instructions:'写下今日实践。',requiredDays:2,required:true});assert.equal(created.status,201);task=created.body;
      assert.equal((await call('/learning/practices/'+task.id+'/checkins',a,'POST',{body:'今日体会',assetIds:[]})).status,404);
      assert.equal((await call('/learning/practices/'+task.id+'/checkins'+query,b,'POST',{body:'今日体会',assetIds:[]})).status,403);
      const data={body:'放慢脚步，观察日常。',assetIds:[attachment.id]},results=await Promise.all([call('/learning/practices/'+task.id+'/checkins'+query,a,'POST',data),call('/learning/practices/'+task.id+'/checkins'+query,a,'POST',data)]);assert.ok(results.every(r=>r.status===201));assert.equal(results[0].body.id,results[1].body.id);
      assert.equal((await call('/admin/teaching/practices/'+task.id+'/checkins',ordinaryTeacher)).status,403);
      assert.equal((await call('/admin/teaching/checkins/'+results[0].body.id+'/review',assistant,'POST',{expectedVersion:1,body:'坚持观照。'})).status,201);
      assert.equal((await call('/admin/teaching/checkins/'+results[0].body.id+'/review',assistant,'POST',{expectedVersion:1,body:'重复点评'})).status,409);
      const state=(await call('/learning/courses/'+course.id+'/practices'+query,a)).body;assert.equal(state.items[0].completedDays,1);assert.equal(state.items[0].checkins[0].review.body,'坚持观照。');assert.equal((await call('/me/messages',a)).body.items.find(m=>m.kind==='PRACTICE_REVIEW').cohortId,first.id);
      const ordinary=(await call(practicePath,root,'POST',{title:'普通课程任务',instructions:'实践',requiredDays:1,required:true})).body;assert.equal((await call('/learning/practices/'+ordinary.id+'/checkins',a,'POST',{body:'独立课程实践',assetIds:[]})).status,201);
      assert.equal(await db.pointsLedger.count({where:{eventKey:{startsWith:'practice.daily:'+a.id+':'}}}),1);
      const roster=(await call('/admin/cohorts/'+first.id+'/roster',root)).body.items.find(r=>r.nickname===a.user.nickname);assert.equal(roster.reviewedAssignments,1);assert.equal(roster.assignmentCount,2);assert.equal(roster.completedPracticeTasks,0);assert.equal(roster.practiceTaskCount,1);
    });
    await t.test('ending the cohort disables new participation while preserving own submissions, checkins and feedback',async()=>{
      await db.courseCohort.update({where:{id:first.id},data:{endsAt:new Date(Date.now()-1000)}});
      const work=(await call('/learning/courses/'+course.id+'/assignments'+query,a)).body;assert.equal(work.canParticipate,false);assert.ok(work.items.every(r=>!r.canSubmit));assert.equal(work.summary.reviewed,1);
      assert.equal((await call('/learning/submissions/'+submitted.id,a)).status,200);assert.equal((await call('/learning/submissions/'+submitted.id+'/images/'+attachment.id,a,'POST')).status,201);
      assert.equal((await call('/learning/courses/'+course.id+'/practices'+query,a)).body.canParticipate,false);
      assert.equal((await call('/learning/practices/'+task.id+'/checkins'+query,a,'POST',{body:'过期新提交',assetIds:[]})).status,403);
      assert.equal((await call('/learning/assignments/'+lockedAssignment.id+'/submissions'+query,a,'POST',submission())).status,403);
    });
    await t.test('revocation immediately stops the assigned teacher without exposing other periods',async()=>{
      assert.equal((await call(staffPath+'/'+teachingStaff.id+'/revoke'+query,root,'POST',{expectedVersion:1,reason:'更换本期助教'})).status,201);
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id,assistant)).status,403);assert.equal((await call('/admin/teaching/practices/'+task.id+'/checkins',assistant)).status,403);
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/cohorts',assistant)).body.length,0);
    });
    await t.test('database prevents mismatched course contexts and rewriting published teaching requirements',async()=>{
      await assert.rejects(db.assignment.update({where:{id:assignment.id},data:{cohortId:second.id}}));await assert.rejects(db.assignment.update({where:{id:assignment.id},data:{instructions:{text:'篡改已发布要求'}}}));
      await assert.rejects(db.practiceTask.update({where:{id:task.id},data:{requiredDays:3}}));
      const foreign=await db.lesson.findFirstOrThrow({where:{releaseId:{not:release.id}}});await assert.rejects(db.assignment.create({data:{courseId:course.id,cohortId:first.id,lessonId:foreign.id,title:'错版',instructions:{text:'错版'},state:'DRAFT',required:true,allowedKinds:['TEXT']}}));
    });
  }finally{await app.close();await db.$disconnect();}
});
