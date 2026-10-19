import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';

test('private Markdown export: real HTTP filters, China dates, stable grouping and isolation',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/v1',users=[],articleIds=[];
  const account=async()=>{const user=await db.user.create({data:{nickname:'导出测试',tags:[]}});users.push(user.id);const c=app.get(AuthService).credentials();await db.authSession.create({data:{userId:user.id,kind:'APP',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,csrfToken:randomUUID(),expiresAt:new Date(Date.now()+86400000)}});return{id:user.id,access:c.access};};
  const call=async(query='',actor)=>{const r=await fetch(base+'/me/notes/export'+query,{headers:actor?{Authorization:'Bearer '+actor.access}:{}});return{status:r.status,body:await r.json()};};
  let a,b,article,duplicate,member;
  try{
    a=await account();b=await account();
    const create=async(extra={})=>{const row=await db.article.create({data:{title:'同名经典',summary:'公开简介',author:'编者',source:'隔离样例',category:'经典原文',tags:[],cover:'',blocks:[{id:'p',type:'paragraph',text:'上善若水'}],status:'PUBLISHED',...extra}});articleIds.push(row.id);return row;};
    article=await create();duplicate=await create();member=await create({visibility:'MEMBER',membershipTier:3,title:'会员典籍',blocks:[{id:'p',type:'paragraph',text:'不得导出未授权原文'}]});
    const note=async(actor,id,text,time,range=false)=>db.note.create({data:{userId:actor.id,articleId:id,articleTitle:'同名经典',articleVersion:1,blockId:'p',quote:'上善若水',text,createdAt:new Date(time),...(range?{rangeStart:0,rangeEnd:4,ranges:[{blockId:'p',rangeStart:0,rangeEnd:4}]}:{})}});
    await note(a,article.id,'日界前','2026-10-14T15:59:59Z');await note(a,article.id,'<script>私人的心得</script> [链接](javascript:evil)','2026-10-14T16:00:00Z',true);await note(a,duplicate.id,'','2026-10-15T15:59:59Z',true);await note(a,article.id,'次日记录','2026-10-15T16:00:00Z');await note(b,article.id,'绝对不能出现的他人笔记','2026-10-15T01:00:00Z',true);
    const removed=await note(a,article.id,'已删除不能导出','2026-10-15T01:00:00Z');await db.note.update({where:{id:removed.id},data:{deletedAt:new Date()}});
    await db.favorite.createMany({data:[{userId:a.id,articleId:article.id,createdAt:new Date('2026-10-15T01:00:00Z')},{userId:a.id,articleId:member.id,createdAt:new Date('2026-10-15T02:00:00Z')},{userId:b.id,articleId:duplicate.id}]});
    await t.test('China midnight boundaries are inclusive by day, both filters and snapshots stay private',async()=>{
      const r=await call('?fromDay=2026-10-15&toDay=2026-10-15',a);assert.equal(r.status,200);assert.deepEqual(r.body.counts,{notes:2,favorites:2});
      assert.match(r.body.markdown,/2026-10-15 00:00:00（北京时间）/);assert.match(r.body.markdown,/2026-10-15 23:59:59（北京时间）/);
      for(const text of ['日界前','次日记录','绝对不能出现','已删除不能导出','不得导出未授权原文','<script>','[链接](javascript:evil)'])assert.ok(!r.body.markdown.includes(text),text);
      assert.match(r.body.filename,/^daoxue-notes-\d{14}\.md$/);assert.equal(r.body.markdown.match(/### 同名经典/g).length,2);
    });
    await t.test('scope and search distinguish typed notes, highlights and favorites',async()=>{
      assert.deepEqual((await call('?scope=notes',a)).body.counts,{notes:3,favorites:0});
      assert.deepEqual((await call('?scope=highlights',a)).body.counts,{notes:2,favorites:0});
      assert.deepEqual((await call('?scope=favorites',a)).body.counts,{notes:0,favorites:2});
      assert.deepEqual((await call('?q='+encodeURIComponent('私人的心得'),a)).body.counts,{notes:1,favorites:0});
      assert.deepEqual((await call('?scope=favorites&q='+encodeURIComponent('会员典籍'),a)).body.counts,{notes:0,favorites:1});
    });
    await t.test('article filter cannot reach another owner, unknown IDs return an honest empty export',async()=>{
      assert.deepEqual((await call('?articleId='+duplicate.id,a)).body.counts,{notes:1,favorites:0});
      assert.deepEqual((await call('?articleId='+randomUUID(),a)).body.counts,{notes:0,favorites:0});
      const r=await call('',b);assert.equal(r.body.counts.notes,1);assert.ok(!r.body.markdown.includes('私人的心得'));
      assert.equal((await call('')).status,401);
    });
    await t.test('sort orders are explicit and stable',async()=>{
      const newest=(await call('?sort=newest&scope=notes',a)).body.markdown,oldest=(await call('?sort=oldest&scope=notes',a)).body.markdown;
      assert.ok(newest.indexOf('次日记录')<newest.indexOf('日界前'));assert.ok(oldest.indexOf('日界前')<oldest.indexOf('次日记录'));
    });
    await t.test('invalid ranges and unknown input are rejected',async()=>{
      for(const query of ['?fromDay=2026-02-30','?fromDay=2026-10-16&toDay=2026-10-15','?sort=random','?scope=all&userId='+b.id,'?articleId=wrong','?q='+('a'.repeat(81))])assert.equal((await call(query,a)).status,400,query);
    });
    await t.test('withdrawn favorite hides metadata but the user retains their own captured note',async()=>{
      await db.article.update({where:{id:article.id},data:{status:'ARCHIVED'}});
      const r=await call('?articleId='+article.id,a);assert.match(r.body.markdown,/内容已下架/);assert.match(r.body.markdown,/上善若水/);assert.ok(!r.body.markdown.includes('公开简介'));
    });
    await t.test('oversized exports fail explicitly instead of returning partial content',async()=>{
      await db.note.createMany({data:Array.from({length:230},()=>({userId:a.id,articleId:duplicate.id,articleTitle:'体积边界',articleVersion:1,blockId:'p',quote:'上善若水',text:'水'.repeat(10000)}))});
      const large=await call('?articleId='+duplicate.id,a);assert.equal(large.status,400);assert.match(large.body.message,/分批导出/);assert.equal(large.body.markdown,undefined);
      const filtered=await call('?articleId='+duplicate.id+'&q='+encodeURIComponent('不会命中'),a);assert.equal(filtered.status,200);assert.equal(filtered.body.counts.notes,0);
    });
  }finally{await db.favorite.deleteMany({where:{userId:{in:users}}});await db.note.deleteMany({where:{userId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.article.deleteMany({where:{id:{in:articleIds}}});await db.user.deleteMany({where:{id:{in:users}}});await app.close();await db.$disconnect();}
});
