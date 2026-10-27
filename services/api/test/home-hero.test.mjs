import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {MediaIngest,mediaCommand} from '../dist/media-ingest.js';

test('home hero supports verified images and public-only selected video',async t=>{
  const app=await createApp(false),db=app.get(Database);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService),origin='http://127.0.0.1:5173';
  async function actor(role){const user=await db.user.create({data:{nickname:'首页配置测试'+randomUUID(),roles:[role]}}),c=auth.credentials(),csrf=randomUUID();await db.authSession.create({data:{userId:user.id,kind:'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});return{headers:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrf}};}
  async function call(path,who,method='GET',data){const multipart=data instanceof FormData;const response=await fetch(base+path,{method,headers:{Origin:origin,...(multipart?{}:{'Content-Type':'application/json'}),...who?.headers},...(data===undefined?{}:{body:multipart?data:JSON.stringify(data)})});return{status:response.status,body:await response.json()};}
  const admin=await actor('ADMIN'),other=await actor('ADMIN');let revision=0,imageIds=[],videoId='';
  const save=async value=>call('/admin/config/homeHero',admin,'PUT',{expectedRevision:revision,value,reason:'首页展示测试'});
  try{
    await t.test('no configuration preserves the existing default',async()=>{const result=await call('/configuration/home-hero');assert.deepEqual(result.body,{images:[],video:''});});
    await t.test('one or more uploaded images can be saved and reordered safely',async()=>{
      const path=resolve(process.env.MEDIA_DIR,'home-image.jpg');await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-y','-v','error','-f','lavfi','-i','color=red:size=320x160','-frames:v','1','-threads','1',path]);const bytes=await readFile(path);
      for(let i=0;i<2;i++){const data=new FormData();data.append('file',new Blob([bytes],{type:'image/jpeg'}),'home.jpg');const image=await call('/admin/images',admin,'POST',data);assert.equal(image.status,201,JSON.stringify(image.body));imageIds.push(image.body.id);}
      let result=await save({images:[imageIds[0]],videoId:''});assert.equal(result.status,200,JSON.stringify(result.body));revision=result.body.revision;
      assert.deepEqual((await call('/configuration/home-hero')).body.images,['/api/v1/assets/images/'+imageIds[0]]);
      result=await save({images:[imageIds[1],imageIds[0]],videoId:''});assert.equal(result.status,200);revision=result.body.revision;
      assert.deepEqual((await call('/configuration/home-hero')).body.images,imageIds.slice().reverse().map(id=>'/api/v1/assets/images/'+id));
      assert.equal((await save({images:[randomUUID()],videoId:''})).status,400);
      assert.equal((await save({images:[imageIds[0],imageIds[0]],videoId:''})).status,400);
      assert.equal((await call('/admin/config/homeHero',admin,'PUT',{expectedRevision:0,value:{images:[],videoId:''},reason:'并发测试'})).status,409);
    });
    await t.test('video upload is isolated, transcoded and served only while selected',async()=>{
      const path=resolve(process.env.MEDIA_DIR,'home-video.mp4');await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-nostdin','-y','-v','error','-f','lavfi','-i','testsrc2=size=320x160:rate=24','-t','1','-c:v','libx264','-pix_fmt','yuv420p',path]);const bytes=await readFile(path);
      const dto={name:'首页视频.mp4',mime:'video/mp4',bytes:bytes.length,fingerprint:createHash('sha256').update(bytes).digest('hex')};
      const task=await call('/admin/media/uploads/home-hero',admin,'POST',dto);assert.equal(task.status,201,JSON.stringify(task.body));
      assert.equal((await call('/admin/media/uploads/home-hero/'+task.body.id,other)).status,404);
      const form=new FormData();form.append('file',new Blob([bytes]),'chunk');assert.equal((await call('/admin/media/uploads/home-hero/'+task.body.id+'/chunks/0',admin,'POST',form)).status,201);
      const complete=await call('/admin/media/uploads/home-hero/'+task.body.id+'/complete',admin,'POST',{});assert.equal(complete.status,201);videoId=complete.body.assetId;
      assert.equal((await save({images:[],videoId})).status,400);
      await app.get(MediaIngest).runJobs();const status=await call('/admin/media/uploads/home-hero/'+task.body.id,admin);assert.equal(status.body.state,'READY',JSON.stringify(status.body));
      assert.equal((await call('/admin/media/uploads/home-hero/'+task.body.id+'/asset',admin)).body.id,videoId);
      assert.equal((await call('/admin/media/assets/'+videoId,admin)).status,404);
      assert.equal((await fetch(base+'/media/stream?homeHero='+videoId)).status,404);
      assert.equal((await save({images:[imageIds[0]],videoId})).status,400);
      const result=await save({images:[],videoId});assert.equal(result.status,200,JSON.stringify(result.body));revision=result.body.revision;
      assert.equal((await call('/configuration/home-hero')).body.video,'/api/v1/media/stream?homeHero='+videoId);
      const range=await fetch(base+'/media/stream?homeHero='+videoId,{headers:{Range:'bytes=0-63'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,64);
      const removed=await save({images:[],videoId:''});assert.equal(removed.status,200);assert.equal((await fetch(base+'/media/stream?homeHero='+videoId)).status,404);
    });
  }finally{await app.close();}
});
