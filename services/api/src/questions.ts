import {MembershipBenefitsService} from './membership-benefits.js';
import { publicContentScope } from './public-content.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import {createHash,randomUUID} from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';

class QuestionPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
  @IsOptional() @IsUUID() teacherId?:string;
}
class QuestionCloseDto {@IsInt() @Min(1) expectedVersion!:number;}
class QuestionDeclineDto extends QuestionCloseDto {@IsString() @Length(2,500) @Matches(/\S/) reason!:string;}
class QuestionDto {
  @IsOptional() @IsBoolean() useMemberQuota?:boolean;
  @IsUUID() requestKey!:string;
  @IsString() @Length(1,5000) @Matches(/\S/) body!:string;
  @IsIn(['PRIVATE','PUBLIC']) visibility!:string;
}
class AnswerDto {
  @IsString() @Length(1,10000) @Matches(/\S/) body!:string;
  @IsInt() @Min(1) expectedVersion!:number;
}
class AnswerReviewDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsIn(['APPROVED','REJECTED']) state!:string;
  @IsBoolean() featured!:boolean;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}

@Injectable()
export class QuestionsService {
  constructor(private readonly db:Database,private readonly benefits:MembershipBenefitsService){}
  private async teacher(id:string,store:Prisma.TransactionClient=this.db){
    const row=await store.teacher.findFirst({where:{id,...await publicContentScope(store)}});
    if(!row)throw new NotFoundException('名师已下架或不存在');return row;
  }
  private async attach(rows:Awaited<ReturnType<Database['teacherQuestion']['findMany']>>,privateView=false){
    const answers=await this.db.teacherAnswer.findMany({where:{questionId:{in:rows.map(r=>r.id)},reviewState:'APPROVED'},orderBy:{createdAt:'desc'}});
    const teachers=await this.db.teacher.findMany({where:{id:{in:[...new Set(rows.map(r=>r.teacherId))]}},select:{id:true,name:true}});
    const usage=await this.db.benefitUsage.findMany({where:{id:{in:rows.flatMap(r=>r.benefitUsageId?[r.benefitUsageId]:[])}}}),resolutions=privateView?await this.db.auditLog.findMany({where:{resource:'teacher_question',resourceId:{in:rows.map(r=>r.id)},action:{in:['question.cancel','question.decline']}},orderBy:{createdAt:'desc'}}):[];
    const latest=new Map<string,typeof answers[number]>();
    for(const answer of answers)if(!latest.has(answer.questionId))latest.set(answer.questionId,answer);
    return rows.map(row=>{const a=latest.get(row.id);return{id:row.id,teacherName:teachers.find(t=>t.id===row.teacherId)?.name??'书院名师',memberQuestion:!!row.benefitUsageId,priority:(usage.find(u=>u.id===row.benefitUsageId)?.parametersSnapshot as {parameters?:{priority?:boolean}}|undefined)?.parameters?.priority===true,resolutionNote:resolutions.find(r=>r.resourceId===row.id)?.reason??null,teacherId:row.teacherId,body:row.body,visibility:row.visibility,state:row.state,createdAt:row.createdAt,version:row.version,answer:a?{id:a.id,body:a.body,reviewState:a.reviewState,featured:a.featured,createdAt:a.createdAt}:null};});
  }
  async publicList(teacherId:string,page:QuestionPage){
    await this.teacher(teacherId);
    const approved=await this.db.$queryRaw<{questionId:string}[]>`SELECT DISTINCT a."questionId" FROM "TeacherAnswer" a JOIN "TeacherQuestion" q ON q.id=a."questionId" WHERE q."teacherId"=${teacherId} AND q.visibility='PUBLIC' AND q.state='ANSWERED' AND a."reviewState"='APPROVED'`;
    const where={teacherId,visibility:'PUBLIC',state:'ANSWERED',id:{in:approved.map(r=>r.questionId)}};
    const [rows,total]=await this.db.$transaction([this.db.teacherQuestion.findMany({where,orderBy:[{answeredAt:'desc'},{id:'desc'}],skip:(page.page-1)*page.size,take:page.size}),this.db.teacherQuestion.count({where})]);
    return{items:await this.attach(rows),total};
  }
  async mine(userId:string,page:QuestionPage){
    const where={userId,...(page.teacherId?{teacherId:page.teacherId}:{})};
    const [rows,total]=await this.db.$transaction([this.db.teacherQuestion.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page.page-1)*page.size,take:page.size}),this.db.teacherQuestion.count({where})]);
    return{items:await this.attach(rows,true),total};
  }
  async ask(teacherId:string,userId:string,dto:QuestionDto){
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const operation='question.ask:'+teacherId,payloadHash=createHash('sha256').update(JSON.stringify({body:dto.body.trim(),visibility:dto.visibility,...(dto.useMemberQuota?{useMemberQuota:true}:{})})).digest('hex');
      const cache=await tx.idempotencyRecord.findFirst({where:{userId,operation,requestKey:dto.requestKey}});
      if(cache){if(cache.payloadHash!==payloadHash)throw new ConflictException('提交编号已用于其他问题');return cache.response;}
      const teacher=await this.teacher(teacherId,tx);
      const staff=teacher.userId?await tx.user.findFirst({where:{id:teacher.userId,status:'ACTIVE',roles:{has:'TEACHER'}}}):null;
      if(!staff)throw new BadRequestException('老师尚未开放问答服务');
      const now=new Date();if(await tx.userRestriction.findFirst({where:{userId,scope:{in:['ALL','POST','COMMENT']},revokedAt:null,startsAt:{lte:now},OR:[{endsAt:null},{endsAt:{gt:now}}]}}))throw new ForbiddenException('当前账号暂不能提问');
      if(await tx.teacherQuestion.count({where:{userId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=10)throw new BadRequestException('每天最多提交10个问题，请等待老师答复');
      const id=randomUUID(),usage=dto.useMemberQuota?await this.benefits.hold(tx,userId,'TEACHER_QUESTION','question.ask:'+id,1,{resourceId:teacherId}):null;
      const question=await tx.teacherQuestion.create({data:{id,teacherId,userId,body:dto.body.trim(),visibility:dto.visibility,state:'OPEN',benefitUsageId:usage?.id??null}});
      await tx.auditLog.create({data:{actorId:userId,action:'question.ask',resource:'teacher_question',resourceId:id,changes:{teacherId,visibility:dto.visibility,memberQuestion:!!usage,benefitUsageId:usage?.id??null}}});
      await tx.idempotencyRecord.create({data:{userId,operation,requestKey:dto.requestKey,payloadHash,state:'DONE',responseCode:201,response:JSON.parse(JSON.stringify(question)),expiresAt:new Date(Date.now()+30*86400000)}});
      return question;
    });
  }
  async inbox(req:AuthRequest,page:QuestionPage){
    const admin=req.actor.roles.includes('ADMIN');if(!admin&&!req.actor.roles.includes('TEACHER')&&!req.actor.roles.includes('MODERATOR'))throw new ForbiddenException('无问答管理权限');
    const teachers=admin||req.actor.roles.includes('MODERATOR')?null:await this.db.teacher.findMany({where:{userId:req.actor.id},select:{id:true}});
    const where={...(teachers?{teacherId:{in:teachers.map(r=>r.id)}}:page.teacherId?{teacherId:page.teacherId}:{}),...(!admin&&req.actor.roles.includes('MODERATOR')&&!teachers?{visibility:'PUBLIC'}:{})};
    const predicate=Prisma.sql`${teachers?Prisma.sql`q."teacherId"=ANY(${teachers.map(t=>t.id)}::text[])`:page.teacherId?Prisma.sql`q."teacherId"=${page.teacherId}`:Prisma.sql`true`} AND ${!admin&&req.actor.roles.includes('MODERATOR')&&!teachers?Prisma.sql`q.visibility='PUBLIC'`:Prisma.sql`true`}`;
    const [ids,total]=await this.db.$transaction([this.db.$queryRaw<{id:string}[]>(Prisma.sql`SELECT q.id FROM "TeacherQuestion" q LEFT JOIN "BenefitUsage" u ON u.id=q."benefitUsageId" WHERE ${predicate} ORDER BY (q.state='OPEN') DESC,coalesce(u."parametersSnapshot"->'parameters' @> '{"priority":true}'::jsonb,false) DESC,q."createdAt" ASC,q.id ASC LIMIT ${page.size} OFFSET ${(page.page-1)*page.size}`),this.db.teacherQuestion.count({where})]);
    const items=await this.db.teacherQuestion.findMany({where:{id:{in:ids.map(r=>r.id)}}}),answers=await this.db.teacherAnswer.findMany({where:{questionId:{in:items.map(r=>r.id)}},orderBy:{createdAt:'desc'}}),views=await this.attach(items,true);
    return{items:ids.map(({id})=>({...items.find(r=>r.id===id)!,...views.find(r=>r.id===id)!,answers:answers.filter(a=>a.questionId===id)})),total};
  }
  async options(teacherId:string,userId:string){await this.teacher(teacherId);return this.benefits.available(userId,'TEACHER_QUESTION',{resourceId:teacherId});}
  async close(id:string,userId:string,expectedVersion:number,req?:AuthRequest,reason='学员在答复前取消提问'){
    return this.db.$transaction(async tx=>{
      const initial=await tx.teacherQuestion.findUnique({where:{id}});if(!initial||!req&&initial.userId!==userId)throw new NotFoundException('问题不存在');
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "TeacherQuestion" WHERE id=${id} FOR UPDATE`;
      const row=await tx.teacherQuestion.findUniqueOrThrow({where:{id}});
      if(req){const teacher=await tx.teacher.findUniqueOrThrow({where:{id:row.teacherId}});if(!req.actor.roles.includes('ADMIN')&&(!req.actor.roles.includes('TEACHER')||teacher.userId!==req.actor.id))throw new ForbiddenException('只能处理本人的名师问题');}
      const state=req?'REJECTED':'CLOSED';if(row.state===state)return row;
      if(row.version!==expectedVersion||row.state!=='OPEN')throw new ConflictException('问题已答复或状态已变化，请刷新');
      if(row.benefitUsageId)await this.benefits.finish(tx,row.userId,row.benefitUsageId,'RELEASED');
      const changed=await tx.teacherQuestion.update({where:{id},data:{state,updatedAt:new Date(),version:{increment:1}}});await tx.auditLog.create({data:{actorId:req?.actor.id??userId,action:req?'question.decline':'question.cancel',resource:'teacher_question',resourceId:id,reason,changes:{state,benefitUsageId:row.benefitUsageId}}});
      if(req)await tx.notification.create({data:{userId:row.userId,eventKey:'question.decline:'+id,kind:'TEACHER_ANSWER',resourceId:row.teacherId,title:'老师暂时无法答复此问题',body:row.benefitUsageId?'请到我的提问查看说明；预占的会员问答次数已释放。':'请到我的提问查看老师的说明。'}});return changed;
    });
  }

  async answer(id:string,req:AuthRequest,dto:AnswerDto){
    return this.db.$transaction(async tx=>{
      const initial=await tx.teacherQuestion.findUnique({where:{id}});if(!initial)throw new NotFoundException('问题不存在');
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "TeacherQuestion" WHERE id=${id} FOR UPDATE`;
      const question=await tx.teacherQuestion.findUnique({where:{id}});if(!question)throw new NotFoundException('问题不存在');
      await tx.$queryRaw`SELECT id FROM "Teacher" WHERE id=${question.teacherId} FOR SHARE`;
      const teacher=await tx.teacher.findUniqueOrThrow({where:{id:question.teacherId}});
      if(!req.actor.roles.includes('ADMIN')&&(!req.actor.roles.includes('TEACHER')||teacher.userId!==req.actor.id))throw new ForbiddenException('只能答复自己的研习问题');
      if(question.version!==dto.expectedVersion||question.state!=='OPEN')throw new ConflictException('问题已处理，请刷新');
      const answer=await tx.teacherAnswer.create({data:{questionId:id,authorId:req.actor.id,body:dto.body.trim(),reviewState:question.visibility==='PUBLIC'?'PENDING':'APPROVED'}});
      await tx.teacherQuestion.update({where:{id},data:{state:'ANSWERED',answeredAt:new Date(),updatedAt:new Date(),version:{increment:1}}});
      if(question.visibility==='PRIVATE'&&question.benefitUsageId)await this.benefits.finish(tx,question.userId,question.benefitUsageId,'CONSUMED');
      if(question.visibility==='PRIVATE')await tx.notification.create({data:{userId:question.userId,eventKey:'question.answer:'+answer.id,kind:'TEACHER_ANSWER',title:'老师已答复你的问题',body:'请到名师问答查看答复。',resourceId:question.teacherId}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'question.answer',resource:'teacher_question',resourceId:id,changes:{answerId:answer.id,visibility:question.visibility}}});return answer;
    });
  }
  async review(id:string,req:AuthRequest,dto:AnswerReviewDto){
    requireRoles(req,['MODERATOR']);
    return this.db.$transaction(async tx=>{
      const answer=await tx.teacherAnswer.findUnique({where:{id}});if(!answer)throw new NotFoundException('答复不存在');
      const initial=await tx.teacherQuestion.findUniqueOrThrow({where:{id:answer.questionId}});await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "TeacherQuestion" WHERE id=${answer.questionId} FOR UPDATE`;
      const question=await tx.teacherQuestion.findUniqueOrThrow({where:{id:answer.questionId}});if(question.visibility!=='PUBLIC')throw new ForbiddenException('私人答复不进入公开审核');
      if((await tx.teacherAnswer.updateMany({where:{id,version:dto.expectedVersion,reviewState:'PENDING'},data:{reviewState:dto.state,featured:dto.state==='APPROVED'&&dto.featured,reviewerId:req.actor.id,updatedAt:new Date(),version:{increment:1}}})).count!==1)throw new ConflictException('答复已审核，请刷新');
      if(dto.state==='REJECTED')await tx.teacherQuestion.update({where:{id:question.id},data:{state:'OPEN',answeredAt:null,version:{increment:1},updatedAt:new Date()}});
      else {if(question.benefitUsageId)await this.benefits.finish(tx,question.userId,question.benefitUsageId,'CONSUMED');await tx.notification.create({data:{userId:question.userId,eventKey:'question.review:'+id,kind:'TEACHER_ANSWER',title:'老师的答复已发布',body:'请到名师问答查看答复。',resourceId:question.teacherId}});}
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'question.review',resource:'teacher_answer',resourceId:id,reason:dto.reason,changes:{state:dto.state,featured:dto.featured}}});return{success:true};
    });
  }
}

@Controller() export class QuestionsController {
  constructor(private readonly questions:QuestionsService){}
  @Get('teachers/:id/questions') @UseGuards(OptionalUserGuard) publicList(@Param('id',ParseUUIDPipe) id:string,@Query() page:QuestionPage){return this.questions.publicList(id,page);}
  @Get('teachers/:id/question-benefits') @UseGuards(UserGuard) options(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.questions.options(id,req.actor.id);}
  @Post('me/questions/:id/cancel') @UseGuards(UserGuard) cancel(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:QuestionCloseDto){return this.questions.close(id,req.actor.id,dto.expectedVersion);}
  @Post('teachers/:id/questions') @UseGuards(UserGuard) ask(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:QuestionDto){return this.questions.ask(id,req.actor.id,dto);}
  @Get('me/questions') @UseGuards(UserGuard) mine(@Req() req:AuthRequest,@Query() page:QuestionPage){return this.questions.mine(req.actor.id,page);}
}
@Controller('admin/questions') @UseGuards(AdminGuard) export class QuestionsAdminController {
  constructor(private readonly questions:QuestionsService){}
  @Get() inbox(@Req() req:AuthRequest,@Query() page:QuestionPage){return this.questions.inbox(req,page);}
  @Post(':id/decline') decline(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:QuestionDeclineDto){return this.questions.close(id,req.actor.id,dto.expectedVersion,req,dto.reason.trim());}
  @Post(':id/answer') answer(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:AnswerDto){return this.questions.answer(id,req,dto);}
  @Post('answers/:id/review') review(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Body() dto:AnswerReviewDto){return this.questions.review(id,req,dto);}
}
