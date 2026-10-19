import {phoneLookup} from '../dist/private-data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {clearCourses} from './fixture-cleanup.mjs';

const database=new URL(process.env.DATABASE_URL??'');
if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(database.hostname))throw Error('Forum fixtures require local database');
test('forum publication, course access, images and moderation use real database transactions',async t=>{
  process.env.DEV_OTP_CODE='123456';process.env.CORS_ORIGINS='http://127.0.0.1:5173';
  const mediaDir=await mkdtemp(join(tmpdir(),'daoxue-forum-'));process.env.MEDIA_DIR=mediaDir;
  const db=new Database(),app=await createApp(false);app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/v1',prefix='qa-forum-'+randomUUID(),password=randomUUID()+'!A',ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  const users=[],phones=[],threads=[],courses=[],teachers=[],sections=[],assets=[];let root,operator,author,viewer,section,course,thread,comment,report,restriction,publicTicket;
  async function call(path,auth,method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:process.env.CORS_ORIGINS,'Content-Type':'application/json','X-Forwarded-For':ip,...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
  async function admin(role){const u=await db.user.create({data:{username:prefix+role,nickname:role,roles:[role],passwordHash:await passwordHash(password)}});users.push(u.id);const r=await call('/admin/auth/login',null,'POST',{username:u.username,password});assert.equal(r.status,200);return{id:u.id,cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:r.body.csrfToken};}
  async function user(){const phone='196'+String(randomInt(0,100000000)).padStart(8,'0');phones.push(phone);const otp=await call('/auth/sms',null,'POST',{phone});const r=await call('/auth/login',null,'POST',{phone,code:'123456',challengeId:otp.body.challengeId});assert.equal(r.status,200);users.push(r.body.user.id);return{...r.body,id:r.body.user.id};}
  async function post(sectionId,body='研习心得',assetIds=[]){const result=await call('/forum/threads',author,'POST',{requestKey:randomUUID(),sectionId,title:prefix,body,assetIds,tags:['经典研习']});assert.equal(result.status,201,JSON.stringify(result.body));threads.push(result.body.id);return result.body;}
  async function moderate(id,version,action='APPROVE',extra={}){return call('/admin/forum/threads/'+id+'/moderate',root,'POST',{expectedVersion:version,action,reason:'测试审核处置',...extra});}
  try{
    root=await admin('ADMIN');operator=await admin('OPERATOR');author=await user();viewer=await user();
    section=(await call('/forum/sections')).body.items.find(s=>s.code==='01-classics');assert.ok(section);
    await t.test('six live sections, idempotent posting and pending privacy',async()=>{
      assert.ok((await call('/forum/sections')).body.items.length>=6);
      const dto={requestKey:randomUUID(),sectionId:section.id,title:prefix,body:'研习心得',assetIds:[],tags:['经典研习']};
      const rows=await Promise.all([1,2].map(()=>call('/forum/threads',author,'POST',dto)));assert.ok(rows.every(r=>r.status===201));assert.equal(rows[0].body.id,rows[1].body.id);thread=rows[0].body;threads.push(thread.id);
      assert.equal((await call('/forum/threads/'+thread.id)).status,404);assert.equal((await call('/forum/threads/'+thread.id,viewer)).status,404);assert.equal((await call('/forum/threads/'+thread.id,author)).status,200);
      assert.equal((await call('/forum/threads?sectionId='+section.id)).body.items.some(r=>r.id===thread.id),false);
      assert.equal((await call('/admin/forum/threads/'+thread.id+'/moderate',operator,'POST',{expectedVersion:1,action:'APPROVE',reason:'越权测试'})).status,403);
      for(const key of ['forum_thread','user_block','report'])assert.equal((await call('/admin/data/'+key,root,'POST',{data:{},reason:'绕过工作流'})).status,403);
    });
    await t.test('concurrent review has one winner, search excludes pending and rewards do not duplicate',async()=>{
      assert.equal((await call('/discovery/search?q='+prefix+'&type=THREAD')).body.total,0);
      const reviewed=await Promise.all([1,2].map(()=>moderate(thread.id,1)));assert.deepEqual(reviewed.map(r=>r.status).sort(),[201,409]);
      assert.equal((await call('/discovery/search?q='+prefix+'&type=THREAD')).body.total,1);
      let stats=(await call('/me/progression',author)).body;assert.equal(stats.points,'3');assert.equal(stats.growth,5);
      const second=await post(section.id);assert.equal((await moderate(second.id,1)).status,201);stats=(await call('/me/progression',author)).body;assert.equal(stats.points,'3');assert.equal(stats.growth,10);
      assert.equal((await call('/admin/forum/threads/'+thread.id+'/feature',operator,'POST',{expectedVersion:2,essence:true,pinDays:7})).status,201);
      const row=(await call('/forum/threads/'+thread.id)).body;assert.equal(row.essence,true);assert.equal(row.summary,'研习心得');
      assert.ok((await call('/forum/threads?sectionId='+section.id+'&tag='+encodeURIComponent('经典研习'))).body.items.some(r=>r.id===thread.id));
      assert.equal((await call('/forum/threads?sectionId='+section.id+'&tag='+encodeURIComponent('不存在的测试标签'))).body.items.some(r=>r.id===thread.id),false);
      assert.ok((await call('/forum/sections/'+section.id+'/tags')).body.some(r=>r.name==='经典研习'));
    });
    await t.test('replies retain owner-only pending view; comment reports obey exclusive target constraint',async()=>{
      const dto={requestKey:randomUUID(),body:'请教此段的理解'};const rows=await Promise.all([1,2].map(()=>call('/forum/threads/'+thread.id+'/comments',viewer,'POST',dto)));assert.ok(rows.every(r=>r.status===201));assert.equal(rows[0].body.id,rows[1].body.id);comment=rows[0].body;
      assert.equal((await call('/forum/threads/'+thread.id+'/comments')).body.total,0);assert.equal((await call('/forum/threads/'+thread.id+'/comments',viewer)).body.total,1);
      assert.equal((await call('/admin/forum/comments/'+comment.id+'/moderate',root,'POST',{expectedVersion:1,action:'APPROVE',reason:'回复通过审核'})).status,201);
      const reported=await call('/forum/threads/'+thread.id+'/reports',author,'POST',{reason:'SPAM',description:'测试举报',commentId:comment.id});assert.equal(reported.status,201,JSON.stringify(reported.body));report=await db.report.findUniqueOrThrow({where:{id:reported.body.id}});assert.equal(report.resourceId,null);assert.equal(report.commentId,comment.id);
      const target=(await call('/admin/forum/reports',root)).body.items.find(r=>r.id===report.id);assert.equal(target.target.body,dto.body);assert.equal(target.target.resourceId,thread.id);assert.equal(target.target.kind,'THREAD');
      const listed=(await call('/admin/forum/comments',root)).body.items.find(r=>r.id===comment.id);assert.equal(listed.resourceKind,'THREAD');assert.equal(listed.authorName,viewer.user.nickname);
      assert.equal((await call('/admin/forum/comments/'+comment.id+'/moderate',root,'POST',{expectedVersion:2,action:'HIDE',reason:'举报核实隐藏',reportId:report.id})).status,201);
      assert.equal((await call('/forum/reports',author)).body.items.find(r=>r.id===report.id).state,'RESOLVED');
      assert.equal((await call('/admin/forum/comments/'+comment.id+'/moderate',root,'POST',{expectedVersion:3,action:'RESTORE',reason:'恢复重新审核'})).status,201);assert.equal((await call('/forum/threads/'+thread.id+'/comments')).body.total,0);
      const pending=await call('/forum/threads/'+thread.id+'/reports',viewer,'POST',{reason:'SPAM',description:'测试独立处置'});assert.equal(pending.status,201);
      const resolved=await Promise.all([1,2].map(()=>call('/admin/forum/reports/'+pending.body.id+'/resolve',root,'POST',{expectedVersion:1,reason:'已核实并记录处理结果'})));assert.deepEqual(resolved.map(r=>r.status).sort(),[201,409]);
      assert.equal(await db.auditLog.count({where:{resourceId:pending.body.id,action:'forum.report.resolve'}}),1);
    });
    await t.test('blocking hides discovery and forbids direct replies; restrictions and revocation take effect',async()=>{
      assert.equal((await call('/forum/blocks/'+author.id,viewer,'POST')).status,201);
      assert.equal((await call('/forum/threads/'+thread.id,viewer)).status,404);
      assert.equal((await call('/discovery/search?q='+prefix+'&type=THREAD',viewer)).body.total,0);
      assert.equal((await call('/forum/blocks/'+author.id,viewer,'DELETE')).status,200);
      const r=await call('/admin/forum/users/'+viewer.id+'/restrict',root,'POST',{scope:'ALL',days:7,reason:'测试禁言'});assert.equal(r.status,201);restriction=r.body;
      assert.equal((await call('/forum/threads/'+thread.id+'/comments',viewer,'POST',{requestKey:randomUUID(),body:'禁言发言'})).status,403);
      const revoked=await Promise.all([1,2].map(()=>call('/admin/forum/restrictions/'+restriction.id+'/revoke',root,'POST',{expectedVersion:1,reason:'解除限制'})));assert.deepEqual(revoked.map(r=>r.status).sort(),[201,409]);
      assert.equal((await call('/forum/threads/'+thread.id+'/reactions',viewer,'POST',{kind:'LIKE',active:true})).body.likes,1);
    });
    await t.test('course threads stay out of public search and require real course access',async()=>{
      const teacher=await db.teacher.create({data:{name:prefix,title:'测试',bio:'测试',expertise:[],status:'PUBLISHED',isDemo:true}});teachers.push(teacher.id);
      course=await db.course.create({data:{teacherId:teacher.id,title:prefix,subtitle:'测试',description:'测试',category:'经典研习',format:'VIDEO',price:0,cover:'/static/art/books.svg',status:'PUBLISHED',isDemo:true}});courses.push(course.id);
      const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title}});await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});await db.enrollment.create({data:{userId:author.id,courseId:course.id,releaseId:release.id,source:'MANUAL'}});
      await db.user.update({where:{id:author.id},data:{roles:['USER','TEACHER']}});await db.courseStaff.create({data:{courseId:course.id,userId:author.id,role:'TEACHER'}});
      assert.equal((await call('/forum/sections?courseId='+course.id,viewer)).status,403);
      const s=(await call('/forum/sections?courseId='+course.id,author)).body.items[0];sections.push(s.id);const row=await post(s.id,'仅课程学员可见');assert.equal((await moderate(row.id,1)).status,201);
      assert.equal((await call('/forum/threads/'+row.id)).status,403);assert.equal((await call('/forum/threads/'+row.id,viewer)).status,403);assert.equal((await call('/forum/threads/'+row.id,author)).status,200);
      assert.equal((await call('/forum/threads/'+row.id,author)).body.author.teachingRole,'TEACHER');
      assert.equal((await call('/discovery/search?q='+prefix+'&type=THREAD')).body.items.some(r=>r.id===row.id),false);
    });
    await t.test('forum images stay private until approval and old tickets fail after hiding',async()=>{
      const fd=new FormData();fd.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZgAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),'forum.png');
      const r=await fetch(base+'/forum/images',{method:'POST',headers:{Authorization:'Bearer '+author.accessToken},body:fd});assert.equal(r.status,201);const asset=await r.json();assets.push(asset.id);
      await db.mediaAsset.update({where:{id:asset.id},data:{variants:{uploadPurpose:'HOMEWORK_IMAGE'}}});
      assert.equal((await call('/forum/threads',author,'POST',{requestKey:randomUUID(),sectionId:section.id,title:prefix,body:'拒绝发布私有作业附件',assetIds:[asset.id],tags:[]})).status,400);
      await db.mediaAsset.update({where:{id:asset.id},data:{variants:{uploadPurpose:'FORUM_IMAGE'}}});
      const row=await post(section.id,'图文心得',[asset.id]);assert.equal((await call('/forum/threads/'+row.id+'/images/'+asset.id,null,'POST')).status,404);assert.equal((await moderate(row.id,1)).status,201);
      const ticket=await call('/forum/threads/'+row.id+'/images/'+asset.id,null,'POST');assert.equal(ticket.status,201);publicTicket=base+ticket.body.path;assert.equal((await fetch(publicTicket)).status,200);
      assert.equal((await moderate(row.id,2,'HIDE')).status,201);assert.equal((await fetch(publicTicket)).status,404);
      assert.equal((await moderate(row.id,3,'RESTORE')).status,201);assert.equal((await call('/forum/threads/'+row.id)).status,404);assert.equal((await moderate(row.id,4)).status,201);
      assert.equal((await call('/me/progression',author)).body.points,'3');
    });
    await t.test('concurrent public rewards obey the shared daily growth cap',async()=>{
      const a=await post(section.id),b=await post(section.id);const rows=await Promise.all([moderate(a.id,1),moderate(b.id,1)]);assert.ok(rows.every(r=>r.status===201),JSON.stringify(rows));
      const stats=(await call('/me/progression',author)).body;assert.equal(stats.growth,15);assert.equal(stats.points,'3');
      // The hidden image thread loses its 5 growth; withdrawal must not refill today's cap.
      assert.equal((await db.growthLedger.aggregate({where:{userId:author.id,delta:{gt:0}},_sum:{delta:true}}))._sum.delta,20);
      assert.equal((await db.growthLedger.aggregate({where:{userId:author.id,delta:{lt:0}},_sum:{delta:true}}))._sum.delta,-5);
    });
    await t.test('author withdrawals are versioned and closure removes forum content and caches',async()=>{
      assert.equal((await call('/forum/threads/'+thread.id+'/withdraw',viewer,'POST',{expectedVersion:3})).status,404);
      assert.equal((await call('/forum/threads/'+thread.id+'/withdraw',author,'POST',{expectedVersion:3})).status,201);assert.equal((await call('/forum/threads/'+thread.id)).status,404);
      assert.equal((await call('/me/close-account',author,'POST',{confirmation:'确认注销'})).status,201);
      assert.ok((await db.forumThread.findMany({where:{authorId:author.id}})).every(r=>r.deletedAt&&r.blocks.length===0));assert.equal(await db.idempotencyRecord.count({where:{userId:author.id}}),0);
    });
  }finally{
    try{
      await db.notification.deleteMany({where:{userId:{in:users}}});await db.userRestriction.deleteMany({where:{userId:{in:users}}});await db.moderationAction.deleteMany({where:{actorId:{in:users}}});await db.report.deleteMany({where:{reporterId:{in:users}}});await db.comment.deleteMany({where:{resourceId:{in:threads}}});await db.reaction.deleteMany({where:{userId:{in:users}}});await db.userBlock.deleteMany({where:{userId:{in:users}}});await db.attachmentBinding.deleteMany({where:{threadId:{in:threads}}});await db.resourceTag.deleteMany({where:{resourceId:{in:threads}}});
      await db.growthLedger.deleteMany({where:{userId:{in:users}}});const accounts=await db.pointsAccount.findMany({where:{userId:{in:users}},select:{id:true}});await db.pointsLedger.deleteMany({where:{accountId:{in:accounts.map(r=>r.id)}}});await db.pointsAccount.deleteMany({where:{userId:{in:users}}});
      await db.forumThread.deleteMany({where:{id:{in:threads}}});await db.forumSection.deleteMany({where:{id:{in:sections}}});await clearCourses(db,courses);await db.course.deleteMany({where:{id:{in:courses}}});await db.teacher.deleteMany({where:{id:{in:teachers}}});await db.resource.deleteMany({where:{id:{in:[...courses,...teachers]}}});await db.mediaAsset.deleteMany({where:{id:{in:assets}}});
      await db.idempotencyRecord.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.otpChallenge.deleteMany({where:{OR:[{phone:{in:phones}},{phoneHash:{in:phones.map(phoneLookup)}}]}});
    }finally{await db.$disconnect();await app.close();await rm(mediaDir,{recursive:true,force:true});}
  }
});
