import {phoneLookup} from '../dist/private-data.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {clearArticles,clearCourses,clearProducts} from './fixture-cleanup.mjs';

const url=new URL(process.env.DATABASE_URL??'');
if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Content fixtures require local test database');
test('content and discovery: real HTTP publication, privacy, moderation, search and export',async t=>{
  const origin='http://127.0.0.1:5173';process.env.CORS_ORIGINS=origin;process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false);app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/v1',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1',prefix='qa-content-'+randomUUID(),password=randomUUID()+'!A';
  const users=[],articles=[],teachers=[],courses=[],products=[],events=[],rooms=[],evidence=[],phones=[],tagIds=[];
  async function call(path,auth,method='GET',body){const res=await fetch(base+path,{method,headers:{Origin:origin,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:res.status,body:data,cookies:res.headers.getSetCookie()};}
  async function adminAccount(role){const row=await db.user.create({data:{username:prefix+'-'+role,nickname:role,roles:[role],passwordHash:await passwordHash(password)}});users.push(row.id);const r=await call('/admin/auth/login',null,'POST',{username:row.username,password});assert.equal(r.status,200);return{id:row.id,cookie:r.cookies.map(x=>x.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function appAccount(){const phone='197'+String(randomInt(0,100000000)).padStart(8,'0');phones.push(phone);const c=await call('/auth/sms',null,'POST',{phone});assert.equal(c.status,201);const r=await call('/auth/login',null,'POST',{phone,challengeId:c.body.challengeId,code:'123456'});assert.equal(r.status,200);users.push(r.body.user.id);return{...r.body,id:r.body.user.id};}
  const tagName='qa-'+randomUUID().slice(0,8);
  const text='上善若水。水善利万物而不争。水善利万物而不争。😀';
  const draft=(overrides={})=>({title:prefix+'文章',summary:'水的研习与实践',category:'经典原文',author:'测试编者',source:'测试版本，不作为真实授权',cover:'/static/art/books.svg',tags:[tagName],visibility:'PUBLIC',membershipTier:1,featured:false,blocks:[{id:'p-water',type:'paragraph',text},{id:'p-more',type:'paragraph',text:'知行相照，静心研习。'},{id:'p-image',type:'image',text:'',url:'https://example.org/image.png',caption:'测试图片'}],...overrides});
  let admin,operator,student,other,article,member,teacher,course,product,event,room;
  async function publish(item){for(const action of ['submit','publish']){const r=await call('/admin/articles/'+item.id+'/transition',admin,'POST',{action,reason:'测试审核发布',expectedVersion:item.version});assert.equal(r.status,201,JSON.stringify(r.body));item=r.body;}return item;}
  try{
    admin=await adminAccount('ADMIN');operator=await adminAccount('OPERATOR');student=await appAccount();other=await appAccount();
    await t.test('image blocks use existing draft/review workflow and immutable release IDs',async()=>{
      const r=await call('/admin/articles',admin,'POST',draft());assert.equal(r.status,201);article=r.body;articles.push(article.id);
      assert.equal((await call('/catalog/articles/'+article.id)).status,404);
      assert.equal((await call('/admin/articles',admin,'POST',draft({blocks:[{id:'p',type:'image',text:''}]}))).status,400);
      article=await publish(article);assert.ok(article.currentReleaseId);
      const blocks=await db.articleBlock.findMany({where:{releaseId:article.currentReleaseId}});assert.deepEqual(blocks.map(b=>b.kind).sort(),['IMAGE','PARAGRAPH','PARAGRAPH']);
      assert.equal((await call('/admin/articles/'+article.id+'/blocks',operator,'POST',{kind:'TEXT',text:'绕过审核'})).status,404);
      assert.equal((await call('/admin/articles/'+article.id,operator,'PATCH',{...draft(),expectedVersion:article.version})).status,409);
      const m=await call('/admin/articles',admin,'POST',draft({title:prefix+'会员文章',visibility:'MEMBER',membershipTier:3}));articles.push(m.body.id);member=await publish(m.body);
      assert.equal((await call('/catalog/articles/'+member.id,student)).body.blocks.length,0);
    });
    await t.test('likes are idempotent and membership checks cover reading, notes and comments',async()=>{
      const results=await Promise.all([call('/articles/'+article.id+'/reactions',student,'POST',{kind:'LIKE'}),call('/articles/'+article.id+'/reactions',student,'POST',{kind:'LIKE'})]);assert.ok(results.every(r=>r.status===201));
      assert.equal((await call('/articles/'+article.id+'/reaction-state',student)).body.count,1);
      assert.equal((await call('/me/like-state/'+article.id,student)).body.liked,true);
      for(const path of ['/comments','/reactions','/reading-events'])assert.equal((await call('/articles/'+member.id+path,student,'POST',path==='/comments'?{body:'无权评论'}:path==='/reactions'?{kind:'LIKE'}:{dwellSeconds:1})).status,403);
      assert.equal((await call('/articles/'+member.id+'/comments',student)).status,403);
      assert.equal((await call('/articles/'+article.id+'/reactions',null,'POST',{kind:'LIKE'})).status,401);
    });
    await t.test('server-owned reading keys isolate users, aggregate by Shanghai day, and reports validate reason',async()=>{
      const one=await call('/articles/'+article.id+'/reading-events',student,'POST',{eventKey:'same-client-key',dwellSeconds:30});
      const two=await call('/articles/'+article.id+'/reading-events',other,'POST',{eventKey:'same-client-key',dwellSeconds:60});assert.notEqual(one.body.id,two.body.id);
      const retry=await call('/articles/'+article.id+'/reading-events',student,'POST',{eventKey:'same-client-key',dwellSeconds:40});assert.equal(retry.body.id,one.body.id);
      await call('/articles/'+article.id+'/reading-events',student,'POST',{eventKey:'same-client-key',dwellSeconds:10});
      assert.equal((await call('/me/reading-history',student)).body.items[0].readDuration,40);
      assert.equal((await call('/articles/'+article.id+'/reports',student,'POST',{reason:'FRAUD',description:''})).status,400);
      assert.equal((await call('/articles/'+article.id+'/reports',student,'POST',{reason:'COPYRIGHT',description:'测试证据核查'})).status,201);
      assert.equal((await call('/me/reading-history?size=999',student)).status,400);
    });
    await t.test('quote references resolve stable keys; pending comments stay private and concurrent reviews have one winner',async()=>{
      const c=await call('/articles/'+article.id+'/comments',student,'POST',{body:'我对这段话的理解',quotedBlockId:'p-water'});assert.equal(c.status,201);assert.equal(c.body.quoteSnapshot,text);assert.notEqual(c.body.quoteBlockId,'p-water');
      assert.equal((await call('/articles/'+article.id+'/comments')).body.items.length,0);
      assert.equal((await call('/articles/'+article.id+'/comments',other,'POST',{body:'回复待审评论',parentId:c.body.id})).status,400);
      assert.equal((await call('/admin/comments/'+c.body.id+'/review',operator,'POST',{state:'APPROVED',expectedVersion:1,reason:'测试'})).status,403);
      const reviews=await Promise.all([1,2].map(()=>call('/admin/comments/'+c.body.id+'/review',admin,'POST',{state:'APPROVED',expectedVersion:1,reason:'原文引用与评论内容核查通过'})));assert.deepEqual(reviews.map(r=>r.status).sort(),[201,409]);
      assert.equal(await db.auditLog.count({where:{resourceId:c.body.id,action:'comment.review'}}),1);
      for(let n=0;n<3;n++){const row=await call('/articles/'+article.id+'/comments',other,'POST',{body:'另一条'+n});assert.equal(row.status,201);assert.equal((await call('/admin/comments/'+row.body.id+'/review',admin,'POST',{state:'APPROVED',expectedVersion:1,reason:'测试通过'})).status,201);}
      const first=await call('/articles/'+article.id+'/comments?size=2');assert.ok(first.body.nextCursor);const second=await call('/articles/'+article.id+'/comments?size=2&cursor='+first.body.nextCursor);assert.equal(second.body.items.length,2);assert.ok(!first.body.items.some(x=>second.body.items.some(y=>x.id===y.id)));
      assert.equal((await call('/articles/'+article.id+'/comments',other,'POST',{body:'   '})).status,400);
      assert.equal((await call('/admin/data/comment',admin,'POST',{data:{},reason:'绕过审核'})).status,403);
    });
    await t.test('range annotations validate article version and UTF-16 boundaries; exports and edits are owner-only',async()=>{
      const dto={articleId:article.id,articleVersion:article.version,blockId:'p-water',rangeStart:0,rangeEnd:4,text:'<script>alert(1)</script> [链接](javascript:evil)'};
      const n=await call('/me/notes',student,'POST',dto);assert.equal(n.status,201);assert.equal(n.body.quote,'上善若水');
      assert.equal((await call('/me/notes',student,'POST',{...dto,articleVersion:1})).status,409);
      assert.equal((await call('/me/notes',student,'POST',{...dto,rangeEnd:999})).status,400);
      assert.equal((await call('/me/notes',student,'POST',{...dto,rangeStart:text.length-1,rangeEnd:text.length})).status,400);
      assert.equal((await call('/me/notes/'+n.body.id,other,'PATCH',{text:'窃改'})).status,404);
      assert.equal((await call('/me/notes/'+n.body.id,other,'DELETE')).status,404);
      assert.equal((await call('/me/articles/'+article.id+'/annotations',other)).body.length,0);
      await call('/me/favorites/'+article.id,student,'PUT');const result=await call('/me/notes/export',student);assert.equal(result.status,200);assert.equal(result.body.counts.notes,1);assert.equal(result.body.counts.favorites,1);assert.ok(result.body.markdown.includes('上善若水'));assert.match(result.body.markdown,/导出时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（北京时间）/);assert.match(result.body.markdown,/记录时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（北京时间）/);assert.ok(!result.body.markdown.includes('<script>'));assert.ok(!result.body.markdown.includes('[链接](javascript:'));
      for(const key of ['private_note','reaction'])assert.equal((await call('/admin/data/'+key,admin,'POST',{data:{},reason:'尝试绕过互动业务校验'})).status,403);
      assert.equal((await call('/me/notes/export',other)).body.counts.notes,0);assert.equal((await call('/me/notes/export')).status,401);
    });
    await t.test('multi-paragraph selection keeps exact snapshots and private moderation can be withdrawn',async()=>{
      const ranges=[{blockId:'p-water',rangeStart:0,rangeEnd:4},{blockId:'p-more',rangeStart:0,rangeEnd:4}];
      const dto={articleId:article.id,articleVersion:article.version,blockId:'p-water',ranges,text:'跨段心得'};
      const note=await call('/me/notes',student,'POST',dto);assert.equal(note.status,201,JSON.stringify(note.body));
      assert.equal(note.body.quote,'上善若水\n\n知行相照');assert.deepEqual(note.body.ranges,ranges);
      assert.equal((await call('/me/articles/'+article.id+'/annotations',student)).body.find(n=>n.id===note.body.id).ranges.length,2);
      assert.equal((await call('/me/notes',student,'POST',{...dto,ranges:[...ranges].reverse()})).status,400);
      assert.equal((await call('/me/notes',student,'POST',{...dto,ranges:[ranges[0],ranges[0]]})).status,400);
      const comment=await call('/articles/'+article.id+'/comments',student,'POST',{body:'选择片段的评论',quotedBlockId:'p-water',quotedRanges:ranges,articleVersion:article.version});
      assert.equal(comment.status,201,JSON.stringify(comment.body));assert.equal(comment.body.quoteSnapshot,note.body.quote);
      assert.equal((await call('/articles/'+article.id+'/comments',student,'POST',{body:'旧版本',quotedBlockId:'p-water',quotedRanges:ranges,articleVersion:1})).status,409);
      assert.ok((await call('/articles/'+article.id+'/comments/mine',student)).body.some(c=>c.id===comment.body.id));
      assert.ok(!(await call('/articles/'+article.id+'/comments/mine',other)).body.some(c=>c.id===comment.body.id));
      assert.equal((await call('/articles/'+article.id+'/comments/'+comment.body.id,other,'DELETE')).status,404);
      assert.equal((await call('/articles/'+article.id+'/comments/'+comment.body.id,student,'DELETE')).status,200);
      assert.ok(!(await call('/articles/'+article.id+'/comments/mine',student)).body.some(c=>c.id===comment.body.id));
    });
    await t.test('journal creates and edits without silently overwriting concurrent records',async()=>{
      const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
      const created=await call('/me/practice',student,'PUT',{day,text:'今日研习',expectedVersion:0});assert.equal(created.status,200,JSON.stringify(created.body));
      assert.equal((await call('/me/practice',student,'PUT',{day,text:'覆盖',expectedVersion:0})).status,409);
      const updates=await Promise.all(['理解一','理解二'].map(text=>call('/me/practice',student,'PUT',{day,text,expectedVersion:created.body.version})));
      assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
      assert.equal((await call('/me/practice',other)).body.items.length,0);
      assert.equal((await call('/me/practice',student,'PUT',{day,text:'   ',expectedVersion:2})).status,400);
      assert.equal((await call('/me/practice',student,'PUT',{day:'2026-02-30',text:'日期无效'})).status,400);
      assert.equal((await call('/me/practice/'+created.body.id,student,'DELETE')).status,200);
    });
    await t.test('unified search covers five content types, literal matching, tags, sorting and hidden teacher dependencies',async()=>{
      teacher=await db.teacher.create({data:{name:prefix+'名师',title:'测试',bio:'研习',expertise:[tagName],status:'PUBLISHED',isDemo:true}});teachers.push(teacher.id);
      course=await db.course.create({data:{title:prefix+'课程',subtitle:'研习',description:'测试课程',category:'经典研习',format:'VIDEO',price:0,cover:'/static/art/books.svg',teacherId:teacher.id,tags:[tagName],status:'PUBLISHED',isDemo:true}});courses.push(course.id);
      product=await db.product.create({data:{title:prefix+'商品',subtitle:'文创',description:'测试',category:'文创',price:0,cover:'/static/art/books.svg',culturalOrigin:'测试',status:'PUBLISHED',isDemo:true}});products.push(product.id);
      event=await db.event.create({data:{title:prefix+'活动',description:'测试活动',responsibleUserId:admin.id,capacity:20,location:'书院',startsAt:new Date(Date.now()+86400000),endsAt:new Date(Date.now()+90000000),cover:'/static/art/books.svg',price:0,category:'线下活动',status:'PUBLISHED',isDemo:true}});events.push(event.id);
      const tag=await db.tag.create({data:{code:prefix,name:tagName}});tagIds.push(tag.id);for(const resourceId of [product.id,event.id])await db.resourceTag.create({data:{resourceId,tagId:tag.id}});
      let r=await call('/discovery/search?q='+encodeURIComponent(prefix)+'&tag='+encodeURIComponent(tag.name));assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(['ARTICLE','COURSE','TEACHER','PRODUCT','EVENT'].every(type=>r.body.items.some(x=>x.type===type)));
      assert.equal((await call('/discovery/search?q=%25'+encodeURIComponent(prefix))).body.total,0);
      assert.equal((await call('/discovery/search?type=SECRET')).status,400);
      r=await call('/discovery/search?q='+encodeURIComponent(prefix)+'&size=2');assert.equal(r.body.items.length,2);assert.ok(r.body.hasMore);
      assert.equal((await call('/discovery/search?q='+encodeURIComponent(prefix)+'&sort=popular')).body.items[0].id,article.id);
      await db.teacher.update({where:{id:teacher.id},data:{status:'ARCHIVED'}});assert.equal((await call('/discovery/search?type=COURSE&q='+encodeURIComponent(prefix))).body.total,0);await db.teacher.update({where:{id:teacher.id},data:{status:'PUBLISHED'}});
    });
    await t.test('audited demo visibility is consistent in production without exposing private or member content',async()=>{
      const environment=process.env.NODE_ENV;
      await db.article.update({where:{id:article.id},data:{isDemo:true}});
      try{
        process.env.NODE_ENV='production';
        assert.equal((await call('/catalog/courses/'+course.id)).status,404);
        assert.equal((await call('/discovery/search?type=COURSE&q='+encodeURIComponent(prefix))).body.total,0);
        const current=(await call('/admin/config',admin)).body.find(row=>row.key==='presentation');
        assert.equal((await call('/admin/config/presentation',operator,'PUT',{expectedRevision:current.revision,value:{showDemoContent:true},reason:'尝试越权'})).status,403);
        const enabled=await call('/admin/config/presentation',admin,'PUT',{expectedRevision:current.revision,value:{showDemoContent:true},reason:'测试演示可见策略'});
        assert.equal(enabled.status,200,JSON.stringify(enabled.body));
        assert.equal((await call('/catalog/home')).body.demoContentVisible,true);
        for(const [type,id] of [['courses',course.id],['teachers',teacher.id],['products',product.id],['events',event.id],['articles',article.id]])assert.equal((await call('/catalog/'+type+'/'+id)).status,200);
        assert.equal((await call('/learning/courses/'+course.id)).status,200);
        assert.equal((await call('/catalog/courses/'+course.id+'/reviews')).status,200);
        assert.ok((await call('/discovery/search?q='+encodeURIComponent(prefix))).body.items.some(row=>row.id===course.id));
        assert.equal((await call('/catalog/articles/'+member.id)).body.access,'MEMBERSHIP_REQUIRED');
        assert.deepEqual((await call('/catalog/articles/'+member.id)).body.blocks,[]);
        assert.equal((await call('/me/articles/'+article.id+'/annotations',other)).body.length,0);
        await db.teacher.update({where:{id:teacher.id},data:{status:'ARCHIVED'}});
        assert.equal((await call('/catalog/courses/'+course.id)).status,404);
        assert.equal((await call('/discovery/search?type=COURSE&q='+encodeURIComponent(prefix))).body.total,0);
        await db.teacher.update({where:{id:teacher.id},data:{status:'PUBLISHED'}});
        assert.equal(await db.auditLog.count({where:{actorId:admin.id,action:'config.update',changes:{path:['key'],equals:'presentation'}}}),1);
        assert.equal((await call('/admin/config/presentation',admin,'PUT',{expectedRevision:enabled.body.revision,value:{showDemoContent:false},reason:'关闭演示展示'})).status,200);
        assert.equal((await call('/learning/courses/'+course.id)).status,404);
        assert.equal((await call('/catalog/articles/'+article.id)).status,404);
      }finally{
        process.env.NODE_ENV=environment;
        await db.featureConfig.deleteMany({where:{configKey:'presentation',approvedBy:admin.id}});
        await db.article.update({where:{id:article.id},data:{isDemo:false}});
      }
    });
    await t.test('recommendations use saved behavior, exclude seen content and remove draft candidates',async()=>{
      const r=await call('/discovery/recommendations',student);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.personalized,true);assert.ok(r.body.items.some(i=>i.id===course.id&&i.score>0));assert.ok(!r.body.items.some(i=>i.id===article.id));
      await db.course.update({where:{id:course.id},data:{status:'DRAFT'}});assert.ok(!(await call('/discovery/recommendations',student)).body.items.some(i=>i.id===course.id));await db.course.update({where:{id:course.id},data:{status:'PUBLISHED'}});
      assert.equal((await call('/discovery/recommendations')).body.personalized,false);
      assert.equal((await call('/discovery/recommendation-preference',student,'POST',{enabled:false})).status,201);assert.equal((await call('/discovery/recommendations',student)).body.personalized,false);assert.equal((await call('/discovery/recommendation-preference',student)).body.enabled,false);assert.equal((await call('/discovery/recommendation-preference',student,'POST',{enabled:true})).status,201);assert.equal((await call('/discovery/recommendations',student)).body.personalized,true);
    });
    await t.test('authority evidence requires review, validity and no private file leakage; course and live links follow current publication',async()=>{
      const root='/admin/articles/'+article.id+'/editorial';const e=await call(root+'/evidence',operator,'POST',{kind:'ANNOTATION',title:'测试注释',author:'测试编者',edition:'测试版',sourceUrl:'https://example.org/evidence',rightsHolder:'测试权利人',licenseScope:'仅集成测试'});assert.equal(e.status,201,JSON.stringify(e.body));evidence.push(e.body.id);
      assert.equal((await call('/discovery/articles/'+article.id+'/context')).body.evidence.length,0);
      assert.equal((await call(root+'/evidence/'+e.body.id+'/review',admin,'POST',{expectedVersion:1,state:'APPROVED',reason:'仅测试核查'})).status,201);
      const visible=(await call('/discovery/articles/'+article.id+'/context')).body.evidence[0];assert.equal(visible.edition,'测试版');assert.equal('proofAssetId' in visible,false);assert.equal('reviewNote' in visible,false);
      await db.sourceEvidence.update({where:{id:e.body.id},data:{validUntil:new Date(Date.now()-1000)}});assert.equal((await call('/discovery/articles/'+article.id+'/context')).body.evidence.length,0);
      assert.equal((await call(root+'/relations',operator,'POST',{toId:course.id,type:'COURSE',rank:1,reason:'测试'})).status,403);
      assert.equal((await call(root+'/relations',admin,'POST',{toId:course.id,type:'COURSE',rank:1,reason:'延伸研习'})).status,201);
      room=await db.liveRoom.create({data:{teacherId:teacher.id,provider:'TEST',providerRoomId:randomUUID(),categoryCode:'经典研习',accessRule:{},courseId:course.id}});rooms.push(room.id);const resource=await db.resource.findUniqueOrThrow({where:{id:room.id}});assert.equal((await call('/admin/live-discovery/'+room.id+'/publication',operator,'POST',{state:'PUBLISHED',expectedVersion:resource.version,title:'测试直播',summary:'测试直播预告',reason:'测试发布'})).status,403);assert.equal((await call('/admin/live-discovery/'+room.id+'/publication',admin,'POST',{state:'PUBLISHED',expectedVersion:resource.version,title:'测试直播',summary:'测试直播预告',reason:'测试发布'})).status,201);
      assert.equal((await call(root+'/relations',admin,'POST',{toId:room.id,type:'LIVE',rank:2,reason:'测试直播预告'})).status,201);
      assert.equal((await call('/discovery/articles/'+article.id+'/context')).body.related.length,2);const live=await call('/discovery/live/'+room.id);assert.equal(live.body.playbackAvailable,false);assert.equal('providerRoomId' in live.body,false);
      await db.course.update({where:{id:course.id},data:{status:'ARCHIVED'}});assert.equal((await call('/discovery/articles/'+article.id+'/context')).body.related.length,1);
    });
    await t.test('share landing uses real server URL, escapes HTML, and resolves against current publication',async()=>{
      const share=await call('/share/links',student,'POST',{resourceType:'ARTICLE',resourceId:article.id,title:'伪造标题'});assert.equal(share.status,201);assert.ok(share.body.url.includes('/api/v1/share/open/'));
      const landing=await call('/share/open/'+share.body.code);assert.equal(landing.status,200);assert.ok(landing.body.includes(article.title));assert.ok(!landing.body.includes('伪造标题'));
      assert.ok(landing.body.includes('上善若水'));assert.ok(landing.body.includes('daoxueacademy://share?code='));
      const restricted=await call('/share/open/ARTICLE_'+member.id,student);assert.equal(restricted.status,200);assert.ok(restricted.body.includes('会员专属内容'));assert.ok(!restricted.body.includes('知行相照'));
      const raw=await fetch(base+'/share/open/'+share.body.code);assert.equal(raw.headers.get('cache-control'),'no-store');assert.ok(raw.headers.get('content-security-policy').includes("default-src 'none'"));
      assert.equal((await call('/share/links/'+share.body.code+'/resolve')).body.resourceId,article.id);
      await db.article.update({where:{id:article.id},data:{status:'ARCHIVED'}});assert.equal((await call('/share/links/'+share.body.code+'/resolve')).status,404);assert.ok(!(await call('/me/reading-history',student)).body.items.some(i=>i.id===article.id));
      const removed=await fetch(base+'/share/open/'+share.body.code);assert.equal(removed.status,404);assert.equal(removed.headers.get('cache-control'),'no-store');
      assert.ok((await call('/me/notes/export',student)).body.markdown.includes('内容已下架'));
    });
  }finally{
    try{
      await clearArticles(db,articles);await db.contentRelation.deleteMany({where:{toId:{in:rooms}}});await db.liveSession.deleteMany({where:{roomId:{in:rooms}}});await db.liveRoom.deleteMany({where:{id:{in:rooms}}});await clearCourses(db,courses);await clearProducts(db,products);
      await db.resourceTag.deleteMany({where:{tagId:{in:tagIds}}});await db.tag.deleteMany({where:{id:{in:tagIds}}});await db.sourceEvidence.deleteMany({where:{id:{in:evidence}}});
      await db.article.deleteMany({where:{id:{in:articles}}});await db.course.deleteMany({where:{id:{in:courses}}});await db.product.deleteMany({where:{id:{in:products}}});await db.event.deleteMany({where:{id:{in:events}}});await db.teacher.deleteMany({where:{id:{in:teachers}}});
      await db.resource.deleteMany({where:{id:{in:[...articles,...courses,...products,...events,...teachers,...rooms]}}});await db.featureConfig.deleteMany({where:{approvedBy:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.practiceLog.deleteMany({where:{userId:{in:users}}});await db.consentRecord.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.otpChallenge.deleteMany({where:{OR:[{phone:{in:phones}},{phoneHash:{in:phones.map(phoneLookup)}}]}});
    }finally{await db.$disconnect();await app.close();}
  }
});
