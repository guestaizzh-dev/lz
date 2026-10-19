import {dailyGrowthAllocated} from './consumption-policy.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Database } from './database.js';
import { LearningService, LearningContextQuery } from './learning.js';
import { TeachingService } from './teaching.js';
import { AdminGuard, UserGuard, type AuthRequest } from './auth.js';
import type { Prisma,Role } from './generated/prisma/client.js';
import {changePoints} from './points-accounting.js';
import {cohortPracticeDate} from './cohort-schedule.js';

const businessDay=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
const dayDate=(day:string)=>new Date(day+'T00:00:00Z');
class TaskDto {
  @IsString() @Length(1,120) @Matches(/\S/) title!:string;
  @IsString() @Length(1,10000) @Matches(/\S/) instructions!:string;
  @IsInt() @Min(1) @Max(365) requiredDays!:number;
  @IsBoolean() required!:boolean;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn?:string|null;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn?:string|null;
}
class CloseTaskDto { @IsInt() @Min(1) expectedVersion!:number; @IsString() @Length(2,500) reason!:string; }
class CheckinDto {
  @IsString() @Length(1,10000) @Matches(/\S/) body!:string;
  @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsUUID(undefined,{each:true}) assetIds!:string[];
}
class MonthQuery extends LearningContextQuery { @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month?:string; }
class CheckinPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
}
class PracticeReviewDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Length(1,10000) @Matches(/\S/) body!:string;
  @IsOptional() @IsInt() @Min(0) @Max(100) score?:number;
}
@Injectable()
export class PracticesService {
  constructor(private readonly db:Database,private readonly learning:LearningService,private readonly teaching:TeachingService){}
  private async access(courseId:string,userId:string,store:Prisma.TransactionClient=this.db,cohortId?:string,history=false){const context=await this.learning.context(courseId,userId,store,cohortId,history);if(context.access==='TRIAL')throw new ForbiddenException('加入课程后可参加研习打卡');return context;}
  async tasks(courseId:string,req:AuthRequest,month?:string,admin=false,cohortId?:string){
    if(admin)await this.teaching.staffAccess(courseId,req.actor,this.db,false,cohortId);else await this.access(courseId,req.actor.id,this.db,cohortId,true);
    const cohort=cohortId?await this.teaching.cohort(courseId,cohortId):null;
    const tasks=(await this.db.practiceTask.findMany({where:{courseId,cohortId:cohortId??null,lessonId:null},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100})).map(task=>({...task,startsOn:cohortPracticeDate(task.startsOn,task.scheduleStartsAt,cohort?.startsAt),endsOn:cohortPracticeDate(task.endsOn,task.scheduleStartsAt,cohort?.startsAt)}));
    if(admin)return{items:tasks};
    const context=await this.access(courseId,req.actor.id,this.db,cohortId,true),release=context.releaseId?await this.db.courseRelease.findUnique({where:{id:context.releaseId}}):null;
    const canParticipate=(!context.cohort||context.cohort.startsAt<=new Date()&&context.cohort.endsAt>new Date())&&!release?.withdrawnAt;
    const today=businessDay(),selectedMonth=month??today.slice(0,7);
    const from=dayDate(selectedMonth+'-01'),until=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,1));
    const where={taskId:{in:tasks.map(r=>r.id)},userId:req.actor.id,state:'VALID'};
    const [all,records]=await Promise.all([
      this.db.practiceCheckin.findMany({where,select:{taskId:true,businessDay:true}}),
      this.db.practiceCheckin.findMany({where:{...where,businessDay:{gte:from,lt:until}},orderBy:{businessDay:'desc'}}),
    ]);
    const images=await this.db.attachmentBinding.findMany({where:{checkinId:{in:records.map(r=>r.id)}},select:{checkinId:true,assetId:true},orderBy:{position:'asc'}});
    const reviews=await this.db.teacherReview.findMany({where:{checkinId:{in:records.map(r=>r.id)}}});
    return{cohort:context.cohort?{id:context.cohort.id,title:context.cohort.title}:null,canParticipate,today,month:selectedMonth,items:tasks.map(task=>{
      const rows=all.filter(r=>r.taskId===task.id),days=rows.map(r=>r.businessDay.toISOString().slice(0,10));
      let streak=0,cursor=days.includes(today)?dayDate(today):new Date(dayDate(today).valueOf()-86400000);const set=new Set(days);
      while(set.has(cursor.toISOString().slice(0,10))){streak++;cursor=new Date(cursor.valueOf()-86400000);}
      return{...task,completedDays:rows.length,complete:rows.length>=task.requiredDays,streak,checkins:records.filter(r=>r.taskId===task.id).map(r=>({...r,review:reviews.find(a=>a.checkinId===r.id)??null,assetIds:images.filter(a=>a.checkinId===r.id).map(a=>a.assetId)}))};
    })};
  }
  async create(courseId:string,req:AuthRequest,dto:TaskDto,cohortId?:string){
    for(const value of [dto.startsOn,dto.endsOn])if(value&&(!Number.isFinite(dayDate(value).valueOf())||dayDate(value).toISOString().slice(0,10)!==value))throw new BadRequestException('日期无效');
    if(dto.startsOn&&dto.endsOn&&dto.endsOn<dto.startsOn)throw new BadRequestException('结束日期不能早于开始日期');
    return this.db.$transaction(async tx=>{
      await this.teaching.staffAccess(courseId,req.actor,tx,true,cohortId);
      if(!await tx.course.findUnique({where:{id:courseId}}))throw new NotFoundException('课程不存在');
      const cohort=cohortId?await this.teaching.cohort(courseId,cohortId,tx,true):null;
      if(cohort?.state==='CANCELLED')throw new BadRequestException('已取消营期不能布置打卡');
      const startsOn=dto.startsOn??(cohort?cohort.startsAt.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}):null),endsOn=dto.endsOn??(cohort?new Date(cohort.endsAt.valueOf()-1).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}):null);
      if(cohort&&(cohort.endsAt<=new Date()||startsOn!<cohort.startsAt.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})||endsOn!>new Date(cohort.endsAt.valueOf()-1).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})))throw new BadRequestException('打卡日期须安排在本期内');
      if(startsOn&&endsOn&&dto.requiredDays>Math.floor((dayDate(endsOn).valueOf()-dayDate(startsOn).valueOf())/86400000)+1)throw new BadRequestException('目标打卡天数超过开放日期范围');
      const row=await tx.practiceTask.create({data:{courseId,cohortId:cohortId??null,title:dto.title.trim(),instructions:{text:dto.instructions.trim(),active:true},frequency:'DAILY',requiredDays:dto.requiredDays,required:dto.required,startsOn:startsOn?dayDate(startsOn):null,endsOn:endsOn?dayDate(endsOn):null}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'practice.task.create',resource:'practice_task',resourceId:row.id,changes:{courseId}}});return row;
    });
  }
  async close(id:string,req:AuthRequest,dto:CloseTaskDto){return this.db.$transaction(async tx=>{
    const task=await tx.practiceTask.findUnique({where:{id}});if(!task||task.lessonId)throw new NotFoundException('任务不存在');
    await this.teaching.staffAccess(task.courseId,req.actor,tx,true,task.cohortId??undefined);
    if((await tx.practiceTask.updateMany({where:{id,version:dto.expectedVersion},data:{instructions:{...(task.instructions as object),active:false},version:{increment:1},updatedAt:new Date()}})).count!==1)throw new ConflictException('任务已变化，请刷新');
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'practice.task.close',resource:'practice_task',resourceId:id,reason:dto.reason,changes:{closed:true}}});return{success:true};
  });}
  async checkin(id:string,userId:string,dto:CheckinDto,cohortId?:string){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`;
    const initial=await tx.practiceTask.findUnique({where:{id}});if(!initial||initial.lessonId||(initial.cohortId??undefined)!==cohortId)throw new NotFoundException('打卡任务不属于当前学习上下文');
    if(cohortId)await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${cohortId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "PracticeTask" WHERE id=${id} FOR SHARE`;
    const task=await tx.practiceTask.findUniqueOrThrow({where:{id}});
    const context=await this.access(task.courseId,userId,tx,cohortId);
    if(context.releaseId&&(await tx.courseRelease.findUniqueOrThrow({where:{id:context.releaseId}})).withdrawnAt)throw new ForbiddenException('此版本已停止教学交付');
    const day=businessDay(),date=dayDate(day);
    const prior=await tx.practiceCheckin.findFirst({where:{taskId:id,userId,businessDay:date}});
    if(prior){const bindings=await tx.attachmentBinding.findMany({where:{checkinId:prior.id},select:{assetId:true}});if(prior.body!==dto.body.trim()||bindings.map(r=>r.assetId).sort().join()!==[...dto.assetIds].sort().join())throw new ConflictException('今日已打卡，请查看已有记录');return prior;}
    const startsOn=cohortPracticeDate(task.startsOn,task.scheduleStartsAt,context.cohort?.startsAt),endsOn=cohortPracticeDate(task.endsOn,task.scheduleStartsAt,context.cohort?.startsAt);
    if((task.instructions as {active?:boolean}).active===false||startsOn&&startsOn>date||endsOn&&endsOn<date)throw new BadRequestException('当前不在打卡开放时间');
    if(dto.assetIds.length&&(await tx.mediaAsset.count({where:{id:{in:dto.assetIds},uploaderId:userId,status:'READY',visibility:'PRIVATE',mime:{in:['image/png','image/jpeg','image/webp']}}}))!==dto.assetIds.length)throw new BadRequestException('图片必须是本人上传的有效图片');
    const row=await tx.practiceCheckin.create({data:{taskId:id,userId,businessDay:date,body:dto.body.trim(),state:'VALID'}});
    for(let position=0;position<dto.assetIds.length;position++)await tx.attachmentBinding.create({data:{assetId:dto.assetIds[position]!,checkinId:row.id,position,purpose:'PRACTICE_IMAGE'}});
    const eventKey='practice.daily:'+userId+':'+day;
    if(!await tx.pointsLedger.findUnique({where:{eventKey}})){
      await changePoints(tx,userId,1n,eventKey,'每日有效研习打卡',{businessDay:date,ruleSnapshot:{dailyLimit:1,points:1}});
      const gained=await dailyGrowthAllocated(tx,userId,date),delta=Math.max(0,Math.min(2,20-gained));
      if(delta)await tx.growthLedger.create({data:{userId,delta,businessDay:date,eventKey,reason:'每日有效研习打卡',ruleSnapshot:{dailyLimit:20,growth:2}}});
    }
    return row;
  });}
  async checkinAccess(id:string,actor:{id:string;roles:Role[]}){
    const row=await this.db.practiceCheckin.findUnique({where:{id}});if(!row)throw new NotFoundException('打卡不存在');
    const task=await this.db.practiceTask.findUniqueOrThrow({where:{id:row.taskId}});
    if(actor.id===row.userId)await this.access(task.courseId,actor.id,this.db,task.cohortId??undefined,!!task.cohortId);else await this.teaching.staffAccess(task.courseId,actor,this.db,false,task.cohortId??undefined);
    return row;
  }
  async records(taskId:string,req:AuthRequest,query:CheckinPage){
    const task=await this.db.practiceTask.findUnique({where:{id:taskId}});if(!task||task.lessonId)throw new NotFoundException('任务不存在');
    await this.teaching.staffAccess(task.courseId,req.actor,this.db,false,task.cohortId??undefined);
    const where={taskId,state:'VALID'};
    const [rows,total]=await this.db.$transaction([this.db.practiceCheckin.findMany({where,orderBy:[{businessDay:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.practiceCheckin.count({where})]);
    const [users,images,reviews]=await Promise.all([
      this.db.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true}}),
      this.db.attachmentBinding.findMany({where:{checkinId:{in:rows.map(r=>r.id)}},orderBy:{position:'asc'}}),
      this.db.teacherReview.findMany({where:{checkinId:{in:rows.map(r=>r.id)}}}),
    ]);
    return{items:rows.map(r=>({...r,nickname:users.find(u=>u.id===r.userId)?.nickname??'已注销',assetIds:images.filter(a=>a.checkinId===r.id).map(a=>a.assetId),review:reviews.find(a=>a.checkinId===r.id)??null})),total};
  }
  async review(id:string,req:AuthRequest,dto:PracticeReviewDto){return this.db.$transaction(async tx=>{
    const initial=await tx.practiceCheckin.findUnique({where:{id}});if(!initial)throw new NotFoundException('记录不存在');
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} AND status='ACTIVE' FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PracticeCheckin" WHERE id=${id} FOR UPDATE`;
    const row=await tx.practiceCheckin.findUniqueOrThrow({where:{id}}),task=await tx.practiceTask.findUniqueOrThrow({where:{id:row.taskId}});
    if(task.lessonId)throw new NotFoundException('记录不存在');
    await this.teaching.staffAccess(task.courseId,req.actor,tx,true,task.cohortId??undefined);
    if(row.userId===req.actor.id)throw new ForbiddenException('不能点评自己的实践记录');
    if(row.state!=='VALID'||row.version!==dto.expectedVersion||await tx.teacherReview.findFirst({where:{checkinId:id}}))throw new ConflictException('记录已变化或已点评，请刷新');
    const result=await tx.teacherReview.create({data:{checkinId:id,reviewerId:req.actor.id,body:dto.body.trim(),score:dto.score??null,state:'REVIEWED',reviewedAt:new Date()}});
    await tx.practiceCheckin.update({where:{id},data:{version:{increment:1},updatedAt:new Date()}});
    await tx.notification.create({data:{userId:row.userId,title:'研习打卡已获点评',body:dto.body.trim(),kind:'PRACTICE_REVIEW',cohortId:task.cohortId,resourceId:task.courseId,eventKey:'practice.review:'+id}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'practice.checkin.review',resource:'practice_checkin',resourceId:id,changes:{reviewId:result.id,score:dto.score??null}}});
    return result;
  });}
}
@Controller('learning') @UseGuards(UserGuard) export class PracticesController {
  constructor(private readonly practices:PracticesService){}
  @Get('courses/:id/practices') tasks(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() query:MonthQuery){return this.practices.tasks(id,req,query.month,false,query.cohortId);}
  @Post('practices/:id/checkins') checkin(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:CheckinDto,@Query() query:LearningContextQuery){return this.practices.checkin(id,req.actor.id,dto,query.cohortId);}
}
@Controller('admin/teaching') @UseGuards(AdminGuard) export class PracticesAdminController {
  constructor(private readonly practices:PracticesService){}
  @Get('courses/:id/practices') tasks(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() query:LearningContextQuery){return this.practices.tasks(id,req,undefined,true,query.cohortId);}
  @Post('courses/:id/practices') create(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:TaskDto,@Query() query:LearningContextQuery){return this.practices.create(id,req,dto,query.cohortId);}
  @Post('practices/:id/close') close(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:CloseTaskDto){return this.practices.close(id,req,dto);}
  @Get('practices/:id/checkins') records(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() query:CheckinPage){return this.practices.records(id,req,query);}
  @Post('checkins/:id/review') review(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:PracticeReviewDto){return this.practices.review(id,req,dto);}
}
