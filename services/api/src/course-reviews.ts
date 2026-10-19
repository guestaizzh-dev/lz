import { publicContentScope } from './public-content.js';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { LearningService } from './learning.js';

class ReviewPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsIn(['PENDING','APPROVED','REJECTED','REMOVED']) state?:string;
  @IsOptional() @IsUUID() courseId?:string;
}
class CourseReviewDto {
  @IsInt() @Min(0) expectedVersion!:number;
  @IsInt() @Min(1) @Max(5) rating!:number;
  @IsString() @Length(1,5000) @Matches(/\S/) body!:string;
}
class VersionDto { @IsInt() @Min(1) expectedVersion!:number; }
class ModerateDto extends VersionDto {
  @IsIn(['APPROVE','REJECT','HIDE','RESTORE']) action!:string;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
@Injectable()
export class CourseReviewsService {
  constructor(private readonly db:Database,private readonly learning:LearningService){}
  async list(courseId:string,query:ReviewPage,userId?:string){
    const course=await this.db.course.findFirst({where:{id:courseId,...await publicContentScope(this.db),teacher:await publicContentScope(this.db)}});if(!course)throw new NotFoundException('课程不存在或已下架');
    const blocks=userId?await this.db.userBlock.findMany({where:{OR:[{userId},{blockedId:userId}]}}):[];
    const where={courseId,reviewState:'APPROVED',deletedAt:null,userId:{notIn:blocks.map(b=>b.userId===userId?b.blockedId:b.userId)}};
    const [rows,total,stats]=await this.db.$transaction([this.db.courseReview.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.courseReview.count({where}),this.db.courseReview.aggregate({where,_avg:{rating:true}})]);
    const users=await this.db.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true}});
    return{items:rows.map(r=>({id:r.id,rating:r.rating,body:r.body,createdAt:r.createdAt,nickname:users.find(u=>u.id===r.userId)?.nickname??'书院学友'})),total,average:stats._avg.rating??null};
  }
  async mine(courseId:string,userId:string){return{review:await this.db.courseReview.findUnique({where:{userId_courseId:{userId,courseId}}})};}
  async submit(courseId:string,userId:string,dto:CourseReviewDto){return this.db.$transaction(async tx=>{
    const users=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`;if(!users.length)throw new NotFoundException('账号不可用');
    const context=await this.learning.context(courseId,userId,tx);if(context.access==='TRIAL'||!context.releaseId)throw new BadRequestException('获得课程权限并开始研习后可评价');
    const learned=await tx.studyProgress.count({where:{userId,lesson:{releaseId:context.releaseId},OR:[{positionSeconds:{gt:0}},{watchedSeconds:{gt:0}},{completedAt:{not:null}}]}});if(!learned)throw new BadRequestException('开始研习课程后可评价');
    const old=await tx.courseReview.findUnique({where:{userId_courseId:{userId,courseId}}}),body=dto.body.trim();
    if(old&&old.version!==dto.expectedVersion){if(old.reviewState==='PENDING'&&old.version===dto.expectedVersion+1&&old.rating===dto.rating&&old.body===body)return old;throw new ConflictException('评价已变化，请刷新后重试');}
    if(!old&&dto.expectedVersion!==0)throw new ConflictException('评价不存在，请刷新后重试');
    const row=old?await tx.courseReview.update({where:{id:old.id},data:{rating:dto.rating,body,releaseId:context.releaseId,reviewState:'PENDING',reviewerId:null,reviewedAt:null,deletedAt:null,version:{increment:1},updatedAt:new Date()}}):await tx.courseReview.create({data:{userId,courseId,releaseId:context.releaseId,rating:dto.rating,body}});
    await tx.auditLog.create({data:{actorId:userId,action:'course.review.submit',resource:'course_review',resourceId:row.id,changes:{courseId,rating:row.rating,version:row.version}}});return row;
  });}
  async withdraw(id:string,userId:string,dto:VersionDto){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const row=await tx.courseReview.findFirst({where:{id,userId}});if(!row)throw new NotFoundException('评价不存在');
    if(row.version!==dto.expectedVersion||row.deletedAt)throw new ConflictException('评价已变化，请刷新');
    await tx.courseReview.update({where:{id},data:{reviewState:'REMOVED',deletedAt:new Date(),version:{increment:1},updatedAt:new Date()}});
    await tx.auditLog.create({data:{actorId:userId,action:'course.review.withdraw',resource:'course_review',resourceId:id,changes:{state:'REMOVED'}}});return{success:true};
  });}
  async admin(query:ReviewPage){const where={...(query.state?{reviewState:query.state}:{}),...(query.courseId?{courseId:query.courseId}:{})};const [rows,total]=await this.db.$transaction([this.db.courseReview.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size}),this.db.courseReview.count({where})]);
    const [users,courses]=await Promise.all([this.db.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true}}),this.db.course.findMany({where:{id:{in:rows.map(r=>r.courseId)}},select:{id:true,title:true}})]);
    return{items:rows.map(r=>({...r,nickname:users.find(u=>u.id===r.userId)?.nickname??'已注销',courseTitle:courses.find(c=>c.id===r.courseId)?.title})),total};}
  async moderate(id:string,req:AuthRequest,dto:ModerateDto){return this.db.$transaction(async tx=>{
    const initial=await tx.courseReview.findUnique({where:{id}});if(!initial)throw new NotFoundException('评价不存在');
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CourseReview" WHERE id=${id} FOR UPDATE`;
    const row=await tx.courseReview.findUniqueOrThrow({where:{id}});
    const next=dto.action==='APPROVE'?'APPROVED':dto.action==='REJECT'?'REJECTED':dto.action==='RESTORE'?'PENDING':'REMOVED';
    if(row.version!==dto.expectedVersion||row.deletedAt||(['APPROVE','REJECT'].includes(dto.action)?row.reviewState!=='PENDING':dto.action==='RESTORE'?!['REJECTED','REMOVED'].includes(row.reviewState):row.reviewState!=='APPROVED'))throw new ConflictException('评价状态已变化，请刷新');
    const result=await tx.courseReview.update({where:{id},data:{reviewState:next,reviewerId:req.actor.id,reviewedAt:new Date(),version:{increment:1},updatedAt:new Date()}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'course.review.'+dto.action.toLowerCase(),resource:'course_review',resourceId:id,reason:dto.reason,changes:{from:row.reviewState,to:next}}});
    await tx.notification.create({data:{userId:row.userId,kind:'COURSE_REVIEW',resourceId:row.courseId,eventKey:'course.review:'+id+':'+result.version,title:'课程评价有新状态',body:next==='APPROVED'?'你的课程评价已通过审核。':next==='PENDING'?'你的课程评价已恢复到待审。':dto.reason}});return result;
  });}
}
@Controller() export class CourseReviewsController {
  constructor(private readonly reviews:CourseReviewsService){}
  @Get('catalog/courses/:id/reviews') @UseGuards(OptionalUserGuard) list(@Param('id',ParseUUIDPipe) id:string,@Query() q:ReviewPage,@Req() req:AuthRequest){return this.reviews.list(id,q,req.actor?.id);}
  @Get('me/courses/:id/review') @UseGuards(UserGuard) mine(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.reviews.mine(id,req.actor.id);}
  @Post('me/courses/:id/review') @UseGuards(UserGuard) submit(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:CourseReviewDto){return this.reviews.submit(id,req.actor.id,dto);}
  @Delete('me/course-reviews/:id') @UseGuards(UserGuard) withdraw(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:VersionDto){return this.reviews.withdraw(id,req.actor.id,dto);}
}
@Controller('admin/course-reviews') @UseGuards(AdminGuard) export class CourseReviewsAdminController {
  constructor(private readonly reviews:CourseReviewsService){}
  @Get() list(@Req() req:AuthRequest,@Query() q:ReviewPage){requireRoles(req,['MODERATOR']);return this.reviews.admin(q);}
  @Post(':id/moderate') moderate(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:ModerateDto){requireRoles(req,['MODERATOR']);return this.reviews.moderate(id,req,dto);}
}
