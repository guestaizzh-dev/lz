import {courseReleaseWindow,courseMemberPolicy} from './course-member-benefits.js';
import {reviewedAppleRefund} from './apple-refund-state.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { AppleStoreService, type AppleFact } from './apple-store.js';
import { CourseSalesService } from './course-sales.js';
import { Database } from './database.js';
import { LearningService } from './learning.js';
import { AppleMembershipService } from './apple-membership.js';
import {Gifts} from './gifts.js';
import { Prisma, type AppleTransactionState, type TradeOrder } from './generated/prisma/client.js';

const safe=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(ordered(safe(value)))).digest('hex');
const scope=(fact:AppleFact)=>fact.bundleId+':'+fact.environment;
const refundUrl='https://reportaproblem.apple.com/';
class MappingDto {
  @IsUUID() offerId!:string;
  @IsString() @Matches(/^[\w-]+(?:\.[\w-]+)+$/) @Length(3,180) bundleId!:string;
  @IsIn(['Production','Sandbox']) environment!:string;
  @IsString() @Matches(/^[-\w.]{1,255}$/) externalProductId!:string;
  @IsInt() @Min(1) @Max(100000000) priceMinor!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class ActivationDto { @IsBoolean() active!:boolean; @IsInt() @Min(1) expectedVersion!:number; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
class PrepareDto { @IsUUID() mappingId!:string; @IsInt() @Min(1) expectedVersion!:number; @IsBoolean() accepted!:boolean; @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash?:string; @IsOptional() @IsUUID() requestKey?:string; }
class MembershipMappingDto {
  @IsUUID() planId!:string;
  @IsUUID() planVersionId!:string;
  @IsString() @Matches(/^[\w-]+(?:\.[\w-]+)+$/) @Length(3,180) bundleId!:string;
  @IsIn(['Production','Sandbox']) environment!:string;
  @IsString() @Matches(/^[-\w.]{1,255}$/) externalProductId!:string;
  @IsInt() @Min(1) @Max(100000000) priceMinor!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class RestoreDto { @IsString() @Length(10,65536) signedTransaction!:string; }
class NotificationDto { @IsString() @Length(10,131072) signedPayload!:string; }
class PageQuery { @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1; @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20; @IsOptional() @IsIn(['PENDING','DELIVERED','REVOKED','REVIEW']) state?:string; }
type MappingSnapshot={offerId:string;releaseId:string;courseId:string;title:string;cover:string;teacherName:string;format:string;accessDays:null;refundPolicy:string;price:string;productId:string;mappingVersion:number};

@Injectable()
export class AppleCommerceService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  private readonly logger=new Logger(AppleCommerceService.name);
  constructor(private readonly db:Database,private readonly apple:AppleStoreService,private readonly sales:CourseSalesService,private readonly learning:LearningService,private readonly members:AppleMembershipService,private readonly gifts:Gifts){}
  async onModuleInit(){
    if(process.env.APPLE_IAP_ENABLED!=='true')return;
    this.apple.identity();
    if(await this.db.financeAccount.count({where:{code:{in:['APPLE_RECEIVABLE','COURSE_REVENUE','COURSE_REFUND_PAYABLE']}}})!==3)throw new Error('Apple posting accounts are missing');
    if(process.env.APPLE_MEMBERSHIP_SALES_ENABLED==='true'&&await this.db.financeAccount.count({where:{code:{in:['MEMBERSHIP_REVENUE','MEMBERSHIP_REFUND_PAYABLE']}}})!==2)throw new Error('Apple membership posting accounts are missing');
    if(process.env.NODE_ENV==='production'&&process.env.COURSE_PAYMENT_WORKER_ENABLED==='false')throw new Error('Apple purchases require transaction recovery');
    if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.reconcile().catch(()=>this.logger.error('Apple recovery failed; verified transactions retained')),60000);this.timer.unref();}
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private async mappingSnapshot(offerId:string,store:Database|Prisma.TransactionClient):Promise<MappingSnapshot>{
    const offer=await store.saleOffer.findUnique({where:{id:offerId}});
    if(!offer||offer.kind!=='COURSE'||!offer.courseReleaseId||offer.currency!=='CNY'||offer.price<=0n)throw new BadRequestException('请选择真实录播课程的售卖版本');
    const release=await store.courseRelease.findUniqueOrThrow({where:{id:offer.courseReleaseId},include:{lessons:true}}),course=await store.course.findUniqueOrThrow({where:{id:release.courseId},include:{teacher:true}});
    if(release.accessDays!==null)throw new BadRequestException('非消耗型内购仅绑定长期有效课程；限期课程须另接对应订阅产品');
    if(course.isDemo||course.teacher.isDemo||course.status!=='PUBLISHED'||course.teacher.status!=='PUBLISHED'||release.withdrawnAt||!offer.active||!await this.sales.deliverable(release.lessons,course.format,store))throw new BadRequestException('示例、未发布或不可交付课程不能建立收款映射');
    return{offerId,releaseId:release.id,courseId:course.id,title:release.title,cover:course.cover,teacherName:(release.teacherSnapshot as {name?:string}).name??course.teacher.name,format:course.format,accessDays:null,refundPolicy:'由Apple审核退款；请前往Apple报告问题页面申请，书院不代替Apple批准退款。',price:String(offer.price),productId:'',mappingVersion:1};
  }
  async mappings(courseId:string){
    const offers=await this.db.saleOffer.findMany({where:{kind:'COURSE',courseReleaseId:{in:(await this.db.courseRelease.findMany({where:{courseId},select:{id:true}})).map(r=>r.id)}},orderBy:{createdAt:'desc'}});
    const releases=await this.db.courseRelease.findMany({where:{courseId},select:{id:true,version:true,title:true,accessDays:true}});
    return safe({items:await this.db.channelProductMapping.findMany({where:{channel:'APPLE_IAP',offerId:{in:offers.map(o=>o.id)}},orderBy:{createdAt:'desc'}}),offers:offers.map(o=>({...o,release:releases.find(r=>r.id===o.courseReleaseId)})),enabled:process.env.APPLE_IAP_ENABLED==='true',nativeReady:process.env.APPLE_NATIVE_PURCHASE_READY==='true'});
  }
  async createMapping(req:AuthRequest,dto:MappingDto){
    requireRoles(req,['MODERATOR']);
    if(process.env.NODE_ENV==='production'&&dto.environment!=='Production')throw new BadRequestException('正式服务不得配置沙箱收款');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "SaleOffer" WHERE id=${dto.offerId} FOR SHARE`;
      const snapshot=await this.mappingSnapshot(dto.offerId,tx);
      if(BigInt(dto.priceMinor)!==BigInt(snapshot.price))throw new BadRequestException('商店产品价格必须与所选售卖版本一致');
      const appScope=dto.bundleId+':'+dto.environment;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${appScope+':'+dto.externalProductId},0))`;
      if(await tx.channelProductMapping.findFirst({where:{channel:'APPLE_IAP',appScope,externalProductId:dto.externalProductId}}))throw new ConflictException('产品编号已绑定。旧购买版本不可改绑，请使用新的Apple产品编号');
      const row=await tx.channelProductMapping.create({data:{offerId:dto.offerId,channel:'APPLE_IAP',appScope,externalProductId:dto.externalProductId,productType:'Non-Consumable',currency:'CNY',priceMinor:BigInt(dto.priceMinor),minorExponent:2}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'apple.mapping.create',resource:'channel_product_mapping',resourceId:row.id,reason:dto.reason,changes:{offerId:dto.offerId,appScope,productId:dto.externalProductId,price:String(dto.priceMinor)}}});return safe(row);
    });
  }
  async activate(id:string,req:AuthRequest,dto:ActivationDto){
    requireRoles(req,['MODERATOR','FINANCE']);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "ChannelProductMapping" WHERE id=${id} FOR UPDATE`;
      const row=await tx.channelProductMapping.findFirst({where:{id,channel:'APPLE_IAP'}});if(!row)throw new NotFoundException('Apple产品映射不存在');
      const kind=(await tx.saleOffer.findUniqueOrThrow({where:{id:row.offerId}})).kind,member=kind==='MEMBERSHIP',gift=kind==='GIFT';if(member)requireRoles(req,['ADMIN']);if(gift)requireRoles(req,['FINANCE']);if(!gift&&!member)requireRoles(req,['MODERATOR']);
      if(row.version!==dto.expectedVersion)throw new ConflictException('产品映射已变化，请刷新');
      if(dto.active){const identity=this.apple.identity();if(identity.appScope!==row.appScope)throw new BadRequestException('产品映射与当前Apple应用环境不一致');if(member)await this.members.validateMappingOffer(row.offerId,tx);else if(gift)await this.gifts.validateAppleOffer(row.offerId,tx);else await this.mappingSnapshot(row.offerId,tx);if(row.deactivatedAt)throw new ConflictException('已停售产品保留旧交易恢复；重新售卖请配置新产品，避免停售期间收款被误授权');}
      const updated=await tx.channelProductMapping.update({where:{id},data:{active:dto.active,activatedAt:dto.active?row.activatedAt??new Date():row.activatedAt,deactivatedAt:dto.active?null:row.active?new Date():row.deactivatedAt,version:{increment:1},updatedAt:new Date()}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'apple.mapping.'+(dto.active?'activate':'disable'),resource:'channel_product_mapping',resourceId:id,reason:dto.reason,changes:{active:dto.active}}});return safe(updated);
    });
  }
  private async binding(userId:string){
    const identity=this.apple.identity();
    return this.db.$transaction(async tx=>{
      if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`).length)throw new ForbiddenException('账号不可用');
      return tx.appleAccountBinding.upsert({where:{userId_appScope:{userId,appScope:identity.appScope}},create:{userId,appScope:identity.appScope},update:{}});
    });
  }
  async prepare(userId:string,dto:PrepareDto){
    if(process.env.APPLE_NATIVE_PURCHASE_READY!=='true')throw new ServiceUnavailableException('iOS原生内购尚未验收，暂不发起购买');
    if(!dto.accepted)throw new BadRequestException('请确认课程与Apple退款说明');
    const binding=await this.binding(userId),mapping=await this.db.channelProductMapping.findFirst({where:{id:dto.mappingId,channel:'APPLE_IAP',appScope:binding.appScope,active:true}});
    if(!mapping||mapping.version!==dto.expectedVersion)throw new ConflictException('产品或价格已变化，请刷新确认');
    const kind=(await this.db.saleOffer.findUniqueOrThrow({where:{id:mapping.offerId}})).kind;if(kind==='MEMBERSHIP')return this.members.prepare(userId,binding,dto);if(kind==='GIFT')return this.gifts.prepareApple(userId,binding,dto);
    const snapshot=await this.mappingSnapshot(mapping.offerId,this.db),offer=await this.db.saleOffer.findUniqueOrThrow({where:{id:mapping.offerId}}),now=new Date();
    if((await courseReleaseWindow(this.db,await this.db.courseRelease.findUniqueOrThrow({where:{id:snapshot.releaseId}}),userId)).phase!=='PUBLIC')throw new ConflictException('新课尚未公开售卖，请先按已有权益研习或试听');
    if(offer.validFrom&&offer.validFrom>now||offer.validUntil&&offer.validUntil<=now||mapping.priceMinor!==offer.price)throw new ConflictException('此课程当前不可售，请刷新');
    const enrollment=await this.db.enrollment.findUnique({where:{userId_courseId:{userId,courseId:snapshot.courseId}}});
    if(enrollment&&!enrollment.revokedAt&&enrollment.startsAt<=now&&(!enrollment.expiresAt||enrollment.expiresAt>now))throw new ConflictException('你已拥有课程访问权，请直接研习');
    if((await this.learning.context(snapshot.courseId,userId)).access!=='TRIAL')throw new ConflictException('你已拥有课程访问权，请直接研习');
    return{productId:mapping.externalProductId,appAccountToken:binding.accountToken,environment:this.apple.identity().environment,course:snapshot,price:String(mapping.priceMinor),currency:'CNY',explanation:'价格以App Store产品查询结果为准；支付待处理时不重复购买。恢复购买须登录原书院账号。',refundUrl};
  }
  async restore(userId:string,signed:string){
    const binding=await this.binding(userId),fact=await this.apple.restore(signed,binding.accountToken);
    const row=await this.process(fact);return this.result(row,userId);
  }
  private async result(row:AppleTransactionState,userId?:string){
    const payment=row.paymentId?await this.db.paymentTransaction.findUnique({where:{id:row.paymentId}}):null;
    if(userId&&payment&&(await this.db.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}})).userId!==userId)throw new ForbiddenException('交易归属不一致');
    const gift=(row.facts as {type:string}).type==='Consumable';
    const member=(row.facts as {type:string}).type==='Non-Renewing Subscription'||!!payment&&(await this.db.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}})).kind==='MEMBERSHIP';
    return{transactionId:row.transactionId,state:row.state,issueCode:row.issueCode,orderId:payment?.orderId??null,kind:gift?'GIFT':member?'MEMBERSHIP':'COURSE',acknowledged:row.state==='DELIVERED'||row.state==='REVOKED',refundUrl,explanation:gift?(row.state==='DELIVERED'?'礼物余额已按原交易入账，不重复充值。':row.state==='REVOKED'?'Apple已撤销此笔礼物购买，余额与退款事实已留档。':'礼物交易已保留核查，请勿重复付款，可联系书院并由Apple处理退款。'):row.state==='DELIVERED'?member?'Apple交易已确认，原会员期限、排队日期和权益版本保留。':'Apple交易已确认，原购课版本和学习记录保留。':row.state==='REVOKED'?member?'Apple已撤销此交易的会员权益。':'Apple已撤销此交易的课程权益。':'交易已保留核查，请勿再次付款；可恢复购买或联系书院客服，并由Apple处理退款。'};
  }
  private async post(tx:Prisma.TransactionClient,order:TradeOrder,paymentId:string,eventKey:string,amount:bigint,incoming:boolean,anomaly:boolean,refundId?:string){
    const journal=await tx.financeJournal.create({data:{eventKey,kind:incoming?'COURSE_PAYMENT':'COURSE_REFUND',orderId:order.id,transactionId:paymentId,refundId,currency:'CNY',postedAt:new Date(),description:incoming?'Apple已验证课程收款':'Apple已验证全额退款'}}),income=anomaly?'COURSE_REFUND_PAYABLE':'COURSE_REVENUE';
    await tx.financeEntry.createMany({data:[{journalId:journal.id,accountCode:incoming?'APPLE_RECEIVABLE':income,debit:amount,userId:order.userId},{journalId:journal.id,accountCode:incoming?income:'APPLE_RECEIVABLE',credit:amount,userId:order.userId}]});
  }
  // All callers supply a current fact authenticated by AppleStoreService, never a client-decoded JSON receipt.
  async process(fact:AppleFact){
    const appScope=scope(fact),binding=await this.db.appleAccountBinding.findFirst({where:{appScope,accountToken:fact.accountToken}});
    return this.db.$transaction(async tx=>{
      if(binding)await tx.$queryRaw`SELECT id FROM "User" WHERE id=${binding.userId} FOR UPDATE`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${appScope+':'+fact.originalTransactionId},0))`;
      let row=await tx.appleTransactionState.findUnique({where:{appScope_transactionId:{appScope,transactionId:fact.transactionId}}});
      if(row){
        const prior=row.facts as {productId:string;amount:string;purchasedAt:string;type:string;currency:string};
        if(row.accountToken!==fact.accountToken||row.originalTransactionId!==fact.originalTransactionId||prior.productId!==fact.productId||prior.type!==fact.type||prior.currency!==fact.currency||prior.amount!==String(fact.amount)||prior.purchasedAt!==fact.purchasedAt.toISOString())throw new ConflictException('Apple原始交易事实不可改变');
        if(fact.signedAt<row.latestSignedAt)return tx.appleTransactionState.update({where:{id:row.id},data:{lastCheckedAt:new Date(),queryFailureCode:null}});
        if(fact.signedAt.getTime()===row.latestSignedAt.getTime()&&hash(row.facts)!==hash(fact))throw new ConflictException('同一Apple签名修订的交易事实冲突');
      }
      const oldRevoked=row?.revokedAt;
      row=row?await tx.appleTransactionState.update({where:{id:row.id},data:{facts:safe(fact),latestSignedAt:fact.signedAt,lastCheckedAt:new Date(),updatedAt:new Date(),queryFailureCode:null}}):await tx.appleTransactionState.create({data:{appScope,transactionId:fact.transactionId,originalTransactionId:fact.originalTransactionId,accountToken:fact.accountToken,facts:safe(fact),latestSignedAt:fact.signedAt,lastCheckedAt:new Date()}});
      const review=async(issueCode:string)=>tx.appleTransactionState.update({where:{id:row!.id},data:{state:'REVIEW',issueCode}});
      if(!binding)return review('ACCOUNT_NOT_BOUND');
      const owner=await tx.appleOriginalPurchase.findUnique({where:{appScope_originalTransactionId:{appScope,originalTransactionId:fact.originalTransactionId}}});
      if(owner&&owner.bindingId!==binding.id)throw new ConflictException('Apple原始交易已绑定其他账号');
      const original=owner??await tx.appleOriginalPurchase.create({data:{appScope,originalTransactionId:fact.originalTransactionId,bindingId:binding.id}});
      row=await tx.appleTransactionState.update({where:{id:row.id},data:{originalPurchaseId:original.id}});
      if(fact.type==='Consumable')return this.gifts.deliverApple(tx,row,fact,binding.userId,oldRevoked);
      if(fact.type==='Non-Renewing Subscription'){
        row=await this.members.deliver(tx,row,fact,binding.userId);
        if(!row.paymentId)return row;
        if(fact.revokedAt)return this.members.revoke(tx,row,fact,binding.userId);
        if(oldRevoked)return this.members.reverseRefund(tx,row,fact,binding.userId,oldRevoked);
        return row;
      }
      if(fact.type!=='Non-Consumable')return review('PRODUCT_TYPE_NOT_SUPPORTED');
      if(!row.paymentId){
        const mapping=await tx.channelProductMapping.findFirst({where:{channel:'APPLE_IAP',appScope,externalProductId:fact.productId}});
        if(!mapping)return review('PRODUCT_NOT_MAPPED');
        await tx.$queryRaw`SELECT id FROM "ChannelProductMapping" WHERE id=${mapping.id} FOR SHARE`;
        const current=await tx.channelProductMapping.findUniqueOrThrow({where:{id:mapping.id}});
        if(!current.activatedAt||fact.purchasedAt<current.activatedAt||!current.active&&(!current.deactivatedAt||fact.purchasedAt>current.deactivatedAt)||current.productType!==fact.type||current.currency!==fact.currency||current.priceMinor!==fact.amount)return review('MAPPING_OR_PRICE_MISMATCH');
        const offer=await tx.saleOffer.findUniqueOrThrow({where:{id:current.offerId}});
        if(!offer.courseReleaseId||offer.kind!=='COURSE'||offer.validFrom&&fact.purchasedAt<offer.validFrom||offer.validUntil&&fact.purchasedAt>=offer.validUntil)return review('OFFER_NOT_VALID_AT_PURCHASE');
        await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${offer.courseReleaseId} FOR SHARE`;
        const release=await tx.courseRelease.findUniqueOrThrow({where:{id:offer.courseReleaseId},include:{lessons:true}}),course=await tx.course.findUniqueOrThrow({where:{id:release.courseId},include:{teacher:true}});
        if(release.accessDays!==null||course.isDemo||course.teacher.isDemo)return review('DELIVERY_NOT_SUPPORTED');
        const user=await tx.user.findUniqueOrThrow({where:{id:binding.userId}}),existing=await tx.enrollment.findUnique({where:{userId_courseId:{userId:user.id,courseId:course.id}}});
        const member=await this.learning.membership(user.id,tx),memberAccess=course.status==='PUBLISHED'&&course.membershipTier!==null&&!!member&&member.contentTier>=course.membershipTier;
        const duplicate=memberAccess||!!await tx.appleTransactionState.findFirst({where:{originalPurchaseId:original.id,paymentId:{not:null},id:{not:row.id}}})||!!existing&&!existing.revokedAt&&existing.startsAt<=new Date()&&(!existing.expiresAt||existing.expiresAt>new Date());
        const policy=courseMemberPolicy(release),windowReady=!policy.publicOpenAt||fact.purchasedAt>=new Date(policy.publicOpenAt);
        const deliverable=windowReady&&!release.withdrawnAt&&await this.sales.deliverable(release.lessons,course.format,tx);
        const disposition=duplicate?'DUPLICATE':user.status!=='ACTIVE'||!deliverable?'REFUND_REQUIRED':'ACCEPTED';
        const snapshot:MappingSnapshot={offerId:offer.id,releaseId:release.id,courseId:course.id,title:release.title,cover:course.cover,teacherName:(release.teacherSnapshot as {name?:string}).name??course.teacher.name,format:course.format,accessDays:null,refundPolicy:'由Apple审核退款，请前往Apple报告问题页面申请。',price:String(fact.amount),productId:fact.productId,mappingVersion:current.version};
        const order=await tx.tradeOrder.create({data:{orderNo:'I'+randomUUID().replaceAll('-','').slice(0,31),userId:user.id,kind:'COURSE',requestKey:'apple:'+appScope+':'+fact.transactionId,requestHash:hash(snapshot),state:disposition==='ACCEPTED'?'COMPLETED':'CLOSED',currency:'CNY',subtotal:fact.amount,payableTotal:fact.amount,paidTotal:fact.amount,paidAt:fact.purchasedAt,expiresAt:fact.purchasedAt,completedAt:disposition==='ACCEPTED'?new Date():null,closedAt:disposition==='ACCEPTED'?null:new Date(),closeReason:disposition==='ACCEPTED'?null:disposition,pricingSnapshot:{platform:'IOS',channel:'APPLE_IAP',course:snapshot},quoteHash:hash(snapshot)}});
        const item=await tx.tradeOrderItem.create({data:{orderId:order.id,lineNo:1,offerId:offer.id,quantity:1,unitPrice:fact.amount,subtotal:fact.amount,payable:fact.amount,courseReleaseId:release.id,itemSnapshot:snapshot,benefitSnapshot:{},state:disposition==='ACCEPTED'?'DELIVERED':'CLOSED'}});
        const attempt=await tx.paymentAttempt.create({data:{orderId:order.id,channel:'APPLE_IAP',mappingId:current.id,requestKey:'apple.receipt:'+row.id,state:'SUCCEEDED',amount:fact.amount,currency:'CNY',expiresAt:fact.purchasedAt,lastQueriedAt:new Date()}});
        const payment=await tx.paymentTransaction.create({data:{attemptId:attempt.id,orderId:order.id,channel:'APPLE_IAP',appScope,externalTransactionId:fact.transactionId,originalTransactionId:fact.originalTransactionId,amount:fact.amount,currency:'CNY',verifiedAt:new Date(),paidAt:fact.purchasedAt,disposition,receiptHash:hash(fact)}});
        await this.post(tx,order,payment.id,'course.payment:'+payment.id,fact.amount,true,disposition!=='ACCEPTED');
        row=await tx.appleTransactionState.update({where:{id:row.id},data:{mappingId:current.id,mappingSnapshot:safe(snapshot),paymentId:payment.id,state:disposition==='ACCEPTED'?'DELIVERED':'REVIEW',issueCode:disposition==='ACCEPTED'?null:disposition}});
        if(disposition==='ACCEPTED'&&!fact.revokedAt){
          const grant={releaseId:release.id,source:'PURCHASE',orderItemId:item.id,grantKey:'course.payment:'+payment.id,startsAt:fact.purchasedAt,expiresAt:null,revokedAt:null,startedAt:null,grantActorId:null,grantReason:null};
          await tx.enrollment.upsert({where:{userId_courseId:{userId:user.id,courseId:course.id}},create:{userId:user.id,courseId:course.id,...grant},update:{...grant,version:{increment:1}}});
          await tx.notification.create({data:{userId:user.id,kind:'COURSE_ORDER',orderId:order.id,eventKey:'course.paid:'+order.id,title:'Apple购买已恢复至研习',body:'已确认原购买版本，学习记录保留；退款由Apple审核。'}});
        }
        await tx.auditLog.create({data:{actorId:user.id,action:'apple.purchase.confirm',resource:'trade_order',resourceId:order.id,changes:{transactionId:fact.transactionId,amount:String(fact.amount),disposition}}});
      }
      if(fact.revokedAt){await this.revoke(tx,row,fact,binding.userId);return tx.appleTransactionState.findUniqueOrThrow({where:{id:row.id}});}
      if(oldRevoked){await this.reverseRefund(tx,row,fact,binding.userId,oldRevoked);return tx.appleTransactionState.findUniqueOrThrow({where:{id:row.id}});}
      return row;
    },{timeout:20000});
  }
  private async revoke(tx:Prisma.TransactionClient,row:AppleTransactionState,fact:AppleFact,userId:string){
    const payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:row.paymentId!}}),order=await tx.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}});
    await tx.enrollment.updateMany({where:{userId,orderItemId:item.id,source:'PURCHASE',grantKey:'course.payment:'+payment.id,OR:[{revokedAt:null},...(row.revokedAt?[{revokedAt:row.revokedAt}]:[])]},data:{revokedAt:fact.revokedAt,version:{increment:1}}});
    const full=fact.revocationType==='REFUND_FULL'&&(fact.revocationPercentage===null||fact.revocationPercentage===100000);
    const existing=await tx.refund.findFirst({where:{paymentTransactionId:payment.id,reasonCode:'APPLE_REVOKED',state:'SUCCEEDED'}});
    const reviewed=!full&&await reviewedAppleRefund(tx,row.id,fact);
    if(full&&existing&&existing.approvedAmount!==payment.amount){await tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:fact.revokedAt,state:'REVIEW',issueCode:'REFUND_CYCLE_CONFLICT'}});return;}

    const reversedCycle=await tx.refund.findFirst({where:{paymentTransactionId:payment.id,reasonCode:'APPLE_REVOKED',state:'REVERSED',succeededAt:fact.revokedAt}});
    if(reversedCycle&&!existing){
      await tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:fact.revokedAt,state:'REVIEW',issueCode:'REFUND_CYCLE_CONFLICT'}});return;
    }
    if(full&&!existing){
      const refund=await tx.refund.create({data:{orderId:order.id,userId,requestKey:'apple.revoked:'+row.id+':'+fact.revokedAt!.getTime(),kind:'REFUND_ONLY',state:'SUCCEEDED',requestedAmount:payment.amount,approvedAmount:payment.amount,reasonCode:'APPLE_REVOKED',description:'Apple已签名确认全额退款；撤销原购买权益，其他授予保留。',paymentTransactionId:payment.id,succeededAt:fact.revokedAt}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:payment.amount,revokeQuantity:payment.disposition==='ACCEPTED'?1:0}});
      await tx.refundTransaction.create({data:{refundId:refund.id,paymentTransactionId:payment.id,channel:'APPLE_IAP',appScope:row.appScope,externalRefundId:'revocation:'+fact.transactionId+':'+fact.revokedAt!.getTime(),amount:payment.amount,currency:'CNY',verifiedAt:new Date(),succeededAt:fact.revokedAt!,receiptHash:hash(fact)}});
      await this.post(tx,order,payment.id,'course.refunded:'+refund.id,payment.amount,false,payment.disposition!=='ACCEPTED',refund.id);
      await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:{increment:payment.amount},version:{increment:1}}});
      await tx.tradeOrderItem.update({where:{id:item.id},data:{refundedAmount:payment.amount,state:'REFUNDED'}});
      await tx.auditLog.create({data:{actorId:userId,action:'apple.refund.confirm',resource:'refund',resourceId:refund.id,changes:{transactionId:fact.transactionId,amount:String(payment.amount)}}});
    }
    await tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:fact.revokedAt,state:full||reviewed?'REVOKED':'REVIEW',issueCode:full||reviewed?null:'REVOCATION_AMOUNT_REQUIRES_REVIEW'}});
    await tx.notification.createMany({skipDuplicates:true,data:[{userId,kind:'COURSE_ORDER',orderId:order.id,eventKey:'apple.revoked:'+row.id+':'+fact.revokedAt!.getTime(),title:'Apple已撤销购课权益',body:full?'Apple已确认全额退款，请查看原支付账户。':'购课权益已按Apple通知撤销；退款金额仍待核查，请向Apple查询并联系书院客服。'}]});
  }
  private async reverseRefund(tx:Prisma.TransactionClient,row:AppleTransactionState,fact:AppleFact,userId:string,revokedAt:Date){
    const payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:row.paymentId!}}),order=await tx.tradeOrder.findUniqueOrThrow({where:{id:payment.orderId}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}});
    const refunds=await tx.refund.findMany({where:{paymentTransactionId:payment.id,reasonCode:'APPLE_REVOKED',state:'SUCCEEDED'}});
    for(const refund of refunds){
      const journal=await tx.financeJournal.findUniqueOrThrow({where:{eventKey:'course.refunded:'+refund.id}}),entries=await tx.financeEntry.findMany({where:{journalId:journal.id}});
      if(order.refundedTotal<refund.approvedAmount!||item.refundedAmount<refund.approvedAmount!||entries.length!==2||entries.reduce((sum,e)=>sum+e.debit-e.credit,0n)!==0n)throw new ConflictException('原退款与账本不一致，已保留交易等待财务核查');
      const reversal=await tx.financeJournal.create({data:{eventKey:'apple.refund.reversed:'+refund.id,kind:'COURSE_REFUND_REVERSAL',orderId:order.id,transactionId:payment.id,refundId:refund.id,currency:journal.currency,postedAt:fact.signedAt,reversalOfId:journal.id,description:'Apple已验证撤回退款；原退款事实保留，新增反向分录'}});
      await tx.financeEntry.createMany({data:entries.map(e=>({journalId:reversal.id,accountCode:e.accountCode,partnerId:e.partnerId,userId:e.userId,debit:e.credit,credit:e.debit}))});
      await tx.refund.update({where:{id:refund.id},data:{state:'REVERSED',version:{increment:1},updatedAt:new Date()}});
      await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:{decrement:refund.approvedAmount!},version:{increment:1}}});
      await tx.tradeOrderItem.update({where:{id:item.id},data:{refundedAmount:{decrement:refund.approvedAmount!},state:payment.disposition==='ACCEPTED'?'DELIVERED':'CLOSED'}});
      await tx.auditLog.create({data:{actorId:userId,action:'apple.refund.reverse',resource:'refund',resourceId:refund.id,changes:{transactionId:fact.transactionId,amount:String(refund.approvedAmount),journalId:reversal.id,receiptHash:hash(fact),signedAt:fact.signedAt.toISOString()}}});
    }
    const review=async(issueCode:string)=>tx.appleTransactionState.update({where:{id:row.id},data:{state:'REVIEW',issueCode}});
    if(payment.disposition!=='ACCEPTED')return review(payment.disposition);
    const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
    if(user.status!=='ACTIVE')return review('REFUND_REVERSAL_ACCOUNT_UNAVAILABLE');
    await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${item.courseReleaseId!} FOR SHARE`;
    const release=await tx.courseRelease.findUniqueOrThrow({where:{id:item.courseReleaseId!},include:{lessons:true}}),course=await tx.course.findUniqueOrThrow({where:{id:release.courseId}});
    if(release.withdrawnAt||!await this.sales.deliverable(release.lessons,course.format,tx))return review('REFUND_REVERSAL_DELIVERY_UNAVAILABLE');
    const grant=await tx.enrollment.findUnique({where:{userId_courseId:{userId,courseId:course.id}}}),grantKey='course.payment:'+payment.id;
    // A different grant or an independent admin revocation must never be overwritten by Apple recovery.
    if(grant&&(grant.source!=='PURCHASE'||grant.orderItemId!==item.id||grant.grantKey!==grantKey||grant.revokedAt&&grant.revokedAt.getTime()!==revokedAt.getTime()))return review('REFUND_REVERSAL_GRANT_CONFLICT');
    if(grant)await tx.enrollment.update({where:{id:grant.id},data:{revokedAt:null,version:{increment:1}}});
    else await tx.enrollment.create({data:{userId,courseId:course.id,releaseId:release.id,source:'PURCHASE',orderItemId:item.id,grantKey,startsAt:fact.purchasedAt,expiresAt:null}});
    await tx.appleTransactionState.update({where:{id:row.id},data:{revokedAt:null,state:'DELIVERED',issueCode:null}});
    await tx.notification.createMany({skipDuplicates:true,data:[{userId,kind:'COURSE_ORDER',orderId:order.id,eventKey:'apple.refund.reversed:'+row.id+':'+revokedAt.getTime(),title:'Apple已撤回退款，研习权益恢复',body:'已恢复原购买课程，学习记录与开始时间保留。退款和撤回记录均可在原订单查看。'}]});
  }
  async notify(signed:string){
    const event=await this.apple.notification(signed),appScope=this.apple.identity().appScope;
    const callback=await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${appScope+':'+event.id},0))`;
      const old=await tx.providerCallback.findFirst({where:{provider:'APPLE_IAP',appScope,externalEventId:event.id}});
      if(old){if(old.payloadHash!==event.payloadHash)throw new ConflictException('Apple通知编号对应不同签名载荷');return old;}
      return tx.providerCallback.create({data:{provider:'APPLE_IAP',appScope,externalEventId:event.id,kind:event.kind,payloadHash:event.payloadHash,payloadStorageRef:event.fact?'apple-server://transaction/'+event.fact.transactionId:'apple-server://test/'+event.id,signatureVerified:true,state:'PROCESSING'}});
    });
    if(event.fact)await this.process(event.fact);
    await this.db.providerCallback.update({where:{id:callback.id},data:{state:'HANDLED',handledAt:new Date(),attempts:{increment:1}}});
  }
  async receipts(q:PageQuery){
    const where=q.state?{state:q.state}:{};
    const [rows,total]=await this.db.$transaction([this.db.appleTransactionState.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),this.db.appleTransactionState.count({where})]);
    return{items:await Promise.all(rows.map(async r=>({...await this.result(r),id:r.id,appScope:r.appScope,productId:(r.facts as {productId:string}).productId,amount:(r.facts as {amount:string}).amount,latestSignedAt:r.latestSignedAt,lastCheckedAt:r.lastCheckedAt,queryFailureCode:r.queryFailureCode}))),total};
  }
  async refresh(id:string,userId?:string){
    const row=await this.db.appleTransactionState.findUnique({where:{id}});if(!row)throw new NotFoundException('Apple交易不存在');
    if(userId){const owner=await this.db.appleAccountBinding.findFirst({where:{userId,appScope:row.appScope,accountToken:row.accountToken}});if(!owner)throw new NotFoundException('Apple交易不存在');}
    if(row.appScope!==this.apple.identity().appScope)throw new ConflictException('交易环境与当前Apple配置不一致');
    const fact=await this.apple.latest(row.transactionId);return this.result(await this.process(fact),userId);
  }
  async refreshOrder(orderId:string,userId:string){
    const row=await this.db.appleTransactionState.findFirst({where:{paymentId:{in:(await this.db.paymentTransaction.findMany({where:{orderId,channel:'APPLE_IAP'},select:{id:true}})).map(p=>p.id)}}});
    if(!row)throw new NotFoundException('Apple交易尚未确认，请在原账号恢复购买');return this.refresh(row.id,userId);
  }
  async reconcile(){
    if(this.working||process.env.APPLE_IAP_ENABLED!=='true')return;this.working=true;
    try{
      const rows=await this.db.appleTransactionState.findMany({where:{appScope:this.apple.identity().appScope,lastCheckedAt:{lt:new Date(Date.now()-6*3600000)}},orderBy:{lastCheckedAt:'asc'},take:10});
      for(const row of rows)try{await this.refresh(row.id);}catch{await this.db.appleTransactionState.updateMany({where:{id:row.id,lastCheckedAt:row.lastCheckedAt},data:{lastCheckedAt:new Date(),queryFailureCode:'APPLE_QUERY_RETRY'}});}
    }finally{this.working=false;}
  }
}

@Controller('commerce/apple') @UseGuards(UserGuard) export class AppleCommerceController {
  constructor(private readonly apple:AppleCommerceService,private readonly members:AppleMembershipService){}
  @Get('memberships/:id/quote') quote(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.members.quote(id,req.actor.id);}
  @Post('prepare') prepare(@Req() req:AuthRequest,@Body() dto:PrepareDto){return this.apple.prepare(req.actor.id,dto);}
  @Post('restore') restore(@Req() req:AuthRequest,@Body() dto:RestoreDto){return this.apple.restore(req.actor.id,dto.signedTransaction);}
}
@Controller('admin/apple-memberships') @UseGuards(AdminGuard) export class AppleMembershipProductsController {
  constructor(private readonly members:AppleMembershipService,private readonly apple:AppleCommerceService){}
  @Get(':id') mappings(@Param('id',ParseUUIDPipe) id:string){return this.members.mappings(id);}
  @Post() create(@Req() req:AuthRequest,@Body() dto:MembershipMappingDto){return this.members.createMapping(req,dto);}
  @Post(':id/activation') activate(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ActivationDto){requireRoles(req,['ADMIN']);return this.apple.activate(id,req,dto);}
}
@Controller('payments/apple') export class AppleCallbackController {
  constructor(private readonly apple:AppleCommerceService){}
  @Post('notify') @HttpCode(200) async notify(@Body() dto:NotificationDto){await this.apple.notify(dto.signedPayload);}
}
@Controller('admin/apple-products') @UseGuards(AdminGuard) export class AppleProductsController {
  constructor(private readonly apple:AppleCommerceService){}
  @Get('courses/:id') mappings(@Param('id',ParseUUIDPipe) id:string){return this.apple.mappings(id);}
  @Post() create(@Req() req:AuthRequest,@Body() dto:MappingDto){return this.apple.createMapping(req,dto);}
  @Post(':id/activation') activate(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ActivationDto){return this.apple.activate(id,req,dto);}
}
@Controller('admin/apple-transactions') @UseGuards(AdminGuard) export class AppleTransactionsController {
  constructor(private readonly apple:AppleCommerceService){}
  @Get() list(@Query() q:PageQuery){return this.apple.receipts(q);}
  @Post(':id/refresh') refresh(@Param('id',ParseUUIDPipe) id:string){return this.apple.refresh(id);}
}
