import {OfflineCourses} from './offline-courses.js';
import {dailyGrowthAllocated} from './consumption-policy.js';
import {courseReleaseWindow} from './course-member-benefits.js';
import {memberPriceSources} from './member-pricing.js';
import { subtitleCues } from './subtitles.js';
import { demoContentVisible } from './public-content.js';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, IsISO8601, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { createHash } from 'node:crypto';
import { Database } from './database.js';
import { membershipPlanView } from './membership-terms.js';
import { membershipContentTier,membershipRefundHolds } from './membership-benefits.js';
import { OptionalUserGuard, UserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';
import { Prisma } from './generated/prisma/client.js';
import { cohortLessonLockedReason, cohortLessonOpensAt } from './cohort-schedule.js';

export class ProgressDto {
  @IsUUID() eventId!: string;
  @IsInt() @Min(0) @Max(86400) positionSeconds!: number;
  @IsInt() @Min(0) @Max(30) elapsedSeconds!: number;
  @IsBoolean() completed!: boolean;
  @IsOptional() @IsISO8601({strict:true}) recordedAt?:string;
  @IsOptional() @IsUUID() releaseId?:string;
}
export class LearningContextQuery {
  @IsOptional() @IsUUID() cohortId?: string;
  @IsOptional() @IsUUID() offlineRegistrationId?:string;
}
class LibraryQuery {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
  @IsOptional() @IsIn(['ALL','STUDYING','COMPLETED','EXPIRED']) filter = 'ALL';
}
type LibraryRow = { id: string; releaseId: string | null; access: string; started: boolean; finished: boolean; lastAt: Date | null;blocked:boolean };
type AccessStore = Database|Prisma.TransactionClient;
@Injectable()
export class LearningService {
  constructor(private readonly db: Database) {}
  async requireLessonOpen(context:Awaited<ReturnType<LearningService['context']>>,lessonId:string,store:AccessStore=this.db) {
    if(!context.cohort)return;
    const schedule=await store.cohortLessonSchedule.findUnique({where:{cohortId_lessonId:{cohortId:context.cohort.id,lessonId}}});
    if(!schedule||schedule.releaseId!==context.releaseId)throw new ForbiddenException('本章尚未安排，请联系书院');
    const opensAt=cohortLessonOpensAt(context.cohort.startsAt,schedule.opensOnDay);
    if(opensAt>new Date())throw new ForbiddenException(cohortLessonLockedReason(opensAt));
  }
  private async recordCompletion(userId:string,context:Awaited<ReturnType<LearningService['context']>>,tx:Prisma.TransactionClient){
    if(context.access==='TRIAL'||!context.releaseId)return null;
    const lessons=await tx.lesson.findMany({where:{releaseId:context.releaseId},select:{id:true,required:true}}),required=lessons.filter(l=>l.required),basis=required.length?required:lessons;
    const progress=context.registration?await tx.cohortStudyProgress.findMany({where:{registrationId:context.registration.id,lessonId:{in:basis.map(l=>l.id)}}}):await tx.studyProgress.findMany({where:{userId,lessonId:{in:basis.map(l=>l.id)}}});
    if(!basis.length||basis.some(l=>!progress.find(p=>p.lessonId===l.id)?.completedAt))return null;
    if(context.cohort){
      const schedule=await tx.cohortLessonSchedule.findMany({where:{cohortId:context.cohort.id,lessonId:{in:basis.map(l=>l.id)}}});
      if(basis.some(l=>{const s=schedule.find(s=>s.lessonId===l.id);return !s||cohortLessonOpensAt(context.cohort!.startsAt,s.opensOnDay)>new Date();}))return null;
    }
    const release=await tx.courseRelease.findUniqueOrThrow({where:{id:context.releaseId}});
    const completedAt=new Date(Math.max(...basis.map(l=>progress.find(p=>p.lessonId===l.id)!.completedAt!.valueOf())));
    if(context.registration&&context.cohort)return tx.cohortCertificate.upsert({where:{registrationId:context.registration.id},create:{registrationId:context.registration.id,userId,courseId:context.course.id,releaseId:release.id,cohortTitle:context.cohort.title,courseTitle:release.title,lessonCount:basis.length,completedAt},update:{}});
    return tx.courseCertificate.upsert({where:{userId_releaseId:{userId,releaseId:release.id}},create:{userId,courseId:context.course.id,releaseId:release.id,courseTitle:release.title,lessonCount:basis.length,completedAt},update:{}});
  }
  async certificate(courseId:string,userId:string,cohortId?:string){return this.db.$transaction(async tx=>{
    const users=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`;
    if(!users.length)throw new ForbiddenException('请重新登录');
    const registration=cohortId?await tx.cohortRegistration.findUnique({where:{userId_cohortId:{userId,cohortId}}}):null;
    if(cohortId&&(!registration||registration.courseId!==courseId))throw new ForbiddenException('仅本期学员可查看研习完成记录');
    const existing=registration?await tx.cohortCertificate.findUnique({where:{registrationId:registration.id}}):null;
    if(registration?.revokedAt&&!existing)throw new ForbiddenException('本期已退出，未生成的完成记录不能补发');const context=existing?null:await this.context(courseId,userId,tx,cohortId);
    if(context?.access==='TRIAL')throw new ForbiddenException('加入课程后可查看研习完成记录');
    const row=existing??(context?await this.recordCompletion(userId,context,tx):null);
    if(!row)throw new BadRequestException('完成本版本全部必修章节后可查看研习完成记录');
    const {nickname}=await tx.user.findUniqueOrThrow({where:{id:userId},select:{nickname:true}});
    return{id:row.id,courseTitle:row.courseTitle,lessonCount:row.lessonCount,completedAt:row.completedAt,releaseId:row.releaseId,nickname,...('cohortTitle' in row?{cohortTitle:row.cohortTitle,cohortId}:{})};
  });}
  async summary(userId:string){
    const scope=!await demoContentVisible(this.db)?Prisma.sql`AND NOT c."isDemo" AND NOT t."isDemo"`:Prisma.empty;
    const [time,completed]=await this.db.$transaction([
      this.db.$queryRaw<{seconds:bigint;lessons:number}[]>`SELECT coalesce(sum(p."watchedSeconds"),0)::bigint AS seconds,count(*) FILTER(WHERE p."completedAt" IS NOT NULL)::int AS lessons FROM (SELECT "userId","lessonId","watchedSeconds","completedAt" FROM "StudyProgress" UNION ALL SELECT "userId","lessonId","watchedSeconds","completedAt" FROM "CohortStudyProgress") p JOIN "Lesson" l ON l.id=p."lessonId" JOIN "CourseRelease" r ON r.id=l."releaseId" JOIN "Course" c ON c.id=r."courseId" JOIN "Teacher" t ON t.id=c."teacherId" WHERE p."userId"=${userId} ${scope}`,
      this.db.$queryRaw<{courses:number}[]>`SELECT count(DISTINCT done."courseId")::int AS courses FROM (SELECT r."courseId",l."releaseId" FROM "Lesson" l JOIN "CourseRelease" r ON r.id=l."releaseId" JOIN "Course" c ON c.id=r."courseId" JOIN "Teacher" t ON t.id=c."teacherId" LEFT JOIN "StudyProgress" p ON p."lessonId"=l.id AND p."userId"=${userId} WHERE true ${scope} GROUP BY r."courseId",l."releaseId" HAVING CASE WHEN count(*) FILTER(WHERE l.required)>0 THEN bool_and(p."completedAt" IS NOT NULL) FILTER(WHERE l.required) ELSE bool_and(p."completedAt" IS NOT NULL) END UNION ALL SELECT cc."courseId",cc."releaseId" FROM "CohortCertificate" cc JOIN "Course" c ON c.id=cc."courseId" JOIN "Teacher" t ON t.id=c."teacherId" WHERE cc."userId"=${userId} ${scope}) done`,
    ]);
    return{watchedSeconds:String(time[0]?.seconds??0n),completedLessons:time[0]?.lessons??0,completedCourses:completed[0]?.courses??0};
  }
  async plans() { return Promise.all((await this.db.membershipPlan.findMany({ where: { active: true }, orderBy: [{ tier: 'asc' }, { days: 'asc' }] })).map(async plan=>({...plan,contentTier:await membershipContentTier(plan.currentVersionId,this.db),purchaseReady:false,purchaseUnavailableReason:'会员真实支付与对应渠道产品尚未验收，暂不收取费用。',termLabel:plan.days===30?'月卡':plan.days===90?'季卡':'年卡',channelProducts:{ready:false,reason:'会员须接独立购买续费流程；iOS套餐须对应订阅产品，不能复用课程非消耗型映射。'}}))); }
  async membership(userId?: string, store: AccessStore = this.db) {
    if (!userId) return null;
    const now = new Date();
    const member=await store.membership.findFirst({ where: { userId, revokedAt: null, id:{notIn:await membershipRefundHolds(userId,store)}, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { tier: 'desc' }, include: { plan: true } });
    if(!member)return null;
    const version=member.planVersionId?await store.membershipPlanVersion.findUnique({where:{id:member.planVersionId}}):null;
    return{...member,contentTier:await membershipContentTier(member.planVersionId,store),plan:membershipPlanView(member.plan,version)};
  }
  async context(courseId: string, userId?: string, store: AccessStore = this.db, cohortId?: string,allowCohortHistory=false) {
    const course = await store.course.findUnique({ where: { id: courseId }, include: { teacher: true } });
    if (!course || (!await demoContentVisible(store) && (course.isDemo || course.teacher.isDemo))) throw new NotFoundException('课程不存在');
    const now = new Date();
    if(cohortId){
      if(!userId)throw new ForbiddenException('请登录并报名本期训练营');
      if(store!==this.db)await store.$queryRaw`SELECT id FROM "CourseCohort" WHERE id=${cohortId} FOR SHARE`;
      const cohort=await store.courseCohort.findUnique({where:{id:cohortId}}),registration=await store.cohortRegistration.findUnique({where:{userId_cohortId:{userId,cohortId}}});
      if(!cohort||cohort.courseId!==courseId||!registration||registration.revokedAt)throw new ForbiddenException('你没有本期训练营的学习权限');
      if(registration.suspendedAt)throw new ForbiddenException('本期退出或退款正在办理，暂不能继续学习与教学提交');
      if(cohort.state==='CANCELLED'||registration.acceptedScheduleVersion<cohort.scheduleVersion)throw new ForbiddenException('本期安排已变化，请先在训练营详情确认最新时间，或退出本期');
      if(!allowCohortHistory&&cohort.startsAt>now)throw new ForbiddenException('本期尚未开营，请按营期安排开始研习');
      if(!allowCohortHistory&&cohort.endsAt<=now)throw new ForbiddenException('本期已经结束，学习记录保留；可另选营期或使用独立购课权限');
      return {course,releaseId:registration.releaseId,access:'ENROLLED',enrollment:null,publicCourse:course.status==='PUBLISHED'&&course.teacher.status==='PUBLISHED',cohort,registration,releaseWindow:null};
    }
    const enrollment = userId ? await store.enrollment.findFirst({ where: { courseId, userId, startsAt: { lte: now }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }) : null;
    const publicCourse = course.status === 'PUBLISHED' && course.teacher.status === 'PUBLISHED';
    if (!publicCourse && !enrollment) throw new NotFoundException('课程不存在或已下架');
    const member = publicCourse && course.membershipTier ? await this.membership(userId, store) : null;
    const memberAccess = !!member && member.contentTier >= (course.membershipTier ?? 4);
    const releaseId=enrollment?.releaseId??course.publishedReleaseId,release=releaseId?await store.courseRelease.findUnique({where:{id:releaseId}}):null;
    const releaseWindow=release?await courseReleaseWindow(store,release,userId):null;
    const open=!releaseWindow||releaseWindow.phase==='PUBLIC'||releaseWindow.memberEarlyAccess;
    return { course, releaseId, access: open&&enrollment ? 'ENROLLED' : open&&memberAccess ? 'MEMBER' : 'TRIAL', enrollment, publicCourse,cohort:null,registration:null,releaseWindow };
  }
  async curriculum(id: string, userId?: string,cohortId?:string) {
    const context = await this.context(id, userId,this.db,cohortId);
    const release = context.releaseId ? await this.db.courseRelease.findFirst({ where: { id: context.releaseId, courseId: id }, include: { lessons: { orderBy: { position: 'asc' }, include: { progress: { where: { userId: userId ?? '' } } } } } }) : null;
    const cohortProgress=context.registration?await this.db.cohortStudyProgress.findMany({where:{registrationId:context.registration.id}}):[];
    const schedule=context.cohort?await this.db.cohortLessonSchedule.findMany({where:{cohortId:context.cohort.id}}):[],now=new Date();
    const liveSessions=await this.db.liveSession.findMany({where:{id:{in:release?.lessons.flatMap(l=>l.liveSessionId?[l.liveSessionId]:[])??[]}},select:{id:true,roomId:true,title:true,scheduledAt:true,state:true}});
    const availability=(lesson:{id:string;trial:boolean})=>{
      const s=schedule.find(s=>s.lessonId===lesson.id),opensAt=context.cohort&&s?cohortLessonOpensAt(context.cohort.startsAt,s.opensOnDay):null;
      const lockedReason=release?.withdrawnAt?'此课程版本已停止交付':context.cohort&&!s?'本章尚未安排，请联系书院':opensAt&&opensAt>now?cohortLessonLockedReason(opensAt):context.access==='TRIAL'&&!(context.publicCourse&&lesson.trial)?context.releaseWindow?.lockedReason??'请先获得课程权限，或选择试听章节':null;
      return {accessible:!lockedReason,opensAt,opensOnDay:s?.opensOnDay??null,lockedReason};
    };
    return { releaseWindow:context.releaseWindow,cohort:context.cohort?{id:context.cohort.id,title:context.cohort.title,endsAt:context.cohort.endsAt}:null,course: { id, title: release?.title ?? context.course.title, cover: context.course.cover, refundPolicy: (release?.refundPolicySnapshot as {text?:string}|undefined)?.text ?? context.course.refundPolicy, accessDays: release ? release.accessDays : context.course.accessDays }, access: context.access, releaseId: release?.id ?? null, deliveryBlocked:!!release?.withdrawnAt,deliveryReason:release?.withdrawalReason??null, lessons: release?.lessons.map(({ body: _, mediaId: __, sourceId: ___, subtitleText: ____, progress, ...lesson }) => ({ ...lesson,...(lesson.liveSessionId?{live:liveSessions.find(s=>s.id===lesson.liveSessionId)??null}:{}), ...availability(lesson), progress: context.registration?cohortProgress.find(p=>p.lessonId===lesson.id)??null:progress[0] ?? null })) ?? [] };
  }
  async lesson(id: string, userId?: string,cohortId?:string) {
    const lesson = await this.db.lesson.findUnique({ where: { id }, include: { release: true } });
    if (!lesson) throw new NotFoundException('章节不存在');
    if(lesson.release.withdrawnAt)throw new ForbiddenException('此版本停止交付，请在课程学习页选择替代版本或从订单申请退课');
    const context = await this.context(lesson.release.courseId, userId,this.db,cohortId);
    if (context.releaseId !== lesson.releaseId || (context.access === 'TRIAL' && (!context.publicCourse || !lesson.trial))) throw new ForbiddenException('请先获得课程权限，或选择试听章节');
    await this.requireLessonOpen(context,id);
    const progress = context.registration?await this.db.cohortStudyProgress.findUnique({where:{registrationId_lessonId:{registrationId:context.registration.id,lessonId:id}}}):userId ? await this.db.studyProgress.findUnique({ where: { userId_lessonId: { userId, lessonId: id } } }) : null;
    return { lesson, context, progress };
  }
  async enroll(id: string, userId: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} AND status = 'ACTIVE' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${id} FOR SHARE`;
      const { course, releaseId, publicCourse,releaseWindow } = await this.context(id, userId, tx);
      if(releaseWindow&&releaseWindow.phase!=='PUBLIC')throw new BadRequestException('新课提前期请使用已有会员权限研习，公开后可加入免费研习');
      if(course.format==='OFFLINE')throw new BadRequestException('线下课程须按真实场次报名，不能通过免费研习绕过席位');
      if (!publicCourse || course.price !== 0 || !releaseId) throw new BadRequestException('该课程需要购买或尚未发布章节');
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${releaseId} FOR SHARE`;
      if((await tx.courseRelease.findUniqueOrThrow({where:{id:releaseId}})).withdrawnAt)throw new BadRequestException('此版本已停止交付，请选择其他课程');
      const existing = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId: id } } });
      if (existing) {
        if (existing.revokedAt || (existing.expiresAt && existing.expiresAt <= new Date())) throw new ForbiddenException('课程权限已撤销或到期，请联系书院');
        return existing;
      }
      return tx.enrollment.create({ data: { userId, courseId: id, releaseId, source: 'FREE', expiresAt: course.accessDays ? new Date(Date.now() + course.accessDays * 86400000) : null } });
    });
  }
  async markPaidAccess(lessonId:string,userId?:string,cohortId?:string,store?:Prisma.TransactionClient){
    if(!userId)return;
    const mark=async(tx:Prisma.TransactionClient)=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const lesson=await tx.lesson.findUniqueOrThrow({where:{id:lessonId}}),release=await tx.courseRelease.findUniqueOrThrow({where:{id:lesson.releaseId}});
      if(release.withdrawnAt)throw new ForbiddenException('课程版本已停止交付，请查看课程补偿方案');
      const context=await this.context(release.courseId,userId,tx,cohortId);
      if(context.releaseId!==release.id||(context.access==='TRIAL'&&!lesson.trial))throw new ForbiddenException('课程权限已变化，请重新打开章节');
      await this.requireLessonOpen(context,lessonId,tx);
      if(lesson.trial||!context.enrollment?.orderItemId)return;
      const item=await tx.tradeOrderItem.findUniqueOrThrow({where:{id:context.enrollment.orderItemId}});
      const payment=await tx.paymentTransaction.findFirst({where:{orderId:item.orderId,disposition:'ACCEPTED'}});
      if(payment&&await tx.refund.findFirst({where:{orderId:item.orderId,paymentTransactionId:payment.id,state:{in:['APPROVED','REFUNDING','FAILED']}}}))throw new ForbiddenException('课程正在办理退款，完成后可在购课订单查看结果');
      const startedAt=new Date(),snapshot=item.benefitSnapshot as {startedAt?:string};
      if(!snapshot.startedAt)await tx.tradeOrderItem.update({where:{id:item.id},data:{benefitSnapshot:{...snapshot,startedAt:startedAt.toISOString()}}});
      await tx.enrollment.updateMany({where:{id:context.enrollment.id,startedAt:null},data:{startedAt}});
    };
    return store?mark(store):this.db.$transaction(mark);
  }
  async library(userId: string, query: LibraryQuery = new LibraryQuery()) {
    const member = await this.membership(userId), showDemo = await demoContentVisible(this.db), current = new Date();
    const earlySources=(await memberPriceSources(userId,this.db,['COURSE_EARLY_ACCESS'])).filter(s=>(s.parameters as {enabled?:boolean}).enabled===true),earlyAll=earlySources.some(s=>!s.scopes.length),earlyIds=earlySources.flatMap(s=>s.scopes.flatMap(x=>x.resourceId?[x.resourceId]:[])),earlyCategories=earlySources.flatMap(s=>s.scopes.flatMap(x=>x.categoryCode?[x.categoryCode]:[]));
    const pool = Prisma.sql`WITH eligible AS (
      SELECT c.id, c."createdAt", CASE WHEN x.valid THEN e."releaseId" WHEN x.member THEN c."publishedReleaseId" ELSE e."releaseId" END AS "releaseId",
        CASE WHEN x.valid THEN 'ENROLLED' WHEN x.member THEN 'MEMBER' WHEN e."revokedAt" IS NOT NULL THEN 'REVOKED' WHEN e."startsAt">${current} THEN 'UPCOMING' ELSE 'EXPIRED' END AS access
      FROM "Course" c JOIN "Teacher" t ON t.id=c."teacherId" LEFT JOIN "Enrollment" e ON e."courseId"=c.id AND e."userId"=${userId}
      CROSS JOIN LATERAL (SELECT (e.id IS NOT NULL AND e."revokedAt" IS NULL AND e."startsAt"<=${current} AND (e."expiresAt" IS NULL OR e."expiresAt">${current})) AS valid,
        (c.status='PUBLISHED' AND t.status='PUBLISHED' AND c."membershipTier" IS NOT NULL AND c."membershipTier"<=${member?.contentTier ?? 0}) AS member) x
      WHERE (e.id IS NOT NULL OR x.member) AND (${showDemo} OR (NOT c."isDemo" AND NOT t."isDemo"))
    ), library AS (
      SELECT e.*, (r."withdrawnAt" IS NOT NULL OR (coalesce((r."memberPolicySnapshot"->>'publicOpenAt')::timestamptz,${current})>${current} AND (coalesce((r."memberPolicySnapshot"->>'earlyAccessAt')::timestamptz,${current})>${current} OR NOT (${earlyAll} OR e.id=ANY(${earlyIds}::text[]) OR r."memberPolicySnapshot"->>'category'=ANY(${earlyCategories}::text[]))))) AS blocked, p.started, p.finished, p."lastAt" FROM eligible e LEFT JOIN "CourseRelease" r ON r.id=e."releaseId" CROSS JOIN LATERAL (
        SELECT coalesce(bool_or(s."watchedSeconds">0 OR s."positionSeconds">0 OR s."completedAt" IS NOT NULL),false) AS started,
          coalesce(CASE WHEN count(*) FILTER(WHERE l.required)>0 THEN bool_and(s."completedAt" IS NOT NULL) FILTER(WHERE l.required) ELSE bool_and(s."completedAt" IS NOT NULL) END,false) AS finished,
          max(s."updatedAt") AS "lastAt" FROM "Lesson" l LEFT JOIN "StudyProgress" s ON s."lessonId"=l.id AND s."userId"=${userId} WHERE l."releaseId"=e."releaseId"
      ) p
    )`;
    const filter = query.filter === 'STUDYING' ? Prisma.sql`started AND NOT finished AND NOT blocked AND access IN ('ENROLLED','MEMBER')` : query.filter === 'COMPLETED' ? Prisma.sql`finished` : query.filter === 'EXPIRED' ? Prisma.sql`access IN ('EXPIRED','REVOKED')` : Prisma.sql`true`;
    // UUID keyset is stable even if the previous record is removed or its progress changes.
    const [rows, totals, recent] = await this.db.$transaction([
      this.db.$queryRaw<LibraryRow[]>(Prisma.sql`${pool} SELECT * FROM library WHERE ${filter} AND (${query.cursor ?? null}::text IS NULL OR id>${query.cursor ?? null}) ORDER BY id LIMIT ${query.size + 1}`),
      this.db.$queryRaw<{ totalCourses: number; availableCourses: number; studyingCourses: number; finishedCourses: number; expiredCourses: number; filteredCourses: number }[]>(Prisma.sql`${pool} SELECT count(*)::int AS "totalCourses", count(*) FILTER(WHERE NOT blocked AND access IN ('ENROLLED','MEMBER'))::int AS "availableCourses", count(*) FILTER(WHERE started AND NOT finished AND NOT blocked AND access IN ('ENROLLED','MEMBER'))::int AS "studyingCourses", count(*) FILTER(WHERE finished)::int AS "finishedCourses", count(*) FILTER(WHERE access IN ('EXPIRED','REVOKED'))::int AS "expiredCourses", count(*) FILTER(WHERE ${filter})::int AS "filteredCourses" FROM library`),
      this.db.$queryRaw<LibraryRow[]>(Prisma.sql`${pool} SELECT * FROM library WHERE NOT blocked AND access IN ('ENROLLED','MEMBER') AND "lastAt" IS NOT NULL ORDER BY "lastAt" DESC,id LIMIT 1`),
    ], { isolationLevel: 'RepeatableRead' });
    const selected = rows.slice(0, query.size);
    const [courses, releases] = await Promise.all([
      this.db.course.findMany({ where: { id: { in: selected.map(row => row.id) } }, select: { id: true, title: true, cover: true, refundPolicy: true, accessDays: true } }),
      this.db.courseRelease.findMany({ where: { id: { in: selected.flatMap(row => row.releaseId ? [row.releaseId] : []) } }, include: { lessons: { orderBy: { position: 'asc' }, select: { id: true, title: true, position: true, format: true, durationSeconds: true, trial: true, required: true, progress: { where: { userId } } } } } }),
    ]);
    const items = selected.map(row => {
      const course = courses.find(item => item.id === row.id)!, release = releases.find(item => item.id === row.releaseId);
      const accessible = ['ENROLLED','MEMBER'].includes(row.access)&&!row.blocked;
      return { course: { id: row.id, title: release?.title ?? course.title, cover: course.cover, refundPolicy: (release?.refundPolicySnapshot as { text?: string } | undefined)?.text ?? course.refundPolicy, accessDays: release ? release.accessDays : course.accessDays }, access: row.access, releaseId: row.releaseId, releaseWindow:release?{...release.memberPolicySnapshot as object}:null,learningLocked:row.blocked&&!release?.withdrawnAt,deliveryBlocked:!!release?.withdrawnAt,deliveryReason:release?.withdrawalReason??null,lessons: release?.lessons.map(({ progress, ...lesson }) => ({ ...lesson, accessible, progress: progress[0] ?? null })) ?? [] };
    });
    return { items, nextCursor: rows.length > query.size ? rows[query.size - 1]!.id : null, stats: totals[0]!, recentCourseId: recent[0]?.id ?? null, membershipActive: !!member };
  }
  async progress(id: string, userId: string, dto: ProgressDto,cohortId?:string) {
    const { lesson } = await this.lesson(id, userId,cohortId);
    if(dto.releaseId&&dto.releaseId!==lesson.releaseId)throw new ConflictException('课程版本与学习记录不一致');
    const observed=dto.recordedAt?new Date(dto.recordedAt):null;
    if(observed&&(observed.getTime()>Date.now()+60000||observed.getTime()<Date.now()-30*86400000))throw new BadRequestException('学习记录时间超出补传范围，请校准设备时间');
    const payloadHash = createHash('sha256').update(JSON.stringify({ id, ...dto,...(cohortId?{cohortId}:{}) })).digest('hex');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${lesson.releaseId} FOR SHARE`;
      if((await tx.courseRelease.findUniqueOrThrow({where:{id:lesson.releaseId}})).withdrawnAt)throw new ForbiddenException('课程版本已停止交付，学习记录保留');
      const context = await this.context(lesson.release.courseId, userId, tx,cohortId);
      if (context.releaseId !== lesson.releaseId || (context.access === 'TRIAL' && (!context.publicCourse || !lesson.trial))) throw new ForbiddenException('课程权限已变化，请重新打开章节');
      await this.requireLessonOpen(context,id,tx);
      const event = await tx.studyEvent.findUnique({ where: { id: dto.eventId } });
      if (event) {
        if (event.userId !== userId || event.payloadHash !== payloadHash || event.cohortRegistrationId !== (context.registration?.id??null)||event.offlineRegistrationId!==null) throw new ConflictException('学习事件标识已用于其他操作');
        return event.result;
      }
      let requiredSeconds=lesson.durationSeconds;
      if(lesson.format==='LIVE'){
        const session=lesson.liveSessionId?await tx.liveSession.findUnique({where:{id:lesson.liveSessionId}}):null;
        if(!session)throw new ConflictException('本章尚未安排直播');
        if(session.state==='LIVE'){
          if(session.disconnectedAt||!await tx.liveRtcLease.findFirst({where:{sessionId:session.id,userId,role:'VIEWER',revokedAt:null,expiresAt:{gt:new Date()}}}))throw new ConflictException('请进入直播观看后记录研习');
        }else{
          const replay=await tx.liveReplay.findFirst({where:{sessionId:session.id,reviewState:'APPROVED',publishedAt:{not:null},reviewerId:{not:null}}});
          if(session.state!=='REPLAY_READY'||!replay?.durationSeconds)throw new ConflictException('本场尚未开播，或回放尚未审核发布');
          requiredSeconds=replay.durationSeconds;
        }
      }
      const old = context.registration?await tx.cohortStudyProgress.findUnique({where:{registrationId_lessonId:{registrationId:context.registration.id,lessonId:id}}}):await tx.studyProgress.findUnique({ where: { userId_lessonId: { userId, lessonId: id } } });
      // Use observation time for durable batches; receipt time would discard all but the first event.
      const eventAt=new Date(Math.min(observed?.getTime()??Date.now(),Date.now()));
      const previousAt=observed?(old?.lastEventAt??old?.updatedAt):old?.updatedAt;
      const fresh=!previousAt||eventAt>previousAt;
      const elapsed = Math.min(dto.elapsedSeconds, previousAt ? Math.max(0, Math.floor((eventAt.getTime() - previousAt.getTime()) / 1000)) : 0);
      const watchedSeconds = Math.min(Math.max(lesson.durationSeconds,requiredSeconds), (old?.watchedSeconds ?? 0) + elapsed);
      const complete = lesson.format === 'TEXT' ? dto.completed : requiredSeconds > 0 && watchedSeconds >= requiredSeconds * 0.9;
      const data = { positionSeconds: fresh?Math.min(dto.positionSeconds, Math.max(lesson.durationSeconds,requiredSeconds)):old!.positionSeconds, watchedSeconds, completedAt: old?.completedAt ?? (complete ? new Date() : null),lastEventAt:fresh?eventAt:previousAt };
      const progress = context.registration?await tx.cohortStudyProgress.upsert({where:{registrationId_lessonId:{registrationId:context.registration.id,lessonId:id}},create:{registrationId:context.registration.id,userId,releaseId:lesson.releaseId,lessonId:id,...data},update:data}):await tx.studyProgress.upsert({ where: { userId_lessonId: { userId, lessonId: id } }, create: { userId, lessonId: id, ...data }, update: data });
      if(progress.completedAt)await this.recordCompletion(userId,context,tx);
      if(!old?.completedAt&&progress.completedAt){
        const businessDay=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),date=new Date(businessDay+'T00:00:00Z'),eventKey='lesson.complete:'+userId+':'+id;
        if(!await tx.growthLedger.findUnique({where:{eventKey}})){
          const gained=await dailyGrowthAllocated(tx,userId,date),delta=Math.max(0,Math.min(2,20-gained));
          if(delta)await tx.growthLedger.create({data:{userId,delta,businessDay:date,eventKey,reason:'首次完成研习章节',sourceResourceId:lesson.release.courseId,ruleSnapshot:{growth:2,dailyLimit:20}}});
        }
      }
      const result = JSON.parse(JSON.stringify(progress));
      await tx.studyEvent.create({ data: { id: dto.eventId, userId, lessonId: id, payloadHash, result,cohortRegistrationId:context.registration?.id??null } });
      return result;
    });
  }
}
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningService,private readonly offline:OfflineCourses) {}
  private scoped(q:LearningContextQuery){if(q.cohortId&&q.offlineRegistrationId)throw new BadRequestException('请选择单一课程报名上下文');return q.offlineRegistrationId;}
  @Get('courses/:id') @UseGuards(OptionalUserGuard) curriculum(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest,@Query() query:LearningContextQuery) { const offlineId=this.scoped(query);return offlineId?this.offline.curriculum(id,req.actor?.id??'',offlineId):this.learning.curriculum(id, req.actor?.id,query.cohortId); }
  @Get('lessons/:id') @UseGuards(OptionalUserGuard) async lesson(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest,@Query() query:LearningContextQuery) {
    const offlineId=this.scoped(query);const { lesson, progress } = offlineId?await this.offline.lesson(id,req.actor?.id??'',offlineId):await this.learning.lesson(id, req.actor?.id,query.cohortId);
    if(lesson.format==='TEXT'&&!offlineId)await this.learning.markPaidAccess(id,req.actor?.id,query.cohortId);
    const { mediaId: _, sourceId: __, release: ___, subtitleText, ...safe } = lesson;
    return { ...safe, hasMedia: !!lesson.mediaId, subtitles:subtitleCues(subtitleText,lesson.durationSeconds), progress };
  }
  @Post('courses/:id/enroll') @UseGuards(UserGuard) enroll(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.learning.enroll(id, req.actor.id); }
  @Post('courses/:id/certificate') @UseGuards(UserGuard) certificate(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@Query() query:LearningContextQuery){const offlineId=this.scoped(query);return offlineId?this.offline.certificate(id,req.actor.id,offlineId):this.learning.certificate(id,req.actor.id,query.cohortId);}
  @Get('library') @UseGuards(UserGuard) library(@Req() req: AuthRequest, @Query() query: LibraryQuery) { return this.learning.library(req.actor.id, query); }
  @Get('summary') @UseGuards(UserGuard) summary(@Req() req:AuthRequest){return this.learning.summary(req.actor.id);}
  @Post('lessons/:id/progress') @UseGuards(UserGuard) progress(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProgressDto, @Req() req: AuthRequest,@Query() query:LearningContextQuery) { const offlineId=this.scoped(query);return offlineId?this.offline.progress(id,req.actor.id,dto,offlineId):this.learning.progress(id, req.actor.id, dto,query.cohortId); }
  @Get('membership') @UseGuards(UserGuard) membership(@Req() req: AuthRequest) { return this.learning.membership(req.actor.id); }
  @Get('plans') plans() { return this.learning.plans(); }
}
