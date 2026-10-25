import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,copyFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {LiveRecordings} from '../dist/live-recordings.js';
import {mediaCommand} from '../dist/media-ingest.js';

test('admin member broadcast: publish, access, host conflict, recording recovery and private replay',async t=>{
  Object.assign(process.env,{ZEGO_APP_ID:'123',ZEGO_SERVER_SECRET:'12345678901234567890123456789012',ZEGO_CALLBACK_SECRET:'test',ZEGO_RTC_SERVER:'wss://test.zego.im/ws',ZEGO_RTC_ENABLED:'true',ZEGO_ROOM_TOKEN_AUTH_ENABLED:'true',CORS_ORIGINS:'http://127.0.0.1:5173'});
  const app=await createApp(false);app.useLogger(['error']);await app.listen(0,'127.0.0.1');const db=app.get(Database),auth=app.get(AuthService),recordings=app.get(LiveRecordings),base=(await app.getUrl())+'/api/v1';
  recordings.readiness=async()=>({ready:true,reason:''});
  async function actor(role,kind='ADMIN'){const user=await db.user.create({data:{nickname:'直播测试-'+randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return{id:user.id,headers:kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken}};}
  async function call(path,actor,method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...actor?.headers},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
  let session,root,another,teacher,member,outsider,sourceFile;
  const dto={requestKey:randomUUID(),title:'道德经 · 会员共读',summary:'共同研习上善若水，结合生活实践答疑。',scheduledAt:new Date(Date.now()+600000).toISOString(),cover:''};
  try{
    root=await actor('ADMIN');another=await actor('ADMIN');teacher=await actor('TEACHER');member=await actor('USER','APP');outsider=await actor('USER','APP');
    await t.test('one submission publishes a teacher-free member announcement, retry does not duplicate',async()=>{
      const result=await call('/admin/live/broadcasts',root,'POST',dto);assert.equal(result.status,201,JSON.stringify(result.body));session=result.body;assert.equal((await call('/admin/live/broadcasts',root,'POST',dto)).body.id,session.id);
      const room=await db.liveRoom.findUniqueOrThrow({where:{id:session.roomId}});assert.equal(room.teacherId,null);assert.equal(room.managedByAdmin,true);assert.equal(room.accessRule.allMembers,true);assert.equal((await db.resource.findUniqueOrThrow({where:{id:room.id}})).publishState,'PUBLISHED');
      assert.equal((await call('/admin/live/broadcasts',root,'POST',{...dto,title:'冲突主题'})).status,409);
      assert.equal((await call('/admin/live/broadcasts',teacher,'POST',{...dto,requestKey:randomUUID()})).status,403);
    });
    await t.test('discovery includes actual live state and Beijing-ready time, no required teacher publication',async()=>{
      const result=await call('/discovery/search?type=LIVE&sort=recent',member);assert.equal(result.status,200);const row=result.body.items.find(r=>r.id===session.roomId);assert.equal(row.liveState,'SCHEDULED');assert.ok(row.scheduledAt);
    });
    await t.test('no active membership cannot watch or reserve; recording absence blocks opening honestly',async()=>{
      assert.equal((await call('/live/sessions/'+session.id+'/reservation',outsider,'POST',{action:'RESERVE'})).status,403);
      recordings.readiness=async()=>({ready:false,reason:'录制服务尚未配置'});assert.equal((await call('/admin/live/broadcasts/'+session.id+'/action',root,'POST',{action:'ENTER',expectedVersion:1})).status,503);recordings.readiness=async()=>({ready:true,reason:''});
    });
    await t.test('every active membership tier can reserve, expiry removes access',async()=>{
      for(const tier of [1,2,3]){
        member=await actor('USER','APP');
        const plan=await db.membershipPlan.upsert({where:{tier_days:{tier,days:30}},create:{title:'会员'+tier,tier,days:30,price:100,description:'隔离测试'},update:{}});
        const m=await db.membership.create({data:{userId:member.id,planId:plan.id,tier,startsAt:new Date(Date.now()-60000),endsAt:new Date(Date.now()+86400000),source:'ADMIN'}});
        const result=await call('/live/sessions/'+session.id+'/reservation',member,'POST',{action:'RESERVE'});assert.equal(result.status,201,JSON.stringify(result.body));
        await db.membership.update({where:{id:m.id},data:{endsAt:new Date(Date.now()-1000)}});
        assert.equal((await call('/live/sessions/'+session.id+'/reservation',member,'POST',{action:'RESERVE'})).status,403);
      }
    });
    await t.test('admin enters without teacher assignment; concurrent admin cannot take the active host lease',async()=>{
      const opened=await call('/admin/live/broadcasts/'+session.id+'/action',root,'POST',{action:'ENTER',expectedVersion:1});assert.equal(opened.status,201,JSON.stringify(opened.body));assert.ok(opened.body.key);session=await db.liveSession.findUniqueOrThrow({where:{id:session.id}});assert.equal(session.state,'PREPARING');
      assert.equal((await call('/admin/live/broadcasts/'+session.id+'/action',another,'POST',{action:'ENTER',expectedVersion:session.version})).status,409);
      assert.equal((await call('/admin/live/broadcasts/'+session.id,root,'POST',{...dto,expectedVersion:session.version})).status,409);
      await call('/live/rtc/leave',null,'POST',{key:opened.body.key});
      assert.equal((await call('/admin/live/broadcasts/'+session.id+'/action',another,'POST',{action:'ENTER',expectedVersion:session.version})).status,201);
      const next=await call('/admin/live/broadcasts',root,'POST',{...dto,requestKey:randomUUID(),title:'下一场会员研习'});assert.equal(next.status,201);assert.equal((await call('/admin/live/broadcasts/'+next.body.id+'/action',root,'POST',{action:'ENTER',expectedVersion:1})).status,409);
    });
    await t.test('server-recorded MP4 becomes a private replay automatically, then can be withdrawn',async()=>{
      await db.liveSession.update({where:{id:session.id},data:{state:'ENDED',endedAt:new Date()}});
      const job=await db.liveRecording.findUniqueOrThrow({where:{sessionId:session.id}}),token=randomUUID(),directory=resolve(process.env.MEDIA_DIR,'recordings',job.id,'0001');await mkdir(directory,{recursive:true});
      sourceFile=resolve(directory,'part-1.mp4');
      await mediaCommand(process.env.FFMPEG_PATH,['-nostdin','-y','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-c:a','aac',resolve(directory,'part-1.mp4')]);
      await db.liveRecording.update({where:{id:job.id},data:{state:'PROCESSING',attempts:1,leaseToken:token,leaseUntil:new Date(Date.now()+90000)}});
      await recordings.finish(job.id,{token,controller:new AbortController(),renewed:Date.now()});
      const result=await db.liveRecording.findUniqueOrThrow({where:{id:job.id}});assert.equal(result.state,'READY',JSON.stringify(result));assert.ok(result.assetId);const replay=await db.liveReplay.findUniqueOrThrow({where:{sessionId:session.id}});assert.equal(replay.reviewState,'APPROVED');assert.ok(await stat(resolve(process.env.MEDIA_DIR,(await db.mediaAsset.findUniqueOrThrow({where:{id:replay.assetId}})).storageKey)));
      assert.equal((await call('/live/sessions/'+session.id+'/replay-ticket',outsider,'POST',{})).status,403);
      member=await actor('USER','APP');const memberPlan=await db.membershipPlan.findFirstOrThrow({where:{tier:1}});const activeMember=await db.membership.create({data:{userId:member.id,planId:memberPlan.id,tier:1,source:'ADMIN',startsAt:new Date(Date.now()-60000),endsAt:new Date(Date.now()+86400000)}});
      const ticket=await call('/live/sessions/'+session.id+'/replay-ticket',member,'POST',{});assert.equal(ticket.status,201,JSON.stringify(ticket.body));const bytes=await fetch(base+ticket.body.path,{headers:{Range:'bytes=0-31'}});assert.equal(bytes.status,206);assert.equal((await bytes.arrayBuffer()).byteLength,32);
      await db.membership.update({where:{id:activeMember.id},data:{endsAt:new Date(Date.now()-1000)}});assert.equal((await fetch(base+ticket.body.path,{headers:{Range:'bytes=0-31'}})).status,403);

      session=await db.liveSession.findUniqueOrThrow({where:{id:session.id}});assert.equal(session.state,'REPLAY_READY');
      assert.equal((await call('/admin/live/broadcasts/'+session.id+'/action',root,'POST',{action:'HIDE_REPLAY',expectedVersion:session.version})).status,201);
      assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:session.id}})).state,'ENDED');
    });
    await t.test('empty recording is an explicit failure, not an empty published replay',async()=>{
      const row=(await call('/admin/live/broadcasts',root,'POST',{...dto,requestKey:randomUUID(),title:'无推流录制核查'})).body;await db.liveSession.update({where:{id:row.id},data:{state:'ENDED'}});const token=randomUUID(),job=await db.liveRecording.create({data:{sessionId:row.id,leaseToken:token,state:'PROCESSING'}});await recordings.finish(job.id,{token,controller:new AbortController(),renewed:Date.now()});assert.equal((await db.liveRecording.findUniqueOrThrow({where:{id:job.id}})).failure,'RECORDING_EMPTY');assert.equal(await db.liveReplay.count({where:{sessionId:row.id}}),0);
    });
    await t.test('recovered recording needs admin publication; processing never republishes a withdrawn replay',async()=>{
      const row=(await call('/admin/live/broadcasts',root,'POST',{...dto,requestKey:randomUUID(),title:'断线恢复回放核查'})).body;await db.liveSession.update({where:{id:row.id},data:{state:'ENDED'}});const token=randomUUID(),job=await db.liveRecording.create({data:{sessionId:row.id,attempts:2,leaseToken:token,state:'PROCESSING'}}),directory=resolve(process.env.MEDIA_DIR,'recordings',job.id,'0002');await mkdir(directory,{recursive:true});await copyFile(sourceFile,resolve(directory,'part-1.mp4'));await recordings.finish(job.id,{token,controller:new AbortController(),renewed:Date.now()});assert.equal((await db.liveRecording.findUniqueOrThrow({where:{id:job.id}})).failure,'RECORDING_PARTIAL');assert.equal((await db.liveReplay.findUniqueOrThrow({where:{sessionId:row.id}})).reviewState,'PENDING');
      assert.equal((await call('/admin/live/sessions/'+row.id+'/replay/review/preview',root,'POST',{})).status,201);assert.equal((await call('/admin/live/broadcasts/'+row.id+'/action',root,'POST',{action:'PUBLISH_REPLAY',expectedVersion:1})).status,201);assert.equal((await call('/admin/live/broadcasts/'+row.id+'/action',root,'POST',{action:'HIDE_REPLAY',expectedVersion:2})).status,201);await db.liveRecording.update({where:{id:job.id},data:{state:'PROCESSING',leaseToken:token}});await recordings.finish(job.id,{token,controller:new AbortController(),renewed:Date.now()});assert.equal((await db.liveReplay.findUniqueOrThrow({where:{sessionId:row.id}})).reviewState,'REJECTED');assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:row.id}})).state,'ENDED');
    });
    await t.test('the session entry point honours the single-live rule and books the recording job',async()=>{
      const first=(await call('/admin/live/broadcasts',root,'POST',{...dto,requestKey:randomUUID(),title:'场次入口准备'})).body;
      const prepared=await call('/admin/live/sessions/'+first.id+'/state',root,'POST',{action:'PREPARE',expectedVersion:1,reason:'从场次入口准备'});
      assert.equal(prepared.status,201,JSON.stringify(prepared.body));
      assert.ok(await db.liveRecording.findUnique({where:{sessionId:first.id}}));
      const second=(await call('/admin/live/broadcasts',root,'POST',{...dto,requestKey:randomUUID(),title:'场次入口冲突'})).body;
      assert.equal((await call('/admin/live/sessions/'+second.id+'/state',root,'POST',{action:'PREPARE',expectedVersion:1,reason:'同时准备'})).status,409);
    });
    await t.test('a cancelled broadcast keeps its recording but never queues an unpublishable replay',async()=>{
      const row=(await call('/admin/live/broadcasts',root,'POST',{...dto,requestKey:randomUUID(),title:'取消场次录制核查'})).body;
      assert.equal((await call('/admin/live/broadcasts/'+row.id+'/action',root,'POST',{action:'CANCEL',expectedVersion:1})).status,201);
      const token=randomUUID(),job=await db.liveRecording.create({data:{sessionId:row.id,leaseToken:token,state:'PROCESSING'}}),directory=resolve(process.env.MEDIA_DIR,'recordings',job.id,'0001');await mkdir(directory,{recursive:true});await copyFile(sourceFile,resolve(directory,'part-1.mp4'));
      await recordings.finish(job.id,{token,controller:new AbortController(),renewed:Date.now()});
      const recording=await db.liveRecording.findUniqueOrThrow({where:{id:job.id}});assert.equal(recording.state,'READY',JSON.stringify(recording));assert.ok(recording.assetId);
      assert.equal(await db.liveReplay.count({where:{sessionId:row.id}}),0);
    });
  }finally{await app.close();}
});
