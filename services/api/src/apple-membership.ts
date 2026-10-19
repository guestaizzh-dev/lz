import {reviewedAppleRefund} from './apple-refund-state.js';
import {holdMemberGift,memberGiftReady,activateMemberGift} from './member-gift-stock.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Database } from './database.js';
import { AppleStoreService, type AppleFact } from './apple-store.js';
import { MembershipSalesService, type MembershipSnapshot } from './membership-sales.js';
import { membershipContentTier } from './membership-benefits.js';
import { Prisma, type AppleTransactionState, type ChannelProductMapping, type TradeOrder } from './generated/prisma/client.js';
import type { AuthRequest } from './auth.js';
import { requireRoles } from './auth.js';

const day=86400000,productType='Non-Renewing Subscription';
const safe=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(safe(value))).digest('hex');
type Store=Database|Prisma.TransactionClient;
type MappingInput={planId:string;planVersionId:string;bundleId:string;environment:string;externalProductId:string;priceMinor:number;reason:string};
type PrepareInput={mappingId:string;expectedVersion:number;accepted:boolean;quoteHash?:string;requestKey?:string};

@Injectable()
export class AppleMembershipService {
  constructor(private readonly db:Database,private readonly sales:MembershipSalesService,private readonly apple:AppleStoreService){}
  async mappings(planId:string){
    const plan=await this.db.membershipPlan.findUnique({where:{id:planId}});if(!plan)throw new NotFoundException('会员套餐不存在');
    const versions=await this.db.membershipPlanVersion.findMany({where:{planId},orderBy:{releaseNo:'desc'}}),offers=await this.db.saleOffer.findMany({where:{kind:'MEMBERSHIP',membershipVersionId:{in:versions.map(v=>v.id)}}});
    return safe({items:await this.db.channelProductMapping.findMany({where:{channel:'APPLE_IAP',offerId:{in:offers.map(o=>o.id)}},orderBy:{createdAt:'desc'}}),plan,currentVersion:versions.find(v=>v.id===plan.currentVersionId),offers:offers.map(o=>({...o,release:versions.find(v=>v.id===o.membershipVersionId)})),enabled:process.env.APPLE_IAP_ENABLED==='true',nativeReady:process.env.APPLE_NATIVE_PURCHASE_READY==='true',membershipReady:process.env.APPLE_MEMBERSHIP_SALES_ENABLED==='true'});
  }
  async validateMappingOffer(offerId:string,store:Store){
    const offer=await store.saleOffer.findUnique({where:{id:offerId}});
    if(!offer||offer.kind!=='MEMBERSHIP'||!offer.membershipVersionId||offer.currency!=='CNY'||offer.price<=0n||!offer.active)throw new BadRequestException('请选择有效的会员售卖版本');
    const version=await store.membershipPlanVersion.findUniqueOrThrow({where:{id:offer.membershipVersionId}}),plan=await store.membershipPlan.findUniqueOrThrow({where:{id:version.planId}});
    if(!plan.active||plan.currentVersionId!==version.id||offer.price!==BigInt(plan.price)||!version.publishedAt||!await membershipContentTier(version.id,store))throw new ConflictException('套餐版本、权益或价格已变化，请配置新产品映射');
    return{offer,version,plan};
  }
  async createMapping(req:AuthRequest,dto:MappingInput){
    requireRoles(req,['ADMIN']);if(process.env.NODE_ENV==='production'&&dto.environment!=='Production')throw new BadRequestException('正式服务不得配置沙箱收款');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${dto.planId} FOR SHARE`;
      const terms=await this.sales.appleTerms(dto.planId,req.actor.id,tx);if(terms.snapshot.planVersionId!==dto.planVersionId||terms.price!==BigInt(dto.priceMinor))throw new ConflictException('套餐权益版本或价格已变化，请刷新后核对App Store产品配置');
      const offer=await tx.saleOffer.upsert({where:{id:'membership-offer-'+terms.snapshot.planVersionId},create:{id:'membership-offer-'+terms.snapshot.planVersionId,kind:'MEMBERSHIP',membershipVersionId:terms.snapshot.planVersionId,currency:'CNY',price:terms.price,active:true,quantityLimit:1,policySnapshot:{refundPolicy:terms.snapshot.refundPolicy}},update:{}});
      await this.validateMappingOffer(offer.id,tx);
      const appScope=dto.bundleId+':'+dto.environment;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${appScope+':'+dto.externalProductId},0))`;
      if(await tx.channelProductMapping.findFirst({where:{channel:'APPLE_IAP',appScope,externalProductId:dto.externalProductId}}))throw new ConflictException('Apple产品已绑定，不能改绑套餐、价格或权益版本');
      const row=await tx.channelProductMapping.create({data:{offerId:offer.id,channel:'APPLE_IAP',appScope,externalProductId:dto.externalProductId,productType,currency:'CNY',priceMinor:terms.price,minorExponent:2}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'apple.membership.mapping.create',resource:'channel_product_mapping',resourceId:row.id,reason:dto.reason.trim(),changes:{planId:dto.planId,planVersionId:terms.snapshot.planVersionId,appScope,productId:dto.externalProductId,amount:String(terms.price),productType}}});return safe(row);
    });
  }
  async quote(planId:string,userId:string){
    const terms=await this.sales.appleTerms(planId,userId,this.db),offers=await this.db.saleOffer.findMany({where:{kind:'MEMBERSHIP',membershipVersionId:terms.snapshot.planVersionId,active:true}});
    const maps=await this.db.channelProductMapping.findMany({where:{channel:'APPLE_IAP',offerId:{in:offers.map(o=>o.id)},active:true,productType,currency:'CNY',priceMinor:terms.price},orderBy:{createdAt:'desc'}});
    const configured=process.env.APPLE_IAP_ENABLED==='true',identity=configured?this.apple.identity():null,mapping=maps.find(m=>m.appScope===identity?.appScope),ready=!!mapping&&process.env.APPLE_NATIVE_PURCHASE_READY==='true'&&process.env.APPLE_MEMBERSHIP_SALES_ENABLED==='true';
    return safe({...terms.snapshot,price:terms.price,currency:'CNY',mapping:mapping?{id:mapping.id,version:mapping.version,productId:mapping.externalProductId}:null,quoteHash:hash(terms),paymentEnabled:ready,unavailableReason:ready?'':'iOS会员正式产品、原生购买与渠道验收尚未就绪，暂不收取费用。',explanation:'按固定天数手动购买，不自动续费；最终价格须与App Store返回的人民币价格一致。Apple退款不提前其他已确认会员期限。'});
  }
  async prepare(userId:string,binding:{appScope:string;accountToken:string},dto:PrepareInput){
    if(process.env.APPLE_MEMBERSHIP_SALES_ENABLED!=='true'||process.env.APPLE_NATIVE_PURCHASE_READY!=='true')throw new ServiceUnavailableException('iOS会员原生购买尚未验收，暂不收取费用');
    if(!dto.accepted||!dto.quoteHash||!dto.requestKey)throw new BadRequestException('请确认套餐、固定天数、排队日期与Apple退款规则');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ForbiddenException('账号不可用');
      await tx.$queryRaw`SELECT id FROM "ChannelProductMapping" WHERE id=${dto.mappingId} FOR SHARE`;
      const mapping=await tx.channelProductMapping.findFirst({where:{id:dto.mappingId,channel:'APPLE_IAP',appScope:binding.appScope,active:true,productType}});
      if(!mapping||mapping.version!==dto.expectedVersion)throw new ConflictException('Apple产品映射已变化，请刷新');
      const offer=await tx.saleOffer.findUniqueOrThrow({where:{id:mapping.offerId}}),version=await tx.membershipPlanVersion.findUniqueOrThrow({where:{id:offer.membershipVersionId!}});
      await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id=${version.planId} FOR SHARE`;
      await this.validateMappingOffer(offer.id,tx);
      const terms=await this.sales.appleTerms(version.planId,userId,tx),now=new Date();
      if(hash(terms)!==dto.quoteHash||terms.price!==mapping.priceMinor||offer.validFrom&&offer.validFrom>now||offer.validUntil&&offer.validUntil<=now)throw new ConflictException('会员权益、价格或排队期限已变化，请重新确认');
      const requestHash=hash({mappingId:mapping.id,quoteHash:dto.quoteHash,accountToken:binding.accountToken}),old=await tx.tradeOrder.findFirst({where:{userId,requestKey:dto.requestKey!}});
      if(old){if(old.kind!=='MEMBERSHIP'||old.requestHash!==requestHash||old.state!=='PENDING')throw new ConflictException('请求标识已处理或用于其他购买');return this.prepared(old,mapping,binding);}
      if(await tx.tradeOrder.findFirst({where:{userId,kind:'MEMBERSHIP',state:'PENDING'}}))throw new ConflictException('已有待处理会员购买，请先查询或恢复原交易，勿重复付款');
      const order=await tx.tradeOrder.create({data:{orderNo:'IM'+randomUUID().replaceAll('-','').slice(0,30),userId,kind:'MEMBERSHIP',requestKey:dto.requestKey!,requestHash,currency:'CNY',subtotal:terms.price,payableTotal:terms.price,quoteHash:dto.quoteHash!,expiresAt:new Date(now.getTime()+15*60000),pricingSnapshot:{platform:'IOS',channel:'APPLE_IAP',mappingId:mapping.id,mappingVersion:mapping.version,appScope:binding.appScope,accountToken:binding.accountToken,productId:mapping.externalProductId}}});
      const item=await tx.tradeOrderItem.create({data:{orderId:order.id,lineNo:1,offerId:offer.id,quantity:1,unitPrice:terms.price,subtotal:terms.price,payable:terms.price,membershipVersionId:version.id,itemSnapshot:terms.snapshot,benefitSnapshot:{benefits:terms.benefits},state:'PENDING'}});
      await holdMemberGift(tx,userId,version.id,item.id,order.expiresAt);await tx.paymentAttempt.create({data:{orderId:order.id,channel:'APPLE_IAP',mappingId:mapping.id,requestKey:'apple.membership.prepare:'+order.id,state:'PENDING',amount:terms.price,currency:'CNY',expiresAt:order.expiresAt}});
      await tx.auditLog.create({data:{actorId:userId,action:'apple.membership.prepare',resource:'trade_order',resourceId:order.id,changes:{mappingId:mapping.id,planVersionId:version.id,quoteHash:dto.quoteHash,schedule:terms.snapshot.schedule,accepted:true}}});return this.prepared(order,mapping,binding);
    });
  }
  private prepared(order:TradeOrder,mapping:ChannelProductMapping,binding:{accountToken:string}){return{orderId:order.id,productId:mapping.externalProductId,appAccountToken:binding.accountToken,environment:this.apple.identity().environment,price:String(order.payableTotal),currency:'CNY',expiresAt:order.expiresAt,explanation:'支付待处理时不要重复购买，请保留原交易并登录原书院账号恢复。',refundUrl:'https://reportaproblem.apple.com/'};}
  async deliver(tx:Prisma.TransactionClient,row:AppleTransactionState,fact:AppleFact,userId:string){
    if(row.paymentId)return row;
    const review=(issueCode:string)=>tx.appleTransactionState.update({where:{id:row.id},data:{state:'REVIEW',issueCode}});
    const mapping=await tx.channelProductMapping.findFirst({where:{channel:'APPLE_IAP',appScope:row.appScope,externalProductId:fact.productId}});if(!mapping)return review('PRODUCT_NOT_MAPPED');
    await tx.$queryRaw`SELECT id FROM "ChannelProductMapping" WHERE id=${mapping.id} FOR SHARE`;
    const current=await tx.channelProductMapping.findUniqueOrThrow({where:{id:mapping.id}});
    if(current.productType!==productType||!current.activatedAt||fact.purchasedAt<current.activatedAt||!current.active&&(!current.deactivatedAt||fact.purchasedAt>current.deactivatedAt)||current.currency!==fact.currency||current.priceMinor!==fact.amount)return review('MAPPING_OR_PRICE_MISMATCH');
    const offer=await tx.saleOffer.findUniqueOrThrow({where:{id:current.offerId}});if(offer.kind!=='MEMBERSHIP'||!offer.membershipVersionId||offer.validFrom&&fact.purchasedAt<offer.validFrom||offer.validUntil&&fact.purchasedAt>=offer.validUntil)return review('OFFER_NOT_VALID_AT_PURCHASE');
    // One pending intent per user; the latest consent preceding Apple's purchase date identifies a manual renewal.
    // Older completed intents may share the same product and 15-minute window, but must never shadow the new one.
    const candidates=await tx.$queryRaw<{id:string}[]>`SELECT o.id FROM "TradeOrder" o JOIN "PaymentAttempt" a ON a."orderId"=o.id WHERE o."userId"=${userId} AND o.kind='MEMBERSHIP' AND a.channel='APPLE_IAP' AND a."mappingId"=${current.id} AND o."createdAt"<=${fact.purchasedAt} AND o."expiresAt">=${fact.purchasedAt} AND (o."closedAt" IS NULL OR o."closedAt">=${fact.purchasedAt}) ORDER BY o."createdAt" DESC LIMIT 1`;
    if(!candidates.length)return review('PURCHASE_CONSENT_MISSING');
    await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${candidates[0]!.id} FOR UPDATE`;
    const order=await tx.tradeOrder.findUniqueOrThrow({where:{id:candidates[0]!.id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}}),snapshot=item.itemSnapshot as unknown as MembershipSnapshot,pricing=order.pricingSnapshot as {appScope:string;accountToken:string;productId:string};
    if(pricing.appScope!==row.appScope||pricing.accountToken!==fact.accountToken||pricing.productId!==fact.productId||item.membershipVersionId!==offer.membershipVersionId||snapshot.planVersionId!==offer.membershipVersionId||order.payableTotal!==fact.amount)return review('PURCHASE_CONSENT_MISMATCH');
    const duplicate=await tx.paymentTransaction.findFirst({where:{orderId:order.id,disposition:'ACCEPTED'}});
    if(duplicate)return review('PURCHASE_CONSENT_ALREADY_USED');
    const user=await tx.user.findUniqueOrThrow({where:{id:userId}}),queueValid=await this.sales.appleQueueMatches(userId,snapshot,order.createdAt,tx);
    const disposition=!await memberGiftReady(tx,item.id,item.membershipVersionId)||user.status!=='ACTIVE'||order.state!=='PENDING'&&order.closeReason!=='APPLE_INTENT_EXPIRED'||!queueValid?'REFUND_REQUIRED':'ACCEPTED';
    const attempt=await tx.paymentAttempt.findFirstOrThrow({where:{orderId:order.id,channel:'APPLE_IAP',mappingId:current.id}});
    const payment=await tx.paymentTransaction.create({data:{orderId:order.id,attemptId:attempt.id,channel:'APPLE_IAP',appScope:row.appScope,externalTransactionId:fact.transactionId,originalTransactionId:fact.originalTransactionId,amount:fact.amount,currency:fact.currency,verifiedAt:new Date(),paidAt:fact.purchasedAt,disposition,receiptHash:hash(fact)}});
    await this.post(tx,order,payment.id,'membership.payment:'+payment.id,fact.amount,true,disposition!=='ACCEPTED');
    await tx.tradeOrder.update({where:{id:order.id},data:{state:disposition==='ACCEPTED'?'COMPLETED':'CLOSED',paidAt:fact.purchasedAt,paidTotal:fact.amount,completedAt:disposition==='ACCEPTED'?new Date():null,closedAt:disposition==='ACCEPTED'?null:new Date(),closeReason:disposition==='ACCEPTED'?null:'APPLE_QUEUE_OR_ACCOUNT_REVIEW',version:{increment:1}}});
    await tx.tradeOrderItem.update({where:{id:item.id},data:{state:disposition==='ACCEPTED'?'DELIVERED':'CLOSED'}});await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED',lastQueriedAt:new Date()}});
    if(disposition==='ACCEPTED'){
      const startsAt=new Date(Math.max(fact.purchasedAt.getTime(),Date.parse(snapshot.schedule.anchor??'')||0));
      // Purchase dates and queue anchors survive delayed restoration; restoring never grants extra days.
      const member=await tx.membership.create({data:{userId,planId:snapshot.planId,planVersionId:snapshot.planVersionId,tier:snapshot.tier,startsAt,endsAt:new Date(startsAt.getTime()+snapshot.days*day),source:'PURCHASE',orderItemId:item.id,grantKey:'membership.payment:'+payment.id,revokedAt:fact.revokedAt}});await activateMemberGift(tx,member.id);
    }
    await tx.auditLog.create({data:{actorId:userId,action:'apple.membership.confirm',resource:'trade_order',resourceId:order.id,changes:{transactionId:fact.transactionId,amount:String(fact.amount),disposition,planVersionId:snapshot.planVersionId}}});
    await tx.notification.create({data:{userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'membership.paid:'+order.id,title:disposition==='ACCEPTED'?'Apple会员购买已确认':'Apple会员交易已保留核查',body:disposition==='ACCEPTED'?'原套餐版本与排队日期已保存，不自动续费；可在会员订单查看。':'本次未新增有效会员，请向Apple查询或申请退款，并联系书院核查。'}});
    return tx.appleTransactionState.update({where:{id:row.id},data:{mappingId:current.id,mappingSnapshot:safe({plan:snapshot,mappingVersion:current.version,productId:fact.productId}),paymentId:payment.id,state:disposition==='ACCEPTED'?'DELIVERED':'REVIEW',issueCode:disposition==='ACCEPTED'?null:disposition}});
  }
  private async post(tx:Prisma.TransactionClient,order:TradeOrder,paymentId:string,eventKey:string,amount:bigint,incoming:boolean,anomaly:boolean,refundId?:string){
    const journal=await tx.financeJournal.create({data:{eventKey,kind:incoming?'MEMBERSHIP_PAYMENT':'MEMBERSHIP_REFUND',orderId:order.id,transactionId:paymentId,refundId,currency:'CNY',postedAt:new Date(),description:incoming?'Apple已验证会员收款':'Apple已验证会员全额退款'}}),income=anomaly?'MEMBERSHIP_REFUND_PAYABLE':'MEMBERSHIP_REVENUE';
    await tx.financeEntry.createMany({data:[{journalId:journal.id,accountCode:incoming?'APPLE_RECEIVABLE':income,debit:amount,userId:order.userId},{journalId:journal.id,accountCode:incoming?income:'APPLE_RECEIVABLE',credit:amount,userId:order.userId}]});
  }
  async revoke(tx:Prisma.TransactionClient,row:AppleTransactionState,fact:AppleFact,userId:string){
    const payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:row.paymentId!}}),order=await tx.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}});
    const member=await tx.membership.findFirst({where:{orderItemId:item.id,source:'PURCHASE',grantKey:'membership.payment:'+payment.id}});
    if(member&&member.revokedAt?.getTime()!==fact.revokedAt?.getTime()&&(!member.revokedAt||member.revokedAt.getTime()===row.revokedAt?.getTime()))await tx.membership.update({where:{id:member.id},data:{revokedAt:fact.revokedAt,version:{increment:1}}});
    const full=fact.revocationType==='REFUND_FULL'&&(fact.revocationPercentage===null||fact.revocationPercentage===100000),existing=await tx.refund.findFirst({where:{paymentTransactionId:payment.id,reasonCode:'APPLE_REVOKED',state:'SUCCEEDED'}}),cycle=await tx.refund.findFirst({where:{paymentTransactionId:payment.id,reasonCode:'APPLE_REVOKED',state:'REVERSED',succeededAt:fact.revokedAt}});
    const reviewed=!full&&await reviewedAppleRefund(tx,row.id,fact);
    if(full&&existing&&existing.approvedAmount!==payment.amount)return tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:fact.revokedAt,state:'REVIEW',issueCode:'REFUND_CYCLE_CONFLICT'}});
    if(cycle&&!existing)return tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:fact.revokedAt,state:'REVIEW',issueCode:'REFUND_CYCLE_CONFLICT'}});
    if(full&&!existing){
      const refund=await tx.refund.create({data:{orderId:order.id,userId,requestKey:'apple.revoked:'+row.id+':'+fact.revokedAt!.getTime(),kind:'REFUND_ONLY',state:'SUCCEEDED',requestedAmount:payment.amount,approvedAmount:payment.amount,reasonCode:'APPLE_REVOKED',description:'Apple已验证会员全额退款；仅撤销原购买段，其他排队期限与独立授权保留。',paymentTransactionId:payment.id,succeededAt:fact.revokedAt}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:payment.amount,revokeQuantity:payment.disposition==='ACCEPTED'?1:0}});
      await tx.refundTransaction.create({data:{refundId:refund.id,paymentTransactionId:payment.id,channel:'APPLE_IAP',appScope:row.appScope,externalRefundId:'revocation:'+fact.transactionId+':'+fact.revokedAt!.getTime(),amount:payment.amount,currency:'CNY',verifiedAt:new Date(),succeededAt:fact.revokedAt!,receiptHash:hash(fact)}});
      await this.post(tx,order,payment.id,'membership.refunded:'+refund.id,payment.amount,false,payment.disposition!=='ACCEPTED',refund.id);
      await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:{increment:payment.amount},version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{refundedAmount:payment.amount,state:'REFUNDED'}});
      await tx.auditLog.create({data:{actorId:userId,action:'apple.membership.refund.confirm',resource:'refund',resourceId:refund.id,changes:{amount:String(payment.amount),transactionId:fact.transactionId}}});
    }
    await tx.notification.createMany({skipDuplicates:true,data:[{userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'apple.revoked:'+row.id+':'+fact.revokedAt!.getTime(),title:'Apple已撤销此次会员权益',body:full?'Apple已确认全额退款，其他已确认会员期限保持不变。':'本次购买权益已撤销；实际退款金额待Apple核查，未按比例编造退款金额。'}]});
    return tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:fact.revokedAt,state:full||reviewed?'REVOKED':'REVIEW',issueCode:full||reviewed?null:'REVOCATION_AMOUNT_REQUIRES_REVIEW'}});
  }
  async reverseRefund(tx:Prisma.TransactionClient,row:AppleTransactionState,fact:AppleFact,userId:string,revokedAt:Date){
    const payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:row.paymentId!}}),order=await tx.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}}),refunds=await tx.refund.findMany({where:{paymentTransactionId:payment.id,reasonCode:'APPLE_REVOKED',state:'SUCCEEDED'}});
    for(const refund of refunds){
      const journal=await tx.financeJournal.findUniqueOrThrow({where:{eventKey:'membership.refunded:'+refund.id}}),entries=await tx.financeEntry.findMany({where:{journalId:journal.id}});
      if(order.refundedTotal<refund.approvedAmount!||item.refundedAmount<refund.approvedAmount!||entries.length!==2||entries.reduce((s,e)=>s+e.debit-e.credit,0n)!==0n)throw new ConflictException('原会员退款与账本不一致，请财务核查');
      const reversal=await tx.financeJournal.create({data:{eventKey:'apple.refund.reversed:'+refund.id,kind:'MEMBERSHIP_REFUND_REVERSAL',orderId:order.id,transactionId:payment.id,refundId:refund.id,currency:'CNY',postedAt:fact.signedAt,reversalOfId:journal.id,description:'Apple已验证会员退款撤回；保留原分录并追加反向分录'}});
      await tx.financeEntry.createMany({data:entries.map(e=>({journalId:reversal.id,accountCode:e.accountCode,userId:e.userId,debit:e.credit,credit:e.debit}))});
      await tx.refund.update({where:{id:refund.id},data:{state:'REVERSED',version:{increment:1}}});await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:{decrement:refund.approvedAmount!},version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{refundedAmount:{decrement:refund.approvedAmount!},state:payment.disposition==='ACCEPTED'?'DELIVERED':'CLOSED'}});
      await tx.auditLog.create({data:{actorId:userId,action:'apple.membership.refund.reverse',resource:'refund',resourceId:refund.id,changes:{journalId:reversal.id,amount:String(refund.approvedAmount),signedAt:fact.signedAt.toISOString()}}});
    }
    const review=(issueCode:string)=>tx.appleTransactionState.update({where:{id:row.id},data:{state:'REVIEW',issueCode}});
    if(payment.disposition!=='ACCEPTED')return review(payment.disposition);
    if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))return review('REFUND_REVERSAL_ACCOUNT_UNAVAILABLE');
    const member=await tx.membership.findFirst({where:{orderItemId:item.id}});
    if(!member||member.source!=='PURCHASE'||member.grantKey!=='membership.payment:'+payment.id||member.revokedAt&&member.revokedAt.getTime()!==revokedAt.getTime())return review('REFUND_REVERSAL_GRANT_CONFLICT');
    if(await tx.membership.count({where:{userId,id:{not:member.id},revokedAt:null,startsAt:{lt:member.endsAt},endsAt:{gt:member.startsAt}}}))return review('REFUND_REVERSAL_PERIOD_CONFLICT');
    // Restoring this independent period keeps its original dates, even when it has already expired.
    await tx.membership.update({where:{id:member.id},data:{revokedAt:null,version:{increment:1}}});
    await tx.notification.createMany({skipDuplicates:true,data:[{userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'apple.refund.reversed:'+row.id+':'+revokedAt.getTime(),title:'Apple已撤回会员退款',body:'已恢复原会员段，原有效期、权益版本和其他排队日期保持不变。已过原有效期的套餐仍显示已到期。'}]});
    return tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:null,state:'DELIVERED',issueCode:null}});
  }
}
