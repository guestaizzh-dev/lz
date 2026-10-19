import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {ZegoService} from '../dist/zego.js';

test('live course delivery: assigned host, purchased version, watch progress, replay and cancellation',async t=>{
  const previous={...process.env};Object.assign(process.env,{ZEGO_APP_ID:'123',ZEGO_SERVER_SECRET:'12345678901234567890123456789012',ZEGO_CALLBACK_SECRET:'test-callback',ZEGO_RTC_SERVER:'wss://test.zego.im/ws',ZEGO_RTC_ENABLED:'true',ZEGO_ROOM_TOKEN_AUTH_ENABLED:'false',ZEGO_ALLOW_UNVERIFIED_TOKEN_AUTH:'true',CORS_ORIGINS:'http://127.0.0.1:5173'});
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService),zego=app.get(ZegoService);
  zego.kick=async()=>({Code:0});zego.request=async()=>({Code:0});
  async function actor(role,kind='ADMIN'){
    const user=await db.user.create({data:{nickname:randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});
    return{id:user.id,...(kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken})};
  }
  async function call(path,actor,method='GET',data){const headers={Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...(actor??{})};delete headers.id;const response=await fetch(base+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,body:await response.json()};}
  let root,speaker,a,b,teacher,course,published,session,room,lesson,lease;
  async function post(path,data,actor=root){const response=await call(path,actor,'POST',data);assert.equal(response.status,201,JSON.stringify(response.body));return response.body;}
  const chapter={title:'不争之道 · 直播讲授',format:'LIVE',body:'研习提示',mediaId:null,durationSeconds:60,trial:false,required:true};
  let draft;
  try{
    root=await actor('ADMIN');speaker=await actor('TEACHER');a=await actor('USER','APP');b=await actor('USER','APP');
    teacher=await db.teacher.create({data:{userId:speaker.id,name:'直播研习讲师',title:'道学研习',bio:'隔离测试',expertise:['道德经'],status:'PUBLISHED'}});
    draft={title:'道德经 · 直播研习',subtitle:'固定场次与审核回放',description:'版次保留交付安排',category:'经典研习',format:'LIVE',cover:'/static/art/books.svg',price:100,teacherId:teacher.id,membershipTier:null,accessDays:null,refundPolicy:'取消必修场次可申请停止交付补偿',featured:false,tags:[],chapters:[chapter]};
    await t.test('accepted provider limitation enables RTC without claiming verification or leaking secrets',()=>{
      assert.equal(zego.ready(),true);assert.equal(process.env.ZEGO_ROOM_TOKEN_AUTH_ENABLED,'false');assert.ok(zego.token(a.id,randomUUID(),false).token);
      process.env.ZEGO_ALLOW_UNVERIFIED_TOKEN_AUTH='false';assert.equal(zego.ready(),false);assert.throws(()=>zego.token(a.id,randomUUID(),false));process.env.ZEGO_ALLOW_UNVERIFIED_TOKEN_AUTH='true';
    });
    await t.test('unbound drafts can be saved; publication, trial and short expiry are blocked',async()=>{
      course=await post('/admin/courses',draft);
      assert.equal((await call('/admin/courses/'+course.id+'/transition',root,'POST',{action:'submit',expectedVersion:1,reason:'未绑定'})).status,400);
      assert.equal((await call('/admin/courses',root,'POST',{...draft,accessDays:1})).status,400);
      assert.equal((await call('/admin/courses',root,'POST',{...draft,chapters:[{...chapter,trial:true}]})).status,400);
      room=await post('/admin/live',{title:draft.title,summary:'课程专属研习',teacherId:teacher.id,categoryCode:'CULTURE',accessMode:'COURSE',courseId:course.id});
      await post('/admin/live-discovery/'+room.id+'/publication',{title:draft.title,summary:'课程专属研习',state:'PUBLISHED',expectedVersion:1,reason:'展示审核'});
      session=await post('/admin/live/rooms/'+room.id+'/sessions',{title:'本期不争之道',hostUserId:speaker.id,scheduledAt:new Date(Date.now()+300000).toISOString()});assert.equal(session.accessRuleSnapshot.lessonBound,true);
    });
    await t.test('released lesson freezes a valid course session and produces a schedule quote',async()=>{
      const other=await db.teacher.create({data:{name:'另一名师',title:'测试',bio:'隔离测试',status:'PUBLISHED'}});
      assert.equal((await call('/admin/courses/'+course.id,root,'PATCH',{...draft,teacherId:other.id,expectedVersion:1,chapters:[{...chapter,liveSessionId:session.id}]})).status,400);
      const edited=await call('/admin/courses/'+course.id,root,'PATCH',{...draft,expectedVersion:1,chapters:[{...chapter,liveSessionId:session.id}]});assert.equal(edited.status,200,JSON.stringify(edited.body));course=edited.body;
      course=await post('/admin/courses/'+course.id+'/transition',{action:'submit',expectedVersion:course.version,reason:'绑定完成'});published=await post('/admin/courses/'+course.id+'/transition',{action:'publish',expectedVersion:course.version,reason:'安排审核'});
      lesson=await db.lesson.findFirstOrThrow({where:{releaseId:published.publishedReleaseId,format:'LIVE'}});assert.equal(lesson.liveSessionId,session.id);
      assert.equal((await call('/commerce/courses/'+published.id+'/quote?platform=WEB',a)).body.liveSessions[0].id,session.id);
      await assert.rejects(()=>db.lesson.update({where:{id:lesson.id},data:{liveSessionId:null}}),/immutable/);
      const startsAt=new Date(Date.now()+86400000),endsAt=new Date(Date.now()+2*86400000);assert.equal((await call('/admin/cohorts',root,'POST',{courseId:published.id,title:'不可重复包装的直播营期',startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),enrollDeadline:new Date(Date.now()+3600000).toISOString(),capacity:10})).status,400);
      assert.equal((await call('/live/lessons/'+lesson.id,b)).status,403);await post('/admin/courses/'+published.id+'/grant',{userId:a.id,reason:'隔离测试购课权限'},root);
      assert.equal((await call('/live/lessons/'+lesson.id,a)).body.id,session.id);
      assert.equal((await call('/learning/lessons/'+lesson.id+'/progress',a,'POST',{eventId:randomUUID(),positionSeconds:60,elapsedSeconds:30,completed:true})).status,409);
    });
    await t.test('teacher can prepare and host only assigned sessions, with no all-room or cancellation privileges',async()=>{
      assert.equal((await call('/admin/live',speaker)).status,403);assert.equal((await call('/admin/live-host',speaker)).body[0].id,session.id);
      assert.equal((await call('/admin/live-host/'+session.id+'/state',speaker,'POST',{action:'CANCEL',expectedVersion:1,reason:'取消'})).status,403);
      const other=await post('/admin/live/rooms/'+room.id+'/sessions',{title:'别人的安排',hostUserId:root.id,scheduledAt:new Date(Date.now()+300000).toISOString()});
      assert.equal((await call('/admin/live-host/'+other.id+'/host',speaker,'POST',{})).status,403);
      session=await post('/admin/live-host/'+session.id+'/state',{action:'PREPARE',expectedVersion:session.version,reason:'准备授课'},speaker);
      const host=await post('/admin/live-host/'+session.id+'/host',{},speaker);assert.equal((await post('/live/rtc/refresh',{key:host.key},null)).role,'HOST');
      const policy=await db.accessRole.findUniqueOrThrow({where:{code:'TEACHER'}});await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes.filter(p=>p!=='teaching.write')}});assert.equal((await call('/live/rtc/refresh',null,'POST',{key:host.key})).status,403);await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes}});
      // Provider transmission is exercised separately; this fixture isolates the business state.
      session=await db.liveSession.update({where:{id:session.id},data:{state:'LIVE',startedAt:new Date(),version:{increment:1}}});
      assert.equal((await call('/live/sessions/'+session.id+'/join',b,'POST',{})).status,403);lease=await post('/live/sessions/'+session.id+'/join',{},a);
    });
    await t.test('playing heartbeat records wall time; idle/rapid requests cannot fabricate completion and revocation stops access',async()=>{
      await post('/live/rtc/refresh',{key:lease.key,watching:false},null);assert.equal(await db.studyProgress.count({where:{userId:a.id,lessonId:lesson.id}}),0);
      await post('/live/rtc/refresh',{key:lease.key,watching:true},null);let p=await db.studyProgress.findUniqueOrThrow({where:{userId_lessonId:{userId:a.id,lessonId:lesson.id}}});assert.equal(p.watchedSeconds,0);
      await db.studyProgress.update({where:{id:p.id},data:{updatedAt:new Date(Date.now()-30000)}});await post('/live/rtc/refresh',{key:lease.key,watching:true},null);
      p=await db.studyProgress.findUniqueOrThrow({where:{id:p.id}});assert.equal(p.watchedSeconds,30);assert.equal(p.completedAt,null);
      await post('/live/rtc/refresh',{key:lease.key,watching:true},null);assert.equal((await db.studyProgress.findUniqueOrThrow({where:{id:p.id}})).watchedSeconds,30);
      await db.enrollment.update({where:{userId_courseId:{userId:a.id,courseId:published.id}},data:{revokedAt:new Date()}});assert.equal((await call('/live/rtc/refresh',null,'POST',{key:lease.key})).status,403);
      await db.enrollment.update({where:{userId_courseId:{userId:a.id,courseId:published.id}},data:{revokedAt:null}});
    });
    await t.test('end invalidates leases; pending replay is private and actual replay duration determines completion',async()=>{
      session=await post('/admin/live-host/'+session.id+'/state',{action:'END',expectedVersion:session.version,reason:'完成授课'},speaker);assert.equal((await call('/live/rtc/refresh',null,'POST',{key:lease.key})).status,401);
      const data=Buffer.from('00000018667479706d7034320000000069736f6d6d703432','hex'),storageKey=randomUUID();await writeFile(resolve(process.env.MEDIA_DIR,storageKey),data);
      const media=await db.mediaAsset.create({data:{storageKey,name:'完整研习回放',mime:'video/mp4',bytes:data.length,uploaderId:root.id,status:'READY',visibility:'PRIVATE'}});
      assert.equal((await call('/admin/live/sessions/'+session.id+'/replay',root,'POST',{assetId:media.id,expectedVersion:session.version,reason:'遗漏实际时长'})).status,400);
      const replay=await post('/admin/live/sessions/'+session.id+'/replay',{assetId:media.id,durationSeconds:20,expectedVersion:session.version,reason:'上传回放'});
      assert.equal((await call('/live/sessions/'+session.id+'/replay-ticket',a,'POST',{})).status,404);
      await post('/admin/live/sessions/'+session.id+'/replay/review',{state:'APPROVED',expectedVersion:replay.version,reason:'审核通过'});
      assert.equal((await call('/live/lessons/'+lesson.id,a)).body.replayReady,true);const ticket=await post('/live/sessions/'+session.id+'/replay-ticket',{},a);assert.equal((await fetch(base+ticket.path,{headers:{Range:'bytes=0-7'}})).status,206);
      await db.studyProgress.update({where:{userId_lessonId:{userId:a.id,lessonId:lesson.id}},data:{watchedSeconds:17,updatedAt:new Date(Date.now()-1000)}});
      const p=await post('/learning/lessons/'+lesson.id+'/progress',{eventId:randomUUID(),positionSeconds:18,elapsedSeconds:1,completed:false},a);assert.ok(p.completedAt);
    });
    await t.test('new versions do not grant old students later sessions; cancellation withdraws only affected release',async()=>{
      course=await post('/admin/courses/'+published.id+'/transition',{action:'archive',expectedVersion:published.version,reason:'新版'});course=await post('/admin/courses/'+published.id+'/transition',{action:'revise',expectedVersion:course.version,reason:'新期'});
      const next=await post('/admin/live/rooms/'+room.id+'/sessions',{title:'新一期研习',hostUserId:speaker.id,scheduledAt:new Date(Date.now()+86400000).toISOString()});
      const edited=await call('/admin/courses/'+published.id,root,'PATCH',{...draft,expectedVersion:course.version,chapters:[{...chapter,liveSessionId:next.id}]});assert.equal(edited.status,200);course=edited.body;
      course=await post('/admin/courses/'+course.id+'/transition',{action:'submit',expectedVersion:course.version,reason:'新期提交'});course=await post('/admin/courses/'+course.id+'/transition',{action:'publish',expectedVersion:course.version,reason:'新期审核'});
      assert.equal((await call('/learning/courses/'+published.id,a)).body.lessons[0].live.id,session.id);assert.equal((await call('/live/sessions/'+next.id+'/reservation',a,'POST',{action:'RESERVE'})).status,403);
      await post('/admin/courses/'+published.id+'/grant',{userId:b.id,reason:'新期测试购课权限'},root);await post('/live/sessions/'+next.id+'/reservation',{action:'RESERVE'},b);
      await post('/admin/live/sessions/'+next.id+'/state',{action:'CANCEL',expectedVersion:next.version,reason:'无法如约交付'});
      assert.ok((await db.courseRelease.findUniqueOrThrow({where:{id:course.publishedReleaseId}})).withdrawnAt);assert.equal((await db.courseRelease.findUniqueOrThrow({where:{id:published.publishedReleaseId}})).withdrawnAt,null);
      assert.equal((await call('/live/lessons/'+lesson.id,a)).body.replayReady,true);assert.equal((await call('/learning/courses/'+published.id,b)).body.deliveryBlocked,true);assert.equal(await db.outboxJob.count({where:{aggregateId:course.publishedReleaseId,kind:'COURSE_DELIVERY_NOTICE'}}),1);
    });
  }finally{await app.close();await db.$disconnect();for(const name of Object.keys(process.env))if(!(name in previous))delete process.env[name];Object.assign(process.env,previous);}
});
