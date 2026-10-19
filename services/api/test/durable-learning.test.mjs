import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {clearCourses} from './fixture-cleanup.mjs';

if(process.env.NODE_ENV==='production')throw Error('Isolated test database required');
test('persistent sessions and rapid durable learning batches use actual HTTP and PostgreSQL',async t=>{
  const db=new Database(),app=await createApp(false),users=[],courses=[];let teacher;
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),auth=app.get(AuthService);
  async function account(){const user=await db.user.create({data:{nickname:'持久学习专项',roles:['USER'],tags:[]}});users.push(user.id);const c=auth.credentials();await db.authSession.create({data:{userId:user.id,kind:'APP',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+30*86400000),csrfToken:randomUUID()}});return {user,accessToken:c.access,refreshToken:c.refresh};}
  async function call(path,a,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(a?{Authorization:'Bearer '+a.accessToken}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
  try{
    await t.test('lost refresh response can be replayed after restart, while mismatched replay revokes',async()=>{
      const a=await account(),input={refreshToken:a.refreshToken,rotationId:randomUUID()};
      const responses=await Promise.all([call('/auth/refresh',null,'POST',input),call('/auth/refresh',null,'POST',input)]);
      assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.deepEqual(responses[0].body,responses[1].body);
      const refreshed=responses[0].body;assert.equal((await call('/auth/me',refreshed)).status,200);
      assert.equal((await call('/auth/me',a)).status,401);
      const stored=await db.consumedRefresh.findFirstOrThrow({where:{session:{userId:a.user.id}}});assert.ok(stored.resultCipher.startsWith('v1:'));assert.ok(!stored.resultCipher.includes(refreshed.refreshToken));
      assert.equal((await call('/auth/refresh',null,'POST',{...input,rotationId:randomUUID()})).status,401);
      assert.equal((await call('/auth/me',refreshed)).status,401);
    });
    await t.test('revoked and expired sessions cannot restore; old clients still rotate once',async()=>{
      for(const state of ['revoked','expired']){const a=await account();await db.authSession.updateMany({where:{userId:a.user.id},data:state==='revoked'?{revokedAt:new Date()}:{createdAt:new Date(Date.now()-86400000),accessExpiresAt:new Date(Date.now()-2000),expiresAt:new Date(Date.now()-1000)}});assert.equal((await call('/auth/refresh',null,'POST',{refreshToken:a.refreshToken,rotationId:randomUUID()})).status,401);}
      const a=await account(),input={refreshToken:a.refreshToken};const first=await call('/auth/refresh',null,'POST',input);assert.equal(first.status,200);assert.equal((await call('/auth/refresh',null,'POST',input)).status,401);
    });
    await t.test('rotation near absolute expiry never extends the session or violates expiry constraints',async()=>{
      const a=await account(),expiresAt=new Date(Date.now()+5000);
      await db.authSession.updateMany({where:{userId:a.user.id},data:{expiresAt,accessExpiresAt:new Date(Date.now()-1000)}});
      assert.equal((await call('/auth/refresh',null,'POST',{refreshToken:a.refreshToken,rotationId:randomUUID()})).status,200);
      const saved=await db.authSession.findFirstOrThrow({where:{userId:a.user.id}});assert.equal(saved.expiresAt.toISOString(),expiresAt.toISOString());assert.ok(saved.accessExpiresAt<expiresAt);
    });
    const a=await account(),b=await account();
    teacher=await db.teacher.create({data:{name:'持久学习专项',title:'测试',bio:'测试',expertise:[],status:'PUBLISHED'}});
    const course=await db.course.create({data:{title:'持久学习专项',teacherId:teacher.id,subtitle:'测试',description:'测试',category:'经典',cover:'',price:0,status:'PUBLISHED'}});courses.push(course.id);
    const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,lessons:{create:{sourceId:randomUUID(),title:'音频',position:1,format:'AUDIO',body:'测试',durationSeconds:300,trial:false,required:true}}},include:{lessons:true}});
    await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
    await db.enrollment.create({data:{userId:a.user.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
    const lesson=release.lessons[0],path='/learning/lessons/'+lesson.id+'/progress',start=Date.now()-120000;
    const event=(seconds,elapsedSeconds=15)=>({eventId:randomUUID(),releaseId:release.id,positionSeconds:seconds,elapsedSeconds,completed:false,recordedAt:new Date(start+seconds*1000).toISOString()});
    await t.test('queued intervals credit actual observed time despite arriving together; replay is exact',async()=>{
      assert.equal((await call(path,a,'POST',event(0,0))).status,201);
      const one=event(15),two=event(30),three=event(45);
      assert.equal((await call(path,a,'POST',one)).body.watchedSeconds,15);
      assert.equal((await call(path,a,'POST',two)).body.watchedSeconds,30);
      const result=await call(path,a,'POST',three);assert.equal(result.status,201);assert.equal(result.body.watchedSeconds,45);
      assert.deepEqual((await call(path,a,'POST',three)).body,result.body);
      assert.equal((await call(path,a,'POST',{...three,elapsedSeconds:1})).status,409);
      const stale=await call(path,a,'POST',event(20));assert.equal(stale.body.watchedSeconds,45);assert.equal(stale.body.positionSeconds,45);
      const seek=await call(path,a,'POST',{...event(60),positionSeconds:5});assert.equal(seek.body.positionSeconds,5);assert.equal(seek.body.watchedSeconds,60);
    });
    await t.test('timestamps, version, actor and current entitlement are revalidated',async()=>{
      assert.equal((await call(path,a,'POST',{...event(60),recordedAt:new Date(Date.now()+120000).toISOString()})).status,400);
      assert.equal((await call(path,a,'POST',{...event(60),recordedAt:'garbage'})).status,400);
      assert.equal((await call(path,a,'POST',{...event(60),releaseId:randomUUID()})).status,409);
      assert.equal((await call(path,b,'POST',event(60))).status,403);
      await db.enrollment.updateMany({where:{userId:a.user.id,courseId:course.id},data:{startsAt:new Date(Date.now()-86400000),expiresAt:new Date(Date.now()-1000)}});
      const input=event(75);assert.equal((await call(path,a,'POST',input)).status,403);assert.equal(await db.studyEvent.count({where:{id:input.eventId}}),0);
    });
  }finally{
    await app.close();await clearCourses(db,courses);await db.course.deleteMany({where:{id:{in:courses}}});if(teacher)await db.teacher.delete({where:{id:teacher.id}});
    await db.authSession.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
  }
});
