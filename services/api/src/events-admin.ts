import {Categories,validateCategory} from './categories.js';
import {imageUrlPattern} from './image-url.js';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Database } from './database.js';
import { AdminGuard, requireRoles, type AuthRequest } from './auth.js';
import { TableQuery, TransitionDto } from './admin.js';
import type { PublishStatus } from './generated/prisma/client.js';

class EventDto {
  @IsOptional() @IsUUID() teacherId?:string|null;
  @IsString() @Length(1,150) title!:string;
  @IsString() @Length(1,5000) description!:string;
  @IsString() @Length(1,40) category!:string;
  @IsOptional() @IsBoolean() studyTour?:boolean;
  @IsOptional() @IsString() @Length(0,4000) studyTourBrief?:string;
  @IsString() @Matches(imageUrlPattern,{message:'请上传有效的图片'}) cover!:string;
  @IsString() @Length(1,200) location!:string;
  @IsISO8601() startsAt!:string;
  @IsISO8601() endsAt!:string;
  @IsInt() @Min(1) @Max(100000) capacity!:number;
  @IsInt() @Min(0) @Max(100000000) price!:number;
  @IsOptional() @IsUUID() responsibleUserId?:string;
}
class EventEditDto extends EventDto {
  @IsInt() @Min(1) expectedVersion!:number;
}
@Injectable()
export class EventsAdmin {
  constructor(private readonly db:Database) {}
  async list(query:TableQuery) {
    const where={...(query.category?{category:query.category}:{}),...(query.status?{status:query.status}:{}),...(query.q?{OR:[{title:{contains:query.q,mode:'insensitive' as const}},{id:query.q}]}:{})};
    const [items,total]=await this.db.$transaction([this.db.event.findMany({where,orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.event.count({where})]);
    const teachers=await this.db.teacher.findMany({where:{id:{in:items.flatMap(x=>x.teacherId?[x.teacherId]:[])}},select:{id:true,name:true}});
    const staff=await this.db.user.findMany({where:{id:{in:items.map(item=>item.responsibleUserId)},status:'ACTIVE'},select:{id:true,nickname:true}});
    return {items:items.map(item=>({...item,teacherName:teachers.find(t=>t.id===item.teacherId)?.name??null,responsibleUserName:staff.find(user=>user.id===item.responsibleUserId)?.nickname??'已停用账号'})),total};
  }
  async teachers(){return this.db.teacher.findMany({where:{status:'PUBLISHED'},select:{id:true,name:true},orderBy:{name:'asc'},take:500});}
  async staff() {return this.db.user.findMany({where:{status:'ACTIVE',OR:[{roles:{has:'ADMIN'}},{roles:{has:'OPERATOR'}}]},select:{id:true,nickname:true},orderBy:[{nickname:'asc'},{id:'asc'}],take:200});}
  async save(req:AuthRequest,dto:EventDto|EventEditDto,id?:string) {
    requireRoles(req,['OPERATOR']);
    if(new Date(dto.endsAt)<=new Date(dto.startsAt)||!dto.title.trim()||!dto.description.trim()||!dto.location.trim())throw new BadRequestException('请填写活动资料，结束时间须晚于开始时间');
    const {expectedVersion:_,...data}=dto as EventEditDto;
    if(data.studyTour&&(!data.studyTourBrief||data.studyTourBrief.trim().length<10))throw new BadRequestException('研学活动须说明实际行程、集合安排、费用包含与不包含及必要参加条件');
    return this.db.$transaction(async tx=>{
      await validateCategory(tx, 'EVENT', dto.category, id ? (await tx.event.findUnique({where:{id},select:{category:true}}))?.category : undefined);
      if(data.responsibleUserId&&!await tx.user.findFirst({where:{id:data.responsibleUserId,status:'ACTIVE',OR:[{roles:{has:'ADMIN'}},{roles:{has:'OPERATOR'}}]},select:{id:true}}))throw new BadRequestException('请选择有效的管理员或运营人员');
      if(data.teacherId&&!await tx.teacher.findFirst({where:{id:data.teacherId,status:'PUBLISHED'}}))throw new BadRequestException('请选择已发布的活动主讲');
      let event;
      if(id){
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${id} FOR UPDATE`;
        const original=await tx.event.findUniqueOrThrow({where:{id}});
        if(data.teacherId!==undefined&&data.teacherId!==original.teacherId&&await tx.offlineCourseSession.count({where:{sessionId:{in:(await tx.eventSession.findMany({where:{eventId:id},select:{id:true}})).map(x=>x.id)}}}))throw new ConflictException('已固定课程的活动主讲不得追溯替换，请创建新的活动场次');
        if((data.studyTour!==undefined&&data.studyTour!==original.studyTour||data.studyTourBrief!==undefined&&data.studyTourBrief!==original.studyTourBrief)&&await tx.eventSession.count({where:{eventId:id}}))throw new ConflictException('已有场次的研学类型与行程约定须保留，请创建新活动安排变更');
        const changed=await tx.event.updateMany({where:{id,version:(dto as EventEditDto).expectedVersion,status:{in:['DRAFT','REJECTED']}},data:{...data,startsAt:new Date(data.startsAt),endsAt:new Date(data.endsAt),version:{increment:1}}});
        if(!changed.count)throw new ConflictException('活动版本或状态已变化；已发布活动需先下架');
        event=await tx.event.findUniqueOrThrow({where:{id}});
      }else event=await tx.event.create({data:{...data,startsAt:new Date(data.startsAt),endsAt:new Date(data.endsAt),responsibleUserId:data.responsibleUserId??req.actor.id}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:id?'event.edit':'event.create',resource:'event',resourceId:event.id,requestId:req.requestId??'',changes:{title:event.title,responsibleUserId:event.responsibleUserId,version:event.version}}});
      return event;
    });
  }
  async transition(req:AuthRequest,id:string,dto:TransitionDto) {
    requireRoles(req,['publish','reject'].includes(dto.action)?['MODERATOR']:['OPERATOR']);
    if(dto.reason.trim().length<1)throw new BadRequestException('请填写操作原因');
    const states:Record<string,{from:PublishStatus[];to:PublishStatus}>={submit:{from:['DRAFT','REJECTED'],to:'REVIEW'},publish:{from:req.actor.roles.includes('ADMIN')?['DRAFT','REJECTED','REVIEW']:['REVIEW'],to:'PUBLISHED'},reject:{from:['REVIEW'],to:'REJECTED'},archive:{from:['PUBLISHED'],to:'ARCHIVED'},revise:{from:req.actor.roles.includes('ADMIN')?['ARCHIVED','REJECTED','PUBLISHED']:['ARCHIVED','REJECTED'],to:'DRAFT'}};
    const state=states[dto.action]!;
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${id} FOR UPDATE`;
      const event=await tx.event.findUnique({where:{id}});
      if(!event||event.version!==dto.expectedVersion||!state.from.includes(event.status))throw new ConflictException('活动状态或版本已变化，请刷新');
      if(['submit','publish'].includes(dto.action)&&event.endsAt<=new Date())throw new BadRequestException('已结束活动不能提交或发布');
      if(dto.action==='revise'&&await tx.eventRegistration.count({where:{ticketTypeId:{in:(await tx.eventTicketType.findMany({where:{sessionId:{in:(await tx.eventSession.findMany({where:{eventId:id},select:{id:true}})).map(row=>row.id)}},select:{id:true}})).map(row=>row.id)},state:{notIn:['CANCELLED','REFUNDED']}}}))throw new ConflictException('活动已有报名记录，不能修改已售活动资料；请创建新的活动');
      const changed=await tx.event.updateMany({where:{id,version:dto.expectedVersion,status:event.status},data:{status:state.to,version:{increment:1}}});
      if(!changed.count)throw new ConflictException('活动已被其他人更新，请刷新');
      if(state.to==='PUBLISHED'&&req.actor.roles.includes('ADMIN')&&!await tx.eventSession.count({where:{eventId:id}})){
        const open=new Date();if(event.startsAt<=open)throw new BadRequestException('活动开始时间已过，请调整后再开放报名');
        const cancel=new Date(Math.max(+open,+event.startsAt-3600000));
        const session=await tx.eventSession.create({data:{eventId:id,startsAt:event.startsAt,endsAt:event.endsAt,publicOpenAt:open,cancelDeadline:cancel,location:event.location,capacity:event.capacity,state:'OPEN'}});
        const ticket=await tx.eventTicketType.create({data:{sessionId:session.id,title:'普通席位',capacity:event.capacity,perUserLimit:1,active:true}});
        await tx.saleOffer.create({data:{kind:'EVENT',eventTicketId:ticket.id,price:BigInt(event.price),active:true,quantityLimit:1,policySnapshot:{eventTitle:event.title,cancelDeadline:cancel.toISOString(),memberDiscountEligible:false}}});
        await tx.auditLog.create({data:{actorId:req.actor.id,action:'event.session.create',resource:'event_session',resourceId:session.id,changes:{eventId:id,capacity:event.capacity,automatic:true}}});
      }
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'event.'+dto.action,resource:'event',resourceId:id,requestId:req.requestId??'',reason:dto.reason,changes:{from:event.status,to:state.to,version:event.version+1}}});
      return {success:true};
    });
  }
}
@Controller('admin/events') @UseGuards(AdminGuard)
export class EventsAdminController {
  constructor(private readonly events:EventsAdmin,private readonly categories:Categories) {}
  @Get() list(@Query() query:TableQuery) {return this.events.list(query).then(value=>this.categories.decorate('EVENT',value));}
  @Get('teachers') teachers(){return this.events.teachers();}
  @Get('staff') staff(@Req() req:AuthRequest) {requireRoles(req,['OPERATOR']);return this.events.staff();}
  @Post() create(@Req() req:AuthRequest,@Body() dto:EventDto) {return this.events.save(req,dto);}
  @Patch(':id') update(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:EventEditDto) {return this.events.save(req,dto,id);}
  @Post(':id/transition') transition(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:TransitionDto) {return this.events.transition(req,id,dto);}
}
