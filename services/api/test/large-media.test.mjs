import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {open,stat,readFile,mkdir,writeFile,utimes} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {MediaIngest,MEDIA_CHUNK_BYTES,mediaCommand,fileHash} from '../dist/media-ingest.js';

test('large course media: resumable upload, real transcoding, controlled seeking and timestamps',{timeout:600000},async t=>{
  let fixture=process.env.ACADEMY_LARGE_MEDIA_FIXTURE;
  if(!fixture){fixture=resolve(process.env.MEDIA_DIR,'large-source.mp4');await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=30:duration=115','-itsoffset','0.2','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=115','-c:v','libx264','-preset','ultrafast','-crf','0','-pix_fmt','yuv420p','-g','300','-c:a','aac',fixture],120000);}
  const source=resolve(fixture),size=(await stat(source)).size;assert.ok(size>200*1024*1024);
  const db=new Database();let app=await createApp(false);await app.listen(0,'127.0.0.1');let base=(await app.getUrl())+'/api/v1';
  const auth=app.get(AuthService),checks=[],metrics={sourceBytes:size};
  const origin='http://127.0.0.1:5173';
  async function actor(role,kind='ADMIN'){const user=await db.user.create({data:{nickname:'媒体专项'+randomUUID(),roles:[role]}}),credentials=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:credentials.accessHash,refreshHash:credentials.refreshHash,accessExpiresAt:credentials.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return {id:user.id,headers:kind==='APP'?{Authorization:'Bearer '+credentials.access}:{Cookie:'daoxue_access='+credentials.access,'X-CSRF-Token':csrfToken}};}
  async function call(path,who,method='GET',data){const multipart=data instanceof FormData;const res=await fetch(base+path,{method,headers:{Origin:origin,...(!multipart?{'Content-Type':'application/json'}:{}),...who?.headers},...(data===undefined?{}:{body:multipart?data:JSON.stringify(data)})});return {status:res.status,body:await res.json()};}
  const admin=await actor('ADMIN'),other=await actor('ADMIN'),support=await actor('SUPPORT'),student=await actor('USER','APP');
  const input={name:'道德经研习 · 大视频.mp4',mime:'video/mp4',bytes:size,fingerprint:await fileHash(source)};
  let upload,asset,ticket,lesson,course;
  async function chunk(offset,buffer){const form=new FormData();form.append('file',new Blob([buffer]),'chunk');return call('/admin/media/uploads/'+upload.id+'/chunks/'+offset,admin,'POST',form);}
  async function check(name,fn){await t.test(name,{timeout:600000},async()=>{await fn();checks.push(name);});}
  try{
    await check('upload limits, ownership, CSRF, capabilities and incomplete completion',async()=>{
      assert.equal((await call('/admin/media/uploads',support,'POST',input)).status,403);
      assert.equal((await call('/admin/media/uploads',admin,'POST',{...input,bytes:2147483648})).status,400);
      const noCsrf={headers:{Cookie:admin.headers.Cookie}};assert.equal((await call('/admin/media/uploads',noCsrf,'POST',input)).status,403);
      const created=await call('/admin/media/uploads',admin,'POST',input);assert.equal(created.status,201,JSON.stringify(created.body));upload=created.body;
      assert.equal((await call('/admin/media/uploads',admin,'POST',input)).body.id,upload.id);
      assert.equal((await call('/admin/media/uploads/'+upload.id,other)).status,404);
      assert.equal((await call('/admin/media/uploads/'+upload.id+'/complete',admin,'POST',{})).status,409);
      assert.equal((await chunk(100,Buffer.alloc(20))).status,409);
      assert.equal((await chunk(0,Buffer.alloc(MEDIA_CHUNK_BYTES+1))).status,413);
    });
    await check('greater than 200MiB upload survives restart, duplicate acknowledgement and chunk conflict',async()=>{
      const started=performance.now(),handle=await open(source,'r');let offset=0;
      try{
        while(offset<size){const bytes=Buffer.alloc(Math.min(MEDIA_CHUNK_BYTES,size-offset));await handle.read(bytes,0,bytes.length,offset);const result=await chunk(offset,bytes);assert.equal(result.status,201,JSON.stringify(result.body));offset=result.body.receivedBytes;
          if(offset===MEDIA_CHUNK_BYTES){assert.equal((await chunk(0,bytes)).body.receivedBytes,offset);const changed=Buffer.from(bytes);changed[400]^=1;assert.equal((await chunk(0,changed)).status,409);
            await app.close();app=await createApp(false);await app.listen(0,'127.0.0.1');base=(await app.getUrl())+'/api/v1';const resumed=await call('/admin/media/uploads',admin,'POST',input);assert.equal(resumed.body.id,upload.id);assert.equal(resumed.body.receivedBytes,offset);
          }
        }
      }finally{await handle.close();}metrics.uploadMs=Math.round(performance.now()-started);
      assert.equal(await fileHash(resolve(process.env.MEDIA_DIR,'uploads',upload.id+'.part')),input.fingerprint);
      const completed=await call('/admin/media/uploads/'+upload.id+'/complete',admin,'POST',{});assert.equal(completed.status,201);assert.equal(completed.body.state,'PROCESSING');asset=await db.mediaAsset.findUniqueOrThrow({where:{id:completed.body.assetId}});assert.equal(asset.status,'PROCESSING');
      assert.equal((await call('/admin/media/uploads/'+upload.id+'/complete',admin,'POST',{})).body.assetId,asset.id);assert.equal(await db.mediaAsset.count({where:{id:asset.id}}),1);
      assert.equal('storageKey' in (await call('/admin/media/assets/'+asset.id,admin)).body,false);
    });
    await check('real H264/AAC conversion, faststart, short GOP, original track offsets and full decode',async()=>{
      await db.mediaUpload.update({where:{id:upload.id},data:{leaseUntil:new Date(0),leaseToken:randomUUID(),attempts:1}});
      const started=performance.now();await app.get(MediaIngest).runJobs();metrics.processMs=Math.round(performance.now()-started);
      const status=(await call('/admin/media/uploads/'+upload.id,admin)).body;assert.equal(status.state,'READY',JSON.stringify(status));asset=await db.mediaAsset.findUniqueOrThrow({where:{id:asset.id}});assert.equal(asset.status,'READY');assert.equal(asset.variants.sourceSha256,input.fingerprint);metrics.outputBytes=asset.bytes;metrics.durationSeconds=asset.durationSeconds;
      const path=resolve(process.env.MEDIA_DIR,asset.storageKey),buffer=await readFile(path);assert.ok(buffer.indexOf(Buffer.from('moov'))<buffer.indexOf(Buffer.from('mdat')));
      const probe=async path=>JSON.parse(await mediaCommand(process.env.FFPROBE_PATH??'ffprobe',['-v','error','-show_streams','-show_format','-of','json',path]));
      const before=await probe(source),after=await probe(path),v=after.streams.find(s=>s.codec_type==='video'),a=after.streams.find(s=>s.codec_type==='audio');assert.equal(v.codec_name,'h264');assert.equal(v.pix_fmt,'yuv420p');assert.equal(a.codec_name,'aac');assert.equal(a.sample_rate,'48000');
      const delta=data=>Number(data.streams.find(s=>s.codec_type==='audio').start_time)-Number(data.streams.find(s=>s.codec_type==='video').start_time);
      metrics.sourceTrackOffsetMs=Math.round(delta(before)*1000);metrics.outputTrackOffsetMs=Math.round(delta(after)*1000);assert.ok(Math.abs(delta(before)-delta(after))<0.06,JSON.stringify(metrics));
      const endDelta=data=>{const audio=data.streams.find(s=>s.codec_type==='audio'),video=data.streams.find(s=>s.codec_type==='video');return Number(audio.start_time)+Number(audio.duration)-Number(video.start_time)-Number(video.duration);};
      metrics.sourceTrackEndOffsetMs=Math.round(endDelta(before)*1000);metrics.outputTrackEndOffsetMs=Math.round(endDelta(after)*1000);assert.ok(Math.abs(endDelta(before)-endDelta(after))<0.1,'Transcoding introduced end-of-file A/V drift');
      const frames=JSON.parse(await mediaCommand(process.env.FFPROBE_PATH??'ffprobe',['-v','error','-skip_frame','nokey','-select_streams','v:0','-show_frames','-show_entries','frame=pts_time','-of','json',path])).frames.map(row=>Number(row.pts_time));
      metrics.maxKeyframeGapSeconds=Math.max(...frames.slice(1).map((at,i)=>at-frames[i]));assert.ok(metrics.maxKeyframeGapSeconds<=2.01);
      await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-v','error','-xerror','-i',path,'-f','null','-'],120000);
      metrics.decodeSeekMs=[];for(const at of [10,55,95]){const start=performance.now();await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-v','error','-xerror','-ss',String(at),'-i',path,'-t','1','-f','null','-']);metrics.decodeSeekMs.push(Math.round(performance.now()-start));}
      assert.equal((await stat(path)).size,asset.bytes);assert.equal(await fileHash(path),asset.sha256);assert.equal((await call('/admin/media/uploads/'+upload.id+'/cancel',admin,'POST',{})).status,409);
    });
    await check('actual course publication uses media duration and paid access controls all Range requests',async()=>{
      const teacher=await db.teacher.create({data:{name:'大课件专项名师',title:'经典研习',bio:'隔离测试',status:'PUBLISHED'}});
      const chapter={title:'大视频研习',format:'VIDEO',body:'本讲研习资料',mediaId:asset.id,durationSeconds:asset.durationSeconds,trial:false,required:true};
      const draft={title:'道德经 · 大课件专项',subtitle:'分片上传与受控播放',description:'隔离验收',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:100,teacherId:teacher.id,membershipTier:null,accessDays:null,refundPolicy:'按售前约定',featured:false,tags:[],chapters:[chapter]};
      assert.equal((await call('/admin/courses',admin,'POST',{...draft,chapters:[{...chapter,durationSeconds:1}]})).status,400);
      let result=await call('/admin/courses',admin,'POST',draft);assert.equal(result.status,201,JSON.stringify(result.body));course=result.body;
      for(const action of ['submit','publish']){result=await call('/admin/courses/'+course.id+'/transition',admin,'POST',{action,expectedVersion:course.version,reason:'隔离媒体专项'});assert.equal(result.status,201,JSON.stringify(result.body));course=result.body;}
      lesson=await db.lesson.findFirstOrThrow({where:{release:{courseId:course.id}}});
      assert.equal((await call('/learning/lessons/'+lesson.id+'/media',student,'POST',{})).status,403);
      await db.enrollment.create({data:{userId:student.id,courseId:course.id,releaseId:lesson.releaseId,source:'MANUAL'}});
      const issued=await call('/learning/lessons/'+lesson.id+'/media',student,'POST',{});assert.equal(issued.status,201);ticket=issued.body;
      for(const range of ['bytes=0-65535','bytes=1000000-1065535','bytes=-65536']){const response=await fetch(base+ticket.path,{headers:{Range:range}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,65536);assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('x-accel-buffering'),'no');}
      assert.equal((await fetch(base+ticket.path,{headers:{Range:'bytes=99999999999-'}})).status,416);
      const head=await fetch(base+ticket.path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),asset.bytes);
      if(process.env.ACADEMY_BROWSER_MODULE){
        const {createRequire}=await import('node:module'),{chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');const browser=await chromium.launch({channel:'msedge',headless:true});
        try{const page=await browser.newPage();await page.goto(base+'/health');await page.setContent('<video controls muted preload="metadata" width="640"></video>');await page.evaluate(url=>{document.querySelector('video').src=url;},base+ticket.path);await page.waitForFunction(()=>document.querySelector('video').readyState>=1);metrics.browserSeeks=[];
          for(const at of [90,15,70,5]){const result=await page.evaluate(async at=>{const video=document.querySelector('video'),start=performance.now();return new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('seek timeout')),10000);video.addEventListener('seeked',()=>{clearTimeout(timer);yes({at:video.currentTime,ms:Math.round(performance.now()-start)});},{once:true});video.currentTime=at;});},at);assert.ok(Math.abs(result.at-at)<0.2);metrics.browserSeeks.push(result);}
          const counters=await page.evaluate(async()=>{const video=document.querySelector('video');await video.play();await new Promise(ok=>setTimeout(ok,2500));video.pause();const quality=video.getVideoPlaybackQuality();return {at:video.currentTime,dropped:quality.droppedVideoFrames,total:quality.totalVideoFrames};});assert.ok(counters.at>7);metrics.browserPlayback=counters;
        }finally{await browser.close();}
      }
      await db.enrollment.updateMany({where:{courseId:course.id,userId:student.id},data:{revokedAt:new Date()}});assert.equal((await fetch(base+ticket.path,{headers:{Range:'bytes=0-1023'}})).status,403);
    });
    await check('invalid media never becomes READY; retry, cancellation and expiration clean source files',async()=>{
      const bad={name:'损坏视频.mp4',mime:'video/mp4',bytes:24,fingerprint:createHash('sha256').update('bad').digest('hex')},created=await call('/admin/media/uploads',admin,'POST',bad),id=created.body.id;assert.equal(created.status,201);
      const form=new FormData();form.append('file',new Blob([Buffer.from('00000018667479706d7034320000000069736f6d6d703432','hex')]),'chunk');assert.equal((await call('/admin/media/uploads/'+id+'/chunks/0',admin,'POST',form)).status,201);
      const complete=await call('/admin/media/uploads/'+id+'/complete',admin,'POST',{});await app.get(MediaIngest).runJobs();assert.equal((await call('/admin/media/uploads/'+id,admin)).body.state,'FAILED');assert.equal((await db.mediaAsset.findUniqueOrThrow({where:{id:complete.body.assetId}})).status,'REJECTED');
      assert.equal((await call('/admin/media/uploads/'+id+'/retry',admin,'POST',{})).body.state,'PROCESSING');await app.get(MediaIngest).runJobs();assert.equal((await call('/admin/media/uploads/'+id+'/cancel',admin,'POST',{})).status,201);await assert.rejects(stat(resolve(process.env.MEDIA_DIR,'uploads',id+'.part')));
      const expired=await call('/admin/media/uploads',admin,'POST',{...bad,fingerprint:createHash('sha256').update('expired').digest('hex')});await db.mediaUpload.update({where:{id:expired.body.id},data:{expiresAt:new Date(Date.now()-1000)}});await app.get(MediaIngest).runJobs();assert.equal(await db.mediaUpload.count({where:{id:expired.body.id}}),0);
      const orphan=resolve(process.env.MEDIA_DIR,randomUUID()+'.'+randomUUID()+'.working.mp4');await writeFile(orphan,'interrupted encoder output');await utimes(orphan,new Date(0),new Date(0));await app.get(MediaIngest).runJobs();await assert.rejects(stat(orphan));
    });
  }finally{
    if(process.env.ACADEMY_MEDIA_EVIDENCE_DIR){await mkdir(process.env.ACADEMY_MEDIA_EVIDENCE_DIR,{recursive:true});await writeFile(resolve(process.env.ACADEMY_MEDIA_EVIDENCE_DIR,'large-media.json'),JSON.stringify({checks,metrics,isolatedDatabase:true,nativeVerified:false},null,2));}
    await app.close();await db.$disconnect();
  }
});
