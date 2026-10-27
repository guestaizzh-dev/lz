import {consumptionPolicy} from './consumption-policy.js';
import {holdMemberGift,memberGiftReady,activateMemberGift,releaseOrderGifts,versionGiftPool} from './member-gift-stock.js';
import {Charity,publicCharityPrice,type CharityPrice} from './charity.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { PaymentChannels, type AppPaymentChannel } from './payment-channels.js';
import { membershipContentTier,membershipRefundHolds } from './membership-benefits.js';
import { Prisma, type TradeOrder, type PaymentTransaction, type Refund } from './generated/prisma/client.js';
import type { WechatRefund, WechatTransaction } from './wechat-pay.js';
import { ModuleRef } from '@nestjs/core';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const day=86400000;
const refundPolicy='付款确认后7日内，整段会员尚未生效且未占用或消费权益，可申请原路全额退款；已生效会员请联系书院核查。审核通过后暂停本段权益，渠道待确认或退款失败重试期间继续暂停，渠道成功后才撤销。取消未来会员不提前其他已确认套餐。此套餐不自动续费。';
class QuoteQuery { @IsIn(['ANDROID','IOS','WEB']) platform='WEB'; }
class CheckoutDto extends QuoteQuery { @IsUUID() planId!:string; @IsUUID() requestKey!:string; @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash!:string; @IsIn(['WECHAT_APP','ALIPAY_APP','SIMULATED']) channel!:AppPaymentChannel; }
class PageQuery { @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1; @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20; @IsOptional() @IsIn(['PENDING','COMPLETED','CLOSED']) state?:string; @IsOptional() @IsString() @Length(0,80) q?:string; }
class RefundDto { @IsUUID() requestKey!:string; @IsString() @Length(2,1000) @Matches(/\S/) reason!:string; }
class ReviewDto { @IsInt() @Min(1) expectedVersion!:number; @IsIn(['APPROVE','REJECT','RETRY','CANCEL']) action!:string; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; @IsOptional() @IsString() @Matches(/^[1-9][0-9]{0,17}$/) approvedAmount?:string; }
class RefundDecisionDto { @IsInt() @Min(1) expectedVersion!:number; @IsIn(['ACCEPT','DECLINE']) action!:string; }
type Schedule={fingerprint:string;anchor:string|null;mode:string};
export type MembershipSnapshot={planId:string;planVersionId:string;title:string;tier:number;contentTier:number;days:number;description:string;refundPolicy:string;schedule:Schedule};
type Snapshot=MembershipSnapshot;

@Injectable()
export class MembershipSalesService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  constructor(private readonly db:Database,private readonly channels:PaymentChannels,private readonly moduleRef:ModuleRef,private readonly charity:Charity){}
  async onModuleInit(){
    if(process.env.MEMBERSHIP_SALES_ENABLED==='true'){
      const enabled=this.channels.choices().filter(c=>c.enabled);
      if(!enabled.length)throw new Error('Membership sales require a configured verified payment channel');
      const codes=['MEMBERSHIP_REVENUE','MEMBERSHIP_REFUND_PAYABLE',...enabled.map(c=>c.channel==='ALIPAY_APP'?'ALIPAY_RECEIVABLE':'WECHAT_RECEIVABLE')];
      if(await this.db.financeAccount.count({where:{code:{in:codes}}})!==codes.length)throw new Error('Membership posting accounts are missing');
      if(process.env.NODE_ENV==='production'&&process.env.MEMBERSHIP_PAYMENT_WORKER_ENABLED==='false')throw new Error('Membership payments require the recovery worker');
    }
    if(process.env.NODE_ENV!=='test'&&process.env.MEMBERSHIP_PAYMENT_WORKER_ENABLED!=='false'){this.timer=setInterval(()=>void this.runJobs().catch(()=>{}),20000);this.timer.unref();}
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private enabled(platform:string){return platform==='ANDROID'&&process.env.MEMBERSHIP_SALES_ENABLED==='true';}
  private async lock(tx:Prisma.TransactionClient,order:Pick<TradeOrder,'id'|'userId'>){await tx.$queryRaw`SELECT id FROM "User" WHERE id=${order.userId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${order.id} FOR UPDATE`;}
  private async schedule(userId:string|undefined,tier:number,store:Prisma.TransactionClient|Database,reference=new Date()):Promise<Schedule>{
    const rows=userId?await store.membership.findMany({where:{userId,revokedAt:null,endsAt:{gt:reference}},orderBy:[{startsAt:'asc'},{id:'asc'}],take:101}):[];
    if(rows.length>100)throw new ConflictException('待生效会员较多，请联系书院核查后继续购买');
    const last=rows.at(-1);return{fingerprint:hash(rows.map(m=>({id:m.id,version:m.version,startsAt:m.startsAt,endsAt:m.endsAt,tier:m.tier}))),anchor:last?.endsAt.toISOString()??null,mode:last?last.tier===tier?'RENEW':'QUEUED':'ACTIVATE'};
  }
  private async sale(planId:string,store:Prisma.TransactionClient|Database=this.db){
    const plan=await store.membershipPlan.findFirst({where:{id:planId,active:true,tier:{gte:1}}});if(!plan?.currentVersionId)throw new NotFoundException('套餐已停售或尚未发布');
    const version=await store.membershipPlanVersion.findUniqueOrThrow({where:{id:plan.currentVersionId}});
    const contentTier=await membershipContentTier(version.id,store);
    if(!version.publishedAt||contentTier===0||plan.price<=0)throw new ConflictException('会员权益或价格尚未准备完成，暂不收费');
    const benefits=await store.planBenefit.findMany({where:{planVersionId:version.id},orderBy:{id:'asc'}});
    const giftPoolId=await versionGiftPool(store,version.id),giftPool=giftPoolId?await store.memberGiftPool.findUnique({where:{id:giftPoolId}}):null;
    if(giftPoolId&&(!giftPool||giftPool.state!=='OPEN'||giftPool.capacity-giftPool.allocated-giftPool.released<1))throw new ConflictException('此版本的实际签名商品份额已售罄或停止新售，请选择其他套餐或等待补货');
    return{plan,version,contentTier,benefits:benefits.map(b=>({definitionId:b.definitionId,parameters:b.parameters,quota:b.quota,periodKind:b.periodKind}))};
  }
  async appleTerms(planId:string,userId:string,store:Prisma.TransactionClient|Database){
    const sale=await this.sale(planId,store),schedule=await this.schedule(userId,sale.plan.tier,store);
    const snapshot:Snapshot={planId,planVersionId:sale.version.id,title:sale.plan.title,tier:sale.version.tier,contentTier:sale.contentTier,days:sale.version.days,description:sale.version.description,refundPolicy:'由Apple审核退款，请前往Apple报告问题页面申请。本套餐按固定天数手动购买，不自动续费；购买按已确认的会员排队期限生效，退款不提前其他已确认套餐。',schedule};
    return{consumptionRule:consumptionPolicy,snapshot,price:BigInt(sale.plan.price),benefits:sale.benefits};
  }
  async appleQueueMatches(userId:string,snapshot:Snapshot,createdAt:Date,store:Prisma.TransactionClient){return (await this.schedule(userId,snapshot.tier,store,createdAt)).fingerprint===snapshot.schedule.fingerprint;}
  async quote(planId:string,platform:string,userId?:string){
    const sale=await this.sale(planId),schedule=await this.schedule(userId,sale.plan.tier,this.db),channels=this.channels.choices(),pending=userId?await this.db.tradeOrder.findFirst({where:{userId,kind:'MEMBERSHIP',state:'PENDING'},orderBy:{createdAt:'desc'}}):null;
    const snapshot:Snapshot={planId,planVersionId:sale.version.id,title:sale.plan.title,tier:sale.version.tier,contentTier:sale.contentTier,days:sale.version.days,description:sale.version.description,refundPolicy:refundPolicy,schedule};
    const charitable=await this.charity.price(this.db,userId,'MEMBERSHIP',sale.version.id,BigInt(sale.plan.price),platform),price=charitable?BigInt(charitable.price):BigInt(sale.plan.price),paymentEnabled=this.enabled(platform)&&channels.some(c=>c.enabled)&&price>0n,startsAt=schedule.anchor&&Date.parse(schedule.anchor)>Date.now()?schedule.anchor:null;
    return{...snapshot,charity:publicCharityPrice(charitable),originalPrice:String(sale.plan.price),discount:String(BigInt(sale.plan.price)-price),price:String(price),currency:'CNY',quoteHash:hash({consumptionRule:consumptionPolicy,snapshot,price:sale.plan.price,benefits:sale.benefits,...(charitable?{charity:charitable}:{})}),startsAt,endsAt:startsAt?new Date(Date.parse(startsAt)+sale.version.days*day).toISOString():null,immediate:!startsAt,pendingOrderId:pending?.id??null,paymentEnabled,channels:channels.map(c=>({...c,enabled:c.enabled&&paymentEnabled})),unavailableReason:charitable&&price===0n?'公益资格可免费领取，请前往公益研习确认，无需付款。':paymentEnabled?'':platform==='IOS'?'iOS会员非续期订阅尚未验收，暂不收取费用。':'会员正式支付尚未开放，暂不收取费用。'};
  }
  async checkout(userId:string,dto:CheckoutDto){
    if(!this.enabled(dto.platform))throw new ServiceUnavailableException('此平台的会员支付尚未开放');this.channels.resolve(dto.channel).identity();
    const requestHash=hash({planId:dto.planId,platform:dto.platform,channel:dto.channel,quoteHash:dto.quoteHash});
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ForbiddenException('账号不可用，请重新登录');
      const old=await tx.tradeOrder.findFirst({where:{userId,requestKey:dto.requestKey}});if(old){if(old.kind!=='MEMBERSHIP'||old.requestHash!==requestHash)throw new ConflictException('请求标识已用于其他订单');return old;}
      await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${dto.planId} FOR SHARE`;
      const sale=await this.sale(dto.planId,tx),schedule=await this.schedule(userId,sale.plan.tier,tx);
      // Recompute the complete quote in the locked transaction; no client amount or date is trusted.
      const snapshot:Snapshot={planId:dto.planId,planVersionId:sale.version.id,title:sale.plan.title,tier:sale.version.tier,contentTier:sale.contentTier,days:sale.version.days,description:sale.version.description,refundPolicy,schedule};
      const charitable=await this.charity.price(tx,userId,'MEMBERSHIP',sale.version.id,BigInt(sale.plan.price),dto.platform),price=charitable?BigInt(charitable.price):BigInt(sale.plan.price);if(price===0n)throw new BadRequestException('公益免费资格请前往公益研习确认领取，无需付款');
      if(hash({consumptionRule:consumptionPolicy,snapshot,price:sale.plan.price,benefits:sale.benefits,...(charitable?{charity:charitable}:{})})!==dto.quoteHash)throw new ConflictException('套餐或排队期限已变化，请重新确认购买说明');
      const pending=await tx.tradeOrder.findFirst({where:{userId,kind:'MEMBERSHIP',state:'PENDING'}});if(pending){if(pending.quoteHash!==dto.quoteHash||(pending.pricingSnapshot as {channel:string}).channel!==dto.channel)throw new ConflictException('请先处理已有会员待支付订单');return pending;}
      const offer=await tx.saleOffer.upsert({where:{id:'membership-offer-'+sale.version.id},create:{id:'membership-offer-'+sale.version.id,kind:'MEMBERSHIP',membershipVersionId:sale.version.id,currency:'CNY',price:BigInt(sale.plan.price),active:true,quantityLimit:1,policySnapshot:{refundPolicy:snapshot.refundPolicy}},update:{}});
      const order=await tx.tradeOrder.create({data:{orderNo:'M'+randomUUID().replaceAll('-','').slice(0,31),userId,kind:'MEMBERSHIP',requestKey:dto.requestKey,requestHash,currency:'CNY',subtotal:BigInt(sale.plan.price),discountTotal:BigInt(sale.plan.price)-price,payableTotal:price,pricingSnapshot:{platform:dto.platform,channel:dto.channel,charity:charitable},quoteHash:dto.quoteHash,expiresAt:new Date(Math.min(Date.now()+15*60000,charitable?Date.parse(charitable.endsAt):Infinity))}});
      const item=await tx.tradeOrderItem.create({data:{orderId:order.id,lineNo:1,offerId:offer.id,quantity:1,unitPrice:order.subtotal,subtotal:order.subtotal,discountAllocated:order.discountTotal,payable:order.payableTotal,itemSnapshot:snapshot,benefitSnapshot:{benefits:sale.benefits},state:'PENDING',membershipVersionId:sale.version.id}});
      await holdMemberGift(tx,userId,sale.version.id,item.id,order.expiresAt);await this.charity.freeze(tx,userId,item.id,charitable);
      await tx.outboxJob.create({data:{eventKey:'membership.expire:'+order.id,kind:'MEMBERSHIP_PAYMENT_CHECK',aggregateType:'MEMBERSHIP_ORDER',aggregateId:order.id,payload:{},availableAt:order.expiresAt}});
      await tx.auditLog.create({data:{actorId:userId,action:'membership.order.create',resource:'trade_order',resourceId:order.id,changes:{planVersionId:sale.version.id,amount:String(order.payableTotal),schedule}}});return order;
    });return this.detail(result.id,userId);
  }
  private async owned(id:string,userId:string){const row=await this.db.tradeOrder.findFirst({where:{id,userId,kind:'MEMBERSHIP'}});if(!row)throw new NotFoundException('会员订单不存在');return row;}
  private async refundable(store:Prisma.TransactionClient|Database,order:TradeOrder){
    const member=await store.membership.findFirst({where:{orderItemId:{in:(await store.tradeOrderItem.findMany({where:{orderId:order.id},select:{id:true}})).map(i=>i.id)}}});
    const payment=await store.paymentTransaction.findFirst({where:{orderId:order.id,disposition:'ACCEPTED'}});
    const pending=payment?await store.refund.findFirst({where:{orderId:order.id,paymentTransactionId:payment.id,state:{notIn:['REJECTED','CANCELLED']}}}):null;
    const used=member?await store.benefitUsage.count({where:{periodId:member.id,state:{in:['HELD','CONSUMED']}}}):0;
    const eligible=!!payment&&payment.channel!=='APPLE_IAP'&&order.refundedTotal===0n&&!pending&&!!member&&!member.revokedAt&&member.endsAt>new Date();
    return{member,payment,allowed:eligible&&member!.startsAt>new Date()&&Date.now()-payment!.paidAt.getTime()<=7*day&&used===0,manual:eligible};
  }
  private async refundAssessment(store:Prisma.TransactionClient|Database,memberId:string,amount:bigint){
    const member=await store.membership.findUniqueOrThrow({where:{id:memberId}}),now=new Date();
    const usage=await store.benefitUsage.findMany({where:{periodId:memberId,state:{in:['HELD','CONSUMED']}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{definitionId:true,quantity:true,state:true,windowStart:true,windowEnd:true}});
    const definitions=await store.benefitDefinition.findMany({where:{id:{in:usage.map(u=>u.definitionId)}},select:{id:true,name:true}});
    const duration=member.endsAt.getTime()-member.startsAt.getTime(),remaining=Math.max(0,Math.min(duration,member.endsAt.getTime()-now.getTime()));
    return{assessedAt:now.toISOString(),memberId,startsAt:member.startsAt.toISOString(),endsAt:member.endsAt.toISOString(),paidAmount:String(amount),suggestedAmount:String(duration>0?amount*BigInt(remaining)/BigInt(duration):0n),usage:usage.map(u=>({...u,name:definitions.find(d=>d.id===u.definitionId)?.name??'历史权益',windowStart:u.windowStart.toISOString(),windowEnd:u.windowEnd.toISOString()})),explanation:'按未使用时长计算的金额仅供核查；财务须说明已消费权益及扣除依据，学员确认具体方案后才退款。'};
  }
  async detail(id:string,userId:string){
    const order=await this.owned(id,userId),item=await this.db.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}}),status=await this.refundable(this.db,order),snapshot=item.itemSnapshot as unknown as Snapshot;
    const channel=(order.pricingSnapshot as {channel:string}).channel,checked=!attempt||!!attempt.lastQueriedAt&&attempt.lastQueriedAt>=attempt.updatedAt&&!attempt.failureCode;
    const plan=await this.db.membershipPlan.findUnique({where:{id:snapshot.planId}}),schedule=await this.schedule(userId,snapshot.tier,this.db,order.createdAt);
    const canPay=await this.charity.ready(this.db,order.id)&&channel!=='APPLE_IAP'&&order.state==='PENDING'&&order.expiresAt>new Date()&&checked&&!!plan?.active&&schedule.fingerprint===snapshot.schedule.fingerprint&&this.enabled('ANDROID')&&this.channels.resolve(channel).availability().enabled;
    const member=status.member,suspended=member&&(await membershipRefundHolds(userId,this.db)).includes(member.id);
    return safe({charity:publicCharityPrice((order.pricingSnapshot as {charity?:CharityPrice}).charity),originalPrice:order.subtotal,discount:order.discountTotal,id,orderNo:order.orderNo,state:order.state,version:order.version,amount:order.payableTotal,paidAmount:order.paidTotal,refundedAmount:order.refundedTotal,currency:order.currency,createdAt:order.createdAt,expiresAt:order.expiresAt,paidAt:order.paidAt,closeReason:order.closeReason,plan:snapshot,channel,canPay,canCancel:order.state==='PENDING'&&(channel!=='APPLE_IAP'||order.expiresAt<=new Date()),paymentStatus:order.state!=='PENDING'?order.state:channel==='APPLE_IAP'?'APPLE_RESTORE_REQUIRED':order.expiresAt<=new Date()?'EXPIRED':!checked?'CHECK_REQUIRED':canPay?'READY':'UNAVAILABLE',membership:member?{id:member.id,startsAt:member.startsAt,endsAt:member.endsAt,state:member.revokedAt?'REVOKED':suspended?'REFUND_PENDING':member.startsAt>new Date()?'QUEUED':member.endsAt<=new Date()?'EXPIRED':'ACTIVE'}:null,canRefund:status.allowed,canRequestReview:status.manual,refundAssessment:status.manual&&member?await this.refundAssessment(this.db,member.id,status.payment!.amount):null,refundUrl:channel==='APPLE_IAP'?'https://reportaproblem.apple.com/':null,refundUnavailableReason:channel==='APPLE_IAP'?'请向Apple申请退款；书院只处理Apple已验证的退款和撤销结果。':status.allowed?'':'默认仅退付款后7日内尚未生效且未消费或占用权益的整段会员；其他情况请联系书院核查。',refunds:await this.db.refund.findMany({where:{orderId:id},orderBy:{createdAt:'desc'},select:{id:true,state:true,version:true,requestedAmount:true,reasonCode:true,description:true,reviewNote:true,createdAt:true,failureCode:true,approvedAmount:true,assessmentSnapshot:true,acceptedAt:true}})});
  }
  async list(userId:string,q:PageQuery){const where={userId,kind:'MEMBERSHIP',...(q.state?{state:q.state}:{})};const [rows,total]=await this.db.$transaction([this.db.tradeOrder.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.size,take:q.size}),this.db.tradeOrder.count({where})]);return{items:await Promise.all(rows.map(o=>this.detail(o.id,userId))),total};}
  async prepay(id:string,userId:string){
    const order=await this.owned(id,userId),channel=(order.pricingSnapshot as {channel:AppPaymentChannel}).channel;if(String(channel)==='APPLE_IAP')throw new BadRequestException('Apple会员请在App Store完成原购买或恢复，不能切换支付渠道');this.channels.resolve(channel).identity();
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),snapshot=item.itemSnapshot as unknown as Snapshot;
      await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${snapshot.planId} FOR SHARE`;
      const plan=await tx.membershipPlan.findUnique({where:{id:snapshot.planId}});
      if(!await this.charity.ready(tx,id)||!this.enabled('ANDROID')||!plan?.active||current.state!=='PENDING'||current.expiresAt<=new Date())throw new ConflictException('会员套餐或订单已不可支付，请刷新');
      if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ForbiddenException('账号不可用');
      if((await this.schedule(userId,snapshot.tier,tx,order.createdAt)).fingerprint!==snapshot.schedule.fingerprint)throw new ConflictException('会员排队期限已变化，请取消并重新确认');
      const old=await tx.paymentAttempt.findFirst({where:{orderId:id}});
      if(old?.channel&&old.channel!==channel)throw new ConflictException('支付渠道不一致，请联系书院');
      if(old?.state==='CREATED'&&Date.now()-old.updatedAt.getTime()<30000)throw new ConflictException('正在发起支付，请稍后查询');
      if(old&&(!old.lastQueriedAt||old.lastQueriedAt<old.updatedAt||old.failureCode))throw new ConflictException('请先查询上次支付结果，勿重复付款');
      if(old)await tx.paymentAttempt.update({where:{id:old.id},data:{state:'CREATED',updatedAt:new Date()}});
      else await tx.paymentAttempt.create({data:{orderId:id,channel,requestKey:'membership.pay:'+id,externalRequestId:order.orderNo,state:'CREATED',amount:order.payableTotal,currency:'CNY',expiresAt:order.expiresAt}});
    });
    try{const item=await this.db.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),orderInfo=await this.channels.resolve(channel).prepay(order.orderNo,(item.itemSnapshot as unknown as Snapshot).title,Number(order.payableTotal),order.expiresAt);await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING',updatedAt:new Date()}});if((await this.owned(id,userId)).state!=='PENDING')throw new ConflictException('订单状态已变化，请刷新');return{provider:channel==='ALIPAY_APP'?'alipay':'wxpay',orderInfo};}
    catch(e){await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING',failureCode:'PROVIDER_RESULT_UNKNOWN',updatedAt:new Date()}});throw e;}
  }
  async refresh(id:string,userId:string){
    const order=await this.owned(id,userId),attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    if((order.pricingSnapshot as {channel:string}).channel==='APPLE_IAP'){const receipt=await this.db.appleTransactionState.findFirst({where:{paymentId:{in:(await this.db.paymentTransaction.findMany({where:{orderId:id,channel:'APPLE_IAP'},select:{id:true}})).map(p=>p.id)}}});if(receipt)await this.moduleRef.get('APPLE_COMMERCE',{strict:false}).refresh(receipt.id,userId);else throw new ConflictException('Apple交易尚未确认，请在原书院账号恢复购买，勿再次付款');return this.detail(id,userId);}
    if(order.state==='PENDING'&&attempt){const revision=attempt.updatedAt,result=await this.channels.resolve(attempt.channel).query(order.orderNo);if(result.trade_state==='SUCCESS')await this.confirmPayment(result,undefined,attempt.channel as AppPaymentChannel);else if(['NOTPAY','CLOSED','NOTFOUND'].includes(result.trade_state)){await this.db.paymentAttempt.updateMany({where:{id:attempt.id,updatedAt:revision},data:{lastQueriedAt:new Date(),failureCode:null}});if(order.expiresAt<=new Date()||result.trade_state==='CLOSED')await this.cancel(id,userId,order.expiresAt<=new Date()?'TIMEOUT':'PROVIDER_CLOSED');}}
    for(const refund of await this.db.refund.findMany({where:{orderId:id,state:'REFUNDING'}})){const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}});try{await this.confirmRefund(await this.channels.resolve(payment.channel).queryRefund(refund.channelRequestKey!,{transactionId:payment.externalTransactionId,orderNo:order.orderNo,total:Number(payment.amount)}),payment.channel as AppPaymentChannel);}catch{/* Durable jobs retain the refund until the channel can confirm it. */}}
    return this.detail(id,userId);
  }
  async cancel(id:string,userId:string,reason='USER_CANCEL'){
    const order=await this.owned(id,userId);if(order.state==='CLOSED')return this.detail(id,userId);if(order.state!=='PENDING')throw new ConflictException('已付款订单请从售后申请退款');
    if((order.pricingSnapshot as {channel:string}).channel==='APPLE_IAP'){
      if(order.expiresAt>new Date())throw new ConflictException('Apple购买确认仍有效，请先恢复原交易，勿重复付款');
      await this.db.$transaction(async tx=>{await this.lock(tx,order);const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}});if(current.state!=='PENDING')throw new ConflictException('订单已变化，请刷新');await tx.tradeOrder.update({where:{id},data:{state:'CLOSED',closedAt:new Date(),closeReason:'APPLE_INTENT_EXPIRED',version:{increment:1}}});await tx.tradeOrderItem.updateMany({where:{orderId:id},data:{state:'CLOSED'}});await tx.paymentAttempt.updateMany({where:{orderId:id},data:{state:'CLOSED'}});await tx.auditLog.create({data:{actorId:userId,action:'apple.membership.intent.close',resource:'trade_order',resourceId:id,reason:'已过购买确认窗口；保留Apple后续凭证核查，不伪造渠道取消',changes:{state:'CLOSED'}}});});return this.detail(id,userId);
    }
    const attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    if(attempt){if(attempt.state==='CREATED'&&Date.now()-attempt.updatedAt.getTime()<30000)throw new ConflictException('支付正在发起，请稍后查询');const result=await this.channels.resolve(attempt.channel).query(order.orderNo);if(result.trade_state==='SUCCESS'){await this.confirmPayment(result,undefined,attempt.channel as AppPaymentChannel);throw new ConflictException('已确认付款，请刷新');}if(!['NOTPAY','CLOSED','NOTFOUND'].includes(result.trade_state))throw new ConflictException('支付状态待确认，暂不能取消');if(result.trade_state==='NOTPAY')await this.channels.resolve(attempt.channel).close(order.orderNo);}
    await this.db.$transaction(async tx=>{await this.lock(tx,order);const row=await tx.tradeOrder.findUniqueOrThrow({where:{id}});if(row.state==='CLOSED')return;if(row.state!=='PENDING')throw new ConflictException('订单已付款，请刷新');await releaseOrderGifts(tx,id,userId);await this.charity.finish(tx,id,'RELEASED');await tx.tradeOrder.update({where:{id},data:{state:'CLOSED',closedAt:new Date(),closeReason:reason,version:{increment:1}}});await tx.tradeOrderItem.updateMany({where:{orderId:id},data:{state:'CLOSED'}});await tx.paymentAttempt.updateMany({where:{orderId:id},data:{state:'CLOSED'}});await tx.auditLog.create({data:{actorId:userId,action:'membership.order.close',resource:'trade_order',resourceId:id,reason,changes:{state:'CLOSED'}}});});return this.detail(id,userId);
  }
  private async journal(tx:Prisma.TransactionClient,order:TradeOrder,paymentId:string,amount:bigint,eventKey:string,incoming:boolean,channel:AppPaymentChannel,anomaly:boolean,refundId?:string){
    const journal=await tx.financeJournal.create({data:{eventKey,kind:incoming?'MEMBERSHIP_PAYMENT':'MEMBERSHIP_REFUND',orderId:order.id,transactionId:paymentId,refundId,currency:'CNY',postedAt:new Date(),description:incoming?'会员已验证收款':'会员已验证退款'}}),income=anomaly?'MEMBERSHIP_REFUND_PAYABLE':'MEMBERSHIP_REVENUE',receivable=channel==='ALIPAY_APP'?'ALIPAY_RECEIVABLE':'WECHAT_RECEIVABLE';
    await tx.financeEntry.createMany({data:[{journalId:journal.id,accountCode:incoming?receivable:income,debit:amount,userId:order.userId},{journalId:journal.id,accountCode:incoming?income:receivable,credit:amount,userId:order.userId}]});
  }
  async confirmPayment(data:WechatTransaction,callback?:{id:string;payloadHash:string},channel:AppPaymentChannel='WECHAT_APP'){
    const identity=this.channels.resolve(channel).identity();
    if(data.appid!==identity.appid||data.mchid!==identity.mchid||data.trade_type!=='APP'||data.trade_state!=='SUCCESS'||typeof data.transaction_id!=='string'||!data.transaction_id||data.transaction_id.length>128||!Number.isSafeInteger(data.amount?.total)||data.amount!.total<=0||data.amount!.currency!=='CNY'||!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('会员收款事实无效');
    const initial=await this.db.tradeOrder.findUnique({where:{orderNo:data.out_trade_no}});if(initial?.kind!=='MEMBERSHIP')throw new NotFoundException('会员订单不存在');
    return this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id:initial.id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}}),snapshot=item.itemSnapshot as unknown as Snapshot;
      if(!item.membershipVersionId||snapshot.planVersionId!==item.membershipVersionId)throw new ConflictException('会员订单的权益版本不一致');
      const old=await tx.paymentTransaction.findFirst({where:{channel,appScope:identity.appid,externalTransactionId:data.transaction_id!}});
      if(old){if(old.orderId!==order.id||old.amount!==BigInt(data.amount!.total)||old.currency!=='CNY')throw new ConflictException('交易已绑定其他收款事实');return{disposition:old.disposition};}
      const attempt=await tx.paymentAttempt.findFirst({where:{orderId:order.id,channel}});if(!attempt)throw new BadRequestException('无对应渠道支付尝试');
      await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${snapshot.planId} FOR SHARE`;
      const plan=await tx.membershipPlan.findUnique({where:{id:snapshot.planId}}),existing=await tx.paymentTransaction.findFirst({where:{orderId:order.id,disposition:'ACCEPTED'}}),user=await tx.user.findUniqueOrThrow({where:{id:order.userId}}),schedule=await this.schedule(order.userId,snapshot.tier,tx,order.createdAt),amount=BigInt(data.amount!.total),paidAt=new Date(data.success_time!);
      if(paidAt.getTime()<order.createdAt.getTime()-300000)throw new BadRequestException('付款时间早于会员订单');
      const disposition=amount!==order.payableTotal?'AMOUNT_MISMATCH':existing?'DUPLICATE':order.state==='CLOSED'||paidAt>order.expiresAt?'LATE':!await memberGiftReady(tx,item.id,item.membershipVersionId)||!await this.charity.ready(tx,order.id)||!plan?.active||user.status!=='ACTIVE'||schedule.fingerprint!==snapshot.schedule.fingerprint?'REFUND_REQUIRED':'ACCEPTED';
      const payment=await tx.paymentTransaction.create({data:{attemptId:attempt.id,orderId:order.id,channel,appScope:identity.appid,externalTransactionId:data.transaction_id!,amount,currency:'CNY',verifiedAt:new Date(),paidAt,disposition,receiptHash:hash(data)}});
      await this.journal(tx,order,payment.id,amount,'membership.payment:'+payment.id,true,channel,disposition!=='ACCEPTED');
      if(disposition==='ACCEPTED'){
        await this.charity.finish(tx,order.id,'DELIVERED');
        const startsAt=new Date(Math.max(Date.now(),Date.parse(schedule.anchor??'')||0)),endsAt=new Date(startsAt.getTime()+snapshot.days*day);
        const member=await tx.membership.create({data:{userId:order.userId,planId:snapshot.planId,planVersionId:item.membershipVersionId,tier:snapshot.tier,startsAt,endsAt,source:'PURCHASE',orderItemId:item.id,grantKey:'membership.payment:'+payment.id}});await activateMemberGift(tx,member.id);
        await tx.tradeOrder.update({where:{id:order.id},data:{state:'COMPLETED',paidAt,paidTotal:amount,completedAt:new Date(),version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{state:'DELIVERED'}});await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED'}});
        await tx.notification.create({data:{userId:order.userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'membership.paid:'+order.id,title:startsAt>new Date()?'会员续期已确认':'会员已开通',body:snapshot.title+' · '+snapshot.days+'天；生效日期与原版权益可在会员订单查看。'}});
      }else{
        if(!existing){await releaseOrderGifts(tx,order.id,order.userId);await this.charity.finish(tx,order.id,'RELEASED');await tx.tradeOrder.update({where:{id:order.id},data:{state:'CLOSED',closedAt:new Date(),closeReason:disposition,version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{state:'CLOSED'}});await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED'}});}
        const refund=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'membership.anomaly:'+payment.id,kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:amount,approvedAmount:amount,reasonCode:disposition,description:'异常会员收款原路退回，不提前或重复开通会员',paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});
        await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount,revokeQuantity:0}});await this.refundJob(tx,refund.id);
        await tx.notification.create({data:{userId:order.userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'membership.anomaly:'+payment.id,title:'会员收款正在原路退回',body:'本次未重复开通会员，订单可查看实际退款进度。'}});
      }
      if(callback)await tx.providerCallback.create({data:{provider:channel,appScope:identity.appid,externalEventId:callback.id,kind:'TRANSACTION.SUCCESS',payloadHash:callback.payloadHash,payloadStorageRef:'sha256:'+callback.payloadHash,signatureVerified:true,state:'HANDLED',handledAt:new Date()}});
      await tx.outboxJob.updateMany({where:{eventKey:'membership.expire:'+order.id},data:{state:'DONE',completedAt:new Date(),lockedUntil:null}});await tx.auditLog.create({data:{actorId:order.userId,action:'membership.payment.confirm',resource:'trade_order',resourceId:order.id,changes:{paymentId:payment.id,disposition,amount:String(amount),source:channel+'_VERIFIED'}}});return{disposition};
    });
  }
  private refundJob(tx:Prisma.TransactionClient,id:string){return tx.outboxJob.upsert({where:{eventKey:'membership.refund:'+id},create:{eventKey:'membership.refund:'+id,kind:'MEMBERSHIP_REFUND',aggregateType:'MEMBERSHIP_REFUND',aggregateId:id,payload:{},availableAt:new Date()},update:{state:'READY',availableAt:new Date(),lockedUntil:null,attempts:0,lastErrorCode:null}});}
  async requestRefund(id:string,userId:string,dto:RefundDto){
    const order=await this.owned(id,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ForbiddenException('账号不可用，请通过客服核查');
      const old=await tx.refund.findFirst({where:{userId,requestKey:dto.requestKey}});if(old){if(old.orderId!==id||old.description!==dto.reason.trim())throw new ConflictException('请求标识已用于其他申请');return;}
      const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),status=await this.refundable(tx,current);
      if(!status.manual)throw new ConflictException('已有退款申请、会员已结束或此渠道需另行核查，请查看订单说明');
      const partial=!status.allowed,assessment=partial?await this.refundAssessment(tx,status.member!.id,status.payment!.amount):null;
      const refund=await tx.refund.create({data:{orderId:id,userId,requestKey:dto.requestKey,kind:'REFUND_ONLY',state:'REQUESTED',requestedAmount:status.payment!.amount,reasonCode:partial?'MEMBERSHIP_PARTIAL':'MEMBERSHIP_RETURN',description:dto.reason.trim(),paymentTransactionId:status.payment!.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31),...(assessment?{assessmentSnapshot:assessment}:{})}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:status.payment!.amount,revokeQuantity:1}});
      await tx.auditLog.create({data:{actorId:userId,action:'membership.refund.request',resource:'refund',resourceId:refund.id,changes:{orderId:id,mode:partial?'NEGOTIATED':'FULL_FUTURE_PERIOD'}}});
    });return this.detail(id,userId);
  }
  async reviewRefund(id:string,req:AuthRequest,dto:ReviewDto){
    requireRoles(req,['FINANCE']);const refund=await this.db.refund.findUnique({where:{id}});if(!refund)throw new NotFoundException('退款申请不存在');const order=await this.owned(refund.orderId,refund.userId);
    if(dto.action==='CANCEL')return this.cancelFailedRefund(refund,order,req,dto);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id}});
      if(current.version!==dto.expectedVersion||(dto.action==='RETRY'?!['FAILED','REFUNDING'].includes(current.state):current.state!=='REQUESTED'))throw new ConflictException('退款状态已变化，请刷新');
      const payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:current.paymentTransactionId!}});
      if(payment.channel==='APPLE_IAP')throw new BadRequestException('Apple退款不能从其他渠道审批');
      const partial=current.reasonCode==='MEMBERSHIP_PARTIAL';let approvedAmount=current.approvedAmount??current.requestedAmount,assessment=current.assessmentSnapshot;
      if(dto.action!=='APPROVE'&&dto.approvedAmount!==undefined)throw new BadRequestException('此操作不能改变退款金额');
      if(dto.action==='APPROVE'){
        const member=await tx.membership.findFirst({where:{orderItemId:{in:(await tx.refundItem.findMany({where:{refundId:id}})).map(i=>i.orderItemId)}}});
        if(!member||member.revokedAt||payment.disposition!=='ACCEPTED')throw new ConflictException('原会员权益或付款不可用于此退款，请核查');
        if(partial){
          if(!dto.approvedAmount)throw new BadRequestException('请填写经核实、待学员确认的原路退款金额');
          approvedAmount=BigInt(dto.approvedAmount);const currentOrder=await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}});
          if(approvedAmount<=0n||approvedAmount>current.requestedAmount||approvedAmount>payment.amount-currentOrder.refundedTotal)throw new BadRequestException('退款金额须大于零且不能超过原实付可退余额');
          const basis=await this.refundAssessment(tx,member.id,payment.amount);
          if(basis.usage.some(u=>u.state==='HELD'))throw new ConflictException('本段仍有占用中的服务权益，请先处理对应服务，不能直接退订');
          assessment={...basis,proposalAmount:String(approvedAmount),deductionAmount:String(payment.amount-approvedAmount),proposalVersion:current.version+1,reviewNote:dto.reason.trim()};
          await tx.refundItem.updateMany({where:{refundId:id},data:{amount:approvedAmount,version:{increment:1}}});
        }else if(member.startsAt<=new Date()||Date.now()-payment.paidAt.getTime()>7*day||await tx.benefitUsage.count({where:{periodId:member.id,state:{in:['HELD','CONSUMED']}}}))throw new ConflictException('会员已生效或消费权益，请拒绝原申请后重新提交核查申请');
        else if(dto.approvedAmount!==undefined&&BigInt(dto.approvedAmount)!==current.requestedAmount)throw new BadRequestException('未来整段退款不能擅自扣款');
      }
      const state=dto.action==='REJECT'?'REJECTED':partial&&dto.action==='APPROVE'?'APPROVED':'REFUNDING';
      if(dto.action==='RETRY'&&partial&&!current.acceptedAt)throw new ConflictException('学员尚未确认退款方案，不能发起退款');
      await tx.refund.update({where:{id},data:{state,approvedAmount:state==='REJECTED'?null:approvedAmount,...(assessment?{assessmentSnapshot:assessment}:{}),reviewerId:req.actor.id,reviewNote:dto.reason.trim(),failureCode:null,updatedAt:new Date(),version:{increment:1}}});
      if(state==='REFUNDING')await this.refundJob(tx,id);
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:id,reason:dto.reason.trim(),changes:{state,approvedAmount:String(approvedAmount)}}});
      await tx.notification.create({data:{userId:order.userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'membership.refund.review:'+id+':'+(current.version+1),title:state==='REJECTED'?'会员退款申请未通过':state==='APPROVED'?'请确认会员退款方案':'会员退款正在办理',body:state==='APPROVED'?'请在会员订单查看具体退款金额及扣除依据，确认后才发起原路退款。'+dto.reason.trim():dto.reason.trim()}});
    });return this.detail(order.id,order.userId);
  }
  async decideRefund(orderId:string,id:string,userId:string,dto:RefundDecisionDto){
    const order=await this.owned(orderId,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const refund=await tx.refund.findFirst({where:{id,orderId,userId,reasonCode:'MEMBERSHIP_PARTIAL'}});
      if(!refund)throw new NotFoundException('退款方案不存在');
      const assessment=refund.assessmentSnapshot as {proposalVersion?:number}|null;
      if(assessment?.proposalVersion===dto.expectedVersion&&(dto.action==='ACCEPT'&&refund.acceptedAt||dto.action==='DECLINE'&&refund.state==='CANCELLED'))return;
      if(refund.state!=='APPROVED'||refund.version!==dto.expectedVersion||assessment?.proposalVersion!==dto.expectedVersion)throw new ConflictException('退款方案已变化，请重新查看金额与说明');
      const state=dto.action==='ACCEPT'?'REFUNDING':'CANCELLED';
      await tx.refund.update({where:{id},data:{state,acceptedAt:dto.action==='ACCEPT'?new Date():null,version:{increment:1},updatedAt:new Date()}});
      if(state==='REFUNDING')await this.refundJob(tx,id);
      await tx.auditLog.create({data:{actorId:userId,action:'membership.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:id,changes:{state,proposalVersion:dto.expectedVersion,amount:String(refund.approvedAmount)}}});
      await tx.notification.create({data:{userId,kind:'MEMBERSHIP_ORDER',orderId,eventKey:'membership.refund.decision:'+id,title:state==='REFUNDING'?'会员退款方案已确认':'已保留原会员',body:state==='REFUNDING'?'原路退款正在办理，完成时间以支付渠道为准；本段权益暂停，其他已确认会员不变。':'退款方案已拒绝，恢复本段原有效期限，不产生退款或自动延长。'}});
    });return this.detail(orderId,userId);
  }
  private validateRefundFact(data:WechatRefund,refund:Refund,order:TradeOrder,payment:PaymentTransaction,channel:AppPaymentChannel){
    const identity=this.channels.resolve(channel).identity(),state=data.refund_status??data.status;
    if(payment.channel!==channel||payment.appScope!==identity.appid||(data.mchid&&data.mchid!==identity.mchid)||data.out_refund_no!==refund.channelRequestKey||data.out_trade_no!==order.orderNo||data.transaction_id!==payment.externalTransactionId||!Number.isSafeInteger(data.amount?.refund)||!Number.isSafeInteger(data.amount?.total)||BigInt(data.amount.refund)!==refund.approvedAmount||BigInt(data.amount.total)!==payment.amount||(data.amount.currency&&data.amount.currency!=='CNY')||typeof data.refund_id!=='string'||!data.refund_id||data.refund_id.length>128||!['SUCCESS','PROCESSING','ABNORMAL','CLOSED'].includes(state??''))throw new BadRequestException('退款事实与会员原付款不一致');
    return{identity,state};
  }
  private async cancelFailedRefund(refund:Refund,order:TradeOrder,req:AuthRequest,dto:ReviewDto){
    if(refund.version!==dto.expectedVersion||refund.state!=='FAILED')throw new ConflictException('退款状态已变化，请刷新');
    const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}});
    if(payment.channel==='APPLE_IAP'||payment.disposition!=='ACCEPTED'||!['MEMBERSHIP_RETURN','MEMBERSHIP_PARTIAL'].includes(refund.reasonCode))throw new BadRequestException('仅可取消渠道已关闭的会员退订申请，异常收款必须继续退回');
    const data=await this.channels.resolve(payment.channel).queryRefund(refund.channelRequestKey!,{transactionId:payment.externalTransactionId,orderNo:order.orderNo,total:Number(payment.amount)}),channel=payment.channel as AppPaymentChannel;
    const {state}=this.validateRefundFact(data,refund,order,payment,channel);
    if(state==='SUCCESS'){await this.confirmRefund(data,channel);throw new ConflictException('渠道已确认退款成功，已更新原订单，不能取消');}
    if(state!=='CLOSED')throw new ConflictException('渠道尚未确认退款已关闭，继续保留权益暂停；请查询或重试，勿恢复交付');
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id:refund.id}});
      if(current.version!==dto.expectedVersion||current.state!=='FAILED')throw new ConflictException('退款状态已变化，请刷新');
      const member=await tx.membership.findFirst({where:{source:'PURCHASE',grantKey:'membership.payment:'+payment.id,orderItemId:{in:(await tx.refundItem.findMany({where:{refundId:refund.id,revokeQuantity:{gt:0}}})).map(i=>i.orderItemId)}}});
      if(!member||member.revokedAt||!await tx.user.findFirst({where:{id:order.userId,status:'ACTIVE'}}))throw new ConflictException('原权益或账号已独立停用，请联系书院核查，不能自动恢复');
      await tx.refund.update({where:{id:refund.id},data:{state:'CANCELLED',reviewerId:req.actor.id,reviewNote:dto.reason.trim(),failureCode:'CLOSED',version:{increment:1},updatedAt:new Date()}});
      await tx.outboxJob.updateMany({where:{eventKey:'membership.refund:'+refund.id},data:{state:'DONE',lockedUntil:null,completedAt:new Date(),lastErrorCode:null}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.refund.cancel',resource:'refund',resourceId:refund.id,reason:dto.reason.trim(),changes:{source:channel+'_VERIFIED',channelState:state,receiptHash:hash(data),externalRefundId:data.refund_id,memberId:member.id,startsAt:member.startsAt.toISOString(),endsAt:member.endsAt.toISOString()}}});
      await tx.notification.create({data:{userId:order.userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'membership.refund.cancelled:'+refund.id,title:'会员退款申请已取消',body:'支付渠道已确认本次退款关闭；此段会员按原生效与到期日期恢复，不增加天数。处理意见：'+dto.reason.trim()}});
    });return this.detail(order.id,order.userId);
  }
  async confirmRefund(data:WechatRefund,channel:AppPaymentChannel='WECHAT_APP'){
    const refund=await this.db.refund.findUnique({where:{channelRequestKey:data.out_refund_no}});if(!refund)throw new NotFoundException('退款记录不存在');const order=await this.owned(refund.orderId,refund.userId),payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),{identity,state}=this.validateRefundFact(data,refund,order,payment,channel);
    if(state==='PROCESSING')return false;
    return this.db.$transaction(async tx=>{await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id:refund.id}});if(current.state==='SUCCEEDED')return true;if(current.reasonCode==='MEMBERSHIP_PARTIAL'&&!current.acceptedAt)throw new ConflictException('退款方案尚未获学员确认');if(!['REFUNDING','FAILED'].includes(current.state))throw new ConflictException('退款未审批');if(state!=='SUCCESS'){await tx.refund.update({where:{id:refund.id},data:{state:'FAILED',failureCode:state,updatedAt:new Date(),version:{increment:1}}});return true;}if(!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('退款完成时间无效');const transaction=await tx.refundTransaction.create({data:{refundId:refund.id,paymentTransactionId:payment.id,channel,appScope:identity.appid,externalRefundId:data.refund_id,amount:current.approvedAmount!,currency:'CNY',verifiedAt:new Date(),succeededAt:new Date(data.success_time),receiptHash:hash(data)}});await tx.refund.update({where:{id:refund.id},data:{state:'SUCCEEDED',succeededAt:transaction.succeededAt,failureCode:null,version:{increment:1}}});await this.journal(tx,order,payment.id,transaction.amount,'membership.refunded:'+refund.id,false,channel,payment.disposition!=='ACCEPTED',refund.id);
      if(payment.disposition==='ACCEPTED'){await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:{increment:transaction.amount},version:{increment:1}}});await this.charity.reverse(tx,order.id,refund.id);if(order.refundedTotal+transaction.amount===order.paidTotal)await this.charity.finish(tx,order.id,'REFUNDED');for(const item of await tx.refundItem.findMany({where:{refundId:refund.id,revokeQuantity:{gt:0}}})){await tx.tradeOrderItem.update({where:{id:item.orderItemId},data:{refundedAmount:{increment:item.amount},state:'REFUNDED'}});await tx.membership.updateMany({where:{orderItemId:item.orderItemId,source:'PURCHASE',grantKey:'membership.payment:'+payment.id,revokedAt:null},data:{revokedAt:new Date(),version:{increment:1}}});}}
      await tx.notification.create({data:{userId:order.userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'membership.refunded:'+refund.id,title:'会员退款已完成',body:'支付渠道已确认原路退款；仅撤销此次购买，其他已确认会员期限保持不变。'}});await tx.auditLog.create({data:{actorId:order.userId,action:'membership.refund.confirm',resource:'refund',resourceId:refund.id,changes:{transactionId:transaction.id,amount:String(transaction.amount),source:channel+'_VERIFIED'}}});return true;
    });
  }
  async admin(q:PageQuery){const where={kind:'MEMBERSHIP',...(q.state?{state:q.state}:{}),...(q.q?{orderNo:{contains:q.q}}:{})};const [rows,total]=await this.db.$transaction([this.db.tradeOrder.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.size,take:q.size}),this.db.tradeOrder.count({where})]);return{items:await Promise.all(rows.map(async row=>({...await this.detail(row.id,row.userId),nickname:(await this.db.user.findUnique({where:{id:row.userId},select:{nickname:true}}))?.nickname??'已注销'}))),total};}
  async adminDetail(id:string){const order=await this.db.tradeOrder.findFirst({where:{id,kind:'MEMBERSHIP'}});if(!order)throw new NotFoundException('会员订单不存在');return safe({...await this.detail(id,order.userId),payments:await this.db.paymentTransaction.findMany({where:{orderId:id},select:{id:true,channel:true,externalTransactionId:true,amount:true,disposition:true,paidAt:true,verifiedAt:true}}),recoveryJobs:await this.db.outboxJob.findMany({where:{aggregateId:{in:[id,...(await this.db.refund.findMany({where:{orderId:id},select:{id:true}})).map(r=>r.id)]}},select:{kind:true,state:true,attempts:true,availableAt:true,lastErrorCode:true}})});}
  async adminRefresh(id:string){const order=await this.db.tradeOrder.findFirst({where:{id,kind:'MEMBERSHIP'}});if(!order)throw new NotFoundException('会员订单不存在');await this.refresh(id,order.userId);return this.adminDetail(id);}
  async runJobs(){
    if(this.working)return;this.working=true;
    try{for(let i=0;i<10;i++){const jobs=await this.db.$queryRaw<{id:string;kind:string;aggregateId:string;attempts:number}[]>`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind IN ('MEMBERSHIP_PAYMENT_CHECK','MEMBERSHIP_REFUND') AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,kind,"aggregateId",attempts`;if(!jobs.length)break;const job=jobs[0]!;try{let done=true;if(job.kind==='MEMBERSHIP_PAYMENT_CHECK'){const order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:job.aggregateId}});if(order.state==='PENDING'){await this.refresh(order.id,order.userId);if((await this.owned(order.id,order.userId)).state==='PENDING'){if(!await this.db.paymentAttempt.findFirst({where:{orderId:order.id}}))await this.cancel(order.id,order.userId,'TIMEOUT');else done=false;}}}else{const refund=await this.db.refund.findUniqueOrThrow({where:{id:job.aggregateId}});if(refund.state==='REFUNDING'){const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:refund.orderId}});done=await this.confirmRefund(await this.channels.resolve(payment.channel).refund(payment.externalTransactionId,refund.channelRequestKey!,Number(refund.approvedAmount),Number(payment.amount),order.orderNo),payment.channel as AppPaymentChannel);}}await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:done?'DONE':'READY',completedAt:done?new Date():null,lockedUntil:null,availableAt:new Date(Date.now()+60000),lastErrorCode:null}});}catch{await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:job.attempts>=20?'DEAD':'READY',lockedUntil:null,availableAt:new Date(Date.now()+Math.min(3600000,30000*2**Math.min(job.attempts,7))),lastErrorCode:'PROVIDER_OR_PROCESSING_ERROR'}});}}}finally{this.working=false;}
  }
}

@Controller('commerce') export class MembershipSalesController {
  constructor(private readonly sales:MembershipSalesService){}
  @Get('memberships/:id/quote') @UseGuards(OptionalUserGuard) quote(@Param('id',ParseUUIDPipe) id:string,@Query() q:QuoteQuery,@Req() req:AuthRequest){return this.sales.quote(id,q.platform,req.actor?.id);}
  @Post('membership-orders') @UseGuards(UserGuard) checkout(@Req() req:AuthRequest,@Body() dto:CheckoutDto){return this.sales.checkout(req.actor.id,dto);}
  @Get('membership-orders') @UseGuards(UserGuard) list(@Req() req:AuthRequest,@Query() q:PageQuery){return this.sales.list(req.actor.id,q);}
  @Get('membership-orders/:id') @UseGuards(UserGuard) detail(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.detail(id,req.actor.id);}
  @Post('membership-orders/:id/payment') @UseGuards(UserGuard) pay(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.prepay(id,req.actor.id);}
  @Post('membership-orders/:id/refresh') @UseGuards(UserGuard) refresh(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.refresh(id,req.actor.id);}
  @Post('membership-orders/:id/cancel') @UseGuards(UserGuard) cancel(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.cancel(id,req.actor.id);}
  @Post('membership-orders/:id/refunds/:refundId/decision') @UseGuards(UserGuard) decision(@Param('id',ParseUUIDPipe) id:string,@Param('refundId',ParseUUIDPipe) refundId:string,@Req() req:AuthRequest,@Body() dto:RefundDecisionDto){return this.sales.decideRefund(id,refundId,req.actor.id,dto);}
  @Post('membership-orders/:id/refund') @UseGuards(UserGuard) refund(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:RefundDto){return this.sales.requestRefund(id,req.actor.id,dto);}
}
@Controller('admin/membership-orders') @UseGuards(AdminGuard) export class MembershipOrdersAdminController {
  constructor(private readonly sales:MembershipSalesService){}
  @Get() list(@Req() req:AuthRequest,@Query() q:PageQuery){requireRoles(req,['FINANCE','SUPPORT']);return this.sales.admin(q);}
  @Get(':id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['FINANCE','SUPPORT']);return this.sales.adminDetail(id);}
  @Post(':id/refresh') refresh(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['FINANCE','SUPPORT']);return this.sales.adminRefresh(id);}
  @Post('refunds/:id/review') review(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewDto){return this.sales.reviewRefund(id,req,dto);}
}

