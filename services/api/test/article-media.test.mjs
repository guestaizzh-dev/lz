import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';

test('article multimedia: publication, private tickets, revision and entitlement revocation',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService);
  async function actor(role,kind='ADMIN'){
    const user=await db.user.create({data:{nickname:randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});
    return {id:user.id,...(kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken})};
  }
  async function call(path,actor,method='GET',data){const headers={Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...(actor??{})};delete headers.id;const r=await fetch(base+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:await r.json()};}
  let admin,operator,moderator,student,asset,audio,article,preview,oldTicket;
  const blocks=()=>[{id:'p-water',type:'paragraph',text:'上善若水，水善利万物而不争。'},{id:'v-water',type:'video',text:'',mediaId:asset.id,caption:'视频讲解'},{id:'a-water',type:'audio',text:'',mediaId:audio.id,caption:'静心聆听'},{id:'q-water',type:'quote',text:'道法自然。'}];
  const draft=(overrides={})=>({title:'道德经 · 水之德',summary:'原文、视频与音频共同研习',category:'经典原文',author:'测试编者',source:'隔离测试，不作为实际版权',cover:'/static/art/books.svg',tags:[],visibility:'PUBLIC',membershipTier:1,featured:false,blocks:blocks(),...overrides});
  async function post(path,data,who=admin){const r=await call(path,who,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  async function transition(action){article=await post('/admin/articles/'+article.id+'/transition',{action,expectedVersion:article.version,reason:'隔离测试审核'});}
  try{
    admin=await actor('ADMIN');operator=await actor('OPERATOR');moderator=await actor('MODERATOR');student=await actor('USER','APP');
    // Header bytes test delivery authorization; decoding is covered by the real browser fixture.
    const bytes=Buffer.from('00000018667479706d7034320000000069736f6d6d703432','hex');
    for(const mime of ['video/mp4','audio/mp4']){const storageKey=randomUUID();await writeFile(resolve(process.env.MEDIA_DIR,storageKey),bytes);const row=await db.mediaAsset.create({data:{storageKey,name:'文章研习媒体',mime,bytes:bytes.length,uploaderId:admin.id,status:'READY',visibility:'PRIVATE'}});if(mime==='video/mp4')asset=row;else audio=row;}
    await t.test('draft rejects unavailable media, wrong type, private attachments and external playback URLs',async()=>{
      for(const status of ['PROCESSING','REVIEW','REJECTED','DELETED']){await db.mediaAsset.update({where:{id:asset.id},data:{status}});assert.equal((await call('/admin/articles',admin,'POST',draft())).status,400);}
      await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY',variants:{uploadPurpose:'FORUM_IMAGE'}}});assert.equal((await call('/admin/articles',admin,'POST',draft())).status,400);
      await db.mediaAsset.update({where:{id:asset.id},data:{variants:{}}});
      assert.equal((await call('/admin/articles',admin,'POST',draft({blocks:[{id:'bad',type:'audio',text:'',mediaId:asset.id}]}))).status,400);
      assert.equal((await call('/admin/articles',admin,'POST',draft({blocks:[{id:'bad',type:'video',text:'',url:'https://example.org/private.mp4'}]}))).status,400);
      assert.equal((await call('/admin/articles',admin,'POST',draft({blocks:[{id:'bad',type:'video',text:'',mediaId:asset.id,url:'https://example.org/private.mp4'}]}))).status,400);
      article=await post('/admin/articles',draft());
      assert.equal((await call('/articles/'+article.id+'/blocks/v-water/media',student,'POST',{})).status,404);
      assert.equal((await call('/admin/articles/'+article.id+'/blocks/v-water/media',student,'POST',{})).status,403);
      preview=await post('/admin/articles/'+article.id+'/blocks/v-water/media',{},moderator);assert.equal((await fetch(base+preview.path,{headers:{Range:'bytes=0-7'}})).status,206);
    });
    await t.test('submit and publish recheck media in a rollback-safe workflow',async()=>{
      await db.mediaAsset.update({where:{id:asset.id},data:{status:'PROCESSING'}});assert.equal((await call('/admin/articles/'+article.id+'/transition',admin,'POST',{action:'submit',expectedVersion:article.version,reason:'失败送审'})).status,400);assert.equal((await db.article.findUniqueOrThrow({where:{id:article.id}})).status,'DRAFT');
      await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY'}});await transition('submit');
      await db.mediaAsset.update({where:{id:audio.id},data:{status:'REJECTED'}});assert.equal((await call('/admin/articles/'+article.id+'/transition',admin,'POST',{action:'publish',expectedVersion:article.version,reason:'失败发布'})).status,400);assert.equal((await db.article.findUniqueOrThrow({where:{id:article.id}})).status,'REVIEW');
      await db.mediaAsset.update({where:{id:audio.id},data:{status:'READY'}});await transition('publish');
      const fixed=await db.articleBlock.findMany({where:{releaseId:article.currentReleaseId},orderBy:{position:'asc'}});assert.deepEqual(fixed.map(b=>b.kind),['PARAGRAPH','VIDEO','AUDIO','QUOTE']);assert.equal(fixed[1].mediaId,asset.id);
      assert.equal((await fetch(base+preview.path)).status,404);
    });
    await t.test('mixed article is readable, tickets support Range/HEAD and media failure leaves text accessible',async()=>{
      const detail=await call('/catalog/articles/'+article.id);assert.equal(detail.body.blocks.length,4);assert.ok(!JSON.stringify(detail.body).includes(asset.storageKey));
      oldTicket=await post('/articles/'+article.id+'/blocks/v-water/media',{},null);assert.equal((await fetch(base+oldTicket.path,{headers:{Range:'bytes=0-7'}})).status,206);assert.equal((await fetch(base+oldTicket.path,{method:'HEAD'})).status,200);
      assert.equal((await post('/articles/'+article.id+'/blocks/a-water/media',{},student)).mime,'audio/mp4');
      assert.equal((await call('/articles/'+article.id+'/blocks/p-water/media',null,'POST',{})).status,404);
      await db.mediaAsset.update({where:{id:asset.id},data:{status:'REJECTED'}});assert.equal((await fetch(base+oldTicket.path)).status,404);assert.equal((await call('/catalog/articles/'+article.id)).body.blocks[0].text,blocks()[0].text);await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY'}});
      await unlink(resolve(process.env.MEDIA_DIR,audio.storageKey));assert.equal((await call('/articles/'+article.id+'/blocks/a-water/media',null,'POST',{})).status,404);assert.equal((await call('/catalog/articles/'+article.id)).status,200);
    });
    await t.test('stable block references survive reorder and revision, with old media tickets revoked',async()=>{
      const note=await post('/me/notes',{articleId:article.id,articleVersion:article.version,blockId:'p-water',rangeStart:0,rangeEnd:4,text:'水之德'},student);assert.equal(note.quote,'上善若水');
      await transition('archive');assert.equal((await fetch(base+oldTicket.path)).status,404);assert.equal((await call('/catalog/articles/'+article.id)).status,404);await transition('revise');
      const update=await call('/admin/articles/'+article.id,admin,'PATCH',{...draft({blocks:blocks().filter(b=>b.type!=='audio').reverse()}),expectedVersion:article.version});assert.equal(update.status,200);article=update.body;await transition('submit');await transition('publish');
      assert.equal((await fetch(base+oldTicket.path)).status,404);assert.equal((await call('/me/notes',student)).body.items.find(n=>n.id===note.id).quote,'上善若水');
    });
    await t.test('member article returns no blocks or ticket to guests and rechecks membership on every Range',async()=>{
      await transition('archive');await transition('revise');const changed=await call('/admin/articles/'+article.id,admin,'PATCH',{...draft({visibility:'MEMBER',blocks:blocks().filter(b=>b.type!=='audio')}),expectedVersion:article.version});assert.equal(changed.status,200);article=changed.body;await transition('submit');await transition('publish');
      assert.deepEqual((await call('/catalog/articles/'+article.id)).body.blocks,[]);assert.equal((await call('/articles/'+article.id+'/blocks/v-water/media',student,'POST',{})).status,403);
      const plan=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:1,days:30}}}),member=await post('/admin/memberships/grant',{userId:student.id,planId:plan.id,reason:'隔离测试会员授权'});
      const ticket=await post('/articles/'+article.id+'/blocks/v-water/media',{},student);assert.equal((await fetch(base+ticket.path)).status,200);
      await db.membership.update({where:{id:member.id},data:{revokedAt:new Date()}});assert.equal((await fetch(base+ticket.path,{headers:{Range:'bytes=0-7'}})).status,403);
    });
    await t.test('admin permission and session revocation invalidate existing preview URLs',async()=>{
      const ticket=await post('/admin/articles/'+article.id+'/blocks/v-water/media',{},operator);const role=await db.accessRole.findUniqueOrThrow({where:{code:'OPERATOR'}});
      try{await db.accessRole.update({where:{id:role.id},data:{permissionCodes:role.permissionCodes.filter(p=>p!=='content.read')}});assert.equal((await fetch(base+ticket.path)).status,403);}finally{await db.accessRole.update({where:{id:role.id},data:{permissionCodes:role.permissionCodes}});}
      await db.authSession.updateMany({where:{userId:operator.id},data:{revokedAt:new Date()}});assert.equal((await fetch(base+ticket.path)).status,401);
    });
  }finally{await app.close();await db.$disconnect();}
});
