import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {subtitleCues} from '../dist/subtitles.js';

const subtitles='1\n00:00:00,000 --> 00:00:05,250\n上善若水。\n水善利万物而不争。\n\n2\n00:00:06,000 --> 00:00:19,000\n道法自然。';
test('timed subtitles validate SRT and WebVTT boundaries',()=>{
  const cues=subtitleCues(subtitles,20);assert.equal(cues.length,2);assert.equal(cues[0].end,5.25);
  assert.deepEqual(subtitleCues('\uFEFFWEBVTT\r\n\r\nwater\r\n00:00.000 --> 00:05.250\r\n上善若水。',20),[{start:0,end:5.25,text:'上善若水。'}]);
  assert.deepEqual(subtitleCues('',20),[]);
  for(const value of ['正文没有时间轴','WEBVTT','1\n00:00:99,000 --> 00:01:00,000\n错误',subtitles.replace('00:00:06,000','00:00:05,000'),subtitles.replace('00:00:19,000','00:00:21,000'),'1\n00:00:05,000 --> 00:00:01,000\n倒序','1\n00:00:00,000 --> 00:00:01,000\n','1\n00:00:00,000 --> 00:00:01,000 align:start\n定位', 'x'.repeat(200001)])assert.throws(()=>subtitleCues(value,20));
});

test('reviewed media delivery: ready assets, immutable subtitles and private replay preview',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService);
  async function actor(role,kind='ADMIN'){
    const user=await db.user.create({data:{nickname:randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});
    return {id:user.id,...(kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken})};
  }
  async function call(path,actor,method='GET',data){const headers={Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...(actor??{})};delete headers.id;const r=await fetch(base+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:await r.json()};}
  let admin,operator,moderator,student,other,media,course,lesson,room,session,replay,preview,oldTicket;
  async function post(path,data,who=admin){const r=await call(path,who,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  try{
    admin=await actor('ADMIN');operator=await actor('OPERATOR');moderator=await actor('MODERATOR');student=await actor('USER','APP');other=await actor('USER','APP');
    const teacher=await db.teacher.create({data:{name:'字幕交付名师',title:'道学研习',bio:'隔离测试',status:'PUBLISHED'}});
    const storageKey=randomUUID(),bytes=Buffer.from('00000018667479706d7034320000000069736f6d6d703432','hex');await writeFile(resolve(process.env.MEDIA_DIR,storageKey),bytes);
    media=await db.mediaAsset.create({data:{storageKey,name:'研习视频',mime:'video/mp4',bytes:bytes.length,uploaderId:admin.id,status:'READY',visibility:'PRIVATE'}});
    const chapter={title:'不争之道',format:'VIDEO',body:'本讲原文',mediaId:media.id,durationSeconds:20,subtitleText:subtitles,trial:false,required:true};
    const draft={title:'道德经 · 字幕研习',subtitle:'可复制的学习资料',description:'固定版本字幕',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:100,teacherId:teacher.id,membershipTier:null,accessDays:null,refundPolicy:'按售前规则退款',featured:false,tags:[],chapters:[chapter]};
    await t.test('draft rejects failed/processing/private media and out-of-range subtitles',async()=>{
      for(const status of ['REJECTED','PROCESSING','DELETED','REVIEW']){await db.mediaAsset.update({where:{id:media.id},data:{status}});assert.equal((await call('/admin/courses',admin,'POST',draft)).status,400);}
      await db.mediaAsset.update({where:{id:media.id},data:{status:'READY',variants:{uploadPurpose:'ASSIGNMENT_IMAGE'}}});assert.equal((await call('/admin/courses',admin,'POST',draft)).status,400);
      await db.mediaAsset.update({where:{id:media.id},data:{variants:{}}});assert.equal((await call('/admin/courses',admin,'POST',{...draft,chapters:[{...chapter,durationSeconds:10}]})).status,400);
      course=await post('/admin/courses',draft);
    });
    await t.test('submit and publication recheck asset readiness without changing status on failure',async()=>{
      await db.mediaAsset.update({where:{id:media.id},data:{status:'PROCESSING'}});assert.equal((await call('/admin/courses/'+course.id+'/transition',admin,'POST',{action:'submit',expectedVersion:course.version,reason:'失败送审'})).status,400);
      assert.equal((await db.course.findUniqueOrThrow({where:{id:course.id}})).status,'DRAFT');await db.mediaAsset.update({where:{id:media.id},data:{status:'READY'}});
      course=await post('/admin/courses/'+course.id+'/transition',{action:'submit',expectedVersion:course.version,reason:'送审'});
      await db.mediaAsset.update({where:{id:media.id},data:{variants:{uploadPurpose:'FORUM_IMAGE'}}});assert.equal((await call('/admin/courses/'+course.id+'/transition',admin,'POST',{action:'publish',expectedVersion:course.version,reason:'不可发布'})).status,400);
      assert.equal((await db.course.findUniqueOrThrow({where:{id:course.id}})).status,'REVIEW');await db.mediaAsset.update({where:{id:media.id},data:{variants:{}}});
      course=await post('/admin/courses/'+course.id+'/transition',{action:'publish',expectedVersion:course.version,reason:'审核发布'});lesson=await db.lesson.findFirstOrThrow({where:{releaseId:course.publishedReleaseId}});assert.equal(lesson.subtitleText,subtitles);
      await assert.rejects(()=>db.lesson.update({where:{id:lesson.id},data:{subtitleText:''}}),/immutable/);
    });
    await t.test('subtitle access follows purchased version; catalog does not leak text and renewal is revoked',async()=>{
      const catalog=await call('/learning/courses/'+course.id,other);assert.ok(!JSON.stringify(catalog.body).includes('道法自然'));assert.equal((await call('/learning/lessons/'+lesson.id,other)).status,403);
      await post('/admin/courses/'+course.id+'/grant',{userId:student.id,reason:'隔离授权'});assert.deepEqual((await call('/learning/lessons/'+lesson.id,student)).body.subtitles,subtitleCues(subtitles,20));
      const first=await post('/learning/lessons/'+lesson.id+'/media',{},student),second=await post('/learning/lessons/'+lesson.id+'/media',{},student);assert.ok(Date.parse(second.expiresAt)>=Date.parse(first.expiresAt));assert.equal((await fetch(base+second.path,{headers:{Range:'bytes=0-7'}})).status,206);
      await db.enrollment.update({where:{userId_courseId:{userId:student.id,courseId:course.id}},data:{revokedAt:new Date()}});assert.equal((await call('/learning/lessons/'+lesson.id,student)).status,403);assert.equal((await call('/learning/lessons/'+lesson.id+'/media',student,'POST',{})).status,403);assert.equal((await fetch(base+first.path)).status,403);
    });
    await t.test('pending replay supplies an audited review-only preview, with no student subtitle or notes access',async()=>{
      room=await post('/admin/live',{title:'道法自然 · 共研',summary:'研习回顾',teacherId:teacher.id,categoryCode:'CULTURE',accessMode:'PUBLIC'});await post('/admin/live-discovery/'+room.id+'/publication',{title:'道法自然 · 共研',summary:'研习回顾',state:'PUBLISHED',expectedVersion:1,reason:'审核展示'});
      session=await post('/admin/live/rooms/'+room.id+'/sessions',{title:'字幕共读',hostUserId:admin.id,scheduledAt:new Date(Date.now()+3600000).toISOString()});session=await db.liveSession.update({where:{id:session.id},data:{state:'ENDED'}});
      assert.equal((await call('/admin/live/sessions/'+session.id+'/replay',admin,'POST',{assetId:media.id,subtitleText:subtitles,durationSeconds:10,expectedVersion:session.version,reason:'时间错误'})).status,400);
      replay=await post('/admin/live/sessions/'+session.id+'/replay',{assetId:media.id,subtitleText:subtitles,notes:'私人研习资料：观察日常中的不争。',durationSeconds:20,expectedVersion:session.version,reason:'提交完整回放'});
      assert.equal((await call('/live/sessions/'+session.id+'/replay-ticket',student,'POST',{})).status,404);assert.ok(!JSON.stringify((await call('/live/rooms/'+room.id,student)).body).includes('私人研习资料'));
      assert.equal((await call('/admin/live/sessions/'+session.id+'/replay/review/preview',operator,'POST',{})).status,403);
      preview=await post('/admin/live/sessions/'+session.id+'/replay/review/preview',{},moderator);assert.equal((await fetch(base+preview.path,{headers:{Range:'bytes=0-7'}})).status,206);
      const policy=await db.accessRole.findUniqueOrThrow({where:{code:'MODERATOR'}});await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes.filter(p=>p!=='live.review')}});assert.equal((await fetch(base+preview.path)).status,403);await db.accessRole.update({where:{id:policy.id},data:{permissionCodes:policy.permissionCodes}});
    });
    await t.test('approval delivers subtitles and notes, resubmission and same-asset revisions invalidate old tickets',async()=>{
      await post('/admin/live/sessions/'+session.id+'/replay/review',{state:'APPROVED',expectedVersion:replay.version,reason:'试看确认'},moderator);
      oldTicket=await post('/live/sessions/'+session.id+'/replay-ticket',{},student);assert.deepEqual(oldTicket.subtitles,subtitleCues(subtitles,20));assert.match(oldTicket.notes,/不争/);assert.equal((await fetch(base+preview.path)).status,404);
      session=await db.liveSession.findUniqueOrThrow({where:{id:session.id}});replay=await post('/admin/live/sessions/'+session.id+'/replay',{assetId:media.id,subtitleText:subtitles,notes:'修订资料',durationSeconds:20,expectedVersion:session.version,reason:'修订资料'});
      assert.equal((await call('/live/sessions/'+session.id+'/replay-ticket',student,'POST',{})).status,404);assert.equal((await fetch(base+oldTicket.path)).status,404);
      await post('/admin/live/sessions/'+session.id+'/replay/review',{state:'APPROVED',expectedVersion:replay.version,reason:'修订审核'},moderator);assert.equal((await fetch(base+oldTicket.path)).status,404);assert.equal((await post('/live/sessions/'+session.id+'/replay-ticket',{},student)).notes,'修订资料');
    });
  }finally{await app.close();await db.$disconnect();}
});
