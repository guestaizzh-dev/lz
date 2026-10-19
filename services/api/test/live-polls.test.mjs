import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';

test('live polls and private surveys: HTTP permissions, transactions and actual PostgreSQL facts',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/v1',origin='http://127.0.0.1:5173',auth=app.get(AuthService);
  async function account(roles=['USER']){const user=await db.user.create({data:{nickname:'课堂互动隔离测试',roles}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind:roles.includes('USER')?'APP':'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return{id:user.id,headers:roles.includes('USER')?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken}};}
  async function call(path,actor,method='GET',data){const r=await fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...actor?.headers},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:r.status,body:await r.json()};}
  async function post(path,data,actor=root){const r=await call(path,actor,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  let root,operator,moderator,host,otherHost,a,b,room,session,poll,survey;
  const dto=(extra={})=>({kind:'POLL',question:'今天先研习哪一章？',options:['上善若水','致虚守静'],allowMultiple:false,closesAt:new Date(Date.now()+600000).toISOString(),resultVisibility:'AFTER_VOTE',...extra});
  const answer=(ids=['o1'])=>({answers:[{questionId:'q1',optionIds:ids}]}),admin=()=>'/admin/live/sessions/'+session.id+'/polls',user=()=>'/live/sessions/'+session.id+'/polls';
  async function list(actor=a){const r=await call(user(),actor);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.items;}
  async function state(row,action='OPEN'){await post(admin()+'/'+row.id+'/state',{expectedVersion:row.version,action,reason:'随堂互动测试'});return db.livePoll.findUniqueOrThrow({where:{id:row.id}});}
  try{
    root=await account(['ADMIN']);operator=await account(['OPERATOR']);moderator=await account(['MODERATOR']);host=await account(['TEACHER']);otherHost=await account(['TEACHER']);a=await account();b=await account();
    const teacher=await post('/admin/teachers',{name:'互动测试名师',title:'经典研习',bio:'课堂互动隔离样例',expertise:['道德经'],portrait:'https://example.org/teacher.png'});await db.teacher.update({where:{id:teacher.id},data:{userId:host.id}});
    let teacherVersion=teacher.version;for(const action of ['submit','publish']){const updated=await post('/admin/teachers/'+teacher.id+'/transition',{action,expectedVersion:teacherVersion,reason:'隔离测试发布'});teacherVersion=updated.version;}
    room=await post('/admin/live',{title:'经典共研互动测试',summary:'仅用于隔离测试',teacherId:teacher.id,categoryCode:'CULTURE',accessMode:'PUBLIC'});
    await post('/admin/live-discovery/'+room.id+'/publication',{title:'经典共研互动测试',summary:'仅用于隔离测试',state:'PUBLISHED',expectedVersion:1,reason:'测试公开准入'});
    session=await post('/admin/live/rooms/'+room.id+'/sessions',{title:'课堂互动',hostUserId:host.id,scheduledAt:new Date(Date.now()+600000).toISOString()});
    await t.test('draft workflow validates options, timestamps and backend capabilities',async()=>{
      assert.equal((await call(admin(),moderator,'POST',dto())).status,403);assert.equal((await call(admin(),a,'POST',dto())).status,403);
      for(const extra of [{options:['同名',' 同名 ']},{options:['一项']},{closesAt:'2026-12-10T12:00:00'},{closesAt:new Date(Date.now()-1000).toISOString()},{closesAt:new Date(Date.now()+31*86400000).toISOString()},{questions:[{type:'TEXT',prompt:'多余',required:true}]}])assert.equal((await call(admin(),operator,'POST',dto(extra))).status,400);
      poll=await post(admin(),dto(),operator);assert.equal(await db.pollOption.count({where:{pollId:poll.id}}),2);
      assert.equal((await call(user(),a)).status,409);
      assert.equal((await call(admin()+'/'+poll.id+'/state',operator,'POST',{expectedVersion:1,action:'OPEN',reason:'尚未开播'})).status,409);
      const edited=await call(admin()+'/'+poll.id,operator,'PATCH',{...dto({options:['守静','不争','知足']}),expectedVersion:1});assert.equal(edited.status,200);poll=edited.body;assert.equal(poll.version,2);assert.equal(await db.pollOption.count({where:{pollId:poll.id}}),3);
      assert.equal((await call(admin()+'/'+poll.id,operator,'PATCH',{...dto(),expectedVersion:1})).status,409);
      await db.liveSession.update({where:{id:session.id},data:{state:'LIVE'}});assert.deepEqual(await list(),[]);
    });
    await t.test('host routes enforce ownership even for a root administrator; reviewers only read',async()=>{
      const path='/admin/live-host/'+session.id+'/polls';assert.equal((await call(path,host)).status,200);assert.equal((await call(path,otherHost)).status,403);assert.equal((await call(path,root)).status,403);
      const r=await post(path,dto({question:'主持人投票'}),host);assert.equal((await call(path+'/'+r.id,otherHost,'PATCH',{...dto(),expectedVersion:1})).status,403);
      assert.equal((await call(admin(),moderator)).status,200);assert.equal((await call(admin(),host)).status,403);
      await db.user.update({where:{id:host.id},data:{status:'FROZEN'}});assert.equal((await call(path,host)).status,401);await db.user.update({where:{id:host.id},data:{status:'ACTIVE'}});
    });
    await t.test('concurrent identical submissions create one response and one vote; changed answers conflict',async()=>{
      poll=await state(poll);assert.equal((await list()).find(p=>p.id===poll.id).results,undefined);
      const replies=await Promise.all([1,2,3].map(()=>call(user()+'/'+poll.id+'/responses',a,'POST',answer())));assert.ok(replies.every(r=>r.status===201),JSON.stringify(replies));
      assert.equal(await db.pollResponse.count({where:{pollId:poll.id,userId:a.id}}),1);assert.equal(await db.pollVote.count({where:{pollId:poll.id,userId:a.id}}),1);
      assert.equal((await call(user()+'/'+poll.id+'/responses',a,'POST',answer(['o2']))).status,409);
      const mine=(await list()).find(p=>p.id===poll.id);assert.equal(mine.submitted,true);assert.equal(mine.canSubmit,false);assert.equal(mine.participants,1);assert.equal(mine.results[0].count,1);
      const theirs=(await list(b)).find(p=>p.id===poll.id);assert.deepEqual(theirs.answers,[]);assert.equal(theirs.results,undefined);assert.equal(theirs.participants,undefined);
      assert.equal((await call(admin()+'/'+poll.id,root,'PATCH',{...dto(),expectedVersion:poll.version})).status,409);
    });
    await t.test('invalid answers cannot create records; multi-choice counts one participant',async()=>{
      for(const value of [answer(['o1','o1']),answer(['o1','o2']),answer(['unknown']),{answers:[{questionId:'q2',optionIds:['o1']}]},{answers:[{questionId:'q1',optionIds:['o1']},{questionId:'q1',optionIds:['o1']}]},answer([])])assert.equal((await call(user()+'/'+poll.id+'/responses',b,'POST',value)).status,400);
      let multi=await post(admin(),dto({allowMultiple:true,resultVisibility:'AFTER_CLOSE'}));multi=await state(multi);await post(user()+'/'+multi.id+'/responses',answer(['o1','o2']),b);
      assert.equal((await list(b)).find(p=>p.id===multi.id).results,undefined);multi=await state(multi,'CLOSE');const result=(await list(a)).find(p=>p.id===multi.id);assert.equal(result.participants,1);assert.deepEqual(result.results.map(o=>o.count),[1,1]);
      assert.equal((await call(user()+'/'+multi.id+'/responses',a,'POST',answer())).status,409);
      assert.equal((await call(user()+'/'+multi.id+'/responses',b,'POST',answer(['o2','o1']))).status,201);
    });
    await t.test('survey validates mandatory and optional fields, encrypts answers and only returns anonymous authorized pages',async()=>{
      const body=dto({kind:'SURVEY',question:'本场研习反馈',options:undefined,resultVisibility:'HOST_ONLY',questions:[{type:'SINGLE',prompt:'是否理解？',required:true,options:['理解','需要重讲']},{type:'TEXT',prompt:'还想了解什么？',required:true},{type:'MULTIPLE',prompt:'后续方向',required:false,options:['生活实践','经典注释']}]});
      assert.equal((await call(admin(),root,'POST',{...body,resultVisibility:'AFTER_VOTE'})).status,400);
      survey=await post(admin(),body);survey=await state(survey);
      const responses={answers:[{questionId:'q1',optionIds:['o2']},{questionId:'q2',text:'想了解无为与日常工作的关系'}]};
      assert.equal((await call(user()+'/'+survey.id+'/responses',a,'POST',answer())).status,400);await post(user()+'/'+survey.id+'/responses',responses,a);
      const raw=await db.pollResponse.findUniqueOrThrow({where:{pollId_userId:{pollId:survey.id,userId:a.id}}});assert.ok(raw.answersCipher.startsWith('v1:'));assert.ok(!raw.answersCipher.includes('日常工作'));assert.equal(await db.pollVote.count({where:{pollId:survey.id}}),0);
      const theirs=(await list(b)).find(p=>p.id===survey.id);assert.deepEqual(theirs.answers,[]);assert.equal(theirs.results,undefined);assert.equal(theirs.participants,undefined);
      assert.equal((await call(admin()+'/'+survey.id+'/responses',moderator)).status,403);
      const result=await call(admin()+'/'+survey.id+'/responses',operator);assert.equal(result.status,200);assert.equal(result.body.hasMore,false);assert.match(JSON.stringify(result.body),/无为/);for(const value of [a.id,raw.id,'userId','answersCipher'])assert.ok(!JSON.stringify(result.body).includes(value));
      assert.equal((await call('/admin/live-host/'+session.id+'/polls/'+survey.id+'/responses',host)).status,200);
      assert.equal((await call(admin()+'/'+survey.id+'/responses?page=0',operator)).status,400);
      assert.ok(await db.auditLog.count({where:{action:'live.survey.responses',resourceId:session.id}})>=2);
      const additional=await Promise.all(Array.from({length:20},()=>db.user.create({data:{nickname:'匿名分页测试'}})));
      await db.pollResponse.createMany({data:additional.map(u=>({pollId:survey.id,userId:u.id,answersCipher:raw.answersCipher}))});
      const first=await call(admin()+'/'+survey.id+'/responses',operator),second=await call(admin()+'/'+survey.id+'/responses?page=2',operator);
      assert.equal(first.body.items.length,20);assert.equal(first.body.hasMore,true);assert.equal(second.body.items.length,1);assert.equal(second.body.items[0].number,21);assert.equal(second.body.hasMore,false);
    });
    await t.test('generic data editor cannot reveal individual votes or mutate published options',async()=>{
      for(const key of ['poll_vote','poll_response'])assert.ok([403,404].includes((await call('/admin/data/'+key,root)).status),key);
      assert.equal((await call('/admin/data/poll_option',root,'POST',{data:{pollId:poll.id,label:'绕过',position:9},reason:'绕过业务接口'})).status,403);
    });
    await t.test('cross-session, deadlines, withdrawal, ending and unpublished rooms are enforced',async()=>{
      const another=await post('/admin/live/rooms/'+room.id+'/sessions',{title:'另一个场次',hostUserId:host.id,scheduledAt:new Date(Date.now()+600000).toISOString()});await db.liveSession.update({where:{id:another.id},data:{state:'LIVE'}});
      assert.equal((await call('/live/sessions/'+another.id+'/polls/'+poll.id+'/responses',b,'POST',answer())).status,404);
      const expired=await post(admin(),dto());await state(expired);await db.livePoll.update({where:{id:expired.id},data:{closesAt:new Date(Date.now()-1000)}});assert.equal((await call(user()+'/'+expired.id+'/responses',b,'POST',answer())).status,409);
      await state(poll,'REVOKE');assert.ok(!(await list()).some(p=>p.id===poll.id));assert.equal((await call(user()+'/'+poll.id+'/responses',a,'POST',answer())).status,404);
      const ending=await post(admin(),dto());await state(ending);await db.liveSession.update({where:{id:session.id},data:{state:'ENDED'}});assert.equal((await list()).find(p=>p.id===ending.id).state,'CLOSED');assert.equal((await call(user()+'/'+ending.id+'/responses',b,'POST',answer())).status,409);
      await db.resource.update({where:{id:room.id},data:{publishState:'ARCHIVED'}});assert.equal((await call(user(),a)).status,404);await db.resource.update({where:{id:room.id},data:{publishState:'PUBLISHED'}});
    });
    await t.test('membership expiration and account closure remove access and private answers',async()=>{
      await db.liveSession.update({where:{id:session.id},data:{state:'LIVE',accessRuleSnapshot:{mode:'MEMBER',tier:1}}});assert.equal((await call(user(),a)).status,403);await db.liveSession.update({where:{id:session.id},data:{accessRuleSnapshot:{mode:'PUBLIC'}}});
      assert.equal((await call(user())).status,401);
      assert.equal((await call('/me/close-account',a,'POST',{confirmation:'确认注销'})).status,201);assert.equal(await db.pollResponse.count({where:{userId:a.id}}),0);assert.equal(await db.pollVote.count({where:{userId:a.id}}),0);assert.equal((await call(user(),a)).status,401);
    });
  }finally{await app.close();await db.$disconnect();}
});
