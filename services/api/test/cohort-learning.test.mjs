import {MediaIngest} from '../dist/media-ingest.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';

if(process.env.NODE_ENV==='production')throw Error('Isolated test database required');
test('cohort registrations and learning remain independent of ordinary courses',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='qa-cohort-'+randomUUID();
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const res=await fetch(base+'/api/v1'+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json()};}
  async function login(){const phone='196'+String(randomInt(0,100000000)).padStart(8,'0'),otp=await call('/auth/sms',null,'POST',{phone}),r=await call('/auth/login',null,'POST',{phone,challengeId:otp.body.challengeId,code:'123456'});assert.equal(r.status,200);return r.body;}
  const future=ms=>new Date(Date.now()+ms),payload=()=>({eventId:randomUUID(),positionSeconds:0,elapsedSeconds:0,completed:true});
  try{
    const password=randomUUID()+'!A',operatorUser=await db.user.create({data:{username:tag,nickname:tag,roles:['ADMIN'],tags:[],passwordHash:await passwordHash(password)}});
    const loginRes=await fetch(base+'/api/v1/admin/auth/login',{method:'POST',headers:{Origin:process.env.CORS_ORIGINS,'Content-Type':'application/json'},body:JSON.stringify({username:tag,password})}),operator={cookie:loginRes.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrfToken:(await loginRes.json()).csrfToken};assert.equal(loginRes.status,200);
    const a=await login(),b=await login(),teacher=await db.teacher.create({data:{name:tag,title:'研习老师',bio:'测试档案',expertise:['经典'],status:'PUBLISHED'}});
    const course=await db.course.create({data:{title:'独立购课与共学',teacherId:teacher.id,subtitle:'营期学习隔离',category:'经典研习',description:'本期研习',cover:'',price:0,tags:[],status:'PUBLISHED'}});
    const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,descriptionSnapshot:course.description,lessons:{create:[{sourceId:randomUUID(),title:'第一讲',position:1,format:'TEXT',body:'研习第一讲',durationSeconds:0,trial:false,required:true},{sourceId:randomUUID(),title:'音频课件',position:2,format:'AUDIO',body:'音频讲义',durationSeconds:60,trial:false,required:false}]}},include:{lessons:true}});
    await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
    const text=release.lessons.find(l=>l.format==='TEXT'),audio=release.lessons.find(l=>l.format==='AUDIO'),ordinary=await db.enrollment.create({data:{userId:a.user.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
    const ordinaryBefore=JSON.stringify(ordinary),normalEvent=payload();
    assert.equal((await call('/learning/lessons/'+text.id+'/progress',a,'POST',normalEvent)).status,201);
    const cohorts=[];
    for(let i=0;i<3;i++){const created=await call('/admin/cohorts',operator,'POST',{courseId:course.id,title:'共学第'+(i+1)+'期',startsAt:future(86400000).toISOString(),endsAt:future(604800000).toISOString(),enrollDeadline:future(80000000).toISOString(),capacity:1});assert.equal(created.status,201,JSON.stringify(created.body));cohorts.push(created.body);assert.equal((await call('/admin/cohorts/'+created.body.id+'/state',operator,'POST',{expectedVersion:1,state:'OPEN',reason:'本期开放'})).status,201);}
    const [first,second,third]=cohorts,query='?cohortId='+first.id;
    await t.test('ordinary access coexists with multiple cohorts and last-seat retries are safe',async()=>{
      const joins=await Promise.all([call('/me/cohorts/'+first.id+'/join',a,'POST'),call('/me/cohorts/'+first.id+'/join',a,'POST')]);assert.ok(joins.every(r=>r.status===201));assert.equal(joins[0].body.id,joins[1].body.id);
      assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:first.id}})).confirmed,1);
      assert.equal((await call('/me/cohorts/'+first.id+'/join',b,'POST')).status,409);
      assert.equal((await call('/me/cohorts/'+second.id+'/join',a,'POST')).status,201);
      assert.equal(JSON.stringify(await db.enrollment.findUniqueOrThrow({where:{id:ordinary.id}})),ordinaryBefore);
      assert.equal((await call('/me/cohorts?page=1&size=1',a)).body.hasMore,true);
    });
    await t.test('cohort context cannot borrow ordinary rights or bypass opening dates',async()=>{
      assert.equal((await call('/learning/lessons/'+text.id,a)).status,200);
      assert.equal((await call('/learning/lessons/'+text.id+query,a)).status,403);
      assert.equal((await call('/learning/lessons/'+audio.id+'/media'+query,a,'POST')).status,403);
      assert.equal((await call('/learning/lessons/'+text.id+query,b)).status,403);
      assert.equal((await call('/learning/courses/'+course.id+'?cohortId=invalid',a)).status,400);
      await db.courseCohort.update({where:{id:first.id},data:{startsAt:future(-60000)}});
      assert.equal((await call('/learning/lessons/'+text.id+query)).status,403);
      const curriculum=(await call('/learning/courses/'+course.id+query,a)).body;assert.equal(curriculum.cohort.id,first.id);assert.equal(curriculum.lessons.find(l=>l.id===text.id).progress,null);
    });
    await t.test('learning events and certificates are scoped to one cohort, without duplicate growth',async()=>{
      assert.equal((await call('/learning/lessons/'+text.id+'/progress'+query,a,'POST',normalEvent)).status,409);
      const event=payload(),done=await call('/learning/lessons/'+text.id+'/progress'+query,a,'POST',event);assert.equal(done.status,201);assert.ok(done.body.completedAt);
      assert.deepEqual((await call('/learning/lessons/'+text.id+'/progress'+query,a,'POST',event)).body,done.body);
      assert.equal((await call('/learning/lessons/'+text.id+'/progress'+query,a,'POST',{...event,completed:false})).status,409);
      assert.equal(await db.growthLedger.count({where:{eventKey:'lesson.complete:'+a.user.id+':'+text.id}}),1);
      const certificate=await call('/learning/courses/'+course.id+'/certificate'+query,a,'POST');assert.equal(certificate.status,201);assert.equal(certificate.body.cohortTitle,first.title);
      const normalCertificate=await call('/learning/courses/'+course.id+'/certificate',a,'POST');assert.equal(normalCertificate.status,201);assert.notEqual(normalCertificate.body.id,certificate.body.id);assert.equal(normalCertificate.body.cohortTitle,undefined);
      const roster=(await call('/admin/cohorts/'+first.id+'/roster',operator)).body;assert.equal(roster.items[0].completedLessons,1);assert.equal(roster.items[0].lessonCount,2);
      await db.courseCohort.update({where:{id:second.id},data:{startsAt:future(-60000)}});
      assert.equal((await call('/learning/lessons/'+text.id+'?cohortId='+second.id,a)).body.progress,null);
      assert.equal((await call('/learning/lessons/'+text.id+'/progress?cohortId='+second.id,a,'POST',event)).status,409);
      assert.equal((await call('/learning/courses/'+course.id+'/certificate?cohortId='+second.id,a,'POST')).status,400);
      const summary=(await call('/learning/summary',a)).body;assert.equal(summary.completedCourses,1);assert.equal(summary.completedLessons,2);
    });
    let ticket;
    await t.test('media credentials bind cohort context and are rechecked when streamed',async()=>{
      const wav=Buffer.alloc(164);wav.write('RIFF');wav.writeUInt32LE(156,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(120,40);
      const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'cohort.wav');
      const uploaded=await fetch(base+'/api/v1/admin/media',{method:'POST',headers:{Origin:process.env.CORS_ORIGINS,Cookie:operator.cookie,'X-CSRF-Token':operator.csrfToken},body:form});assert.equal(uploaded.status,201);const asset=await uploaded.json();await app.get(MediaIngest).runJobs();assert.equal((await db.mediaAsset.findUniqueOrThrow({where:{id:asset.id}})).status,'READY');
      await db.lesson.update({where:{id:audio.id},data:{mediaId:asset.id}});
      ticket=(await call('/learning/lessons/'+audio.id+'/media'+query,a,'POST')).body;
      const decoded=JSON.parse(Buffer.from(new URL(base+ticket.path).searchParams.get('ticket').split('.')[0],'base64url').toString());assert.equal(decoded.cohortId,first.id);
      const streamed=await fetch(base+'/api/v1'+ticket.path,{headers:{Range:'bytes=0-31'}});assert.equal(streamed.status,206);assert.equal((await streamed.arrayBuffer()).byteLength,32);
      assert.equal((await call('/learning/lessons/'+text.id+'/media'+query,a,'POST')).status,404);
    });
    await t.test('expiry blocks cohort content and old media tickets while preserving completion and ordinary access',async()=>{
      await db.courseCohort.update({where:{id:first.id},data:{endsAt:future(-1000)}});
      assert.equal((await call('/learning/lessons/'+text.id+query,a)).status,403);
      assert.equal((await fetch(base+'/api/v1'+ticket.path)).status,403);
      assert.equal((await call('/learning/lessons/'+text.id,a)).status,200);
      assert.equal((await call('/forum/sections?cohortId='+first.id,a)).status,403);
      const details=(await call('/cohorts/'+first.id,a)).body;assert.equal(details.canStudy,false);assert.equal(details.hasCertificate,true);
      assert.equal((await call('/learning/courses/'+course.id+'/certificate'+query,a,'POST')).status,201);
      assert.equal((await call('/learning/courses/'+course.id+'/certificate'+query,b,'POST')).status,403);
    });
    await t.test('cancel and rejoin change only the selected cohort and release its seat once',async()=>{
      assert.equal((await call('/me/cohorts/'+third.id+'/join',a,'POST')).status,201);
      assert.equal((await call('/me/cohorts/'+third.id+'/cancel',a,'POST')).status,201);
      assert.equal((await call('/me/cohorts/'+third.id+'/cancel',a,'POST')).status,201);
      assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:third.id}})).confirmed,0);
      assert.equal((await call('/forum/sections?cohortId='+third.id,a)).status,403);
      assert.equal(JSON.stringify(await db.enrollment.findUniqueOrThrow({where:{id:ordinary.id}})),ordinaryBefore);
      assert.equal((await call('/learning/lessons/'+text.id+'?cohortId='+second.id,a)).status,200);
      assert.equal((await call('/me/cohorts/'+third.id+'/join',b,'POST')).status,201);
      assert.equal((await call('/me/cohorts/'+third.id+'/join',a,'POST')).status,409);
      assert.ok((await call('/me/close-account/status',b)).body.pendingBookings>0);
    });
    await t.test('database constraints reject cross-user progress, mismatched releases and identity replacement',async()=>{
      const registration=await db.cohortRegistration.findUniqueOrThrow({where:{userId_cohortId:{userId:a.user.id,cohortId:first.id}}});
      await assert.rejects(db.cohortStudyProgress.create({data:{registrationId:registration.id,userId:b.user.id,releaseId:release.id,lessonId:audio.id}}));
      const foreign=await db.courseRelease.create({data:{courseId:course.id,version:2,title:'另一版本',descriptionSnapshot:'另一课程版本',lessons:{create:{sourceId:randomUUID(),title:'另版课件',position:1,format:'TEXT',body:'另一版本',durationSeconds:0,trial:false,required:true}}},include:{lessons:true}});
      await assert.rejects(db.cohortStudyProgress.create({data:{registrationId:registration.id,userId:a.user.id,releaseId:release.id,lessonId:foreign.lessons[0].id}}));
      assert.equal((await call('/learning/lessons/'+foreign.lessons[0].id+'?cohortId='+second.id,a)).status,403);
      await assert.rejects(db.cohortRegistration.update({where:{id:registration.id},data:{cohortId:third.id}}));
      await assert.rejects(db.enrollment.update({where:{id:ordinary.id},data:{cohortId:third.id}}));
    });
    await t.test('legacy conversion preserves registration, progress, certificate and event facts transactionally',async()=>{
      const pool=new Pool({connectionString:process.env.DATABASE_URL}),client=await pool.connect(),legacyUser=randomUUID(),legacyId=randomUUID(),progressId=randomUUID(),certificateId=randomUUID(),eventId=randomUUID();
      try{
        await client.query('BEGIN');await client.query('ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_ordinary_context"');
        await client.query('INSERT INTO "User" (id,nickname,roles,tags,"updatedAt") VALUES ($1,$2,\'{USER}\',\'{}\',now())',[legacyUser,'旧营期学员']);
        await client.query('INSERT INTO "Enrollment" (id,"userId","courseId","releaseId",source,"cohortId","startsAt","expiresAt") VALUES ($1,$2,$3,$4,\'COHORT_FREE\',$5,now()-interval \'2 day\',now()+interval \'2 day\')',[legacyId,legacyUser,course.id,release.id,third.id]);
        await client.query('INSERT INTO "StudyProgress" (id,"userId","lessonId","completedAt","updatedAt") VALUES ($1,$2,$3,now(),now())',[progressId,legacyUser,text.id]);
        await client.query('INSERT INTO "CourseCertificate" (id,"userId","courseId","releaseId","courseTitle","lessonCount","completedAt") VALUES ($1,$2,$3,$4,$5,1,now())',[certificateId,legacyUser,course.id,release.id,course.title]);
        await client.query('INSERT INTO "StudyEvent" (id,"userId","lessonId","payloadHash",result) VALUES ($1,$2,$3,\'historical-hash\',\'{"completed":true}\')',[eventId,legacyUser,text.id]);
        const sql=await readFile(new URL('../prisma/migrations/20261012120000_cohort_learning_context/migration.sql',import.meta.url),'utf8');
        await client.query(sql.split('-- BEGIN LEGACY CONVERSION')[1].split('-- END LEGACY CONVERSION')[0]);
        const registration=(await client.query('SELECT * FROM "CohortRegistration" WHERE id=$1',[legacyId])).rows[0];assert.equal(registration.legacyEnrollmentSnapshot.id,legacyId);assert.equal(registration.cohortId,third.id);
        assert.equal((await client.query('SELECT id FROM "CohortStudyProgress" WHERE "registrationId"=$1',[legacyId])).rows[0].id,progressId);
        assert.equal((await client.query('SELECT id FROM "CohortCertificate" WHERE "registrationId"=$1',[legacyId])).rows[0].id,certificateId);
        const event=(await client.query('SELECT * FROM "StudyEvent" WHERE id=$1',[eventId])).rows[0];assert.equal(event.cohortRegistrationId,legacyId);assert.equal(event.payloadHash,'historical-hash');
        assert.equal((await client.query('SELECT id FROM "Enrollment" WHERE id=$1',[legacyId])).rowCount,0);
        assert.equal((await client.query('SELECT id FROM "StudyProgress" WHERE "userId"=$1',[legacyUser])).rowCount,0);
        assert.equal((await client.query('SELECT id FROM "Enrollment" WHERE id=$1',[ordinary.id])).rowCount,1);
      }finally{await client.query('ROLLBACK');client.release();await pool.end();}
    });
  }finally{await app.close();await db.$disconnect();}
});
