import {productPromotionHints} from './product-promotions.js';
import { subtitleCues } from './subtitles.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Req, Res, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from './database.js';
import { AdminPermissions } from './admin-permissions.js';
import { AdminGuard, AuthService, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { LearningService } from './learning.js';
import { DiscoveryService } from './discovery.js';
import { publicContentScope } from './public-content.js';
import { Prisma } from './generated/prisma/client.js';
import { rtcRoomId, rtcStreamId, ZegoService } from './zego.js';
import { BookingsService } from './bookings.js';
import {activeMic,micAudience,micStreamId,endSessionMics} from './live-mics.js';

export const liveCategories=['CULTURE','QA','PRACTICE','MEMBER','EVENT'];
const terminal=['ENDED','REPLAY_READY','CANCELLED'];
const playerDirectory=fileURLToPath(new URL('../public/live/',import.meta.url));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
type Rule={mode:'PUBLIC'|'COURSE'|'MEMBER';courseId?:string;tier?:number;lessonBound?:boolean};
class RoomDto {
  @IsString() @Length(1,120) @Matches(/\S/) title!:string;
  @IsString() @Length(1,500) @Matches(/\S/) summary!:string;
  @IsUUID() teacherId!:string;
  @IsIn(liveCategories) categoryCode!:string;
  @IsIn(['PUBLIC','COURSE','MEMBER']) accessMode!:Rule['mode'];
  @IsOptional() @IsUUID() courseId?:string;
  @IsOptional() @IsInt() @Min(1) @Max(3) membershipTier?:number;
}
class SessionDto {
  @IsString() @Length(1,120) @Matches(/\S/) title!:string;
  @IsUUID() hostUserId!:string;
  @IsISO8601() scheduledAt!:string;
}
class StateDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsIn(['PREPARE','END','CANCEL']) action!:string;
  @IsString() @Length(1,500) @Matches(/\S/) reason!:string;
}
class LeaseDto { @IsString() @Length(43,43) @Matches(/^[a-zA-Z0-9_-]+$/) key!:string; @IsOptional() @IsBoolean() watching?:boolean; }
class RescheduleDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsISO8601() scheduledAt!:string;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class ReservationDto { @IsIn(['RESERVE','CANCEL']) action!:string; }
class ReplayDto {
  @IsOptional() @IsString() @Length(0,200000) subtitleText?:string;
  @IsOptional() @IsString() @Length(0,50000) notes?:string;
  @IsOptional() @IsInt() @Min(1) @Max(86400) durationSeconds?:number;
  @IsUUID() assetId!:string;
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Length(1,500) @Matches(/\S/) reason!:string;
}
class ReplayReviewDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsIn(['APPROVED','REJECTED']) state!:string;
  @IsString() @Length(1,500) @Matches(/\S/) reason!:string;
}

@Injectable()
export class LiveService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private working=false;
  private readonly logger=new Logger(LiveService.name);
  constructor(private readonly db:Database,private readonly zego:ZegoService,private readonly discovery:DiscoveryService,private readonly learning:LearningService,private readonly auth:AuthService,private readonly bookings:BookingsService,private readonly permissions:AdminPermissions){}
  onModuleInit(){if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runJobs().catch(()=>this.logger.error('Live recovery pending; will retry')),15000);this.timer.unref();}}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async session(id:string,store:Prisma.TransactionClient=this.db){const row=await store.liveSession.findUnique({where:{id}});if(!row)throw new NotFoundException('直播场次不存在');return row;}
  async access(id:string,userId:string,store:Prisma.TransactionClient=this.db){
    const row=await this.session(id,store);await this.discovery.publicItem(row.roomId,'LIVE',userId);
    const rule=row.accessRuleSnapshot as unknown as Rule;
    if(rule.mode==='PUBLIC')return row;
    if(rule.mode==='COURSE'&&rule.courseId){const context=await this.learning.context(rule.courseId,userId,store);if(context.access==='ENROLLED'||context.access==='MEMBER'){
      const release=context.releaseId?await store.courseRelease.findUnique({where:{id:context.releaseId}}):null;
      if(!release||release.withdrawnAt)throw new ForbiddenException('课程版本已停止交付，请查看课程处理方案');
      if(context.enrollment?.orderItemId){
        const item=await store.tradeOrderItem.findUniqueOrThrow({where:{id:context.enrollment.orderItemId}});
        if(await store.refund.findFirst({where:{orderId:item.orderId,state:{in:['APPROVED','REFUNDING']}}}))throw new ForbiddenException('课程正在办理退款，暂不能观看直播或回放');
      }
      if(rule.lessonBound&&!await store.lesson.findFirst({where:{releaseId:context.releaseId??'',liveSessionId:id,format:'LIVE'}}))throw new ForbiddenException('本场不属于你已获得的课程版本，请从课程目录进入');
      return row;
    }throw new ForbiddenException('加入对应课程后可观看本场直播');}
    if(rule.mode==='MEMBER'&&rule.tier){const member=await this.learning.membership(userId,store);if(member&&member.contentTier>=rule.tier)return row;throw new ForbiddenException('当前会员权益不能观看本场直播');}
    throw new ForbiddenException('直播准入规则尚未配置');
  }
  async room(id:string,userId?:string){
    const item=await this.discovery.publicItem(id,'LIVE',userId),room=await this.db.liveRoom.findUniqueOrThrow({where:{id}});
    const [teacher,active,upcoming,history]=await Promise.all([
      this.db.teacher.findUniqueOrThrow({where:{id:room.teacherId},select:{id:true,name:true,portrait:true}}),
      this.db.liveSession.findMany({where:{roomId:id,state:{in:['LIVE','PREPARING']}},orderBy:[{state:'asc'},{scheduledAt:'asc'},{id:'asc'}],take:50}),
      this.db.liveSession.findMany({where:{roomId:id,state:'SCHEDULED'},orderBy:[{scheduledAt:'asc'},{id:'asc'}],take:50}),
      this.db.liveSession.findMany({where:{roomId:id,state:{in:terminal}},orderBy:[{scheduledAt:'desc'},{id:'desc'}],take:25})
    ]);
    const sessions=[...active,...upcoming,...history].slice(0,50);
    const reservations=userId?await this.db.liveReservation.findMany({where:{sessionId:{in:sessions.map(s=>s.id)},userId,cancelledAt:null}}):[];
    return {...item,categoryCode:room.categoryCode,teacher,courseId:room.courseId,accessRule:room.accessRule,rtcReady:this.zego.ready(),sessions:await Promise.all(sessions.map(async s=>{
      let accessReason='';try{if(userId)await this.access(s.id,userId);else accessReason='请登录后进入直播';}catch(e){accessReason=e instanceof Error?e.message:'暂不可观看';}
      const replay=await this.db.liveReplay.findFirst({where:{sessionId:s.id,reviewState:'APPROVED',publishedAt:{not:null},reviewerId:{not:null}},select:{id:true}});
      return {id:s.id,title:s.title,version:s.version,scheduledAt:s.scheduledAt,startedAt:s.startedAt,endedAt:s.endedAt,state:s.state,disconnected:!!s.disconnectedAt,reserved:reservations.some(r=>r.sessionId===s.id),accessReason,replayReady:!!replay&&s.state==='REPLAY_READY'};
    }))};
  }
  async hostSessions(req:AuthRequest){
    requireRoles(req,['TEACHER']);
    return this.db.liveSession.findMany({where:{hostUserId:req.actor.id},orderBy:[{scheduledAt:'desc'},{id:'desc'}],take:100,select:{id:true,title:true,state:true,version:true,scheduledAt:true,roomId:true,disconnectedAt:true}});
  }
  async lessonLive(lessonId:string,userId:string){
    const {lesson}=await this.learning.lesson(lessonId,userId);
    if(lesson.format!=='LIVE'||!lesson.liveSessionId)throw new NotFoundException('本章尚未安排直播');
    const session=await this.access(lesson.liveSessionId,userId),replay=await this.db.liveReplay.findUnique({where:{sessionId:session.id}});
    return {id:session.id,roomId:session.roomId,title:session.title,state:session.state,scheduledAt:session.scheduledAt,disconnected:!!session.disconnectedAt,replayReady:session.state==='REPLAY_READY'&&replay?.reviewState==='APPROVED'&&!!replay.publishedAt&&!!replay.reviewerId};
  }
  async courseSessions(courseId:string){
    const rooms=await this.db.liveRoom.findMany({where:{courseId,provider:'ZEGO_RTC'},select:{id:true}});
    return this.db.liveSession.findMany({where:{roomId:{in:rooms.map(r=>r.id)},state:{not:'CANCELLED'}},orderBy:[{scheduledAt:'desc'},{id:'desc'}],take:200,select:{id:true,title:true,scheduledAt:true,state:true}});
  }
  async offers(id:string,userId:string){
    const s=await this.access(id,userId),related=await this.discovery.related(s.roomId,userId),items=[];
    for(const item of related.items.filter(r=>['COURSE','PRODUCT','EVENT'].includes(r.type)).slice(0,24)){
      if(item.type==='PRODUCT'){
          const skus=await this.db.productSku.findMany({where:{productId:item.id,active:true,price:{gt:0},product:{type:'PHYSICAL',status:'PUBLISHED',isDemo:false}},orderBy:{price:'asc'}}),hints=await productPromotionHints(this.db,skus.map(k=>k.id));
          const available=skus.filter(k=>k.stock>k.reserved||hints.some(h=>h.skuId===k.id&&h.remaining>0));
          if(available.length){const flash=hints.filter(h=>h.kind==='PRODUCT_FLASH'&&h.price!==null),best=flash.sort((a,b)=>Number(a.price)-Number(b.price))[0];items.push({...item,price:best?Number(best.price):available[0]!.price,promotion:best?{title:best.title,endsAt:best.endsAt.toISOString(),serverTime:new Date().toISOString()}:hints[0]?{title:hints[0].title,endsAt:hints[0].endsAt.toISOString(),serverTime:new Date().toISOString()}:null,action:best?'查看秒杀商品':'查看商品'});}
        }else if(item.type==='EVENT'){
        const sessions=await this.bookings.sessions(item.id,false,userId),tickets=sessions.flatMap(row=>row.tickets).filter(t=>t.available>0&&(t.bookingEnabled||t.purchaseAvailable));
        if(tickets.length)items.push({...item,price:Math.min(...tickets.map(t=>t.price!)),action:'查看报名'});
      }else{
        const course=await this.db.course.findUnique({where:{id:item.id},select:{price:true,publishedReleaseId:true}});
        if(course?.publishedReleaseId)items.push({...item,price:course.price,action:'查看课程'});
      }
    }
    return {items,membershipAvailable:(await this.learning.plans()).length>0};
  }
  async options(){return {teachers:await this.db.teacher.findMany({where:await publicContentScope(this.db),select:{id:true,name:true,userId:true},take:200}),hosts:await this.db.user.findMany({where:{status:'ACTIVE',roles:{hasSome:['ADMIN','TEACHER']}},select:{id:true,nickname:true,roles:true},take:200}),courses:await this.db.course.findMany({where:{OR:[await publicContentScope(this.db),{format:'LIVE',status:{in:['DRAFT','REJECTED','REVIEW']}}]},select:{id:true,title:true,teacherId:true,status:true},take:200}),rtcReady:this.zego.ready()};}
  async adminRooms(){
    const resources=await this.db.resource.findMany({where:{kind:'LIVE'},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:100});
    const rooms=await this.db.liveRoom.findMany({where:{id:{in:resources.map(r=>r.id)}}});return resources.map(r=>({...r,room:rooms.find(l=>l.id===r.id)}));
  }
  async adminSessions(id:string){const items=await this.db.liveSession.findMany({where:{roomId:id},orderBy:[{scheduledAt:'desc'},{id:'desc'}],take:100});return Promise.all(items.map(async s=>({...s,reservations:await this.db.liveReservation.count({where:{sessionId:s.id,cancelledAt:null}}),replay:await this.db.liveReplay.findUnique({where:{sessionId:s.id}})})));}
  async createRoom(req:AuthRequest,dto:RoomDto){
    requireRoles(req,['OPERATOR']);
    const teacher=await this.db.teacher.findFirst({where:{id:dto.teacherId,...await publicContentScope(this.db)}});if(!teacher)throw new BadRequestException('请选择已发布名师');
    if(dto.categoryCode==='MEMBER'&&dto.accessMode!=='MEMBER')throw new BadRequestException('会员专属直播须使用会员准入');
    if(dto.accessMode==='COURSE'&&!dto.courseId||dto.accessMode==='MEMBER'&&!dto.membershipTier)throw new BadRequestException('请完整设置直播准入规则');
    const course=dto.courseId?await this.db.course.findFirst({where:{id:dto.courseId,teacherId:dto.teacherId,OR:[await publicContentScope(this.db),{format:'LIVE',status:{in:['DRAFT','REJECTED','REVIEW']}}]}}):null;
    if(dto.courseId&&!course)throw new BadRequestException('请选择该名师的已发布课程或直播课程草稿');
    const id=randomUUID(),rule:Rule={mode:dto.accessMode,...(dto.accessMode==='COURSE'?{courseId:dto.courseId,...(course?.format==='LIVE'?{lessonBound:true}:{})}:{}),...(dto.accessMode==='MEMBER'?{tier:dto.membershipTier}:{})};
    return this.db.$transaction(async tx=>{
      await tx.resource.create({data:{id,kind:'LIVE',categoryCode:dto.categoryCode,title:dto.title.trim(),summary:dto.summary.trim(),publishState:'DRAFT',visibility:dto.accessMode==='MEMBER'?'MEMBER':dto.accessMode==='COURSE'?'COURSE':'PUBLIC'}});
      const room=await tx.liveRoom.create({data:{id,teacherId:dto.teacherId,provider:'ZEGO_RTC',providerRoomId:'academy_'+id.replace(/-/g,''),categoryCode:dto.categoryCode,accessRule:rule,courseId:dto.courseId??null}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.room.create',resource:'live',resourceId:id,changes:{categoryCode:dto.categoryCode,accessRule:rule}}});return room;
    });
  }
  async createSession(req:AuthRequest,roomId:string,dto:SessionDto){
    requireRoles(req,['OPERATOR']);return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveRoom" WHERE id=${roomId} FOR UPDATE`;
      const room=await tx.liveRoom.findUnique({where:{id:roomId}}),host=await tx.user.findFirst({where:{id:dto.hostUserId,status:'ACTIVE',roles:{hasSome:['TEACHER','ADMIN']}}});
      if(!room||room.provider!=='ZEGO_RTC')throw new BadRequestException('请新建 ZEGO RTC 直播间');
      const teacher=await tx.teacher.findUniqueOrThrow({where:{id:room.teacherId}});
      if(!host||!host.roles.includes('ADMIN')&&teacher.userId!==host.id)throw new BadRequestException('主播须为该名师关联账号或授权管理员');
      const scheduledAt=new Date(dto.scheduledAt);if(+scheduledAt<Date.now()-60000||+scheduledAt>Date.now()+366*86400000)throw new BadRequestException('开播时间须在现在至一年内');
      const id=randomUUID(),s=await tx.liveSession.create({data:{id,roomId,hostUserId:host.id,title:dto.title.trim(),scheduledAt,accessRuleSnapshot:room.accessRule as Prisma.InputJsonValue,providerSessionId:rtcRoomId(id)}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.session.create',resource:'live',resourceId:id,changes:{roomId,hostUserId:host.id,scheduledAt:dto.scheduledAt}}});return s;
    });
  }
  async state(req:AuthRequest,id:string,dto:StateDto,assignedHost=false){
    requireRoles(req,assignedHost?['TEACHER']:['OPERATOR']);
    if(assignedHost&&dto.action==='CANCEL')throw new ForbiddenException('取消课程场次请由运营处理交付补偿');return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;
      const row=await this.session(id,tx);if(assignedHost)await this.hostAllowed(row,req.actor.id,tx);if(row.version!==dto.expectedVersion)throw new ConflictException('场次已变化，请刷新');
      const valid=dto.action==='PREPARE'?row.state==='SCHEDULED':dto.action==='CANCEL'?['SCHEDULED','PREPARING'].includes(row.state):['PREPARING','LIVE'].includes(row.state);
      if(!valid)throw new ConflictException('当前状态不支持此操作');
      const state=dto.action==='PREPARE'?'PREPARING':dto.action==='CANCEL'?'CANCELLED':'ENDED',now=new Date();
      const result=await tx.liveSession.update({where:{id},data:{state,version:{increment:1},...(state==='ENDED'?{endedAt:now,disconnectedAt:null}:{})}});
      if(state==='CANCELLED'){
        const releases=await tx.$queryRaw<{id:string}[]>`SELECT r.id FROM "CourseRelease" r WHERE r."withdrawnAt" IS NULL AND EXISTS(SELECT 1 FROM "Lesson" l WHERE l."releaseId"=r.id AND l."liveSessionId"=${id}  ) ORDER BY r.id FOR UPDATE`;
        for(const release of releases){
          const reason='直播章节取消：'+dto.reason.trim(),changed=await tx.courseRelease.update({where:{id:release.id},data:{withdrawnAt:now,withdrawalReason:reason,deliveryVersion:{increment:1}}});
          await tx.auditLog.create({data:{actorId:req.actor.id,action:'course.release.withdraw',resource:'course_release',resourceId:release.id,reason,changes:{source:'live.session.cancel',sessionId:id,deliveryVersion:changed.deliveryVersion}}});
          await tx.outboxJob.create({data:{eventKey:'course.delivery.notice:'+release.id+':'+changed.deliveryVersion,kind:'COURSE_DELIVERY_NOTICE',aggregateType:'COURSE_RELEASE',aggregateId:release.id,payload:{deliveryVersion:changed.deliveryVersion,action:'WITHDRAW',reason},availableAt:now}});
        }
      }
      if(terminal.includes(state)){
        await tx.liveRtcLease.updateMany({where:{sessionId:id,revokedAt:null},data:{revokedAt:now}});await endSessionMics(tx,id,now);
        const reservations=await tx.liveReservation.findMany({where:{sessionId:id,cancelledAt:null}});
        for(const r of reservations)await tx.notification.upsert({where:{userId_eventKey:{userId:r.userId,eventKey:'live:'+id+':'+state}},create:{userId:r.userId,eventKey:'live:'+id+':'+state,kind:'LIVE',title:state==='CANCELLED'?'直播已取消':'直播已结束',body:row.title+'：'+dto.reason.trim(),resourceId:row.roomId},update:{}});
      }
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.session.'+dto.action.toLowerCase(),resource:'live',resourceId:id,changes:{before:row.state,state,reason:dto.reason.trim()}}});return result;
    });
  }
  async reschedule(req:AuthRequest,id:string,dto:RescheduleDto){
    requireRoles(req,['OPERATOR']);const next=new Date(dto.scheduledAt);
    if(+next<Date.now()+60000||+next>Date.now()+366*86400000)throw new BadRequestException('新安排须在一分钟后至一年内');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;
      const row=await this.session(id,tx);
      if(row.version!==dto.expectedVersion||row.state!=='SCHEDULED')throw new ConflictException('只能修改尚未准备开播的预告场次，请刷新');
      if(+row.scheduledAt===+next)throw new BadRequestException('新开播时间与原安排相同');
      const result=await tx.liveSession.update({where:{id},data:{scheduledAt:next,version:{increment:1},updatedAt:new Date()}});
      await tx.liveReservation.updateMany({where:{sessionId:id,cancelledAt:null},data:{reminderSentAt:null}});
      const reservations=await tx.liveReservation.findMany({where:{sessionId:id,cancelledAt:null}});
      const date=next.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
      for(const r of reservations)await tx.notification.create({data:{userId:r.userId,eventKey:'live:'+id+':reschedule:'+result.version,kind:'LIVE',title:'预约直播时间已调整',body:row.title+'改为北京时间 '+date+'；'+dto.reason.trim(),resourceId:row.roomId}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.session.reschedule',resource:'live',resourceId:id,changes:{before:row.scheduledAt.toISOString(),scheduledAt:next.toISOString(),reason:dto.reason.trim()}}});return result;
    });
  }
  async reserve(req:AuthRequest,id:string,dto:ReservationDto){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;const s=await this.session(id,tx);
    if(dto.action==='CANCEL'){await tx.liveReservation.updateMany({where:{sessionId:id,userId:req.actor.id,cancelledAt:null},data:{cancelledAt:new Date(),version:{increment:1}}});return {reserved:false};}
    await this.access(id,req.actor.id,tx);if(!['SCHEDULED','PREPARING'].includes(s.state))throw new ConflictException('本场已开播或结束，不能预约');
    await tx.liveReservation.upsert({where:{sessionId_userId:{sessionId:id,userId:req.actor.id}},create:{sessionId:id,userId:req.actor.id},update:{cancelledAt:null,version:{increment:1}}});return {reserved:true};
  });}
  async hostAllowed(session:Awaited<ReturnType<LiveService['session']>>,userId:string,store:Prisma.TransactionClient=this.db){
    const user=await store.user.findUnique({where:{id:userId}}),room=await store.liveRoom.findUniqueOrThrow({where:{id:session.roomId}}),teacher=await store.teacher.findUniqueOrThrow({where:{id:room.teacherId}});
    if(!user||user.status!=='ACTIVE'||session.hostUserId!==userId||!user.roles.includes('ADMIN')&&(!user.roles.includes('TEACHER')||teacher.userId!==userId))throw new ForbiddenException('仅本场授权主播可以开播');
    if(!(await this.permissions.resolve(user.roles)).includes('teaching.write'))throw new ForbiddenException('开播权限已撤销，请联系书院运营');
    await this.discovery.publicItem(session.roomId,'LIVE',userId);
  }
  async lease(req:AuthRequest,id:string,host=false){
    await this.auth.rateLimit('live-join:'+req.actor.id,60,60000);
    const result=await this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;
    const s=await this.session(id,tx);if(host)await this.hostAllowed(s,req.actor.id,tx);else await this.access(id,req.actor.id,tx);
    if(host?!['PREPARING','LIVE'].includes(s.state):s.state!=='LIVE')throw new ConflictException(host?'请先将场次设为准备开播':'本场尚未开播或已经结束');
    if(!this.zego.ready())throw new ServiceUnavailableException('ZEGO 房间权限认证或直播配置尚未完成');
    const key=randomBytes(32).toString('base64url'),idLease=randomUUID(),rtcUserId=(host?'h_':'v_')+req.actor.id.replace(/-/g,'')+'_'+idLease.slice(0,8);
    if(host)await tx.liveRtcLease.updateMany({where:{sessionId:id,role:'HOST',revokedAt:null},data:{revokedAt:new Date()}});
    await tx.liveRtcLease.create({data:{id:idLease,sessionId:id,userId:req.actor.id,authSessionId:req.authSessionId,rtcUserId,role:host?'HOST':'VIEWER',keyHash:hash(key),expiresAt:new Date(Date.now()+90000),absoluteExpiresAt:new Date(Date.now()+4*3600000)}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:host?'live.host.credential':'live.viewer.join',resource:'live',resourceId:id,changes:{leaseId:idLease}}});return {key,playerPath:'/live/player#'+key};
    });
    return result;
  }
  async markCourseStarted(id:string,userId:string){
    const session=await this.access(id,userId),rule=session.accessRuleSnapshot as unknown as Rule;
    if(!rule.lessonBound||!rule.courseId)return;
    const context=await this.learning.context(rule.courseId,userId),lesson=await this.db.lesson.findFirst({where:{releaseId:context.releaseId??'',liveSessionId:id,format:'LIVE'}});
    if(lesson)await this.learning.markPaidAccess(lesson.id,userId);
  }
  async refreshCheck(lease:{sessionId:string;userId:string;authSessionId:string;role:string},store:Prisma.TransactionClient=this.db){
    if(!await store.authSession.findFirst({where:{id:lease.authSessionId,userId:lease.userId,revokedAt:null,expiresAt:{gt:new Date()},user:{status:'ACTIVE'}}}))throw new UnauthorizedException('登录已失效');
    const session=await this.session(lease.sessionId,store);if(lease.role==='HOST'){await this.hostAllowed(session,lease.userId,store);if(!['PREPARING','LIVE'].includes(session.state))throw new ForbiddenException('本场已结束');}else{await this.access(session.id,lease.userId,store);if(session.state!=='LIVE')throw new ForbiddenException('本场已结束');}return session;
  }
  async refresh(key:string,watching=false){
    const result=await this.db.$transaction(async tx=>{
    const first=await tx.liveRtcLease.findUnique({where:{keyHash:hash(key)}});if(!first)throw new UnauthorizedException('直播会话已结束，请重新进入');
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${first.sessionId} FOR UPDATE`;
    const lease=await tx.liveRtcLease.findUnique({where:{id:first.id}}),now=new Date();
    if(!lease||lease.revokedAt||lease.expiresAt<=now||lease.absoluteExpiresAt<=now)throw new UnauthorizedException('直播会话已结束，请重新进入');
    const session=await this.refreshCheck(lease,tx),mic=lease.role==='HOST'?null:await activeMic(tx,session.id,lease.id),publishStreamId=lease.role==='HOST'?rtcStreamId(session.id):mic?micStreamId(lease.id):null,token=this.zego.token(lease.rtcUserId,session.id,!!publishStreamId,publishStreamId??undefined);
    if((await tx.liveRtcLease.updateMany({where:{id:lease.id,revokedAt:null,expiresAt:{gt:now}},data:{expiresAt:new Date(Math.min(+lease.absoluteExpiresAt,Date.now()+90000))}})).count!==1)throw new UnauthorizedException('直播会话已结束');return {...token,role:lease.role,title:session.title,publishStreamId,playStreamIds:[rtcStreamId(session.id),...(await micAudience(tx,session.id)).map(row=>row.streamId)].filter(id=>id!==publishStreamId)};
    });
    if(watching&&result.role==='VIEWER'){
      const lease=await this.db.liveRtcLease.findUniqueOrThrow({where:{keyHash:hash(key)}});
      await this.recordWatch(lease.sessionId,lease.userId);
    }
    return result;
  }
  async recordWatch(id:string,userId:string){
    const session=await this.access(id,userId),rule=session.accessRuleSnapshot as unknown as Rule;
    if(!rule.lessonBound||!rule.courseId||session.state!=='LIVE'||session.disconnectedAt)return;
    const context=await this.learning.context(rule.courseId,userId),lesson=await this.db.lesson.findFirst({where:{releaseId:context.releaseId??'',liveSessionId:id,format:'LIVE'}});
    if(!lesson)return;
    await this.learning.markPaidAccess(lesson.id,userId);
    const old=await this.db.studyProgress.findUnique({where:{userId_lessonId:{userId,lessonId:lesson.id}}});
    const elapsed=old?Math.min(30,Math.max(0,Math.floor((Date.now()-old.updatedAt.getTime())/1000))):0;
    await this.learning.progress(lesson.id,userId,{eventId:randomUUID(),positionSeconds:Math.min(lesson.durationSeconds,(old?.watchedSeconds??0)+elapsed),elapsedSeconds:elapsed,completed:false});
  }
  async leave(key:string){const lease=await this.db.liveRtcLease.findUnique({where:{keyHash:hash(key)}});if(lease)await this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${lease.sessionId} FOR UPDATE`;const now=new Date();await tx.liveRtcLease.updateMany({where:{id:lease.id,revokedAt:null},data:{revokedAt:now}});await tx.liveMicRequest.updateMany({where:{rtcSessionId:lease.id,state:{in:['WAITING','APPROVED','CONNECTED']}},data:{state:'ENDED',endedAt:now,version:{increment:1}}});});return {success:true};}
  async callback(body:Record<string,unknown>){
    this.zego.verifyCallback(body);
    if(!['stream_create','stream_close'].includes(String(body.event)))throw new BadRequestException('不支持的直播回调');
    const roomId=body.room_id??body.channel_id,streamId=body.stream_id??body.stream_alias,userId=body.user_id??body.publish_id,sequence=body.stream_seq,event=String(body.event);
    const time=body[event==='stream_create'?'create_time_ms':'close_time_ms']??String(Number(body[event==='stream_create'?'create_time':'close_time'])*1000);
    if(typeof roomId!=='string'||typeof streamId!=='string'||typeof userId!=='string'||typeof sequence!=='string'||!/^\d{1,30}$/.test(sequence)||!/^\d{13}$/.test(String(time)))throw new BadRequestException('直播回调字段不完整');
    const eventAt=new Date(Number(time));if(+eventAt>Date.now()+60000||+eventAt<946684800000)throw new BadRequestException('直播事件时间无效');
    const eventId=hash([event,roomId,streamId,body.stream_sid,sequence,time].join(':')),payloadHash=hash(JSON.stringify({event,roomId,streamId,userId,sequence,time,type:body.type??'',sid:body.stream_sid??''}));
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}))`;
      const sessions=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "LiveSession" WHERE "providerSessionId"=${roomId} FOR UPDATE`;
      const s=sessions[0]?await this.session(sessions[0].id,tx):null;
      const old=await tx.providerCallback.findFirst({where:{provider:'ZEGO_RTC',appScope:String(body.appid),externalEventId:eventId}});
      if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('同一直播事件内容不一致');return {received:true,duplicate:true};}
      let state='IGNORED';
      if(s&&streamId===rtcStreamId(s.id)&&!terminal.includes(s.state)){
        const newer=!s.providerEventAt||+eventAt>+s.providerEventAt||+eventAt===+s.providerEventAt&&BigInt(sequence)>BigInt(s.providerSequence??'0');
        const host=await tx.liveRtcLease.findFirst({where:{sessionId:s.id,rtcUserId:userId,role:'HOST',userId:s.hostUserId,revokedAt:null}});
        if(newer&&host){
          if(event==='stream_create'&&['PREPARING','LIVE'].includes(s.state)){
            if(host.expiresAt<=new Date()||host.absoluteExpiresAt<=new Date())throw new ForbiddenException('主播会话已失效');
            await this.refreshCheck(host,tx);
            await tx.liveSession.update({where:{id:s.id},data:{state:'LIVE',startedAt:s.startedAt??eventAt,endedAt:null,disconnectedAt:null,providerEventAt:eventAt,providerSequence:sequence,providerStreamSid:String(body.stream_sid??''),version:{increment:1}}});state='HANDLED';
            const reservations=await tx.liveReservation.findMany({where:{sessionId:s.id,cancelledAt:null}});
            for(const r of reservations)await tx.notification.upsert({where:{userId_eventKey:{userId:r.userId,eventKey:'live:'+s.id+':started'}},create:{userId:r.userId,eventKey:'live:'+s.id+':started',kind:'LIVE',title:'预约直播已开播',body:s.title,resourceId:s.roomId},update:{}});
          }else if(event==='stream_close'&&s.state==='LIVE'&&(!s.providerStreamSid||s.providerStreamSid===String(body.stream_sid??''))){
            const normal=String(body.type)==='0';await tx.liveSession.update({where:{id:s.id},data:{...(normal?{state:'ENDED',endedAt:eventAt,disconnectedAt:null}:{disconnectedAt:eventAt}),providerEventAt:eventAt,providerSequence:sequence,version:{increment:1}}});
            if(normal){await tx.liveRtcLease.updateMany({where:{sessionId:s.id,revokedAt:null},data:{revokedAt:new Date()}});await endSessionMics(tx,s.id);}state='HANDLED';
          }
        }
      }
      await tx.providerCallback.create({data:{provider:'ZEGO_RTC',appScope:String(body.appid),externalEventId:eventId,kind:event,payloadHash,payloadStorageRef:'live-session:'+(s?.id??'unknown'),signatureVerified:true,state,attempts:1,handledAt:new Date()}});return {received:true,handled:state==='HANDLED'};
    });
  }
  async reconcile(req:AuthRequest,id:string){
    requireRoles(req,['OPERATOR']);const s=await this.session(id),result=await this.zego.request('DescribeRTCStreamState',{StreamId:rtcStreamId(id),Sequence:String(Date.now())});
    if(![0,41004,41006].includes(result.Code))throw new ServiceUnavailableException('直播状态查询失败，请核查 ZEGO 项目配置');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;const current=await this.session(id,tx);if(current.version!==s.version)throw new ConflictException('场次已变化，请重新查询');let state=current.state;
      const activeHost=await tx.liveRtcLease.findFirst({where:{sessionId:id,role:'HOST',revokedAt:null,expiresAt:{gt:new Date()}}});
      if(!terminal.includes(state)&&result.Code===0&&activeHost&&['PREPARING','LIVE'].includes(state)){
        await this.refreshCheck(activeHost,tx);state='LIVE';await tx.liveSession.update({where:{id},data:{state,startedAt:current.startedAt??new Date(),disconnectedAt:null,providerCheckedAt:new Date(),version:{increment:1}}});
        const reservations=await tx.liveReservation.findMany({where:{sessionId:id,cancelledAt:null}});
        for(const r of reservations)await tx.notification.upsert({where:{userId_eventKey:{userId:r.userId,eventKey:'live:'+id+':started'}},create:{userId:r.userId,eventKey:'live:'+id+':started',kind:'LIVE',title:'预约直播已开播',body:current.title,resourceId:current.roomId},update:{}});
      }
      else if(state==='LIVE'&&result.Code!==0)await tx.liveSession.update({where:{id},data:{disconnectedAt:current.disconnectedAt??new Date(),version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.reconcile',resource:'live',resourceId:id,changes:{code:result.Code,requestId:String(result.RequestId??''),state}}});return {state,active:result.Code===0,providerCode:result.Code};
    });
  }
  async replay(req:AuthRequest,id:string,dto:ReplayDto){
    requireRoles(req,['OPERATOR']);return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;const s=await this.session(id,tx);
      if(s.version!==dto.expectedVersion||!['ENDED','REPLAY_READY'].includes(s.state))throw new ConflictException('仅已结束场次可提交回放，请刷新');
      const asset=await tx.mediaAsset.findFirst({where:{id:dto.assetId,status:'READY',mime:'video/mp4'}});
      if(!asset||(asset.variants as {uploadPurpose?:string})?.uploadPurpose)throw new BadRequestException('请选择媒体库中可用的课程视频，不能使用私人附件');
      const durationSeconds=dto.durationSeconds??asset.durationSeconds??null;
      if((s.accessRuleSnapshot as {lessonBound?:boolean}).lessonBound&&!durationSeconds)throw new BadRequestException('直播课程回放须填写实际视频时长，作为研习完成记录的依据');
      subtitleCues(dto.subtitleText??'',durationSeconds);
      const row=await tx.liveReplay.upsert({where:{sessionId:id},create:{sessionId:id,assetId:asset.id,durationSeconds,subtitleText:dto.subtitleText??'',notes:dto.notes??'',reviewState:'PENDING',accessRuleSnapshot:s.accessRuleSnapshot as Prisma.InputJsonValue},update:{assetId:asset.id,durationSeconds,subtitleText:dto.subtitleText??'',notes:dto.notes??'',reviewState:'PENDING',publishedAt:null,reviewerId:null,version:{increment:1}}});
      await tx.liveSession.update({where:{id},data:{state:'ENDED',version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.replay.submit',resource:'live',resourceId:id,changes:{assetId:asset.id,reason:dto.reason.trim()}}});return row;
    });
  }
  async reviewReplay(req:AuthRequest,id:string,dto:ReplayReviewDto){
    requireRoles(req,['MODERATOR']);return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${id} FOR UPDATE`;const s=await this.session(id,tx),replay=await tx.liveReplay.findUnique({where:{sessionId:id}});
      if(!replay||replay.version!==dto.expectedVersion||!['ENDED','REPLAY_READY'].includes(s.state))throw new ConflictException('回放已变化，请刷新');
      if(dto.state==='APPROVED'){
        await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${replay.assetId} FOR SHARE`;
        const asset=await tx.mediaAsset.findFirst({where:{id:replay.assetId,status:'READY',mime:'video/mp4'}});
        if(!asset||(asset.variants as {uploadPurpose?:string})?.uploadPurpose)throw new BadRequestException('回放视频暂不可用');
        subtitleCues(replay.subtitleText,replay.durationSeconds);
      }
      const row=await tx.liveReplay.update({where:{id:replay.id},data:{reviewState:dto.state,reviewerId:req.actor.id,publishedAt:dto.state==='APPROVED'?new Date():null,version:{increment:1}}});
      await tx.liveSession.update({where:{id},data:{state:dto.state==='APPROVED'?'REPLAY_READY':'ENDED',version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'live.replay.review',resource:'live',resourceId:id,changes:{state:dto.state,reason:dto.reason.trim()}}});return row;
    });
  }
  async runJobs(){
    if(this.working)return;this.working=true;
    try{
      const now=new Date();
      const reservations=await this.db.$queryRaw<{id:string;userId:string;sessionId:string;title:string;roomId:string}[]>`SELECT r.id,r."userId",r."sessionId",s.title,s."roomId" FROM "LiveReservation" r JOIN "LiveSession" s ON s.id=r."sessionId" WHERE r."cancelledAt" IS NULL AND r."reminderSentAt" IS NULL AND s.state IN ('SCHEDULED','PREPARING') AND s."scheduledAt"<=${new Date(Date.now()+10*60000)} AND s."scheduledAt">${now} ORDER BY s."scheduledAt",r.id LIMIT 100`;
      for(const r of reservations)await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${r.sessionId} FOR UPDATE`;
        const s=await this.session(r.sessionId,tx);if(!['SCHEDULED','PREPARING'].includes(s.state)||s.scheduledAt<=now||s.scheduledAt>new Date(Date.now()+10*60000))return;
        await tx.$queryRaw`SELECT id FROM "LiveReservation" WHERE id=${r.id} FOR UPDATE`;const row=await tx.liveReservation.findUniqueOrThrow({where:{id:r.id}});if(row.cancelledAt||row.reminderSentAt)return;
        const eventKey='live:'+r.sessionId+':reminder:'+s.scheduledAt.toISOString();
        await tx.notification.upsert({where:{userId_eventKey:{userId:r.userId,eventKey}},create:{userId:r.userId,eventKey,kind:'LIVE',title:'预约直播即将开始',body:s.title+'将在十分钟内开播',resourceId:r.roomId},update:{}});await tx.liveReservation.update({where:{id:r.id},data:{reminderSentAt:now}});
      });
      try{this.zego.config();}catch{return;}let cursor:string|undefined;
      do{
        const rows=await this.db.liveRtcLease.findMany({where:{kickedAt:null},orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
        for(const lease of rows){
          let valid=this.zego.ready()&&!lease.revokedAt&&lease.expiresAt>now&&lease.absoluteExpiresAt>now;
          if(valid)try{await this.refreshCheck(lease);}catch(e){if(e instanceof ServiceUnavailableException)continue;valid=false;}
          if(!valid){await this.db.liveRtcLease.updateMany({where:{id:lease.id,revokedAt:null},data:{revokedAt:now}});try{await this.zego.kick(lease.sessionId,lease.rtcUserId);await this.db.liveRtcLease.update({where:{id:lease.id},data:{kickedAt:new Date()}});}catch{this.logger.warn('RTC kick pending for expired lease');}}
        }
        cursor=rows.length===100?rows.at(-1)!.id:undefined;
      }while(cursor);
      const candidates=await this.db.$queryRaw<{id:string}[]>`SELECT s.id FROM "LiveSession" s WHERE
        (s.state='PREPARING' AND EXISTS(SELECT 1 FROM "LiveRtcLease" l WHERE l."sessionId"=s.id AND l.role='HOST' AND l."revokedAt" IS NULL AND l."expiresAt">now()))
        OR (s.state='LIVE' AND (s."providerCheckedAt" IS NULL OR s."providerCheckedAt"<now()-interval '30 seconds' OR s."disconnectedAt"<now()-interval '3 minutes' OR (s."startedAt"<now()-interval '3 minutes' AND NOT EXISTS(SELECT 1 FROM "LiveRtcLease" l WHERE l."sessionId"=s.id AND l.role='HOST' AND l."revokedAt" IS NULL AND l."expiresAt">now()))))
        ORDER BY s."providerCheckedAt" NULLS FIRST,s.id LIMIT 20`;
      for(const item of candidates)try{
        const before=await this.session(item.id),result=await this.zego.request('DescribeRTCStreamState',{StreamId:rtcStreamId(item.id),Sequence:String(Date.now())});
        if(![0,41004,41006].includes(result.Code))continue;
        await this.db.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${item.id} FOR UPDATE`;
          const s=await this.session(item.id,tx);if(s.version!==before.version||terminal.includes(s.state))return;
          await tx.liveSession.update({where:{id:s.id},data:{providerCheckedAt:new Date()}});
          const activeHost=await tx.liveRtcLease.findFirst({where:{sessionId:s.id,role:'HOST',revokedAt:null,expiresAt:{gt:new Date()}}});
          if(result.Code===0&&activeHost&&(s.state==='PREPARING'||s.state==='LIVE'&&s.disconnectedAt)){
            await this.refreshCheck(activeHost,tx);
            await tx.liveSession.update({where:{id:s.id},data:{state:'LIVE',startedAt:s.startedAt??new Date(),disconnectedAt:null,version:{increment:1},updatedAt:new Date()}});
            await tx.auditLog.create({data:{actorId:s.hostUserId,action:s.state==='PREPARING'?'live.session.recover-start':'live.session.recover-stream',resource:'live',resourceId:s.id,changes:{source:'worker',providerCode:result.Code}}});
            const listeners=await tx.liveReservation.findMany({where:{sessionId:s.id,cancelledAt:null}});
            for(const r of listeners)await tx.notification.upsert({where:{userId_eventKey:{userId:r.userId,eventKey:'live:'+s.id+':started'}},create:{userId:r.userId,eventKey:'live:'+s.id+':started',kind:'LIVE',title:'预约直播已开播',body:s.title,resourceId:s.roomId},update:{}});
          }else if(result.Code!==0&&s.state==='LIVE'&&(!activeHost&&!!s.startedAt&&+s.startedAt<Date.now()-3*60000||s.disconnectedAt&&+s.disconnectedAt<Date.now()-3*60000)){
            await tx.liveSession.update({where:{id:s.id},data:{state:'ENDED',endedAt:new Date(),disconnectedAt:null,version:{increment:1},updatedAt:new Date()}});
            await tx.liveRtcLease.updateMany({where:{sessionId:s.id,revokedAt:null},data:{revokedAt:new Date()}});await endSessionMics(tx,s.id);
            await tx.auditLog.create({data:{actorId:s.hostUserId,action:'live.session.recover-end',resource:'live',resourceId:s.id,changes:{providerCode:result.Code,source:'worker',reason:'连续断流或主播租约失效，ZEGO 确认无活跃流'}}});
          }else if(result.Code!==0&&s.state==='LIVE'&&!s.disconnectedAt){
            await tx.liveSession.update({where:{id:s.id},data:{disconnectedAt:new Date(),version:{increment:1}}});
            await tx.auditLog.create({data:{actorId:s.hostUserId,action:'live.session.detect-disconnect',resource:'live',resourceId:s.id,changes:{source:'worker',providerCode:result.Code}}});
          }
        });
      }catch{this.logger.warn('Live stream reconciliation pending');}
    }finally{this.working=false;}
  }
}

@Controller('admin/live') @UseGuards(AdminGuard)
export class LiveAdminController {
  constructor(private readonly live:LiveService){}
  @Get() list(){return this.live.adminRooms();}
  @Get('courses/:id/sessions') courseSessions(@Param('id',ParseUUIDPipe) id:string){return this.live.courseSessions(id);}
  @Get('options') options(){return this.live.options();}
  @Post() create(@Req() req:AuthRequest,@Body() dto:RoomDto){return this.live.createRoom(req,dto);}
  @Get('rooms/:id/sessions') sessions(@Param('id',ParseUUIDPipe) id:string){return this.live.adminSessions(id);}
  @Post('rooms/:id/sessions') schedule(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:SessionDto){return this.live.createSession(req,id,dto);}
  @Post('sessions/:id/state') state(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:StateDto){return this.live.state(req,id,dto);}
  @Post('sessions/:id/reschedule') reschedule(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:RescheduleDto){return this.live.reschedule(req,id,dto);}
  @Post('sessions/:id/host') host(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.lease(req,id,true);}
  @Post('sessions/:id/reconcile') reconcile(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.reconcile(req,id);}
  @Post('sessions/:id/replay') replay(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ReplayDto){return this.live.replay(req,id,dto);}
  @Post('sessions/:id/replay/review') review(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ReplayReviewDto){return this.live.reviewReplay(req,id,dto);}
}
@Controller('admin/live-host') @UseGuards(AdminGuard)
export class LiveHostController {
  constructor(private readonly live:LiveService){}
  @Get() list(@Req() req:AuthRequest){return this.live.hostSessions(req);}
  @Post(':id/state') state(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:StateDto){return this.live.state(req,id,dto,true);}
  @Post(':id/host') host(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.lease(req,id,true);}
}
@Controller('live')
export class LiveController {
  constructor(private readonly live:LiveService){}
  @Get('hosting') @UseGuards(UserGuard) hosting(@Req() req:AuthRequest){return this.live.hostSessions(req);}
  @Post('sessions/:id/host-state') @UseGuards(UserGuard) hostState(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:StateDto){return this.live.state(req,id,dto,true);}
  @Get('lessons/:id') @UseGuards(UserGuard) lesson(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.lessonLive(id,req.actor.id);}
  @Get('rooms/:id') @UseGuards(OptionalUserGuard) room(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.room(id,req.actor?.id);}
  @Post('sessions/:id/reservation') @UseGuards(UserGuard) reserve(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ReservationDto){return this.live.reserve(req,id,dto);}
  @Post('sessions/:id/join') @UseGuards(UserGuard) join(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.lease(req,id);}
  @Get('sessions/:id/offers') @UseGuards(UserGuard) offers(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.offers(id,req.actor.id);}
  @Post('sessions/:id/host') @UseGuards(UserGuard) host(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.live.lease(req,id,true);}
  @Post('rtc/refresh') refresh(@Body() dto:LeaseDto,@Res({passthrough:true}) res:Response){res.set('Cache-Control','no-store');return this.live.refresh(dto.key,dto.watching);}
  @Post('rtc/leave') leave(@Body() dto:LeaseDto){return this.live.leave(dto.key);}
  @Post('zego/callback') callback(@Body() body:Record<string,unknown>){return this.live.callback(body);}
  @Get('player') player(@Res() res:Response){res.removeHeader('X-Frame-Options');res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.zego.im wss://*.zego.im https://*.zego.com wss://*.zego.com https://*.zegocloud.com wss://*.zegocloud.com https://*.coolgcloud.com wss://*.coolgcloud.com https://*.coolbcloud.com wss://*.coolbcloud.com https://*.cooldcloud.com wss://*.cooldcloud.com https://*.coolfcloud.com wss://*.coolfcloud.com https://*.coolzcloud.com wss://*.coolzcloud.com; media-src blob:; img-src 'self' data:; frame-ancestors 'self' "+(process.env.CORS_ORIGINS??'').split(',').filter(Boolean).join(' ')});return res.sendFile(resolve(playerDirectory,'index.html'));}
  @Get('player/client.js') client(@Res() res:Response){return res.sendFile(resolve(playerDirectory,'client.js'));}
  @Get('player/client.css') css(@Res() res:Response){return res.sendFile(resolve(playerDirectory,'client.css'));}
  @Get('player/sdk.js') sdk(@Res() res:Response){res.set('Cache-Control','public, max-age=86400');return res.sendFile(resolve(playerDirectory,'sdk.js'));}
}
