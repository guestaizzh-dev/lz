import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {PaymentChannels} from '../dist/payment-channels.js';
import {CourseSalesService} from '../dist/course-sales.js';
import {CurriculumAdminService} from '../dist/curriculum-admin.js';
import {MembershipBenefitsService} from '../dist/membership-benefits.js';
import {LearningService} from '../dist/learning.js';
import {MarketingService} from '../dist/marketing.js';
if(process.env.NODE_ENV!=='test')throw Error('Use the isolated database test runner');

test('M06 course pricing and early access preserve frozen terms and real payment boundaries',async t=>{
  const app=await createApp(false),db=new Database();app.useLogger(['error']);await app.listen(0,'127.0.0.1');
  const sales=app.get(CourseSalesService),admin=app.get(CurriculumAdminService),benefits=app.get(MembershipBenefitsService),learning=app.get(LearningService),auth=app.get(AuthService),channels=app.get(PaymentChannels),base=(await app.getUrl())+'/api/v1',facts=new Map(),tag='course-member-'+randomUUID();
  const identity={appid:'isolated-course-member',mchid:'1900000001'},adapter={identity:()=>identity,availability:()=>({enabled:true,reason:''}),prepay:async(no,title,total)=>{facts.set(no,{...identity,out_trade_no:no,trade_type:'APP',trade_state:'NOTPAY',amount:{total,currency:'CNY'}});return '{}';},query:async no=>facts.get(no)??{trade_state:'NOTFOUND'},close:async no=>{if(facts.has(no))facts.get(no).trade_state='CLOSED';}};
  mock.method(channels,'resolve',()=>adapter);mock.method(channels,'choices',()=>[{channel:'WECHAT_APP',enabled:true,provider:'wxpay',label:'微信',reason:''}]);
  async function session(role='USER'){
    const user=await db.user.create({data:{nickname:tag,roles:[role]}}),c=auth.credentials(),csrf=randomUUID();
    const row=await db.authSession.create({data:{userId:user.id,kind:role==='USER'?'APP':'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});
    return {user,req:{actor:user,authSessionId:row.id},headers:role==='USER'?{authorization:'Bearer '+c.access}:{cookie:'daoxue_access='+c.access,'x-csrf-token':csrf}};
  }
  async function call(path,s,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5173',...s?.headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};}
  const plan=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:2,days:90}}}),root=await session('ADMIN'),teacher=await db.teacher.create({data:{name:tag,title:'隔离讲师',bio:'仅供测试',expertise:[],status:'PUBLISHED'}}),bytes=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]),asset=await db.mediaAsset.create({data:{storageKey:randomUUID(),name:'isolated.mp4',mime:'video/mp4',bytes:bytes.length,uploaderId:root.user.id,status:'READY',visibility:'PRIVATE'}});
  await writeFile(join(process.env.MEDIA_DIR,asset.storageKey),bytes);
  async function course(overrides={}){
    const dto={title:tag,subtitle:'录播课程',description:'测试库内验证课程权益',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:333,teacherId:teacher.id,membershipTier:null,accessDays:null,refundPolicy:'7日内未开始学习可申请',tags:[],featured:false,memberDiscountEligible:true,chapters:[{title:'试听',format:'VIDEO',body:'',mediaId:asset.id,durationSeconds:120,trial:true,required:false},{title:'正文',format:'TEXT',body:'道法自然。',durationSeconds:0,trial:false,required:true},{title:'完整视频',format:'VIDEO',body:'',mediaId:asset.id,durationSeconds:120,trial:false,required:true}],...overrides};
    let row=await admin.save(root.req,dto);row=await admin.transition(root.req,row.id,{action:'submit',expectedVersion:row.version,reason:'隔离送审'});row=await admin.transition(root.req,row.id,{action:'publish',expectedVersion:row.version,reason:'隔离发布'});return {...row,dto,release:await db.courseRelease.findUniqueOrThrow({where:{id:row.publishedReleaseId},include:{lessons:{orderBy:{position:'asc'}}}})};
  }
  async function member(s,{rate=9000,early=false,content=false,scope=null,endsAt=new Date(Date.now()+86400000)}={}){
    const latest=await db.membershipPlanVersion.aggregate({where:{planId:plan.id},_max:{releaseNo:true}}),v=await db.membershipPlanVersion.create({data:{planId:plan.id,releaseNo:latest._max.releaseNo+1,tier:2,days:90,description:'隔离课程权益',termsSnapshot:{price:plan.price},publishedAt:new Date()}});
    for(const [code,parameters] of [...(rate<10000?[['COURSE_DISCOUNT',{basisPoints:rate}]]:[]),...(early?[['COURSE_EARLY_ACCESS',{enabled:true}]]:[]),...(content?[['CONTENT_ACCESS',{contentTier:2}]]:[])]){
      const definition=await db.benefitDefinition.findUniqueOrThrow({where:{code}}),b=await db.planBenefit.create({data:{planVersionId:v.id,definitionId:definition.id,parameters,quota:null,periodKind:'MEMBERSHIP'}});if(scope&&code!=='CONTENT_ACCESS')await db.benefitScope.create({data:{planBenefitId:b.id,resourceId:scope}});
    }
    return db.membership.create({data:{userId:s.user.id,planId:plan.id,planVersionId:v.id,tier:2,source:'ADMIN_COMPENSATION',startsAt:new Date(Date.now()-3600000),endsAt}});
  }
  async function order(c,s,key=randomUUID()){const q=await sales.quote(c.id,'ANDROID',s.user.id);return sales.checkout(s.user.id,{courseId:c.id,platform:'ANDROID',channel:'WECHAT_APP',requestKey:key,quoteHash:q.quoteHash});}
  async function paid(row,s,at=new Date()){await sales.prepay(row.id,s.user.id);const fact={...facts.get(row.orderNo),trade_state:'SUCCESS',transaction_id:'tx-'+randomUUID(),success_time:at.toISOString()};facts.set(row.orderNo,fact);return fact;}
  try{
    await t.test('discount eligibility is release-frozen; integer rounding, course scopes and iOS are correct',async()=>{
      const c=await course(),other=await course(),ineligible=await course({memberDiscountEligible:false}),s=await session();await member(s,{scope:c.id});
      const q=await sales.quote(c.id,'ANDROID',s.user.id);assert.equal(q.price,'300');assert.equal(q.discount,'33');assert.equal(q.memberBenefit.savings,'33');
      assert.equal((await sales.quote(other.id,'ANDROID',s.user.id)).price,'333');assert.equal((await sales.quote(ineligible.id,'ANDROID',s.user.id)).memberBenefit,null);assert.equal((await sales.quote(c.id,'IOS',s.user.id)).discount,'0');
      await db.course.update({where:{id:c.id},data:{memberDiscountEligible:false}});assert.equal((await sales.quote(c.id,'ANDROID',s.user.id)).price,'300');
      await assert.rejects(db.courseRelease.update({where:{id:c.release.id},data:{memberPolicySnapshot:{discountEligible:false}}}),/immutable/);
    });
    await t.test('coupons and membership choose the better amount without stacking',async()=>{
      const c=await course(),s=await session();await member(s);
      const marketing=app.get(MarketingService),override=mock.method(marketing,'coursePrice',async()=>({payable:313n,discount:20n,coupon:{id:randomUUID(),version:1,expiresAt:new Date(Date.now()+86400000).toISOString(),terms:{title:'隔离优惠券'}}}));
      const q=await sales.quote(c.id,'ANDROID',s.user.id);assert.equal(q.price,'300');assert.equal(q.coupon,null);assert.ok(q.memberBenefit);
      override.mock.mockImplementation(async()=>({payable:283n,discount:50n,coupon:{id:randomUUID(),version:1,expiresAt:new Date(Date.now()+86400000).toISOString(),terms:{title:'隔离优惠券'}}}));
      const better=await sales.quote(c.id,'ANDROID',s.user.id);assert.equal(better.price,'283');assert.equal(better.memberBenefit,null);assert.ok(better.coupon);override.mock.restore();
    });
    await t.test('stale expired quotes create no order; concurrent checkout holds once and cancel releases',async()=>{
      const c=await course(),s=await session(),m=await member(s),q=await sales.quote(c.id,'ANDROID',s.user.id);
      await db.membership.update({where:{id:m.id},data:{endsAt:new Date(Date.now()-1)}});await assert.rejects(sales.checkout(s.user.id,{courseId:c.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.quoteHash}),/更新/);assert.equal(await db.tradeOrder.count({where:{userId:s.user.id}}),0);
      await db.membership.update({where:{id:m.id},data:{endsAt:new Date(Date.now()+86400000)}});const key=randomUUID(),rows=await Promise.all([order(c,s,key),order(c,s,key)]);assert.equal(rows[0].id,rows[1].id);assert.equal(await db.benefitUsage.count({where:{businessKey:'course.price:'+rows[0].id,state:'HELD'}}),1);
      await sales.cancel(rows[0].id,s.user.id);assert.equal((await db.benefitUsage.findFirstOrThrow({where:{businessKey:'course.price:'+rows[0].id}})).state,'RELEASED');
    });
    await t.test('verified payment consumes once, journals balance, refund returns exact paid amount and usage',async()=>{
      const c=await course(),s=await session();await member(s);const row=await order(c,s),fact=await paid(row,s);
      const confirmations=await Promise.all([sales.confirmPayment(fact),sales.confirmPayment(fact)]);assert.ok(confirmations.every(x=>x.disposition==='ACCEPTED'));assert.equal(await db.enrollment.count({where:{userId:s.user.id,courseId:c.id}}),1);
      const usage=await db.benefitUsage.findFirstOrThrow({where:{businessKey:'course.price:'+row.id}});assert.equal(usage.state,'CONSUMED');
      const journals=await db.financeJournal.findMany({where:{orderId:row.id}}),entries=await db.financeEntry.findMany({where:{journalId:{in:journals.map(j=>j.id)}}});assert.equal(entries.reduce((sum,e)=>sum+e.debit-e.credit,0n),0n);
      await sales.requestRefund(row.id,s.user.id,{requestKey:randomUUID(),reason:'隔离未研习退课'});let refund=await db.refund.findFirstOrThrow({where:{orderId:row.id}});assert.equal(refund.requestedAmount,300n);
      await sales.reviewRefund(refund.id,root.req,{expectedVersion:refund.version,action:'APPROVE',reason:'隔离审核退款'});refund=await db.refund.findUniqueOrThrow({where:{id:refund.id}});
      const result={mchid:identity.mchid,out_trade_no:row.orderNo,transaction_id:fact.transaction_id,out_refund_no:refund.channelRequestKey,refund_id:'rf-'+randomUUID(),status:'SUCCESS',success_time:new Date().toISOString(),amount:{refund:300,total:300,currency:'CNY'}};
      await sales.confirmRefund(result);await sales.confirmRefund(result);assert.equal((await sales.detail(row.id,s.user.id)).refundedAmount,'300');assert.equal((await db.benefitUsage.findUniqueOrThrow({where:{id:usage.id}})).state,'REVERSED');
    });
    await t.test('revoked discounts prevent payment and timely unexpected money is compensated without enrollment',async()=>{
      const c=await course(),s=await session(),m=await member(s),row=await order(c,s),fact=await paid(row,s);
      await db.membership.update({where:{id:m.id},data:{revokedAt:new Date(Date.now()-1)}});
      assert.equal((await sales.detail(row.id,s.user.id)).canPay,false);await assert.rejects(sales.prepay(row.id,s.user.id),/会员优惠/);
      assert.equal((await sales.confirmPayment({...fact,success_time:new Date().toISOString()})).disposition,'REFUND_REQUIRED');assert.equal(await db.enrollment.count({where:{userId:s.user.id,courseId:c.id}}),0);assert.equal((await db.refund.findFirstOrThrow({where:{orderId:row.id}})).requestedAmount,300n);assert.equal((await db.benefitUsage.findFirstOrThrow({where:{businessKey:'course.price:'+row.id}})).state,'RELEASED');
    });
    await t.test('delayed notification honors payment-time eligibility, while late payment releases the discount',async()=>{
      const c=await course(),s=await session(),m=await member(s),row=await order(c,s),fact=await paid(row,s),paymentTime=new Date(fact.success_time);
      await db.membership.update({where:{id:m.id},data:{endsAt:new Date(paymentTime.getTime()+1)}});
      assert.equal((await sales.confirmPayment(fact)).disposition,'ACCEPTED');assert.equal((await db.benefitUsage.findFirstOrThrow({where:{businessKey:'course.price:'+row.id}})).state,'CONSUMED');
      const lateUser=await session();await member(lateUser);const lateOrder=await order(c,lateUser),lateFact=await paid(lateOrder,lateUser);await db.tradeOrder.update({where:{id:lateOrder.id},data:{expiresAt:new Date(Date.parse(lateFact.success_time)-1)}});
      assert.equal((await sales.confirmPayment(lateFact)).disposition,'LATE');assert.equal((await db.benefitUsage.findFirstOrThrow({where:{businessKey:'course.price:'+lateOrder.id}})).state,'RELEASED');assert.equal(await db.enrollment.count({where:{userId:lateUser.user.id,courseId:c.id}}),0);
    });
    await t.test('early access needs both frozen early and content rights; direct text/media/progress are protected',async()=>{
      const c=await course({membershipTier:2,earlyAccessAt:new Date(Date.now()-60000).toISOString(),publicOpenAt:new Date(Date.now()+3600000).toISOString()}),none=await session(),contentOnly=await session(),earlyOnly=await session(),both=await session();
      await member(contentOnly,{content:true,rate:10000});await member(earlyOnly,{early:true,rate:10000});await member(both,{early:true,content:true,rate:10000,scope:c.id});
      for(const s of [none,contentOnly,earlyOnly]){
        const curriculum=await learning.curriculum(c.id,s.user.id);assert.equal(curriculum.access,'TRIAL');assert.equal(curriculum.lessons[0].accessible,true);assert.equal(curriculum.lessons[1].accessible,false);
        for(const [path,method,body] of [['/learning/lessons/'+c.release.lessons[1].id,'GET'],['/learning/lessons/'+c.release.lessons[2].id+'/media','POST',{}],['/learning/lessons/'+c.release.lessons[1].id+'/progress','POST',{eventId:randomUUID(),positionSeconds:0,elapsedSeconds:0,completed:true}]])assert.equal((await call(path,s,method,body)).status,403);
      }
      const curriculum=await learning.curriculum(c.id,both.user.id);assert.equal(curriculum.access,'MEMBER');assert.equal(curriculum.lessons[1].accessible,true);assert.equal((await call('/learning/lessons/'+c.release.lessons[1].id,both)).status,200);
      assert.equal((await sales.quote(c.id,'ANDROID',none.user.id)).paymentEnabled,false);await assert.rejects(order(c,none),/公开售卖/);
      const blocked=await learning.library(contentOnly.user.id);assert.equal(blocked.items.find(i=>i.course.id===c.id).learningLocked,true);assert.equal(blocked.items.find(i=>i.course.id===c.id).lessons[1].accessible,false);
      const open=await learning.library(both.user.id);assert.equal(open.items.find(i=>i.course.id===c.id).lessons[1].accessible,true);
      const m=await db.membership.findFirstOrThrow({where:{userId:both.user.id}});await db.membership.update({where:{id:m.id},data:{revokedAt:new Date()}});assert.equal((await learning.curriculum(c.id,both.user.id)).access,'TRIAL');
    });
    await t.test('before early date everyone is locked, public date unlocks regular membership without early rights',async()=>{
      const s=await session();await member(s,{content:true,early:true,rate:10000});
      const future=await course({membershipTier:2,price:0,earlyAccessAt:new Date(Date.now()+3600000).toISOString(),publicOpenAt:new Date(Date.now()+7200000).toISOString()});assert.equal((await learning.curriculum(future.id,s.user.id)).access,'TRIAL');await assert.rejects(learning.enroll(future.id,s.user.id),/提前期/);
      const publicCourse=await course({membershipTier:2,earlyAccessAt:new Date(Date.now()-7200000).toISOString(),publicOpenAt:new Date(Date.now()-3600000).toISOString()}),regular=await session();await member(regular,{content:true,rate:10000});assert.equal((await learning.curriculum(publicCourse.id,regular.user.id)).access,'MEMBER');
    });
    await t.test('new plan publication preserves old grants and unrelated scoped benefits, enforces permissions and versions',async()=>{
      const c=await course(),old=await session(),latest=await db.membershipPlanVersion.aggregate({where:{planId:plan.id},_max:{releaseNo:true}}),v=await db.membershipPlanVersion.create({data:{planId:plan.id,releaseNo:latest._max.releaseNo+1,tier:2,days:90,description:'旧版限定商品范围',termsSnapshot:{price:plan.price},publishedAt:new Date()}}),definition=await db.benefitDefinition.findUniqueOrThrow({where:{code:'PRODUCT_DISCOUNT'}}),original=await db.planBenefit.create({data:{planVersionId:v.id,definitionId:definition.id,parameters:{basisPoints:9000},quota:null,periodKind:'MEMBERSHIP'}});
      await db.benefitScope.create({data:{planBenefitId:original.id,resourceId:c.id}});
      const prior=await db.membershipPlan.update({where:{id:plan.id},data:{currentVersionId:v.id,version:{increment:1}}});
      await db.membership.create({data:{userId:old.user.id,planId:plan.id,tier:2,source:'ADMIN_COMPENSATION',startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000)}});
      const dto={expectedVersion:prior.version,courseBasisPoints:8500,earlyAccess:true,courseIds:[c.id],reason:'隔离发布课程权益'},path='/admin/membership-benefits/plans/'+plan.id+'/courses';
      assert.equal((await call(path,await session('OPERATOR'),'POST',dto)).status,403);assert.equal((await call(path,root,'POST',{...dto,courseBasisPoints:0})).status,400);
      const result=await call(path,root,'POST',dto);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal((await call(path,root,'POST',dto)).status,409);
      assert.equal((await sales.quote(c.id,'ANDROID',old.user.id)).discount,'0');const fresh=await session();await db.membership.create({data:{userId:fresh.user.id,planId:plan.id,tier:2,source:'ADMIN_COMPENSATION',startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000)}});assert.equal((await sales.quote(c.id,'ANDROID',fresh.user.id)).price,'284');
      const copied=await db.planBenefit.findFirstOrThrow({where:{planVersionId:result.body.currentVersionId,definitionId:definition.id}});assert.equal(await db.benefitScope.count({where:{planBenefitId:copied.id,resourceId:c.id}}),1);
    });
    await t.test('invalid windows and nonrecorded discounts are rejected before persistence',async()=>{
      const baseCourse=await course();for(const overrides of [{earlyAccessAt:new Date().toISOString(),publicOpenAt:null},{earlyAccessAt:new Date(Date.now()+3600000).toISOString(),publicOpenAt:new Date().toISOString(),membershipTier:2},{format:'LIVE',memberDiscountEligible:true}])await assert.rejects(admin.save(root.req,{...baseCourse.dto,...overrides}),/提前研习|会员购课折扣/);
    });
  }finally{mock.restoreAll();await db.membershipPlan.update({where:{id:plan.id},data:{description:plan.description,currentVersionId:plan.currentVersionId,version:{increment:1}}});await app.close();await db.$disconnect();}
});
