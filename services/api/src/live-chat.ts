import { EventEmitter } from 'node:events';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { Prisma } from './generated/prisma/client.js';
import { LiveService } from './live.js';
import { ContentService } from './content.js';
import { publicContentScope } from './public-content.js';
import { ForumService } from './forum.js';

export const liveEvents=new EventEmitter();
class MessageDto {
  @IsUUID() requestKey!:string;
  @IsString() @Length(1,1000) @Matches(/\S/) body!:string;
  @IsOptional() @IsUUID() articleId?:string;
  @IsOptional() @IsString() @Length(1,80) blockKey?:string;
}
class MessageQuery {
  @IsOptional() @IsUUID() cursor?:string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=30;
  @IsOptional() @IsIn(['PENDING','APPROVED','REJECTED']) state?:string;
}
class QuoteQuery { @IsOptional() @IsString() @Length(0,100) q?:string; }
class ReviewDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsIn(['APPROVED','REJECTED','DELETE']) state!:string;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class MuteDto {
  @IsUUID() userId!:string;
  @IsInt() @Min(1) @Max(30) days!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class RevokeDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class ReportDto {
  @IsIn(['SPAM','INAPPROPRIATE','MISLEADING','COPYRIGHT','OTHER']) reason!:string;
  @IsString() @Length(0,1000) description!:string;
}

@Injectable()
export class LiveChatService {
  constructor(private readonly db:Database,private readonly live:LiveService,private readonly content:ContentService,private readonly forum:ForumService){}
  async canRead(id:string,userId:string,store:Prisma.TransactionClient=this.db){
    const s=await this.live.access(id,userId,store);
    if(!['LIVE','ENDED','REPLAY_READY'].includes(s.state))throw new ConflictException('本场讨论尚未开放');
    return s;
  }
  async messages(id:string,userId:string,q:MessageQuery){
    const s=await this.canRead(id,userId),now=new Date();
    const blocked=await this.db.userBlock.findMany({where:{OR:[{userId},{blockedId:userId}]},select:{userId:true,blockedId:true}});
    const visible:Prisma.CommentWhereInput={liveSessionId:id,deletedAt:null,OR:[{reviewState:'APPROVED'},{authorId:userId}],authorId:{notIn:blocked.map(b=>b.userId===userId?b.blockedId:b.userId)}};
    const cursor=q.cursor?await this.db.comment.findFirst({where:{...visible,id:q.cursor}}):null;
    if(q.cursor&&!cursor)throw new BadRequestException('讨论位置已变化，请刷新');
    const rows=await this.db.comment.findMany({where:{...visible,...(cursor?{AND:[{OR:[{createdAt:{lt:cursor.createdAt}},{createdAt:cursor.createdAt,id:{lt:cursor.id}}]}]}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size+1});
    const items=rows.slice(0,q.size),authors=await this.db.user.findMany({where:{id:{in:items.map(r=>r.authorId)}},select:{id:true,nickname:true}});
    const muted=!!await this.db.userRestriction.findFirst({where:{userId,scope:{in:['ALL','COMMENT','LIVE_COMMENT']},revokedAt:null,startsAt:{lte:now},AND:[{OR:[{endsAt:null},{endsAt:{gt:now}}]},{OR:[{resourceId:null},{resourceId:s.roomId}]}]}});
    return {items:items.reverse().map(r=>({id:r.id,body:r.body,quoteSnapshot:r.quoteSnapshot,reviewState:r.reviewState,createdAt:r.createdAt,author:authors.find(a=>a.id===r.authorId),mine:r.authorId===userId})),nextCursor:rows.length>q.size?rows[q.size-1]!.id:null,canPost:s.state==='LIVE'&&!muted,reason:s.state!=='LIVE'?'本场已结束，讨论保留供回顾':muted?'你暂时不能在本房间发言':''};
  }
  async quoteArticles(id:string,userId:string,q:QuoteQuery){
    await this.canRead(id,userId);
    // Only public source text can be quoted into a room with a wider audience.
    const rows=await this.db.article.findMany({where:{...await publicContentScope(this.db),visibility:'PUBLIC',...(q.q?.trim()?{title:{contains:q.q.trim(),mode:'insensitive'}}:{})},select:{id:true,title:true,blocks:true},orderBy:{publishedAt:'desc'},take:15});
    return {items:rows.map(r=>({id:r.id,title:r.title,blocks:(r.blocks as {id:string;type:string;text?:string}[]).filter(b=>b.type!=='image'&&b.text).map(b=>({key:b.id,text:b.text!.slice(0,500)}))})).filter(r=>r.blocks.length)};
  }
  async send(id:string,req:AuthRequest,dto:MessageDto){
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;
      const s=await this.canRead(id,req.actor.id,tx),body=dto.body.trim();
      if(!!dto.articleId!==!!dto.blockKey)throw new BadRequestException('请选择完整的经典引用');
      let quoteBlockId:string|undefined,quoteSnapshot:string|undefined;
      if(dto.articleId){const article=await this.content.readable(dto.articleId,req.actor.id);
        if(article.visibility!=='PUBLIC')throw new ForbiddenException('直播讨论只可引用公开经典原文');
        const block=(article.blocks as {id:string;type:string;text?:string}[]).find(b=>b.id===dto.blockKey&&b.type!=='image');
        if(!block?.text)throw new ConflictException('原文已变化，请重新选取');
        quoteSnapshot=block.text.slice(0,500);quoteBlockId=article.currentReleaseId?(await tx.articleBlock.findFirst({where:{releaseId:article.currentReleaseId,stableKey:dto.blockKey}}))?.id:undefined;
      }
      const prior=await tx.comment.findUnique({where:{liveSessionId_authorId_requestKey:{liveSessionId:id,authorId:req.actor.id,requestKey:dto.requestKey}}});
      if(prior){if(prior.body!==body||prior.quoteSnapshot!==(quoteSnapshot??null))throw new ConflictException('提交编号已用于其他发言');return {id:prior.id,reviewState:prior.reviewState};}
      if(s.state!=='LIVE')throw new ConflictException('本场已结束，不能继续发言');
      const now=new Date();
      if(await tx.userRestriction.findFirst({where:{userId:req.actor.id,scope:{in:['ALL','COMMENT','LIVE_COMMENT']},revokedAt:null,startsAt:{lte:now},AND:[{OR:[{endsAt:null},{endsAt:{gt:now}}]},{OR:[{resourceId:null},{resourceId:s.roomId}]}]}}))throw new ForbiddenException('你暂时不能在本房间发言');
      if(await tx.comment.count({where:{liveSessionId:id,authorId:req.actor.id,createdAt:{gte:new Date(Date.now()-60000)}}})>=6)throw new BadRequestException('发言过于频繁，请稍候再试');
      const row=await tx.comment.create({data:{resourceId:s.roomId,liveSessionId:id,authorId:req.actor.id,requestKey:dto.requestKey,body,quoteBlockId,quoteSnapshot,reviewState:'PENDING'}});
      return {id:row.id,reviewState:row.reviewState};
    });
    liveEvents.emit('change',id);return result;
  }
  async adminMessages(id:string,q:MessageQuery){
    await this.live.session(id);
    const rows=await this.db.comment.findMany({where:{liveSessionId:id,...(q.state?{reviewState:q.state}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,...(q.cursor?{cursor:{id:q.cursor},skip:1}:{})});
    const users=await this.db.user.findMany({where:{id:{in:rows.map(r=>r.authorId)}},select:{id:true,nickname:true}});
    return {items:rows.map(r=>({...r,authorName:users.find(u=>u.id===r.authorId)?.nickname??'学员'})),nextCursor:rows.length===q.size?rows.at(-1)!.id:null};
  }
  async review(id:string,messageId:string,req:AuthRequest,dto:ReviewDto){
    requireRoles(req,['MODERATOR']);await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;
      const row=await tx.comment.findFirst({where:{id:messageId,liveSessionId:id}});
      if(!row||row.version!==dto.expectedVersion||row.deletedAt)throw new ConflictException('发言已变化，请刷新');
      await tx.comment.update({where:{id:row.id},data:{...(dto.state==='DELETE'?{deletedAt:new Date()}:{reviewState:dto.state}),version:{increment:1},updatedAt:new Date()}});
      await tx.moderationAction.create({data:{actorId:req.actor.id,resourceId:row.resourceId,commentId:row.id,targetUserId:row.authorId,action:'LIVE_'+dto.state,reason:dto.reason.trim(),beforeSnapshot:{reviewState:row.reviewState},afterSnapshot:{reviewState:dto.state}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.message.review',resource:'live',resourceId:id,changes:{messageId,state:dto.state,reason:dto.reason.trim()}}});
    });liveEvents.emit('change',id);return {success:true};
  }
  async report(id:string,messageId:string,req:AuthRequest,dto:ReportDto){
    await this.canRead(id,req.actor.id);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Comment" WHERE id=${messageId} FOR UPDATE`;
      const row=await tx.comment.findFirst({where:{id:messageId,liveSessionId:id,reviewState:'APPROVED',deletedAt:null}});if(!row)throw new NotFoundException('发言不存在或已移除');
      const old=await tx.report.findFirst({where:{reporterId:req.actor.id,commentId:row.id,state:'PENDING'}});if(old)return {id:old.id,state:old.state};
      return tx.report.create({data:{reporterId:req.actor.id,commentId:row.id,reasonCode:dto.reason,description:dto.description.trim(),state:'PENDING'},select:{id:true,state:true}});
    });
  }
  async mute(roomId:string,req:AuthRequest,dto:MuteDto){
    requireRoles(req,['MODERATOR']);const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveRoom" WHERE id=${roomId} FOR UPDATE`;
      if(!await tx.liveRoom.findUnique({where:{id:roomId}})||!await tx.user.findUnique({where:{id:dto.userId}}))throw new NotFoundException('直播间或学员不存在');
      const prior=await tx.userRestriction.findFirst({where:{resourceId:roomId,userId:dto.userId,scope:'LIVE_COMMENT',revokedAt:null,endsAt:{gt:new Date()}}});if(prior)return prior;
      const action=await tx.moderationAction.create({data:{actorId:req.actor.id,resourceId:roomId,targetUserId:dto.userId,action:'LIVE_MUTE',reason:dto.reason.trim(),beforeSnapshot:{},afterSnapshot:{days:dto.days}}});
      const row=await tx.userRestriction.create({data:{resourceId:roomId,userId:dto.userId,scope:'LIVE_COMMENT',startsAt:new Date(),endsAt:new Date(Date.now()+dto.days*86400000),actionId:action.id}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.user.mute',resource:'live',resourceId:roomId,changes:{userId:dto.userId,days:dto.days,reason:dto.reason.trim()}}});return row;
    });liveEvents.emit('room',roomId);return result;
  }
  async restrictions(roomId:string){const rows=await this.db.userRestriction.findMany({where:{resourceId:roomId,scope:'LIVE_COMMENT',revokedAt:null,endsAt:{gt:new Date()}},orderBy:{createdAt:'desc'},take:100}),users=await this.db.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true}});return {items:rows.map(r=>({...r,nickname:users.find(u=>u.id===r.userId)?.nickname??'学员'}))};}
  async reports(roomId:string){
    const rows=await this.db.$queryRaw<(Prisma.ReportGetPayload<{}>&{body:string;authorId:string})[]>`SELECT r.*,c.body,c."authorId" FROM "Report" r JOIN "Comment" c ON c.id=r."commentId" WHERE c."resourceId"=${roomId} AND c."liveSessionId" IS NOT NULL AND r.state='PENDING' ORDER BY r."createdAt",r.id LIMIT 100`;
    return {items:rows};
  }
  async resolveReport(roomId:string,id:string,req:AuthRequest,dto:RevokeDto){
    const row=await this.db.report.findUnique({where:{id}}),comment=row?.commentId?await this.db.comment.findUnique({where:{id:row.commentId}}):null;
    if(!comment?.liveSessionId||comment.resourceId!==roomId)throw new NotFoundException('本直播间举报不存在');
    return this.forum.resolve(id,req,dto);
  }
  async revoke(roomId:string,id:string,req:AuthRequest,dto:RevokeDto){
    requireRoles(req,['MODERATOR']);await this.db.$transaction(async tx=>{
      const result=await tx.userRestriction.updateMany({where:{id,resourceId:roomId,scope:'LIVE_COMMENT',revokedAt:null,version:dto.expectedVersion},data:{revokedAt:new Date(),version:{increment:1},updatedAt:new Date()}});
      if(!result.count)throw new ConflictException('禁言记录已变化');
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.user.unmute',resource:'live',resourceId:roomId,changes:{restrictionId:id,reason:dto.reason.trim()}}});
    });liveEvents.emit('room',roomId);return {success:true};
  }
}
@Controller('live/sessions/:id') @UseGuards(UserGuard)
export class LiveChatController {
  constructor(private readonly chat:LiveChatService){}
  @Get('messages') messages(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() q:MessageQuery){return this.chat.messages(id,req.actor.id,q);}
  @Get('quote-articles') quotes(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() q:QuoteQuery){return this.chat.quoteArticles(id,req.actor.id,q);}
  @Post('messages') send(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:MessageDto){return this.chat.send(id,req,dto);}
  @Post('messages/:messageId/reports') report(@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) messageId:string,@Req() req:AuthRequest,@Body() dto:ReportDto){return this.chat.report(id,messageId,req,dto);}
}
@Controller('admin/live') @UseGuards(AdminGuard)
export class LiveChatAdminController {
  constructor(private readonly chat:LiveChatService){}
  @Get('sessions/:id/messages') messages(@Param('id',ParseUUIDPipe) id:string,@Query() q:MessageQuery){return this.chat.adminMessages(id,q);}
  @Post('sessions/:id/messages/:messageId/review') review(@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) messageId:string,@Req() req:AuthRequest,@Body() dto:ReviewDto){return this.chat.review(id,messageId,req,dto);}
  @Post('rooms/:id/mute') mute(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:MuteDto){return this.chat.mute(id,req,dto);}
  @Get('rooms/:id/restrictions') restrictions(@Param('id',ParseUUIDPipe) id:string){return this.chat.restrictions(id);}
  @Get('rooms/:id/reports') reports(@Param('id',ParseUUIDPipe) id:string){return this.chat.reports(id);}
  @Post('rooms/:id/reports/:reportId/review') resolve(@Param('id',ParseUUIDPipe) id:string,@Param('reportId',ParseUUIDPipe) reportId:string,@Req() req:AuthRequest,@Body() dto:RevokeDto){return this.chat.resolveReport(id,reportId,req,dto);}
  @Post('rooms/:id/restrictions/:restrictionId/review') revoke(@Param('id',ParseUUIDPipe) id:string,@Param('restrictionId',ParseUUIDPipe) restrictionId:string,@Req() req:AuthRequest,@Body() dto:RevokeDto){return this.chat.revoke(id,restrictionId,req,dto);}
}
