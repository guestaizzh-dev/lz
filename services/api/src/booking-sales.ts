import {offlineBooking,offlineOrderReady} from './offline-courses.js';
import {consumptionPolicy} from './consumption-policy.js';
import {consultationCredit,syncConsultationCredit,eventMemberPrice,freezeBookingMemberPrice,finishBookingMemberPrice,bookingMemberPriceReady,type BookingMemberPrice} from './booking-member-pricing.js';
import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Injectable,NotFoundException,OnModuleDestroy,OnModuleInit,Param,ParseUUIDPipe,Post,Query,Req,ServiceUnavailableException,UseGuards} from '@nestjs/common';
import {Type} from 'class-transformer';
import {IsBoolean,IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Matches,Max,Min} from 'class-validator';
import {createHash,randomUUID} from 'node:crypto';
import {AdminGuard,UserGuard,requireRoles,type AuthRequest} from './auth.js';
import {Database} from './database.js';
import {PaymentChannels,type AppPaymentChannel} from './payment-channels.js';
import {Prisma,type TradeOrder} from './generated/prisma/client.js';
import {encryptPrivate,decryptPrivate} from './private-data.js';
import {publicContentScope} from './public-content.js';
import {eventPrioritySource} from './membership-benefits.js';
import {serviceRefundEntries} from './service-accounting.js';
import {serviceDeliverySummary} from './service-accounting.js';
import type {WechatTransaction,WechatRefund} from './wechat-pay.js';

class QuoteDto {
  @IsIn(['appointment','registration']) kind!: 'appointment'|'registration';
  @IsUUID() resourceId!: string;
  @IsOptional() @IsUUID() skuId?:string;
  @IsInt() @Min(1) @Max(20) quantity=1;
  @IsIn(['ANDROID','IOS','WEB']) platform='WEB';
}
class ConfirmationDto extends QuoteDto {
  @IsUUID() requestKey!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash!:string;
  @IsString() @Length(1,50) @Matches(/\S/) name!:string;
  @IsString() @Matches(/^1[3-9]\d{9}$/) phone!:string;
  @IsBoolean() contactConsent!:boolean;
}
class CheckoutDto extends QuoteDto {
  @IsUUID() requestKey!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash!:string;
  @IsIn(['WECHAT_APP','ALIPAY_APP','SIMULATED']) channel!:AppPaymentChannel;
  @IsString() @Length(1,50) @Matches(/\S/) name!:string;
  @IsString() @Matches(/^1[3-9]\d{9}$/) phone!:string;
  @IsBoolean() contactConsent!:boolean;
}
class PageQuery {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsIn(['PENDING','PAID','COMPLETED','CLOSED']) state?:string;
  @IsOptional() @IsString() @Length(0,80) q?:string;
}
class RefundDto { @IsUUID() requestKey!:string; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
class ReviewDto { @IsInt() @Min(1) expectedVersion!:number; @IsIn(['APPROVE','REJECT','RETRY']) action!:string; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; @IsOptional() @IsString() @Matches(/^[1-9][0-9]{0,14}$/) approvedAmount?:string; }
class RefundDecisionDto { @IsInt() @Min(1) expectedVersion!:number; @IsIn(['ACCEPT','DECLINE']) action!:string; }
export class BookingRejectDto { @IsInt() @Min(1) expectedVersion!:number; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
type Tx=Prisma.TransactionClient;
type Snapshot={offline?:{courseId:string;releaseId:string;title:string;isDemo:boolean}|null;memberBenefit?:BookingMemberPrice|null;originalTotal?:string;discount?:string;total?:string;kind:'appointment'|'registration';resourceId:string;parentId:string;title:string;teacherId?:string;teacherName?:string;ticketTitle?:string;skuId:string|null;startsAt:string;endsAt:string;cancelDeadline:string;location:string;deliveryPolicy:string;refundPolicy:string;scheduleVersion:number;offerId:string;offerVersion:number;offeringVersion?:number;price:string;quantity:number;platform:string};
type Assessment={assessedAt:string;originalState:string;originalBookingVersion:number;scheduleVersion:number;startsAt:string;endsAt:string;quantity:number;checkedCount:number;paidAmount:string;withdrawalScope:string;proposalAmount?:string;deductionAmount?:string;proposalVersion?:number;reviewNote?:string};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));
const kinds=['CONSULTATION','EVENT'];
const refundPolicy='取消截止前且未开始履约，可申请整单原路全额退款；申请期间暂停到场与联系信息访问，审核拒绝后恢复原安排。书院延期须本人确认，不接受可全额退出，接受后可在新开始前全额退出；书院取消自动全额原路退款。支付渠道确认退款成功后才释放名额；超过截止或部分参加请联系书院核查。';
const activeOffer=(now:Date)=>({active:true,AND:[{OR:[{validFrom:null},{validFrom:{lte:now}}]},{OR:[{validUntil:null},{validUntil:{gt:now}}]}]});

@Injectable()
export class BookingSalesService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  constructor(private readonly db:Database,private readonly channels:PaymentChannels){}
  async onModuleInit(){
    if(process.env.BOOKING_SALES_ENABLED==='true'){
      const enabled=this.channels.choices().filter(c=>c.enabled),codes=['BOOKING_REVENUE','BOOKING_ADVANCE','BOOKING_REFUND_PAYABLE',...enabled.map(c=>c.channel==='WECHAT_APP'?'WECHAT_RECEIVABLE':'ALIPAY_RECEIVABLE')];
      if(!enabled.length||await this.db.financeAccount.count({where:{code:{in:codes}}})!==codes.length)throw Error('Booking payments require verified channels and posting accounts');
      if(process.env.NODE_ENV==='production'&&process.env.BOOKING_PAYMENT_WORKER_ENABLED==='false')throw Error('Booking payments require the recovery worker');
    }
    if(process.env.NODE_ENV!=='test'&&process.env.BOOKING_PAYMENT_WORKER_ENABLED!=='false'){this.timer=setInterval(()=>void this.runJobs().catch(()=>{}),20000);this.timer.unref();}
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private enabled(platform:string){return platform==='ANDROID'&&process.env.BOOKING_SALES_ENABLED==='true';}
  private async lock(tx:Tx,order:Pick<TradeOrder,'id'|'userId'>){await tx.$queryRaw`SELECT id FROM "User" WHERE id=${order.userId} FOR NO KEY UPDATE`;await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${order.id} FOR UPDATE`;}
  private async resource(tx:Tx,dto:QuoteDto,userId:string,lock=false){
    const now=new Date();let snapshot:Snapshot,available:number,cutoff:Date,isDemo=false,priority:Prisma.InputJsonValue|undefined,memberBenefit:BookingMemberPrice|null=null;
    if(dto.kind==='appointment'){
      if(dto.quantity!==1)throw new BadRequestException('老师时段每次仅可预约一人');
      const found=await tx.appointmentSlot.findUnique({where:{id:dto.resourceId}});if(!found)throw new NotFoundException('服务时段不存在');
      if(lock){await tx.$queryRaw`SELECT id FROM "ServiceOffering" WHERE id=${found.offeringId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "AppointmentSlot" WHERE id=${found.id} FOR UPDATE`;}
      const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:found.id}}),offering=await tx.serviceOffering.findUniqueOrThrow({where:{id:found.offeringId}}),teacher=await tx.teacher.findFirst({where:{id:offering.teacherId,...await publicContentScope(tx)}});
      cutoff=new Date(+slot.startsAt-offering.leadMinutes*60000);
      if(!offering.active||!teacher||slot.state!=='OPEN'||cutoff<=now)throw new ConflictException('服务已关闭或超过预约截止时间');
      const offers=await tx.saleOffer.findMany({where:{serviceOfferingId:offering.id,...activeOffer(now)}});if(offers.length!==1)throw new ConflictException('服务报价尚未配置完整');const offer=offers[0]!;
      if(dto.skuId){
        const sku=await tx.productSku.findFirst({where:{id:dto.skuId,serviceOfferingId:offering.id,active:true,product:{type:'SERVICE',...await publicContentScope(tx)}},include:{product:true}});
        if(!sku||BigInt(sku.price)!==offer.price)throw new ConflictException('服务商品价格或归属已变化，请重新选择');isDemo=sku.product.isDemo;
      }
      available=slot.capacity-slot.reserved-slot.confirmed;isDemo=isDemo||teacher.isDemo;
      memberBenefit=await consultationCredit(tx,userId,offering.id,offer.id,offer.price);
      snapshot={kind:dto.kind,resourceId:slot.id,parentId:offering.id,title:offering.title,teacherId:teacher.id,teacherName:teacher.name,skuId:dto.skuId??null,startsAt:slot.startsAt.toISOString(),endsAt:slot.endsAt.toISOString(),cancelDeadline:new Date(+slot.startsAt-offering.cancelBeforeMinutes*60000).toISOString(),location:offering.locationPolicy,deliveryPolicy:offering.deliveryPolicy,refundPolicy,scheduleVersion:slot.scheduleVersion,offerId:offer.id,offerVersion:offer.version,offeringVersion:offering.version,price:String(offer.price),quantity:1,platform:dto.platform};
    }else{
      if(dto.skuId)throw new BadRequestException('活动报名不接受服务商品规格');
      const ticket=await tx.eventTicketType.findUnique({where:{id:dto.resourceId}});if(!ticket)throw new NotFoundException('活动席位不存在');
      const found=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});
      if(lock){await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${found.eventId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "EventSession" WHERE id=${found.id} FOR UPDATE`;}
      const session=await tx.eventSession.findUniqueOrThrow({where:{id:found.id}}),event=await tx.event.findFirst({where:{id:found.eventId,...await publicContentScope(tx)}}),tickets=await tx.eventTicketType.findMany({where:{sessionId:session.id}}),current=tickets.find(t=>t.id===ticket.id)!;
      if(!event||!current.active||session.state!=='OPEN'||session.startsAt<=now)throw new ConflictException('场次已关闭或开始');
      const offline=await offlineBooking(tx,session.id,dto.quantity);
      const source=session.publicOpenAt>now&&session.memberOpenAt&&session.memberOpenAt<=now?await eventPrioritySource(tx,userId,event.id,now):null;
      if(session.publicOpenAt>now&&!source)throw new ConflictException('尚未到本人可报名时间，请等待公众开放或核查会员权益');
      const mine=await tx.eventRegistration.aggregate({where:{userId,ticketTypeId:current.id,state:{notIn:['CANCELLED','REFUNDED']}},_sum:{quantity:true}});
      if((mine._sum.quantity??0)+dto.quantity>current.perUserLimit)throw new ConflictException('已达到每人报名人数上限');
      const offers=await tx.saleOffer.findMany({where:{eventTicketId:current.id,...activeOffer(now)}});if(offers.length!==1)throw new ConflictException('场次报价尚未配置完整');const offer=offers[0]!;
      available=Math.min(current.capacity-current.reserved-current.confirmed,session.capacity-tickets.reduce((n,t)=>n+t.reserved+t.confirmed,0));cutoff=session.startsAt;isDemo=event.isDemo||!!offline?.isDemo;
      snapshot={...(offline?{offline}:{}),kind:dto.kind,resourceId:ticket.id,parentId:session.id,title:event.title,ticketTitle:current.title,skuId:null,startsAt:session.startsAt.toISOString(),endsAt:session.endsAt.toISOString(),cancelDeadline:session.cancelDeadline.toISOString(),location:session.location,deliveryPolicy:'按照报名场次到场，由书院核销并记录实际交付。',refundPolicy,scheduleVersion:session.scheduleVersion,offerId:offer.id,offerVersion:offer.version,price:String(offer.price),quantity:dto.quantity,platform:dto.platform};
      if(source)priority={...source,memberOpenAt:session.memberOpenAt!.toISOString(),publicOpenAt:session.publicOpenAt.toISOString()};
      memberBenefit=await eventMemberPrice(tx,userId,event.id,event.category,offer.id,(offer.policySnapshot as {memberDiscountEligible?:boolean}).memberDiscountEligible===true,offer.price*BigInt(dto.quantity));
    }
    const originalTotal=BigInt(snapshot.price)*BigInt(dto.quantity);if(originalTotal<=0n||originalTotal>1000000000n)throw new BadRequestException('免费服务请直接报名；付费总额须在允许范围内');
    const discount=memberBenefit?BigInt(memberBenefit.savings):0n,total=originalTotal-discount;
    if(memberBenefit)snapshot={...snapshot,memberBenefit,originalTotal:String(originalTotal),discount:String(discount),total:String(total),...(total===0n?{refundPolicy:'本次使用会员服务或活动权益，无需付款，不产生现金退款。取消截止前且未签到可自助取消；书院取消自动释放名额，延期须本人确认，不方便参加可退出。已确认报名不因会员到期取消。'}:{})};
    return{snapshot,available,cutoff,isDemo,priority,memberBenefit,originalTotal,discount,total,quoteHash:hash({consumptionRule:consumptionPolicy,userId,snapshot,priority:priority??null})};
  }
  async quote(userId:string,dto:QuoteDto){
    const held=(await this.db.$queryRaw<{id:string;quoteHash:string;itemSnapshot:Prisma.JsonValue;payableTotal:bigint}[]>`SELECT o.id,o."quoteHash",i."itemSnapshot",o."payableTotal" FROM "TradeOrder" o JOIN "TradeOrderItem" i ON i."orderId"=o.id WHERE o."userId"=${userId} AND o.kind IN ('CONSULTATION','EVENT') AND o.state='PENDING' AND i."itemSnapshot"->>'resourceId'=${dto.resourceId} AND i."itemSnapshot"->>'kind'=${dto.kind} ORDER BY o."createdAt" DESC LIMIT 1`)[0];
    if(held)return safe({...held.itemSnapshot as Prisma.JsonObject,total:held.payableTotal,quoteHash:held.quoteHash,available:0,serverTime:new Date(),pendingOrderId:held.id,paymentEnabled:false,channels:this.channels.choices().map(c=>({...c,enabled:false})),unavailableReason:'已有本场次待支付订单，请先查看与处理，勿重复占位'});
    const result=await this.db.$transaction(tx=>this.resource(tx,dto,userId)),choices=this.channels.choices(),paymentEnabled=result.total>0n&&this.enabled(dto.platform)&&!result.isDemo&&result.available>=dto.quantity&&choices.some(c=>c.enabled);
    const pending=await this.db.tradeOrder.findFirst({where:{userId,kind:dto.kind==='appointment'?'CONSULTATION':'EVENT',state:'PENDING',quoteHash:result.quoteHash},orderBy:{createdAt:'desc'}});
    return safe({...result.snapshot,benefitConfirmationEnabled:result.total===0n&&!result.isDemo&&result.available>=dto.quantity,total:result.total,quoteHash:result.quoteHash,available:result.available,serverTime:new Date(),pendingOrderId:pending?.id??null,paymentEnabled,channels:choices.map(c=>({...c,enabled:c.enabled&&paymentEnabled})),unavailableReason:result.total===0n&&!result.isDemo&&result.available>=dto.quantity?'会员活动权益可免费报名，确认后保留名额，无需付款':result.isDemo?'规范示例仅供预览，不能真实收款':dto.platform!=='ANDROID'?'此平台的预约活动支付尚未验收，暂不收费':result.available<dto.quantity?'剩余名额不足':paymentEnabled?'':'预约活动正式支付尚未开放'});
  }
  async checkout(userId:string,dto:CheckoutDto){
    if(!dto.contactConsent)throw new BadRequestException('请授权负责老师或书院使用本次联系信息');
    if(!this.enabled(dto.platform))throw new ServiceUnavailableException('此平台的预约活动支付尚未开放');this.channels.resolve(dto.channel).identity();
    const requestHash=hash({...dto,requestKey:undefined,name:dto.name.trim()});
    const order=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR NO KEY UPDATE`;
      if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ForbiddenException('账号不可用');
      const old=await tx.tradeOrder.findFirst({where:{userId,requestKey:dto.requestKey}});if(old){if(!kinds.includes(old.kind)||old.requestHash!==requestHash)throw new ConflictException('此请求编号已用于其他订单');return old;}
      if(await tx.appointment.count({where:{userId,requestKey:dto.requestKey}})||await tx.eventRegistration.count({where:{userId,requestKey:dto.requestKey}}))throw new ConflictException('此请求编号已用于已有预约或报名');
      const r=await this.resource(tx,dto,userId,true);if(r.isDemo)throw new BadRequestException('示例服务或活动不能真实购买');if(r.quoteHash!==dto.quoteHash)throw new ConflictException('价格、安排或权益已变化，请重新确认');if(r.available<dto.quantity)throw new ConflictException('名额不足，请重新选择');
      if(r.total===0n)throw new BadRequestException('会员活动权益可免费报名，请使用权益确认入口，无需付款');
      const now=new Date(),expiresAt=new Date(Math.min(+now+15*60000,+r.cutoff,r.memberBenefit?Date.parse(r.memberBenefit.endsAt):Infinity)),s=r.snapshot;
      const row=await tx.tradeOrder.create({data:{orderNo:'B'+randomUUID().replaceAll('-','').slice(0,31),userId,kind:dto.kind==='appointment'?'CONSULTATION':'EVENT',requestKey:dto.requestKey,requestHash,currency:'CNY',subtotal:r.originalTotal,discountTotal:r.discount,payableTotal:r.total,pricingSnapshot:{platform:dto.platform,channel:dto.channel,memberBenefit:r.memberBenefit},quoteHash:dto.quoteHash,expiresAt}});
      const item=await tx.tradeOrderItem.create({data:{orderId:row.id,lineNo:1,offerId:s.offerId,quantity:dto.quantity,unitPrice:BigInt(s.price),subtotal:r.originalTotal,discountAllocated:r.discount,payable:r.total,itemSnapshot:s,benefitSnapshot:{priority:r.priority??null},...(dto.kind==='appointment'?{slotId:dto.resourceId}:{}),state:'PENDING'}});
      await freezeBookingMemberPrice(tx,userId,'booking.price:'+row.id,r.memberBenefit,dto.quantity);
      const contact={name:dto.name.trim(),phone:dto.phone,consentedAt:now.toISOString()};
      if(dto.kind==='appointment'){
        await tx.appointment.create({data:{userId,slotId:dto.resourceId,orderItemId:item.id,requestKey:dto.requestKey,state:'PENDING',acceptedScheduleVersion:s.scheduleVersion,contactCipher:encryptPrivate(JSON.stringify(contact)),serviceSnapshot:{...s,cancelBeforeMinutes:(Date.parse(s.startsAt)-Date.parse(s.cancelDeadline))/60000}}});
        await tx.appointmentSlot.update({where:{id:dto.resourceId},data:{reserved:{increment:1},version:{increment:1}}});
      }else{
        await tx.eventRegistration.create({data:{userId,courseReleaseId:s.offline?.releaseId??null,ticketTypeId:dto.resourceId,orderItemId:item.id,requestKey:dto.requestKey,quantity:dto.quantity,state:'PENDING',acceptedScheduleVersion:s.scheduleVersion,attendeeSnapshotCipher:encryptPrivate(JSON.stringify({...s,...contact})),checkinHash:hash(randomUUID()),...(r.priority?{prioritySnapshot:r.priority}:{})}});
        await tx.eventTicketType.update({where:{id:dto.resourceId},data:{reserved:{increment:dto.quantity},version:{increment:1}}});
      }
      await tx.inventoryReservation.create({data:{orderItemId:item.id,...(dto.kind==='appointment'?{slotId:dto.resourceId}:{eventTicketId:dto.resourceId}),quantity:dto.quantity,expiresAt,requestKey:'booking.reserve:'+item.id}});
      await tx.outboxJob.create({data:{eventKey:'booking.expire:'+row.id,kind:'BOOKING_PAYMENT_CHECK',aggregateType:'BOOKING_ORDER',aggregateId:row.id,payload:{},availableAt:expiresAt}});
      await tx.auditLog.create({data:{actorId:userId,action:'booking.order.create',resource:'trade_order',resourceId:row.id,changes:{amount:String(r.total),kind:dto.kind,resourceId:dto.resourceId}}});return row;
    });return this.detail(order.id,userId);
  }
  async confirmBenefit(userId:string,dto:ConfirmationDto){
    if(dto.kind==='appointment')return this.confirmConsultationBenefit(userId,dto);
    if(!dto.contactConsent)throw new BadRequestException('请核对活动报名并授权本次联系信息');
    const requestDigest=hash({...dto,requestKey:undefined,name:dto.name.trim()});
    return this.db.$transaction(async tx=>{
      if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR NO KEY UPDATE`).length)throw new ForbiddenException('账号不可用');
      const old=await tx.eventRegistration.findFirst({where:{userId,requestKey:dto.requestKey}});
      if(old){if(JSON.parse(decryptPrivate(old.attendeeSnapshotCipher)).requestDigest!==requestDigest)throw new ConflictException('请求编号已用于其他报名');return{id:old.id,state:old.state,kind:'registration'};}
      if(await tx.tradeOrder.count({where:{userId,requestKey:dto.requestKey}})||await tx.appointment.count({where:{userId,requestKey:dto.requestKey}}))throw new ConflictException('请求编号已用于其他订单或预约');
      const r=await this.resource(tx,dto,userId,true);if(r.isDemo||r.available<dto.quantity)throw new ConflictException('活动不可报名或剩余名额不足');
      if(r.quoteHash!==dto.quoteHash)throw new ConflictException('会员权益、价格或安排已变化，请刷新后确认');
      if(r.total!==0n||!r.memberBenefit)throw new ConflictException('当前不能免费报名，请重新确认报价');
      const id=randomUUID(),snapshot={...r.snapshot,price:0,originalPrice:r.snapshot.price,name:dto.name.trim(),phone:dto.phone,consentedAt:new Date().toISOString(),requestDigest};
      await freezeBookingMemberPrice(tx,userId,'event.price:'+id,r.memberBenefit,dto.quantity,'CONSUMED');
      const row=await tx.eventRegistration.create({data:{id,userId,courseReleaseId:r.snapshot.offline?.releaseId??null,ticketTypeId:dto.resourceId,requestKey:dto.requestKey,quantity:dto.quantity,state:'CONFIRMED',acceptedScheduleVersion:r.snapshot.scheduleVersion,attendeeSnapshotCipher:encryptPrivate(JSON.stringify(snapshot)),checkinHash:hash(randomUUID()),confirmedAt:new Date(),...(r.priority?{prioritySnapshot:r.priority}:{})}});
      await tx.eventTicketType.update({where:{id:dto.resourceId},data:{confirmed:{increment:dto.quantity},version:{increment:1}}});
      await tx.notification.create({data:{userId,kind:'BOOKING',registrationId:id,eventKey:'booking.member-free:'+id,title:'会员活动报名已确认',body:'本次使用会员活动权益，无需付款；请在我的预约查看安排和核销凭证。'}});
      await tx.auditLog.create({data:{actorId:userId,action:'booking.member-free.confirm',resource:'event_registration',resourceId:id,changes:{ticketTypeId:dto.resourceId,quantity:dto.quantity,memberBenefit:r.memberBenefit,originalAmount:String(r.originalTotal),payable:'0'}}});return{id:row.id,state:row.state,kind:'registration'};
    });
  }
  private async confirmConsultationBenefit(userId:string,dto:ConfirmationDto){
    if(!dto.contactConsent)throw new BadRequestException('请授权本次服务联系信息');
    const requestDigest=hash({...dto,requestKey:undefined,name:dto.name.trim()});
    return this.db.$transaction(async tx=>{
      if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR NO KEY UPDATE`).length)throw new ForbiddenException('账号不可用');
      const prior=await tx.appointment.findFirst({where:{userId,requestKey:dto.requestKey}});if(prior){if((prior.serviceSnapshot as {requestDigest?:string}).requestDigest!==requestDigest)throw new ConflictException('编号已用于另一预约');return{id:prior.id,state:prior.state,kind:'appointment'};}
      if(await tx.tradeOrder.count({where:{userId,requestKey:dto.requestKey}})||await tx.eventRegistration.count({where:{userId,requestKey:dto.requestKey}}))throw new ConflictException('编号已用于其他订单或报名');
      const r=await this.resource(tx,dto,userId,true);if(r.total!==0n||r.memberBenefit?.code!=='CONSULTATION_CREDIT'||r.available<1||r.isDemo||r.quoteHash!==dto.quoteHash)throw new ConflictException('咨询额度、时段或报价已变化，请重新确认');
      if(await tx.appointment.count({where:{userId,slotId:dto.resourceId,state:{notIn:['CANCELLED','REFUNDED']}}}))throw new ConflictException('已经预约该时段');
      const id=randomUUID();await freezeBookingMemberPrice(tx,userId,'consult.price:'+id,r.memberBenefit,1,'HELD');
      const usage=await tx.benefitUsage.findFirstOrThrow({where:{businessKey:'consult.price:'+id}});
      const row=await tx.appointment.create({data:{id,userId,benefitUsageId:usage.id,slotId:dto.resourceId,requestKey:dto.requestKey,state:'CONFIRMED',acceptedScheduleVersion:r.snapshot.scheduleVersion,contactCipher:encryptPrivate(JSON.stringify({name:dto.name.trim(),phone:dto.phone,consentedAt:new Date().toISOString()})),serviceSnapshot:{...r.snapshot,price:0,originalPrice:r.snapshot.price,requestDigest,cancelBeforeMinutes:(Date.parse(r.snapshot.startsAt)-Date.parse(r.snapshot.cancelDeadline))/60000}}});
      await tx.appointmentSlot.update({where:{id:dto.resourceId},data:{confirmed:{increment:1},version:{increment:1}}});
      await tx.notification.create({data:{userId,kind:'BOOKING',appointmentId:id,eventKey:'consult.member-free:'+id,title:'会员咨询预约已确认',body:'本次已预留原会员咨询额度，实际服务后计次，取消或未交付按原份额返还。'}});
      await tx.auditLog.create({data:{actorId:userId,action:'consultation.member.confirm',resource:'appointment',resourceId:id,changes:{benefit:r.memberBenefit,originalAmount:String(r.originalTotal)}}});return{id:row.id,state:row.state,kind:'appointment'};
    });
  }
  private async owned(id:string,userId?:string){const row=await this.db.tradeOrder.findFirst({where:{id,...(userId?{userId}:{}),kind:{in:kinds}}});if(!row)throw new NotFoundException('预约活动订单不存在');return row;}
  private async lockResource(tx:Tx,s:Snapshot){
    if(s.kind==='appointment'){await tx.$queryRaw`SELECT id FROM "ServiceOffering" WHERE id=${s.parentId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "AppointmentSlot" WHERE id=${s.resourceId} FOR UPDATE`;}
    else{const session=await tx.eventSession.findUniqueOrThrow({where:{id:s.parentId}});await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${session.eventId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "EventSession" WHERE id=${s.parentId} FOR UPDATE`;}
  }
  private async booking(tx:Tx|Database,itemId:string,s:Snapshot){return s.kind==='appointment'?tx.appointment.findUniqueOrThrow({where:{orderItemId:itemId}}):tx.eventRegistration.findUniqueOrThrow({where:{orderItemId:itemId}});}
  private async currentSchedule(tx:Tx|Database,s:Snapshot){
    const row=s.kind==='appointment'?await tx.appointmentSlot.findUniqueOrThrow({where:{id:s.resourceId}}):await tx.eventSession.findUniqueOrThrow({where:{id:s.parentId}});
    return {startsAt:row.startsAt.toISOString(),endsAt:row.endsAt.toISOString(),scheduleVersion:row.scheduleVersion,changeReason:row.changeReason,cancelled:row.state==='CANCELLED',location:'location' in row?row.location:s.location};
  }
  private returnReason(s:Snapshot,schedule:Awaited<ReturnType<BookingSalesService['currentSchedule']>>,acceptedVersion:number){
    if(schedule.cancelled)return 'BOOKING_CANCELLED';
    if(schedule.scheduleVersion>s.scheduleVersion)return acceptedVersion<schedule.scheduleVersion||Date.parse(schedule.startsAt)>Date.now()?'BOOKING_SCHEDULE_RETURN':null;
    return Date.parse(schedule.startsAt)>Date.now()&&Date.parse(s.cancelDeadline)>Date.now()?'BOOKING_RETURN':null;
  }
  private async assessment(tx:Tx,s:Snapshot,itemId:string,paidAmount:bigint,original?:Assessment){
    const row=await this.booking(tx,itemId,s),schedule=await this.currentSchedule(tx,s),checkedCount=s.kind==='registration'?await tx.eventCheckin.count({where:{registrationId:row.id,revokedAt:null}}):0;
    return {assessedAt:new Date().toISOString(),originalState:original?.originalState??row.state,originalBookingVersion:original?.originalBookingVersion??row.version,scheduleVersion:schedule.scheduleVersion,startsAt:schedule.startsAt,endsAt:schedule.endsAt,quantity:s.quantity,checkedCount,paidAmount:String(paidAmount),withdrawalScope:'退出本次整单剩余服务，保留已有参加与交付记录；退款金额经核查并由学员确认'} satisfies Assessment;
  }
  private async pause(tx:Tx,itemId:string,s:Snapshot){
    if(s.kind==='appointment')await tx.appointment.update({where:{orderItemId:itemId},data:{state:'CANCEL_PENDING',version:{increment:1}}});else await tx.eventRegistration.update({where:{orderItemId:itemId},data:{state:'CANCEL_PENDING',version:{increment:1}}});
  }
  private async restore(tx:Tx,itemId:string,s:Snapshot,refund:{reasonCode:string;assessmentSnapshot:Prisma.JsonValue}){
    const schedule=await this.currentSchedule(tx,s);if(schedule.cancelled)throw new ConflictException('原安排已取消，不能恢复预约，请继续全额退款');
    const state=refund.reasonCode==='BOOKING_DISPUTE'?(refund.assessmentSnapshot as unknown as Assessment).originalState:'CONFIRMED';
    if(!['CONFIRMED','COMPLETED',...(s.kind==='appointment'?['NO_SHOW']:[])].includes(state))throw new ConflictException('原报名状态不能恢复，请核查');
    if(s.kind==='appointment')await tx.appointment.update({where:{orderItemId:itemId},data:{state,version:{increment:1}}});else await tx.eventRegistration.update({where:{orderItemId:itemId},data:{state,version:{increment:1}}});
  }
  private async ready(tx:Tx|Database,s:Snapshot,userId:string,at=new Date()){
    if(s.kind==='appointment'){
      const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:s.resourceId}}),offering=await tx.serviceOffering.findUniqueOrThrow({where:{id:s.parentId}}),teacher=await tx.teacher.findUniqueOrThrow({where:{id:offering.teacherId}});
      const sku=s.skuId?await tx.productSku.findUnique({where:{id:s.skuId},include:{product:true}}):null;
      return slot.state==='OPEN'&&slot.scheduleVersion===s.scheduleVersion&&slot.startsAt>new Date()&&offering.active&&teacher.status==='PUBLISHED'&&!teacher.isDemo&&(!s.skuId||!!sku?.active&&sku.product.status==='PUBLISHED'&&!sku.product.isDemo&&sku.serviceOfferingId===offering.id);
    }
    const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:s.resourceId}}),session=await tx.eventSession.findUniqueOrThrow({where:{id:s.parentId}}),event=await tx.event.findUniqueOrThrow({where:{id:session.eventId}});
    const priorityAllowed=session.publicOpenAt<=new Date()||!!session.memberOpenAt&&session.memberOpenAt<=new Date()&&!!await eventPrioritySource(tx,userId,event.id,at);
    return await offlineOrderReady(tx,session.id,s.offline?.releaseId)&&priorityAllowed&&ticket.active&&session.state==='OPEN'&&session.scheduleVersion===s.scheduleVersion&&session.startsAt>new Date()&&event.status==='PUBLISHED'&&!event.isDemo;
  }
  private async move(tx:Tx,itemId:string,s:Snapshot,to:'CONVERTED'|'RELEASED'){
    const reservation=await tx.inventoryReservation.findFirstOrThrow({where:{orderItemId:itemId}});if(reservation.state!=='HELD')return;
    if(s.kind==='appointment')await tx.appointmentSlot.update({where:{id:s.resourceId},data:{reserved:{decrement:s.quantity},...(to==='CONVERTED'?{confirmed:{increment:s.quantity}}:{}),version:{increment:1}}});
    else await tx.eventTicketType.update({where:{id:s.resourceId},data:{reserved:{decrement:s.quantity},...(to==='CONVERTED'?{confirmed:{increment:s.quantity}}:{}),version:{increment:1}}});
    await tx.inventoryReservation.update({where:{id:reservation.id},data:{state:to,...(to==='CONVERTED'?{convertedAt:new Date()}:{releasedAt:new Date()}),version:{increment:1}}});
  }
  private async notice(tx:Tx,order:TradeOrder,s:Snapshot,eventKey:string,title:string,body:string,teacher=false){
    const booking=await this.booking(tx,(await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}})).id,s),target=teacher&&s.teacherId?(await tx.teacher.findUnique({where:{id:s.teacherId},select:{userId:true}}))?.userId:order.userId;
    if(target)await tx.notification.create({data:{userId:target,kind:teacher?'BOOKING_STAFF':'BOOKING',orderId:teacher?null:order.id,...(s.kind==='appointment'?{appointmentId:booking.id}:{registrationId:booking.id}),eventKey:teacher?eventKey+':teacher':eventKey,title,body}});
  }
  private async closeLocal(tx:Tx,order:TradeOrder,s:Snapshot,itemId:string,reason:string){
    await this.move(tx,itemId,s,'RELEASED');await finishBookingMemberPrice(tx,'booking.price:'+order.id,'RELEASED');
    if(s.kind==='appointment')await tx.appointment.update({where:{orderItemId:itemId},data:{state:'CANCELLED',cancelReason:reason,version:{increment:1}}});
    else await tx.eventRegistration.update({where:{orderItemId:itemId},data:{state:'CANCELLED',cancelledAt:new Date(),version:{increment:1}}});
    await tx.tradeOrder.update({where:{id:order.id},data:{state:'CLOSED',closedAt:new Date(),closeReason:reason,version:{increment:1}}});
    await tx.tradeOrderItem.update({where:{id:itemId},data:{state:'CLOSED'}});await tx.paymentAttempt.updateMany({where:{orderId:order.id},data:{state:'CLOSED'}});
  }
  async detail(id:string,userId?:string){
    const order=await this.owned(id,userId),item=await this.db.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),snapshot=item.itemSnapshot as unknown as Snapshot,booking=await this.booking(this.db,item.id,snapshot),attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}}),channel=(order.pricingSnapshot as {channel:AppPaymentChannel}).channel;
    const refunds=await this.db.refund.findMany({where:{orderId:id},orderBy:{createdAt:'desc'},select:{id:true,state:true,version:true,reasonCode:true,paymentTransactionId:true,description:true,requestedAmount:true,approvedAmount:true,reviewNote:true,createdAt:true,failureCode:true,assessmentSnapshot:true,acceptedAt:true}}),checked=!attempt||!!attempt.lastQueriedAt&&attempt.lastQueriedAt>=attempt.updatedAt&&!attempt.failureCode;
    const canPay=order.state==='PENDING'&&order.expiresAt>new Date()&&checked&&this.enabled('ANDROID')&&this.channels.resolve(channel).availability().enabled&&await this.ready(this.db,snapshot,order.userId)&&await bookingMemberPriceReady(this.db,order.userId,'booking.price:'+id,snapshot.memberBenefit);
    const checks=snapshot.kind==='registration'?await this.db.eventCheckin.count({where:{registrationId:booking.id,revokedAt:null}}):0;
    const accepted=await this.db.paymentTransaction.findFirst({where:{orderId:id,disposition:'ACCEPTED'},select:{id:true}});
    const schedule=await this.currentSchedule(this.db,snapshot),refundReason=this.returnReason(snapshot,schedule,booking.acceptedScheduleVersion),canRefund=order.state==='PAID'&&order.refundedTotal===0n&&booking.state==='CONFIRMED'&&!!refundReason&&!checks&&!refunds.some(r=>r.paymentTransactionId===accepted?.id&&!['REJECTED','CANCELLED'].includes(r.state)),current=['CONFIRMED','CANCEL_PENDING'].includes(booking.state)?schedule:booking.scheduleSnapshot?booking.scheduleSnapshot as unknown as typeof schedule:{startsAt:snapshot.startsAt,endsAt:snapshot.endsAt,location:snapshot.location,scheduleVersion:snapshot.scheduleVersion};
    const canDispute=['PAID','COMPLETED'].includes(order.state)&&order.refundedTotal===0n&&['CONFIRMED','COMPLETED','NO_SHOW'].includes(booking.state)&&!!accepted&&!refunds.some(r=>r.paymentTransactionId===accepted.id&&!['REJECTED','CANCELLED'].includes(r.state));
    return safe({id,orderNo:order.orderNo,state:order.state,version:order.version,amount:order.payableTotal,paidAmount:order.paidTotal,refundedAmount:order.refundedTotal,createdAt:order.createdAt,expiresAt:order.expiresAt,paidAt:order.paidAt,serverTime:new Date(),closeReason:order.closeReason,channel,booking:{...snapshot,id:booking.id,state:booking.state,originalStartsAt:snapshot.startsAt,originalEndsAt:snapshot.endsAt,originalLocation:snapshot.location,...current,changeReason:('scheduleVersion' in current?current.scheduleVersion:schedule.scheduleVersion)>snapshot.scheduleVersion?('changeReason' in current?current.changeReason:null):null,schedulePending:booking.state==='CONFIRMED'&&!schedule.cancelled&&booking.acceptedScheduleVersion<schedule.scheduleVersion,cancelDeadline:refundReason==='BOOKING_SCHEDULE_RETURN'?schedule.startsAt:snapshot.cancelDeadline},delivery:await serviceDeliverySummary(this.db,id),canPay,canCancel:order.state==='PENDING',canRefund,canDispute,refundReason,paymentStatus:order.state!=='PENDING'?order.state:order.expiresAt<=new Date()?'EXPIRED':!checked?'CHECK_REQUIRED':canPay?'READY':'UNAVAILABLE',refunds});
  }
  async list(userId:string|undefined,q:PageQuery){const where={...(userId?{userId}:{}),kind:{in:kinds},...(q.state?{state:q.state}:{}),...(q.q?{orderNo:{contains:q.q}}:{})},[rows,total]=await this.db.$transaction([this.db.tradeOrder.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.size,take:q.size}),this.db.tradeOrder.count({where})]);return{items:await Promise.all(rows.map(r=>this.detail(r.id,userId))),total};}
  async prepay(id:string,userId:string){
    const order=await this.owned(id,userId),channel=(order.pricingSnapshot as {channel:AppPaymentChannel}).channel;this.channels.resolve(channel).identity();
    const snapshot=await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const row=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
      if(!await bookingMemberPriceReady(tx,userId,'booking.price:'+id,s.memberBenefit))throw new ConflictException('会员活动优惠已失效，请取消后重新确认');
      if(!this.enabled(s.platform)||row.state!=='PENDING'||row.expiresAt<=new Date()||!await this.ready(tx,s,order.userId))throw new ConflictException('订单或服务已不可支付，请刷新');
      if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ForbiddenException('账号不可用');
      const old=await tx.paymentAttempt.findFirst({where:{orderId:id}});
      if(old?.state==='CREATED'&&Date.now()-old.updatedAt.getTime()<30000)throw new ConflictException('正在发起支付，请稍后查询');
      if(old&&(!old.lastQueriedAt||old.lastQueriedAt<old.updatedAt||old.failureCode))throw new ConflictException('请先查询上次支付结果，勿重复付款');
      if(old)await tx.paymentAttempt.update({where:{id:old.id},data:{state:'CREATED',updatedAt:new Date()}});else await tx.paymentAttempt.create({data:{orderId:id,channel,requestKey:'booking.pay:'+id,externalRequestId:order.orderNo,state:'CREATED',amount:order.payableTotal,currency:'CNY',expiresAt:order.expiresAt}});return s;
    });
    try{const orderInfo=await this.channels.resolve(channel).prepay(order.orderNo,snapshot.title,Number(order.payableTotal),order.expiresAt);await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING'}});return{orderId:id,channel,provider:channel==='WECHAT_APP'?'wxpay':'alipay',orderInfo,amount:String(order.payableTotal)};}
    catch(e){await this.db.paymentAttempt.updateMany({where:{orderId:id,state:'CREATED'},data:{state:'PENDING',failureCode:'PROVIDER_RESULT_UNKNOWN'}});throw e;}
  }
  async cancel(id:string,userId:string,reason='USER_CANCEL'){
    const order=await this.owned(id,userId);if(order.state==='CLOSED')return this.detail(id,userId);if(order.state!=='PENDING')throw new ConflictException('已付款订单请申请退款');
    // Hold the order while checking/closing the provider: a concurrent prepay cannot start after the check.
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}});if(current.state==='CLOSED')return;if(current.state!=='PENDING')throw new ConflictException('订单已付款，请刷新');
      const attempt=await tx.paymentAttempt.findFirst({where:{orderId:id}});
      if(attempt){
        if(attempt.state==='CREATED'&&Date.now()-attempt.updatedAt.getTime()<30000)throw new ConflictException('支付正在发起，请稍后查询');
        const result=await this.channels.resolve(attempt.channel).query(order.orderNo);if(result.trade_state==='SUCCESS')throw new ConflictException('渠道已付款，请查询订单确认结果');
        if(!['NOTPAY','CLOSED','NOTFOUND'].includes(result.trade_state))throw new ConflictException('支付状态待确认，保留占位，请稍后查询');
        if(result.trade_state==='NOTPAY')await this.channels.resolve(attempt.channel).close(order.orderNo);
      }
      const item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);await this.closeLocal(tx,current,s,item.id,reason);
      await tx.outboxJob.updateMany({where:{eventKey:'booking.expire:'+id},data:{state:'DONE',lockedUntil:null,completedAt:new Date()}});
      await tx.auditLog.create({data:{actorId:userId,action:'booking.order.close',resource:'trade_order',resourceId:id,reason,changes:{state:'CLOSED'}}});
    },{timeout:20000});return this.detail(id,userId);
  }
  async refresh(id:string,userId:string){
    const order=await this.owned(id,userId),attempt=await this.db.paymentAttempt.findFirst({where:{orderId:id}});
    if(attempt&&order.state==='PENDING'){
      if(attempt.state==='CREATED'&&Date.now()-attempt.updatedAt.getTime()<30000)throw new ConflictException('支付正在发起，请稍后查询');
      const result=await this.channels.resolve(attempt.channel).query(order.orderNo);
      if(result.trade_state==='SUCCESS')await this.confirmPayment(result,undefined,attempt.channel as AppPaymentChannel);
      else if(['NOTPAY','CLOSED','NOTFOUND'].includes(result.trade_state)){
        await this.db.paymentAttempt.updateMany({where:{id:attempt.id,updatedAt:attempt.updatedAt,state:attempt.state},data:{lastQueriedAt:new Date(),failureCode:null}});
        if(order.expiresAt<=new Date()||result.trade_state==='CLOSED')await this.cancel(id,userId,order.expiresAt<=new Date()?'TIMEOUT':'PROVIDER_CLOSED');
      }else throw new ConflictException('支付渠道结果待确认，请稍后查询');
    }else if(order.state==='PENDING'&&order.expiresAt<=new Date())await this.cancel(id,userId,'TIMEOUT');
    for(const refund of await this.db.refund.findMany({where:{orderId:id,state:'REFUNDING'}})){const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}});await this.confirmRefund(await this.channels.resolve(payment.channel).queryRefund(refund.channelRequestKey!,{transactionId:payment.externalTransactionId,orderNo:order.orderNo,total:Number(payment.amount)}),payment.channel as AppPaymentChannel);}
    return this.detail(id,userId);
  }
  private async journal(tx:Tx,order:TradeOrder,paymentId:string,amount:bigint,incoming:boolean,anomaly:boolean,channel:AppPaymentChannel,refundId?:string){
    const journal=await tx.financeJournal.create({data:{eventKey:incoming?'booking.payment:'+paymentId:'booking.refunded:'+refundId,kind:incoming?'BOOKING_PAYMENT':'BOOKING_REFUND',orderId:order.id,transactionId:paymentId,refundId,currency:'CNY',postedAt:new Date(),description:incoming?'预约活动已验证收款':'预约活动已验证退款'}}),income=anomaly?'BOOKING_REFUND_PAYABLE':'BOOKING_ADVANCE',receivable=channel==='WECHAT_APP'?'WECHAT_RECEIVABLE':'ALIPAY_RECEIVABLE';
    if(!incoming&&!anomaly)await serviceRefundEntries(tx,order,journal.id,receivable,amount);else await tx.financeEntry.createMany({data:[{journalId:journal.id,accountCode:incoming?receivable:income,debit:amount,userId:order.userId},{journalId:journal.id,accountCode:incoming?income:receivable,credit:amount,userId:order.userId}]});
  }
  private async refundJob(tx:Tx,id:string){await tx.outboxJob.upsert({where:{eventKey:'booking.refund:'+id},create:{eventKey:'booking.refund:'+id,kind:'BOOKING_REFUND',aggregateType:'BOOKING_REFUND',aggregateId:id,payload:{},availableAt:new Date()},update:{state:'READY',availableAt:new Date(),lockedUntil:null,lastErrorCode:null,attempts:0}});}
  async confirmPayment(data:WechatTransaction,callback?:{id:string;payloadHash:string},channel:AppPaymentChannel='WECHAT_APP'){
    const identity=this.channels.resolve(channel).identity();
    if(data.appid!==identity.appid||data.mchid!==identity.mchid||data.trade_type!=='APP'||data.trade_state!=='SUCCESS'||typeof data.transaction_id!=='string'||!data.transaction_id||data.transaction_id.length>128||!Number.isSafeInteger(data.amount?.total)||data.amount!.total<=0||data.amount!.currency!=='CNY'||!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('预约活动收款事实无效');
    const initial=await this.db.tradeOrder.findUnique({where:{orderNo:data.out_trade_no}});if(!initial||!kinds.includes(initial.kind))throw new NotFoundException('预约活动订单不存在');
    return this.db.$transaction(async tx=>{
      await this.lock(tx,initial);const order=await tx.tradeOrder.findUniqueOrThrow({where:{id:initial.id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
      const old=await tx.paymentTransaction.findFirst({where:{channel,appScope:identity.appid,externalTransactionId:data.transaction_id}});if(old){if(old.orderId!==order.id||old.amount!==BigInt(data.amount!.total))throw new ConflictException('交易已绑定其他付款');return{disposition:old.disposition};}
      const attempt=await tx.paymentAttempt.findFirst({where:{orderId:order.id,channel}});if(!attempt)throw new BadRequestException('无对应渠道支付尝试');
      const existing=await tx.paymentTransaction.findFirst({where:{orderId:order.id,disposition:'ACCEPTED'}}),reservation=await tx.inventoryReservation.findFirstOrThrow({where:{orderItemId:item.id}}),booking=await this.booking(tx,item.id,s),amount=BigInt(data.amount!.total),paidAt=new Date(data.success_time!);
      const user=await tx.user.findUniqueOrThrow({where:{id:order.userId}});
      const disposition=amount!==order.payableTotal?'AMOUNT_MISMATCH':existing?'DUPLICATE':order.state==='CLOSED'||paidAt>order.expiresAt||reservation.state!=='HELD'?'LATE':order.state!=='PENDING'||booking.state!=='PENDING'||user.status!=='ACTIVE'||!await this.ready(tx,s,order.userId,paidAt)||!await bookingMemberPriceReady(tx,order.userId,'booking.price:'+order.id,s.memberBenefit,paidAt)?'REFUND_REQUIRED':'ACCEPTED';
      const payment=await tx.paymentTransaction.create({data:{attemptId:attempt.id,orderId:order.id,channel,appScope:identity.appid,externalTransactionId:data.transaction_id!,amount,currency:'CNY',verifiedAt:new Date(),paidAt,disposition,receiptHash:hash(data)}});await this.journal(tx,order,payment.id,amount,true,disposition!=='ACCEPTED',channel);
      if(disposition==='ACCEPTED'){
        await this.move(tx,item.id,s,'CONVERTED');await finishBookingMemberPrice(tx,'booking.price:'+order.id,'CONSUMED');
        if(s.kind==='appointment')await tx.appointment.update({where:{id:booking.id},data:{state:'CONFIRMED',confirmedAt:new Date(),version:{increment:1}}});else await tx.eventRegistration.update({where:{id:booking.id},data:{state:'CONFIRMED',confirmedAt:new Date(),version:{increment:1}}});
        await tx.tradeOrder.update({where:{id:order.id},data:{state:'PAID',paidAt,paidTotal:amount,version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{state:'PAID'}});await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED'}});
        await this.notice(tx,order,s,'booking.paid:'+order.id,'预约 / 报名已确认','付款已确认，请在我的预约查看时间与服务说明。');if(s.kind==='appointment')await this.notice(tx,order,s,'booking.paid:'+order.id,'新增已付款预约','请在服务工作台查看安排和学员授权联系信息。',true);
      }else{
        if(!existing){await this.closeLocal(tx,order,s,item.id,disposition);await tx.paymentAttempt.update({where:{id:attempt.id},data:{state:'SUCCEEDED'}});}
        const refund=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'booking.anomaly:'+payment.id,kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:amount,approvedAmount:amount,reasonCode:disposition,description:'异常收款自动原路退回，不重复确认预约或报名',paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});
        await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:s.quantity,amount,revokeQuantity:0}});await this.refundJob(tx,refund.id);await this.notice(tx,order,s,'booking.anomaly:'+payment.id,'本次收款需原路退回','本次收款未形成新的预约，正在办理原路退款；请查看订单进度。');
      }
      if(callback)await tx.providerCallback.create({data:{provider:channel,appScope:identity.appid,externalEventId:callback.id,kind:'TRANSACTION.SUCCESS',payloadHash:callback.payloadHash,payloadStorageRef:'sha256:'+callback.payloadHash,signatureVerified:true,state:'HANDLED',handledAt:new Date()}});
      await tx.outboxJob.updateMany({where:{eventKey:'booking.expire:'+order.id},data:{state:'DONE',completedAt:new Date(),lockedUntil:null}});
      await tx.auditLog.create({data:{actorId:order.userId,action:'booking.payment.confirm',resource:'trade_order',resourceId:order.id,changes:{paymentId:payment.id,source:channel+'_VERIFIED',disposition,amount:String(amount)}}});return{disposition};
    });
  }
  async requestRefund(id:string,userId:string,dto:RefundDto){
    const order=await this.owned(id,userId);await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
      const old=await tx.refund.findFirst({where:{userId,requestKey:dto.requestKey}});if(old){if(old.orderId!==id||old.description!==dto.reason.trim())throw new ConflictException('此编号已用于其他退款');return;}
      const booking=await this.booking(tx,item.id,s),payment=await tx.paymentTransaction.findFirst({where:{orderId:id,disposition:'ACCEPTED'}}),schedule=await this.currentSchedule(tx,s),reasonCode=this.returnReason(s,schedule,booking.acceptedScheduleVersion);
      if(current.state!=='PAID'||current.refundedTotal!==0n||booking.state!=='CONFIRMED'||!payment||!reasonCode||s.kind==='registration'&&await tx.eventCheckin.count({where:{registrationId:booking.id,revokedAt:null}}))throw new ConflictException('已超过取消截止或开始履约，请联系书院核查');
      if(await tx.refund.count({where:{orderId:id,paymentTransactionId:payment.id,state:{notIn:['REJECTED','CANCELLED']}}}))throw new ConflictException('已有退款申请，请查看办理进度');
      const automatic=reasonCode!=='BOOKING_RETURN',refund=await tx.refund.create({data:{orderId:id,userId,requestKey:dto.requestKey,kind:'REFUND_ONLY',state:automatic?'REFUNDING':'REQUESTED',requestedAmount:payment.amount,...(automatic?{approvedAmount:payment.amount}:{}),reasonCode,description:dto.reason.trim(),paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:s.quantity,amount:payment.amount,revokeQuantity:s.quantity}});
      if(automatic)await this.refundJob(tx,refund.id);
      if(s.kind==='appointment')await tx.appointment.update({where:{id:booking.id},data:{state:'CANCEL_PENDING',version:{increment:1}}});else await tx.eventRegistration.update({where:{id:booking.id},data:{state:'CANCEL_PENDING',version:{increment:1}}});
      await this.notice(tx,order,s,'booking.refund.request:'+refund.id,automatic?'安排变更退款正在办理':'退约申请已提交','审核与退款期间暂不能联系或签到，名额保留至渠道退款确认。');await tx.auditLog.create({data:{actorId:userId,action:'booking.refund.request',resource:'refund',resourceId:refund.id,changes:{orderId:id,reasonCode,automatic}}});
    });return this.detail(id,userId);
  }
  async requestDispute(id:string,userId:string,dto:RefundDto){
    const order=await this.owned(id,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
      const old=await tx.refund.findFirst({where:{userId,requestKey:dto.requestKey}});if(old){if(old.orderId!==id||old.reasonCode!=='BOOKING_DISPUTE'||old.description!==dto.reason.trim())throw new ConflictException('请求编号已用于其他申请');return;}
      const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),booking=await this.booking(tx,item.id,s),payment=await tx.paymentTransaction.findFirst({where:{orderId:id,disposition:'ACCEPTED'}});
      if(!['PAID','COMPLETED'].includes(current.state)||current.refundedTotal!==0n||!payment||!['CONFIRMED','COMPLETED','NO_SHOW'].includes(booking.state))throw new ConflictException('当前订单不能申请服务核查，请查看已有售后记录');
      if((await this.currentSchedule(tx,s)).cancelled)throw new ConflictException('书院已取消安排，将自动全额退款，请查询办理进度');
      if(await tx.refund.count({where:{paymentTransactionId:payment.id,state:{notIn:['REJECTED','CANCELLED']}}}))throw new ConflictException('已有售后申请，请查看办理进度');
      const assessment=await this.assessment(tx,s,item.id,payment.amount),refund=await tx.refund.create({data:{orderId:id,userId,requestKey:dto.requestKey,kind:'REFUND_ONLY',state:'REQUESTED',requestedAmount:payment.amount,reasonCode:'BOOKING_DISPUTE',description:dto.reason.trim(),paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31),assessmentSnapshot:assessment}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:s.quantity,amount:payment.amount,revokeQuantity:s.quantity}});await this.pause(tx,item.id,s);
      await this.notice(tx,order,s,'booking.dispute.request:'+refund.id,'服务核查已受理','核查期间暂停继续参加或联系；书院将说明退款金额及依据，由你确认后原路退回，现有参加记录保留。');
      await tx.auditLog.create({data:{actorId:userId,action:'booking.dispute.request',resource:'refund',resourceId:refund.id,changes:{orderId:id,assessment}}});
    });return this.detail(id,userId);
  }
  async rejectAppointment(id:string,req:AuthRequest,dto:BookingRejectDto){
    requireRoles(req,['OPERATOR','TEACHER']);const initial=await this.db.appointment.findUnique({where:{id}});if(!initial?.orderItemId)throw new NotFoundException('付费预约不存在');
    const item=await this.db.tradeOrderItem.findUniqueOrThrow({where:{id:initial.orderItemId}}),s=item.itemSnapshot as unknown as Snapshot,order=await this.owned(item.orderId);
    if(s.kind!=='appointment')throw new BadRequestException('此操作只处理老师服务预约');
    if(!req.actor.roles.some(r=>['ADMIN','OPERATOR'].includes(r))&&!await this.db.teacher.findFirst({where:{id:s.teacherId,userId:req.actor.id}}))throw new ForbiddenException('只能拒绝本人所属服务预约');
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);await this.lockResource(tx,s);const booking=await tx.appointment.findUniqueOrThrow({where:{id}}),schedule=await this.currentSchedule(tx,s),current=await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}});
      if(booking.version!==dto.expectedVersion||current.state!=='PAID'||current.refundedTotal!==0n||booking.state!=='CONFIRMED'||Date.parse(schedule.startsAt)<=Date.now()||schedule.cancelled)throw new ConflictException('预约已更新、正在售后或已开始，请联系财务处理核查');
      const payment=await tx.paymentTransaction.findFirstOrThrow({where:{orderId:order.id,disposition:'ACCEPTED'}});
      if(await tx.refund.count({where:{paymentTransactionId:payment.id,state:{notIn:['REJECTED','CANCELLED']}}}))throw new ConflictException('已有售后申请，不重复退款');
      const refund=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'booking.staff.reject:'+id+':'+dto.expectedVersion,kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:payment.amount,approvedAmount:payment.amount,reasonCode:'BOOKING_STAFF_REJECT',description:dto.reason.trim(),reviewerId:req.actor.id,paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:payment.amount,revokeQuantity:1}});await this.pause(tx,item.id,s);await tx.appointment.update({where:{id},data:{cancelReason:dto.reason.trim()}});await this.refundJob(tx,refund.id);
      await this.notice(tx,order,s,'booking.staff.reject:'+refund.id,'老师无法提供本次服务，原路退款办理中',dto.reason.trim()+'；整单实付全额退回，名额保留至渠道退款确认。');
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'booking.staff.reject',resource:'appointment',resourceId:id,reason:dto.reason.trim(),changes:{orderId:order.id,refundId:refund.id,amount:String(payment.amount)}}});
    });return {success:true};
  }
  async reviewRefund(id:string,req:AuthRequest,dto:ReviewDto){
    requireRoles(req,['FINANCE']);const initial=await this.db.refund.findUnique({where:{id}});if(!initial)throw new NotFoundException('退款申请不存在');const order=await this.owned(initial.orderId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const refund=await tx.refund.findUniqueOrThrow({where:{id}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
      if(refund.version!==dto.expectedVersion||(dto.action==='RETRY'?!['FAILED','REFUNDING'].includes(refund.state):refund.state!=='REQUESTED'))throw new ConflictException('退款状态已变化，请刷新');
      const dispute=refund.reasonCode==='BOOKING_DISPUTE';
      if(dto.action!=='RETRY'&&!['BOOKING_RETURN','BOOKING_DISPUTE'].includes(refund.reasonCode))throw new BadRequestException('异常、老师拒绝或安排变更退款只能继续退回');
      if(dto.approvedAmount!==undefined&&(dto.action!=='APPROVE'||!dispute))throw new BadRequestException('此操作不能调整退款金额');
      if(dto.action==='REJECT'&&(await this.currentSchedule(tx,s)).cancelled)throw new ConflictException('原安排已取消，不能拒绝退款或恢复预约');
      let amount=refund.approvedAmount??refund.requestedAmount,assessment=refund.assessmentSnapshot;
      if(dto.action==='APPROVE'&&dispute){
        if((await this.currentSchedule(tx,s)).cancelled)throw new ConflictException('书院已取消原安排，请查询自动全额退款，不能扣款协商');
        if(!dto.approvedAmount)throw new BadRequestException('请填写经核实、待学员确认的退款金额');amount=BigInt(dto.approvedAmount);
        const payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),current=await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}});
        if(amount<=0n||amount>payment.amount-current.refundedTotal||amount>refund.requestedAmount)throw new BadRequestException('拟退款不能超过原实付可退余额');
        assessment={...await this.assessment(tx,s,item.id,payment.amount,refund.assessmentSnapshot as unknown as Assessment),proposalAmount:String(amount),deductionAmount:String(payment.amount-amount),proposalVersion:refund.version+1,reviewNote:dto.reason.trim()};
        await tx.refundItem.updateMany({where:{refundId:id},data:{amount,version:{increment:1}}});
      }
      if(dto.action==='RETRY'&&dispute&&!refund.acceptedAt)throw new ConflictException('学员未确认方案，不能发起退款');
      const state=dto.action==='REJECT'?'REJECTED':dto.action==='APPROVE'&&dispute?'APPROVED':'REFUNDING';await tx.refund.update({where:{id},data:{state,approvedAmount:state==='REJECTED'?null:amount,...(assessment?{assessmentSnapshot:assessment}:{}),reviewerId:req.actor.id,reviewNote:dto.reason.trim(),failureCode:null,version:{increment:1},updatedAt:new Date()}});
      if(state==='REFUNDING')await this.refundJob(tx,id);else if(state==='REJECTED')await this.restore(tx,item.id,s,refund);
      await this.notice(tx,order,s,'booking.refund.review:'+id+':'+(refund.version+1),state==='REJECTED'?'退约申请未通过':state==='APPROVED'?'请确认服务退款方案':'退约申请正在办理',dto.reason.trim());await tx.auditLog.create({data:{actorId:req.actor.id,action:'booking.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:id,reason:dto.reason.trim(),changes:{state,amount:String(amount)}}});
    });return this.detail(order.id);
  }
  async decideRefund(orderId:string,id:string,userId:string,dto:RefundDecisionDto){
    const order=await this.owned(orderId,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
      const refund=await tx.refund.findFirst({where:{id,orderId,userId,reasonCode:'BOOKING_DISPUTE'}});if(!refund)throw new NotFoundException('退款方案不存在');
      const assessment=refund.assessmentSnapshot as unknown as Assessment;
      if(assessment.proposalVersion===dto.expectedVersion&&(dto.action==='ACCEPT'&&refund.acceptedAt||dto.action==='DECLINE'&&refund.state==='CANCELLED'))return;
      if(refund.state!=='APPROVED'||refund.version!==dto.expectedVersion||assessment.proposalVersion!==dto.expectedVersion)throw new ConflictException('退款方案已变化，请重新查看金额与说明');
      if((await this.currentSchedule(tx,s)).cancelled)throw new ConflictException('书院已取消安排，将自动全额退款，原方案失效');
      const booking=await this.booking(tx,item.id,s);if(booking.state!=='CANCEL_PENDING')throw new ConflictException('预约状态已变化，请查询');
      const state=dto.action==='ACCEPT'?'REFUNDING':'CANCELLED';await tx.refund.update({where:{id},data:{state,acceptedAt:state==='REFUNDING'?new Date():null,version:{increment:1},updatedAt:new Date()}});
      if(state==='REFUNDING')await this.refundJob(tx,id);else await this.restore(tx,item.id,s,refund);
      await this.notice(tx,order,s,'booking.refund.decision:'+id,state==='REFUNDING'?'服务退款方案已确认':'已拒绝退款方案，保留原报名',state==='REFUNDING'?'原路退款正在办理；成功后终止本次剩余服务，已有参加记录保留。':'恢复原报名状态，原取消期限不延长；如仍有异议，可重新申请核查。');
      await tx.auditLog.create({data:{actorId:userId,action:'booking.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:id,changes:{proposalVersion:dto.expectedVersion,amount:String(refund.approvedAmount),state}}});
    });return this.detail(orderId,userId);
  }
  async confirmRefund(data:WechatRefund,channel:AppPaymentChannel='WECHAT_APP'){
    const identity=this.channels.resolve(channel).identity(),refund=await this.db.refund.findUnique({where:{channelRequestKey:data.out_refund_no}});if(!refund)throw new NotFoundException('退款记录不存在');const order=await this.owned(refund.orderId),payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),state=data.refund_status??data.status;
    if(payment.channel!==channel||payment.appScope!==identity.appid||(data.mchid&&data.mchid!==identity.mchid)||data.out_trade_no!==order.orderNo||data.transaction_id!==payment.externalTransactionId||!Number.isSafeInteger(data.amount?.refund)||!Number.isSafeInteger(data.amount?.total)||BigInt(data.amount.refund)!==refund.approvedAmount||BigInt(data.amount.total)!==payment.amount||(data.amount.currency&&data.amount.currency!=='CNY')||typeof data.refund_id!=='string'||!data.refund_id||data.refund_id.length>128||!['SUCCESS','PROCESSING','ABNORMAL','CLOSED'].includes(state??''))throw new BadRequestException('退款事实与原预约付款不一致');
    if(state==='PROCESSING')return false;
    return this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id:refund.id}});if(current.state==='SUCCEEDED')return true;if(!['REFUNDING','FAILED'].includes(current.state))throw new ConflictException('退款尚未审批');
      if(current.reasonCode==='BOOKING_DISPUTE'&&!current.acceptedAt)throw new ConflictException('学员尚未确认退款方案');
      if(state!=='SUCCESS'){await tx.refund.update({where:{id:refund.id},data:{state:'FAILED',failureCode:state,version:{increment:1},updatedAt:new Date()}});return true;}
      if(!data.success_time||!Number.isFinite(Date.parse(data.success_time))||Date.parse(data.success_time)>Date.now()+300000)throw new BadRequestException('退款完成时间无效');
      const item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:order.id}}),s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
      if(payment.disposition==='ACCEPTED'&&(await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}})).refundedTotal+current.approvedAmount!>payment.amount)throw new ConflictException('退款将超过原实付，请核查原退款事实');
      const transaction=await tx.refundTransaction.create({data:{refundId:refund.id,paymentTransactionId:payment.id,channel,appScope:identity.appid,externalRefundId:data.refund_id,amount:current.approvedAmount!,currency:'CNY',verifiedAt:new Date(),succeededAt:new Date(data.success_time),receiptHash:hash(data)}});await tx.refund.update({where:{id:refund.id},data:{state:'SUCCEEDED',succeededAt:transaction.succeededAt,failureCode:null,version:{increment:1}}});await this.journal(tx,order,payment.id,transaction.amount,false,payment.disposition!=='ACCEPTED',channel,refund.id);
      if(payment.disposition==='ACCEPTED'){
        if((await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}})).refundedTotal+current.approvedAmount! === order.paidTotal)await finishBookingMemberPrice(tx,'booking.price:'+order.id,'REVERSED');
        const booking=await this.booking(tx,item.id,s),remainder=['BOOKING_CANCEL_REMAINDER','BOOKING_DELIVERY_REMAINDER'].includes(current.reasonCode);if(!remainder&&booking.state!=='CANCEL_PENDING'||remainder&&!['CANCELLED','REFUNDED'].includes(booking.state))throw new ConflictException('预约状态与原退款不一致，请核查');
        const schedule=await this.currentSchedule(tx,s);
        if(!remainder){
          if(s.kind==='appointment'){await tx.appointment.update({where:{id:booking.id},data:{state:'CANCELLED',cancelReason:current.description,scheduleSnapshot:schedule,version:{increment:1}}});await tx.appointmentSlot.update({where:{id:s.resourceId},data:{confirmed:{decrement:s.quantity},version:{increment:1}}});}
          else{await tx.eventRegistration.update({where:{id:booking.id},data:{state:'REFUNDED',cancelledAt:new Date(),scheduleSnapshot:schedule,version:{increment:1}}});await tx.eventTicketType.update({where:{id:s.resourceId},data:{confirmed:{decrement:s.quantity},version:{increment:1}}});}
        }
        await tx.inventoryReservation.updateMany({where:{orderItemId:item.id,state:'CONVERTED'},data:{state:'RELEASED',releasedAt:new Date(),version:{increment:1}}});
        await tx.tradeOrder.update({where:{id:order.id},data:{refundedTotal:{increment:transaction.amount},version:{increment:1}}});await tx.tradeOrderItem.update({where:{id:item.id},data:{refundedAmount:{increment:transaction.amount},state:'REFUNDED'}});
        const remaining=payment.amount-(await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}})).refundedTotal;
        if(schedule.cancelled&&remaining>0n){
          const supplement=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'booking.cancel.remainder:'+payment.id,kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:remaining,approvedAmount:remaining,reasonCode:'BOOKING_CANCEL_REMAINDER',description:'书院已取消原安排，补退协商退款后的剩余实付',paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});
          await tx.refundItem.create({data:{refundId:supplement.id,orderItemId:item.id,quantity:s.quantity,amount:remaining,revokeQuantity:0}});await this.refundJob(tx,supplement.id);
        }
      }
      await this.notice(tx,order,s,'booking.refunded:'+refund.id,'原路退款已完成','支付渠道已确认退款，请留意原付款账户。');if(payment.disposition==='ACCEPTED'&&s.kind==='appointment')await this.notice(tx,order,s,'booking.refunded:'+refund.id,'已付款预约已取消','退款已确认，原时段名额已释放。',true);
      await tx.auditLog.create({data:{actorId:order.userId,action:'booking.refund.confirm',resource:'refund',resourceId:refund.id,changes:{transactionId:transaction.id,source:channel+'_VERIFIED',amount:String(transaction.amount)}}});return true;
    });
  }
  async adminDetail(id:string){const order=await this.owned(id),item=await this.db.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),s=item.itemSnapshot as unknown as Snapshot;return safe({...await this.detail(id),payments:await this.db.paymentTransaction.findMany({where:{orderId:id},select:{id:true,channel:true,externalTransactionId:true,amount:true,disposition:true,paidAt:true}}),recoveryJobs:await this.db.outboxJob.findMany({where:{OR:[{aggregateId:{in:[id,...(await this.db.refund.findMany({where:{orderId:id},select:{id:true}})).map(r=>r.id)]}},{kind:'BOOKING_CANCEL_COMPENSATION',aggregateId:s.kind==='appointment'?s.resourceId:s.parentId}]},select:{kind:true,state:true,attempts:true,lastErrorCode:true,availableAt:true}}),nickname:(await this.db.user.findUnique({where:{id:order.userId},select:{nickname:true}}))?.nickname??'已注销'});}
  async adminRefresh(id:string,req:AuthRequest){
    const order=await this.owned(id),item=await this.db.tradeOrderItem.findFirstOrThrow({where:{orderId:id}}),s=item.itemSnapshot as unknown as Snapshot;
    await this.db.$transaction(async tx=>{
      const resumed=await tx.outboxJob.updateMany({where:{kind:'BOOKING_CANCEL_COMPENSATION',aggregateId:s.kind==='appointment'?s.resourceId:s.parentId,state:'DEAD'},data:{state:'READY',attempts:0,lockedUntil:null,availableAt:new Date(),lastErrorCode:null}});
      if(resumed.count)await tx.auditLog.create({data:{actorId:req.actor.id,action:'booking.cancel.retry',resource:'trade_order',resourceId:id,changes:{resumed:resumed.count}}});
    });
    await this.refresh(id,order.userId);return this.adminDetail(id);
  }
  private async compensateCancellation(job:{id:string;aggregateId:string;attempts:number}){
    const stored=await this.db.outboxJob.findUniqueOrThrow({where:{id:job.id}}),p=stored.payload as {scheduleVersion:number;changeReason:string;cursor?:string},kind=stored.aggregateType;
    const keys=kind==='appointment'?await this.db.$queryRaw<{id:string}[]>`SELECT "orderItemId" AS id FROM "Appointment" WHERE "slotId"=${job.aggregateId} AND "orderItemId" IS NOT NULL AND state IN ('CONFIRMED','CANCEL_PENDING') AND (${p.cursor??null}::text IS NULL OR "orderItemId">${p.cursor??null}) ORDER BY "orderItemId" LIMIT 21`:await this.db.$queryRaw<{id:string}[]>`SELECT r."orderItemId" AS id FROM "EventRegistration" r JOIN "EventTicketType" t ON t.id=r."ticketTypeId" WHERE t."sessionId"=${job.aggregateId} AND r."orderItemId" IS NOT NULL AND r.state IN ('CONFIRMED','CANCEL_PENDING') AND (${p.cursor??null}::text IS NULL OR r."orderItemId">${p.cursor??null}) ORDER BY r."orderItemId" LIMIT 21`;
    const items=await this.db.tradeOrderItem.findMany({where:{id:{in:keys.map(r=>r.id)}},orderBy:{id:'asc'}});
    for(const item of items.slice(0,20)){
      const order=await this.owned(item.orderId);
      await this.db.$transaction(async tx=>{
        await this.lock(tx,order);const s=item.itemSnapshot as unknown as Snapshot;await this.lockResource(tx,s);
        const schedule=await this.currentSchedule(tx,s),booking=await this.booking(tx,item.id,s),current=await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}});
        if(!schedule.cancelled||schedule.scheduleVersion!==p.scheduleVersion||current.state!=='PAID'||current.refundedTotal!==0n||!['CONFIRMED','CANCEL_PENDING'].includes(booking.state))return;
        const payment=await tx.paymentTransaction.findFirstOrThrow({where:{orderId:order.id,disposition:'ACCEPTED'}}),existing=await tx.refund.findFirst({where:{paymentTransactionId:payment.id,state:{notIn:['REJECTED','CANCELLED']}}});
        let refund=existing;
        if(!refund){
          refund=await tx.refund.create({data:{orderId:order.id,userId:order.userId,requestKey:'booking.cancel:'+item.id+':'+p.scheduleVersion,kind:'REFUND_ONLY',state:'REFUNDING',requestedAmount:payment.amount,approvedAmount:payment.amount,reasonCode:'BOOKING_CANCELLED',description:p.changeReason,paymentTransactionId:payment.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}});
          await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:s.quantity,amount:payment.amount,revokeQuantity:s.quantity}});
        }else if(['REQUESTED','APPROVED'].includes(refund.state)){
          const previous=refund.assessmentSnapshot as unknown as Assessment|null;
          refund=await tx.refund.update({where:{id:refund.id},data:{state:'REFUNDING',approvedAmount:payment.amount,reasonCode:'BOOKING_CANCELLED',reviewNote:'书院已取消原安排：'+p.changeReason,...(previous?{assessmentSnapshot:{...previous,supersededProposal:{proposalAmount:previous.proposalAmount??null,deductionAmount:previous.deductionAmount??null,proposalVersion:previous.proposalVersion??null,reviewNote:previous.reviewNote??null},proposalAmount:String(payment.amount),deductionAmount:'0',withdrawalScope:'书院整场取消，原协商方案失效，整单实付全额原路退回'}}:{}),version:{increment:1}}});
          await tx.refundItem.updateMany({where:{refundId:refund.id},data:{amount:payment.amount,version:{increment:1}}});
        }
        if(booking.state==='CONFIRMED'){
          if(s.kind==='appointment')await tx.appointment.update({where:{id:booking.id},data:{state:'CANCEL_PENDING',scheduleSnapshot:schedule,version:{increment:1}}});else await tx.eventRegistration.update({where:{id:booking.id},data:{state:'CANCEL_PENDING',scheduleSnapshot:schedule,version:{increment:1}}});
        }
        if(refund.state==='REFUNDING')await this.refundJob(tx,refund.id);
        const notice=await tx.notification.createMany({skipDuplicates:true,data:[{userId:order.userId,kind:'BOOKING',orderId:order.id,eventKey:'booking.cancel.compensation:'+item.id+':'+p.scheduleVersion,title:'书院已取消安排，原路退款办理中',body:p.changeReason+'；原支付渠道确认后退回整单实付，名额保留至退款确认。',...(s.kind==='appointment'?{appointmentId:booking.id}:{registrationId:booking.id})}]});
        if(notice.count)await tx.auditLog.create({data:{actorId:order.userId,action:'booking.cancel.compensate',resource:'refund',resourceId:refund.id,changes:{orderId:order.id,scheduleVersion:p.scheduleVersion,source:'CANCELLED_SCHEDULE'}}});
      });
    }
    const more=items.length>20;
    await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:more?'READY':'DONE',payload:{...p,...(items.length?{cursor:items.slice(0,20).at(-1)!.id}:{})},completedAt:more?null:new Date(),lockedUntil:null,availableAt:new Date(),lastErrorCode:null}});
  }
  async runJobs(){
    if(this.working)return;this.working=true;
    try{for(let i=0;i<10;i++){
      const rows=await this.db.$queryRaw<{id:string;kind:string;aggregateId:string;attempts:number}[]>`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind IN ('BOOKING_PAYMENT_CHECK','BOOKING_REFUND','BOOKING_CANCEL_COMPENSATION') AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,kind,"aggregateId",attempts`;if(!rows.length)break;const job=rows[0]!;
      try{if(job.kind==='BOOKING_CANCEL_COMPENSATION'){await this.compensateCancellation(job);continue;}let done=true;if(job.kind==='BOOKING_PAYMENT_CHECK'){const order=await this.owned(job.aggregateId);if(order.state==='PENDING'){await this.refresh(order.id,order.userId);done=(await this.owned(order.id)).state!=='PENDING';}}
      else{const refund=await this.db.refund.findUniqueOrThrow({where:{id:job.aggregateId}});if(refund.state==='REFUNDING'){const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:refund.paymentTransactionId!}}),order=await this.owned(refund.orderId);done=await this.confirmRefund(await this.channels.resolve(payment.channel).refund(payment.externalTransactionId,refund.channelRequestKey!,Number(refund.approvedAmount),Number(payment.amount),order.orderNo),payment.channel as AppPaymentChannel);}}
      await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:done?'DONE':'READY',completedAt:done?new Date():null,lockedUntil:null,availableAt:new Date(Date.now()+60000),lastErrorCode:null}});
      }catch{await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:job.attempts>=20?'DEAD':'READY',lockedUntil:null,availableAt:new Date(Date.now()+Math.min(3600000,30000*2**Math.min(job.attempts,7))),lastErrorCode:'PROVIDER_OR_PROCESSING_ERROR'}});}
    }}finally{this.working=false;}
  }
}

@Controller('commerce') @UseGuards(UserGuard)
export class BookingSalesController {
  constructor(private readonly sales:BookingSalesService){}
  @Post('bookings/quote') quote(@Req() req:AuthRequest,@Body() dto:QuoteDto){return this.sales.quote(req.actor.id,dto);}
  @Post('bookings/confirm-benefit') confirmBenefit(@Req() req:AuthRequest,@Body() dto:ConfirmationDto){return this.sales.confirmBenefit(req.actor.id,dto);}
  @Post('booking-orders') checkout(@Req() req:AuthRequest,@Body() dto:CheckoutDto){return this.sales.checkout(req.actor.id,dto);}
  @Get('booking-orders') list(@Req() req:AuthRequest,@Query() q:PageQuery){return this.sales.list(req.actor.id,q);}
  @Get('booking-orders/:id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.detail(id,req.actor.id);}
  @Post('booking-orders/:id/payment') pay(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.prepay(id,req.actor.id);}
  @Post('booking-orders/:id/refresh') refresh(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.refresh(id,req.actor.id);}
  @Post('booking-orders/:id/cancel') cancel(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.sales.cancel(id,req.actor.id);}
  @Post('booking-orders/:id/refund') refund(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RefundDto){return this.sales.requestRefund(id,req.actor.id,dto);}
  @Post('booking-orders/:id/dispute') dispute(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RefundDto){return this.sales.requestDispute(id,req.actor.id,dto);}
  @Post('booking-orders/:orderId/refunds/:id/decision') decide(@Req() req:AuthRequest,@Param('orderId',ParseUUIDPipe) orderId:string,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RefundDecisionDto){return this.sales.decideRefund(orderId,id,req.actor.id,dto);}
}
@Controller('admin/booking-orders') @UseGuards(AdminGuard)
export class BookingOrdersAdminController {
  constructor(private readonly sales:BookingSalesService){}
  @Get() list(@Req() req:AuthRequest,@Query() q:PageQuery){requireRoles(req,['FINANCE','SUPPORT','OPERATOR']);return this.sales.list(undefined,q);}
  @Get(':id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['FINANCE','SUPPORT','OPERATOR']);return this.sales.adminDetail(id);}
  @Post(':id/refresh') refresh(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['FINANCE','SUPPORT','OPERATOR']);return this.sales.adminRefresh(id,req);}
  @Post('refunds/:id/review') review(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewDto){return this.sales.reviewRefund(id,req,dto);}
}

