import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';

test('teacher profiles: reviewed fields, curated teaching content and actual schedules',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService);
  async function actor(role){const user=await db.user.create({data:{nickname:randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind:'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return {id:user.id,Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken};}
  async function call(path,who,method='GET',data){const headers={Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...(who??{})};delete headers.id;const r=await fetch(base+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:await r.json()};}
  async function post(path,data,who){const r=await call(path,who,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  const future=ms=>new Date(Date.now()+ms),profile={name:'研习讲师'+randomUUID(),title:'经典讲师',bio:'隔离验收资料',expertise:['经典研习'],teachingDirection:'以日常实践讲解道德经',lineageSummary:'传承背景须经书院核查',achievementSummary:'实际教学记录'};
  let teacher;
  try{
    const operator=await actor('OPERATOR'),moderator=await actor('MODERATOR'),root=await actor('ADMIN'),support=await actor('SUPPORT');
    await t.test('draft profile fields use the existing review/version workflow and audit',async()=>{
      assert.equal((await call('/admin/teachers',support,'POST',profile)).status,403);teacher=await post('/admin/teachers',profile,operator);
      const changed=await call('/admin/teachers/'+teacher.id,operator,'PATCH',{...profile,expectedVersion:teacher.version,teachingDirection:'修订后的独立授课方向'});assert.equal(changed.status,200);teacher=changed.body;
      assert.equal((await call('/admin/teachers/'+teacher.id,operator,'PATCH',{...profile,expectedVersion:1})).status,409);
      const audit=await db.auditLog.findFirst({where:{resourceId:teacher.id,action:'teacher.edit'}});assert.ok(audit.changes.changedFields.includes('teachingDirection'));
      teacher=await post('/admin/teachers/'+teacher.id+'/transition',{action:'submit',expectedVersion:teacher.version,reason:'核查档案'},operator);teacher=await post('/admin/teachers/'+teacher.id+'/transition',{action:'publish',expectedVersion:teacher.version,reason:'确认可公开档案'},moderator);
      const shown=(await call('/catalog/teachers/'+teacher.id)).body;assert.equal(shown.teachingDirection,'修订后的独立授课方向');assert.equal(shown.lineageSummary,profile.lineageSummary);
      assert.equal((await call('/admin/teachers/'+teacher.id,operator,'PATCH',{...profile,expectedVersion:teacher.version})).status,409);
    });
    const asset=await db.mediaAsset.create({data:{name:'介绍课件.mp4',storageKey:randomUUID(),mime:'video/mp4',bytes:100,uploaderId:root.id,status:'READY',visibility:'PRIVATE'}});
    const articleData={title:'老师说经典',summary:'公开介绍',category:'经典原文',author:'讲师',source:'隔离测试',cover:'/static/art/books.svg',status:'PUBLISHED',tags:[],blocks:[{id:'intro',type:'video',caption:'名师介绍',mediaId:asset.id}]};
    const intro=await db.article.create({data:articleData}),member=await db.article.create({data:{...articleData,title:'会员独家解读',visibility:'MEMBER',membershipTier:3,blocks:[{id:'p',type:'paragraph',text:'私人全文绝不可随名师页公开'}]}}),plain=await db.article.create({data:{...articleData,title:'纯文本文章',blocks:[{id:'p',type:'paragraph',text:'无音视频'}]}});
    const courseData={title:'代表课程',subtitle:'研习导览',description:'隔离数据',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',teacherId:teacher.id,status:'PUBLISHED',price:0,tags:[]};
    const first=await db.course.create({data:courseData}),second=await db.course.create({data:{...courseData,title:'第二代表课程'}}),foreignTeacher=await db.teacher.create({data:{...profile,name:'另一讲师',status:'PUBLISHED'}}),foreign=await db.course.create({data:{...courseData,teacherId:foreignTeacher.id}});
    const relation=(target,type,rank,purpose='RELATED')=>({fromId:teacher.id,fromType:'TEACHER',toId:target.id,type,rank,purpose,reason:'编排名师档案'});
    let introRelation;
    await t.test('curation checks teacher ownership, moderator capabilities, purpose and membership',async()=>{
      assert.equal((await call('/admin/content-relations',operator,'POST',relation(first,'COURSE',0))).status,403);
      assert.equal((await call('/admin/content-relations',moderator,'POST',relation(foreign,'COURSE',0))).status,400);
      await post('/admin/content-relations',relation(first,'COURSE',20),moderator);await post('/admin/content-relations',relation(second,'COURSE',1),moderator);
      assert.equal((await call('/admin/content-relations',moderator,'POST',relation(plain,'ARTICLE',1,'INTRODUCTION'))).status,400);
      assert.equal((await call('/admin/content-relations',moderator,'POST',relation(intro,'ARTICLE',1,'INTERPRETATION'))).status,400);
      assert.equal((await call('/admin/content-relations',moderator,'POST',relation(member,'ARTICLE',1,'INTRODUCTION'))).status,400);
      introRelation=await post('/admin/content-relations',relation(intro,'ARTICLE',0,'INTRODUCTION'),moderator);await post('/admin/content-relations',relation(member,'ARTICLE',0,'INTERPRETATION'),moderator);
      const result=(await call('/catalog/teachers/'+teacher.id)).body;assert.deepEqual(result.representativeCourses.map(c=>c.id),[second.id,first.id]);assert.equal(result.introductions[0].id,intro.id);assert.equal(result.interpretations[0].id,member.id);assert.ok(!JSON.stringify(result).includes('私人全文'));assert.ok(!('blocks' in result.interpretations[0]));assert.equal((await call('/catalog/articles/'+member.id)).body.access,'MEMBERSHIP_REQUIRED');
      await db.contentRelation.update({where:{id:introRelation.id},data:{endsAt:future(-1000)}});assert.deepEqual((await call('/catalog/teachers/'+teacher.id)).body.introductions,[]);
      await db.course.update({where:{id:second.id},data:{status:'ARCHIVED'}});assert.deepEqual((await call('/catalog/teachers/'+teacher.id)).body.representativeCourses.map(c=>c.id),[first.id]);
    });
    await t.test('schedule derives only live, published linked events and available consultation slots',async()=>{
      const room=await db.liveRoom.create({data:{teacherId:teacher.id,provider:'ZEGO',providerRoomId:randomUUID(),categoryCode:'CLASSICS',accessRule:{mode:'PUBLIC'}}});await db.resource.update({where:{id:room.id},data:{title:'名师直播',publishState:'PUBLISHED'}});
      const session=await db.liveSession.create({data:{roomId:room.id,hostUserId:root.id,title:'线上讲经',scheduledAt:future(3600000),state:'SCHEDULED',accessRuleSnapshot:{mode:'PUBLIC'}}});
      const event=await db.event.create({data:{title:'线下研习见面',category:'线下活动',responsibleUserId:root.id,teacherId:teacher.id,description:'真实场次测试',location:'书院',startsAt:future(7200000),endsAt:future(14400000),cover:'/static/art/books.svg',price:0,capacity:10,status:'PUBLISHED'}});
      const eventSession=await db.eventSession.create({data:{eventId:event.id,startsAt:future(9000000),endsAt:future(10000000),location:'书院一层',state:'OPEN',capacity:10,publicOpenAt:new Date(),cancelDeadline:future(8000000)}});
      const offering=await db.serviceOffering.create({data:{teacherId:teacher.id,title:'经典咨询',mode:'PHONE',durationMinutes:30,leadMinutes:60,cancelBeforeMinutes:60,locationPolicy:'电话',deliveryPolicy:'仅研习交流',active:true}}),slot=await db.appointmentSlot.create({data:{teacherId:teacher.id,offeringId:offering.id,startsAt:future(18000000),endsAt:future(19800000),capacity:1}});
      let shown=(await call('/catalog/teachers/'+teacher.id)).body;assert.deepEqual(shown.schedule.map(s=>s.id),[session.id,eventSession.id,slot.id]);assert.ok(!JSON.stringify(shown.schedule).includes('contactCipher'));
      await db.liveSession.update({where:{id:session.id},data:{scheduledAt:future(16000000)}});shown=(await call('/catalog/teachers/'+teacher.id)).body;assert.deepEqual(shown.schedule.map(s=>s.id),[eventSession.id,session.id,slot.id]);
      await db.liveSession.update({where:{id:session.id},data:{state:'CANCELLED'}});await db.appointmentSlot.update({where:{id:slot.id},data:{confirmed:1}});await db.event.update({where:{id:event.id},data:{status:'ARCHIVED'}});assert.deepEqual((await call('/catalog/teachers/'+teacher.id)).body.schedule,[]);
      await db.teacher.update({where:{id:teacher.id},data:{status:'ARCHIVED'}});assert.equal((await call('/catalog/teachers/'+teacher.id)).status,404);
    });
  }finally{await app.close();await db.$disconnect();}
});
