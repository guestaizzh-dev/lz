import {phoneLookup} from '../dist/private-data.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {clearCourses} from './fixture-cleanup.mjs';

const url=new URL(process.env.DATABASE_URL??'');
if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Teaching fixtures require the local test database');
test('course teaching: ownership, publication, submissions, review and private messages',async t=>{
  const origin='http://127.0.0.1:5173';process.env.CORS_ORIGINS=origin;process.env.DEV_OTP_CODE='123456';
  const directory=await mkdtemp(join(tmpdir(),'daoxue-teaching-'));process.env.MEDIA_DIR=directory;
  const db=new Database(),app=await createApp(false);app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/v1',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1',prefix='qa-teaching-'+randomUUID(),password=randomUUID()+'!A';
  const users=[],courses=[],teachers=[],assets=[],phones=[];let course,assignment,staff,submitted,returned,image,admin,teacher,outsider,student,other;
  async function call(path,auth,method='GET',body){const form=body instanceof FormData;const response=await fetch(base+path,{method,headers:{Origin:origin,'X-Forwarded-For':ip,...(!form?{'Content-Type':'application/json'}:{}),...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:form?body:JSON.stringify(body)})});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:response.status,body:data,cookies:response.headers.getSetCookie()};}
  async function account(role){const row=await db.user.create({data:{username:prefix+'-'+role+'-'+users.length,nickname:role,passwordHash:await passwordHash(password),roles:[role]}});users.push(row.id);const r=await call('/admin/auth/login',null,'POST',{username:row.username,password});assert.equal(r.status,200);return{id:row.id,cookie:r.cookies.map(v=>v.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function appAccount(){const phone='198'+String(randomInt(0,100000000)).padStart(8,'0');phones.push(phone);const c=await call('/auth/sms',null,'POST',{phone});assert.equal(c.status,201);const r=await call('/auth/login',null,'POST',{phone,challengeId:c.body.challengeId,code:'123456'});assert.equal(r.status,200);users.push(r.body.user.id);return{...r.body,id:r.body.user.id};}
  const submission=(overrides={})=>({requestKey:randomUUID(),expectedRevision:0,body:'将无为落实到日常行动，先观察再行动。',assetIds:[],...overrides});
  const review=(version,outcome='RETURNED')=>({expectedVersion:version,body:'请补充一个具体的日常实践例子。',score:80,outcome,reason:'老师研习点评'});
  const imageForm=()=>{const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'practice.png');return form;};
  try{
    admin=await account('ADMIN');teacher=await account('TEACHER');outsider=await account('TEACHER');student=await appAccount();other=await appAccount();
    const tr=await db.teacher.create({data:{name:prefix,title:'老师',bio:'测试档案',expertise:[],status:'PUBLISHED',isDemo:true}});teachers.push(tr.id);
    const draft=await call('/admin/courses',admin,'POST',{title:prefix,subtitle:'研习实践',description:'测试课程',category:'经典研习',format:'VIDEO',price:100,cover:'/static/art/books.svg',teacherId:tr.id,membershipTier:null,accessDays:null,refundPolicy:'测试规则',tags:[],featured:false,chapters:[{title:'经典研习',format:'TEXT',body:'知行合一',durationSeconds:0,trial:false,required:true}]});assert.equal(draft.status,201);course=draft.body;courses.push(course.id);
    for(const action of ['submit','publish']){const r=await call('/admin/courses/'+course.id+'/transition',admin,'POST',{action,expectedVersion:course.version,reason:'测试发布课程'});assert.equal(r.status,201);course=r.body;}
    await t.test('teacher role alone cannot access another course; staff grant is admin-only',async()=>{
      assert.equal((await call('/admin/teaching/courses',teacher)).body.length,0);
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/assignments',outsider)).status,403);
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/staff',teacher,'POST',{userId:teacher.id,role:'TEACHER',reason:'尝试自行分配'})).status,403);
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/staff',admin,'POST',{userId:student.id,role:'TEACHER',reason:'非老师账号'})).status,400);
      const r=await call('/admin/teaching/courses/'+course.id+'/staff',admin,'POST',{userId:teacher.id,role:'ASSISTANT',reason:'分配课程助教'});assert.equal(r.status,201);staff=r.body;
      assert.equal((await call('/admin/teaching/courses',teacher)).body[0].id,course.id);
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/staff',admin,'POST',{userId:teacher.id,role:'TEACHER',reason:'重复分配测试'})).status,409);
    });
    await t.test('assignment drafts stay private; publication uses versions and guards course membership',async()=>{
      const dto={title:'日常中的无为',instructions:'写出一个观察和实践的例子。',required:true};
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/assignments',teacher,'POST',{...dto,lessonId:randomUUID()})).status,400);
      const r=await call('/admin/teaching/courses/'+course.id+'/assignments',teacher,'POST',dto);assert.equal(r.status,201);assignment=r.body;
      assert.equal((await call('/learning/courses/'+course.id+'/assignments',student)).status,403);
      const grant=await call('/admin/courses/'+course.id+'/grant',admin,'POST',{userId:student.id,reason:'人工授权测试研习'});assert.equal(grant.status,201);assert.equal(grant.body.grantActorId,admin.id);
      assert.equal((await call('/learning/courses/'+course.id+'/assignments',student)).body.items.length,0);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',submission())).status,400);
      const p=await call('/admin/teaching/assignments/'+assignment.id+'/transition',teacher,'POST',{action:'publish',expectedVersion:assignment.version,reason:'发布研习作业'});assert.equal(p.status,201);assignment=p.body;
      assert.equal((await call('/admin/teaching/assignments/'+assignment.id+'/transition',teacher,'POST',{action:'publish',expectedVersion:1,reason:'重复发布测试'})).status,409);
      assert.equal((await call('/learning/courses/'+course.id+'/assignments',student)).body.summary.total,1);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions',other,'POST',submission())).status,403);
    });
    await t.test('private image upload rejects forged files and attachments uploaded by another account',async()=>{
      const bad=new FormData();bad.append('file',new Blob(['<script>bad</script>'],{type:'image/png'}),'fake.png');assert.equal((await call('/learning/submission-images',student,'POST',bad)).status,400);
      const r=await call('/learning/submission-images',student,'POST',imageForm());assert.equal(r.status,201);image=r.body;assets.push(image.id);assert.equal('storageKey' in image,false);
      const foreign=await call('/learning/submission-images',other,'POST',imageForm());assets.push(foreign.body.id);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',submission({assetIds:[foreign.body.id]}))).status,400);
    });
    await t.test('simultaneous retry creates one revision; changed payload and racing second submission conflict',async()=>{
      const dto=submission({assetIds:[image.id]});const results=await Promise.all([call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',dto),call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',dto)]);
      assert.ok(results.every(r=>r.status===201));assert.equal(results[0].body.id,results[1].body.id);submitted=results[0].body;
      assert.equal(await db.submission.count({where:{assignmentId:assignment.id}}),1);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',{...dto,body:'另一段内容'})).status,409);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',submission())).status,409);
      assert.equal((await call('/learning/submissions/'+submitted.id,other)).status,403);
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id,outsider)).status,403);
      assert.equal((await call('/admin/data/teacher_review',admin,'POST',{data:{},reason:'通用编辑绕过'})).status,403);
      assert.equal((await call('/admin/data/submission',admin,'POST',{data:{},reason:'通用创建绕过'})).status,403);
      assert.equal((await call('/admin/data/submission/'+submitted.id,admin,'PATCH',{data:{state:'REVIEWED'},reason:'通用编辑绕过'})).status,403);
    });
    await t.test('private attachment tickets check ownership, session and course staff on every stream',async()=>{
      assert.equal((await call('/learning/submissions/'+submitted.id+'/images/'+image.id,other,'POST')).status,403);
      const own=await call('/learning/submissions/'+submitted.id+'/images/'+image.id,student,'POST');assert.equal(own.status,201);const stream=await fetch(base+own.body.path);assert.equal(stream.status,200);assert.equal(stream.headers.get('content-type'),'image/png');assert.ok((await stream.arrayBuffer()).byteLength>40);
      const ticket=await call('/admin/teaching/submissions/'+submitted.id+'/images/'+image.id,teacher,'POST');assert.equal(ticket.status,201);assert.equal((await fetch(base+ticket.body.path,{headers:{Range:'bytes=0-7'}})).status,206);
      teacher.ticket=ticket.body.path;
    });
    await t.test('concurrent reviews generate one review and one notification, preserving return history',async()=>{
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id+'/review',outsider,'POST',review(submitted.version))).status,403);
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id+'/review',teacher,'POST',{...review(submitted.version),score:101})).status,400);
      const results=await Promise.all([call('/admin/teaching/submissions/'+submitted.id+'/review',teacher,'POST',review(submitted.version)),call('/admin/teaching/submissions/'+submitted.id+'/review',teacher,'POST',review(submitted.version))]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      assert.equal(await db.teacherReview.count({where:{submissionId:submitted.id}}),1);assert.equal(await db.notification.count({where:{userId:student.id}}),1);
      const r=await call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',submission({expectedRevision:1,body:'先观察同伴的困难，再适时给予帮助。'}));assert.equal(r.status,201);returned=r.body;assert.equal(returned.revision,2);
      assert.equal((await call('/admin/teaching/submissions/'+submitted.id+'/review',teacher,'POST',review(2))).status,409);
      assert.equal((await call('/learning/submissions/'+submitted.id,student)).body.reviews[0].state,'RETURNED');
      const accepted=await call('/admin/teaching/submissions/'+returned.id+'/review',teacher,'POST',{...review(returned.version,'REVIEWED'),body:'例子具体，继续保持观察与行动的平衡。',score:96});assert.equal(accepted.status,201);
      assert.equal((await call('/learning/courses/'+course.id+'/assignments',student)).body.summary.requiredReviewed,1);
    });
    await t.test('messages are private, markable and expire; students receive real stored feedback',async()=>{
      const list=await call('/me/messages',student);assert.equal(list.body.total,2);assert.equal(list.body.unread,2);assert.equal((await call('/me/messages',other)).body.total,0);
      assert.equal((await call('/me/messages/'+list.body.items[0].id+'/read',other,'POST')).status,404);
      assert.equal((await call('/me/messages/'+list.body.items[0].id+'/read',student,'POST')).status,201);assert.equal((await call('/me/messages',student)).body.unread,1);
      await db.notification.update({where:{id:list.body.items[1].id},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await call('/me/messages',student)).body.total,1);
    });
    await t.test('closing an assignment preserves history and revoked staff cannot reuse image tickets',async()=>{
      assert.equal((await call('/admin/teaching/assignments/'+assignment.id+'/transition',teacher,'POST',{action:'close',expectedVersion:assignment.version,reason:'本阶段作业结束'})).status,201);
      assert.equal((await call('/learning/assignments/'+assignment.id+'/submissions',student,'POST',submission({expectedRevision:2}))).status,400);
      assert.equal((await call('/admin/teaching/courses/'+course.id+'/staff/'+staff.id+'/revoke',admin,'POST',{expectedVersion:staff.version,reason:'调整授课人员'})).status,201);
      assert.equal((await call('/admin/teaching/assignments/'+assignment.id+'/submissions',teacher)).status,403);
      assert.equal((await fetch(base+teacher.ticket)).status,403);
      assert.equal((await call('/learning/submissions/'+returned.id,student)).body.reviews[0].score,96);
    });
    await t.test('future and revoked enrollments do not grant homework access; account closure removes private text',async()=>{
      const where={userId_courseId:{userId:student.id,courseId:course.id}};
      await db.enrollment.update({where,data:{startsAt:new Date(Date.now()+86400000)}});
      assert.equal((await call('/learning/courses/'+course.id+'/assignments',student)).status,403);
      await db.enrollment.update({where,data:{startsAt:new Date(),revokedAt:new Date()}});
      assert.equal((await call('/learning/courses/'+course.id+'/assignments',student)).status,403);
      assert.equal((await call('/learning/submissions/'+submitted.id,student)).status,200);
      assert.equal((await call('/me/close-account',student,'POST',{confirmation:'确认注销'})).status,201);
      assert.equal((await call('/learning/submissions/'+submitted.id,student)).status,401);
      assert.equal((await db.submission.findUniqueOrThrow({where:{id:submitted.id}})).body,'已注销用户的作业正文已清除');
      assert.equal(await db.attachmentBinding.count({where:{submissionId:submitted.id}}),0);
      assert.equal(await db.idempotencyRecord.count({where:{userId:student.id,operation:{startsWith:'assignment.submit:'}}}),0);
      assert.equal(await db.notification.count({where:{userId:student.id}}),0);
    });
  }finally{
    try {
    await db.idempotencyRecord.deleteMany({where:{userId:{in:users}}});await clearCourses(db,courses);await db.enrollment.deleteMany({where:{userId:{in:users}}});await db.course.deleteMany({where:{id:{in:courses}}});await db.teacher.deleteMany({where:{id:{in:teachers}}});await db.resource.deleteMany({where:{id:{in:[...courses,...teachers]}}});
    await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.mediaAsset.deleteMany({where:{id:{in:assets}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.otpChallenge.deleteMany({where:{OR:[{phone:{in:phones}},{phoneHash:{in:phones.map(phoneLookup)}}]}});
    } finally {await db.$disconnect();await app.close();await rm(directory,{recursive:true,force:true});}
  }
});
