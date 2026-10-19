import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';

test('finite article templates freeze with publication and never rewrite private note ranges',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');
  const root=await db.user.create({data:{nickname:'排版审核',roles:['ADMIN']}}),user=await db.user.create({data:{nickname:'研习同窗'}}),auth=app.get(AuthService),base=(await app.getUrl())+'/api/v1',c=auth.credentials(),csrfToken=randomUUID();
  await db.authSession.create({data:{userId:root.id,kind:'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});
  async function call(path,method='GET',data){const r=await fetch(base+path,{method,headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json',Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:r.status,body:await r.json()};}
  const dto={title:'上善若水 · 古籍研读',summary:'从原文读起',author:'编者',source:'隔离验证样例',category:'经典原文',cover:'/static/art/books.svg',tags:[],visibility:'PUBLIC',membershipTier:1,featured:false,blocks:[{id:'water',type:'paragraph',text:'上善若水。水善利万物而不争。'},{id:'quote',type:'quote',text:'道法自然。'}]};
  let article,note;
  async function transition(action){const r=await call('/admin/articles/'+article.id+'/transition','POST',{action,expectedVersion:article.version,reason:'有限模板发布测试'});assert.equal(r.status,201,JSON.stringify(r.body));article=r.body;}
  try{
    await t.test('only finite template codes are accepted; no arbitrary HTML or CSS input',async()=>{
      for(const draftTemplateCode of ['unknown','<script>alert(1)</script>','ink'])assert.equal((await call('/admin/articles','POST',{...dto,draftTemplateCode})).status,400);
      const r=await call('/admin/articles','POST',{...dto,draftTemplateCode:'CLASSIC'});assert.equal(r.status,201);article=r.body;
      await transition('submit');await transition('publish');assert.equal((await call('/catalog/articles/'+article.id)).body.templateCode,'CLASSIC');
      const release=await db.articleRelease.findUniqueOrThrow({where:{id:article.currentReleaseId}});assert.equal(release.templateCode,'CLASSIC');
    });
    let original,firstRelease;
    await t.test('published appearance cannot be changed without revision and review',async()=>{
      note=await db.note.create({data:{userId:user.id,articleId:article.id,articleTitle:article.title,articleVersion:article.version,blockId:'water',quote:'上善若水',text:'我的心得',rangeStart:0,rangeEnd:4,ranges:[{blockId:'water',rangeStart:0,rangeEnd:4}]}});original=JSON.stringify(note);firstRelease=article.currentReleaseId;
      assert.equal((await call('/admin/articles/'+article.id,'PATCH',{...dto,draftTemplateCode:'INK',expectedVersion:article.version})).status,409);
      await transition('archive');await transition('revise');const r=await call('/admin/articles/'+article.id,'PATCH',{...dto,draftTemplateCode:'INK',expectedVersion:article.version});assert.equal(r.status,200);article=r.body;await transition('submit');await transition('publish');assert.equal((await call('/catalog/articles/'+article.id)).body.templateCode,'INK');assert.equal((await db.articleRelease.findUniqueOrThrow({where:{id:firstRelease}})).templateCode,'CLASSIC');
      assert.deepEqual((await db.articleBlock.findMany({where:{releaseId:article.currentReleaseId},orderBy:{position:'asc'}})).map(b=>b.stableKey),['water','quote']);assert.equal(JSON.stringify(await db.note.findUniqueOrThrow({where:{id:note.id}})),original);
    });
    await t.test('default rollback preserves snapshots; legacy and private previews do not leak text',async()=>{
      await transition('archive');await transition('revise');const r=await call('/admin/articles/'+article.id,'PATCH',{...dto,draftTemplateCode:'PLAIN',expectedVersion:article.version});assert.equal(r.status,200);article=r.body;await transition('submit');await transition('publish');assert.equal((await call('/catalog/articles/'+article.id)).body.templateCode,'PLAIN');assert.equal(JSON.stringify(await db.note.findUniqueOrThrow({where:{id:note.id}})),original);
      const legacy=await db.article.create({data:{...dto,status:'PUBLISHED',draftTemplateCode:'INK'}});assert.equal((await call('/catalog/articles/'+legacy.id)).body.templateCode,'PLAIN');await db.article.update({where:{id:legacy.id},data:{visibility:'MEMBER'}});const locked=(await call('/catalog/articles/'+legacy.id)).body;assert.equal(locked.access,'MEMBERSHIP_REQUIRED');assert.deepEqual(locked.blocks,[]);assert.ok(!JSON.stringify(locked).includes('道法自然'));
    });
  }finally{await app.close();await db.$disconnect();}
});
