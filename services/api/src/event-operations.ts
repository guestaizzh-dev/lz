import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { Database } from './database.js';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { AdminPermissions } from './admin-permissions.js';
import { BookingsService } from './bookings.js';
import { TableQuery } from './admin.js';
import { decryptPrivate } from './private-data.js';
import type { Prisma } from './generated/prisma/client.js';

class ReasonDto { @IsString() @Length(1,500) @Matches(/\S/) reason!:string; }
class RevokeStaffDto extends ReasonDto { @IsInt() @Min(1) expectedVersion!:number; }
class GrantDto extends ReasonDto {
  @IsUUID() userId!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ArrayUnique() @IsIn(['CHECKIN','REVOKE'],{each:true}) scopeCodes!:string[];
}
class CodeDto { @IsString() @Length(40,160) code!:string; }
class ScanDto extends CodeDto { @IsInt() @Min(1) @Max(20) attendeeNo!:number; @IsUUID() requestKey!:string; }
class FulfilmentDto extends ReasonDto {
  @IsInt() @Min(0) expectedRevision!:number;
  @IsInt() @Min(0) @Max(20) deliveredCount!:number;
  @IsString() @Length(10,1000) @Matches(/\S/) evidence!:string;
  @IsString() @Length(5,500) @Matches(/\S/) publicSummary!:string;
  @IsUUID() requestKey!:string;
}
const digest=(token:string)=>createHash('sha256').update(JSON.stringify(token)).digest('hex');
type Tx=Prisma.TransactionClient;
@Injectable()
export class EventOperationsService {
  constructor(private readonly db:Database,private readonly bookings:BookingsService,private readonly permissions:AdminPermissions){}
  private async capability(req:AuthRequest,write=false){requireRoles(req,['OPERATOR','TEACHER']);await this.permissions.assert(req.actor.roles,write?'POST':'GET',req.actor.roles.some(r=>['ADMIN','OPERATOR'].includes(r))?'/admin/events/workbench':'/admin/teaching/events/workbench');}
  private async lockSession(tx:Tx,id:string){const session=await tx.eventSession.findUnique({where:{id}});if(!session)throw new NotFoundException('场次不存在');await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${session.eventId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "EventSession" WHERE id=${id} FOR UPDATE`;return tx.eventSession.findUniqueOrThrow({where:{id}});}
  private async access(req:AuthRequest,id:string,scope='CHECKIN',tx:Tx=this.db){
    if(req.actor.roles.some(r=>['ADMIN','OPERATOR'].includes(r)))return;
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "EventStaff" WHERE "sessionId"=${id} AND "userId"=${req.actor.id} AND "revokedAt" IS NULL AND ${scope}=ANY("scopeCodes") FOR SHARE`;
    if(!rows.length)throw new ForbiddenException('未获委派此场次或没有此操作权限');
  }
  private audit(tx:Tx,req:AuthRequest,action:string,id:string,changes:Prisma.InputJsonObject){return tx.auditLog.create({data:{actorId:req.actor.id,resource:'event',resourceId:id,action,changes,requestId:req.requestId??''}});}
  async candidates(req:AuthRequest,q:TableQuery){requireRoles(req,['OPERATOR']);return this.db.user.findMany({where:{status:'ACTIVE',roles:{has:'TEACHER'},...(q.q?{nickname:{contains:q.q,mode:'insensitive'}}:{})},select:{id:true,nickname:true},orderBy:[{nickname:'asc'},{id:'asc'}],take:50});}
  async staff(req:AuthRequest,id:string){requireRoles(req,['OPERATOR']);const rows=await this.db.eventStaff.findMany({where:{sessionId:id},orderBy:{createdAt:'desc'},take:200}),users=await this.db.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true,status:true}});return rows.map(row=>({...row,user:users.find(u=>u.id===row.userId)}));}
  async grant(req:AuthRequest,id:string,dto:GrantDto){requireRoles(req,['OPERATOR']);if(!dto.scopeCodes.includes('CHECKIN'))throw new BadRequestException('现场工作人员至少应有签到权限');return this.db.$transaction(async tx=>{
    const session=await this.lockSession(tx,id);if(session.state==='CANCELLED'||session.endsAt<=new Date())throw new ConflictException('已取消或结束的场次不能分配人员');
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${dto.userId} FOR SHARE`;
    const user=await tx.user.findFirst({where:{id:dto.userId,status:'ACTIVE',roles:{has:'TEACHER'}}});if(!user)throw new BadRequestException('请选择有效的老师或助教账号');
    if(await tx.eventStaff.findFirst({where:{sessionId:id,userId:dto.userId,revokedAt:null}}))throw new ConflictException('此账号已有本场次委派，请先撤销旧配置');
    const row=await tx.eventStaff.create({data:{sessionId:id,userId:dto.userId,scopeCodes:dto.scopeCodes}});await this.audit(tx,req,'event.staff.grant',session.eventId,{sessionId:id,staffId:row.id,userId:dto.userId,scopeCodes:dto.scopeCodes,reason:dto.reason});return row;
  });}
  async revokeStaff(req:AuthRequest,id:string,staffId:string,dto:RevokeStaffDto){requireRoles(req,['OPERATOR']);return this.db.$transaction(async tx=>{
    const session=await this.lockSession(tx,id);const row=await tx.eventStaff.findUnique({where:{id:staffId}});if(!row||row.sessionId!==id||row.revokedAt||row.version!==dto.expectedVersion)throw new ConflictException('委派状态已变化，请刷新');
    await tx.eventStaff.update({where:{id:staffId},data:{revokedAt:new Date(),version:{increment:1}}});await this.audit(tx,req,'event.staff.revoke',session.eventId,{sessionId:id,staffId,reason:dto.reason});return{success:true};
  });}
  async sessions(req:AuthRequest){await this.capability(req);const global=req.actor.roles.some(r=>['ADMIN','OPERATOR'].includes(r)),staff=global?[]:await this.db.eventStaff.findMany({where:{userId:req.actor.id,revokedAt:null,scopeCodes:{has:'CHECKIN'}},select:{sessionId:true,scopeCodes:true}}),rows=await this.db.eventSession.findMany({where:{...(global?{}:{id:{in:staff.map(s=>s.sessionId)}})},orderBy:[{startsAt:'desc'},{id:'desc'}],take:100}),events=await this.db.event.findMany({where:{id:{in:rows.map(r=>r.eventId)}},select:{id:true,title:true}});return rows.map(r=>({id:r.id,title:events.find(e=>e.id===r.eventId)?.title??'书院活动',startsAt:r.startsAt,endsAt:r.endsAt,location:r.location,state:r.state,canRevoke:global||staff.find(s=>s.sessionId===r.id)?.scopeCodes.includes('REVOKE')===true}));}
  async roster(req:AuthRequest,id:string,q:TableQuery){await this.capability(req);return this.db.$transaction(async tx=>{await this.access(req,id,'CHECKIN',tx);const session=await tx.eventSession.findUniqueOrThrow({where:{id}});const tickets=await tx.eventTicketType.findMany({where:{sessionId:id},select:{id:true}}),where={ticketTypeId:{in:tickets.map(t=>t.id)}};const [rows,total]=await Promise.all([tx.eventRegistration.findMany({where,orderBy:[{confirmedAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),tx.eventRegistration.count({where})]),checks=await tx.eventCheckin.findMany({where:{registrationId:{in:rows.map(r=>r.id)}},orderBy:{checkedAt:'asc'}}),fulfilments=await tx.eventFulfilment.findMany({where:{registrationId:{in:rows.map(r=>r.id)}},orderBy:{revision:'desc'}});return{items:rows.map(row=>{const contact=JSON.parse(decryptPrivate(row.attendeeSnapshotCipher));return{id:row.id,state:row.state,name:contact.name,phone:contact.phone.slice(0,3)+'****'+contact.phone.slice(-4),quantity:row.quantity,canFulfil:session.endsAt<=new Date()&&session.state!=='CANCELLED'&&['CONFIRMED','COMPLETED'].includes(row.state)&&row.acceptedScheduleVersion>=session.scheduleVersion&&!row.orderItemId&&!row.benefitUsageId,fulfilment:fulfilments.find(f=>f.registrationId===row.id)??null,checkins:checks.filter(c=>c.registrationId===row.id).map(c=>({id:c.id,attendeeNo:c.attendeeNo,checkedAt:c.checkedAt,revokedAt:c.revokedAt,revokeReason:c.revokeReason}))};}),total};});}
  async credential(req:AuthRequest,id:string){const token=randomBytes(24).toString('base64url'),expiresAt=new Date(Date.now()+15*60000);const result=await this.db.$transaction(async tx=>{
    const row=await tx.eventRegistration.findFirst({where:{id,userId:req.actor.id}});if(!row)throw new NotFoundException('报名不存在');const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:row.ticketTypeId}}),session=await this.lockSession(tx,ticket.sessionId),current=await tx.eventRegistration.findUniqueOrThrow({where:{id}});
    if(session.state==='CANCELLED'||current.acceptedScheduleVersion<session.scheduleVersion||!['CONFIRMED','COMPLETED'].includes(current.state)||session.endsAt<=new Date())throw new ConflictException('当前报名不能出示核销凭证，请先确认最新安排');
    await tx.eventRegistration.update({where:{id},data:{checkinHash:digest(token),checkinExpiresAt:expiresAt}});return {sessionId:session.id,quantity:row.quantity};
  });const code='DXCHECK1:'+id+':'+token;return{...result,code,expiresAt,qr:await QRCode.toDataURL(code,{width:256,margin:2,errorCorrectionLevel:'M'})};}
  private parse(code:string){const parts=code.trim().match(/^DXCHECK1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9_-]{32})$/i);if(!parts)throw new BadRequestException('请扫描书院报名核销码，或粘贴完整凭证');return{id:parts[1]!,token:parts[2]!};}
  async inspect(req:AuthRequest,code:string){await this.capability(req);const parsed=this.parse(code);return this.db.$transaction(async tx=>{
    const row=await tx.eventRegistration.findUnique({where:{id:parsed.id}});if(!row)throw new NotFoundException('核销凭证无效');const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:row.ticketTypeId}}),session=await this.lockSession(tx,ticket.sessionId);await this.access(req,session.id,'CHECKIN',tx);
    const current=await tx.eventRegistration.findUniqueOrThrow({where:{id:row.id}});
    if(current.checkinHash!==digest(parsed.token)||!current.checkinExpiresAt||current.checkinExpiresAt<=new Date()||session.state==='CANCELLED'||current.acceptedScheduleVersion<session.scheduleVersion||!['CONFIRMED','COMPLETED'].includes(current.state))throw new ConflictException('凭证已过期、刷新或报名不可核销，请重新出示');
    const contact=JSON.parse(decryptPrivate(row.attendeeSnapshotCipher)),checks=await tx.eventCheckin.findMany({where:{registrationId:row.id,revokedAt:null},select:{attendeeNo:true}});return{id:row.id,sessionId:session.id,name:contact.name,phone:contact.phone.slice(0,3)+'****'+contact.phone.slice(-4),quantity:row.quantity,checkedAttendees:checks.map(c=>c.attendeeNo),startsAt:session.startsAt,endsAt:session.endsAt,location:session.location};
  });}
  async scan(req:AuthRequest,dto:ScanDto){await this.capability(req,true);const parsed=this.parse(dto.code);return this.bookings.checkin(req,parsed.id,dto,parsed.token);}
  async revokeCheckin(req:AuthRequest,id:string,dto:ReasonDto){await this.capability(req,true);return this.db.$transaction(async tx=>{
    const row=await tx.eventCheckin.findUnique({where:{id}});if(!row)throw new NotFoundException('签到不存在');const registration=await tx.eventRegistration.findUniqueOrThrow({where:{id:row.registrationId}}),ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:registration.ticketTypeId}}),session=await this.lockSession(tx,ticket.sessionId);await this.access(req,session.id,'REVOKE',tx);
    const current=await tx.eventCheckin.findUniqueOrThrow({where:{id}});if(current.revokedAt)return{success:true};
    const currentRegistration=await tx.eventRegistration.findUniqueOrThrow({where:{id:registration.id}});
    if(session.endsAt<=new Date()||session.state==='CANCELLED'||!['CONFIRMED','COMPLETED'].includes(currentRegistration.state))throw new ConflictException('已结束或取消的活动不能撤销签到，请联系书院处理履约更正');
    await tx.eventCheckin.update({where:{id},data:{revokedAt:new Date(),revokedBy:req.actor.id,revokeReason:dto.reason.trim()}});
    if(currentRegistration.state==='COMPLETED')await tx.eventRegistration.update({where:{id:registration.id},data:{state:'CONFIRMED',version:{increment:1}}});
    await this.audit(tx,req,'event.checkin.revoke',session.eventId,{checkinId:id,registrationId:registration.id,attendeeNo:row.attendeeNo,reason:dto.reason.trim()});return{success:true};
  });}
  async fulfilmentHistory(req:AuthRequest,id:string){await this.capability(req);return this.db.$transaction(async tx=>{
    const registration=await tx.eventRegistration.findUnique({where:{id}});if(!registration)throw new NotFoundException('报名不存在');
    const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:registration.ticketTypeId}});await this.access(req,ticket.sessionId,'CHECKIN',tx);
    return tx.eventFulfilment.findMany({where:{registrationId:id},orderBy:{revision:'desc'},take:100});
  });}
  async fulfilment(req:AuthRequest,id:string,dto:FulfilmentDto){requireRoles(req,['OPERATOR']);await this.permissions.assert(req.actor.roles,'POST','/admin/events/workbench');
    const values={expectedRevision:dto.expectedRevision,deliveredCount:dto.deliveredCount,evidence:dto.evidence.trim(),publicSummary:dto.publicSummary.trim(),reason:dto.reason.trim()},hash=digest(JSON.stringify(values));
    if(values.evidence.length<10||values.publicSummary.length<5)throw new BadRequestException('请填写具体履约依据和学员可见结果');
    return this.db.$transaction(async tx=>{
      const row=await tx.eventRegistration.findUnique({where:{id}});if(!row)throw new NotFoundException('报名不存在');
      const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:row.ticketTypeId}}),session=await this.lockSession(tx,ticket.sessionId),registration=await tx.eventRegistration.findUniqueOrThrow({where:{id}});
      const prior=await tx.eventFulfilment.findUnique({where:{requestKey:dto.requestKey}});
      if(prior){if(prior.registrationId!==id||prior.actorId!==req.actor.id||prior.requestHash!==hash)throw new ConflictException('履约请求编号已用于另一操作');return prior;}
      if(session.state==='CANCELLED'||session.endsAt>new Date()||!['CONFIRMED','COMPLETED'].includes(registration.state)||registration.acceptedScheduleVersion<session.scheduleVersion)throw new ConflictException('活动结束且学员已确认安排后才能记录履约');
      if(registration.orderItemId||registration.benefitUsageId)throw new ConflictException('付费报名请在预约与活动订单内登记实际履约并提交财务复核；配额权益报名不能按免费活动记录完成');
      const latest=await tx.eventFulfilment.findFirst({where:{registrationId:id},orderBy:{revision:'desc'}});
      if((latest?.revision??0)!==dto.expectedRevision)throw new ConflictException('履约结果已更新，请刷新后再处理');
      const checks=await tx.eventCheckin.findMany({where:{registrationId:id,revokedAt:null},orderBy:{attendeeNo:'asc'}});
      if(dto.deliveredCount>checks.length)throw new BadRequestException('实际完成服务人数不能超过有效签到人数');
      const outcome=!checks.length?'NO_SHOW':!dto.deliveredCount?'NOT_DELIVERED':dto.deliveredCount===registration.quantity?'COMPLETED':'PARTIAL';
      const result=await tx.eventFulfilment.create({data:{registrationId:id,sessionId:session.id,revision:dto.expectedRevision+1,requestKey:dto.requestKey,requestHash:hash,actorId:req.actor.id,outcome,quantity:registration.quantity,attendanceCount:checks.length,deliveredCount:dto.deliveredCount,evidence:values.evidence,publicSummary:values.publicSummary,reason:values.reason,scheduleSnapshot:{startsAt:session.startsAt.toISOString(),endsAt:session.endsAt.toISOString(),location:session.location,scheduleVersion:session.scheduleVersion},attendanceSnapshot:checks.map(c=>({id:c.id,attendeeNo:c.attendeeNo,checkedAt:c.checkedAt.toISOString()}))}});
      await this.audit(tx,req,latest?'event.fulfilment.correct':'event.fulfilment.record',session.eventId,{registrationId:id,fulfilmentId:result.id,revision:result.revision,outcome,reason:values.reason});
      await tx.notification.create({data:{userId:registration.userId,eventKey:'event.fulfilment:'+result.id,kind:'BOOKING',registrationId:id,title:latest?'活动履约结果已更正':'活动履约结果已记录',body:values.publicSummary}});
      return result;
    });
  }
}

@Controller('admin/events') @UseGuards(AdminGuard)
export class EventStaffController {
  constructor(private readonly service:EventOperationsService){}
  @Get('workers') candidates(@Req() req:AuthRequest,@Query() q:TableQuery){return this.service.candidates(req,q);}
  @Get('sessions/:id/staff') list(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.staff(req,id);}
  @Post('sessions/:id/staff') grant(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:GrantDto){return this.service.grant(req,id,dto);}
  @Post('sessions/:id/staff/:staffId/revoke') revoke(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Param('staffId',ParseUUIDPipe) staffId:string,@Body() dto:RevokeStaffDto){return this.service.revokeStaff(req,id,staffId,dto);}
}
@Controller('me/bookings') @UseGuards(UserGuard)
export class EventCredentialController {
  constructor(private readonly service:EventOperationsService){}
  @Post('registrations/:id/checkin-code') code(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.credential(req,id);}
}
@Controller('me/event-workbench') @UseGuards(UserGuard)
export class EventWorkbenchController {
  constructor(private readonly service:EventOperationsService){}
  @Get() sessions(@Req() req:AuthRequest){return this.service.sessions(req);}
  @Get('sessions/:id/roster') roster(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Query() q:TableQuery){return this.service.roster(req,id,q);}
  @Post('inspect') inspect(@Req() req:AuthRequest,@Body() dto:CodeDto){return this.service.inspect(req,dto.code);}
  @Post('checkin') checkin(@Req() req:AuthRequest,@Body() dto:ScanDto){return this.service.scan(req,dto);}
  @Post('checkins/:id/revoke') revoke(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReasonDto){return this.service.revokeCheckin(req,id,dto);}
}
@Controller(['admin/events/workbench','admin/teaching/event-workbench']) @UseGuards(AdminGuard)
export class EventWorkbenchAdminController {
  constructor(private readonly service:EventOperationsService){}
  @Get() sessions(@Req() req:AuthRequest){return this.service.sessions(req);}
  @Get('sessions/:id/roster') roster(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Query() q:TableQuery){return this.service.roster(req,id,q);}
  @Post('inspect') inspect(@Req() req:AuthRequest,@Body() dto:CodeDto){return this.service.inspect(req,dto.code);}
  @Post('checkin') checkin(@Req() req:AuthRequest,@Body() dto:ScanDto){return this.service.scan(req,dto);}
  @Post('checkins/:id/revoke') revoke(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReasonDto){return this.service.revokeCheckin(req,id,dto);}
  @Get('registrations/:id/fulfilments') history(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.fulfilmentHistory(req,id);}
  @Post('registrations/:id/fulfilments') fulfil(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:FulfilmentDto){return this.service.fulfilment(req,id,dto);}
}
