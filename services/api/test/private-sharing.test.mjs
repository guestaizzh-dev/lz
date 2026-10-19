import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';

test('private sharing requires explicit consent and preserves private originals',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService);
  async function actor(role,kind='APP'){const u=await db.user.create({data:{nickname:randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:u.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return{id:u.id,...(kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken})};}
  async function call(path,who,method='GET',body){const headers={Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...(who??{})};delete headers.id;const r=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};}
  async function post(path,data,who){const r=await call(path,who,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  try{
    const owner=await actor('USER'),other=await actor('USER'),admin=await actor('ADMIN','ADMIN'),section=await db.forumSection.create({data:{code:'private-share:'+randomUUID(),title:'研习心得',scope:'PUBLIC',description:'公共研习',active:true}});
    let article=await post('/admin/articles',{title:'道德经 · 经典原文',summary:'公开经典',category:'经典原文',author:'书院',source:'隔离样例',cover:'/static/art/books.svg',tags:[],visibility:'PUBLIC',membershipTier:1,featured:false,blocks:[{id:'water',type:'paragraph',text:'上善若水。水善利万物而不争。'}]},admin);
    for(const action of ['submit','publish'])article=await post('/admin/articles/'+article.id+'/transition',{action,reason:'核查测试原文',expectedVersion:article.version},admin);
    const note=await post('/me/notes',{articleId:article.id,articleVersion:article.version,blockId:'water',rangeStart:0,rangeEnd:4,text:'自己记录的初次理解，尚未对外分享。'},owner);
    const journal=(await call('/me/practice',owner,'PUT',{day:'2026-10-15',text:'今日放慢脚步，先听后说。',expectedVersion:0})).body;
    const body=(source,changes={})=>({requestKey:randomUUID(),sectionId:section.id,title:'水与日常实践',body:'我主动选取并编辑的心得。',assetIds:[],tags:[],privateSource:{kind:'NOTE',id:source.id,version:source.version,consent:true,includeQuote:false},...changes});
    await t.test('preview is owner-only and record creation never automatically makes a thread',async()=>{
      assert.equal(await db.forumThread.count({where:{authorId:owner.id}}),0);
      assert.equal((await call('/forum/private-sources/NOTE/'+note.id,other)).status,404);assert.equal((await call('/forum/private-sources/JOURNAL/'+journal.id,other)).status,404);assert.equal((await call('/forum/private-sources/NOTE/'+note.id)).status,401);
      const preview=(await call('/forum/private-sources/NOTE/'+note.id,owner)).body;assert.equal(preview.text,note.text);assert.equal(preview.quote,'上善若水');assert.equal(preview.canIncludeQuote,true);
      const journalPreview=(await call('/forum/private-sources/JOURNAL/'+journal.id,owner)).body;assert.equal(journalPreview.canIncludeQuote,false);
    });
    let shared;
    await t.test('explicit confirmation, fresh source version and idempotency are required',async()=>{
      for(const source of [{...body(note).privateSource,consent:false},{...body(note).privateSource,version:99},{...body(note).privateSource,id:journal.id}]){const r=await call('/forum/threads',owner,'POST',body(note,{privateSource:source}));assert.ok([400,404,409].includes(r.status));}
      const payload=body(note,{privateSource:{...body(note).privateSource,includeQuote:true}}),results=await Promise.all([call('/forum/threads',owner,'POST',payload),call('/forum/threads',owner,'POST',payload)]);assert.ok(results.every(r=>r.status===201));assert.equal(results[0].body.id,results[1].body.id);shared=results[0].body;
      assert.equal(await db.consentRecord.count({where:{userId:owner.id,policyCode:'PRIVATE_RECORD_SHARING',purpose:'forum-thread:'+shared.id}}),1);assert.equal((await call('/forum/threads/'+shared.id,other)).status,404);
      assert.equal((await call('/forum/threads',owner,'POST',{...payload,body:'换了内容'})).status,409);assert.equal((await db.note.findUniqueOrThrow({where:{id:note.id}})).text,note.text);
    });
    await t.test('approved snapshots do not change with private edits and never expose private source IDs',async()=>{
      await post('/admin/forum/threads/'+shared.id+'/moderate',{action:'APPROVE',expectedVersion:1,reason:'核查作者公开授权及片段'},admin);
      await call('/me/notes/'+note.id,owner,'PATCH',{text:'私下新增的第二次理解，不公开。'});
      const visible=(await call('/forum/threads/'+shared.id,other)).body;assert.ok(JSON.stringify(visible.blocks).includes('上善若水'));assert.ok(JSON.stringify(visible.blocks).includes('我主动选取并编辑的心得'));assert.ok(!JSON.stringify(visible).includes('私下新增'));assert.ok(!JSON.stringify(visible).includes(note.id));
      const stale=await call('/forum/threads',owner,'POST',body(note));assert.equal(stale.status,409);
      const resource=await db.resource.findUniqueOrThrow({where:{id:shared.id}});assert.ok(!resource.summary.includes('上善若水'));
    });
    await t.test('source unpublication immediately removes automatic quotes and citation links',async()=>{
      await db.article.update({where:{id:article.id},data:{status:'ARCHIVED'}});const visible=(await call('/forum/threads/'+shared.id,other)).body;assert.equal(visible.citation,null);assert.ok(!JSON.stringify(visible.blocks).includes('上善若水'));assert.ok(JSON.stringify(visible.blocks).includes('我主动选取'));
      const current=await db.note.findUniqueOrThrow({where:{id:note.id}});assert.equal((await call('/forum/private-sources/NOTE/'+note.id,owner)).body.canIncludeQuote,false);assert.equal((await call('/forum/threads',owner,'POST',body(current,{privateSource:{...body(current).privateSource,includeQuote:true}}))).status,400);
    });
    await t.test('journal selection is independent and private images cannot be reused for public sharing',async()=>{
      const privateSource={kind:'JOURNAL',id:journal.id,version:journal.version,consent:true,includeQuote:false};
      const asset=await db.mediaAsset.create({data:{uploaderId:owner.id,name:'私人照片.png',storageKey:randomUUID(),mime:'image/png',bytes:10,status:'READY',visibility:'PRIVATE',variants:{uploadPurpose:'PRACTICE_IMAGE'}}});assert.equal((await call('/forum/threads',owner,'POST',body(journal,{privateSource,assetIds:[asset.id]}))).status,400);
      const posted=await post('/forum/threads',body(journal,{privateSource,body:'只分享今天的倾听心得。'}),owner);assert.equal(posted.state,'REVIEW');assert.equal((await db.practiceLog.findUniqueOrThrow({where:{id:journal.id}})).text,journal.text);
      assert.equal((await call('/forum/threads',owner,'POST',body(journal,{privateSource:{...privateSource,includeQuote:true}}))).status,400);
    });
    await t.test('owner can revoke hidden shares, consent history stays and moderators cannot restore revoked authorization',async()=>{
      const current=await db.forumThread.findUniqueOrThrow({where:{id:shared.id}});await post('/admin/forum/threads/'+shared.id+'/moderate',{action:'HIDE',expectedVersion:current.version,reason:'暂时隐藏后由本人撤回'},admin);
      const hidden=await db.forumThread.findUniqueOrThrow({where:{id:shared.id}});assert.equal((await call('/forum/threads/'+shared.id+'/withdraw',other,'POST',{expectedVersion:hidden.version})).status,404);
      await post('/forum/threads/'+shared.id+'/withdraw',{expectedVersion:hidden.version},owner);assert.equal((await call('/forum/threads/'+shared.id,other)).status,404);
      const consents=await db.consentRecord.findMany({where:{userId:owner.id,purpose:'forum-thread:'+shared.id},orderBy:{actedAt:'asc'}});assert.deepEqual(consents.map(c=>c.accepted),[true,false]);const revoked=await db.forumThread.findUniqueOrThrow({where:{id:shared.id}});
      assert.equal((await call('/admin/forum/threads/'+shared.id+'/moderate',admin,'POST',{action:'RESTORE',expectedVersion:revoked.version,reason:'不能代替作者重新授权'})).status,409);assert.ok(await db.note.findUnique({where:{id:note.id}}));
    });
  }finally{await app.close();await db.$disconnect();}
});
