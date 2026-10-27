import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {LearningService} from '../dist/learning.js';
if(process.env.NODE_ENV!=='test')throw Error('Membership fixtures require isolated test runner');
test('membership plan matrix preserves versioned terms and rejects silent concurrent overwrites',async t=>{
  const app=await createApp(false),db=new Database();await app.listen(0,'127.0.0.1');const base=await app.getUrl(),tag='qa-membership-'+randomUUID(),user=await db.user.create({data:{nickname:tag,roles:['ADMIN']}}),member=await db.user.create({data:{nickname:tag+'学员',roles:['USER']}}),credentials=app.get(AuthService).credentials(),csrf=randomUUID();
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';await db.authSession.create({data:{userId:user.id,kind:'ADMIN',accessHash:credentials.accessHash,refreshHash:credentials.refreshHash,accessExpiresAt:credentials.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});
  async function call(path,method='GET',body){const response=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Origin:process.env.CORS_ORIGINS,Cookie:'daoxue_access='+credentials.access,'X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};}
  const original=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:1,days:90}}});let current=original;
  const fields=p=>({title:p.title,tier:p.tier,days:p.days,price:p.price,description:p.description,active:p.active});
  try{
    await t.test('nine combinations expose exact day terms, declared base benefits and disabled purchase channels',async()=>{
      const response=await call('/learning/plans');assert.equal(response.status,200);assert.equal(response.body.length,9);
      const expected=[[1900,4900,16900],[4900,12900,44900],[9900,26900,89900]];
      for(const tier of [1,2,3])for(const [index,days] of [30,90,365].entries()){const p=response.body.find(p=>p.tier===tier&&p.days===days);assert.ok(p);assert.equal(p.price,expected[tier-1][index]);assert.equal(p.purchaseReady,false);assert.equal(p.channelProducts.ready,false);assert.match(p.purchaseUnavailableReason,/暂不收取费用/);assert.ok(p.currentVersionId);}
      const channel=await call('/admin/memberships/plans/'+original.id+'/channel-check');assert.equal(channel.status,200);assert.equal(channel.body.purchaseReady,false);assert.equal(channel.body.planVersionId,original.currentVersionId);assert.ok(channel.body.issues.some(issue=>issue.includes('非续期订阅')));
    });
    await t.test('diamond plan and level-four content are usable without changing older memberships',async()=>{
      const created=await call('/admin/memberships/plans','POST',{title:'钻石会员测试',tier:4,days:90,price:100,description:'隔离测试',active:true});
      assert.equal(created.status,201,JSON.stringify(created.body));
      const current=await db.membershipPlan.findUniqueOrThrow({where:{id:created.body.id}});
      assert.equal(await (await import('../dist/membership-benefits.js')).membershipContentTier(current.currentVersionId,db),4);
      assert.equal((await call('/admin/memberships/grant','POST',{userId:member.id,planId:current.id,reason:'隔离测试'})).status,201);
      const right=await app.get(LearningService).membership(member.id);assert.equal(right.tier,4);assert.equal(right.contentTier,4);
      await db.membership.deleteMany({where:{userId:member.id}});
    });
    await t.test('create-existing or stale plan edits cannot overwrite live plan configurations',async()=>{
      assert.equal((await call('/admin/memberships/plans','POST',{...fields(original),title:'不应静默覆盖'})).status,409);
      assert.equal((await call('/admin/memberships/plans','POST',{...fields(original),expectedVersion:original.version+1})).status,409);
      assert.equal((await call('/admin/memberships/plans','POST',{...fields(original),days:31})).status,400);
      assert.equal((await call('/admin/data/membership_plan/'+original.id,'PATCH',{data:{price:1},reason:'禁止绕过套餐版本'})).status,403);
    });
    await t.test('a single winner creates a fresh version; original membership terms and dates remain frozen',async()=>{
      const granted=await call('/admin/memberships/grant','POST',{userId:member.id,planId:original.id,reason:'测试独立补偿'});assert.equal(granted.status,201);
      const before=await app.get(LearningService).membership(member.id);assert.equal(before.plan.title,original.title);
      const edit={...fields(original),title:'研习季卡 · 新名称',price:5900,description:'仅影响新授权的版本说明',expectedVersion:original.version},results=await Promise.all([call('/admin/memberships/plans','POST',edit),call('/admin/memberships/plans','POST',edit)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);current=results.find(r=>r.status===201).body;
      assert.notEqual(current.currentVersionId,original.currentVersionId);assert.equal(current.version,original.version+1);
      const after=await app.get(LearningService).membership(member.id);assert.equal(after.planVersionId,before.planVersionId);assert.equal(after.plan.title,before.plan.title);assert.equal(after.plan.description,before.plan.description);assert.equal(after.plan.price,before.plan.price);assert.equal(after.endsAt.getTime(),before.endsAt.getTime());
      const adminRights=await call('/admin/entitlements?kind=membership&userId='+member.id);assert.equal(adminRights.status,200);assert.equal(adminRights.body.items[0].plan.price,original.price);assert.equal(adminRights.body.items[0].plan.title,original.title);
      const history=await db.membershipPlanVersion.findMany({where:{planId:original.id},orderBy:{releaseNo:'asc'}});assert.equal(history.at(-1).description,edit.description);assert.equal(history[0].description,original.description);
    });
    await t.test('stopping new plans preserves active previously granted memberships',async()=>{
      const response=await call('/admin/memberships/plans','POST',{...fields(current),active:false,expectedVersion:current.version});assert.equal(response.status,201);current=response.body;
      assert.equal((await call('/learning/plans')).body.some(p=>p.id===original.id),false);
      const right=await app.get(LearningService).membership(member.id);assert.equal(right.plan.price,original.price);assert.equal(right.revokedAt,null);
    });
  }finally{
    await db.membership.deleteMany({where:{userId:member.id}});
    const saved=await db.membershipPlan.findUniqueOrThrow({where:{id:original.id}});await db.membershipPlan.update({where:{id:original.id},data:{...fields(original),version:saved.version+1}});
    await app.close();await db.authSession.deleteMany({where:{userId:user.id}});await db.auditLog.deleteMany({where:{actorId:user.id}});await db.user.deleteMany({where:{id:{in:[user.id,member.id]}}});await db.$disconnect();
  }
});
