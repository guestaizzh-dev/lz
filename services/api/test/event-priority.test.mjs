import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';

test('event priority is a frozen purchased benefit, not a tier or a second inventory',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService),tag='priority-'+randomUUID(),day=86400000,now=Date.now(),plan=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:1,days:365}}});
  async function account(role='USER'){const user=await db.user.create({data:{nickname:tag,roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind:role==='USER'?'APP':'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(now+day),csrfToken}});return {user,headers:role==='USER'?{authorization:'Bearer '+c.access}:{cookie:'daoxue_access='+c.access,'x-csrf-token':csrfToken}};}
  async function call(path,s,method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json',...s?.headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};}
  async function member(s,extra={}){return db.membership.create({data:{userId:s.user.id,planId:plan.id,tier:1,startsAt:new Date(now-1000),endsAt:new Date(now+day),source:'ADMIN_COMPENSATION',...extra}});}
  const register=(ticketId,s)=>call('/me/bookings/registrations',s,'POST',{ticketTypeId:ticketId,quantity:1,name:'共学学员',phone:'19900001002',contactConsent:true,requestKey:randomUUID()});
  try{
    const root=await account('ADMIN'),operator=await account('OPERATOR'),a=await account(),b=await account(),old=await account(),ordinary=await account(),future=await account(),expired=await account(),revoked=await account(),c=await account();
    await member(old);
    const events=[];for(let i=0;i<2;i++)events.push(await db.event.create({data:{title:tag+'-'+i,description:'隔离优先窗口验证',category:'公益共读',cover:'',location:'书院',startsAt:new Date(now+2*day),endsAt:new Date(now+3*day),capacity:2,price:0,status:'PUBLISHED',responsibleUserId:root.user.id}}));
    const [event,other]=events,dto={startsAt:new Date(now+2*day).toISOString(),endsAt:new Date(now+3*day).toISOString(),publicOpenAt:new Date(now+3600000).toISOString(),memberOpenAt:new Date(now-1000).toISOString(),cancelDeadline:new Date(now+day).toISOString(),location:'书院',capacity:2,ticketTitle:'公益席位',perUserLimit:1};
    let current=plan,session,ticket,firstRegistration,secondRegistration;
    await t.test('window order is validated and priority configuration creates an audited version only',async()=>{
      assert.equal((await call('/admin/events/'+event.id+'/sessions',root,'POST',{...dto,memberOpenAt:dto.publicOpenAt})).status,400);
      assert.equal((await call('/admin/membership-benefits/plans/'+plan.id+'/events',operator,'POST',{expectedVersion:plan.version,eventPriority:true,eventIds:[event.id],reason:'越权配置'})).status,403);
      const created=await call('/admin/events/'+event.id+'/sessions',root,'POST',dto);assert.equal(created.status,201);session=created.body;ticket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:session.id}});
      const response=await call('/admin/membership-benefits/plans/'+plan.id+'/events',root,'POST',{expectedVersion:plan.version,eventPriority:true,eventIds:[event.id],reason:'新售公益活动优先窗口'});assert.equal(response.status,201,JSON.stringify(response.body));current=response.body;
      assert.notEqual(current.currentVersionId,plan.currentVersionId);assert.equal((await db.membership.findFirstOrThrow({where:{userId:old.user.id}})).planVersionId,plan.currentVersionId);
      assert.equal((await call('/admin/membership-benefits/plans/'+plan.id+'/events',root,'POST',{expectedVersion:plan.version,eventPriority:false,eventIds:[],reason:'过期配置'})).status,409);
    });
    const ma=await member(a),mb=await member(b);await member(c);await member(future,{startsAt:new Date(now+60000)});await member(expired,{startsAt:new Date(now-day),endsAt:new Date(now-1)});await member(revoked,{revokedAt:new Date()});
    await t.test('catalog and mutation use the same frozen membership, validity and event scope',async()=>{
      for(const s of [undefined,old,ordinary,future,expired,revoked]){const r=await call('/bookings/events/'+event.id+'/sessions',s);assert.equal(r.status,200);assert.equal(r.body[0].tickets[0].bookingEnabled,false);assert.equal(r.body[0].priorityWindow,true);if(s)assert.equal((await register(ticket.id,s)).status,409);}
      const eligible=await call('/bookings/events/'+event.id+'/sessions',a);assert.equal(eligible.body[0].priorityEligible,true);assert.equal(eligible.body[0].tickets[0].bookingEnabled,true);
      assert.equal((await call('/admin/events/'+other.id+'/sessions',root,'POST',dto)).status,201);const otherSession=await db.eventSession.findFirstOrThrow({where:{eventId:other.id}}),otherTicket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:otherSession.id}});assert.equal((await register(otherTicket.id,a)).status,409);
      assert.equal((await call('/bookings/events/'+other.id+'/sessions',a)).body[0].priorityEligible,false);
    });
    await t.test('priority and public phases share capacity; repeated cancellation frees only one seat',async()=>{
      const joined=await Promise.all([register(ticket.id,a),register(ticket.id,b),register(ticket.id,c)]);assert.equal(joined.filter(r=>r.status===201).length,2);assert.equal(joined.filter(r=>r.status===409).length,1);
      const students=[a,b,c],winners=joined.flatMap((r,i)=>r.status===201?[{id:r.body.id,student:students[i]}]:[]);[firstRegistration,secondRegistration]=winners;
      const record=await db.eventRegistration.findUniqueOrThrow({where:{id:firstRegistration.id}});assert.ok(record.prioritySnapshot.periodId);assert.equal(record.benefitUsageId,null);assert.equal(record.prioritySnapshot.eventId,event.id);await assert.rejects(db.eventRegistration.update({where:{id:record.id},data:{prioritySnapshot:{}}}));
      await db.eventSession.update({where:{id:session.id},data:{memberOpenAt:new Date(now-60000),publicOpenAt:new Date(now-1000)}});
      assert.equal((await register(ticket.id,ordinary)).status,409);
      const cancellations=await Promise.all([call('/me/bookings/registrations/'+record.id+'/cancel',firstRegistration.student,'POST',{reason:'不便参加'}),call('/me/bookings/registrations/'+record.id+'/cancel',firstRegistration.student,'POST',{reason:'不便参加'})]);assert.ok(cancellations.every(r=>r.status===201));
      assert.equal((await register(ticket.id,ordinary)).status,201);assert.equal((await db.eventTicketType.findUniqueOrThrow({where:{id:ticket.id}})).confirmed,2);
    });
    await t.test('confirmed priority admissions survive membership expiry and new scheduling confirmation',async()=>{
      await db.membership.updateMany({where:{userId:secondRegistration.student.user.id},data:{revokedAt:new Date()}});
      const state=(await call('/me/bookings',secondRegistration.student)).body.items.find(r=>r.id===secondRegistration.id);assert.equal(state.state,'CONFIRMED');
      const currentSession=await db.eventSession.findUniqueOrThrow({where:{id:session.id}}),postponed=await call('/admin/events/sessions/'+session.id+'/reschedule',root,'POST',{expectedVersion:currentSession.version,startsAt:new Date(now+3*day).toISOString(),endsAt:new Date(now+4*day).toISOString(),location:'书院新厅',reason:'场地安排延期'});assert.equal(postponed.status,201);
      assert.equal((await call('/me/bookings/registrations/'+secondRegistration.id+'/accept-schedule',secondRegistration.student,'POST',{expectedScheduleVersion:postponed.body.scheduleVersion})).status,201);
      assert.equal((await db.eventRegistration.findUniqueOrThrow({where:{id:secondRegistration.id}})).prioritySnapshot.eventId,event.id);
    });
    await t.test('content and commerce edits preserve event scopes and promises; disabling never edits old sales',async()=>{
      const changed=await call('/admin/membership-benefits/plans/'+plan.id+'/content',root,'POST',{expectedVersion:current.version,contentTier:1,reason:'维护内容权益'});assert.equal(changed.status,201);current=changed.body;assert.match(current.description,/活动权益：/);
      const commerce=await call('/admin/membership-benefits/plans/'+plan.id+'/commerce',root,'POST',{expectedVersion:current.version,productBasisPoints:9500,shippingWaiver:false,minimumSubtotal:0,reason:'维护商城权益'});assert.equal(commerce.status,201);current=commerce.body;assert.match(current.description,/活动权益：/);
      const version=(await call('/admin/membership-benefits/plans/'+plan.id,root)).body.current,priority=version.benefits.find(b=>b.definition.code==='EVENT_PRIORITY');assert.deepEqual(priority.scopes.map(s=>s.resourceId),[event.id]);
      const disabled=await call('/admin/membership-benefits/plans/'+plan.id+'/events',root,'POST',{expectedVersion:current.version,eventPriority:false,eventIds:[],reason:'关闭后续新售优先权益'});assert.equal(disabled.status,201);assert.equal((await db.planBenefit.findFirstOrThrow({where:{planVersionId:ma.planVersionId,definitionId:priority.definitionId}})).parameters.enabled,true);
      assert.equal((await db.membership.findUniqueOrThrow({where:{id:mb.id}})).planVersionId,ma.planVersionId);
    });
    await t.test('an approved membership refund suspends only its purchased priority source',async()=>{
      const s=await account(),created=await call('/admin/events/'+event.id+'/sessions',root,'POST',{...dto,startsAt:new Date(now+3*day).toISOString(),endsAt:new Date(now+4*day).toISOString()});assert.equal(created.status,201,JSON.stringify(created.body));const newSession=created.body;
      const offer=await db.saleOffer.findFirstOrThrow({where:{kind:'MEMBERSHIP',membershipVersionId:ma.planVersionId}}).catch(()=>db.saleOffer.create({data:{kind:'MEMBERSHIP',membershipVersionId:ma.planVersionId,price:1000n,active:false,policySnapshot:{}}}));
      const order=await db.tradeOrder.create({data:{orderNo:randomUUID(),userId:s.user.id,kind:'MEMBERSHIP',requestKey:randomUUID(),requestHash:'isolated',currency:'CNY',subtotal:1000n,payableTotal:1000n,paidTotal:1000n,state:'PAID',pricingSnapshot:{},quoteHash:'fixture',expiresAt:new Date(now+day)}}),item=await db.tradeOrderItem.create({data:{orderId:order.id,lineNo:1,offerId:offer.id,quantity:1,unitPrice:1000n,subtotal:1000n,payable:1000n,itemSnapshot:{},benefitSnapshot:{},membershipVersionId:ma.planVersionId,state:'FULFILLED'}});
      const payment=await db.paymentTransaction.create({data:{orderId:order.id,channel:'WECHAT_APP',appScope:'test-priority',externalTransactionId:randomUUID(),amount:1000n,currency:'CNY',verifiedAt:new Date(),paidAt:new Date(),disposition:'ACCEPTED',receiptHash:'fixture'}});
      await member(s,{planVersionId:ma.planVersionId,source:'PURCHASE',orderItemId:item.id,grantKey:'membership.payment:'+payment.id});
      const available=async()=>((await call('/bookings/events/'+event.id+'/sessions',s)).body.find(r=>r.id===newSession.id)).tickets[0].bookingEnabled;
      assert.equal(await available(),true);
      const refund=await db.refund.create({data:{orderId:order.id,userId:s.user.id,requestKey:randomUUID(),kind:'REFUND_ONLY',state:'APPROVED',requestedAmount:1000n,approvedAmount:1000n,reasonCode:'TEST',description:'隔离退款冻结',paymentTransactionId:payment.id}});await db.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:1000n,revokeQuantity:1}});
      assert.equal(await available(),false);
      const definition=await db.benefitDefinition.findUniqueOrThrow({where:{code:'EVENT_PRIORITY'}});await db.benefitGrant.create({data:{userId:s.user.id,definitionId:definition.id,resourceId:event.id,source:'ADMIN_COMPENSATION',actorId:root.user.id,reason:'独立公益活动补偿授权',quota:1,parametersSnapshot:{enabled:true},startsAt:new Date(now-1000),endsAt:new Date(now+day),grantKey:randomUUID()}});assert.equal(await available(),true);
    });
  }finally{await app.close();await db.$disconnect();}
});
