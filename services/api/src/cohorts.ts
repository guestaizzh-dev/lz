import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Database } from './database.js';
import { AdminGuard, OptionalUserGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { TableQuery } from './admin.js';
import { publicContentScope } from './public-content.js';
import { cohortLessonOpensAt } from './cohort-schedule.js';
import { Prisma } from './generated/prisma/client.js';

class CohortDto {
  @IsUUID() courseId!: string;
  @IsString() @Length(1,150) @Matches(/\S/) title!: string;
  @IsISO8601() startsAt!: string;
  @IsISO8601() endsAt!: string;
  @IsISO8601() enrollDeadline!: string;
  @IsInt() @Min(1) @Max(10000) capacity!: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) price=0;
}
class CohortLessonDayDto {
  @IsUUID() lessonId!:string;
  @IsInt() @Min(1) @Max(3660) opensOnDay!:number;
}
class CohortScheduleDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @ValidateNested({each:true}) @Type(()=>CohortLessonDayDto) lessons!:CohortLessonDayDto[];
  @IsString() @Length(1,500) @Matches(/\S/) reason!:string;
}
class CohortStateDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['OPEN','CLOSED']) state!: string;
  @IsString() @Length(1,500) @Matches(/\S/) reason!: string;
}
class CohortChangeDto {
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Length(1,500) @Matches(/\S/) reason!:string;
}
class CohortPostponeDto extends CohortChangeDto { @IsInt() @Min(1) @Max(3650) days!:number; }
class CohortAcceptDto { @IsInt() @Min(1) expectedScheduleVersion!:number; }
const scheduleSnapshot=(row:{startsAt:Date;endsAt:Date;enrollDeadline:Date;scheduleVersion:number})=>({startsAt:row.startsAt.toISOString(),endsAt:row.endsAt.toISOString(),enrollDeadline:row.enrollDeadline.toISOString(),scheduleVersion:row.scheduleVersion});
@Injectable()
export class CohortsService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  private readonly logger=new Logger(CohortsService.name);
  constructor(private readonly db: Database) {}
  onModuleInit(){if(process.env.NODE_ENV!=='test'){this.timer=setInterval(()=>void this.runNoticeJobs().catch(()=>this.logger.error('Cohort notice worker failed; durable jobs remain queued')),10000);this.timer.unref();}}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async change(req:AuthRequest,id:string,dto:CohortChangeDto|CohortPostponeDto,cancel=false,extend=false){
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${id} FOR UPDATE`;
      const row=await tx.courseCohort.findUnique({where:{id}}),now=new Date();
      if(!row||row.version!==dto.expectedVersion||!['DRAFT','OPEN','CLOSED'].includes(row.state))throw new ConflictException('营期已变化，请刷新后处理');
      const registrations=await tx.cohortRegistration.findMany({where:{cohortId:id},select:{id:true,source:true}});
      const assignmentIds=(await tx.assignment.findMany({where:{cohortId:id},select:{id:true}})).map(a=>a.id),taskIds=(await tx.practiceTask.findMany({where:{cohortId:id},select:{id:true}})).map(a=>a.id);
      if(row.endsAt<=now||extend&&row.startsAt>now||!cancel&&!extend&&(row.startsAt<=now||await tx.cohortStudyProgress.count({where:{registrationId:{in:registrations.map(r=>r.id)}}})||await tx.cohortCertificate.count({where:{registrationId:{in:registrations.map(r=>r.id)}}})||await tx.submission.count({where:{assignmentId:{in:assignmentIds}}})||await tx.practiceCheckin.count({where:{taskId:{in:taskIds}}})))throw new ConflictException('已结束的营期不能改期；未开营可整体顺延，已开营只能延长结营期限或取消，不重排已经公布的教学日期');
      const shift=cancel?0:(dto as CohortPostponeDto).days*86400000,version=row.scheduleVersion+1;
      const changed=await tx.courseCohort.update({where:{id},data:{startsAt:new Date(+row.startsAt+(extend?0:shift)),endsAt:new Date(+row.endsAt+shift),enrollDeadline:new Date(+row.enrollDeadline+(extend?0:shift)),scheduleVersion:version,changeReason:dto.reason.trim(),...(cancel?{state:'CANCELLED'}:{}),version:{increment:1}}});
      const after=scheduleSnapshot(changed);
      if(cancel){const released=await tx.cohortRegistration.updateMany({where:{cohortId:id,revokedAt:null,source:'COHORT_FREE'},data:{revokedAt:now,scheduleSnapshot:after,version:{increment:1}}});if(released.count)await tx.courseCohort.update({where:{id},data:{confirmed:{decrement:released.count}}});await tx.cohortRegistration.updateMany({where:{cohortId:id,revokedAt:null,source:'COHORT_PURCHASE'},data:{suspendedAt:now,version:{increment:1}}});await tx.forumSection.updateMany({where:{cohortId:id},data:{active:false,version:{increment:1}}});}
      await tx.cohortScheduleChange.create({data:{cohortId:id,scheduleVersion:version,action:cancel?'CANCEL':extend?'EXTEND':'POSTPONE',beforeSnapshot:scheduleSnapshot(row),afterSnapshot:after,reason:dto.reason.trim(),actorId:req.actor.id}});
      await tx.outboxJob.create({data:{kind:'COHORT_CHANGE_NOTICE',aggregateType:'cohort',aggregateId:id,eventKey:'cohort.change:'+id+':'+version,payload:{scheduleVersion:version,action:cancel?'CANCEL':extend?'EXTEND':'POSTPONE',reason:dto.reason.trim(),cutoff:now.toISOString()},availableAt:now}});
      await tx.outboxJob.create({data:{kind:'COHORT_SCHEDULE_COMPENSATION',aggregateType:'COHORT',aggregateId:id,eventKey:'cohort.compensation:'+id+':'+version,payload:{scheduleVersion:version,reason:dto.reason.trim(),cutoff:now.toISOString()},availableAt:now}});if(!cancel)await this.queueEndNotice(tx,changed);
      await tx.auditLog.create({data:{actorId:req.actor.id,action:cancel?'cohort.cancel.all':extend?'cohort.extend':'cohort.postpone',resource:'course',resourceId:row.courseId,changes:{cohortId:id,reason:dto.reason.trim(),before:scheduleSnapshot(row),after}}});
      return changed;
    });
  }
  async accept(req:AuthRequest,id:string,dto:CohortAcceptDto){return this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${id} FOR UPDATE`;
    const cohort=await tx.courseCohort.findUnique({where:{id}}),row=await tx.cohortRegistration.findUnique({where:{userId_cohortId:{userId:req.actor.id,cohortId:id}}});
    if(!row||row.revokedAt||row.suspendedAt)throw new NotFoundException('有效报名不存在或正在售后');
    if(!cohort||cohort.state==='CANCELLED'||cohort.scheduleVersion!==dto.expectedScheduleVersion||cohort.endsAt<=new Date()||cohort.startsAt<=new Date()&&(await tx.cohortScheduleChange.findUnique({where:{cohortId_scheduleVersion:{cohortId:id,scheduleVersion:cohort.scheduleVersion}}}))?.action!=='EXTEND')throw new ConflictException('营期安排已变化、已结束或错过确认，请重新核对');
    if(row.acceptedScheduleVersion===cohort.scheduleVersion)return {success:true};
    await tx.cohortRegistration.update({where:{id:row.id},data:{acceptedScheduleVersion:cohort.scheduleVersion,version:{increment:1}}});
    await tx.auditLog.create({data:{actorId:req.actor.id,action:'cohort.schedule.accept',resource:'course',resourceId:cohort.courseId,changes:{cohortId:id,scheduleVersion:cohort.scheduleVersion}}});return {success:true};
  });}
  async runNoticeJobs(){
    if(this.working)return;this.working=true;
    try{for(let i=0;i<10;i++){
      const jobs=await this.db.$queryRaw<{id:string;attempts:number}[]>`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1 WHERE id=(SELECT id FROM "OutboxJob" WHERE kind IN ('COHORT_CHANGE_NOTICE','COHORT_END_NOTICE') AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,attempts`;
      if(!jobs.length)break;const job=jobs[0]!;
      try{await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "OutboxJob" WHERE id=${job.id} FOR UPDATE`;
        const stored=await tx.outboxJob.findUniqueOrThrow({where:{id:job.id}}),p=stored.payload as {scheduleVersion:number;action:string;reason:string;cutoff:string;cursor?:string};
        if(stored.attempts!==job.attempts||stored.state!=='RUNNING')return;
        const ending=stored.kind==='COHORT_END_NOTICE';
        if(ending){const cohort=await tx.courseCohort.findUnique({where:{id:stored.aggregateId}});if(!cohort||cohort.scheduleVersion!==p.scheduleVersion||cohort.state==='CANCELLED'||cohort.endsAt>new Date()){await tx.outboxJob.update({where:{id:job.id},data:{state:'DONE',lockedUntil:null,completedAt:new Date()}});return;}}
        // Each change remains visible even if another postponement is issued before delivery.
        const rows=await tx.cohortRegistration.findMany({where:{cohortId:stored.aggregateId,createdAt:{lte:new Date(p.cutoff)},...(p.cursor?{id:{gt:p.cursor}}:{}),...(ending?{revokedAt:null}:p.action==='CANCEL'?{OR:[{scheduleSnapshot:{path:['scheduleVersion'],equals:p.scheduleVersion}},{source:'COHORT_PURCHASE',revokedAt:null}]}:{revokedAt:null,acceptedScheduleVersion:{lt:p.scheduleVersion}})},orderBy:{id:'asc'},take:51,select:{id:true,userId:true}}),batch=rows.slice(0,50);
        if(batch.length)await tx.notification.createMany({skipDuplicates:true,data:batch.map(r=>({userId:r.userId,kind:'COHORT',cohortId:stored.aggregateId,eventKey:(ending?'cohort.end:':'cohort.change:')+r.id+':'+p.scheduleVersion,title:ending?'本期训练营已结营':p.action==='CANCEL'?'训练营已取消':'训练营安排已延期',body:ending?'本期学习与讨论已结束，已提交作业、打卡与点评仍可回看；独立购课和其他营期不受影响。':p.reason+'；'+(p.action==='CANCEL'?'免费席位已释放；付费报名自动原路退款，渠道成功后才释放席位，原记录保留。':p.action==='EXTEND'?'结营期限延长，原章节和教学日期不重排；请确认新期限，或从原订单办理退出。':'请查看最新营期安排，确认新时间或从原订单全额退出。')}))});
        await tx.outboxJob.update({where:{id:job.id},data:{state:rows.length>50?'READY':'DONE',payload:{...p,...(batch.length?{cursor:batch.at(-1)!.id}:{}),failures:0},availableAt:new Date(),lockedUntil:null,completedAt:rows.length>50?null:new Date(),lastErrorCode:null}});
      });}catch{
        const p=(await this.db.outboxJob.findUniqueOrThrow({where:{id:job.id}})).payload as Prisma.InputJsonObject,failures=Number(p.failures??0)+1;
        await this.db.outboxJob.updateMany({where:{id:job.id,state:'RUNNING',attempts:job.attempts},data:{state:failures>=20?'DEAD':'READY',payload:{...p,failures},availableAt:new Date(Date.now()+Math.min(3600000,30000*2**Math.min(failures,7))),lockedUntil:null,lastErrorCode:'COHORT_NOTICE_ERROR'}});
      }
    }}finally{this.working=false;}
  }
  private queueEndNotice(tx:Prisma.TransactionClient,row:{id:string;endsAt:Date;scheduleVersion:number}){return tx.outboxJob.create({data:{kind:'COHORT_END_NOTICE',aggregateType:'cohort',aggregateId:row.id,eventKey:'cohort.end:'+row.id+':'+row.scheduleVersion,payload:{scheduleVersion:row.scheduleVersion,action:'END',reason:'营期结束',cutoff:row.endsAt.toISOString()},availableAt:row.endsAt}});}
  async list(admin = false, courseId?: string, userId?: string) {
    const rows=await this.db.courseCohort.findMany({where:{...(courseId?{courseId}:{}),...(admin?{}:{state:'OPEN',endsAt:{gt:new Date()}})},orderBy:[{startsAt:'asc'},{id:'asc'}],take:100});
    const courses=await this.db.course.findMany({where:{id:{in:rows.map(r=>r.courseId)},...(admin?{}:{...await publicContentScope(this.db),teacher:await publicContentScope(this.db)})},select:{id:true,title:true,cover:true,price:true}});
    const releases=await this.db.courseRelease.findMany({where:{id:{in:rows.map(r=>r.releaseId)}},select:{id:true,withdrawnAt:true}}),enrollments=userId?await this.db.cohortRegistration.findMany({where:{userId,cohortId:{in:rows.map(r=>r.id)}}}):[];
    const offers=await this.db.saleOffer.findMany({where:{kind:'COHORT',cohortId:{in:rows.map(r=>r.id)},active:true}});
    return rows.flatMap(({reserved,confirmed,...r})=>{const course=courses.find(c=>c.id===r.courseId);if(!course)return [];const enrolled=enrollments.find(e=>e.cohortId===r.id&&!e.revokedAt);const price=offers.find(o=>o.cohortId===r.id)?.price;return [{...r,course,price:price===undefined?null:String(price),paid:price!==undefined&&price>0n,available:r.capacity-reserved-confirmed,confirmed,bookingEnabled:price===0n&&!releases.find(re=>re.id===r.releaseId)?.withdrawnAt&&r.state==='OPEN'&&r.enrollDeadline>new Date(),enrolled:!!enrolled,sectionId:null}];});
  }
  async create(req: AuthRequest,dto: CohortDto) {
    requireRoles(req,['OPERATOR']);
    const startsAt=new Date(dto.startsAt),endsAt=new Date(dto.endsAt),enrollDeadline=new Date(dto.enrollDeadline);
    if(startsAt<=new Date()||endsAt<=startsAt||enrollDeadline<=new Date()||enrollDeadline>startsAt)throw new BadRequestException('请核查营期与报名截止时间');
    return this.db.$transaction(async tx=>{
      const course=await tx.course.findFirst({where:{id:dto.courseId,...await publicContentScope(tx),teacher:await publicContentScope(tx)}});
      if(!course?.publishedReleaseId)throw new BadRequestException('请选择有正式发布版本的课程');
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${course.publishedReleaseId} FOR SHARE`;
      const release=await tx.courseRelease.findUniqueOrThrow({where:{id:course.publishedReleaseId}});
      if(release.withdrawnAt)throw new BadRequestException('此课程版本已停止交付');
      if(!await tx.lesson.count({where:{releaseId:release.id}}))throw new BadRequestException('此版本尚无可安排的章节');
      if(await tx.lesson.count({where:{releaseId:release.id,format:'LIVE'}}))throw new BadRequestException('直播课程按固定场次独立交付，请通过课程与直播工作台安排，不重复建为训练营');
      const row=await tx.courseCohort.create({data:{courseId:course.id,releaseId:release.id,title:dto.title,startsAt,endsAt,enrollDeadline,capacity:dto.capacity,state:'DRAFT'}});
      await tx.saleOffer.create({data:{kind:'COHORT',cohortId:row.id,price:BigInt(dto.price??0),active:true,quantityLimit:1,policySnapshot:{}}});
      await this.queueEndNotice(tx,row);
      await tx.forumSection.create({data:{code:'cohort:'+row.id,title:row.title+' · 营内讨论',description:'本营期学员的研习交流。',scope:'COURSE',courseId:course.id,cohortId:row.id,active:true}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'cohort.create',resource:'course',resourceId:course.id,changes:{cohortId:row.id,releaseId:release.id}}});return row;
    });
  }
  async state(req: AuthRequest,id: string,dto: CohortStateDto) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${id} FOR UPDATE`;
      const row=await tx.courseCohort.findUnique({where:{id}});
      if(!row||row.version!==dto.expectedVersion||!['DRAFT','OPEN','CLOSED'].includes(row.state))throw new ConflictException('营期状态已变化');
      if(dto.state==='OPEN'){
        const course=await tx.course.findFirst({where:{id:row.courseId,...await publicContentScope(tx),teacher:await publicContentScope(tx)}}),release=await tx.courseRelease.findUniqueOrThrow({where:{id:row.releaseId}});
        const offer=await tx.saleOffer.findFirst({where:{kind:'COHORT',cohortId:id,active:true}});
        if(!course||!offer||release.withdrawnAt||row.enrollDeadline<=new Date())throw new BadRequestException('需有效课程版本、独立营期报价且报名未截止');
        const lessons=await tx.lesson.findMany({where:{releaseId:row.releaseId},orderBy:{position:'asc'},select:{id:true}}),schedule=await tx.cohortLessonSchedule.findMany({where:{cohortId:id}});
        if(!lessons.length||lessons.length!==schedule.length||lessons.some(l=>!schedule.find(s=>s.lessonId===l.id)||cohortLessonOpensAt(row.startsAt,schedule.find(s=>s.lessonId===l.id)!.opensOnDay)>=row.endsAt))throw new BadRequestException('请先完整配置营期内的章节安排');
      }
      const changed=await tx.courseCohort.update({where:{id},data:{state:dto.state,version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'cohort.state',resource:'course',resourceId:row.courseId,changes:{cohortId:id,state:dto.state,reason:dto.reason}}});return changed;
    });
  }
  async schedule(req:AuthRequest,id:string) {
    requireRoles(req,['OPERATOR','MODERATOR']);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${id} FOR SHARE`;
      const cohort=await tx.courseCohort.findUnique({where:{id}});if(!cohort)throw new NotFoundException('营期不存在');
      const [lessons,schedule]=await Promise.all([tx.lesson.findMany({where:{releaseId:cohort.releaseId},orderBy:{position:'asc'},select:{id:true,title:true,position:true,format:true}}),tx.cohortLessonSchedule.findMany({where:{cohortId:id}})]);
      return {cohort,editable:cohort.state==='DRAFT'&&!cohort.scheduleFrozenAt,lessons:lessons.map(l=>{const s=schedule.find(s=>s.lessonId===l.id);return {...l,opensOnDay:s?.opensOnDay??null,opensAt:s?cohortLessonOpensAt(cohort.startsAt,s.opensOnDay):null};})};
    });
  }
  async saveSchedule(req:AuthRequest,id:string,dto:CohortScheduleDto) {
    requireRoles(req,['OPERATOR']);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${id} FOR UPDATE`;
      const row=await tx.courseCohort.findUnique({where:{id}});
      if(!row||row.version!==dto.expectedVersion)throw new ConflictException('营期已变化，请重新读取章节安排');
      if(row.state!=='DRAFT'||row.scheduleFrozenAt)throw new ConflictException('章节安排已冻结，不能修改已公布的学习安排');
      const lessons=await tx.lesson.findMany({where:{releaseId:row.releaseId},orderBy:{position:'asc'},select:{id:true}});
      const byLesson=new Map(dto.lessons.map(l=>[l.lessonId,l.opensOnDay]));
      if(dto.lessons.length!==lessons.length||byLesson.size!==lessons.length||lessons.some(l=>!byLesson.has(l.id)))throw new BadRequestException('须且仅须安排本期固定版本的全部章节，不可重复或跨版本');
      let previous=1;
      for(const lesson of lessons){const day=byLesson.get(lesson.id)!;
        if(day<previous||cohortLessonOpensAt(row.startsAt,day)>=row.endsAt)throw new BadRequestException('开放日须按章节顺序递增或相同，且早于结营时间');
        previous=day;
      }
      const before=await tx.cohortLessonSchedule.findMany({where:{cohortId:id}});
      for(const lesson of dto.lessons)await tx.cohortLessonSchedule.update({where:{cohortId_lessonId:{cohortId:id,lessonId:lesson.lessonId}},data:{opensOnDay:lesson.opensOnDay}});
      const changed=await tx.courseCohort.update({where:{id},data:{version:{increment:1}}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'cohort.schedule',resource:'course',resourceId:row.courseId,changes:{cohortId:id,reason:dto.reason,before:before.map(l=>({lessonId:l.lessonId,opensOnDay:l.opensOnDay})),after:dto.lessons.map(l=>({lessonId:l.lessonId,opensOnDay:l.opensOnDay})),version:changed.version}}});
      return {version:changed.version};
    });
  }
  async detail(id: string,userId?: string) {
    const row=await this.db.courseCohort.findUnique({where:{id}});if(!row)throw new NotFoundException('营期不存在');
    const mine=userId?await this.db.cohortRegistration.findFirst({where:{userId,cohortId:id}}):null;
    const course=await this.db.course.findFirst({where:{id:row.courseId,...await publicContentScope(this.db),teacher:await publicContentScope(this.db)}});
    if(!course&&!mine||row.state==='DRAFT'&&!mine)throw new NotFoundException('营期尚未开放或课程已下架');
    const release=await this.db.courseRelease.findUniqueOrThrow({where:{id:row.releaseId}}),now=new Date();
    const offer=await this.db.saleOffer.findFirst({where:{kind:'COHORT',cohortId:id,active:true}}),price=offer?.price;
    const orderId=mine?.orderItemId?(await this.db.tradeOrderItem.findUniqueOrThrow({where:{id:mine.orderItemId}})).orderId:null;
    const latestChange=await this.db.cohortScheduleChange.findUnique({where:{cohortId_scheduleVersion:{cohortId:id,scheduleVersion:row.scheduleVersion}}});
    const schedulePending=!!mine&&!mine.revokedAt&&mine.acceptedScheduleVersion<row.scheduleVersion;
    const section=mine&&!mine.revokedAt&&!mine.suspendedAt&&!schedulePending&&row.endsAt>now?await this.db.forumSection.findFirst({where:{cohortId:id,active:true},select:{id:true}}):null;
    const [lessons,schedule]=await Promise.all([this.db.lesson.findMany({where:{releaseId:row.releaseId},orderBy:{position:'asc'},select:{id:true,title:true,position:true,format:true}}),this.db.cohortLessonSchedule.findMany({where:{cohortId:id}})]);
    const lessonSchedule=lessons.map(l=>{const s=schedule.find(s=>s.lessonId===l.id);return {...l,opensOnDay:s?.opensOnDay??null,opensAt:s?cohortLessonOpensAt(row.startsAt,s.opensOnDay):null};});
    return {...row,scheduleAction:latestChange?.action??null,price:price===undefined?null:String(price),paid:price!==undefined&&price>0n,orderId,suspended:!!mine?.suspendedAt,purchaseAvailable:!!course&&!!price&&price>0n&&!mine&&row.state==='OPEN'&&row.enrollDeadline>now&&!release.withdrawnAt,originalSchedule:mine?.originalScheduleSnapshot??null,registrationSchedule:mine?.scheduleSnapshot??null,schedulePending,canAcceptSchedule:schedulePending&&!mine?.suspendedAt&&row.endsAt>now&&(row.startsAt>now||(await this.db.cohortScheduleChange.findUnique({where:{cohortId_scheduleVersion:{cohortId:id,scheduleVersion:row.scheduleVersion}}}))?.action==='EXTEND')&&row.state!=='CANCELLED',lessonSchedule,available:row.capacity-row.reserved-row.confirmed,course:{id:row.courseId,title:release.title,description:release.descriptionSnapshot,cover:course?.cover??'',price:course?.price??null},enrolled:!!mine&&!mine.revokedAt,canCancel:!!mine&&!mine.orderItemId&&!mine.revokedAt&&(row.startsAt>now||schedulePending),canStudy:!!mine&&!mine.revokedAt&&!mine.suspendedAt&&!schedulePending&&row.state!=='CANCELLED'&&row.startsAt<=now&&row.endsAt>now&&!release.withdrawnAt,bookingEnabled:!!course&&price===0n&&row.state==='OPEN'&&row.enrollDeadline>now&&!release.withdrawnAt,sectionId:section?.id??null,registrationId:mine?.id??null,hasCertificate:!!mine&&!!await this.db.cohortCertificate.findUnique({where:{registrationId:mine.id},select:{id:true}})};
  }
  async join(req: AuthRequest,id: string) {
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${id} FOR UPDATE`;
      const cohort=await tx.courseCohort.findUnique({where:{id}});if(!cohort)throw new NotFoundException('营期不存在');
      const existing=await tx.cohortRegistration.findUnique({where:{userId_cohortId:{userId:req.actor.id,cohortId:id}}});
      if(existing?.cohortId===id&&!existing.revokedAt)return {id:existing.id,cohortId:id};
      const course=await tx.course.findFirst({where:{id:cohort.courseId,...await publicContentScope(tx),teacher:await publicContentScope(tx)}});
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${cohort.releaseId} FOR SHARE`;
      const release=await tx.courseRelease.findUniqueOrThrow({where:{id:cohort.releaseId}});
      const offer=await tx.saleOffer.findFirst({where:{kind:'COHORT',cohortId:id,active:true}});
      if(!course||offer?.price!==0n||release.withdrawnAt||cohort.state!=='OPEN'||cohort.enrollDeadline<=new Date())throw new BadRequestException('此训练营暂未开放免费报名或已截止；付费营期请从购买入口报名');
      if(cohort.confirmed+cohort.reserved>=cohort.capacity)throw new ConflictException('本期已满，请选择其他营期');
      const data={releaseId:cohort.releaseId,cohortId:id,source:'COHORT_FREE',revokedAt:null,acceptedScheduleVersion:cohort.scheduleVersion,scheduleSnapshot:Prisma.DbNull};
      const row=existing?await tx.cohortRegistration.update({where:{id:existing.id},data:{...data,version:{increment:1}}}):await tx.cohortRegistration.create({data:{...data,userId:req.actor.id,courseId:cohort.courseId}});
      await tx.courseCohort.update({where:{id},data:{confirmed:{increment:1},version:{increment:1}}});
      await tx.notification.create({data:{userId:req.actor.id,eventKey:'cohort:'+id+':joined:'+row.version,kind:'COHORT',cohortId:id,title:'训练营报名已确认',body:cohort.title+'，营期开始后开放学习；开营前可取消报名。',resourceId:cohort.courseId}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'cohort.join',resource:'course',resourceId:cohort.courseId,changes:{cohortId:id,enrollmentId:row.id,version:row.version}}});return {id:row.id,cohortId:id};
    });
  }
  async cancel(req: AuthRequest,id: string) {
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${id} FOR UPDATE`;
      const row=await tx.courseCohort.findUnique({where:{id}}),enrollment=await tx.cohortRegistration.findFirst({where:{cohortId:id,userId:req.actor.id}});
      if(!row||!enrollment)throw new NotFoundException('报名不存在');if(enrollment.revokedAt)return {success:true};
      if(enrollment.orderItemId)throw new ConflictException('付费营期请从原订单申请退出与退款，不能按免费报名释放席位');
      if(row.startsAt<=new Date()&&enrollment.acceptedScheduleVersion>=row.scheduleVersion)throw new ConflictException('已开营，请联系书院处理退出');
      await tx.cohortRegistration.update({where:{id:enrollment.id},data:{revokedAt:new Date(),scheduleSnapshot:scheduleSnapshot(row),version:{increment:1}}});await tx.courseCohort.update({where:{id},data:{confirmed:{decrement:1},version:{increment:1}}});
      await tx.notification.create({data:{userId:req.actor.id,eventKey:'cohort:'+id+':cancelled:'+(enrollment.version+1),kind:'COHORT',cohortId:id,title:'训练营报名已取消',body:row.title+'，名额已释放。',resourceId:row.courseId}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'cohort.cancel',resource:'course',resourceId:row.courseId,changes:{cohortId:id,enrollmentId:enrollment.id}}});return {success:true};
    });
  }
  async roster(req: AuthRequest,id: string,q: TableQuery) {
    requireRoles(req,['OPERATOR','MODERATOR']);const where={cohortId:id,revokedAt:null};
    const cohort=await this.db.courseCohort.findUniqueOrThrow({where:{id}});
    const [rows,total]=await this.db.$transaction([this.db.cohortRegistration.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size,skip:(q.page-1)*q.size}),this.db.cohortRegistration.count({where})]);
    const [users,progress,lessonCount]=await Promise.all([
      this.db.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,nickname:true}}),
      this.db.cohortStudyProgress.groupBy({by:['registrationId'],where:{registrationId:{in:rows.map(r=>r.id)},completedAt:{not:null}},_count:true}),
      this.db.lesson.count({where:{releaseId:cohort.releaseId}}),
    ]);
    const [assignments,tasks]=await Promise.all([this.db.assignment.findMany({where:{cohortId:id,state:{in:['PUBLISHED','CLOSED']}},select:{id:true}}),this.db.practiceTask.findMany({where:{cohortId:id},select:{id:true,requiredDays:true}})]);
    const [submissions,checkins]=await Promise.all([this.db.submission.findMany({where:{assignmentId:{in:assignments.map(a=>a.id)},userId:{in:rows.map(r=>r.userId)}},select:{assignmentId:true,userId:true,state:true},orderBy:{revision:'desc'}}),this.db.practiceCheckin.groupBy({by:['taskId','userId'],where:{taskId:{in:tasks.map(t=>t.id)},userId:{in:rows.map(r=>r.userId)},state:'VALID'},_count:true})]);
    const latest=new Map<string,string>();for(const s of submissions){const key=s.userId+':'+s.assignmentId;if(!latest.has(key))latest.set(key,s.state);}
    return {items:rows.map(r=>({id:r.id,source:r.source,suspended:!!r.suspendedAt,nickname:users.find(u=>u.id===r.userId)?.nickname??'已注销',startsAt:cohort.startsAt,expiresAt:cohort.endsAt,schedulePending:r.acceptedScheduleVersion<cohort.scheduleVersion,completedLessons:progress.find(p=>p.registrationId===r.id)?._count??0,lessonCount,assignmentCount:assignments.length,reviewedAssignments:assignments.filter(a=>latest.get(r.userId+':'+a.id)==='REVIEWED').length,practiceTaskCount:tasks.length,completedPracticeTasks:tasks.filter(t=>checkins.some(c=>c.userId===r.userId&&c.taskId===t.id&&c._count>=t.requiredDays)).length})),total};
  }
}
@Controller('cohorts') @UseGuards(OptionalUserGuard)
export class CohortsCatalogController {
  constructor(private readonly service: CohortsService) {}
  @Get('courses/:id') list(@Param('id',ParseUUIDPipe) id: string,@Req() req: AuthRequest) {return this.service.list(false,id,req.actor?.id);}
  @Get(':id') detail(@Param('id',ParseUUIDPipe) id: string,@Req() req: AuthRequest) {return this.service.detail(id,req.actor?.id);}
}
@Controller('me/cohorts') @UseGuards(UserGuard)
export class CohortsController {
  constructor(private readonly service: CohortsService,private readonly db: Database) {}
  @Get() async mine(@Req() req: AuthRequest,@Query() q: TableQuery) {const rows=await this.db.cohortRegistration.findMany({where:{userId:req.actor.id},select:{cohortId:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.size+1,skip:(q.page-1)*q.size});return {items:await Promise.all(rows.slice(0,q.size).map(r=>this.service.detail(r.cohortId!,req.actor.id))),hasMore:rows.length>q.size};}
  @Post(':id/join') join(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string) {return this.service.join(req,id);}
  @Post(':id/cancel') cancel(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string) {return this.service.cancel(req,id);}
  @Post(':id/accept-schedule') accept(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:CohortAcceptDto){return this.service.accept(req,id,dto);}
}
@Controller('admin/cohorts') @UseGuards(AdminGuard)
export class CohortsAdminController {
  constructor(private readonly service: CohortsService) {}
  @Get() list(@Req() req: AuthRequest) {requireRoles(req,['OPERATOR','MODERATOR']);return this.service.list(true);}
  @Post() create(@Req() req: AuthRequest,@Body() dto: CohortDto) {return this.service.create(req,dto);}
  @Post(':id/state') state(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Body() dto: CohortStateDto) {return this.service.state(req,id,dto);}
  @Get(':id/roster') roster(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string,@Query() q: TableQuery) {return this.service.roster(req,id,q);}
  @Get(':id/schedule') schedule(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id:string) {return this.service.schedule(req,id);}
  @Post(':id/schedule') saveSchedule(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:CohortScheduleDto) {return this.service.saveSchedule(req,id,dto);}
  @Post(':id/extend') extend(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:CohortPostponeDto){return this.service.change(req,id,dto,false,true);}
  @Post(':id/postpone') postpone(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:CohortPostponeDto){return this.service.change(req,id,dto);}
  @Post(':id/cancel') cancel(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:CohortChangeDto){return this.service.change(req,id,dto,true);}
}
