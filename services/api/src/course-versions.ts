import {courseReleaseWindow} from './course-member-benefits.js';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { createHash } from 'node:crypto';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { CourseSalesService } from './course-sales.js';
import { Prisma } from './generated/prisma/client.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
class ChoiceDto {
  @IsUUID() targetReleaseId!:string;
  @IsUUID() requestKey!:string;
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) confirmationHash!:string;
  @IsBoolean() accepted!:boolean;
}
class DeliveryDto {
  @IsIn(['WITHDRAW','RESTORE']) action!:string;
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
  @IsOptional() @IsUUID() replacementReleaseId?:string;
}
type Store = Database|Prisma.TransactionClient;

@Injectable()
export class CourseVersionsService {
  constructor(private readonly db:Database,private readonly sales:CourseSalesService){}
  private async options(courseId:string,userId:string,store:Store){
    const enrollment=await store.enrollment.findUnique({where:{userId_courseId:{userId,courseId}}});
    if(!enrollment||enrollment.revokedAt||enrollment.startsAt>new Date()||enrollment.expiresAt&&enrollment.expiresAt<=new Date())throw new NotFoundException('当前没有可调整的课程访问权');
    if(enrollment.cohortId)throw new ConflictException('营期课程版本由本期安排固定，请联系书院处理版本调整');
    if(enrollment.orderItemId&&await store.refund.findFirst({where:{orderId:(await store.tradeOrderItem.findUniqueOrThrow({where:{id:enrollment.orderItemId}})).orderId,state:{in:['REQUESTED','APPROVED','REFUNDING']},reasonCode:{in:['COURSE_RETURN','COURSE_WITHDRAWAL']}}}))throw new ConflictException('此课程正在办理退课，请先查看订单处理进度');
    const course=await store.course.findUniqueOrThrow({where:{id:courseId},include:{teacher:true}}),current=await store.courseRelease.findUniqueOrThrow({where:{id:enrollment.releaseId}});
    const prior=await store.courseVersionChoice.findMany({where:{enrollmentId:enrollment.id,userId,grantKey:enrollment.grantKey},orderBy:{createdAt:'desc'},take:100});
    const first=await store.courseVersionChoice.findFirst({where:{enrollmentId:enrollment.id,userId,grantKey:enrollment.grantKey},orderBy:{createdAt:'asc'}});
    const original=enrollment.orderItemId?(await store.tradeOrderItem.findUniqueOrThrow({where:{id:enrollment.orderItemId}})).courseReleaseId:first?.fromReleaseId??current.id;
    const latest=course.status==='PUBLISHED'&&course.teacher.status==='PUBLISHED'?course.publishedReleaseId:null;
    const ids=[...new Set([current.id,original,current.replacementReleaseId,latest,...prior.flatMap(c=>[c.fromReleaseId,c.toReleaseId])].filter((v):v is string=>!!v))];
    const releases=await store.courseRelease.findMany({where:{courseId,id:{in:ids}},orderBy:{version:'desc'},include:{lessons:{orderBy:{position:'asc'},select:{title:true,format:true,durationSeconds:true,required:true}}}});
    const choices=releases.map(release=>{
      const summary={releaseId:release.id,version:release.version,title:release.title,description:release.descriptionSnapshot,lessons:release.lessons,withdrawn:!!release.withdrawnAt,withdrawalReason:release.withdrawalReason,deliveryVersion:release.deliveryVersion};
      return{...summary,current:release.id===current.id,original:release.id===original,confirmationHash:hash({enrollmentId:enrollment.id,grantKey:enrollment.grantKey,enrollmentVersion:enrollment.version,expiresAt:enrollment.expiresAt,...summary})};
    });
    return{enrollment,choices,orderId:enrollment.orderItemId?(await store.tradeOrderItem.findUniqueOrThrow({where:{id:enrollment.orderItemId}})).orderId:null};
  }
  async detail(courseId:string,userId:string){
    const {enrollment,choices,orderId}=await this.options(courseId,userId,this.db);
    return{version:enrollment.version,currentReleaseId:enrollment.releaseId,expiresAt:enrollment.expiresAt,orderId,choices,explanation:'选择其他版本需你主动确认；已购原版、原学习记录与购买期限保留。升级不另收费，不延长或缩短原访问期。原版停止交付时可选择替代版，或从订单申请退课。'};
  }
  async choose(courseId:string,userId:string,dto:ChoiceDto){
    if(!dto.accepted)throw new BadRequestException('请阅读版本变化并主动确认');
    const requestHash=hash({courseId,target:dto.targetReleaseId,version:dto.expectedVersion,confirmationHash:dto.confirmationHash});
    await this.db.$transaction(async tx=>{
      if(!(await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`).length)throw new NotFoundException('账号不可用');
      const previous=await tx.courseVersionChoice.findUnique({where:{userId_requestKey:{userId,requestKey:dto.requestKey}}});
      if(previous){if(previous.requestHash!==requestHash)throw new ConflictException('确认标识已用于其他版本选择');return;}
      const {enrollment}=await this.options(courseId,userId,tx);
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id IN (${enrollment.releaseId},${dto.targetReleaseId}) ORDER BY id FOR SHARE`;
      const refreshed=await this.options(courseId,userId,tx),choice=refreshed.choices.find(c=>c.releaseId===dto.targetReleaseId);
      if(enrollment.version!==dto.expectedVersion||!choice||choice.confirmationHash!==dto.confirmationHash)throw new ConflictException('课程或版本说明已变化，请刷新并重新确认');
      if(choice.current||choice.withdrawn)throw new BadRequestException('当前版本无需重复选择，停止交付的版本无法开放');
      const target=await tx.courseRelease.findUniqueOrThrow({where:{id:choice.releaseId},include:{lessons:true}}),format=target.lessons.some(l=>l.format==='LIVE')?'LIVE':target.lessons.some(l=>l.format==='VIDEO')?'VIDEO':'AUDIO';
      const window=await courseReleaseWindow(tx,target,userId);if(window.phase!=='PUBLIC'&&!window.memberEarlyAccess)throw new BadRequestException('此版本尚未开放研习，请保留当前版本');
      if(!await this.sales.deliverable(target.lessons,format,tx))throw new BadRequestException('所选版本课件尚未就绪，请保留当前版本或联系书院');
      const current=refreshed.choices.find(c=>c.current)!,action=current.withdrawn?'REPLACEMENT':choice.version>current.version?'UPGRADE':'RESTORE';
      await tx.courseVersionChoice.create({data:{userId,enrollmentId:enrollment.id,grantKey:enrollment.grantKey,courseId,fromReleaseId:enrollment.releaseId,toReleaseId:choice.releaseId,requestKey:dto.requestKey,requestHash,action,consentSnapshot:{choice,previous:current,expiresAt:enrollment.expiresAt,explanation:'用户主动选择；原版本和历史保留；不改变访问期限',accepted:true}}});
      await tx.enrollment.update({where:{id:enrollment.id},data:{releaseId:choice.releaseId,version:{increment:1},updatedAt:new Date()}});
      await tx.auditLog.create({data:{actorId:userId,action:'course.version.choose',resource:'enrollment',resourceId:enrollment.id,changes:{action,fromReleaseId:enrollment.releaseId,toReleaseId:choice.releaseId,expiresAt:enrollment.expiresAt}}});
      await tx.notification.create({data:{userId,kind:'COURSE_VERSION',resourceId:courseId,eventKey:'course.version.choose:'+userId+':'+dto.requestKey,title:'课程版本已按你的选择更新',body:'原版与学习记录保留，原访问期限不变。可在课程学习页查看或切回可用旧版。'}});
    });return this.detail(courseId,userId);
  }
  async admin(courseId:string){
    if(!await this.db.course.findUnique({where:{id:courseId}}))throw new NotFoundException('课程不存在');
    return this.db.courseRelease.findMany({where:{courseId},orderBy:{version:'desc'},select:{id:true,version:true,title:true,createdAt:true,withdrawnAt:true,withdrawalReason:true,replacementReleaseId:true,deliveryVersion:true}});
  }
  async delivery(id:string,req:AuthRequest,dto:DeliveryDto){
    requireRoles(req,['MODERATOR']);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id IN (${id},${dto.replacementReleaseId??id}) ORDER BY id FOR UPDATE`;
      const release=await tx.courseRelease.findUnique({where:{id}});if(!release)throw new NotFoundException('课程版本不存在');
      if((await tx.course.findUniqueOrThrow({where:{id:release.courseId}})).format==='OFFLINE')throw new BadRequestException('线下课程停止新售可下架课程；已承诺课堂取消请从活动场次办理原路补偿，不能仅撤下课件替代实际服务');
      if(release.deliveryVersion!==dto.expectedVersion)throw new ConflictException('交付状态已变化，请刷新');
      if(dto.action==='WITHDRAW'&&release.withdrawnAt||dto.action==='RESTORE'&&!release.withdrawnAt)throw new ConflictException('该交付状态已处理');
      if(dto.replacementReleaseId){const replacement=await tx.courseRelease.findFirst({where:{id:dto.replacementReleaseId,courseId:release.courseId,withdrawnAt:null}});if(!replacement||replacement.id===id)throw new BadRequestException('替代版本必须属于同一课程且可交付');}
      if(dto.action==='RESTORE'){
        const lessons=await tx.lesson.findMany({where:{releaseId:id}}),format=lessons.some(l=>l.format==='LIVE')?'LIVE':lessons.some(l=>l.format==='VIDEO')?'VIDEO':'AUDIO';
        if(!await this.sales.deliverable(lessons,format,tx))throw new BadRequestException('课件仍不可用，请修复后再恢复交付');
      }
      const row=await tx.courseRelease.update({where:{id},data:{withdrawnAt:dto.action==='WITHDRAW'?new Date():null,withdrawalReason:dto.action==='WITHDRAW'?dto.reason.trim():null,replacementReleaseId:dto.action==='WITHDRAW'?dto.replacementReleaseId??null:null,deliveryVersion:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'course.release.'+dto.action.toLowerCase(),resource:'course_release',resourceId:id,reason:dto.reason.trim(),changes:{deliveryVersion:row.deliveryVersion,replacementReleaseId:row.replacementReleaseId}}});
      await tx.outboxJob.create({data:{eventKey:'course.delivery.notice:'+id+':'+row.deliveryVersion,kind:'COURSE_DELIVERY_NOTICE',aggregateType:'COURSE_RELEASE',aggregateId:id,payload:{deliveryVersion:row.deliveryVersion,action:dto.action,reason:dto.reason.trim()},availableAt:new Date()}});
      return row;
    });
  }
}
@Controller('learning/courses') @UseGuards(UserGuard) export class CourseVersionsController {
  constructor(private readonly versions:CourseVersionsService){}
  @Get(':id/versions') detail(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.versions.detail(id,req.actor.id);}
  @Post(':id/versions/choose') choose(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ChoiceDto){return this.versions.choose(id,req.actor.id,dto);}
}
@Controller('admin/course-versions') @UseGuards(AdminGuard) export class CourseVersionsAdminController {
  constructor(private readonly versions:CourseVersionsService){}
  @Get(':id') list(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){requireRoles(req,['OPERATOR','MODERATOR']);return this.versions.admin(id);}
  @Post(':id/delivery') delivery(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:DeliveryDto){return this.versions.delivery(id,req,dto);}
}
