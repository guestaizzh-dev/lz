import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {LearningService} from '../dist/learning.js';
import {MembershipBenefitsService,benefitWindow} from '../dist/membership-benefits.js';

if(process.env.NODE_ENV!=='test')throw Error('Membership benefits require the isolated runner');
test('frozen membership benefits and atomic quotas preserve independent sources',async t=>{
  const app=await createApp(false),db=new Database(),prefix='qa-benefits-'+randomUUID(),users=[],definitionIds=[],versionIds=[],auth=app.get(AuthService),benefits=app.get(MembershipBenefitsService);
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),plan=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:2,days:90}}});
  async function session(role,kind){const user=await db.user.create({data:{nickname:prefix+users.length,roles:[role]}});users.push(user.id);const credentials=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:credentials.accessHash,refreshHash:credentials.refreshHash,accessExpiresAt:credentials.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return{user,access:credentials.access,csrfToken,kind};}
  async function call(path,s,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Origin:(process.env.CORS_ORIGINS??'http://127.0.0.1:5173').split(',')[0],...(s?.kind==='APP'?{Authorization:'Bearer '+s.access}:{Cookie:'daoxue_access='+s.access,'X-CSRF-Token':s.csrfToken})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};}
  const root=await session('ADMIN','ADMIN'),a=await session('USER','APP'),b=await session('USER','APP'),quotaUser=await session('USER','APP'),grantUser=await session('USER','APP');let currentPlan=plan,definition,period,grant,firstUsage;
  const hold=(userId,key,quantity=1)=>db.$transaction(tx=>benefits.hold(tx,userId,definition.code,key,quantity,{categoryCode:'TEST_ALLOWED'}));
  const finish=(userId,id,state)=>db.$transaction(tx=>benefits.finish(tx,userId,id,state));
  try{
    await t.test('new benefit versions do not change the old content grant; future and revoked sources fail closed',async()=>{
      const old=await db.membership.create({data:{userId:a.user.id,planId:plan.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});
      assert.equal((await app.get(LearningService).membership(a.user.id)).contentTier,2);
      const changed=await call('/admin/membership-benefits/plans/'+plan.id+'/content',root,'POST',{expectedVersion:plan.version,contentTier:1,reason:'测试新售权益版本'});assert.equal(changed.status,201,JSON.stringify(changed.body));currentPlan=changed.body;
      assert.notEqual(currentPlan.currentVersionId,old.planVersionId);assert.equal((await app.get(LearningService).membership(a.user.id)).contentTier,2);
      const listed=await call('/learning/plans',a);assert.equal(listed.status,200);assert.equal(listed.body.find(p=>p.id===plan.id).contentTier,1);assert.match(listed.body.find(p=>p.id===plan.id).description,/银牌|铜牌/);assert.equal(listed.body.find(p=>p.id===plan.id).tier,2);
      await db.membership.create({data:{userId:b.user.id,planId:plan.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});assert.equal((await app.get(LearningService).membership(b.user.id)).contentTier,1);
      const stale=await call('/admin/membership-benefits/plans/'+plan.id+'/content',root,'POST',{expectedVersion:plan.version,contentTier:2,reason:'过期编辑不得覆盖'});assert.equal(stale.status,409);
      assert.equal((await call('/admin/membership-benefits/plans/'+plan.id+'/content',root,'POST',{expectedVersion:currentPlan.version,contentTier:3,reason:'不能越过套餐层级'})).status,400);
      const summary=await call('/learning/benefits',a);assert.equal(summary.status,200);assert.equal(summary.body.memberships[0].benefits.find(b=>b.code==='CONTENT_ACCESS').parameters.contentTier,2);
      assert.equal((await call('/learning/benefits?userId='+a.user.id,b)).status,400);
      const history=await call('/admin/membership-benefits/plans/'+plan.id,root);assert.equal(history.status,200);assert.equal(history.body.items[0].benefits.find(b=>b.definition.code==='CONTENT_ACCESS').parameters.contentTier,1);
      await db.membership.update({where:{id:old.id},data:{revokedAt:new Date()}});assert.equal(await app.get(LearningService).membership(a.user.id),null);
    });
    await t.test('database and generic editor cannot rewrite published terms, source identity or usage ownership',async()=>{
      const benefit=await db.planBenefit.findFirstOrThrow({where:{planVersionId:currentPlan.currentVersionId}});
      await assert.rejects(db.planBenefit.update({where:{id:benefit.id},data:{parameters:{contentTier:3}}}),/immutable/);
      await assert.rejects(db.planBenefit.delete({where:{id:benefit.id}}),/immutable/);
      await assert.rejects(db.membershipPlanVersion.update({where:{id:currentPlan.currentVersionId},data:{tier:3}}),/immutable/);
      assert.equal((await call('/admin/data/benefit_definition/'+benefit.definitionId,root,'PATCH',{data:{active:false},reason:'不能绕过权益定义'})).status,403);
      const member=await db.membership.findFirstOrThrow({where:{userId:b.user.id}});await assert.rejects(db.membership.update({where:{id:member.id},data:{planVersionId:plan.currentVersionId}}),/immutable/);
    });
    await t.test('concurrent reservations cannot exceed frozen quota and retries cannot change quantity',async()=>{
      definition=await db.benefitDefinition.create({data:{code:'QA_QUOTA_'+randomUUID().replaceAll('-',''),name:'隔离测试配额',kind:'QUOTA',parameterSchema:{},active:true}});definitionIds.push(definition.id);
      const latest=await db.membershipPlanVersion.findFirstOrThrow({where:{planId:plan.id},orderBy:{releaseNo:'desc'}}),v=await db.membershipPlanVersion.create({data:{planId:plan.id,releaseNo:latest.releaseNo+1,tier:2,days:90,description:'隔离测试权益，不发布真实套餐',termsSnapshot:{price:4900},publishedAt:new Date()}});versionIds.push(v.id);
      const scoped=await db.planBenefit.create({data:{planVersionId:v.id,definitionId:definition.id,parameters:{service:'fixture'},quota:2,periodKind:'DAY'}});
      await db.benefitScope.create({data:{planBenefitId:scoped.id,categoryCode:'TEST_ALLOWED'}});
      period=await db.membership.create({data:{userId:quotaUser.user.id,planId:plan.id,planVersionId:v.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});
      await assert.rejects(db.$transaction(tx=>benefits.hold(tx,quotaUser.user.id,definition.code,'wrong-scope',1,{categoryCode:'OTHER'})),/不可用/);
      const results=await Promise.allSettled([hold(quotaUser.user.id,'service:1'),hold(quotaUser.user.id,'service:2'),hold(quotaUser.user.id,'service:3')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(results.filter(r=>r.status==='rejected').length,1);firstUsage=results.find(r=>r.status==='fulfilled').value;
      const repeats=await Promise.all([hold(quotaUser.user.id,firstUsage.businessKey),hold(quotaUser.user.id,firstUsage.businessKey)]);assert.equal(repeats[0].id,firstUsage.id);assert.equal(repeats[1].id,firstUsage.id);await assert.rejects(hold(quotaUser.user.id,firstUsage.businessKey,2),/不能改变/);
      assert.equal(await db.benefitUsage.count({where:{userId:quotaUser.user.id}}),2);await assert.rejects(db.benefitUsage.update({where:{id:firstUsage.id},data:{userId:a.user.id}}),/identity/);
      const summary=await call('/learning/benefits',quotaUser);assert.equal(summary.body.usage.total,2);
    });
    await t.test('release and compensation are idempotent, consumed reservations survive expiry and transaction rollback frees capacity',async()=>{
      await finish(quotaUser.user.id,firstUsage.id,'RELEASED');await finish(quotaUser.user.id,firstUsage.id,'RELEASED');assert.equal((await hold(quotaUser.user.id,firstUsage.businessKey)).state,'RELEASED');
      await assert.rejects(finish(b.user.id,firstUsage.id,'CONSUMED'),/不存在/);await assert.rejects(finish(quotaUser.user.id,firstUsage.id,'CONSUMED'),/不能重复/);
      await assert.rejects(db.$transaction(async tx=>{await benefits.hold(tx,quotaUser.user.id,definition.code,'rolled-back',1,{categoryCode:'TEST_ALLOWED'});throw Error('rollback');}),/rollback/);assert.equal(await db.benefitUsage.count({where:{userId:quotaUser.user.id,businessKey:'rolled-back'}}),0);
      const held=await hold(quotaUser.user.id,'service:next');await finish(quotaUser.user.id,held.id,'CONSUMED');await assert.rejects(hold(quotaUser.user.id,'service:overflow'),/不足/);await finish(quotaUser.user.id,held.id,'REVERSED');await finish(quotaUser.user.id,held.id,'REVERSED');
      const confirmed=await hold(quotaUser.user.id,'service:confirmed');await db.membership.update({where:{id:period.id},data:{endsAt:new Date(Date.now()-1)}});await finish(quotaUser.user.id,confirmed.id,'CONSUMED');await assert.rejects(hold(quotaUser.user.id,'after-expiry'),/不可用/);
    });
    await t.test('revoking a membership never revokes an independent compensation quota',async()=>{
      grant=await db.benefitGrant.create({data:{userId:grantUser.user.id,definitionId:definition.id,source:'ADMIN_COMPENSATION',quota:1,parametersSnapshot:{service:'fixture'},startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),grantKey:randomUUID(),actorId:root.user.id,reason:'测试独立来源'}});
      const member=await db.membership.create({data:{userId:grantUser.user.id,planId:plan.id,tier:2,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000),source:'ADMIN_COMPENSATION'}});await db.membership.update({where:{id:member.id},data:{revokedAt:new Date()}});
      const usage=await hold(grantUser.user.id,'compensated-service');assert.equal(usage.grantId,grant.id);assert.equal(usage.periodId,null);await assert.rejects(hold(grantUser.user.id,'second-service'),/不足/);
    });
  }finally{
    await db.benefitUsage.deleteMany({where:{userId:{in:users}}});await db.benefitGrant.deleteMany({where:{userId:{in:users}}});await db.membership.deleteMany({where:{userId:{in:users}}});
    await db.benefitScope.deleteMany({where:{planBenefitId:{in:(await db.planBenefit.findMany({where:{planVersionId:{in:versionIds}},select:{id:true}})).map(b=>b.id)}}});await db.planBenefit.deleteMany({where:{planVersionId:{in:versionIds}}});await db.membershipPlanVersion.deleteMany({where:{id:{in:versionIds}}});await db.benefitDefinition.deleteMany({where:{id:{in:definitionIds}}});
    await db.membershipPlan.update({where:{id:plan.id},data:{description:plan.description,currentVersionId:plan.currentVersionId,version:{increment:1}}});
    await app.close();await db.authSession.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
  }
});
test('quota calendar uses China dates and inclusive source-clipped windows',()=>{
  const start=new Date('2026-01-31T16:00:00Z'),end=new Date('2026-03-01T16:00:00Z'),now=new Date('2026-02-28T15:59:59Z');
  const day=benefitWindow(start,end,'DAY',now);assert.equal(day.windowStart.toISOString().slice(0,10),'2026-02-28');assert.equal(day.windowEnd.toISOString().slice(0,10),'2026-02-28');
  const month=benefitWindow(start,end,'MONTH',now);assert.equal(month.windowStart.toISOString().slice(0,10),'2026-02-01');assert.equal(month.windowEnd.toISOString().slice(0,10),'2026-02-28');
  const period=benefitWindow(start,end,'MEMBERSHIP',now);assert.equal(period.windowStart.toISOString().slice(0,10),'2026-02-01');assert.equal(period.windowEnd.toISOString().slice(0,10),'2026-03-01');
});
