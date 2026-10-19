import {offlineBooking} from './offline-courses.js';
import {finishBookingMemberPrice,reverseFreeEventPrices} from './booking-member-pricing.js';
import {syncPointsAppointment} from './points-accounting.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import { Database } from './database.js';
import {BookingSalesService,BookingRejectDto} from './booking-sales.js';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Prisma } from './generated/prisma/client.js';
import { publicContentScope } from './public-content.js';
import { decryptPrivate, encryptPrivate } from './private-data.js';
import { Type } from 'class-transformer';
import { eventPrioritySource } from './membership-benefits.js';

type Tx = Prisma.TransactionClient;
class BookingPage {
  @IsOptional() @IsUUID() bookingId?:string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsIn(['PENDING','CONFIRMED','CANCEL_PENDING','CANCELLED','COMPLETED','NO_SHOW','REFUNDED']) status?: string;
}
class OfferingDto {
  @IsUUID() teacherId!: string;
  @IsString() @Length(1,150) @Matches(/\S/) title!: string;
  @IsIn(['PHONE','EXTERNAL_MEETING','ONSITE','IN_APP_RTC']) mode!: string;
  @IsInt() @Min(5) @Max(480) durationMinutes!: number;
  @IsInt() @Min(0) @Max(43200) leadMinutes!: number;
  @IsInt() @Min(0) @Max(43200) cancelBeforeMinutes!: number;
  @IsString() @Length(1,500) @Matches(/\S/) locationPolicy!: string;
  @IsString() @Length(1,2000) @Matches(/\S/) deliveryPolicy!: string;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsBoolean() active!: boolean;
}
class OfferingEditDto extends OfferingDto { @IsInt() @Min(1) expectedVersion!: number; }
class SlotDto { @IsISO8601() startsAt!: string; }
class StateDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['OPEN','CLOSED']) state!: string;
  @IsString() @Length(1,500) @Matches(/\S/) reason!: string;
}
class TicketMemberPricingDto {@IsInt() @Min(1) expectedVersion!:number;@IsBoolean() eligible!:boolean;@IsString() @Length(2,500) @Matches(/\S/) reason!:string;}
class SessionTicketDto {
  @IsOptional() @IsInt() @Min(0) @Max(100000000) price?:number;
  @IsOptional() @IsBoolean() memberDiscountEligible?:boolean;
  @IsString() @Length(1,80) @Matches(/\S/) title!:string;
  @IsInt() @Min(1) @Max(100000) capacity!:number;
  @IsInt() @Min(1) @Max(20) perUserLimit!:number;
}
class SessionDto {
  @IsISO8601() startsAt!: string;
  @IsISO8601() endsAt!: string;
  @IsISO8601() publicOpenAt!: string;
  @IsOptional() @IsISO8601() memberOpenAt?:string;
  @IsISO8601() cancelDeadline!: string;
  @IsString() @Length(1,200) @Matches(/\S/) location!: string;
  @IsInt() @Min(1) @Max(100000) capacity!: number;
  @IsOptional() @IsString() @Length(1,80) @Matches(/\S/) ticketTitle?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) perUserLimit?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>SessionTicketDto) tickets?:SessionTicketDto[];
}
class AppointmentDto {
  @IsUUID() slotId!: string;
  @IsUUID() requestKey!: string;
  @IsOptional() @IsUUID() skuId?: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(1,50) @Matches(/\S/) name!: string;
  @IsString() @Matches(/^1[3-9]\d{9}$/) phone!: string;
  @IsBoolean() contactConsent!: boolean;
}
class RegistrationDto {
  @IsUUID() ticketTypeId!: string;
  @IsUUID() requestKey!: string;
  @IsInt() @Min(1) @Max(20) quantity!: number;
  @IsString() @Length(1,50) @Matches(/\S/) name!: string;
  @IsString() @Matches(/^1[3-9]\d{9}$/) phone!: string;
  @IsBoolean() contactConsent!: boolean;
}
class CancelDto { @IsString() @Length(1,500) @Matches(/\S/) reason!: string; }
class ScheduleChangeDto extends CancelDto { @IsInt() @Min(1) expectedVersion!: number; }
class SlotRescheduleDto extends ScheduleChangeDto { @IsISO8601() startsAt!: string; }
class SessionRescheduleDto extends SlotRescheduleDto {
  @IsISO8601() endsAt!: string;
  @IsString() @Length(1,200) @Matches(/\S/) location!: string;
}
class AcceptScheduleDto { @IsInt() @Min(1) expectedScheduleVersion!: number; }
class FulfilDto extends CancelDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['COMPLETED','NO_SHOW']) state!: string;
}
class CheckinDto { @IsInt() @Min(1) @Max(20) attendeeNo!: number; @IsUUID() requestKey!: string; }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activeOffer = (now = new Date()) => ({active:true, AND:[{OR:[{validFrom:null},{validFrom:{lte:now}}]},{OR:[{validUntil:null},{validUntil:{gt:now}}]}]});
const json = (value: Prisma.JsonValue) => value as Record<string, any>;

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working=false;
  private readonly logger=new Logger(BookingsService.name);
  constructor(private readonly db: Database,private readonly sales:BookingSalesService) {}
  onModuleInit() { if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runNoticeJobs().catch(()=>this.logger.error('Booking notice worker failed; durable jobs remain queued')),10000);this.timer.unref();} }
  onModuleDestroy() { if(this.timer)clearInterval(this.timer); }
  // Serializes user actions while allowing the operator's notification FK checks.
  private async lockUser(tx: Tx, userId: string) { await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR NO KEY UPDATE`; }
  private async lockOffering(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM "ServiceOffering" WHERE id=${id} FOR UPDATE`; }
  private async lockEvent(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${id} FOR UPDATE`; }
  private audit(tx: Tx, req: AuthRequest, action: string, resourceId: string, changes: Prisma.InputJsonValue = {}) {
    return tx.auditLog.create({data:{actorId:req.actor.id,action,resource:'booking',resourceId,requestId:req.requestId??'',changes}});
  }
  private notice(tx: Tx, userId: string, kind: 'appointment'|'registration', id: string, action: string, title: string, body: string) {
    return tx.notification.create({data:{userId,eventKey:kind+':'+id+':'+action,kind:'BOOKING',title,body,...(kind==='appointment'?{appointmentId:id}:{registrationId:id})}});
  }
  private schedule(row: {startsAt:Date;endsAt:Date;scheduleVersion:number;changeReason:string|null;location?:string}) {
    return {startsAt:row.startsAt.toISOString(),endsAt:row.endsAt.toISOString(),scheduleVersion:row.scheduleVersion,changeReason:row.changeReason,...(row.location?{location:row.location}:{})};
  }
  private queueNotice(tx:Tx,kind:'appointment'|'registration',id:string,schedule:Prisma.InputJsonObject,action:string,cutoff:Date) {
    return tx.outboxJob.create({data:{kind:'BOOKING_CHANGE_NOTICE',aggregateType:kind,aggregateId:id,eventKey:'booking.change:'+kind+':'+id+':'+schedule.scheduleVersion,payload:{...schedule,action,cutoff:cutoff.toISOString()},availableAt:new Date()}});
  }
  private queueCompensation(tx:Tx,kind:'appointment'|'registration',id:string,schedule:Prisma.InputJsonObject) {
    // Refund workers lock user/order before inventory; do not acquire those locks in a schedule transaction.
    return tx.outboxJob.create({data:{kind:'BOOKING_CANCEL_COMPENSATION',aggregateType:kind,aggregateId:id,eventKey:'booking.cancel:'+kind+':'+id+':'+schedule.scheduleVersion,payload:schedule,availableAt:new Date()}});
  }
  async changeSlot(req:AuthRequest,id:string,dto:ScheduleChangeDto|SlotRescheduleDto,cancel=false) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      const found=await tx.appointmentSlot.findUnique({where:{id}});if(!found)throw new NotFoundException('时段不存在');
      await tx.$queryRaw`SELECT id FROM "Teacher" WHERE id=${found.teacherId} FOR UPDATE`;
      await this.lockOffering(tx,found.offeringId);
      const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id}}),now=new Date();
      if(slot.version!==dto.expectedVersion||!['OPEN','CLOSED'].includes(slot.state))throw new ConflictException('时段已更新，请刷新');
      if(slot.startsAt<=now||slot.reserved||await tx.appointment.count({where:{slotId:id,OR:[{state:{in:['COMPLETED','NO_SHOW','PENDING']}},{state:'CANCEL_PENDING',...(cancel?{orderItemId:null}:{})},{state:'CONFIRMED',benefitUsageId:{not:null}}]}}))throw new ConflictException('已开始、已履约、正在退约或存在待支付/权益预占，请先处理后刷新');
      const start=cancel?slot.startsAt:new Date((dto as SlotRescheduleDto).startsAt),end=new Date(+start+(+slot.endsAt-+slot.startsAt));
      if(!cancel){
        if(start<=slot.startsAt)throw new BadRequestException('延期须晚于原开始时间');
        if(await tx.appointmentSlot.count({where:{id:{not:id},teacherId:slot.teacherId,state:{not:'CANCELLED'},startsAt:{lt:end},endsAt:{gt:start}}}))throw new ConflictException('该老师已有重叠时段');
      }
      const free=cancel?await tx.appointment.count({where:{slotId:id,state:'CONFIRMED',orderItemId:null}}):0;
      const next=await tx.appointmentSlot.update({where:{id},data:{startsAt:start,endsAt:end,state:cancel?'CANCELLED':slot.state,changeReason:dto.reason.trim(),scheduleVersion:{increment:1},version:{increment:1},...(cancel?{confirmed:{decrement:free}}:{})}}),schedule=this.schedule(next);
      if(cancel){
        const pointRows=await tx.pointsRedemption.findMany({where:{appointmentId:{in:(await tx.appointment.findMany({where:{slotId:id,state:'CONFIRMED',orderItemId:null},select:{id:true}})).map(a=>a.id)},state:'FULFILLING'}});
        await tx.appointment.updateMany({where:{slotId:id,state:'CONFIRMED',orderItemId:null},data:{state:'CANCELLED',cancelReason:dto.reason.trim(),scheduleSnapshot:schedule,version:{increment:1}}});for(const point of pointRows)await syncPointsAppointment(tx,point.appointmentId!,req.actor.id);
        if(next.confirmed>0)await this.queueCompensation(tx,'appointment',id,schedule);
      }
      await this.queueNotice(tx,'appointment',id,schedule,cancel?'CANCEL':'RESCHEDULE',now);
      const teacher=await tx.teacher.findUnique({where:{id:slot.teacherId},select:{userId:true}});
      if(teacher?.userId)await tx.notification.create({data:{userId:teacher.userId,eventKey:'slot.change:'+id+':'+next.scheduleVersion,kind:'BOOKING_STAFF',title:cancel?'服务时段已取消':'服务时段已延期',body:dto.reason.trim()+'；请在服务工作台查看最新安排。'}});
      await this.audit(tx,req,cancel?'slot.cancel':'slot.reschedule',id,{before:this.schedule(slot),after:schedule});return next;
    });
  }
  async changeSession(req:AuthRequest,id:string,dto:ScheduleChangeDto|SessionRescheduleDto,cancel=false) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      const found=await tx.eventSession.findUnique({where:{id}});if(!found)throw new NotFoundException('场次不存在');
      await this.lockEvent(tx,found.eventId);
      const session=await tx.eventSession.findUniqueOrThrow({where:{id}}),tickets=await tx.eventTicketType.findMany({where:{sessionId:id}}),ids=tickets.map(t=>t.id),now=new Date();
      if(session.version!==dto.expectedVersion||!['OPEN','CLOSED'].includes(session.state))throw new ConflictException('场次已更新，请刷新');
      const checked=(await tx.$queryRaw<{found:boolean;protected:boolean}[]>`SELECT EXISTS(SELECT 1 FROM "EventCheckin" c JOIN "EventRegistration" r ON r.id=c."registrationId" JOIN "EventTicketType" t ON t.id=r."ticketTypeId" WHERE t."sessionId"=${id}) AS found,EXISTS(SELECT 1 FROM "EventCheckin" c JOIN "EventRegistration" r ON r.id=c."registrationId" JOIN "EventTicketType" t ON t.id=r."ticketTypeId" WHERE t."sessionId"=${id} AND (r."orderItemId" IS NOT NULL OR r."benefitUsageId" IS NOT NULL)) AS protected`)[0]!;
      if(session.startsAt<=now||tickets.some(t=>t.reserved)||await tx.eventRegistration.count({where:{ticketTypeId:{in:ids},OR:[{state:'PENDING'},{state:'COMPLETED',...(cancel?{OR:[{orderItemId:{not:null}},{benefitUsageId:{not:null}}]}:{})},{state:'CANCEL_PENDING',...(cancel?{orderItemId:null}:{})},{state:'CONFIRMED',benefitUsageId:{not:null}}]}})||checked.found&&(!cancel||checked.protected))throw new ConflictException('已开始、已签到、正在退票或存在待支付/权益预占，请先处理后刷新');
      const event=await tx.event.findUniqueOrThrow({where:{id:session.eventId}}),d=dto as SessionRescheduleDto,start=cancel?session.startsAt:new Date(d.startsAt),end=cancel?session.endsAt:new Date(d.endsAt);
      if(!cancel&&(start<=session.startsAt||end<=start))throw new BadRequestException('延期须晚于原安排，结束须晚于开始');
      // A single-session event often has the exact session bounds; delaying it must remain possible.
      if(!cancel){
        const single=await tx.eventSession.count({where:{eventId:event.id,id:{not:id},state:{not:'CANCELLED'}}})===0;
        const exact=single&&+event.startsAt===+session.startsAt&&+event.endsAt===+session.endsAt;
        const eventEnd=exact?end:new Date(Math.max(+event.endsAt,+end));
        if(exact||eventEnd>event.endsAt){
          await tx.event.update({where:{id:event.id},data:{...(exact?{startsAt:start,...(event.location===session.location?{location:d.location.trim()}:{})}:{}),endsAt:eventEnd,version:{increment:1}}});
          await this.audit(tx,req,'event.schedule.extend',event.id,{before:{startsAt:event.startsAt.toISOString(),endsAt:event.endsAt.toISOString()},after:{startsAt:exact?start.toISOString():event.startsAt.toISOString(),endsAt:eventEnd.toISOString()},sessionId:id,reason:dto.reason.trim()});
        }
      }
      const next=await tx.eventSession.update({where:{id},data:{startsAt:start,endsAt:end,location:cancel?session.location:d.location.trim(),changeReason:dto.reason.trim(),state:cancel?'CANCELLED':session.state,scheduleVersion:{increment:1},version:{increment:1}}}),schedule=this.schedule(next);
      if(cancel){
        for(const ticket of tickets){
          const free=await tx.eventRegistration.aggregate({where:{ticketTypeId:ticket.id,state:{in:['CONFIRMED','COMPLETED']},orderItemId:null},_sum:{quantity:true}});
          await tx.eventTicketType.update({where:{id:ticket.id},data:{confirmed:{decrement:free._sum.quantity??0},active:false,version:{increment:1}}});
        }
        await reverseFreeEventPrices(tx,ids);
        await tx.eventRegistration.updateMany({where:{ticketTypeId:{in:ids},state:{in:['CONFIRMED','COMPLETED']},orderItemId:null},data:{state:'CANCELLED',cancelledAt:now,scheduleSnapshot:schedule,version:{increment:1}}});
        if(await tx.eventRegistration.count({where:{ticketTypeId:{in:ids},orderItemId:{not:null},state:{in:['CONFIRMED','CANCEL_PENDING']}}}))await this.queueCompensation(tx,'registration',id,schedule);
      }
      await this.queueNotice(tx,'registration',id,schedule,cancel?'CANCEL':'RESCHEDULE',now);
      await this.audit(tx,req,cancel?'event.session.cancel':'event.session.reschedule',id,{before:this.schedule(session),after:schedule});return next;
    });
  }
  async acceptSchedule(req:AuthRequest,kind:'appointment'|'registration',id:string,dto:AcceptScheduleDto) {
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,req.actor.id);
      const initial=kind==='appointment'?await tx.appointment.findFirst({where:{id,userId:req.actor.id}}):await tx.eventRegistration.findFirst({where:{id,userId:req.actor.id}});
      if(!initial)throw new NotFoundException('预约 / 报名不存在');
      let schedule;
      if(kind==='appointment'){
        const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:(initial as {slotId:string}).slotId}});await this.lockOffering(tx,slot.offeringId);schedule=await tx.appointmentSlot.findUniqueOrThrow({where:{id:slot.id}});
      }else{
        const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:(initial as {ticketTypeId:string}).ticketTypeId}}),session=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});await this.lockEvent(tx,session.eventId);schedule=await tx.eventSession.findUniqueOrThrow({where:{id:session.id}});
      }
      const current=kind==='appointment'?await tx.appointment.findUniqueOrThrow({where:{id}}):await tx.eventRegistration.findUniqueOrThrow({where:{id}});
      if(current.state!=='CONFIRMED'||schedule.state==='CANCELLED'||schedule.startsAt<=new Date()||schedule.scheduleVersion!==dto.expectedScheduleVersion)throw new ConflictException('安排已变化或开始，请刷新后确认');
      if(current.acceptedScheduleVersion===schedule.scheduleVersion)return {success:true};
      const data={acceptedScheduleVersion:schedule.scheduleVersion,version:{increment:1}};
      if(kind==='appointment')await tx.appointment.update({where:{id},data});else await tx.eventRegistration.update({where:{id},data});
      await this.audit(tx,req,kind+'.schedule.accept',id,{scheduleVersion:schedule.scheduleVersion});return {success:true};
    });
  }
  async runNoticeJobs() {
    if(this.working)return;this.working=true;
    try{for(let i=0;i<10;i++){
      const jobs=await this.db.$queryRaw<{id:string;attempts:number}[]>`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1 WHERE id=(SELECT id FROM "OutboxJob" WHERE kind='BOOKING_CHANGE_NOTICE' AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,attempts`;
      if(!jobs.length)break;const job=jobs[0]!;
      try{await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "OutboxJob" WHERE id=${job.id} FOR UPDATE`;
        const stored=await tx.outboxJob.findUniqueOrThrow({where:{id:job.id}}),p=json(stored.payload),kind=stored.aggregateType;
        if(stored.attempts!==job.attempts||stored.state!=='RUNNING')return;
        if(kind==='appointment'){
          const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:stored.aggregateId}});await this.lockOffering(tx,slot.offeringId);
        }else{
          const session=await tx.eventSession.findUniqueOrThrow({where:{id:stored.aggregateId}});await this.lockEvent(tx,session.eventId);
        }
        const schedule=kind==='appointment'?await tx.appointmentSlot.findUniqueOrThrow({where:{id:stored.aggregateId}}):await tx.eventSession.findUniqueOrThrow({where:{id:stored.aggregateId}});
        if(schedule.scheduleVersion!==p.scheduleVersion){await tx.outboxJob.update({where:{id:job.id},data:{state:'DONE',completedAt:new Date(),lockedUntil:null}});return;}
        const affected=p.action==='CANCEL'?{state:'CANCELLED',scheduleSnapshot:{path:['scheduleVersion'],equals:p.scheduleVersion}}:{state:'CONFIRMED',acceptedScheduleVersion:{lt:Number(p.scheduleVersion)}};
        const where={confirmedAt:{lte:new Date(p.cutoff)},...(p.cursor?{id:{gt:p.cursor}}:{}),...affected};
        const rows=kind==='appointment'?await tx.appointment.findMany({where:{...where,slotId:stored.aggregateId},orderBy:{id:'asc'},take:51,select:{id:true,userId:true}}):await tx.eventRegistration.findMany({where:{...where,ticketTypeId:{in:(await tx.eventTicketType.findMany({where:{sessionId:stored.aggregateId},select:{id:true}})).map(t=>t.id)}},orderBy:{id:'asc'},take:51,select:{id:true,userId:true}});
        const batch=rows.slice(0,50);
        if(batch.length)await tx.notification.createMany({skipDuplicates:true,data:batch.map(r=>({userId:r.userId,eventKey:'booking.change:'+kind+':'+r.id+':'+p.scheduleVersion,kind:'BOOKING',title:p.action==='CANCEL'?'预约 / 活动已取消':'预约 / 活动安排已延期',body:p.changeReason+'；'+(p.action==='CANCEL'?'原记录保留，名额已释放。':'请在我的预约查看最新安排，确认新时间或取消。'),...(kind==='appointment'?{appointmentId:r.id}:{registrationId:r.id})}))});
        await tx.outboxJob.update({where:{id:job.id},data:{state:rows.length>50?'READY':'DONE',payload:{...p,...(batch.length?{cursor:batch.at(-1)!.id}:{}),failures:0},availableAt:new Date(),lockedUntil:null,completedAt:rows.length>50?null:new Date(),lastErrorCode:null}});
      });}catch{
        const p=json((await this.db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).payload),failures=Number(p.failures??0)+1;
        await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:failures>=20?'DEAD':'READY',payload:{...p,failures},availableAt:new Date(Date.now()+Math.min(3600000,30000*2**Math.min(failures,7))),lockedUntil:null,lastErrorCode:'BOOKING_NOTICE_ERROR'}});
      }
    }}finally{this.working=false;}
  }
  async offerings(teacherId?: string, admin = false, id?: string) {
    const rows = await this.db.serviceOffering.findMany({where:{...(id?{id}:{}),...(teacherId?{teacherId}:{}),...(admin?{}:{active:true})},orderBy:[{title:'asc'},{id:'asc'}],take:100});
    const teachers = await this.db.teacher.findMany({where:{id:{in:rows.map(r=>r.teacherId)},...(admin?{}:await publicContentScope(this.db))},select:{id:true,name:true}});
    const offers = await this.db.saleOffer.findMany({where:{serviceOfferingId:{in:rows.map(r=>r.id)},...activeOffer()},select:{serviceOfferingId:true,price:true}});
    return rows.flatMap(r=>{
      const teacher = teachers.find(t=>t.id===r.teacherId), prices=offers.filter(o=>o.serviceOfferingId===r.id);
      return teacher?[{...r,teacherName:teacher.name,price:prices.length===1?Number(prices[0]!.price):null,bookingEnabled:prices.length===1&&prices[0]!.price===0n}]:[];
    });
  }
  async saveOffering(req: AuthRequest, dto: OfferingDto|OfferingEditDto, id?: string) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      if(!await tx.teacher.findFirst({where:{id:dto.teacherId,...await publicContentScope(tx)}}))throw new BadRequestException('请选择已发布的名师');
      const {price,expectedVersion:_,...data}=dto as OfferingEditDto;
      let row;
      if(id){
        await this.lockOffering(tx,id);
        const before=await tx.serviceOffering.findUnique({where:{id}});
        if(!before||before.version!==(dto as OfferingEditDto).expectedVersion)throw new ConflictException('服务已更新，请刷新后再编辑');
        if(before.teacherId!==dto.teacherId||before.durationMinutes!==dto.durationMinutes)throw new BadRequestException('老师与时长属于服务身份，请新建服务，保留原预约');
        row=await tx.serviceOffering.update({where:{id},data:{...data,version:{increment:1}}});
      }else row=await tx.serviceOffering.create({data});
      await tx.saleOffer.updateMany({where:{serviceOfferingId:row.id,active:true},data:{active:false,version:{increment:1}}});
      await tx.saleOffer.create({data:{kind:'CONSULTATION',serviceOfferingId:row.id,price:BigInt(price),active:dto.active,quantityLimit:1,policySnapshot:{...data,price}}});
      await this.audit(tx,req,'service.save',row.id,{price,active:dto.active,version:row.version});
      return row;
    });
  }
  async slots(id: string, admin = false) {
    const offering=await this.db.serviceOffering.findUnique({where:{id}});
    if(!offering||!admin&&(!offering.active||!await this.db.teacher.findFirst({where:{id:offering.teacherId,...await publicContentScope(this.db)}})))throw new NotFoundException('服务不存在或暂未开放');
    const rows=await this.db.appointmentSlot.findMany({where:{offeringId:id,...(admin?{}:{state:'OPEN',startsAt:{gt:new Date(Date.now()+offering.leadMinutes*60000)}})},orderBy:{startsAt:'asc'},take:200});
    return rows.map(({reserved,confirmed,changeReason,...r})=>({...r,...(admin?{changeReason}:{}),available:r.capacity-reserved-confirmed}));
  }
  async createSlot(req: AuthRequest, id: string, dto: SlotDto) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      const offering=await tx.serviceOffering.findUnique({where:{id}});
      if(!offering)throw new NotFoundException('服务不存在');
      await tx.$queryRaw`SELECT id FROM "Teacher" WHERE id=${offering.teacherId} FOR UPDATE`;
      await this.lockOffering(tx,id);
      const start=new Date(dto.startsAt),end=new Date(+start+offering.durationMinutes*60000);
      if(start<=new Date())throw new BadRequestException('时段须在未来');
      if(await tx.appointmentSlot.count({where:{teacherId:offering.teacherId,state:{not:'CANCELLED'},startsAt:{lt:end},endsAt:{gt:start}}}))throw new ConflictException('该老师已有重叠时段，请选择其他时间');
      const row=await tx.appointmentSlot.create({data:{offeringId:id,teacherId:offering.teacherId,startsAt:start,endsAt:end}});
      await this.audit(tx,req,'slot.create',row.id);return row;
    });
  }
  async slotState(req: AuthRequest, id: string, dto: StateDto) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      const slot=await tx.appointmentSlot.findUnique({where:{id}});if(!slot)throw new NotFoundException('时段不存在');
      await this.lockOffering(tx,slot.offeringId);
      const changed=await tx.appointmentSlot.updateMany({where:{id,version:dto.expectedVersion,state:{in:['OPEN','CLOSED']}},data:{state:dto.state,version:{increment:1}}});
      if(!changed.count)throw new ConflictException('时段状态已变化，请刷新');
      await this.audit(tx,req,'slot.state',id,{state:dto.state,reason:dto.reason});return {success:true};
    });
  }
  async sessions(eventId: string, admin = false,userId?:string) {
    const event=await this.db.event.findFirst({where:{id:eventId,...(admin?{}:await publicContentScope(this.db))}});
    if(!event)throw new NotFoundException('活动不存在或已下架');
    const sessions=await this.db.eventSession.findMany({where:{eventId,...(admin?{}:{state:'OPEN',endsAt:{gt:new Date()}})},orderBy:{startsAt:'asc'},take:100});
    const tickets=await this.db.eventTicketType.findMany({where:{sessionId:{in:sessions.map(s=>s.id)},...(admin?{}:{active:true})},orderBy:{title:'asc'}});
    const offers=await this.db.saleOffer.findMany({where:{eventTicketId:{in:tickets.map(t=>t.id)},...activeOffer()}});
    const now=new Date(),priority=admin?null:await eventPrioritySource(this.db,userId,eventId,now);
    return sessions.map(({contactCipher:_,changeReason,...session})=>{
      const all=tickets.filter(t=>t.sessionId===session.id),available=session.capacity-all.reduce((n,t)=>n+t.reserved+t.confirmed,0);
      const priorityWindow=!!session.memberOpenAt&&session.memberOpenAt<=now&&session.publicOpenAt>now,canRegister=session.publicOpenAt<=now||priorityWindow&&!!priority;
      return {...session,...(admin?{changeReason}:{}),available,priorityEligible:!!priority,priorityWindow,serverTime:now,tickets:all.map(({reserved,confirmed,...ticket})=>{
        const prices=offers.filter(o=>o.eventTicketId===ticket.id),price=prices.length===1?Number(prices[0]!.price):null;
        return {...ticket,price,available:Math.max(0,Math.min(available,ticket.capacity-reserved-confirmed)),purchaseAvailable:price!==null&&price>0&&canRegister&&session.startsAt>now,memberDiscountEligible:(prices[0]?.policySnapshot as {memberDiscountEligible?:boolean}|undefined)?.memberDiscountEligible===true,bookingEnabled:price===0&&canRegister&&session.startsAt>now};
      })};
    });
  }
  async createSession(req: AuthRequest, eventId: string, dto: SessionDto) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      await this.lockEvent(tx,eventId);const event=await tx.event.findUnique({where:{id:eventId}});
      if(!event)throw new NotFoundException('活动不存在');
      const ticketTypes=dto.tickets??(dto.ticketTitle&&dto.perUserLimit?[{title:dto.ticketTitle,capacity:dto.capacity,perUserLimit:dto.perUserLimit}]:[]);
      const start=new Date(dto.startsAt),end=new Date(dto.endsAt),open=new Date(dto.publicOpenAt),cancel=new Date(dto.cancelDeadline),memberOpen=dto.memberOpenAt?new Date(dto.memberOpenAt):null;
      if(ticketTypes.some(t=>t.memberDiscountEligible&&(t.price??event.price)===0))throw new BadRequestException('免费票种无需启用会员优惠，请核对票价与参与开关');
      const ticketCapacity=ticketTypes.reduce((sum,ticket)=>sum+ticket.capacity,0),ticketNames=ticketTypes.map(ticket=>ticket.title.trim().toLocaleLowerCase());
      if(start<=new Date()||end<=start||open>=start||cancel>start||cancel<open||start<event.startsAt||end>event.endsAt||dto.capacity>event.capacity||ticketCapacity>dto.capacity||ticketTypes.some(ticket=>ticket.perUserLimit>ticket.capacity)||new Set(ticketNames).size!==ticketNames.length)throw new BadRequestException('请核查活动范围、票种容量、重复名称、开放与取消截止时间');
      if(memberOpen&&memberOpen>=open)throw new BadRequestException('会员优先开放时间必须早于公众开放时间');
      const row=await tx.eventSession.create({data:{eventId,startsAt:start,endsAt:end,publicOpenAt:open,memberOpenAt:memberOpen,cancelDeadline:cancel,location:dto.location,capacity:dto.capacity,state:'OPEN'}});
      for(const ticketType of ticketTypes){
        const ticket=await tx.eventTicketType.create({data:{sessionId:row.id,title:ticketType.title.trim(),capacity:ticketType.capacity,perUserLimit:ticketType.perUserLimit,active:true}});
        await tx.saleOffer.create({data:{kind:'EVENT',eventTicketId:ticket.id,price:BigInt(ticketType.price??event.price),active:true,quantityLimit:ticketType.perUserLimit,policySnapshot:{eventTitle:event.title,cancelDeadline:cancel.toISOString(),memberDiscountEligible:ticketType.memberDiscountEligible===true}}});
      }
      await this.audit(tx,req,'event.session.create',row.id,{eventId,price:event.price,ticketTypes:ticketTypes.length,capacity:ticketCapacity});return row;
    });
  }
  async sessionState(req: AuthRequest,id: string,dto: StateDto) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      const row=await tx.eventSession.findUnique({where:{id}});if(!row)throw new NotFoundException('场次不存在');
      await this.lockEvent(tx,row.eventId);
      if(!(await tx.eventSession.updateMany({where:{id,version:dto.expectedVersion,state:{in:['OPEN','CLOSED']}},data:{state:dto.state,version:{increment:1}}})).count)throw new ConflictException('场次已更新');
      await this.audit(tx,req,'event.session.state',id,{state:dto.state,reason:dto.reason});return {success:true};
    });
  }
  async ticketMemberPricing(req:AuthRequest,id:string,dto:TicketMemberPricingDto){requireRoles(req,['OPERATOR']);return this.db.$transaction(async tx=>{
    const initial=await tx.eventTicketType.findUniqueOrThrow({where:{id}}),session=await tx.eventSession.findUniqueOrThrow({where:{id:initial.sessionId}});await this.lockEvent(tx,session.eventId);await tx.$queryRaw`SELECT id FROM "EventSession" WHERE id=${session.id} FOR UPDATE`;
    const current=await tx.eventSession.findUniqueOrThrow({where:{id:session.id}}),ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id}});if(ticket.version!==dto.expectedVersion||current.state==='CANCELLED'||current.startsAt<=new Date())throw new ConflictException('票种或场次已变化，请刷新');
    const offers=await tx.saleOffer.findMany({where:{eventTicketId:id,...activeOffer()}});if(offers.length!==1)throw new ConflictException('票种报价不唯一，请先核对售卖配置');const offer=offers[0]!;if(dto.eligible&&offer.price===0n)throw new BadRequestException('免费票种无需启用票价优惠');
    await tx.saleOffer.update({where:{id:offer.id},data:{policySnapshot:{...offer.policySnapshot as object,memberDiscountEligible:dto.eligible},version:{increment:1}}});
    const result=await tx.eventTicketType.update({where:{id},data:{version:{increment:1}}});await this.audit(tx,req,'event.ticket.member-pricing',session.eventId,{ticketId:id,offerId:offer.id,eligible:dto.eligible,reason:dto.reason.trim()});return result;
  });}
  async appointment(req: AuthRequest,dto: AppointmentDto,store?:Tx,redemptionId?:string) {
    if(!dto.contactConsent)throw new BadRequestException('预约需要授权负责老师使用本次联系信息');
    const hash=digest({slotId:dto.slotId,skuId:dto.skuId??null,name:dto.name.trim(),phone:dto.phone});
    const run=async(tx:Tx)=>{
      await this.lockUser(tx,req.actor.id);
      const prior=await tx.appointment.findFirst({where:{userId:req.actor.id,requestKey:dto.requestKey}});
      if(prior){if(redemptionId&&json(prior.serviceSnapshot).pointsRedemptionId!==redemptionId)throw new ConflictException('编号已用于其他预约');if(json(prior.serviceSnapshot).requestDigest!==hash)throw new ConflictException('请求编号已用于另一预约');return {id:prior.id,state:prior.state};}
      const slot=await tx.appointmentSlot.findUnique({where:{id:dto.slotId}});if(!slot)throw new NotFoundException('时段不存在');
      await this.lockOffering(tx,slot.offeringId);
      await tx.$queryRaw`SELECT id FROM "AppointmentSlot" WHERE id=${slot.id} FOR UPDATE`;
      const current=await tx.appointmentSlot.findUniqueOrThrow({where:{id:slot.id}}),offering=await tx.serviceOffering.findUniqueOrThrow({where:{id:slot.offeringId}});
      if(!offering.active||offering.version!==dto.expectedVersion||!await tx.teacher.findFirst({where:{id:offering.teacherId,...await publicContentScope(tx)}}))throw new ConflictException('服务说明已变更或暂未开放，请刷新确认');
      const offers=await tx.saleOffer.findMany({where:{serviceOfferingId:offering.id,...activeOffer()}});
      const redemption=redemptionId?await tx.pointsRedemption.findFirst({where:{id:redemptionId,userId:req.actor.id,state:'FULFILLING'}}):null,pointsReward=redemption?await tx.pointsReward.findUnique({where:{id:redemption.rewardId}}):null;
      const pointsOffer=pointsReward?.kind==='CONSULTATION'?offers.find(o=>o.id===pointsReward.offerId):null;
      if(redemptionId&&!pointsOffer)throw new ConflictException('积分兑换来源不可用');
      if(!redemptionId&&(offers.length!==1||offers[0]!.price!==0n))throw new BadRequestException('当前仅开放免费预约，付费预约暂未开放');
      if(dto.skuId){
        const sku=await tx.productSku.findFirst({where:{id:dto.skuId,serviceOfferingId:offering.id,active:true,price:0,product:{type:'SERVICE',...await publicContentScope(tx)}}});
        if(!sku)throw new ConflictException('服务商品已变更或下架，请重新选择');
      }
      if(current.state!=='OPEN'||current.startsAt<=new Date(Date.now()+offering.leadMinutes*60000)||current.reserved+current.confirmed>=current.capacity)throw new ConflictException('此时段已约满或超过预约截止时间，请选择其他时段');
      const snapshot={...offering,createdAt:offering.createdAt.toISOString(),updatedAt:offering.updatedAt.toISOString(),startsAt:current.startsAt.toISOString(),endsAt:current.endsAt.toISOString(),scheduleVersion:current.scheduleVersion,price:0,offerId:(pointsOffer??offers[0]!)?.id,pointsRedemptionId:redemption?.id??null,pointsCost:redemption?String(redemption.pointsCost):null,skuId:dto.skuId??null,requestDigest:hash};
      const row=await tx.appointment.create({data:{userId:req.actor.id,slotId:slot.id,requestKey:dto.requestKey,state:'CONFIRMED',acceptedScheduleVersion:current.scheduleVersion,contactCipher:encryptPrivate(JSON.stringify({name:dto.name.trim(),phone:dto.phone,consentedAt:new Date().toISOString()})),serviceSnapshot:snapshot,confirmedAt:new Date()}});
      await tx.appointmentSlot.update({where:{id:slot.id},data:{confirmed:{increment:1},version:{increment:1}}});
      await this.notice(tx,req.actor.id,'appointment',row.id,'confirmed','预约已确认',offering.title+'，请在我的预约查看时间与服务说明。');
      const teacher=await tx.teacher.findUnique({where:{id:offering.teacherId},select:{userId:true}});if(teacher?.userId&&teacher.userId!==req.actor.id)await this.notice(tx,teacher.userId,'appointment',row.id,'confirmed','新增服务预约',offering.title+'，请在预约工作台查看时间与学员授权信息。');
      await this.audit(tx,req,'appointment.confirm',row.id,{slotId:slot.id});return {id:row.id,state:row.state};
    };return store?run(store):this.db.$transaction(run);
  }
  async register(req: AuthRequest,dto: RegistrationDto) {
    if(!dto.contactConsent)throw new BadRequestException('报名需要授权书院使用本次联系信息');
    const hash=digest({ticketTypeId:dto.ticketTypeId,quantity:dto.quantity,name:dto.name.trim(),phone:dto.phone});
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,req.actor.id);
      const prior=await tx.eventRegistration.findFirst({where:{userId:req.actor.id,requestKey:dto.requestKey}});
      if(prior){if(JSON.parse(decryptPrivate(prior.attendeeSnapshotCipher)).requestDigest!==hash)throw new ConflictException('请求编号已用于另一报名');return {id:prior.id,state:prior.state};}
      const ticket=await tx.eventTicketType.findUnique({where:{id:dto.ticketTypeId}});if(!ticket)throw new NotFoundException('席位不存在');
      const session=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});
      await this.lockEvent(tx,session.eventId);
      await tx.$queryRaw`SELECT id FROM "EventSession" WHERE id=${session.id} FOR UPDATE`;
      const event=await tx.event.findFirst({where:{id:session.eventId,...await publicContentScope(tx)}}),current=await tx.eventSession.findUniqueOrThrow({where:{id:session.id}});
      const all=await tx.eventTicketType.findMany({where:{sessionId:session.id}}),now=new Date(),t=all.find(t=>t.id===ticket.id)!;
      await offlineBooking(tx,session.id,dto.quantity);
      if(!event||current.state!=='OPEN'||current.startsAt<=now||!t.active)throw new ConflictException('场次暂未开放报名或已结束');
      const priority=current.publicOpenAt>now&&current.memberOpenAt&&current.memberOpenAt<=now?await eventPrioritySource(tx,req.actor.id,event.id,now):null;
      if(current.publicOpenAt>now&&!priority)throw new ConflictException(current.memberOpenAt&&current.memberOpenAt<=now?'当前为会员优先报名时段，请核查已购权益，或等待公众开放':'场次暂未到开放报名时间');
      const offers=await tx.saleOffer.findMany({where:{eventTicketId:t.id,...activeOffer(now)}});
      if(offers.length!==1||offers[0]!.price!==0n)throw new BadRequestException('该票种需从费用确认入口报名，请核对当前报价');
      const mine=await tx.eventRegistration.aggregate({where:{userId:req.actor.id,ticketTypeId:t.id,state:{notIn:['CANCELLED','REFUNDED']}},_sum:{quantity:true}});
      if((mine._sum.quantity??0)+dto.quantity>t.perUserLimit)throw new ConflictException('已达到每人报名人数上限');
      if(t.capacity-t.reserved-t.confirmed<dto.quantity||current.capacity-all.reduce((n,t)=>n+t.reserved+t.confirmed,0)<dto.quantity)throw new ConflictException('剩余名额不足，请减少人数或选择其他场次');
      const snapshot={name:dto.name.trim(),phone:dto.phone,consentedAt:now.toISOString(),requestDigest:hash,title:event.title,ticketTitle:t.title,startsAt:current.startsAt.toISOString(),endsAt:current.endsAt.toISOString(),location:current.location,scheduleVersion:current.scheduleVersion,cancelDeadline:current.cancelDeadline.toISOString(),price:0,offerId:offers[0]!.id};
      const row=await tx.eventRegistration.create({data:{userId:req.actor.id,ticketTypeId:t.id,requestKey:dto.requestKey,quantity:dto.quantity,state:'CONFIRMED',acceptedScheduleVersion:current.scheduleVersion,attendeeSnapshotCipher:encryptPrivate(JSON.stringify(snapshot)),checkinHash:digest(randomBytes(32).toString('hex')),confirmedAt:now,...(priority?{prioritySnapshot:{...priority,memberOpenAt:current.memberOpenAt!.toISOString(),publicOpenAt:current.publicOpenAt.toISOString()}}:{})}});
      await tx.eventTicketType.update({where:{id:t.id},data:{confirmed:{increment:dto.quantity},version:{increment:1}}});
      await this.notice(tx,req.actor.id,'registration',row.id,'confirmed','活动报名已确认',event.title+'，请在我的预约查看报名安排。');
      await this.audit(tx,req,'registration.confirm',row.id,{sessionId:session.id,quantity:dto.quantity});return {id:row.id,state:row.state};
    });
  }
  async mine(userId: string, q: BookingPage) {
    const keys=await this.db.$queryRaw<{id:string;kind:string}[]>`SELECT id,kind FROM (
      SELECT id,'appointment' AS kind,"createdAt" FROM "Appointment" WHERE "userId"=${userId} AND (${q.bookingId??null}::text IS NULL OR id=${q.bookingId??null}) AND (${q.status??null}::text IS NULL OR state=${q.status??null})
      UNION ALL SELECT id,'registration' AS kind,"createdAt" FROM "EventRegistration" WHERE "userId"=${userId} AND (${q.bookingId??null}::text IS NULL OR id=${q.bookingId??null}) AND (${q.status??null}::text IS NULL OR state=${q.status??null})
    ) records ORDER BY "createdAt" DESC,id DESC LIMIT ${q.size+1} OFFSET ${(q.page-1)*q.size}`;
    const visible=keys.slice(0,q.size),[appointments,registrations]=await Promise.all([
      this.db.appointment.findMany({where:{userId,id:{in:visible.filter(k=>k.kind==='appointment').map(k=>k.id)}}}),
      this.db.eventRegistration.findMany({where:{userId,id:{in:visible.filter(k=>k.kind==='registration').map(k=>k.id)}}}),
    ]);
    const [checks,slots,tickets]=await Promise.all([
      this.db.eventCheckin.groupBy({by:['registrationId'],where:{registrationId:{in:registrations.map(r=>r.id)},revokedAt:null},_count:true}),
      this.db.appointmentSlot.findMany({where:{id:{in:appointments.map(r=>r.slotId)}}}),
      this.db.eventTicketType.findMany({where:{id:{in:registrations.map(r=>r.ticketTypeId)}}}),
    ]);
    const sessions=await this.db.eventSession.findMany({where:{id:{in:tickets.map(t=>t.sessionId)}}}),fulfilments=await this.db.eventFulfilment.findMany({where:{registrationId:{in:registrations.map(r=>r.id)}},orderBy:{revision:'desc'},select:{registrationId:true,revision:true,outcome:true,deliveredCount:true,publicSummary:true,createdAt:true}}),now=new Date();
    const orderItems=await this.db.tradeOrderItem.findMany({where:{id:{in:[...appointments,...registrations].flatMap(r=>r.orderItemId?[r.orderItemId]:[])}},select:{id:true,orderId:true}}),orderByItem=new Map(orderItems.map(i=>[i.id,i.orderId]));
    const items=[...appointments.map(a=>{
      const s=json(a.serviceSnapshot),slot=slots.find(t=>t.id===a.slotId)!;
      const schedule=['CONFIRMED','CANCEL_PENDING'].includes(a.state)?this.schedule(slot):a.scheduleSnapshot?json(a.scheduleSnapshot):s;
      const changed=(s.scheduleVersion??1)<(schedule.scheduleVersion??1),cancelAt=changed?new Date(schedule.startsAt):new Date(new Date(s.startsAt).getTime()-s.cancelBeforeMinutes*60000);
      return {orderId:orderByItem.get(a.orderItemId??'')??null,id:a.id,kind:'appointment',pointsCost:s.pointsCost??null,pointsRedemptionId:s.pointsRedemptionId??null,title:s.title,startsAt:schedule.startsAt,endsAt:schedule.endsAt,originalStartsAt:s.startsAt,originalEndsAt:s.endsAt,changeReason:schedule.changeReason??a.cancelReason??null,scheduleVersion:slot.scheduleVersion,scheduleCancelled:slot.state==='CANCELLED',schedulePending:a.state==='CONFIRMED'&&slot.state!=='CANCELLED'&&a.acceptedScheduleVersion<slot.scheduleVersion,location:s.locationPolicy??s.location,policy:s.deliveryPolicy,cancelAt,canCancel:a.state==='CONFIRMED'&&!a.orderItemId&&!a.benefitUsageId&&(cancelAt>now||a.acceptedScheduleVersion<slot.scheduleVersion),checkedCount:0,quantity:1,state:a.state,version:a.version,createdAt:a.createdAt};
    }),...registrations.map(a=>{
      const s=JSON.parse(decryptPrivate(a.attendeeSnapshotCipher)),session=sessions.find(t=>t.id===tickets.find(t=>t.id===a.ticketTypeId)!.sessionId)!;
      const schedule=['CONFIRMED','CANCEL_PENDING'].includes(a.state)?this.schedule(session):a.scheduleSnapshot?json(a.scheduleSnapshot):s;
      const changed=(s.scheduleVersion??1)<(schedule.scheduleVersion??1),cancelAt=changed?schedule.startsAt:s.cancelDeadline,checkedCount=checks.find(c=>c.registrationId===a.id)?._count??0;
      return {orderId:orderByItem.get(a.orderItemId??'')??null,id:a.id,kind:'registration',title:s.title,startsAt:schedule.startsAt,endsAt:schedule.endsAt,originalStartsAt:s.startsAt,originalEndsAt:s.endsAt,changeReason:schedule.changeReason??null,scheduleVersion:session.scheduleVersion,scheduleCancelled:session.state==='CANCELLED',schedulePending:a.state==='CONFIRMED'&&session.state!=='CANCELLED'&&a.acceptedScheduleVersion<session.scheduleVersion,location:schedule.location??s.location,memberBenefit:s.memberBenefit??null,policy:a.orderItemId?'付费活动报名 · 售后在订单内办理':s.memberBenefit?'会员活动权益报名 · 无需付款':'免费活动报名',cancelAt,canCancel:a.state==='CONFIRMED'&&!a.orderItemId&&!a.benefitUsageId&&!checkedCount&&(new Date(cancelAt)>now||a.acceptedScheduleVersion<session.scheduleVersion),checkedCount,fulfilment:fulfilments.find(f=>f.registrationId===a.id)??null,quantity:a.quantity,state:a.state,version:a.version,createdAt:a.createdAt};
    })];
    return {items:visible.map(k=>items.find(i=>i.id===k.id)!),hasMore:keys.length>q.size,serverTime:now};
  }
  async cancel(req: AuthRequest,kind: 'appointment'|'registration',id: string,dto: CancelDto) {
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,req.actor.id);
      if(kind==='appointment'){
        const initial=await tx.appointment.findFirst({where:{id,userId:req.actor.id}});if(!initial)throw new NotFoundException('预约不存在');
        const found=await tx.appointmentSlot.findUniqueOrThrow({where:{id:initial.slotId}});await this.lockOffering(tx,found.offeringId);
        const row=await tx.appointment.findUniqueOrThrow({where:{id}}),slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}});
        if(row.state==='CANCELLED')return {success:true};
        const s=json(row.serviceSnapshot),cancelAt=(s.scheduleVersion??1)<slot.scheduleVersion?+slot.startsAt:new Date(s.startsAt).getTime()-s.cancelBeforeMinutes*60000;
        if(row.state!=='CONFIRMED'||row.orderItemId||row.benefitUsageId||(cancelAt<=Date.now()&&row.acceptedScheduleVersion>=slot.scheduleVersion))throw new ConflictException('已超过自助取消期限或已履约，请联系书院');
        await tx.appointment.update({where:{id},data:{state:'CANCELLED',cancelReason:dto.reason,scheduleSnapshot:this.schedule(slot),version:{increment:1}}});
        await tx.appointmentSlot.update({where:{id:slot.id},data:{confirmed:{decrement:1},version:{increment:1}}});await syncPointsAppointment(tx,id,req.actor.id);
        const teacher=await tx.teacher.findUnique({where:{id:slot.teacherId},select:{userId:true}});
        if(teacher?.userId&&teacher.userId!==req.actor.id)await this.notice(tx,teacher.userId,kind,id,'cancelled','服务预约已取消','学员已取消本次预约，名额已释放。');
      }else{
        const initial=await tx.eventRegistration.findFirst({where:{id,userId:req.actor.id}});if(!initial)throw new NotFoundException('报名不存在');
        const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:initial.ticketTypeId}}),found=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});await this.lockEvent(tx,found.eventId);
        const row=await tx.eventRegistration.findUniqueOrThrow({where:{id}}),session=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});
        if(row.state==='CANCELLED')return {success:true};
        const s=JSON.parse(decryptPrivate(row.attendeeSnapshotCipher)),cancelAt=(s.scheduleVersion??1)<session.scheduleVersion?session.startsAt:new Date(s.cancelDeadline);
        if(row.state!=='CONFIRMED'||row.orderItemId||row.benefitUsageId||(cancelAt<=new Date()&&row.acceptedScheduleVersion>=session.scheduleVersion)||await tx.eventCheckin.count({where:{registrationId:id,revokedAt:null}}))throw new ConflictException('报名已签到或超过取消期限，请联系书院');
        await tx.eventRegistration.update({where:{id},data:{state:'CANCELLED',cancelledAt:new Date(),scheduleSnapshot:this.schedule(session),version:{increment:1}}});
        await tx.eventTicketType.update({where:{id:ticket.id},data:{confirmed:{decrement:row.quantity},version:{increment:1}}});await finishBookingMemberPrice(tx,'event.price:'+id,'REVERSED');
      }
      await this.notice(tx,req.actor.id,kind,id,'cancelled','预约 / 报名已取消','名额已释放，你可以重新选择其他安排。');
      await this.audit(tx,req,kind+'.cancel',id,{reason:dto.reason});return {success:true};
    });
  }
  private async owns(req: AuthRequest,teacherId: string) {
    requireRoles(req,['OPERATOR','TEACHER']);
    if(req.actor.roles.includes('ADMIN')||req.actor.roles.includes('OPERATOR'))return;
    if(!await this.db.teacher.findFirst({where:{id:teacherId,userId:req.actor.id}}))throw new ForbiddenException('只能处理本人服务预约');
  }
  async workbench(req: AuthRequest,q: BookingPage,teacherOnly = false) {
    requireRoles(req,['OPERATOR','TEACHER']);
    const onlyMine=teacherOnly||!req.actor.roles.some(r=>['ADMIN','OPERATOR'].includes(r));
    const scope=Prisma.sql`FROM "Appointment" a JOIN "AppointmentSlot" s ON s.id=a."slotId" JOIN "ServiceOffering" o ON o.id=s."offeringId" JOIN "Teacher" t ON t.id=o."teacherId" WHERE (${onlyMine}=false OR t."userId"=${req.actor.id}) AND (${q.status??null}::text IS NULL OR a.state=${q.status??null})`;
    const [rows,total]=await this.db.$transaction([
      this.db.$queryRaw<{id:string;orderItemId:string|null;state:string;version:number;serviceSnapshot:Prisma.JsonValue;teacherName:string;cancelReason:string|null;acceptedScheduleVersion:number;scheduleSnapshot:Prisma.JsonValue;startsAt:Date;endsAt:Date;scheduleVersion:number;changeReason:string|null;scheduleState:string}[]>(Prisma.sql`SELECT a.id,a."orderItemId",a.state,a.version,a."serviceSnapshot",a."cancelReason",a."acceptedScheduleVersion",a."scheduleSnapshot",s."startsAt",s."endsAt",s."scheduleVersion",s."changeReason",s.state AS "scheduleState",t.name AS "teacherName" ${scope} ORDER BY a."createdAt" DESC,a.id DESC LIMIT ${q.size} OFFSET ${(q.page-1)*q.size}`),
      this.db.$queryRaw<{total:number}[]>(Prisma.sql`SELECT count(*)::int AS total ${scope}`),
    ]);
    return {items:rows.map(r=>{const s=json(r.serviceSnapshot);return {id:r.id,pointsCost:s.pointsCost??null,paid:!!r.orderItemId,state:r.state,version:r.version,title:s.title,startsAt:['CONFIRMED','CANCEL_PENDING'].includes(r.state)?r.startsAt:json(r.scheduleSnapshot??r.serviceSnapshot).startsAt,endsAt:['CONFIRMED','CANCEL_PENDING'].includes(r.state)?r.endsAt:json(r.scheduleSnapshot??r.serviceSnapshot).endsAt,scheduleCancelled:r.scheduleState==='CANCELLED',schedulePending:r.state==='CONFIRMED'&&r.scheduleState!=='CANCELLED'&&r.acceptedScheduleVersion<r.scheduleVersion,changeReason:r.changeReason,teacherName:r.teacherName,cancelReason:r.cancelReason};}),total:total[0]!.total};
  }

  async contact(req: AuthRequest,id: string) {
    const row=await this.db.appointment.findUnique({where:{id}});if(!row)throw new NotFoundException('预约不存在');
    const s=json(row.serviceSnapshot);await this.owns(req,s.teacherId);
    return this.db.$transaction(async tx=>{
      const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}});await this.lockOffering(tx,slot.offeringId);
      const current=await tx.appointment.findUniqueOrThrow({where:{id}});
      if(current.state!=='CONFIRMED'||(await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}})).state==='CANCELLED')throw new ForbiddenException('只可查看待履约预约的授权联系信息');
      await this.audit(tx,req,'appointment.contact',id);return JSON.parse(decryptPrivate(current.contactCipher));
    });
  }
  async fulfil(req: AuthRequest,id: string,dto: FulfilDto) {
    const row=await this.db.appointment.findUnique({where:{id}});if(!row)throw new NotFoundException('预约不存在');
    await this.owns(req,json(row.serviceSnapshot).teacherId);
    return this.db.$transaction(async tx=>{
      const found=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}});await this.lockOffering(tx,found.offeringId);
      const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}}),current=await tx.appointment.findUniqueOrThrow({where:{id}});
      if(current.orderItemId)throw new ConflictException('付费服务请到「预约与活动订单 → 查看与处理 → 实际履约与收入确认」提交凭证，不能按免费预约完成');
      if(slot.state==='CANCELLED'||current.acceptedScheduleVersion<slot.scheduleVersion)throw new ConflictException('学员尚未确认新安排或时段已取消，不可记录履约');
      if(slot.endsAt>new Date())throw new BadRequestException('服务结束后才能记录履约结果');
      if(!(await tx.appointment.updateMany({where:{id,state:'CONFIRMED',version:dto.expectedVersion},data:{state:dto.state,completedAt:new Date(),scheduleSnapshot:this.schedule(slot),version:{increment:1}}})).count)throw new ConflictException('预约已处理，请刷新');
      await syncPointsAppointment(tx,id,req.actor.id);await this.notice(tx,row.userId,'appointment',id,'fulfilled','预约履约结果已更新',dto.state==='COMPLETED'?'本次服务已完成。':'本次预约记录为未到场，请联系书院了解情况。');
      await this.audit(tx,req,'appointment.fulfil',id,{state:dto.state,reason:dto.reason});return {success:true};
    });
  }
  async reject(req:AuthRequest,id:string,dto:BookingRejectDto){
    const initial=await this.db.appointment.findUnique({where:{id}});if(!initial)throw new NotFoundException('预约不存在');
    await this.owns(req,json(initial.serviceSnapshot).teacherId);
    if(initial.orderItemId)return this.sales.rejectAppointment(id,req,dto);
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,initial.userId);const found=await tx.appointmentSlot.findUniqueOrThrow({where:{id:initial.slotId}});await this.lockOffering(tx,found.offeringId);
      const row=await tx.appointment.findUniqueOrThrow({where:{id}}),slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}});
      if(row.version!==dto.expectedVersion||row.state!=='CONFIRMED'||row.benefitUsageId||slot.startsAt<=new Date()||slot.state==='CANCELLED')throw new ConflictException('预约已更新、使用会员权益或已开始，请通过售后核查');
      await tx.appointment.update({where:{id},data:{state:'CANCELLED',cancelReason:dto.reason.trim(),scheduleSnapshot:this.schedule(slot),version:{increment:1}}});
      await tx.appointmentSlot.update({where:{id:slot.id},data:{confirmed:{decrement:1},version:{increment:1}}});await syncPointsAppointment(tx,id,req.actor.id);
      await this.notice(tx,row.userId,'appointment',id,'staff-rejected','老师无法提供本次服务',dto.reason.trim()+'；预约已取消，原记录保留。');
      await this.audit(tx,req,'appointment.staff.reject',id,{reason:dto.reason.trim()});return{success:true};
    });
  }
  async registrations(req: AuthRequest,eventId: string,q: BookingPage) {
    requireRoles(req,['OPERATOR']);
    const sessions=await this.db.eventSession.findMany({where:{eventId}}),tickets=await this.db.eventTicketType.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}}});
    const where={ticketTypeId:{in:tickets.map(t=>t.id)},...(q.status?{state:q.status}:{})};
    const [rows,total]=await this.db.$transaction([this.db.eventRegistration.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),this.db.eventRegistration.count({where})]);
    const checks=await this.db.eventCheckin.findMany({where:{registrationId:{in:rows.map(r=>r.id)},revokedAt:null}});
    return {items:rows.map(r=>{const s=JSON.parse(decryptPrivate(r.attendeeSnapshotCipher)),session=sessions.find(t=>t.id===tickets.find(t=>t.id===r.ticketTypeId)!.sessionId)!,schedule=['CONFIRMED','CANCEL_PENDING'].includes(r.state)?this.schedule(session):r.scheduleSnapshot?json(r.scheduleSnapshot):s;return {id:r.id,state:r.state,version:r.version,quantity:r.quantity,name:s.name,phone:s.phone.slice(0,3)+'****'+s.phone.slice(-4),title:s.title,startsAt:schedule.startsAt,endsAt:schedule.endsAt,scheduleCancelled:session.state==='CANCELLED',schedulePending:r.state==='CONFIRMED'&&session.state!=='CANCELLED'&&r.acceptedScheduleVersion<session.scheduleVersion,changeReason:schedule.changeReason,checkedAttendees:checks.filter(c=>c.registrationId===r.id).map(c=>c.attendeeNo)};}),total};
  }
  async checkin(req: AuthRequest,id: string,dto: CheckinDto,token?:string) {
    requireRoles(req,['OPERATOR','TEACHER']);
    return this.db.$transaction(async tx=>{
      const row=await tx.eventRegistration.findUnique({where:{id}});if(!row)throw new NotFoundException('报名不存在');
      const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:row.ticketTypeId}}),found=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});await this.lockEvent(tx,found.eventId);
      const session=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});
      if(!req.actor.roles.some(r=>['ADMIN','OPERATOR'].includes(r))){const staff=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "EventStaff" WHERE "sessionId"=${session.id} AND "userId"=${req.actor.id} AND "revokedAt" IS NULL AND 'CHECKIN'=ANY("scopeCodes") FOR SHARE`;if(!staff.length)throw new ForbiddenException('只能核销获委派场次的报名');}
      const current=await tx.eventRegistration.findUniqueOrThrow({where:{id}});
      if(token&&(current.checkinHash!==digest(token)||!current.checkinExpiresAt||current.checkinExpiresAt<=new Date()))throw new ConflictException('核销凭证已过期或刷新，请学员重新出示');
      const prior=await tx.eventCheckin.findUnique({where:{requestKey:dto.requestKey}});
      if(prior){if(prior.registrationId!==id||prior.attendeeNo!==dto.attendeeNo)throw new ConflictException('签到编号已使用');if(prior.revokedAt)throw new ConflictException('此签到已撤销，重新签到须使用新请求编号');return prior;}
      if(session.state==='CANCELLED'||current.acceptedScheduleVersion<session.scheduleVersion||!['CONFIRMED','COMPLETED'].includes(current.state)||dto.attendeeNo>current.quantity||Date.now()<+session.startsAt-3600000||new Date()>session.endsAt)throw new ConflictException('当前报名状态或时间不允许签到');
      const exists=await tx.eventCheckin.findFirst({where:{registrationId:id,attendeeNo:dto.attendeeNo,revokedAt:null}});if(exists)return exists;
      const check=await tx.eventCheckin.create({data:{registrationId:id,attendeeNo:dto.attendeeNo,actorId:req.actor.id,requestKey:dto.requestKey,checkedAt:new Date()}});
      if(await tx.eventCheckin.count({where:{registrationId:id,revokedAt:null}})===current.quantity)await tx.eventRegistration.update({where:{id},data:{state:'COMPLETED',scheduleSnapshot:this.schedule(session),version:{increment:1}}});
      await this.audit(tx,req,'registration.checkin',id,{attendeeNo:dto.attendeeNo});return check;
    });
  }
}

@Controller('bookings') @UseGuards(OptionalUserGuard)
export class BookingsCatalogController {
  constructor(private readonly service: BookingsService) {}
  @Get('teachers/:id/offerings') offerings(@Param('id',ParseUUIDPipe) id: string) {return this.service.offerings(id);}
  @Get('offerings/:id') async offering(@Param('id',ParseUUIDPipe) id: string) {const row=(await this.service.offerings(undefined,false,id))[0];if(!row)throw new NotFoundException('服务暂未开放');return row;}
  @Get('offerings/:id/slots') slots(@Param('id',ParseUUIDPipe) id: string) {return this.service.slots(id);}
  @Get('events/:id/sessions') sessions(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id: string) {return this.service.sessions(id,false,req.actor?.id);}
}
@Controller('me/bookings') @UseGuards(UserGuard)
export class BookingsController {
  constructor(private readonly service: BookingsService) {}
  @Get() list(@Req() req: AuthRequest,@Query() q: BookingPage) {return this.service.mine(req.actor.id,q);}
  @Post('appointments') appointment(@Req() req: AuthRequest,@Body() dto: AppointmentDto) {return this.service.appointment(req,dto);}
  @Post('registrations') register(@Req() req: AuthRequest,@Body() dto: RegistrationDto) {return this.service.register(req,dto);}
  @Post('appointments/:id/cancel') cancelAppointment(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: CancelDto) {return this.service.cancel(req,'appointment',id,dto);}
  @Post('registrations/:id/cancel') cancelRegistration(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: CancelDto) {return this.service.cancel(req,'registration',id,dto);}
  @Post('appointments/:id/accept-schedule') acceptAppointment(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AcceptScheduleDto) {return this.service.acceptSchedule(req,'appointment',id,dto);}
  @Post('registrations/:id/accept-schedule') acceptRegistration(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AcceptScheduleDto) {return this.service.acceptSchedule(req,'registration',id,dto);}
}
@Controller('admin') @UseGuards(AdminGuard)
export class BookingsAdminController {
  constructor(private readonly service: BookingsService) {}
  @Get('services') list(@Req() req: AuthRequest) {requireRoles(req,['OPERATOR','MODERATOR']);return this.service.offerings(undefined,true);}
  @Post('services') create(@Req() req: AuthRequest,@Body() dto: OfferingDto) {return this.service.saveOffering(req,dto);}
  @Patch('services/:id') edit(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: OfferingEditDto) {return this.service.saveOffering(req,dto,id);}
  @Get('services/:id/slots') slots(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string) {requireRoles(req,['OPERATOR','MODERATOR']);return this.service.slots(id,true);}
  @Post('services/:id/slots') slot(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: SlotDto) {return this.service.createSlot(req,id,dto);}
  @Post('services/slots/:id/state') slotState(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: StateDto) {return this.service.slotState(req,id,dto);}
  @Post('services/slots/:id/reschedule') rescheduleSlot(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SlotRescheduleDto) {return this.service.changeSlot(req,id,dto);}
  @Post('services/slots/:id/cancel') cancelSlot(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ScheduleChangeDto) {return this.service.changeSlot(req,id,dto,true);}
  @Get('services/appointments') appointments(@Req() req: AuthRequest,@Query() q: BookingPage) {return this.service.workbench(req,q);}
  @Get('teaching/appointments') teacherAppointments(@Req() req: AuthRequest,@Query() q: BookingPage) {return this.service.workbench(req,q,true);}
  @Post('services/appointments/:id/contact') serviceContact(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string) {return this.service.contact(req,id);}
  @Post('services/appointments/:id/fulfil') serviceFulfil(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: FulfilDto) {return this.service.fulfil(req,id,dto);}
  @Post('teaching/appointments/:id/contact') contact(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string) {return this.service.contact(req,id);}
  @Post('teaching/appointments/:id/fulfil') fulfil(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: FulfilDto) {return this.service.fulfil(req,id,dto);}
  @Post('services/appointments/:id/reject') serviceReject(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:BookingRejectDto){return this.service.reject(req,id,dto);}
  @Post('teaching/appointments/:id/reject') reject(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:BookingRejectDto){return this.service.reject(req,id,dto);}
  @Get('events/:id/sessions') sessions(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string) {requireRoles(req,['OPERATOR','MODERATOR']);return this.service.sessions(id,true);}
  @Post('events/:id/sessions') session(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: SessionDto) {return this.service.createSession(req,id,dto);}
  @Post('events/tickets/:id/member-pricing') memberPricing(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:TicketMemberPricingDto){return this.service.ticketMemberPricing(req,id,dto);}
  @Post('events/sessions/:id/state') sessionState(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: StateDto) {return this.service.sessionState(req,id,dto);}
  @Post('events/sessions/:id/reschedule') rescheduleSession(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SessionRescheduleDto) {return this.service.changeSession(req,id,dto);}
  @Post('events/sessions/:id/cancel') cancelSession(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ScheduleChangeDto) {return this.service.changeSession(req,id,dto,true);}
  @Get('events/:id/registrations') registrations(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Query() q: BookingPage) {return this.service.registrations(req,id,q);}
  @Post('events/registrations/:id/checkin') checkin(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: CheckinDto) {return this.service.checkin(req,id,dto);}
}
