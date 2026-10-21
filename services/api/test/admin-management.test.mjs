import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {AdminManagement,redactAudit} from '../dist/admin-management.js';
import {validateConfig} from '../dist/system-config.js';
import {routePermission,permissionCodes} from '../dist/admin-permissions.js';

const host=new URL(process.env.DATABASE_URL).hostname;
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(host))throw Error('Admin fixtures require a local database');

test('admin route policies cover existing exceptional workflows and reject unknown routes',()=>{
  assert.equal(routePermission('POST','/api/v1/admin/enrollments/abc/revoke'),'members.write');
  assert.equal(routePermission('POST','/api/v1/admin/articles/abc/editorial/relations'),'content.review');
  assert.equal(routePermission('POST','/api/v1/admin/articles/abc/transition',{action:'publish'}),'content.review');
  assert.equal(routePermission('POST','/api/v1/admin/teaching/submissions/abc/images/def'),'teaching.read');
  assert.throws(()=>routePermission('GET','/api/v1/admin/unknown'));
});
test('audit read boundary strips nested credentials and private text; configuration rejects prototype keys',()=>{
  const value=redactAudit({version:2,nested:{passwordHash:'SENTINEL',body:'SENTINEL',phone:'SENTINEL'},rows:[{quote:'SENTINEL',id:'visible'}]});
  assert.equal(JSON.stringify(value).includes('SENTINEL'),false);assert.equal(value.rows[0].id,'visible');
  assert.throws(()=>validateConfig('__proto__',{}));assert.throws(()=>validateConfig('catalog',{homeArticles:0,homeCourses:4,homeProducts:6,homeEvents:3}));
});
test('last active administrator cannot be frozen before any mutation',async()=>{
  let writes=0;
  const target={id:'target',roles:['ADMIN'],status:'ACTIVE',version:1};
  const service=new AdminManagement({$transaction:fn=>fn({$executeRaw:async()=>1,user:{findFirst:async()=>({id:'actor'}),findUnique:async()=>target,count:async()=>1,update:async()=>{writes++;}}})},{});
  await assert.rejects(()=>service.userAction({actor:{id:'actor',roles:['ADMIN']}},'target',{action:'freeze',reason:'保护管理员',expectedVersion:1}),/最后一名/);
  assert.equal(writes,0);
});

test('admin management uses real HTTP, database versions, CSRF, scope policies and effective configuration',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';
  const db=new Database(),app=await createApp(false),prefix='qa-admin-'+randomUUID(),password=randomUUID()+'!A',users=[],events=[],assets=[],articles=[],threads=[],comments=[],reports=[],files=[];
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');
  const testIp='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const originalPolicies=await db.accessRole.findMany();
  async function user(role){const row=await db.user.create({data:{nickname:prefix,username:prefix+'-'+role,passwordHash:await passwordHash(password),roles:[role]}});users.push(row.id);return row;}
  const root=await user('ADMIN'),operator=await user('OPERATOR'),support=await user('SUPPORT'),teacher=await user('TEACHER'),finance=await user('FINANCE'),moderator=await user('MODERATOR');
  let auth;
  async function call(path,method='GET',body,session=auth,extra={}){
    const r=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Origin:process.env.CORS_ORIGINS,'X-Forwarded-For':testIp,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie(),requestId:r.headers.get('x-request-id')};
  }
  async function login(row,secret=password){const r=await call('/admin/auth/login','POST',{username:row.username,password:secret},null);assert.equal(r.status,200);return {cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  const op=await login(operator),sup=await login(support),tea=await login(teacher),fin=await login(finance),mod=await login(moderator);auth=await login(root);
  try{
    await t.test('dashboard returns only permitted indicators and real course finance series',async()=>{
      const full=await call('/admin/overview');assert.equal(full.status,200);assert.ok(full.body.finance);assert.equal(full.body.finance.trend.length,30);assert.match(full.body.finance.paid,/^\d+$/);
      const limited=await call('/admin/overview','GET',undefined,tea);assert.equal(limited.status,200);assert.equal(limited.body.finance,null);assert.equal(limited.body.articles,null);assert.equal(limited.body.learners,null);
      assert.equal((await call('/admin/overview','GET',undefined,sup)).body.finance,null);
      assert.ok((await call('/admin/overview','GET',undefined,fin)).body.finance);
    });
    await t.test('CSRF and non-administrator access deny account, configuration and permission changes',async()=>{
      assert.equal((await call('/admin/config/site','PUT',{},op)).status,403);
      assert.equal((await call('/admin/access','GET',undefined,op)).status,403);
      assert.equal((await call('/admin/users','POST',{},auth,{'X-CSRF-Token':'bad'})).status,403);
      const session=await call('/admin/auth/session');assert.deepEqual(session.body.user.permissions.sort(),[...permissionCodes].sort());
    });
    await t.test('policy changes narrow active sessions immediately and the generic editor cannot bypass them',async()=>{
      const row=originalPolicies.find(r=>r.code==='OPERATOR');
      assert.equal((await call('/admin/access/OPERATOR','PATCH',{expectedVersion:row.version,permissionCodes:['dashboard.read','access.manage'],active:true,reason:'拒绝角色越界'})).status,400);
      const codes=row.permissionCodes.filter(c=>!c.startsWith('content.'));
      const saved=await call('/admin/access/OPERATOR','PATCH',{expectedVersion:row.version,permissionCodes:codes,active:true,reason:prefix});assert.equal(saved.status,200);
      assert.equal((await call('/admin/articles','GET',undefined,op)).status,403);
      assert.equal((await call('/admin/data/article','GET',undefined,op)).status,403);
      const schema=await call('/admin/data/schema','GET',undefined,op);assert.equal(schema.status,200);assert.equal(schema.body.some(r=>r.key==='article'),false);
      assert.equal((await call('/admin/auth/session','GET',undefined,op)).body.user.permissions.includes('content.read'),false);
      assert.equal((await call('/admin/access/OPERATOR','PATCH',{expectedVersion:row.version,permissionCodes:codes,active:true,reason:prefix})).status,409);
      await db.accessRole.update({where:{id:row.id},data:{permissionCodes:row.permissionCodes,active:row.active,version:{increment:1}}});
    });
    await t.test('account creation, role grants and revokes use trigger synchronization',async()=>{
      const created=await call('/admin/users','POST',{username:prefix+'-new',nickname:prefix,password,reason:prefix});assert.equal(created.status,201);users.push(created.body.id);assert.deepEqual(created.body.roles,['USER']);assert.equal('passwordHash' in created.body,false);
      assert.equal((await call('/admin/users/'+root.id+'/roles','POST',{role:'OPERATOR',reason:prefix})).status,403);
      assert.equal((await call('/admin/users/'+created.body.id+'/roles','POST',{role:'OPERATOR',reason:prefix})).status,201);
      const rows=await call('/admin/users/'+created.body.id+'/roles');assert.equal(rows.status,200);assert.equal(rows.body[0].role,'OPERATOR');assert.ok(rows.body[0]._revision);
      assert.equal((await call('/admin/data/roles/'+rows.body[0].id+'/revoke','POST',{expectedRevision:rows.body[0]._revision,reason:prefix})).status,201);
      assert.equal((await db.user.findUnique({where:{id:created.body.id}})).roles.includes('OPERATOR'),false);
    });
    await t.test('freezing revokes sessions, restoration never restores revoked sessions and password resets invalidate access',async()=>{
      const before=await db.user.findUniqueOrThrow({where:{id:operator.id}});
      assert.equal((await call('/admin/users/'+root.id+'/actions','POST',{action:'freeze',expectedVersion:root.version,reason:prefix})).status,403);
      assert.equal((await call('/admin/data/app_user/'+operator.id,'PATCH',{data:{status:'FROZEN'},expectedRevision:'bypass',reason:prefix})).status,403);
      const frozen=await call('/admin/users/'+operator.id+'/actions','POST',{action:'freeze',expectedVersion:before.version,reason:prefix});assert.equal(frozen.status,201);
      assert.equal((await call('/admin/auth/session','GET',undefined,op)).status,401);
      const restored=await call('/admin/users/'+operator.id+'/actions','POST',{action:'restore',expectedVersion:frozen.body.version,reason:prefix});assert.equal(restored.status,201);
      assert.equal((await call('/admin/auth/session','GET',undefined,op)).status,401);
      const active=await login(operator),newPassword=randomUUID()+'!B';
      assert.equal((await call('/admin/users/'+operator.id+'/actions','POST',{action:'resetPassword',expectedVersion:before.version,reason:prefix,password:newPassword})).status,409);
      assert.equal((await call('/admin/users/'+operator.id+'/actions','POST',{action:'resetPassword',expectedVersion:restored.body.version,reason:prefix,password:newPassword})).status,201);
      assert.equal((await call('/admin/auth/session','GET',undefined,active)).status,401);
      assert.equal((await call('/admin/auth/login','POST',{username:operator.username,password},null)).status,401);await login(operator,newPassword);
    });
    await t.test('configuration validates types, prevents lost updates and affects actual catalog output',async()=>{
      const configs=await call('/admin/config'),current=configs.body.find(c=>c.key==='catalog');
      const value={homeArticles:1,homeCourses:1,homeProducts:1,homeEvents:1};
      const responses=await Promise.all([call('/admin/config/catalog','PUT',{expectedRevision:current.revision,value,reason:prefix}),call('/admin/config/catalog','PUT',{expectedRevision:current.revision,value,reason:prefix})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
      const home=await call('/catalog/home');assert.equal(home.status,200);for(const key of ['articles','courses','products','events'])assert.ok(home.body[key].length<=1);
      assert.equal((await call('/admin/config/catalog','PUT',{expectedRevision:current.revision+1,value:{...value,homeArticles:99},reason:prefix})).status,400);
      const history=await call('/admin/config/catalog/history');assert.equal(history.body[0].revision,current.revision+1);
      const site=configs.body.find(c=>c.key==='site');const siteValue={...site.value,academyName:prefix,supportPhone:'400-123-4567'};
      assert.equal((await call('/admin/config/site','PUT',{expectedRevision:site.revision,value:siteValue,reason:prefix})).status,200);
      assert.equal((await call('/configuration')).body.academyName,prefix);
    });
    await t.test('public posting switch takes effect while the read endpoint remains available',async()=>{
      const config=(await call('/admin/config')).body.find(c=>c.key==='community');
      assert.equal((await call('/admin/config/community','PUT',{expectedRevision:config.revision,value:{publicPostingEnabled:false},reason:prefix})).status,200);
      const appSession=await db.authSession.create({data:{userId:support.id,kind:'APP',accessHash:(await import('node:crypto')).createHash('sha256').update('a'.repeat(43)).digest('hex'),refreshHash:randomUUID(),csrfToken:randomUUID(),accessExpiresAt:new Date(Date.now()+600000),expiresAt:new Date(Date.now()+1200000)}});
      const section=await db.forumSection.findFirst({where:{scope:'PUBLIC',active:true}});
      assert.ok(section);{const r=await call('/forum/threads','POST',{sectionId:section.id,title:'暂停期间不能发帖',body:'测试暂停发帖',assetIds:[],tags:[],requestKey:randomUUID()},null,{Authorization:'Bearer '+'a'.repeat(43)});assert.equal(r.status,403);assert.match(r.body.message,/停止接收/);}
      await db.authSession.delete({where:{id:appSession.id}});
    });
    await t.test('activities validate intervals, versions and publication transitions; generic edit cannot bypass review',async()=>{
      const data={title:prefix,description:'活动介绍',category:'线下活动',cover:'/static/art/books.svg',location:'书院',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+172800000).toISOString(),capacity:30,price:0};
      const staff=await call('/admin/events/staff');assert.equal(staff.status,200);assert.ok(staff.body.some(item=>item.id===operator.id));assert.equal(staff.body.some(item=>item.id===support.id),false);
      assert.equal((await call('/admin/events','POST',{...data,endsAt:data.startsAt})).status,400);
      assert.equal((await call('/admin/events','POST',{...data,responsibleUserId:support.id})).status,400);
      const created=await call('/admin/events','POST',{...data,responsibleUserId:operator.id});assert.equal(created.status,201);assert.equal(created.body.responsibleUserId,operator.id);events.push(created.body.id);
      const listed=await call('/admin/events');assert.equal(listed.body.items.find(item=>item.id===created.body.id).responsibleUserName,operator.nickname);
      assert.equal((await call('/admin/data/event/'+created.body.id,'PATCH',{data:{status:'PUBLISHED'},reason:prefix,expectedRevision:'bypass'})).status,403);
      assert.equal((await call('/admin/events/'+created.body.id+'/transition','POST',{action:'submit',expectedVersion:1,reason:prefix})).status,201);
      assert.equal((await call('/admin/events/'+created.body.id+'/transition','POST',{action:'publish',expectedVersion:1,reason:prefix})).status,409);
      assert.equal((await call('/admin/events/'+created.body.id+'/transition','POST',{action:'publish',expectedVersion:2,reason:prefix})).status,201);
      assert.equal((await call('/admin/events/'+created.body.id,'PATCH',{...data,expectedVersion:3})).status,409);
    });
    await t.test('media library excludes private images and does not expose storage references',async()=>{
      for(const mime of ['image/png','video/mp4']){const row=await db.mediaAsset.create({data:{storageKey:prefix+'-'+mime,name:prefix,mime,bytes:10,uploaderId:root.id,status:'READY',visibility:'PRIVATE',sha256:'a'.repeat(64)}});assets.push(row.id);}
      const result=await call('/admin/media-library?q='+encodeURIComponent(prefix));assert.equal(result.status,200);assert.equal(result.body.total,1);assert.equal(result.body.items[0].mime,'video/mp4');assert.equal('storageKey' in result.body.items[0],false);
      assert.equal((await call('/admin/media-library?mime=audio/mpeg&q='+encodeURIComponent(prefix))).body.total,0);
    });
    await t.test('global audit filters redact private history and include request correlation',async()=>{
      await db.auditLog.create({data:{actorId:root.id,action:prefix,resource:'test',changes:{nested:{body:'PRIVATE_SENTINEL',passwordHash:'PRIVATE_SENTINEL'},version:9},beforeSnapshot:{phone:'PRIVATE_SENTINEL'},afterSnapshot:{quote:'PRIVATE_SENTINEL'}}});
      const result=await call('/admin/audit?action='+prefix);assert.equal(result.status,200);assert.equal(result.body.total,1);assert.equal(JSON.stringify(result.body).includes('PRIVATE_SENTINEL'),false);assert.equal(result.body.items[0].changes.version,9);
      assert.equal((await call('/admin/audit?action='+prefix+'&actorId='+root.username)).body.total,1);
      assert.equal((await call('/admin/audit','GET',undefined,sup)).status,403);
      const request=await call('/admin/users/'+teacher.id+'/actions','POST',{action:'revokeSessions',expectedVersion:teacher.version,reason:prefix});assert.equal(request.status,201);
      const traced=await call('/admin/audit?requestId='+request.requestId);assert.ok(traced.body.items.some(r=>r.action==='user.revokeSessions'));assert.ok(traced.body.items.some(r=>r.action==='admin.request'));
      const loggedIn=await call('/admin/auth/login','POST',{username:root.username,password},null);
      assert.equal(loggedIn.status,200);
      assert.ok((await call('/admin/audit?requestId='+loggedIn.requestId)).body.items.some(r=>r.action==='auth.login'));
      const loggedOut=await call('/admin/auth/logout','POST',{}, {cookie:loggedIn.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:loggedIn.body.csrfToken});
      assert.equal(loggedOut.status,200);
      assert.ok((await call('/admin/audit?requestId='+loggedOut.requestId)).body.items.some(r=>r.action==='auth.logout'));
    });
    await t.test('article and community comment workflows stay separate; report access follows the target module',async()=>{
      const article=await db.article.create({data:{title:prefix,summary:'测试',author:'书院',source:'测试',category:'经典',cover:'/static/art/books.svg',blocks:[{id:'p',type:'paragraph',text:'测试'}],tags:[]}});articles.push(article.id);
      const section=await db.forumSection.findFirstOrThrow({where:{scope:'PUBLIC',active:true}}),id=randomUUID();
      await db.resource.create({data:{id,kind:'THREAD',title:prefix,summary:'测试',categoryCode:section.code}});
      await db.forumThread.create({data:{id,sectionId:section.id,authorId:root.id,blocks:[{type:'text',text:'测试'}]}});threads.push(id);
      const articleComment=await db.comment.create({data:{resourceId:article.id,authorId:root.id,body:'文章评论',reviewState:'PENDING'}}),threadComment=await db.comment.create({data:{resourceId:id,authorId:root.id,body:'社区评论',reviewState:'PENDING'}});comments.push(articleComment.id,threadComment.id);
      assert.equal((await call('/admin/comments')).body.items.some(row=>row.id===threadComment.id),false);
      assert.equal((await call('/admin/forum/comments')).body.items.some(row=>row.id===articleComment.id),false);
      assert.equal((await call('/admin/comments/'+threadComment.id+'/review','POST',{expectedVersion:1,state:'APPROVED',reason:prefix})).status,404);
      assert.equal((await call('/admin/forum/comments/'+articleComment.id+'/moderate','POST',{expectedVersion:1,action:'APPROVE',reason:prefix})).status,404);
      for(const resourceId of [article.id,id]){const row=await db.report.create({data:{reporterId:root.id,resourceId,reasonCode:'OTHER',description:prefix,state:'PENDING'}});reports.push(row.id);}
      const policy=await db.accessRole.findUniqueOrThrow({where:{code:'MODERATOR'}});
      assert.equal((await call('/admin/access/MODERATOR','PATCH',{expectedVersion:policy.version,permissionCodes:policy.permissionCodes.filter(code=>!code.startsWith('content.')),active:true,reason:prefix})).status,200);
      const queue=await call('/admin/forum/reports','GET',undefined,mod);assert.equal(queue.status,200);assert.equal(queue.body.items.some(row=>row.id===reports[0]),false);assert.equal(queue.body.items.some(row=>row.id===reports[1]),true);
      assert.equal((await call('/admin/forum/reports/'+reports[0]+'/resolve','POST',{expectedVersion:1,reason:prefix},mod)).status,403);
      assert.equal((await call('/admin/forum/reports/'+reports[1]+'/resolve','POST',{expectedVersion:1,reason:prefix},mod)).status,201);
    });
    await t.test('revoking module access immediately invalidates already-issued private image tickets',async()=>{
      const threadId=threads[0],storageKey=randomUUID(),rootPath=resolve(process.env.MEDIA_DIR??'.media');
      const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=','base64');
      await mkdir(rootPath,{recursive:true});const path=resolve(rootPath,storageKey);await writeFile(path,image,{flag:'wx'});files.push(path);
      const asset=await db.mediaAsset.create({data:{storageKey,name:prefix,mime:'image/png',bytes:image.length,uploaderId:root.id,status:'READY',visibility:'PRIVATE',sha256:'b'.repeat(64),variants:{uploadPurpose:'FORUM_IMAGE'}}});assets.push(asset.id);
      await db.attachmentBinding.create({data:{threadId,assetId:asset.id,purpose:'FORUM_IMAGE'}});
      const ticket=await call('/admin/forum/threads/'+threadId+'/images/'+asset.id,'POST',{},mod);assert.equal(ticket.status,201);
      const before=await fetch(base+'/api/v1'+ticket.body.path);assert.equal(before.status,200);assert.deepEqual(Buffer.from(await before.arrayBuffer()),image);
      const policy=await db.accessRole.findUniqueOrThrow({where:{code:'MODERATOR'}});
      assert.equal((await call('/admin/access/MODERATOR','PATCH',{expectedVersion:policy.version,permissionCodes:policy.permissionCodes.filter(code=>!code.startsWith('community.')),active:true,reason:prefix})).status,200);
      const denied=await fetch(base+'/api/v1'+ticket.body.path);assert.equal(denied.status,403);assert.match((await denied.json()).message,/权限已撤销/);
    });
  }finally{
    await app.close();
    for(const row of originalPolicies)await db.accessRole.update({where:{id:row.id},data:{permissionCodes:row.permissionCodes,active:row.active,version:{increment:1}}});
    await db.featureConfig.deleteMany({where:{approvedBy:root.id}});
    await db.auditLog.deleteMany({where:{actorId:{in:users}}});
    await db.moderationAction.deleteMany({where:{actorId:{in:users}}});
    await db.report.deleteMany({where:{id:{in:reports}}});
    await db.comment.deleteMany({where:{id:{in:comments}}});
    await db.attachmentBinding.deleteMany({where:{assetId:{in:assets}}});
    await db.forumThread.deleteMany({where:{id:{in:threads}}});
    await db.article.deleteMany({where:{id:{in:articles}}});
    await db.resource.deleteMany({where:{id:{in:[...threads,...articles]}}});
    await db.userRole.deleteMany({where:{userId:{in:users}}});
    await db.authSession.deleteMany({where:{userId:{in:users}}});
    await db.idempotencyRecord.deleteMany({where:{userId:{in:users}}});
    const eventSessions=await db.eventSession.findMany({where:{eventId:{in:events}},select:{id:true}}),sessionIds=eventSessions.map(s=>s.id),tickets=await db.eventTicketType.findMany({where:{sessionId:{in:sessionIds}},select:{id:true}});await db.saleOffer.deleteMany({where:{eventTicketId:{in:tickets.map(t=>t.id)}}});await db.eventTicketType.deleteMany({where:{sessionId:{in:sessionIds}}});await db.eventSession.deleteMany({where:{id:{in:sessionIds}}});
    await db.event.deleteMany({where:{id:{in:events}}});await db.resource.deleteMany({where:{id:{in:events}}});
    await db.mediaAsset.deleteMany({where:{id:{in:assets}}});
    for(const path of files)await unlink(path);
    await db.user.deleteMany({where:{id:{in:users}}});
    await db.rateLimit.deleteMany({where:{OR:[{key:{contains:prefix}},{key:{contains:testIp}}]}});
    await db.$disconnect();
  }
});
