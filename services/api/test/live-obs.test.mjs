import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createDecipheriv} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {LiveRecordings} from '../dist/live-recordings.js';
import {ZegoService,rtcStreamId} from '../dist/zego.js';

test('OBS uses a per-session WHIP URL and a receive-only monitor, sharing the original member/recording lifecycle',async()=>{
  const before={...process.env},secret='12345678901234567890123456789012';
  Object.assign(process.env,{ZEGO_RTC_ENABLED:'true',ZEGO_APP_ID:'563636194',ZEGO_SERVER_SECRET:secret,ZEGO_RTC_SERVER:'wss://test.zego.im/ws',ZEGO_ROOM_TOKEN_AUTH_ENABLED:'true',ZEGO_WHIP_DOMAIN:'',CORS_ORIGINS:'http://127.0.0.1:5173'});
  const app=await createApp(false);app.useLogger(['error']);await app.listen(0,'127.0.0.1');const db=app.get(Database),auth=app.get(AuthService),zego=app.get(ZegoService),users=[],sessions=[],base=await app.getUrl();
  app.get(LiveRecordings).readiness=async()=>({ready:true,reason:''});
  async function actor(role='ADMIN',kind='ADMIN'){const u=await db.user.create({data:{nickname:'OBS-'+randomUUID(),roles:[role]}});users.push(u.id);const c=auth.credentials(),csrf=randomUUID();await db.authSession.create({data:{userId:u.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});return{headers:kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrf}};}
  async function call(path,who,body){const r=await fetch(base+'/api/v1'+path,{method:body?'POST':'GET',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...who?.headers},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
  try{
    const root=await actor(),other=await actor(),viewer=await actor('USER','APP'),teacher=await actor('TEACHER');
    const created=await call('/admin/live/broadcasts',root,{requestKey:randomUUID(),title:'OBS 课堂',summary:'屏幕与授课画面',scheduledAt:new Date(Date.now()+600000).toISOString()});assert.equal(created.status,201);const s=created.body;sessions.push(s);
    assert.equal((await call('/admin/live/broadcasts/'+s.id+'/action',teacher,{action:'ENTER_OBS',expectedVersion:1})).status,403);
    assert.equal((await call('/admin/live/broadcasts/'+s.id+'/action',root,{action:'ENTER_OBS',expectedVersion:1})).status,503);assert.equal((await db.liveSession.findUniqueOrThrow({where:{id:s.id}})).state,'SCHEDULED');
    process.env.ZEGO_WHIP_DOMAIN='i-whip563636194.whip.zegotech.cn';
    const opened=await call('/admin/live/broadcasts/'+s.id+'/action',root,{action:'ENTER_OBS',expectedVersion:1});assert.equal(opened.status,201,JSON.stringify(opened.body));
    const url=new URL(opened.body.obs.url);assert.equal(url.origin,'https://i-whip563636194.whip.zegotech.cn');assert.equal(url.pathname,'/whip/v1/563636194/'+rtcStreamId(s.id));assert.equal(opened.body.obs.tokenRequired,false);assert.deepEqual([...url.searchParams.keys()],['userId','zgVer','zgExpired','zgNonce']);
    const monitor=await call('/live/rtc/refresh',null,{key:opened.body.key});assert.equal(monitor.body.role,'OBSERVER');assert.equal(monitor.body.publishStreamId,null);assert.equal(monitor.body.userId,url.searchParams.get('userId'));
    const packet=Buffer.from(monitor.body.token.slice(2),'base64'),ivLength=packet.readUInt16BE(8),ciphertext=packet.subarray(12+ivLength,-1),decipher=createDecipheriv('aes-256-gcm',Buffer.from(secret),packet.subarray(10,10+ivLength));decipher.setAuthTag(ciphertext.subarray(-16));const token=JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]).toString());assert.equal(JSON.parse(token.payload).privilege['2'],0);
    assert.equal((await call('/live/sessions/'+s.id+'/join',viewer,{})).status,409);
    zego.request=async()=>({Code:0});assert.equal((await call('/admin/live/sessions/'+s.id+'/reconcile',root,{})).body.state,'LIVE');
    const fresh=await db.liveSession.findUniqueOrThrow({where:{id:s.id}});assert.equal(fresh.pushSecretRef,'OBS_WHIP');assert.ok(await db.liveRecording.findUnique({where:{sessionId:s.id}}));
    const list=await call('/admin/live/broadcasts',root);assert.equal(list.body.items.find(r=>r.id===s.id).publisher,'OBS');
    assert.equal((await call('/admin/live/broadcasts/'+s.id+'/action',other,{action:'ENTER_OBS',expectedVersion:fresh.version})).status,409);
    assert.equal((await call('/admin/live/broadcasts/'+s.id+'/action',root,{action:'ENTER',expectedVersion:fresh.version})).status,409);
    const joined=await call('/live/sessions/'+s.id+'/join',viewer,{});assert.equal(joined.status,201);const credentials=await call('/live/rtc/refresh',null,{key:joined.body.key});assert.ok(credentials.body.playStreamIds.includes(rtcStreamId(s.id)));
    const publicRoom=await call('/live/rooms/'+s.roomId,viewer);assert.ok(!JSON.stringify(publicRoom.body).includes('whip.zegotech.cn'));
    const end={action:'END',expectedVersion:fresh.version};assert.equal((await call('/admin/live/broadcasts/'+s.id+'/action',root,end)).status,201);assert.equal((await call('/admin/live/broadcasts/'+s.id+'/action',root,end)).status,201);
    assert.equal((await call('/live/rtc/refresh',null,{key:joined.body.key})).status,401);assert.equal((await call('/live/rtc/refresh',null,{key:opened.body.key})).status,401);
  }finally{
    for(const s of sessions){await db.liveRecording.deleteMany({where:{sessionId:s.id}});await db.liveRtcLease.deleteMany({where:{sessionId:s.id}});await db.liveSession.deleteMany({where:{id:s.id}});await db.liveRoom.deleteMany({where:{id:s.roomId}});await db.resource.deleteMany({where:{id:s.roomId}});}
    await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await app.close();for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);
  }
});
