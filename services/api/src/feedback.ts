import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { createHash } from 'node:crypto';
import { Database } from './database.js';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';

class FeedbackPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsIn(['OPEN','PROCESSING','CLOSED']) state?:string;
}
class FeedbackDto {
  @IsUUID() requestKey!:string;
  @IsIn(['SUGGESTION','ISSUE','CONTENT','OTHER']) kind!:string;
  @IsString() @Length(1,5000) @Matches(/\S/) body!:string;
}
class FeedbackReplyDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Length(1,5000) @Matches(/\S/) body!:string;
  @IsBoolean() internal!:boolean;
  @IsIn(['PROCESSING','CLOSED']) state!:string;
}
@Injectable()
export class FeedbackService {
  constructor(private readonly db:Database){}
  async list(query:FeedbackPage,userId?:string){
    const where={...(userId?{userId}:{}),...(query.state?{state:query.state}:{})};
    const [items,total]=await this.db.$transaction([this.db.feedback.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size,select:{id:true,kind:true,body:true,state:true,createdAt:true,version:true}}),this.db.feedback.count({where})]);return{items,total};
  }
  async detail(id:string,userId?:string){
    const row=await this.db.feedback.findFirst({where:{id,...(userId?{userId}:{})},select:{id:true,kind:true,body:true,state:true,createdAt:true,version:true}});if(!row)throw new NotFoundException('反馈不存在');
    const replies=await this.db.feedbackReply.findMany({where:{feedbackId:id,...(userId?{internal:false}:{})},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,body:true,internal:true,createdAt:true}});return{...row,replies};
  }
  async create(userId:string,dto:FeedbackDto){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const operation='feedback.create',payloadHash=createHash('sha256').update(JSON.stringify({kind:dto.kind,body:dto.body.trim()})).digest('hex');
    const cache=await tx.idempotencyRecord.findFirst({where:{userId,operation,requestKey:dto.requestKey}});if(cache){if(cache.payloadHash!==payloadHash)throw new ConflictException('提交编号已用于其他反馈');return cache.response;}
    if(await tx.feedback.count({where:{userId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=10)throw new BadRequestException('每日最多提交10条反馈，请等待书院回复');
    const row=await tx.feedback.create({data:{userId,kind:dto.kind,body:dto.body.trim(),state:'OPEN'}});
    await tx.idempotencyRecord.create({data:{userId,operation,requestKey:dto.requestKey,payloadHash,state:'DONE',responseCode:201,response:JSON.parse(JSON.stringify({id:row.id})),expiresAt:new Date(Date.now()+30*86400000)}});return{id:row.id};
  });}
  async reply(id:string,req:AuthRequest,dto:FeedbackReplyDto){requireRoles(req,['SUPPORT']);return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Feedback" WHERE id=${id} FOR UPDATE`;
    const row=await tx.feedback.findUnique({where:{id}});if(!row)throw new NotFoundException('反馈不存在');if(row.state==='CLOSED'||row.version!==dto.expectedVersion)throw new ConflictException('反馈已处理或关闭，请刷新');
    const reply=await tx.feedbackReply.create({data:{feedbackId:id,authorId:req.actor.id,body:dto.body.trim(),internal:dto.internal}});
    await tx.feedback.update({where:{id},data:{state:dto.state,assigneeId:req.actor.id,closedAt:dto.state==='CLOSED'?new Date():null,version:{increment:1},updatedAt:new Date()}});
    if(!dto.internal)await tx.notification.create({data:{userId:row.userId,eventKey:'feedback.reply:'+reply.id,kind:'FEEDBACK_REPLY',title:'书院已回复你的反馈',body:'请前往客服与反馈查看回复。'}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'feedback.reply',resource:'feedback',resourceId:id,changes:{replyId:reply.id,internal:dto.internal,state:dto.state}}});return{success:true};
  });}
}
@Controller('me/feedback') @UseGuards(UserGuard) export class FeedbackController {
  constructor(private readonly feedback:FeedbackService){}
  @Get() list(@Req() req:AuthRequest,@Query() query:FeedbackPage){return this.feedback.list(query,req.actor.id);}
  @Post() create(@Req() req:AuthRequest,@Body() dto:FeedbackDto){return this.feedback.create(req.actor.id,dto);}
  @Get(':id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.feedback.detail(id,req.actor.id);}
}
@Controller('admin/feedback') @UseGuards(AdminGuard) export class FeedbackAdminController {
  constructor(private readonly feedback:FeedbackService){}
  @Get() list(@Req() req:AuthRequest,@Query() query:FeedbackPage){requireRoles(req,['SUPPORT']);return this.feedback.list(query);}
  @Get(':id') detail(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){requireRoles(req,['SUPPORT']);return this.feedback.detail(id);}
  @Post(':id/replies') reply(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:FeedbackReplyDto){return this.feedback.reply(id,req,dto);}
}
