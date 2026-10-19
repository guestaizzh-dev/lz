import {phoneLookup} from '../dist/private-data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {clearCourses} from './fixture-cleanup.mjs';

const database=new URL(process.env.DATABASE_URL??'');
if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(database.hostname))throw Error('Engagement fixtures require local database');
test('questions, private practice images, progression and feedback use real authorized workflows',async t=>{
  process.env.DEV_OTP_CODE='123456';process.env.CORS_ORIGINS='http://127.0.0.1:5173';
  const mediaDir=await mkdtemp(join(tmpdir(),'daoxue-engagement-'));process.env.MEDIA_DIR=mediaDir;
  const db=new Database(),app=await createApp(false);app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/v1',prefix='qa-engagement-'+randomUUID(),password=randomUUID()+'!A',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  const users=[],phones=[],teachers=[],courses=[],tasks=[],assets=[];let teacher,course,task,student,other,staff,root,support,outsider,imageTicket;
  async function call(path,auth,method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'Content-Type':'application/json','X-Forwarded-For':ip,...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
  async function admin(role){const u=await db.user.create({data:{username:prefix+role+randomUUID().slice(0,4),nickname:role,roles:[role],passwordHash:await passwordHash(password)}});users.push(u.id);const r=await call('/admin/auth/login',null,'POST',{username:u.username,password});assert.equal(r.status,200);return{id:u.id,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function user(){const phone='196'+String(randomInt(0,100000000)).padStart(8,'0');phones.push(phone);const otp=await call('/auth/sms',null,'POST',{phone});const r=await call('/auth/login',null,'POST',{phone,code:'123456',challengeId:otp.body.challengeId});assert.equal(r.status,200);users.push(r.body.user.id);return{...r.body,id:r.body.user.id};}
  try{
    root=await admin('ADMIN');staff=await admin('TEACHER');outsider=await admin('TEACHER');support=await admin('SUPPORT');student=await user();other=await user();
    teacher=await db.teacher.create({data:{name:prefix,title:'测试老师',bio:'仅测试',expertise:['经典'],status:'PUBLISHED',isDemo:true,userId:staff.id}});teachers.push(teacher.id);
    course=await db.course.create({data:{teacherId:teacher.id,title:prefix,subtitle:'测试',description:'测试',category:'经典研习',format:'VIDEO',price:0,cover:'/static/art/books.svg',status:'PUBLISHED',isDemo:true}});courses.push(course.id);
    const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title}});await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
    await db.enrollment.create({data:{userId:student.id,courseId:course.id,releaseId:release.id,source:'MANUAL'}});
    await db.courseStaff.create({data:{courseId:course.id,userId:staff.id,role:'TEACHER'}});
    await t.test('private questions stay private, submits retry idempotently and other teachers cannot answer',async()=>{
      const payload={requestKey:randomUUID(),body:'私问测试',visibility:'PRIVATE'};
      const asked=await Promise.all([call('/teachers/'+teacher.id+'/questions',student,'POST',payload),call('/teachers/'+teacher.id+'/questions',student,'POST',payload)]);assert.ok(asked.every(r=>r.status===201));assert.equal(asked[0].body.id,asked[1].body.id);
      const id=asked[0].body.id;
      assert.equal((await call('/teachers/'+teacher.id+'/questions')).body.total,0);
      assert.equal((await call('/admin/questions/'+id+'/answer',outsider,'POST',{body:'越权',expectedVersion:1})).status,403);
      assert.equal((await call('/admin/questions/'+id+'/answer',staff,'POST',{body:'私问答复',expectedVersion:1})).status,201);
      assert.equal((await call('/me/questions',student)).body.items[0].answer.body,'私问答复');
      assert.equal((await call('/me/questions',other)).body.total,0);
      assert.equal((await call('/admin/questions',support)).status,403);
      assert.equal((await call('/teachers/'+teacher.id+'/questions')).body.total,0);
    });
    await t.test('public answers remain unpublished until reviewed and concurrent reviews have one winner',async()=>{
      const q=await call('/teachers/'+teacher.id+'/questions',student,'POST',{requestKey:randomUUID(),body:'公开问题',visibility:'PUBLIC'});
      const answer=await call('/admin/questions/'+q.body.id+'/answer',staff,'POST',{body:'公开答复',expectedVersion:1});assert.equal(answer.status,201);
      assert.equal((await call('/teachers/'+teacher.id+'/questions')).body.total,0);
      const results=await Promise.all([1,2].map(()=>call('/admin/questions/answers/'+answer.body.id+'/review',root,'POST',{expectedVersion:1,state:'APPROVED',featured:true,reason:'测试审核通过'})));
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const page=await call('/teachers/'+teacher.id+'/questions');assert.equal(page.body.total,1);assert.equal(page.body.items[0].answer.featured,true);
      assert.ok((await call('/me/messages',student)).body.items.some(n=>n.kind==='TEACHER_ANSWER'));
    });
    await t.test('practice access, concurrent same-day idempotency and daily reward cap hold',async()=>{
      const dto={title:'每日研习',instructions:'写下实践',requiredDays:7,required:true};
      const created=await call('/admin/teaching/courses/'+course.id+'/practices',staff,'POST',dto);assert.equal(created.status,201,JSON.stringify(created.body));task=created.body;tasks.push(task.id);
      assert.equal((await call('/learning/courses/'+course.id+'/practices',other)).status,403);
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/practices',outsider,'POST',dto)).status,403);
      const body={body:'今日实践',assetIds:[]},responses=await Promise.all([1,2].map(()=>call('/learning/practices/'+task.id+'/checkins',student,'POST',body)));assert.ok(responses.every(r=>r.status===201));assert.equal(responses[0].body.id,responses[1].body.id);
      assert.equal((await call('/learning/practices/'+task.id+'/checkins',student,'POST',{body:'覆盖',assetIds:[]})).status,409);
      const second=await call('/admin/teaching/courses/'+course.id+'/practices',staff,'POST',dto);tasks.push(second.body.id);assert.equal((await call('/learning/practices/'+second.body.id+'/checkins',student,'POST',body)).status,201);
      const stats=await call('/me/progression',student);assert.equal(stats.body.points,'1');assert.equal(stats.body.growth,2);
      const history=(await call('/learning/courses/'+course.id+'/practices',student)).body.items.find(t=>t.id===task.id);assert.equal(history.completedDays,1);assert.equal(history.streak,1);
      assert.equal((await call('/admin/teaching/practices/'+task.id+'/checkins',outsider)).status,403);
      const record=(await call('/admin/teaching/practices/'+task.id+'/checkins',staff)).body.items[0];assert.equal(record.body,body.body);assert.equal(record.nickname,student.user.nickname);
      const reviewDto={expectedVersion:record.version,body:'实践记录清楚，继续保持。',score:90};
      assert.equal((await call('/admin/teaching/checkins/'+record.id+'/review',outsider,'POST',reviewDto)).status,403);
      const reviewed=await Promise.all([1,2].map(()=>call('/admin/teaching/checkins/'+record.id+'/review',staff,'POST',reviewDto)));assert.deepEqual(reviewed.map(r=>r.status).sort(),[201,409]);
      assert.equal(await db.teacherReview.count({where:{checkinId:record.id}}),1);assert.equal(await db.auditLog.count({where:{resourceId:record.id,action:'practice.checkin.review'}}),1);
      const reviewRow=await db.teacherReview.findFirstOrThrow({where:{checkinId:record.id}});assert.equal((await call('/admin/data/teacher_review/'+reviewRow.id,root)).status,404);
      assert.equal((await call('/me/messages',student)).body.items.filter(r=>r.kind==='PRACTICE_REVIEW').length,1);
      const updated=(await call('/learning/courses/'+course.id+'/practices',student)).body.items.find(t=>t.id===task.id);assert.equal(updated.checkins[0].review.body,reviewDto.body);
      const priorMonth=new Date();priorMonth.setUTCMonth(priorMonth.getUTCMonth()-1);const month=priorMonth.toISOString().slice(0,7);
      const prior=(await call('/learning/courses/'+course.id+'/practices?month='+month,student)).body.items.find(t=>t.id===task.id);assert.equal(prior.completedDays,1);assert.equal(prior.checkins.length,0);
      assert.equal((await call('/admin/teaching/practices/'+task.id+'/close',staff,'POST',{expectedVersion:1,reason:'测试关闭'})).status,201);
    });
    await t.test('practice images use private session-bound tickets and revoked sessions cannot reuse them',async()=>{
      const fd=new FormData();fd.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZgAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'practice.png');
      const upload=await fetch(base+'/learning/submission-images',{method:'POST',headers:{Authorization:'Bearer '+student.accessToken},body:fd});assert.equal(upload.status,201);const asset=await upload.json();assets.push(asset.id);
      const created=await call('/admin/teaching/courses/'+course.id+'/practices',staff,'POST',{title:'图片实践',instructions:'拍一张实践图',requiredDays:1,required:true});tasks.push(created.body.id);
      const row=await call('/learning/practices/'+created.body.id+'/checkins',student,'POST',{body:'图片记录',assetIds:[asset.id]});assert.equal(row.status,201,JSON.stringify(row.body));
      assert.equal((await call('/admin/teaching/checkins/'+row.body.id+'/images/'+asset.id,outsider,'POST')).status,403);
      const staffTicket=await call('/admin/teaching/checkins/'+row.body.id+'/images/'+asset.id,staff,'POST');assert.equal(staffTicket.status,201);assert.equal((await fetch(base+staffTicket.body.path)).status,200);
      assert.equal((await call('/learning/checkins/'+row.body.id+'/images/'+asset.id,other,'POST')).status,403);
      const ticket=await call('/learning/checkins/'+row.body.id+'/images/'+asset.id,student,'POST');assert.equal(ticket.status,201);imageTicket=base+ticket.body.path;const image=await fetch(imageTicket);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
      assert.equal((await call('/me/progression',student)).body.points,'1');
    });
    await t.test('feedback is owner-only and retries do not duplicate; internal notes stay private',async()=>{
      const body={requestKey:randomUUID(),kind:'ISSUE',body:'使用问题测试'};
      const rows=await Promise.all([1,2].map(()=>call('/me/feedback',student,'POST',body)));assert.equal(rows[0].body.id,rows[1].body.id);const id=rows[0].body.id;
      assert.equal((await call('/me/feedback/'+id,other)).status,404);
      assert.equal((await call('/admin/feedback/'+id,staff)).status,403);
      const internal=await call('/admin/feedback/'+id+'/replies',support,'POST',{body:'内部备注',internal:true,state:'PROCESSING',expectedVersion:1});assert.equal(internal.status,201);
      assert.equal((await call('/me/feedback/'+id,student)).body.replies.length,0);
      const replies=await Promise.all([1,2].map(()=>call('/admin/feedback/'+id+'/replies',support,'POST',{body:'公开回复',internal:false,state:'CLOSED',expectedVersion:2})));assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
      const detail=await call('/me/feedback/'+id,student);assert.equal(detail.body.replies.length,1);assert.equal(detail.body.state,'CLOSED');assert.equal((await call('/me/messages',student)).body.items.filter(r=>r.kind==='FEEDBACK_REPLY').length,1);
      for(const key of ['teacher_question','teacher_answer','practice_task','practice_checkin','feedback','feedback_reply'])assert.equal((await call('/admin/data/'+key,root,'POST',{data:{},reason:'绕过流程'})).status,403);
    });
    await t.test('profile edits check versions, accept only dedicated avatars and expose no private attachments',async()=>{
      const profile=(await call('/me/profile',student)).body;
      assert.equal((await call('/me/profile',student,'PATCH',{nickname:'研习测试者',avatarAssetId:assets[0],expectedVersion:profile.version})).status,400);
      const fd=new FormData();fd.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZgAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'avatar.png');
      const upload=await fetch(base+'/me/profile/avatar',{method:'POST',headers:{Authorization:'Bearer '+student.accessToken},body:fd});assert.equal(upload.status,201);const asset=await upload.json();assets.push(asset.id);
      const edits=await Promise.all([1,2].map(()=>call('/me/profile',student,'PATCH',{nickname:'研习测试者',avatarAssetId:asset.id,expectedVersion:profile.version})));assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
      assert.equal((await fetch(base.replace('/api/v1','')+edits.find(r=>r.status===200).body.avatar)).status,200);
      assert.equal((await call('/me/profile',other,'PATCH',{nickname:'越权头像',avatarAssetId:asset.id,expectedVersion:1})).status,400);
      assert.equal((await call('/auth/me',student)).body.nickname,'研习测试者');
      const overview=await call('/admin/overview',root);assert.equal(overview.status,200);assert.equal(overview.body.activity.length,30);assert.ok(overview.body.pendingComments>=0);
    });
    await t.test('required course completion awards one immutable record and reviews require real learning and moderation',async()=>{
      const releaseId=course.publishedReleaseId??(await db.course.findUniqueOrThrow({where:{id:course.id}})).publishedReleaseId;
      const lessons=[];for(let position=0;position<3;position++)lessons.push(await db.lesson.create({data:{releaseId,sourceId:randomUUID(),title:'完成记录测试'+position,position,format:'TEXT',body:'经典研习',durationSeconds:0,trial:false,required:position<2}}));
      assert.equal((await call('/learning/courses/'+course.id+'/certificate',other,'POST')).status,403);
      assert.equal((await call('/me/courses/'+course.id+'/review',student,'POST',{expectedVersion:0,rating:5,body:'未学习评价'})).status,400);
      const progress={eventId:randomUUID(),positionSeconds:0,elapsedSeconds:0,completed:true};assert.equal((await call('/learning/lessons/'+lessons[0].id+'/progress',student,'POST',progress)).status,201);
      assert.equal((await call('/learning/courses/'+course.id+'/certificate',student,'POST')).status,400);
      const finished=await Promise.all([1,2].map(()=>call('/learning/lessons/'+lessons[1].id+'/progress',student,'POST',{...progress,eventId:randomUUID()})));assert.ok(finished.every(r=>r.status===201));
      const certificates=await Promise.all([1,2].map(()=>call('/learning/courses/'+course.id+'/certificate',student,'POST')));assert.ok(certificates.every(r=>r.status===201));assert.equal(certificates[0].body.id,certificates[1].body.id);assert.equal(certificates[0].body.lessonCount,2);assert.equal(await db.courseCertificate.count({where:{userId:student.id,releaseId}}),1);
      const summary=(await call('/learning/summary',student)).body;assert.equal(summary.completedCourses,1);assert.equal(summary.completedLessons,2);assert.equal(summary.watchedSeconds,'0');assert.equal((await call('/learning/summary',other)).body.completedCourses,0);
      const dto={expectedVersion:0,rating:5,body:'课堂内容清晰，便于日用实践。'},submitted=await Promise.all([1,2].map(()=>call('/me/courses/'+course.id+'/review',student,'POST',dto)));assert.ok(submitted.every(r=>r.status===201));assert.equal(submitted[0].body.id,submitted[1].body.id);const row=submitted[0].body;
      assert.equal((await call('/catalog/courses/'+course.id+'/reviews')).body.total,0);assert.equal((await call('/me/courses/'+course.id+'/review',other)).body.review,null);
      assert.equal((await call('/admin/course-reviews/'+row.id+'/moderate',staff,'POST',{expectedVersion:1,action:'APPROVE',reason:'课程评价通过'})).status,403);
      const reviews=await Promise.all([1,2].map(()=>call('/admin/course-reviews/'+row.id+'/moderate',root,'POST',{expectedVersion:1,action:'APPROVE',reason:'课程评价通过'})));assert.deepEqual(reviews.map(r=>r.status).sort(),[201,409]);
      const list=(await call('/catalog/courses/'+course.id+'/reviews')).body;assert.equal(list.total,1);assert.equal(list.average,5);assert.equal(list.items[0].body,dto.body);
      assert.equal((await call('/me/course-reviews/'+row.id,other,'DELETE',{expectedVersion:2})).status,404);
      assert.equal((await call('/me/courses/'+course.id+'/review',student,'POST',{...dto,expectedVersion:2,rating:4,body:'修订后的研习体会'})).status,201);assert.equal((await call('/catalog/courses/'+course.id+'/reviews')).body.total,0);
      assert.equal(await db.notification.count({where:{userId:student.id,kind:'COURSE_REVIEW'}}),1);
    });
    await t.test('account closure removes new private content and cached responses',async()=>{
      assert.equal((await call('/me/close-account',student,'POST',{confirmation:'确认注销'})).status,201);
      assert.equal((await call('/me/questions',student)).status,401);
      assert.equal((await fetch(imageTicket)).status,401);
      assert.equal((await fetch(base+'/profiles/'+student.id+'/avatar')).status,404);
      assert.ok((await db.teacherQuestion.findMany({where:{userId:student.id}})).every(r=>r.state==='CLOSED'));
      assert.ok((await db.practiceCheckin.findMany({where:{userId:student.id}})).every(r=>r.state==='REMOVED'));
      assert.ok((await db.teacherReview.findMany({where:{reviewerId:staff.id,checkinId:{not:null}}})).every(r=>r.body==='已注销用户的点评已清除'));
      assert.equal(await db.idempotencyRecord.count({where:{userId:student.id}}),0);
      assert.equal(await db.courseCertificate.count({where:{userId:student.id}}),0);assert.ok((await db.courseReview.findMany({where:{userId:student.id}})).every(r=>r.deletedAt&&r.body==='已注销用户'));
    });
  }finally{
    try{
      const qs=await db.teacherQuestion.findMany({where:{teacherId:{in:teachers}},select:{id:true}});await db.teacherAnswer.deleteMany({where:{questionId:{in:qs.map(r=>r.id)}}});await db.teacherQuestion.deleteMany({where:{id:{in:qs.map(r=>r.id)}}});
      const checkins=await db.practiceCheckin.findMany({where:{taskId:{in:tasks}},select:{id:true}});await db.teacherReview.deleteMany({where:{checkinId:{in:checkins.map(r=>r.id)}}});await db.attachmentBinding.deleteMany({where:{checkinId:{in:checkins.map(r=>r.id)}}});await db.practiceCheckin.deleteMany({where:{taskId:{in:tasks}}});await db.practiceTask.deleteMany({where:{id:{in:tasks}}});
      const feedback=await db.feedback.findMany({where:{userId:{in:users}},select:{id:true}});await db.feedbackReply.deleteMany({where:{feedbackId:{in:feedback.map(r=>r.id)}}});await db.feedback.deleteMany({where:{id:{in:feedback.map(r=>r.id)}}});
      await db.growthLedger.deleteMany({where:{userId:{in:users}}});const accounts=await db.pointsAccount.findMany({where:{userId:{in:users}},select:{id:true}});await db.pointsLedger.deleteMany({where:{accountId:{in:accounts.map(r=>r.id)}}});await db.pointsAccount.deleteMany({where:{userId:{in:users}}});
      await db.user.updateMany({where:{id:{in:users}},data:{avatarAssetId:null,avatar:null}});
      await clearCourses(db,courses);await db.course.deleteMany({where:{id:{in:courses}}});await db.teacher.deleteMany({where:{id:{in:teachers}}});await db.resource.deleteMany({where:{id:{in:[...teachers,...courses]}}});await db.mediaAsset.deleteMany({where:{id:{in:assets}}});
      await db.notification.deleteMany({where:{userId:{in:users}}});await db.idempotencyRecord.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.otpChallenge.deleteMany({where:{OR:[{phone:{in:phones}},{phoneHash:{in:phones.map(phoneLookup)}}]}});
    }finally{await db.$disconnect();await app.close();await rm(mediaDir,{recursive:true,force:true});}
  }
});


