import {MediaIngest} from '../dist/media-ingest.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {LearningService} from '../dist/learning.js';
import {passwordHash} from '../dist/auth.js';
import {rolePermissions} from '../dist/admin-permissions.js';

if(process.env.NODE_ENV==='production')throw Error('Isolated test database required');
test('cohort chapter schedule freezes before enrolment and gates every learning entry',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='qa-schedule-'+randomUUID(),day=86400000;
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/v1',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const res=await fetch(base+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json()};}
  async function staff(role){const password=randomUUID()+'!A',user=await db.user.create({data:{username:tag+role,nickname:tag,roles:[role],passwordHash:await passwordHash(password)}});const res=await fetch(base+'/admin/auth/login',{method:'POST',headers:{Origin:process.env.CORS_ORIGINS,'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password})});assert.equal(res.status,200);return {cookie:res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrfToken:(await res.json()).csrfToken};}
  const future=ms=>new Date(Date.now()+ms).toISOString(),progress=()=>({eventId:randomUUID(),positionSeconds:0,elapsedSeconds:0,completed:true});
  try{
    const operator=await staff('ADMIN');
    await db.accessRole.upsert({where:{code:'MODERATOR'},create:{code:'MODERATOR',name:'审核',active:true,permissionCodes:rolePermissions.MODERATOR},update:{}});
    const moderator=await staff('MODERATOR'),phone='196'+String(randomInt(0,100000000)).padStart(8,'0'),otp=await call('/auth/sms',null,'POST',{phone}),login=await call('/auth/login',null,'POST',{phone,challengeId:otp.body.challengeId,code:'123456'});assert.equal(login.status,200);const learner=login.body;
    const teacher=await db.teacher.create({data:{name:tag,title:'经典研习',bio:tag,expertise:[],status:'PUBLISHED'}}),course=await db.course.create({data:{teacherId:teacher.id,title:tag,subtitle:'章节排程',category:'经典',description:'分日共学',cover:'',price:0,tags:[],status:'PUBLISHED'}});
    const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,descriptionSnapshot:course.description,lessons:{create:[{sourceId:randomUUID(),title:'开营导读',position:1,format:'TEXT',body:'第1天正文',durationSeconds:0,trial:false,required:true},{sourceId:randomUUID(),title:'次日研习',position:2,format:'TEXT',body:'第2天正文',durationSeconds:0,trial:true,required:true},{sourceId:randomUUID(),title:'次日音频',position:3,format:'AUDIO',body:'音频讲义',durationSeconds:60,trial:false,required:false}]}},include:{lessons:true}});
    const [first,second,audio]=release.lessons.sort((a,b)=>a.position-b.position);
    await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
    const ordinary=await db.enrollment.create({data:{userId:learner.user.id,courseId:course.id,releaseId:release.id,source:'FREE'}}),ordinarySnapshot=JSON.stringify(ordinary);
    const created=await call('/admin/cohorts',operator,'POST',{courseId:course.id,title:'分日共学营',startsAt:future(day),endsAt:future(5*day),enrollDeadline:future(day-60000),capacity:10});assert.equal(created.status,201);const cohort=created.body,path='/admin/cohorts/'+cohort.id+'/schedule',query='?cohortId='+cohort.id;
    const lessons=days=>release.lessons.map((l,i)=>({lessonId:l.id,opensOnDay:days[i]})),save=(days,expectedVersion=1)=>call(path,operator,'POST',{expectedVersion,lessons:lessons(days),reason:'安排研习节奏'});
    await t.test('defaults preserve opening-day delivery and read-only staff cannot edit',async()=>{
      const current=await call(path,moderator);assert.equal(current.status,200);assert.equal(current.body.editable,true);assert.deepEqual(current.body.lessons.map(l=>l.opensOnDay),[1,1,1]);
      assert.equal((await call(path,moderator,'POST',{expectedVersion:1,lessons:lessons([1,2,2]),reason:'无写权限'})).status,403);
      assert.equal((await call(path,learner)).status,403);
      assert.equal((await call('/cohorts/'+cohort.id,learner)).status,404);
    });
    await t.test('invalid, missing, duplicate, out-of-period and decreasing days never mutate a draft',async()=>{
      for(const days of [[0,2,2],[1,2.5,3],[1,3,2],[1,5,5]])assert.equal((await save(days)).status,400);
      for(const entries of [lessons([1,2,2]).slice(0,2),[...lessons([1,2,2]).slice(0,2),{lessonId:second.id,opensOnDay:2}],[...lessons([1,2,2]).slice(0,2),{lessonId:randomUUID(),opensOnDay:2}]])assert.equal((await call(path,operator,'POST',{expectedVersion:1,lessons:entries,reason:'不完整安排'})).status,400);
      assert.equal((await call(path,operator,'POST',{expectedVersion:1,lessons:lessons([1,2,2]),reason:'  '})).status,400);
      assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:cohort.id}})).version,1);
      assert.equal(await db.auditLog.count({where:{action:'cohort.schedule',resourceId:course.id}}),0);
    });
    await t.test('concurrent saves serialize and save every chapter with one audited revision',async()=>{
      const results=await Promise.all([save([1,2,2]),save([1,2,2])]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      const current=(await call(path,operator)).body;assert.equal(current.cohort.version,2);assert.deepEqual(current.lessons.map(l=>l.opensOnDay),[1,2,2]);assert.equal(new Date(current.lessons[1].opensAt)-new Date(current.cohort.startsAt),day);
      const audit=await db.auditLog.findFirstOrThrow({where:{action:'cohort.schedule',resourceId:course.id}});assert.equal(audit.changes.before[1].opensOnDay,1);assert.equal(audit.changes.after[1].opensOnDay,2);
    });
    await t.test('opening, closing and reopening cannot unfreeze the advertised schedule',async()=>{
      assert.equal((await call('/admin/cohorts/'+cohort.id+'/state',operator,'POST',{expectedVersion:2,state:'OPEN',reason:'开放本期'})).status,201);
      const advertised=(await call('/cohorts/'+cohort.id,learner)).body;assert.equal(advertised.lessonSchedule[1].opensOnDay,2);assert.equal(advertised.lessonSchedule[1].body,undefined);
      assert.equal((await save([1,3,3],3)).status,409);
      assert.equal((await call('/admin/cohorts/'+cohort.id+'/state',operator,'POST',{expectedVersion:3,state:'CLOSED',reason:'暂停报名'})).status,201);
      assert.equal((await save([1,3,3],4)).status,409);
      await assert.rejects(db.courseCohort.update({where:{id:cohort.id},data:{state:'DRAFT',scheduleFrozenAt:null}}));
      await assert.rejects(db.cohortLessonSchedule.update({where:{cohortId_lessonId:{cohortId:cohort.id,lessonId:second.id}},data:{opensOnDay:3}}));
      await assert.rejects(db.cohortLessonSchedule.deleteMany({where:{cohortId:cohort.id}}));
      assert.equal((await call('/admin/cohorts/'+cohort.id+'/state',operator,'POST',{expectedVersion:4,state:'OPEN',reason:'继续报名'})).status,201);
      assert.equal((await call('/me/cohorts/'+cohort.id+'/join',learner,'POST')).status,201);
    });
    await t.test('unopened chapters reject text, media, paid-access marking and study events despite trial or ordinary rights',async()=>{
      await db.courseCohort.update({where:{id:cohort.id},data:{startsAt:new Date(Date.now()-60000)}});
      const curriculum=(await call('/learning/courses/'+course.id+query,learner)).body;assert.deepEqual(curriculum.lessons.map(l=>l.accessible),[true,false,false]);assert.match(curriculum.lessons[1].lockedReason,/北京时间/);assert.equal(curriculum.lessons[1].body,undefined);
      const denied=await call('/learning/lessons/'+second.id+query,learner);assert.equal(denied.status,403);assert.match(denied.body.message,/北京时间/);
      assert.equal((await call('/learning/lessons/'+audio.id+'/media'+query,learner,'POST')).status,403);
      const event=progress();assert.equal((await call('/learning/lessons/'+second.id+'/progress'+query,learner,'POST',event)).status,403);assert.equal(await db.studyEvent.count({where:{id:event.eventId}}),0);
      await assert.rejects(app.get(LearningService).markPaidAccess(second.id,learner.user.id,cohort.id),/北京时间/);
      assert.equal((await call('/learning/lessons/'+second.id,learner)).status,200);
      assert.equal((await call('/learning/lessons/'+second.id+'/progress',learner,'POST',progress())).status,201);
      assert.equal((await call('/learning/lessons/'+first.id+'/progress'+query,learner,'POST',progress())).status,201);
      assert.equal((await call('/learning/courses/'+course.id+'/certificate'+query,learner,'POST')).status,400);
    });
    let ticket;
    await t.test('opening time enables the chapter and keeps its progress separate',async()=>{
      await db.courseCohort.update({where:{id:cohort.id},data:{startsAt:new Date(Date.now()-day)}});
      assert.ok((await call('/learning/courses/'+course.id+query,learner)).body.lessons.every(l=>l.accessible));
      const opened=await call('/learning/lessons/'+second.id+query,learner);assert.equal(opened.status,200);assert.equal(opened.body.progress,null);assert.equal(opened.body.body,'第2天正文');
      assert.equal((await call('/learning/lessons/'+second.id+'/progress'+query,learner,'POST',progress())).status,201);
      assert.equal((await call('/learning/courses/'+course.id+'/certificate'+query,learner,'POST')).status,201);
      assert.equal(JSON.stringify(await db.enrollment.findUniqueOrThrow({where:{id:ordinary.id}})),ordinarySnapshot);
      const wav=Buffer.alloc(164);wav.write('RIFF');wav.writeUInt32LE(156,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(120,40);
      const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'schedule.wav');const uploaded=await fetch(base+'/admin/media',{method:'POST',headers:{Origin:process.env.CORS_ORIGINS,Cookie:operator.cookie,'X-CSRF-Token':operator.csrfToken},body:form});assert.equal(uploaded.status,201);const asset=await uploaded.json();await app.get(MediaIngest).runJobs();assert.equal((await db.mediaAsset.findUniqueOrThrow({where:{id:asset.id}})).status,'READY');await db.lesson.update({where:{id:audio.id},data:{mediaId:asset.id}});
      ticket=(await call('/learning/lessons/'+audio.id+'/media'+query,learner,'POST')).body;assert.equal((await fetch(base+ticket.path,{headers:{Range:'bytes=0-31'}})).status,206);
    });
    await t.test('previously issued media credentials recheck the chapter opening time',async()=>{
      // Move the fixture clock back to day 1; production has no arbitrary date-edit route.
      await db.courseCohort.update({where:{id:cohort.id},data:{startsAt:new Date(Date.now()-60000)}});
      assert.equal((await fetch(base+ticket.path)).status,403);
      assert.equal((await call('/learning/lessons/'+audio.id+'/media'+query,learner,'POST')).status,403);
      const count=await db.cohortStudyProgress.count({where:{lessonId:audio.id}});assert.equal((await call('/learning/lessons/'+audio.id+'/progress'+query,learner,'POST',progress())).status,403);assert.equal(await db.cohortStudyProgress.count({where:{lessonId:audio.id}}),count);
    });
    await t.test('concurrent opening and schedule edit cannot publish one arrangement while saving another',async()=>{
      const draft=(await call('/admin/cohorts',operator,'POST',{courseId:course.id,title:'并发发布营期',startsAt:future(day),endsAt:future(5*day),enrollDeadline:future(day-60000),capacity:10})).body;
      const results=await Promise.all([call('/admin/cohorts/'+draft.id+'/schedule',operator,'POST',{expectedVersion:1,lessons:lessons([1,3,3]),reason:'分日安排'}),call('/admin/cohorts/'+draft.id+'/state',operator,'POST',{expectedVersion:1,state:'OPEN',reason:'开放报名'})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      const current=(await call('/admin/cohorts/'+draft.id+'/schedule',operator)).body;
      assert.equal(current.cohort.version,2);assert.deepEqual(current.lessons.map(l=>l.opensOnDay),current.editable?[1,3,3]:[1,1,1]);
    });
    await t.test('foreign versions, missing schedules and direct out-of-range updates fail closed',async()=>{
      const startsAt=new Date(Date.now()+day);
      const draft=(await call('/admin/cohorts',operator,'POST',{courseId:course.id,title:'数据约束营期',startsAt:startsAt.toISOString(),endsAt:new Date(+startsAt+2*day).toISOString(),enrollDeadline:new Date(+startsAt-60000).toISOString(),capacity:10})).body;
      const foreign=await db.courseRelease.create({data:{courseId:course.id,version:2,title:'另版',descriptionSnapshot:'固定版本',lessons:{create:{sourceId:randomUUID(),title:'另版课件',position:1,format:'TEXT',body:'另版',durationSeconds:0,trial:false,required:true}}},include:{lessons:true}});
      assert.equal((await call('/admin/cohorts/'+draft.id+'/schedule',operator,'POST',{expectedVersion:1,lessons:[{lessonId:first.id,opensOnDay:1},{lessonId:second.id,opensOnDay:2},{lessonId:foreign.lessons[0].id,opensOnDay:2}],reason:'跨版本'})).status,400);
      await assert.rejects(db.cohortLessonSchedule.create({data:{cohortId:draft.id,courseId:course.id,releaseId:release.id,lessonId:foreign.lessons[0].id}}));
      await assert.rejects(db.cohortLessonSchedule.update({where:{cohortId_lessonId:{cohortId:draft.id,lessonId:first.id}},data:{opensOnDay:3}}));
      await db.cohortLessonSchedule.delete({where:{cohortId_lessonId:{cohortId:draft.id,lessonId:audio.id}}});
      assert.equal((await call('/admin/cohorts/'+draft.id+'/state',operator,'POST',{expectedVersion:1,state:'OPEN',reason:'缺章安排'})).status,400);
    });
    await t.test('the migration backfills historical open cohorts at day 1 without changing ordinary grants',async()=>{
      const pool=new Pool({connectionString:process.env.DATABASE_URL}),client=await pool.connect(),legacyId=randomUUID();
      try{
        await client.query('BEGIN');
        await client.query('ALTER TABLE "CourseCohort" DISABLE TRIGGER "CourseCohort_schedule_initialize"');
        await client.query('ALTER TABLE "CohortLessonSchedule" DISABLE TRIGGER "CohortLessonSchedule_protect"');
        await client.query('INSERT INTO "CourseCohort" (id,"courseId","releaseId",title,"startsAt","endsAt","enrollDeadline",capacity,state) VALUES ($1,$2,$3,\'历史营期\',now()-interval \'1 day\',now()+interval \'2 day\',now()-interval \'2 day\',10,\'OPEN\')',[legacyId,course.id,release.id]);
        const sql=await readFile(new URL('../prisma/migrations/20261012140000_cohort_lesson_schedule/migration.sql',import.meta.url),'utf8');await client.query(sql.split('-- BEGIN LEGACY SCHEDULE')[1].split('-- END LEGACY SCHEDULE')[0]);
        const schedule=(await client.query('SELECT * FROM "CohortLessonSchedule" WHERE "cohortId"=$1',[legacyId])).rows;assert.equal(schedule.length,3);assert.ok(schedule.every(l=>l.opensOnDay===1&&l.releaseId===release.id));
        assert.ok((await client.query('SELECT "scheduleFrozenAt" FROM "CourseCohort" WHERE id=$1',[legacyId])).rows[0].scheduleFrozenAt);
        assert.equal(JSON.stringify(await db.enrollment.findUniqueOrThrow({where:{id:ordinary.id}})),ordinarySnapshot);
      }finally{await client.query('ROLLBACK');client.release();await pool.end();}
    });
  }finally{await app.close();await db.$disconnect();}
});
