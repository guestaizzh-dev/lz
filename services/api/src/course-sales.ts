import {consumptionPolicy} from './consumption-policy.js';
import {courseMemberPrice,courseMemberPriceReady,freezeCourseMemberPrice,finishCourseMemberPrice,courseReleaseWindow} from './course-member-benefits.js';
import {Charity,publicCharityPrice,type CharityPrice} from './charity.js';
import {Referrals} from './referrals.js';
import {GroupPurchases} from './group-purchases.js';
import {MarketingService,marketingHash} from './marketing.js';
import { demoScope } from './public-content.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { LearningService } from './learning.js';
import { Prisma, type TradeOrder, type Lesson } from './generated/prisma/client.js';
import type { WechatTransaction, WechatRefund } from './wechat-pay.js';
import { PaymentChannels, type AppPaymentChannel } from './payment-channels.js';
import { ModuleRef } from '@nestjs/core';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const now=()=>new Date();
class QuoteQuery { @IsOptional() @IsUUID() groupOfferId?:string; @IsOptional() @IsUUID() groupId?:string; @IsIn(['ANDROID','IOS','WEB']) platform='WEB'; @IsOptional() @IsIn(['WECHAT_APP','ALIPAY_APP','SIMULATED']) channel:AppPaymentChannel='WECHAT_APP'; }
class CheckoutDto extends QuoteQuery { @IsUUID() courseId!:string; @IsUUID() requestKey!:string; @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash!:string; }
class OrderPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsIn(['PENDING','COMPLETED','CLOSED']) state?:string;
  @IsOptional() @IsString() @Length(0,80) q?:string;
}
class RefundDto { @IsUUID() requestKey!:string; @IsString() @Length(2,1000) @Matches(/\S/) reason!:string; }
class RefundReviewDto { @IsInt() @Min(1) expectedVersion!:number; @IsIn(['APPROVE','REJECT','RETRY']) action!:string; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }

@Injectable()
export class CourseSalesService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  private readonly logger=new Logger(CourseSalesService.name);
  constructor(private readonly db:Database,private readonly learning:LearningService,private readonly channels:PaymentChannels,private readonly moduleRef:ModuleRef,private readonly marketing:MarketingService,private readonly groups:GroupPurchases,private readonly referrals:Referrals,private readonly charity:Charity){}
  async onModuleInit(){
    const enabled=this.channels.choices().filter(c=>c.enabled);
    for(const [flag,channel] of [['COURSE_WECHAT_ENABLED','WECHAT_APP'],['COURSE_ALIPAY_ENABLED','ALIPAY_APP']])if(process.env[flag!]==='true')this.channels.resolve(channel!).identity();
    if(enabled.length){
      const codes=['COURSE_REVENUE','COURSE_REFUND_PAYABLE',...enabled.map(c=>c.channel==='ALIPAY_APP'?'ALIPAY_RECEIVABLE':'WECHAT_RECEIVABLE')];
      if(await this.db.financeAccount.count({where:{code:{in:codes}}})!==codes.length)throw new Error('Course payment posting accounts are missing; apply migrations before enabling sales');
      if(process.env.NODE_ENV==='production'&&process.env.COURSE_PAYMENT_WORKER_ENABLED==='false')throw new Error('Production course payments require the recovery worker');
    }
    if(process.env.COURSE_PAYMENT_WORKER_ENABLED!=='false'&&process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runJobs().catch(()=>this.logger.error('Course recovery worker failed; durable jobs remain queued')),20000);this.timer.unref();}
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private async lock(tx:Prisma.TransactionClient,order:Pick<TradeOrder,'id'|'userId'>){
    await this.groups.lock(tx,order.id);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${order.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${order.id} FOR UPDATE`;
  }
  async deliverable(lessons:Lesson[],format:string,store:Prisma.TransactionClient|Database){
    const mediaLessons=lessons.filter(l=>['VIDEO','AUDIO'].includes(l.format));
    if(format==='LIVE'){
      const liveLessons=lessons.filter(l=>l.format==='LIVE');
      if(!liveLessons.length||liveLessons.some(l=>!l.liveSessionId||l.trial||!l.durationSeconds))return false;
      const sessions=await store.liveSession.findMany({where:{id:{in:liveLessons.map(l=>l.liveSessionId!)}}});
      if(liveLessons.some(l=>!sessions.some(s=>s.id===l.liveSessionId&&['SCHEDULED','PREPARING','LIVE','REPLAY_READY'].includes(s.state))))return false;
      for(const session of sessions){
        if(session.state==='SCHEDULED'&&session.scheduledAt<new Date())return false;
        if(!await store.resource.findFirst({where:{id:session.roomId,publishState:'PUBLISHED'}}))return false;
        const release=await store.courseRelease.findUniqueOrThrow({where:{id:lessons[0]!.releaseId}}),rule=session.accessRuleSnapshot as {mode?:string;courseId?:string;lessonBound?:boolean};
        if(rule.mode!=='COURSE'||rule.courseId!==release.courseId||!rule.lessonBound)return false;
        if(session.state==='REPLAY_READY'&&!await store.liveReplay.findFirst({where:{sessionId:session.id,reviewState:'APPROVED',publishedAt:{not:null},reviewerId:{not:null}}}))return false;}
    }else if(!mediaLessons.some(l=>!l.trial&&l.format===format))return false;
    const assets=await store.mediaAsset.findMany({where:{id:{in:mediaLessons.map(l=>l.mediaId??'')},status:'READY'}});
    if(mediaLessons.some(l=>!l.durationSeconds||!assets.some(a=>a.id===l.mediaId&&a.mime.startsWith(l.format==='VIDEO'?'video/':'audio/'))))return false;
    const root=resolve(process.env.MEDIA_DIR??'.media');
    const files=await Promise.all(assets.map(async a=>{const path=resolve(root,a.storageKey);if(!path.startsWith(root+sep))return false;try{const file=await stat(path);return file.isFile()&&BigInt(file.size)===BigInt(a.bytes)&&file.size>0;}catch{return false;}}));
    return files.every(Boolean);
  }
  private async sale(courseId:string,store:Prisma.TransactionClient|Database=this.db,allowDemo=false){
    const visibility = allowDemo ? await demoScope(store) : { isDemo: false };
    const course=await store.course.findFirst({where:{id:courseId,status:'PUBLISHED',...visibility,teacher:{status:'PUBLISHED',...visibility}},include:{teacher:true}});
    if(!course?.publishedReleaseId||!['VIDEO','AUDIO','LIVE'].includes(course.format))throw new NotFoundException('课程尚未开放售卖');
    const release=await store.courseRelease.findUniqueOrThrow({where:{id:course.publishedReleaseId},include:{lessons:{orderBy:{position:'asc'}}}});
    if(release.withdrawnAt)throw new NotFoundException('该课程版本已停止交付，暂不收取费用');
    const offer=await store.saleOffer.findFirst({where:{kind:'COURSE',courseReleaseId:release.id,active:true,currency:'CNY',AND:[{OR:[{validFrom:null},{validFrom:{lte:now()}}]},{OR:[{validUntil:null},{validUntil:{gt:now()}}]}]},orderBy:[{createdAt:'desc'},{id:'desc'}]});
    if(!offer||offer.price<=0n||offer.price>100000000n)throw new BadRequestException('此课程请从详情加入研习，或等待书院开放售卖');
    const deliveryReady=await this.deliverable(release.lessons,course.format,store);
    const snapshot={courseId,releaseId:release.id,title:release.title,cover:course.cover,teacherName:(release.teacherSnapshot as {name?:string})?.name??course.teacher.name,format:course.format,contentFormats:['TEXT','AUDIO','VIDEO','LIVE'].filter(format=>release.lessons.some(lesson=>lesson.format===format)),lessons:release.lessons.length,durationSeconds:release.lessons.reduce((sum,l)=>sum+l.durationSeconds,0),accessDays:release.accessDays,refundPolicy:(release.refundPolicySnapshot as {text?:string})?.text??course.refundPolicy,refundDays:7};
    // Live state and version change while the buyer is on the quote page and are not part of what is sold; keep the quote stable.
    const liveSessions=course.format==='LIVE'?await store.liveSession.findMany({where:{id:{in:release.lessons.flatMap(l=>l.liveSessionId?[l.liveSessionId]:[])}},select:{id:true,title:true,scheduledAt:true},orderBy:[{scheduledAt:'asc'},{id:'asc'}]}):[];
    const quotedSnapshot={...snapshot,...(course.format==='LIVE'?{liveSessions}:{} )};
    const quoteHash=hash({consumptionRule:consumptionPolicy,offerId:offer.id,version:offer.version,price:String(offer.price),snapshot:quotedSnapshot});
    return{course,release,offer,snapshot:quotedSnapshot,quoteHash,deliveryReady};
  }
  private async price(sale:Awaited<ReturnType<CourseSalesService['sale']>>,store:Database|Prisma.TransactionClient,userId:string|undefined,platform:string,channel:string,selection:{groupOfferId?:string;groupId?:string}){
    const group=await this.groups.price(store,sale.offer.id,sale.offer.price,platform,selection);
    let pricing=group?{payable:BigInt(group.price),discount:sale.offer.price-BigInt(group.price),coupon:null}:await this.marketing.coursePrice(store,userId,sale.course.id,sale.offer.price,platform,channel);
    const candidate=group?null:await courseMemberPrice(store,userId,sale.release,sale.offer.id,sale.offer.price,platform);
    let memberBenefit=candidate&&sale.offer.price-BigInt(candidate.savings)<pricing.payable?candidate:null;
    if(memberBenefit)pricing={payable:sale.offer.price-BigInt(memberBenefit.savings),discount:BigInt(memberBenefit.savings),coupon:null};
    const candidateCharity=group?null:await this.charity.price(store,userId,'COURSE',sale.release.id,sale.offer.price,platform),charitable=candidateCharity&&BigInt(candidateCharity.price)<pricing.payable?candidateCharity:null;
    if(charitable){pricing={payable:BigInt(charitable.price),discount:sale.offer.price-BigInt(charitable.price),coupon:null};memberBenefit=null;}
    const quoteHash=charitable?marketingHash({base:sale.quoteHash,charity:charitable}):group?marketingHash({base:sale.quoteHash,group}):memberBenefit?marketingHash({base:sale.quoteHash,memberBenefit}):pricing.coupon?marketingHash({base:sale.quoteHash,pricing}):sale.quoteHash;
    return{group,pricing,charitable,memberBenefit,quoteHash};
  }
  async quote(courseId:string,platform:string,userId?:string,channel='WECHAT_APP',selection:{groupOfferId?:string;groupId?:string}={}){
    const sale=await this.sale(courseId,this.db,true),access=userId?await this.learning.context(courseId,userId):null,channels=this.channels.choices(),demo=sale.course.isDemo||sale.course.teacher.isDemo;
    const rows=userId?await this.db.$queryRaw<{id:string}[]>`SELECT o.id FROM "TradeOrder" o JOIN "TradeOrderItem" i ON i."orderId"=o.id JOIN "CourseRelease" r ON r.id=i."courseReleaseId" WHERE o."userId"=${userId} AND o.kind='COURSE' AND o.state='PENDING' AND r."courseId"=${courseId} ORDER BY o."createdAt" DESC LIMIT 1`:[];
    let paymentEnabled=platform==='ANDROID'&&channels.some(c=>c.enabled)&&sale.deliveryReady&&!demo;
    const {group,charitable,pricing,quoteHash,memberBenefit}=await this.price(sale,this.db,userId,platform,channel,selection);
    const window=await courseReleaseWindow(this.db,sale.release,userId);
    paymentEnabled=paymentEnabled&&window.phase==='PUBLIC';
    paymentEnabled=paymentEnabled&&pricing.payable>0n;
    return{...sale.snapshot,memberBenefit,window,charity:publicCharityPrice(charitable),group,groupOptions:await this.groups.options(sale.release.id),originalPrice:String(sale.offer.price),discount:String(pricing.discount),coupon:pricing.coupon,price:String(pricing.payable),currency:'CNY',quoteHash,alreadyAccessible:access?.access!=='TRIAL'&&!!access,pendingOrderId:rows[0]?.id??null,paymentEnabled,channels:channels.map(c=>({...c,enabled:c.enabled&&paymentEnabled})),unavailableReason:window.phase!=='PUBLIC'?'新课尚未公开售卖，可按已有会员权益提前研习或先试听。':charitable&&pricing.payable===0n?'公益资格可免费领取，请前往公益研习确认，无需付款。':demo?'示例课程仅供预览，不会发起真实收款。':!sale.deliveryReady?'付费课件尚未准备完成，暂不收取费用。':platform==='IOS'?'iOS课程内购尚未开放，请继续试听或学习已有课程。':platform==='WEB'?'请在Android App内完成课程购买。':paymentEnabled?'':'课程支付尚未开放，请先试听或查看已有课程。'};
  }
  async checkout(userId:string,dto:CheckoutDto){
    if(dto.platform!=='ANDROID')throw new BadRequestException('当前仅开放Android App课程支付，iOS须使用内购');
    const channel=dto.channel??'WECHAT_APP';this.channels.resolve(channel).identity();
    const requestHash=hash({courseId:dto.courseId,quoteHash:dto.quoteHash,platform:dto.platform,...(dto.groupId?{groupId:dto.groupId}:{}),...(dto.groupOfferId?{groupOfferId:dto.groupOfferId}:{}),...(channel==='ALIPAY_APP'?{channel}:{})});
    const row=await this.db.$transaction(async tx=>{
      if(dto.groupId)await tx.$queryRaw`SELECT id FROM "GroupBuy" WHERE id=${dto.groupId} FOR UPDATE`;
      const users=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`;
      if(!users.length)throw new ForbiddenException('账号不可用，请重新登录');
      const existing=await tx.tradeOrder.findFirst({where:{userId,requestKey:dto.requestKey}});
      if(existing){if(existing.requestHash!==requestHash||existing.kind!=='COURSE')throw new ConflictException('下单标识已用于其他操作');return existing;}
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id=${dto.courseId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "SaleOffer" WHERE "courseReleaseId"=(SELECT "publishedReleaseId" FROM "Course" WHERE id=${dto.courseId}) FOR SHARE`;
      const sale=await this.sale(dto.courseId,tx);
      if(!sale.deliveryReady)throw new BadRequestException('课程课件暂不可用，暂不收取费用');
      const {group,charitable,pricing,quoteHash,memberBenefit}=await this.price(sale,tx,userId,dto.platform,channel,dto);
      if((await courseReleaseWindow(tx,sale.release,userId)).phase!=='PUBLIC')throw new ConflictException('新课尚未公开售卖，可按已有会员权益提前研习或先试听');
      if(pricing.payable===0n)throw new BadRequestException('公益免费资格请前往公益研习确认领取，无需付款');
      if(dto.quoteHash!==quoteHash)throw new ConflictException('价格或课程版本已更新，请刷新后确认');
      const context=await this.learning.context(dto.courseId,userId,tx);
      if(context.access!=='TRIAL')throw new ConflictException('你已拥有课程访问权，请直接开始学习');
      const pending=await tx.$queryRaw<{id:string;quoteHash:string}[]>`SELECT o.id,o."quoteHash" FROM "TradeOrder" o JOIN "TradeOrderItem" i ON i."orderId"=o.id JOIN "CourseRelease" r ON r.id=i."courseReleaseId" WHERE o."userId"=${userId} AND o.kind='COURSE' AND o.state='PENDING' AND r."courseId"=${dto.courseId} LIMIT 1`;
      if(pending.length){if(pending[0]!.quoteHash!==dto.quoteHash)throw new ConflictException('请先处理该课程的待支付订单');return tx.tradeOrder.findUniqueOrThrow({where:{id:pending[0]!.id}});}
      const order=await tx.tradeOrder.create({data:{orderNo:'C'+randomUUID().replaceAll('-','').slice(0,31),userId,kind:'COURSE',requestKey:dto.requestKey,requestHash,currency:'CNY',subtotal:sale.offer.price,discountTotal:pricing.discount,payableTotal:pricing.payable,pricingSnapshot:{platform:'ANDROID',channel,course:sale.snapshot,coupon:pricing.coupon,group,charity:charitable,memberBenefit},quoteHash,expiresAt:new Date(Math.min(Date.now()+15*60000,pricing.coupon?Date.parse(pricing.coupon.expiresAt):Infinity,group?Date.parse(group.endsAt):Infinity,memberBenefit?Date.parse(memberBenefit.endsAt):Infinity,charitable?Date.parse(charitable.endsAt):Infinity))}});
      const item=await tx.tradeOrderItem.create({data:{orderId:order.id,lineNo:1,offerId:sale.offer.id,quantity:1,unitPrice:sale.offer.price,subtotal:sale.offer.price,discountAllocated:pricing.discount,payable:pricing.payable,itemSnapshot:sale.snapshot,benefitSnapshot:{},state:'PENDING',courseReleaseId:sale.release.id}});
      await freezeCourseMemberPrice(tx,userId,order.id,memberBenefit);
      await this.charity.freeze(tx,userId,item.id,charitable);if(!charitable)await this.referrals.freeze(tx,userId,item.id,dto.courseId);
      if(group)await this.groups.reserve(tx,userId,item,group);
      await this.marketing.freeze(tx,userId,order.id,pricing.coupon);
      await tx.outboxJob.create({data:{eventKey:'course.expire:'+order.id,kind:'COURSE_PAYMENT_CHECK',aggregateType:'COURSE_ORDER',aggregateId:order.id,payload:{},availableAt:order.expiresAt}});
      await tx.auditLog.create({data:{actorId:userId,action:'course.order.create',resource:'trade_order',resourceId:order.id,changes:{releaseId:sale.release.id,amount:String(sale.offer.price)}}});return order;
    });
    return this.detail(row.id,userId);
  }
  private async owned(id:string,userId:string){const row=await this.db.tradeOrder.findFirst({where:{id,userId,kind:'COURSE'}});if(!row)throw new NotFoundException('课程订单不存在');return row;}
  async detail(id:string,userId:string){
    const order=await this.owned(id,userId),item=await this.db.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),refunds=await this.db.refund.findMany({where:{orderId:id},orderBy:{createdAt:'desc'}}),payment=await this.db.paymentTransaction.findFirst({where:{orderId:id,disposition:'ACCEPTED'}}),enrollment=await this.db.enrollment.findFirst({where:{userId,orderItemId:item.id}});
    const pending=refunds.some(r=>r.paymentTransactionId===payment?.id&&!['REJECTED','CANCELLED'].includes(r.state));
    const started=!!(item.benefitSnapshot as {startedAt?:string}).startedAt||!!enrollment?.startedAt;
    const deliveryRelease=enrollment?await this.db.courseRelease.findUnique({where:{id:enrollment.releaseId}}):null;
    const withdrawn=!!deliveryRelease?.withdrawnAt&&enrollment?.source==='PURCHASE'&&!enrollment.revokedAt&&(!enrollment.expiresAt||enrollment.expiresAt>deliveryRelease!.withdrawnAt!);
    const applePayment=payment?.channel==='APPLE_IAP';
    const refundable=!applePayment&&!!payment&&order.refundedTotal===0n&&!pending&&(withdrawn||Date.now()-payment.paidAt.getTime()<=7*86400000&&!started);
    const attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}}),channel=(order.pricingSnapshot as {channel?:AppPaymentChannel}).channel??'WECHAT_APP';
    const checked=!attempt||!!attempt.lastQueriedAt&&attempt.lastQueriedAt>=attempt.updatedAt&&!attempt.failureCode;
    const course=await this.db.course.findUnique({where:{id:(item.itemSnapshot as {courseId:string}).courseId},include:{teacher:true}});
    const saleReady=!!course&&course.status==='PUBLISHED'&&course.teacher.status==='PUBLISHED'&&!course.isDemo&&!course.teacher.isDemo;
    const canPay=await courseMemberPriceReady(this.db,order)&&await this.charity.ready(this.db,order.id)&&await this.groups.canPay(this.db,item.id)&&order.state==='PENDING'&&order.expiresAt>now()&&checked&&saleReady&&this.channels.resolve(channel).availability().enabled;
    const paymentStatus=order.state!=='PENDING'?order.state:order.expiresAt<=now()?'EXPIRED':!checked?'CHECK_REQUIRED':canPay?'READY':'UNAVAILABLE';
    const groupMember=await this.db.groupBuyMember.findFirst({where:{orderItemId:item.id}}),group=groupMember?await this.groups.detail(groupMember.groupId,userId):null;
    return safe({memberBenefit:(order.pricingSnapshot as {memberBenefit?:unknown}).memberBenefit??null,charity:publicCharityPrice((order.pricingSnapshot as {charity?:CharityPrice}).charity),group,id:order.id,orderNo:order.orderNo,state:order.state,version:order.version,amount:order.payableTotal,paidAmount:order.paidTotal,refundedAmount:order.refundedTotal,currency:order.currency,originalPrice:order.subtotal,discount:order.discountTotal,coupon:(order.pricingSnapshot as {coupon?:unknown}).coupon??null,createdAt:order.createdAt,expiresAt:order.expiresAt,paidAt:order.paidAt,closeReason:order.closeReason,course:item.itemSnapshot,channel,canPay,paymentStatus,deliveryBlocked:!!deliveryRelease?.withdrawnAt,deliveryReason:deliveryRelease?.withdrawalReason??null,canRefund:refundable,refundUnavailableReason:applePayment?'Apple内购由Apple审核退款，请前往Apple报告问题页面申请；书院可协助核查交易。':pending?'已有退款申请，请查看办理进度':started?'已开始付费章节，可通过客服处理退课问题':payment&&!refundable?'已超过默认退课期限，请联系书院客服':'',refunds:refunds.map(r=>({id:r.id,state:r.state,version:r.version,amount:r.requestedAmount,reason:r.description,reviewNote:r.reviewNote,createdAt:r.createdAt,automatic:r.reasonCode==='APPLE_REVOKED'?!payment:!['COURSE_RETURN','COURSE_WITHDRAWAL'].includes(r.reasonCode)})),access:enrollment&&!enrollment.revokedAt&&enrollment.startsAt<=now()&&(!enrollment.expiresAt||enrollment.expiresAt>now())});
  }
  async list(userId:string,q:OrderPage){const where={userId,kind:'COURSE',...(q.state?{state:q.state}:{})};const [rows,total]=await this.db.$transaction([this.db.tradeOrder.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.size,take:q.size}),this.db.tradeOrder.count({where})]);return{items:await Promise.all(rows.map(r=>this.detail(r.id,userId))),total};}
  async prepay(id:string,userId:string){
    const order=await this.owned(id,userId),channel=(order.pricingSnapshot as {channel?:AppPaymentChannel}).channel??'WECHAT_APP';this.channels.resolve(channel).identity();
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}});
      if (!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}})) throw new ForbiddenException('账号已注销或不可用');
      if(current.state!=='PENDING'||current.expiresAt<=now())throw new ConflictException('订单已支付、关闭或超过付款期限，请刷新');
      const item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),snapshot=item.itemSnapshot as {courseId:string};
      const course=await tx.course.findUnique({where:{id:snapshot.courseId},include:{teacher:true}});if(!course||course.status!=='PUBLISHED'||course.teacher.status!=='PUBLISHED'||course.isDemo||course.teacher.isDemo)throw new ConflictException('课程已停止新购，请取消该订单');
      if(!await courseMemberPriceReady(tx,current))throw new ConflictException('会员优惠已失效或正在退款，请取消后重新确认报价');
      if(!await this.charity.ready(tx,id))throw new ConflictException('公益资格或期限已变化，请取消后重新确认');
      if(!await this.groups.canPay(tx,item.id))throw new ConflictException('本团已结束，请查询原订单或重新开团');
      const release=await tx.courseRelease.findUniqueOrThrow({where:{id:item.courseReleaseId!},include:{lessons:true}});if(release.withdrawnAt||!await this.deliverable(release.lessons,(item.itemSnapshot as {format:string}).format,tx))throw new ConflictException('课件暂不可用，请稍后重试或取消订单');
      const context=await this.learning.context(snapshot.courseId,userId,tx);if(context.access!=='TRIAL')throw new ConflictException('你已拥有课程访问权，请取消该订单');
      const previous=await tx.paymentAttempt.findFirst({where:{orderId:id}});
      if(previous){this.channels.resolve(previous.channel).identity();if(previous.channel!==channel)throw new ConflictException('订单支付渠道不一致，请联系书院核查');}
      if(previous?.state==='CREATED'&&Date.now()-previous.updatedAt.getTime()<30000)throw new ConflictException('支付正在发起，请稍后查询订单');
      if(previous&&(!previous.lastQueriedAt||previous.lastQueriedAt<previous.updatedAt||previous.failureCode))throw new ConflictException('请先查询上次支付结果，确认未付款后再继续');
      if(previous)await tx.paymentAttempt.update({where:{id:previous.id},data:{state:'CREATED',updatedAt:now()}});
      else await tx.paymentAttempt.create({data:{orderId:id,channel,requestKey:'course.pay:'+id,externalRequestId:order.orderNo,state:'CREATED',amount:current.payableTotal,currency:'CNY',expiresAt:current.expiresAt}});
    });
    try {
      const snapshot=(order.pricingSnapshot as {course:{title:string}}).course,orderInfo=await this.channels.resolve(channel).prepay(order.orderNo,snapshot.title,Number(order.payableTotal),order.expiresAt);
      await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING',updatedAt:now()}});
      if((await this.owned(id,userId)).state!=='PENDING')throw new ConflictException('订单状态已变化，请刷新');
      return{provider:channel==='ALIPAY_APP'?'alipay':'wxpay',orderInfo};
    }catch(e){await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING',failureCode:'PROVIDER_RESULT_UNKNOWN',updatedAt:now()}});throw e;}
  }
  async refresh(id:string,userId:string){
    const order=await this.owned(id,userId),attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    if(attempt?.channel==='APPLE_IAP'){
      await this.moduleRef.get<{refreshOrder:(orderId:string,userId:string)=>Promise<unknown>}>('APPLE_COMMERCE',{strict:false}).refreshOrder(id,userId);
      return this.detail(id,userId);
    }
    if(order.state==='PENDING'&&attempt){
      const revision=attempt.updatedAt,result=await this.channels.resolve(attempt.channel).query(order.orderNo);
      if(result.trade_state==='SUCCESS')await this.confirmPayment(result,undefined,attempt.channel as AppPaymentChannel);
      else if(['NOTPAY','CLOSED','NOTFOUND'].includes(result.trade_state)){
        await this.db.paymentAttempt.updateMany({where:{id:attempt.id,updatedAt:revision},data:{lastQueriedAt:now(),failureCode:null}});
        if(order.expiresAt<=now()||result.trade_state==='CLOSED')await this.cancel(id,userId,order.expiresAt<=now()?'TIMEOUT':'PROVIDER_CLOSED');
      }
    }
    for(const refund of await this.db.refund.findMany({where:{orderId:id,state:'REFUNDING'}})){try{const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}});await this.confirmRefund(await this.channels.resolve(payment.channel).queryRefund(refund.channelRequestKey!,{transactionId:payment.externalTransactionId,orderNo:order.orderNo,total:Number(payment.amount)}),payment.channel as AppPaymentChannel);}catch{/* The durable refund job retries; a query failure cannot revoke access. */}}
    return this.detail(id,userId);
  }
  async cancel(id:string,userId:string,reason='USER_CANCEL'){
    const order=await this.owned(id,userId);if(order.state==='CLOSED')return this.detail(id,userId);if(order.state!=='PENDING')throw new ConflictException('已付款订单请申请退款');
    const attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    if(attempt){
      if(attempt.state==='CREATED'&&Date.now()-attempt.updatedAt.getTime()<30000)throw new ConflictException('支付正在发起，请稍后查询后取消');
      const result=await this.channels.resolve(attempt.channel).query(order.orderNo);
      if(result.trade_state==='SUCCESS'){await this.confirmPayment(result,undefined,attempt.channel as AppPaymentChannel);throw new ConflictException('订单已支付，已为你确认，请刷新');}
      if(!['NOTPAY','CLOSED','NOTFOUND'].includes(result.trade_state))throw new ConflictException('支付状态仍待确认，请稍后查询');
      if(result.trade_state==='NOTPAY')await this.channels.resolve(attempt.channel).close(order.orderNo);
    }
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}});if(current.state==='CLOSED')return;if(current.state!=='PENDING')throw new ConflictException('订单已支付，请刷新');
      await tx.tradeOrder.update({where:{id},data:{state:'CLOSED',closedAt:now(),closeReason:reason,version:{increment:1}}});
      await tx.tradeOrderItem.updateMany({where:{orderId:id},data:{state:'CLOSED'}});await tx.paymentAttempt.updateMany({where:{orderId:id,state:{in:['CREATED','PENDING']}},data:{state:'CLOSED'}});
      await this.groups.closeMember(tx,id);
      await finishCourseMemberPrice(tx,id,'RELEASED');await this.charity.finish(tx,id,'RELEASED');await this.marketing.finishCoupon(tx,id,'RELEASED');
      await tx.auditLog.create({data:{actorId:userId,action:'course.order.close',resource:'trade_order',resourceId:id,reason,changes:{state:'CLOSED'}}});
    });return this.detail(id,userId);
  }
  private async journal(tx:Prisma.TransactionClient,order:TradeOrder,paymentId:string,amount:bigint,eventKey:string,kind:string,refundId?:string,anomaly=false,channel:AppPaymentChannel='WECHAT_APP'){
    const journal=await tx.financeJournal.create({data:{eventKey,kind,orderId:order.id,transactionId:paymentId,refundId,currency:'CNY',postedAt:now(),description:kind==='COURSE_PAYMENT'?'课程已验证收款':'课程已验证退款'}});
    const incoming=kind==='COURSE_PAYMENT',income=anomaly?'COURSE_REFUND_PAYABLE':'COURSE_REVENUE';
    const receivable=channel==='ALIPAY_APP'?'ALIPAY_RECEIVABLE':'WECHAT_RECEIVABLE';
    await tx.financeEntry.createMany({data:[{journalId:journal.id,accountCode:incoming?receivable:income,debit:amount,userId:order.userId},{journalId:journal.id,accountCode:incoming?income:receivable,credit:amount,userId:order.userId}]});
  }
  async confirmPayment(data:WechatTransaction,callback?:{id:string;payloadHash:string},channel:AppPaymentChannel='WECHAT_APP'){
    const identity=this.channels.resolve(channel).identity();
    if(data.appid!==identity.appid||data.mchid!==identity.mchid||data.trade_type!=='APP'||data.trade_state!=='SUCCESS'||typeof data.transaction_id!=='string'||!data.transaction_id||data.transaction_id.length>128||!Number.isSafeInteger(data.amount?.total)||data.amount!.total<=0||data.amount!.currency!=='CNY'||!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('收款的商户、应用、金额或交易状态无效');
    const initial=await this.db.tradeOrder.findUnique({where:{orderNo:data.out_trade_no}});if(!initial||initial.kind!=='COURSE')throw new NotFoundException('课程订单不存在');
    return this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id:initial.id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}});
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${item.courseReleaseId} FOR SHARE`;
      const old=await tx.paymentTransaction.findFirst({where:{channel,appScope:identity.appid,externalTransactionId:data.transaction_id!}});
      if(old){if(old.orderId!==order.id||old.amount!==BigInt(data.amount!.total))throw new ConflictException('交易编号已绑定其他收款');return{disposition:old.disposition};}
      const attempt=await tx.paymentAttempt.findFirst({where:{orderId:order.id,channel}});if(!attempt)throw new BadRequestException('订单没有对应支付尝试');
      const existing=await tx.paymentTransaction.findFirst({where:{orderId:order.id,disposition:'ACCEPTED'}}),release=await tx.courseRelease.findUniqueOrThrow({where:{id:item.courseReleaseId!},include:{lessons:true}}),user=await tx.user.findUniqueOrThrow({where:{id:order.userId}});
      const enrolled=await tx.enrollment.findUnique({where:{userId_courseId:{userId:order.userId,courseId:release.courseId}}}),already=!!enrolled&&!enrolled.revokedAt&&enrolled.startsAt<=now()&&(!enrolled.expiresAt||enrolled.expiresAt>now());
      const deliveryReady=await this.charity.ready(tx,order.id)&&!release.withdrawnAt&&await this.deliverable(release.lessons,(item.itemSnapshot as {format:string}).format,tx);
      const membership=await this.learning.membership(order.userId,tx),course=await tx.course.findUniqueOrThrow({where:{id:release.courseId}}),memberAccess=course.status==='PUBLISHED'&&course.membershipTier!==null&&!!membership&&membership.contentTier>=course.membershipTier;
      const amount=BigInt(data.amount!.total),paidAt=new Date(data.success_time!);
      const disposition=amount!==order.payableTotal?'AMOUNT_MISMATCH':existing?'DUPLICATE':order.state==='CLOSED'||paidAt>order.expiresAt?'LATE':already||memberAccess||!deliveryReady||!await courseMemberPriceReady(tx,order,paidAt)||user.status!=='ACTIVE'?'REFUND_REQUIRED':'ACCEPTED';
      const payment=await tx.paymentTransaction.create({data:{attemptId:attempt.id,orderId:order.id,channel,appScope:identity.appid,externalTransactionId:data.transaction_id!,amount,currency:'CNY',verifiedAt:now(),paidAt,disposition,receiptHash:hash(data)}});
      const grouped=!!await tx.groupBuyMember.findFirst({where:{orderItemId:item.id}});
      await this.journal(tx,order,payment.id,amount,'course.payment:'+payment.id,'COURSE_PAYMENT',undefined,disposition!=='ACCEPTED'||grouped,channel);
      if(disposition==='ACCEPTED'){
        await finishCourseMemberPrice(tx,order.id,'CONSUMED');await this.marketing.finishCoupon(tx,order.id,'USED');
        const startsAt=now(),expiresAt=release.accessDays?new Date(startsAt.getTime()+release.accessDays*86400000):null;
        const grant={releaseId:release.id,source:'PURCHASE',orderItemId:item.id,grantKey:'course.payment:'+payment.id,startsAt,expiresAt,revokedAt:null,startedAt:null,grantActorId:null,grantReason:null};
        const groupMember=await tx.groupBuyMember.findFirst({where:{orderItemId:item.id}});
        if(!groupMember)await tx.enrollment.upsert({where:{userId_courseId:{userId:order.userId,courseId:release.courseId}},create:{userId:order.userId,courseId:release.courseId,...grant},update:{...grant,version:{increment:1}}});
        await tx.tradeOrder.update({where:{id:order.id},data:{state:'COMPLETED',paidAt,paidTotal:amount,completedAt:now(),version:{increment:1}}});
        await tx.tradeOrderItem.update({where:{id:item.id},data:{state:'DELIVERED'}});await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED'}});
        if(groupMember)await this.groups.paid(tx,order,item);
        else {await this.charity.finish(tx,order.id,'DELIVERED');await this.referrals.delivered(tx,item.id);await tx.notification.create({data:{userId:order.userId,kind:'COURSE_ORDER',orderId:order.id,eventKey:'course.paid:'+order.id,title:'课程已加入研习',body:'支付已确认，可前往学习档案开始研习。'}});}
      }else{
        if(!existing){await finishCourseMemberPrice(tx,order.id,'RELEASED');await this.charity.finish(tx,order.id,'RELEASED');await this.marketing.finishCoupon(tx,order.id,'RELEASED');}
        if(!existing){await tx.tradeOrder.update({where:{id:order.id},data:{state:'CLOSED',closedAt:now(),closeReason:disposition,version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{state:'CLOSED'}});await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED'}});}
        const refund=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'anomaly:'+payment.id,kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:amount,approvedAmount:amount,reasonCode:disposition,description:'异常收款自动原路退款，不重复授予课程权限',paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});
        await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount,revokeQuantity:0}});
        await tx.outboxJob.create({data:{eventKey:'course.refund:'+refund.id,kind:'COURSE_REFUND',aggregateType:'COURSE_REFUND',aggregateId:refund.id,payload:{},availableAt:now()}});
        await tx.notification.create({data:{userId:order.userId,kind:'COURSE_ORDER',orderId:order.id,eventKey:'course.anomaly:'+payment.id,title:'课程收款需原路退回',body:'本次收款未用于重复授权，书院正在办理原路退款，可在购课订单查看。'}});
      }
      if(callback)await tx.providerCallback.create({data:{provider:channel,appScope:identity.appid,externalEventId:callback.id,kind:'TRANSACTION.SUCCESS',payloadHash:callback.payloadHash,payloadStorageRef:'sha256:'+callback.payloadHash,signatureVerified:true,state:'HANDLED',handledAt:now()}});
      await tx.outboxJob.updateMany({where:{eventKey:'course.expire:'+order.id},data:{state:'DONE',completedAt:now(),lockedUntil:null}});
      await tx.auditLog.create({data:{actorId:order.userId,action:'course.payment.confirm',resource:'trade_order',resourceId:order.id,changes:{source:channel+'_VERIFIED',paymentId:payment.id,disposition,amount:String(amount)}}});return{disposition};
    });
  }
  async requestRefund(id:string,userId:string,dto:RefundDto){
    const initial=await this.owned(id,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),old=await tx.refund.findFirst({where:{userId,requestKey:dto.requestKey}});
      if (!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}})) throw new ForbiddenException('账号已注销或不可用，请通过客服凭订单记录联系书院');
      if(old){if(old.orderId!==id||old.description!==dto.reason.trim())throw new ConflictException('退课标识已用于其他申请');return;}
      const payment=await tx.paymentTransaction.findFirst({where:{orderId:id,disposition:'ACCEPTED'}}),enrollment=await tx.enrollment.findFirst({where:{orderItemId:item.id,userId}});
      if(payment?.channel==='APPLE_IAP')throw new BadRequestException('Apple内购请通过Apple报告问题页面申请退款，书院不代替Apple审批');
      if(!payment||order.refundedTotal!==0n)throw new BadRequestException('订单未有效付款或已经退款');
      const release=enrollment?await tx.courseRelease.findUnique({where:{id:enrollment.releaseId}}):null,withdrawn=!!release?.withdrawnAt&&enrollment?.source==='PURCHASE'&&!enrollment.revokedAt&&(!enrollment.expiresAt||enrollment.expiresAt>release.withdrawnAt);
      if(!withdrawn&&(Date.now()-payment.paidAt.getTime()>7*86400000||(item.benefitSnapshot as {startedAt?:string}).startedAt||enrollment?.startedAt))throw new BadRequestException('默认退课限付款后七日且未开始付费章节；如有问题请联系书院客服');
      if(await tx.refund.findFirst({where:{orderId:id,paymentTransactionId:payment.id,state:{notIn:['REJECTED','CANCELLED']}}}))throw new ConflictException('已有退课申请，请查看办理进度');
      const groupMember=await tx.groupBuyMember.findFirst({where:{orderItemId:item.id}}),group=groupMember?await tx.groupBuy.findUniqueOrThrow({where:{id:groupMember.groupId}}):null;
      if(group?.state==='OPEN'){await this.groups.fail(tx,group.id);await tx.auditLog.create({data:{actorId:userId,action:'course.group.withdraw',resource:'group_buy',resourceId:group.id,reason:dto.reason,changes:{orderId:id,requestKey:dto.requestKey}}});return;}
      const refund=await tx.refund.create({data:{orderId:id,userId,requestKey:dto.requestKey,kind:'REFUND_ONLY',state:'REQUESTED',requestedAmount:order.paidTotal,reasonCode:withdrawn?'COURSE_WITHDRAWAL':'COURSE_RETURN',description:dto.reason.trim(),paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:order.paidTotal,revokeQuantity:1}});
      await tx.auditLog.create({data:{actorId:userId,action:'course.refund.request',resource:'refund',resourceId:refund.id,changes:{orderId:id}}});
    });return this.detail(id,userId);
  }
  async reviewRefund(refundId:string,req:AuthRequest,dto:RefundReviewDto){
    requireRoles(req,['FINANCE']);const initial=await this.db.refund.findUnique({where:{id:refundId}});if(!initial)throw new NotFoundException('退款申请不存在');
    const order=await this.db.tradeOrder.findFirst({where:{id:initial.orderId,kind:'COURSE'}});if(!order)throw new NotFoundException('课程订单不存在');
    if(initial.paymentTransactionId&&(await this.db.paymentTransaction.findUniqueOrThrow({where:{id:initial.paymentTransactionId}})).channel==='APPLE_IAP')throw new BadRequestException('Apple退款由Apple审核，不能经微信或支付宝退款');
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const refund=await tx.refund.findUniqueOrThrow({where:{id:refundId}});
      if(refund.version!==dto.expectedVersion)throw new ConflictException('退款状态已变化，请刷新');
      if(dto.action==='RETRY'?!['FAILED','REFUNDING'].includes(refund.state):refund.state!=='REQUESTED')throw new ConflictException('当前状态不支持此操作');
      if(dto.action==='APPROVE'){
        const item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}}),enrollment=await tx.enrollment.findFirst({where:{orderItemId:item.id}}),payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}});
        const release=enrollment?await tx.courseRelease.findUnique({where:{id:enrollment.releaseId}}):null,withdrawn=refund.reasonCode==='COURSE_WITHDRAWAL'&&!!release?.withdrawnAt&&enrollment?.source==='PURCHASE'&&!enrollment.revokedAt&&(!enrollment.expiresAt||enrollment.expiresAt>release.withdrawnAt);
        if(!withdrawn&&((item.benefitSnapshot as {startedAt?:string}).startedAt||enrollment?.startedAt||Date.now()-payment.paidAt.getTime()>7*86400000))throw new ConflictException('学员已开始付费章节或超过退课期限，且当前无停止交付补偿，请重新核查');
      }
      const state=dto.action==='REJECT'?'REJECTED':'REFUNDING';
      await tx.refund.update({where:{id:refundId},data:{state,approvedAmount:state==='REFUNDING'?refund.requestedAmount:null,reviewerId:req.actor.id,reviewNote:dto.reason,version:{increment:1},updatedAt:now(),failureCode:null}});
      if(state==='REFUNDING')await tx.outboxJob.upsert({where:{eventKey:'course.refund:'+refundId},create:{eventKey:'course.refund:'+refundId,kind:'COURSE_REFUND',aggregateType:'COURSE_REFUND',aggregateId:refundId,payload:{},availableAt:now()},update:{state:'READY',availableAt:now(),lockedUntil:null,attempts:0,lastErrorCode:null}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'course.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:refundId,reason:dto.reason,changes:{orderId:order.id,state}}});
      await tx.notification.create({data:{userId:order.userId,kind:'COURSE_ORDER',orderId:order.id,eventKey:'course.refund.review:'+refundId+':'+(refund.version+1),title:state==='REJECTED'?'退课申请未通过':'退课申请正在办理',body:dto.reason}});
    });return this.detail(order.id,order.userId);
  }
  async confirmRefund(data:WechatRefund,channel:AppPaymentChannel='WECHAT_APP'){
    const identity=this.channels.resolve(channel).identity(),refund=await this.db.refund.findUnique({where:{channelRequestKey:data.out_refund_no}});if(!refund)throw new NotFoundException('退款记录不存在');
    const order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:refund.orderId}}),payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),state=data.refund_status??data.status;
    if(order.kind!=='COURSE'||payment.channel!==channel||payment.appScope!==identity.appid||(data.mchid&&data.mchid!==identity.mchid)||data.out_trade_no!==order.orderNo||data.transaction_id!==payment.externalTransactionId||!Number.isSafeInteger(data.amount?.refund)||!Number.isSafeInteger(data.amount?.total)||BigInt(data.amount.refund)!==refund.approvedAmount||BigInt(data.amount.total)!==payment.amount||(data.amount.currency&&data.amount.currency!=='CNY')||typeof data.refund_id!=='string'||!data.refund_id||data.refund_id.length>128||!['SUCCESS','PROCESSING','ABNORMAL','CLOSED'].includes(state??''))throw new BadRequestException('退款事实与原收款不一致');
    if(state==='PROCESSING')return false;
    return this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id:refund.id}});if(current.state==='SUCCEEDED')return true;
      if(!['REFUNDING','FAILED'].includes(current.state))throw new ConflictException('退款尚未审批');
      if(state!=='SUCCESS'){await tx.refund.update({where:{id:refund.id},data:{state:'FAILED',failureCode:state,version:{increment:1},updatedAt:now()}});return true;}
      if(!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('退款完成时间无效');
      const row=await tx.refundTransaction.create({data:{refundId:refund.id,paymentTransactionId:payment.id,channel,appScope:identity.appid,externalRefundId:data.refund_id,amount:current.approvedAmount!,currency:'CNY',verifiedAt:now(),succeededAt:new Date(data.success_time),receiptHash:hash(data)}});
      await tx.refund.update({where:{id:refund.id},data:{state:'SUCCEEDED',succeededAt:row.succeededAt,version:{increment:1},failureCode:null}});
      const groupMember=await tx.groupBuyMember.findFirst({where:{orderItemId:{in:(await tx.tradeOrderItem.findMany({where:{orderId:order.id},select:{id:true}})).map(i=>i.id)}}}),group=groupMember?await tx.groupBuy.findUniqueOrThrow({where:{id:groupMember.groupId}}):null;
      await this.journal(tx,order,payment.id,row.amount,'course.refunded:'+refund.id,'COURSE_REFUND',refund.id,payment.disposition!=='ACCEPTED'||!!group&&group.state!=='SUCCEEDED',channel);
      if(payment.disposition==='ACCEPTED'){
        await finishCourseMemberPrice(tx,order.id,'REVERSED');await this.marketing.finishCoupon(tx,order.id,'REFUNDED');
        await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:{increment:row.amount},version:{increment:1}}});await this.charity.reverse(tx,order.id,refund.id);await this.charity.finish(tx,order.id,'REFUNDED');
        const items=await tx.refundItem.findMany({where:{refundId:refund.id,revokeQuantity:{gt:0}}});
        for(const item of items){await this.referrals.reverse(tx,item.orderItemId);await this.groups.refunded(tx,item.orderItemId);await tx.tradeOrderItem.update({where:{id:item.orderItemId},data:{refundedAmount:{increment:item.amount},state:'REFUNDED'}});await tx.enrollment.updateMany({where:{orderItemId:item.orderItemId,source:'PURCHASE',grantKey:'course.payment:'+payment.id},data:{revokedAt:now(),version:{increment:1}}});}
      }
      await tx.notification.create({data:{userId:order.userId,kind:'COURSE_ORDER',orderId:order.id,eventKey:'course.refunded:'+refund.id,title:'课程退款已完成',body:'退款已由支付渠道确认，请留意原付款账户。'}});
      await tx.auditLog.create({data:{actorId:order.userId,action:'course.refund.confirm',resource:'refund',resourceId:refund.id,changes:{source:channel+'_VERIFIED',transactionId:row.id,amount:String(row.amount)}}});return true;
    });
  }
  private async paymentDomain(orderNo:string){
    const order=await this.db.tradeOrder.findUnique({where:{orderNo}});
    if(order?.kind==='DIGITAL')return this.moduleRef.get<Pick<CourseSalesService,'confirmPayment'|'confirmRefund'>>('DIGITAL_SALES',{strict:false});
    if(order?.kind==='COHORT')return this.moduleRef.get<Pick<CourseSalesService,'confirmPayment'|'confirmRefund'>>('COHORT_SALES',{strict:false});
    if(order?.kind==='GIFT')return this.moduleRef.get<Pick<CourseSalesService,'confirmPayment'|'confirmRefund'>>('GIFT_SALES',{strict:false});
    if(order&&['CONSULTATION','EVENT'].includes(order.kind))return this.moduleRef.get<Pick<CourseSalesService,'confirmPayment'|'confirmRefund'>>('BOOKING_SALES',{strict:false});
    if(order?.kind==='PHYSICAL')return this.moduleRef.get<Pick<CourseSalesService,'confirmPayment'|'confirmRefund'>>('PRODUCT_SALES',{strict:false});
    if(order?.kind==='MEMBERSHIP'&&await this.db.tradeOrderItem.findFirst({where:{orderId:order.id,membershipVersionId:{not:null}}}))return this.moduleRef.get<Pick<CourseSalesService,'confirmPayment'|'confirmRefund'>>('MEMBERSHIP_SALES',{strict:false});
    return this;
  }
  async notify(req:RawBodyRequest<Request>){const envelope=await this.channels.wechatNotification(req.headers,req.rawBody!),domain=await this.paymentDomain(envelope.data.out_trade_no);if(envelope.eventType==='TRANSACTION.SUCCESS')await domain.confirmPayment(envelope.data,{id:envelope.id,payloadHash:hash(req.rawBody!.toString())});else await domain.confirmRefund(envelope.data);}
  async notifyAlipay(req:RawBodyRequest<Request>){
    if(!req.is('application/x-www-form-urlencoded'))throw new BadRequestException('支付宝通知格式无效');
    const envelope=this.channels.alipayNotification(req.rawBody!);
    if(envelope.data.trade_state==='SUCCESS')await (await this.paymentDomain(envelope.data.out_trade_no)).confirmPayment(envelope.data,{id:envelope.id,payloadHash:hash(req.rawBody!.toString())},'ALIPAY_APP');
    // Refund amounts in notifications are cumulative; only a signed per-request query can confirm a refund.
  }
  async admin(q:OrderPage){const where={kind:'COURSE',...(q.state?{state:q.state}:{}),...(q.q?{orderNo:{contains:q.q}}:{})};const [rows,total]=await this.db.$transaction([this.db.tradeOrder.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.size,take:q.size}),this.db.tradeOrder.count({where})]);const users=await this.db.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true}});return{items:await Promise.all(rows.map(async r=>({...await this.detail(r.id,r.userId),nickname:users.find(u=>u.id===r.userId)?.nickname??'已注销'}))),total};}
  async adminDetail(id:string){
    const row=await this.db.tradeOrder.findFirst({where:{id,kind:'COURSE'}});if(!row)throw new NotFoundException('课程订单不存在');
    const [user,payments,refunds]=await Promise.all([this.db.user.findUniqueOrThrow({where:{id:row.userId},select:{nickname:true}}),this.db.paymentTransaction.findMany({where:{orderId:id},orderBy:{paidAt:'asc'},select:{id:true,channel:true,externalTransactionId:true,amount:true,disposition:true,paidAt:true,verifiedAt:true}}),this.db.refund.findMany({where:{orderId:id},select:{id:true}})]);
    const recoveryJobs=await this.db.outboxJob.findMany({where:{aggregateId:{in:[id,...refunds.map(r=>r.id)]},kind:{in:['COURSE_PAYMENT_CHECK','COURSE_REFUND']}},select:{kind:true,state:true,attempts:true,lastErrorCode:true,availableAt:true},orderBy:{createdAt:'asc'}});
    return safe({...await this.detail(id,row.userId),nickname:user.nickname,payments,recoveryJobs});
  }
  async adminRefresh(id:string){const row=await this.db.tradeOrder.findFirst({where:{id,kind:'COURSE'}});if(!row)throw new NotFoundException('课程订单不存在');await this.refresh(id,row.userId);return this.adminDetail(id);}
  private async deliveryNotices(job:{id:string;aggregateId:string;attempts:number}){
    return this.db.$transaction(async tx=>{
      const locked=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "OutboxJob" WHERE id=${job.id} AND attempts=${job.attempts} AND state='RUNNING' AND "lockedUntil">now() FOR UPDATE`;
      if(!locked.length)return false;
      const row=await tx.outboxJob.findUniqueOrThrow({where:{id:job.id}}),payload=row.payload as {deliveryVersion:number;action:string;reason:string;cursor?:string};
      const release=await tx.courseRelease.findUniqueOrThrow({where:{id:job.aggregateId}});
      if(release.deliveryVersion!==payload.deliveryVersion)return true;
      const rows=await tx.enrollment.findMany({where:{releaseId:release.id,revokedAt:null,...(payload.cursor?{id:{gt:payload.cursor}}:{}),user:{status:'ACTIVE'}},orderBy:{id:'asc'},take:51});
      const batch=rows.slice(0,50);
      if(batch.length)await tx.notification.createMany({skipDuplicates:true,data:batch.map(e=>({userId:e.userId,kind:'COURSE_VERSION',resourceId:release.courseId,eventKey:'course.delivery:'+release.id+':'+payload.deliveryVersion+':'+e.id,title:payload.action==='WITHDRAW'?'课程版本停止交付，请选择处理方案':'课程版本恢复交付',body:payload.reason+(payload.action==='WITHDRAW'?'；已购记录保留。请前往课程版本页选择替代版，或从购课订单申请退课。':'；可前往课程学习页继续研习。')}))});
      if(rows.length>50)await tx.outboxJob.update({where:{id:job.id},data:{payload:{...payload,cursor:batch.at(-1)!.id,deliveryFailures:0}}});
      return rows.length<=50;
    });
  }
  async runJobs(){
    if(this.working)return;this.working=true;
    try {
      for(let i=0;i<10;i++){
        const jobs=await this.db.$queryRaw<{id:string;kind:string;aggregateId:string;attempts:number}[]>`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind IN ('COURSE_PAYMENT_CHECK','COURSE_REFUND','COURSE_DELIVERY_NOTICE','COURSE_GROUP_EXPIRE') AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,kind,"aggregateId",attempts`;
        if(!jobs.length)break;const job=jobs[0]!;
        try {
          let done=true;
          if(job.kind==='COURSE_GROUP_EXPIRE')await this.groups.expire(job.aggregateId);
          else if(job.kind==='COURSE_PAYMENT_CHECK'){const order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:job.aggregateId}});if(order.state==='PENDING'){await this.refresh(order.id,order.userId);const updated=await this.db.tradeOrder.findUniqueOrThrow({where:{id:order.id}});if(updated.state==='PENDING'){if(!await this.db.paymentAttempt.findFirst({where:{orderId:order.id}}))await this.cancel(order.id,order.userId,'TIMEOUT');else done=false;}}}
          else if(job.kind==='COURSE_DELIVERY_NOTICE')done=await this.deliveryNotices(job);
          else {const refund=await this.db.refund.findUniqueOrThrow({where:{id:job.aggregateId}});if(refund.state==='REFUNDING'){const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),order=await this.db.tradeOrder.findUniqueOrThrow({where:{id:refund.orderId}});done=await this.confirmRefund(await this.channels.resolve(payment.channel).refund(payment.externalTransactionId,refund.channelRequestKey!,Number(refund.approvedAmount),Number(payment.amount),order.orderNo),payment.channel as AppPaymentChannel);}}
          await this.db.outboxJob.updateMany({where:{id:job.id,attempts:job.attempts,state:'RUNNING'},data:{state:done?'DONE':'READY',completedAt:done?now():null,lockedUntil:null,availableAt:new Date(Date.now()+60000),lastErrorCode:null}});
        }catch{
          const payload=(await this.db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).payload as Record<string,Prisma.JsonValue>;
          const failures=job.kind==='COURSE_DELIVERY_NOTICE'?Number(payload.deliveryFailures??0)+1:job.attempts;
          await this.db.outboxJob.updateMany({where:{id:job.id,attempts:job.attempts,state:'RUNNING'},data:{state:failures>=20?'DEAD':'READY',lockedUntil:null,availableAt:new Date(Date.now()+Math.min(3600000,30000*2**Math.min(failures,7))),lastErrorCode:'PROVIDER_OR_PROCESSING_ERROR',...(job.kind==='COURSE_DELIVERY_NOTICE'?{payload:{...payload,deliveryFailures:failures}}:{})}});
        }
      }
    }finally{this.working=false;}
  }
}

@Controller('commerce') export class CourseSalesController {
  constructor(private readonly sales:CourseSalesService){}
  @Get('courses/:id/quote') @UseGuards(OptionalUserGuard) quote(@Param('id',ParseUUIDPipe) id:string,@Query() q:QuoteQuery,@Req() req:AuthRequest){return this.sales.quote(id,q.platform,req.actor?.id,q.channel,q);}
  @Post('course-orders') @UseGuards(UserGuard) checkout(@Req() req:AuthRequest,@Body() dto:CheckoutDto){return this.sales.checkout(req.actor.id,dto);}
  @Get('course-orders') @UseGuards(UserGuard) list(@Req() req:AuthRequest,@Query() q:OrderPage){return this.sales.list(req.actor.id,q);}
  @Get('course-orders/:id') @UseGuards(UserGuard) detail(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.detail(id,req.actor.id);}
  @Post('course-orders/:id/payment') @UseGuards(UserGuard) pay(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.prepay(id,req.actor.id);}
  @Post('course-orders/:id/refresh') @UseGuards(UserGuard) refresh(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.refresh(id,req.actor.id);}
  @Post('course-orders/:id/cancel') @UseGuards(UserGuard) cancel(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.sales.cancel(id,req.actor.id);}
  @Post('course-orders/:id/refund') @UseGuards(UserGuard) refund(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:RefundDto){return this.sales.requestRefund(id,req.actor.id,dto);}
}
@Controller('payments/wechat') export class WechatCallbackController {
  constructor(private readonly sales:CourseSalesService){}
  @Post('notify') @HttpCode(204) async notify(@Req() req:RawBodyRequest<Request>){await this.sales.notify(req);}
}
@Controller('payments/alipay') export class AlipayCallbackController {
  constructor(private readonly sales:CourseSalesService){}
  @Post('notify') @HttpCode(200) async notify(@Req() req:RawBodyRequest<Request>){await this.sales.notifyAlipay(req);return 'success';}
}
@Controller('admin/course-orders') @UseGuards(AdminGuard) export class CourseOrdersAdminController {
  constructor(private readonly sales:CourseSalesService){}
  @Get() list(@Req() req:AuthRequest,@Query() q:OrderPage){requireRoles(req,['FINANCE','SUPPORT']);return this.sales.admin(q);}
  @Get(':id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['FINANCE','SUPPORT']);return this.sales.adminDetail(id);}
  @Post(':id/refresh') refresh(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['FINANCE','SUPPORT']);return this.sales.adminRefresh(id);}
  @Post('refunds/:id/review') review(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RefundReviewDto){return this.sales.reviewRefund(id,req,dto);}
}

