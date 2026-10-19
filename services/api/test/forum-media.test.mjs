import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {MediaIngest,mediaCommand} from '../dist/media-ingest.js';

test('forum media submissions: actual encoding, purpose isolation, review and revocation',{timeout:180000},async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService),ingest=app.get(MediaIngest),origin='http://127.0.0.1:5173';
  async function actor(role='USER',kind='APP',userId){const user=userId?await db.user.findUniqueOrThrow({where:{id:userId}}):await db.user.create({data:{nickname:'投稿验证'+randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();const session=await db.authSession.create({data:{userId:user.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return {id:user.id,sessionId:session.id,headers:kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken}};}
  async function call(path,who,method='GET',data){const multipart=data instanceof FormData,res=await fetch(base+path,{method,headers:{Origin:origin,...(!multipart?{'Content-Type':'application/json'}:{}),...who?.headers},...(data===undefined?{}:{body:multipart?data:JSON.stringify(data)})});return {status:res.status,body:await res.json()};}
  async function post(path,data,who=author){const r=await call(path,who,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  const author=await actor(),other=await actor(),admin=await actor('ADMIN','ADMIN'),operator=await actor('OPERATOR','ADMIN'),support=await actor('SUPPORT','ADMIN');
  const sections=(await call('/forum/sections')).body.items,section=sections[0],second=sections[1],prefix='投稿专项'+randomUUID();let video,audio,thread,publicTicket,preview;
  const videoPath=resolve(process.env.MEDIA_DIR,'forum-source.mp4'),audioPath=resolve(process.env.MEDIA_DIR,'forum-source.wav');
  try{
    await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',videoPath],60000);
    await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=660:duration=2',audioPath]);
    const bytes=await readFile(videoPath),wav=await readFile(audioPath),input={requestKey:randomUUID(),sectionId:section.id,name:'上善若水.mp4',mime:'video/mp4',bytes:bytes.length};
    async function chunk(task,data,offset=0,who=author){const form=new FormData();form.append('file',new Blob([data]),'chunk');return call('/forum/media/uploads/'+task.id+'/chunks/'+offset,who,'POST',form);}
    async function encoded(input,data){const task=await post('/forum/media/uploads',input);assert.equal((await chunk(task,data)).status,201);await post('/forum/media/uploads/'+task.id+'/complete',{});await ingest.runJobs();return (await call('/forum/media/uploads/'+task.id,author)).body;}
    await t.test('scoped resumable creation, limits, ownership and course/admin isolation',async()=>{
      assert.equal((await call('/forum/media/uploads',null,'POST',input)).status,401);
      assert.equal((await call('/forum/media/uploads',author,'POST',{...input,bytes:268435457})).status,400);
      assert.equal((await call('/forum/media/uploads',author,'POST',{...input,mime:'text/html'})).status,400);
      video=await post('/forum/media/uploads',input);assert.equal((await post('/forum/media/uploads',input)).id,video.id);
      assert.equal((await call('/forum/media/uploads',author,'POST',{...input,name:'同编号不同文件.mp4'})).status,409);
      assert.equal((await call('/forum/media/uploads/'+video.id,other)).status,404);
      assert.equal((await call('/admin/media/uploads/'+video.id,admin)).status,404);
      await db.user.update({where:{id:author.id},data:{roles:['USER','ADMIN']}});const same=await actor('ADMIN','ADMIN',author.id);
      assert.equal((await call('/admin/media/uploads/'+video.id,same)).status,404);
      const course=await post('/admin/media/uploads',{name:'运营课件.mp4',mime:'video/mp4',bytes:bytes.length,fingerprint:createHash('sha256').update(bytes).digest('hex')},same);
      assert.equal((await call('/forum/media/uploads/'+course.id,author)).status,404);await post('/admin/media/uploads/'+course.id+'/cancel',{},same);
      await db.user.update({where:{id:author.id},data:{roles:['USER']}});
      assert.equal((await call('/forum/media/uploads/'+video.id+'/complete',author,'POST',{})).status,409);
      assert.equal((await chunk(video,bytes.subarray(0,32),16)).status,409);
    });
    await t.test('chunk acknowledgement is idempotent and actual video/audio processing preserves private purpose',async()=>{
      const offset=Math.floor(bytes.length/2);assert.equal((await chunk(video,bytes.subarray(0,offset))).status,201);
      assert.equal((await chunk(video,bytes.subarray(0,offset))).body.receivedBytes,offset);
      assert.equal((await chunk(video,Buffer.alloc(offset))).status,409);
      assert.equal((await chunk(video,bytes.subarray(offset),offset)).body.receivedBytes,bytes.length);
      await post('/forum/media/uploads/'+video.id+'/complete',{});await ingest.runJobs();video=(await call('/forum/media/uploads/'+video.id,author)).body;assert.equal(video.state,'READY');
      audio=await encoded({requestKey:randomUUID(),sectionId:section.id,name:'读经心得.wav',mime:'audio/wav',bytes:wav.length},wav);assert.equal(audio.state,'READY');
      for(const task of [video,audio]){const asset=await db.mediaAsset.findUniqueOrThrow({where:{id:task.assetId}});assert.equal(asset.visibility,'PRIVATE');assert.equal(asset.variants.uploadPurpose,'FORUM_MEDIA');assert.match(asset.variants.sourceSha256,/^[a-f0-9]{64}$/);assert.ok(asset.durationSeconds>=2);assert.ok((await stat(resolve(process.env.MEDIA_DIR,asset.storageKey))).size>0);}
      assert.equal((await call('/admin/media/assets/'+video.assetId,admin)).status,404);
      assert.ok(!(await call('/admin/media-library',admin)).body.items.some(a=>[video.assetId,audio.assetId].includes(a.id)));
      preview=await post('/forum/media/uploads/'+video.id+'/preview',{});assert.equal((await fetch(base+preview.path,{headers:{Range:'bytes=0-511'}})).status,206);
      assert.equal((await call('/forum/media/uploads/'+video.id+'/preview',other,'POST',{})).status,404);
    });
    const threadInput={requestKey:randomUUID(),sectionId:section.id,title:prefix,body:'从生活中的不争体察道法自然。',assetIds:[],mediaIds:[],tags:['研习心得']};
    await t.test('foreign, course and cross-section media cannot be bound; pending audio/video remain private',async()=>{
      assert.equal((await call('/forum/threads',other,'POST',{...threadInput,mediaIds:[video.assetId]})).status,400);
      assert.equal((await call('/forum/threads',author,'POST',{...threadInput,sectionId:second.id,mediaIds:[video.assetId]})).status,400);
      const courseAsset=await db.mediaAsset.create({data:{storageKey:randomUUID(),name:'私人课件',mime:'video/mp4',bytes:1,status:'READY',visibility:'PRIVATE',uploaderId:author.id,durationSeconds:2}});
      assert.equal((await call('/forum/threads',author,'POST',{...threadInput,mediaIds:[courseAsset.id]})).status,400);
      const results=await Promise.all([1,2].map(()=>call('/forum/threads',author,'POST',{...threadInput,mediaIds:[video.assetId,audio.assetId]})));assert.ok(results.every(r=>r.status===201),JSON.stringify(results));assert.equal(results[0].body.id,results[1].body.id);thread=results[0].body;
      assert.deepEqual(thread.blocks.filter(b=>['video','audio'].includes(b.type)).map(b=>b.type),['video','audio']);
      assert.equal((await call('/forum/threads/'+thread.id+'/media/'+video.assetId,null,'POST',{})).status,404);
      assert.equal((await call('/forum/threads/'+thread.id+'/media/'+video.assetId,other,'POST',{})).status,404);
      assert.equal((await call('/forum/threads/'+thread.id+'/media/'+video.assetId,author,'POST',{})).status,201);
      assert.equal((await call('/forum/media/uploads',author)).body.some(t=>t.id===video.id),false);
      assert.equal((await call('/forum/media/uploads/'+video.id+'/cancel',author,'POST',{})).status,409);
      assert.equal((await call('/forum/threads',author,'POST',{...threadInput,requestKey:randomUUID(),mediaIds:[video.assetId]})).status,409);
    });
    await t.test('audited review preview, explicit human confirmation and publication revalidation',async()=>{
      assert.equal((await call('/admin/forum/threads/'+thread.id+'/media/'+video.assetId,support,'POST',{})).status,403);
      const reviewed=await post('/admin/forum/threads/'+thread.id+'/media/'+video.assetId,{},operator);assert.equal((await fetch(base+reviewed.path)).status,200);
      assert.equal(await db.auditLog.count({where:{actorId:operator.id,action:'forum.media.preview',resourceId:thread.id}}),1);
      const input={expectedVersion:1,action:'APPROVE',reason:'已人工核对完整投稿内容'};
      assert.equal((await call('/admin/forum/threads/'+thread.id+'/moderate',admin,'POST',input)).status,400);
      await db.mediaAsset.update({where:{id:audio.assetId},data:{status:'PROCESSING'}});
      assert.equal((await call('/admin/forum/threads/'+thread.id+'/moderate',admin,'POST',{...input,mediaReviewed:true})).status,409);
      await db.mediaAsset.update({where:{id:audio.assetId},data:{status:'READY'}});
      await post('/admin/forum/threads/'+thread.id+'/moderate',{...input,mediaReviewed:true},admin);
      publicTicket=await post('/forum/threads/'+thread.id+'/media/'+video.assetId,{},other);
      const response=await fetch(base+publicTicket.path,{headers:{Range:'bytes=20-119'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,100);
      assert.equal((await post('/forum/threads/'+thread.id+'/media/'+audio.assetId,{},other)).mime,'audio/mp4');
    });
    await t.test('session, block, author freeze, posting restriction, withdrawal and version all revoke old tickets',async()=>{
      await db.authSession.update({where:{id:other.sessionId},data:{revokedAt:new Date()}});assert.equal((await fetch(base+publicTicket.path)).status,401);await db.authSession.update({where:{id:other.sessionId},data:{revokedAt:null}});
      await post('/forum/blocks/'+author.id,{},other);assert.equal((await fetch(base+publicTicket.path)).status,404);assert.equal((await call('/forum/blocks/'+author.id,other,'DELETE')).status,200);
      await db.user.update({where:{id:author.id},data:{status:'FROZEN'}});assert.equal((await fetch(base+publicTicket.path)).status,404);assert.equal((await fetch(base+preview.path)).status,401);await db.user.update({where:{id:author.id},data:{status:'ACTIVE'}});
      const restriction=await post('/admin/forum/users/'+author.id+'/restrict',{scope:'POST',days:1,reason:'测试投稿封禁撤权'},admin);assert.equal((await fetch(base+publicTicket.path)).status,404);
      assert.equal((await call('/forum/media/uploads',author,'POST',{...input,requestKey:randomUUID()})).status,403);await post('/admin/forum/restrictions/'+restriction.id+'/revoke',{expectedVersion:1,reason:'解除测试限制'},admin);
      await post('/forum/threads/'+thread.id+'/withdraw',{expectedVersion:2});assert.equal((await fetch(base+publicTicket.path)).status,404);assert.equal((await call('/forum/threads/'+thread.id+'/media/'+video.assetId,author,'POST',{})).status,404);
      await post('/admin/forum/threads/'+thread.id+'/moderate',{expectedVersion:3,action:'RESTORE',reason:'恢复后重新审核'},admin);await post('/admin/forum/threads/'+thread.id+'/moderate',{expectedVersion:4,action:'APPROVE',reason:'再次核对全部媒体',mediaReviewed:true},admin);assert.equal((await fetch(base+publicTicket.path)).status,404);
    });
    await t.test('decode failures retry safely; cancelled and unbound expired media are removed without touching bound posts',async()=>{
      const invalid=await encoded({requestKey:randomUUID(),sectionId:section.id,name:'伪造.mp4',mime:'video/mp4',bytes:32},Buffer.alloc(32));assert.equal(invalid.state,'FAILED');assert.ok(invalid.failure.includes('10分钟'));
      assert.equal((await call('/forum/media/uploads/'+invalid.id+'/preview',author,'POST',{})).status,404);
      await post('/forum/media/uploads/'+invalid.id+'/retry',{});await ingest.runJobs();assert.equal((await call('/forum/media/uploads/'+invalid.id,author)).body.state,'FAILED');await post('/forum/media/uploads/'+invalid.id+'/cancel',{});
      const unbound=await encoded({requestKey:randomUUID(),sectionId:section.id,name:'过期.mp4',mime:'video/mp4',bytes:bytes.length},bytes),asset=await db.mediaAsset.findUniqueOrThrow({where:{id:unbound.assetId}});
      await db.mediaUpload.update({where:{id:unbound.id},data:{expiresAt:new Date(0)}});await db.mediaUpload.update({where:{id:video.id},data:{expiresAt:new Date(0)}});await ingest.runJobs();
      assert.equal((await db.mediaAsset.findUniqueOrThrow({where:{id:unbound.assetId}})).status,'DELETED');await assert.rejects(stat(resolve(process.env.MEDIA_DIR,asset.storageKey)));
      assert.equal((await db.mediaAsset.findUniqueOrThrow({where:{id:video.assetId}})).status,'READY');assert.equal(await db.attachmentBinding.count({where:{threadId:thread.id,purpose:'FORUM_MEDIA'}}),2);
      assert.equal((await call('/forum/media/uploads/'+video.id,author)).status,404);
    });
    await t.test('processing cancellation and account closure cannot revive private media',async()=>{
      const disposable=await actor(),task=await post('/forum/media/uploads',{...input,requestKey:randomUUID()},disposable);
      assert.equal((await chunk(task,bytes,0,disposable)).status,201);await post('/forum/media/uploads/'+task.id+'/complete',{},disposable);
      const pending=await db.mediaUpload.findUniqueOrThrow({where:{id:task.id}});assert.equal(pending.state,'PROCESSING');
      await post('/forum/media/uploads/'+task.id+'/cancel',{},disposable);await ingest.runJobs();
      assert.equal((await db.mediaAsset.findUniqueOrThrow({where:{id:pending.assetId}})).status,'DELETED');
      const next=await post('/forum/media/uploads',{...input,requestKey:randomUUID()},disposable);
      assert.equal((await chunk(next,bytes,0,disposable)).status,201);await post('/forum/media/uploads/'+next.id+'/complete',{},disposable);
      const assetId=(await db.mediaUpload.findUniqueOrThrow({where:{id:next.id}})).assetId;
      await post('/me/close-account',{confirmation:'确认注销'},disposable);await ingest.runJobs();
      assert.equal((await db.mediaAsset.findUniqueOrThrow({where:{id:assetId}})).status,'DELETED');
      assert.equal((await call('/forum/media/uploads/'+next.id+'/preview',disposable,'POST',{})).status,401);
    });
    await t.test('daily quota survives task cancellation and cleanup',async()=>{
      const limited=await actor();for(let i=0;i<10;i++){const task=await post('/forum/media/uploads',{...input,requestKey:randomUUID()},limited);await post('/forum/media/uploads/'+task.id+'/cancel',{},limited);await ingest.runJobs();}
      assert.equal((await call('/forum/media/uploads',limited,'POST',{...input,requestKey:randomUUID()})).status,409);assert.equal(await db.mediaUpload.count({where:{uploaderId:limited.id}}),0);
    });
  }finally{await app.close();await db.$disconnect();}
});
