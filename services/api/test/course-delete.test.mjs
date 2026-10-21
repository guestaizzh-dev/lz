import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {clearCourses} from './fixture-cleanup.mjs';

test('archived course deletion retains learning, prevents resurrection and serializes retries',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';
  const app=await createApp(false);await app.listen(0,'127.0.0.1');
  const db=app.get(Database),auth=app.get(AuthService),base=await app.getUrl(),users=[];
  async function actor(kind,roles){const user=await db.user.create({data:{nickname:'课程删除验收',roles}}),c=auth.credentials(),csrf=randomUUID();users.push(user.id);await db.authSession.create({data:{userId:user.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});return{user,headers:kind==='ADMIN'?{Origin:'http://127.0.0.1:5173',Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrf}:{Authorization:'Bearer '+c.access}};}
  async function call(path,who,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers:{...who?.headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
  let teacher,course;
  try{
    assert.equal((await db.$queryRaw`SHOW statement_timeout`)[0].statement_timeout,'30s');
    assert.equal((await db.$queryRaw`SHOW lock_timeout`)[0].lock_timeout,'5s');
    const root=await actor('ADMIN',['ADMIN']),viewer=await actor('ADMIN',['MODERATOR']),student=await actor('APP',['USER']);
    teacher=await db.teacher.create({data:{name:'删除测试名师',title:'名师',bio:'测试',expertise:[],status:'PUBLISHED'}});
    course=await db.course.create({data:{title:'删除验收'+randomUUID(),subtitle:'测试',description:'测试',category:'经典研习',cover:'/static/art/books.svg',price:100,tags:[],teacherId:teacher.id,status:'PUBLISHED'}});
    const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,teacherSnapshot:{},refundPolicySnapshot:{},completionPolicySnapshot:{},lessons:{create:{sourceId:randomUUID(),position:1,title:'已购正文',format:'TEXT',body:'道可道',durationSeconds:0,trial:false,required:true}}},include:{lessons:true}});
    await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
    await db.enrollment.create({data:{courseId:course.id,userId:student.user.id,releaseId:release.id,source:'ADMIN_COMPENSATION',grantReason:'删除保留验收'}});
    const url='/admin/courses/'+course.id;
    await t.test('authorization, csrf, state and stale revisions fail closed',async()=>{
      assert.equal((await call(url+'/delete',null,'POST',{expectedVersion:1})).status,401);
      assert.equal((await call('/admin/data/course/'+course.id,root,'DELETE',{reason:'不能绕过留痕删除'})).status,403);
      assert.equal((await call(url+'/delete',viewer,'POST',{expectedVersion:1})).status,403);
      assert.equal((await call(url+'/delete',{headers:{Cookie:root.headers.Cookie,Origin:root.headers.Origin}},'POST',{expectedVersion:1})).status,403);
      assert.equal((await call(url+'/delete',root,'POST',{expectedVersion:1})).status,409);
      const archived=await call(url+'/transition',root,'POST',{action:'archive',expectedVersion:1});assert.equal(archived.status,201);
      assert.equal((await call(url+'/delete',root,'POST',{expectedVersion:1})).status,409);
    });
    await t.test('client diagnostics are authenticated, bounded and exclude raw private error content',async()=>{
      const dto={kind:'RUNTIME',route:'pages/live/watch',build:'0.3.16',errorType:'TypeError',fingerprint:'1234abcd'};
      assert.equal((await call('/diagnostics',null,'POST',dto)).status,401);
      assert.equal((await call('/diagnostics',student,'POST',{...dto,message:'private'})).status,400);
      assert.equal((await call('/diagnostics',student,'POST',{...dto,route:'pages/live/watch?token=secret'})).status,400);
      for(let i=0;i<20;i++)assert.equal((await call('/diagnostics',student,'POST',dto)).status,201);
      assert.equal((await call('/diagnostics',student,'POST',dto)).status,429);
      const rows=await db.auditLog.findMany({where:{actorId:student.user.id,action:'client.error'}});assert.equal(rows.length,20);assert.deepEqual(rows[0].changes,dto);
    });
    await t.test('concurrent retries produce one audit and do not remove purchased lessons',async()=>{
      const results=await Promise.all([call(url+'/delete',root,'POST',{expectedVersion:2}),call(url+'/delete',root,'POST',{expectedVersion:2})]);assert.deepEqual(results.map(r=>r.status),[201,201]);
      assert.equal(await db.auditLog.count({where:{resourceId:course.id,action:'course.delete'}}),1);
      assert.ok((await db.course.findUniqueOrThrow({where:{id:course.id}})).deletedAt);
      assert.equal((await call('/admin/courses?q='+encodeURIComponent(course.title),root)).body.total,0);
      assert.equal((await call(url,root)).status,404);
      assert.equal((await call(url+'/transition',root,'POST',{action:'revise',expectedVersion:3})).status,409);
      assert.equal((await call('/catalog/courses/'+course.id)).status,404);
      const lesson=await call('/learning/lessons/'+release.lessons[0].id,student);assert.equal(lesson.status,200,JSON.stringify(lesson.body));assert.equal(lesson.body.body,'道可道');
      assert.equal(await db.enrollment.count({where:{courseId:course.id}}),1);
      await assert.rejects(db.course.update({where:{id:course.id},data:{status:'PUBLISHED'}}));
    });
  }finally{
    if(course){await clearCourses(db,[course.id]);await db.course.deleteMany({where:{id:course.id}});}
    if(teacher)await db.teacher.deleteMany({where:{id:teacher.id}});
    await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await app.close();
  }
});
