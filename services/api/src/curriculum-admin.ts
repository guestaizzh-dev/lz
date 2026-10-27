import {Categories,validateCategory} from './categories.js';
import {imageUrlPattern} from './image-url.js';
import {validateOfflineCourse} from './offline-courses.js';
import {activateMemberGift} from './member-gift-stock.js';
import { validateEvidencePublication } from './evidence.js';
import { subtitleCues } from './subtitles.js';
import { randomUUID } from 'node:crypto';
import { maskedPhone, phoneLookup } from './private-data.js';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsISO8601, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Database } from './database.js';
import { membershipPlanView } from './membership-terms.js';
import { membershipRefundHolds } from './membership-benefits.js';
import { AdminGuard, requireRoles } from './auth.js';
import type { AuthRequest } from './auth.js';
import { TableQuery, TransitionDto } from './admin.js';
import type { CourseFormat, LessonFormat, PublishStatus } from './generated/prisma/client.js';

class ChapterDto {
  @IsOptional() @IsString() @Length(0, 200000) subtitleText?: string;
  @IsString() @Length(1, 120) title!: string;
  @IsIn(['TEXT', 'VIDEO', 'AUDIO', 'LIVE','OFFLINE']) format!: LessonFormat;
  @IsString() @Length(0, 50000) body!: string;
  @IsOptional() @IsUUID() mediaId?: string | null;
  @IsOptional() @IsUUID() liveSessionId?: string | null;
  @IsOptional() @IsUUID() eventSessionId?:string|null;
  @IsInt() @Min(0) @Max(86400) durationSeconds!: number;
  @IsBoolean() trial!: boolean;
  @IsBoolean() required!: boolean;
}
class CourseDto {
  @IsOptional() @IsBoolean() memberDiscountEligible?:boolean;
  @IsOptional() @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) earlyAccessAt?:string|null;
  @IsOptional() @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) publicOpenAt?:string|null;
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 500) subtitle!: string;
  @IsString() @Length(1, 10000) description!: string;
  @IsString() @Length(1, 40) category!: string;
  @IsIn(['VIDEO', 'AUDIO', 'LIVE', 'COHORT', 'OFFLINE']) format!: CourseFormat;
  @IsString() @Matches(imageUrlPattern,{message:'请上传有效的图片'}) cover!: string;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsUUID() teacherId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(4) membershipTier?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(3650) accessDays?: number | null;
  @IsString() @Length(1, 1000) refundPolicy!: string;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 30, { each: true }) tags!: string[];
  @IsBoolean() featured!: boolean;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChapterDto) chapters!: ChapterDto[];
}
class CourseDeleteDto { @IsInt() @Min(1) expectedVersion!: number; }
class CourseEditDto extends CourseDto { @IsInt() @Min(1) expectedVersion!: number; }
class TeacherDto {
  @IsOptional() @IsString() @Length(0, 1000) teachingDirection?: string;
  @IsOptional() @IsString() @Length(0, 3000) lineageSummary?: string;
  @IsOptional() @IsString() @Length(0, 3000) achievementSummary?: string;
  @IsString() @Length(1, 100) name!: string;
  @IsString() @Length(1, 200) title!: string;
  @IsString() @Length(1, 10000) bio!: string;
  @IsOptional() @IsString() @Matches(imageUrlPattern,{message:'请上传有效的图片'}) portrait?: string | null;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 40, { each: true }) expertise!: string[];
}
class GrantDto {
  @IsUUID() userId!: string;
  @IsString() @Length(1, 500) reason!: string;
}
class TeacherEditDto extends TeacherDto { @IsInt() @Min(1) expectedVersion!: number; }
class MemberGrantDto extends GrantDto { @IsUUID() planId!: string; }
class RevokeDto { @IsString() @Length(1, 500) reason!: string; }
class EntitlementQuery {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) size = 20;
  @IsOptional() @IsUUID() userId?: string;
  @IsIn(['membership', 'course']) kind = 'membership';
}
class PlanDto {
  @IsOptional() @IsInt() @Min(1) expectedVersion?:number;
  @IsString() @Length(1, 100) title!: string;
  @IsInt() @Min(1) @Max(4) tier!: number;
  @IsInt() @IsIn([30, 90, 365]) days!: number;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsString() @Length(1, 2000) description!: string;
  @IsBoolean() active!: boolean;
}

@Injectable()
export class CurriculumAdminService {
  constructor(private readonly db: Database) {}
  async list(query: TableQuery) {
    const where = { deletedAt: null, ...(query.category ? {category:query.category} : {}), ...(query.status ? { status: query.status } : {}), ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await this.db.$transaction([this.db.course.findMany({ where, include: { teacher: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }), this.db.course.count({ where })]);
    return { items, total };
  }
  async save(req: AuthRequest, dto: CourseDto | CourseEditDto, id?: string) {
    requireRoles(req, ['OPERATOR']);
    if (!await this.db.teacher.findUnique({ where: { id: dto.teacherId } })) throw new BadRequestException('名师不存在');
    if((!!dto.earlyAccessAt)!==(!!dto.publicOpenAt)||dto.earlyAccessAt&&(Date.parse(dto.earlyAccessAt)>=Date.parse(dto.publicOpenAt!)||!['VIDEO','AUDIO'].includes(dto.format)||!dto.membershipTier))throw new BadRequestException('提前研习仅用于包含会员内容的录播课程，请同时填写有效的提前与公开时间，提前时间须早于公开时间');
    for (const chapter of dto.chapters) {
      if(chapter.subtitleText?.trim()&&!['VIDEO','AUDIO'].includes(chapter.format))throw new BadRequestException('仅录播音视频章节可配置字幕，直播字幕请随回放提交审核');
      subtitleCues(chapter.subtitleText??'',chapter.durationSeconds);
      if (chapter.format === 'TEXT' && !chapter.body.trim()) throw new BadRequestException('图文章节必须填写正文');
      if (['VIDEO','AUDIO'].includes(chapter.format)) {
        const media = chapter.mediaId ? await this.db.mediaAsset.findUnique({ where: { id: chapter.mediaId } }) : null;
        if (!media || media.status!=='READY' || (media.variants as {uploadPurpose?:string})?.uploadPurpose || !media.mime.startsWith(chapter.format === 'VIDEO' ? 'video/' : 'audio/') || chapter.durationSeconds === 0) throw new BadRequestException('音视频章节必须选择可用的对应媒体并填写时长，不能使用处理中、失败或私人附件');
        if(media.durationSeconds&&Math.abs(chapter.durationSeconds-media.durationSeconds)>1)throw new BadRequestException('章节时长须与媒体实际时长一致，请重新选择媒体自动填入');
      }
    }
    if(dto.memberDiscountEligible&&!['VIDEO','AUDIO'].includes(dto.format))throw new BadRequestException('会员购课折扣仅适用于录播音视频课程');
    if(dto.format==='LIVE'&&dto.accessDays!=null)throw new BadRequestException('直播课程采用长期访问，避免购课有效期早于开播与回放交付');
    if(dto.chapters.some(c=>c.format==='LIVE'&&(dto.format!=='LIVE'||c.trial||c.mediaId||c.durationSeconds<1)))throw new BadRequestException('直播章节须归属直播课程、填写预计时长，不能试听或使用录播媒体');
    if(dto.chapters.some(c=>c.format==='OFFLINE'&&(dto.format!=='OFFLINE'||c.trial||c.mediaId||c.liveSessionId)||c.format!=='OFFLINE'&&c.eventSessionId))throw new BadRequestException('线下课堂须属于线下课程，不能试听、绑定播放媒体或混用直播场次');
    if(dto.format==='OFFLINE'&&(dto.price!==0||dto.membershipTier!=null||dto.accessDays!=null))throw new BadRequestException('线下课按活动票价报名，课程标价为0，不附加数字课程购买或会员内容授权');
    if(dto.chapters.some(c=>c.format!=='LIVE'&&c.liveSessionId))throw new BadRequestException('仅直播章节可绑定场次');
    const { chapters, expectedVersion: _, earlyAccessAt, publicOpenAt, ...fields } = dto as CourseEditDto;
    const data={...fields,earlyAccessAt:earlyAccessAt?new Date(earlyAccessAt):null,publicOpenAt:publicOpenAt?new Date(publicOpenAt):null};
    return this.db.$transaction(async tx => {
      await validateCategory(tx, 'COURSE', dto.category, id ? (await tx.course.findUnique({where:{id},select:{category:true}}))?.category : undefined);
      let course;
      const stats = { chaptersCount: chapters.length, durationMinutes: Math.ceil(chapters.reduce((sum, c) => sum + c.durationSeconds, 0) / 60) };
      if (id) {
        const changed = await tx.course.updateMany({ where: { id, deletedAt: null, version: (dto as CourseEditDto).expectedVersion, status: { in: ['DRAFT', 'REJECTED'] } }, data: { ...data, ...stats, version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('版本或状态已变化；已发布课程需先下架修订');
        course = await tx.course.findUniqueOrThrow({ where: { id } });
        await tx.courseChapter.deleteMany({ where: { courseId: id } });
      } else course = await tx.course.create({ data: { ...data, ...stats } });
      for(const chapter of chapters.filter(c=>c.liveSessionId)){
        await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${chapter.liveSessionId!} FOR SHARE`;
        const session=await tx.liveSession.findUnique({where:{id:chapter.liveSessionId!}}),room=session?await tx.liveRoom.findUnique({where:{id:session.roomId}}):null;
        const rule=session?.accessRuleSnapshot as {mode?:string;courseId?:string;lessonBound?:boolean}|undefined;
        if(!session||!room||room.teacherId!==dto.teacherId||rule?.mode!=='COURSE'||rule.courseId!==course.id||!rule.lessonBound||session.state==='CANCELLED')throw new BadRequestException('请选择本课程、本名师的有效专属直播场次');
      }
      if(new Set(chapters.filter(c=>c.liveSessionId).map(c=>c.liveSessionId)).size!==chapters.filter(c=>c.liveSessionId).length)throw new BadRequestException('同一场直播不能重复配置为多个章节');
      if (chapters.length) await tx.courseChapter.createMany({ data: chapters.map((c, i) => ({ ...c, courseId: course.id, position: i + 1, mediaId: ['TEXT','LIVE','OFFLINE'].includes(c.format) ? null : c.mediaId,liveSessionId:c.format==='LIVE'?c.liveSessionId??null:null,eventSessionId:c.format==='OFFLINE'?c.eventSessionId??null:null })) });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: id ? 'course.edit' : 'course.create', resource: 'course', resourceId: course.id, changes: { version: course.version, chapters: chapters.length } } });
      return course;
    });
  }
  async remove(req: AuthRequest, id: string, dto: CourseDeleteDto) {
    requireRoles(req, ['OPERATOR']);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id=${id} FOR UPDATE`;
      const course = await tx.course.findUnique({ where: { id } });
      if (!course) throw new NotFoundException('课程不存在');
      if (course.deletedAt) return { deleted: true };
      if (course.status !== 'ARCHIVED' || course.version !== dto.expectedVersion) throw new ConflictException('仅可删除已下架课程；状态或版本已变化，请刷新');
      // Retain frozen releases and every purchased entitlement, order and learning record.
      await tx.course.update({ where: { id }, data: { deletedAt: new Date(), featured: false, version: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'course.delete', resource: 'course', resourceId: id, changes: { title: course.title, previousVersion: course.version, retainedPurchases: true } } });
      return { deleted: true };
    });
  }
  async transition(req: AuthRequest, id: string, dto: TransitionDto) {
    requireRoles(req, ['publish', 'reject'].includes(dto.action) ? ['MODERATOR'] : ['OPERATOR']);
    const states: Record<string, { from: PublishStatus[]; to: PublishStatus }> = {
      submit: { from: ['DRAFT', 'REJECTED'], to: 'REVIEW' }, publish: { from: req.actor.roles.includes('ADMIN') ? ['DRAFT','REJECTED','REVIEW'] : ['REVIEW'], to: 'PUBLISHED' }, reject: { from: ['REVIEW'], to: 'REJECTED' }, archive: { from: ['PUBLISHED'], to: 'ARCHIVED' }, revise: { from: req.actor.roles.includes('ADMIN') ? ['ARCHIVED','REJECTED','PUBLISHED'] : ['ARCHIVED','REJECTED'], to: 'DRAFT' },
    };
    const state = states[dto.action]!;
    return this.db.$transaction(async tx => {
      const changed = await tx.course.updateMany({ where: { id, deletedAt: null, version: dto.expectedVersion, status: { in: state.from } }, data: { status: state.to, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('版本或状态已变化，请刷新');
      const course = await tx.course.findUniqueOrThrow({ where: { id }, include: { chapters: { orderBy: { position: 'asc' } }, teacher: true } });
      if (['submit', 'publish'].includes(dto.action)) {
        if (!course.chapters.length || course.teacher.status !== 'PUBLISHED') throw new BadRequestException('须先发布名师并填写有效章节');
        if (!['VIDEO', 'AUDIO', 'LIVE','OFFLINE'].includes(course.format)) throw new BadRequestException('请通过训练营或线下交付专用流程发布');
        for(const chapter of course.chapters.filter(c=>['VIDEO','AUDIO'].includes(c.format))){
          if(!chapter.mediaId)throw new BadRequestException('音视频章节缺少媒体');
          await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${chapter.mediaId} FOR SHARE`;
          const media=await tx.mediaAsset.findUnique({where:{id:chapter.mediaId}});
          if(!media||media.status!=='READY'||(media.variants as {uploadPurpose?:string})?.uploadPurpose||!media.mime.startsWith(chapter.format==='VIDEO'?'video/':'audio/')||chapter.durationSeconds<1)throw new BadRequestException('音视频章节媒体已失效或为私人附件，请更换后重新送审');
        if(media.durationSeconds&&Math.abs(chapter.durationSeconds-media.durationSeconds)>1)throw new BadRequestException('章节时长与媒体实际时长不一致，请修订后重新送审');
          subtitleCues(chapter.subtitleText,chapter.durationSeconds);
        }
        await validateOfflineCourse(tx,course,course.chapters,req.actor.id,dto.action==='publish');
        if(course.format==='LIVE'){
          const liveChapters=course.chapters.filter(c=>c.format==='LIVE');
          if(!liveChapters.length||course.accessDays!=null)throw new BadRequestException('直播课程须配置直播章节并采用长期访问');
          for(const chapter of liveChapters){
            if(!chapter.liveSessionId)throw new BadRequestException('直播章节尚未绑定场次，请先保存草稿、创建专属直播间及场次，再回到课程绑定');
            await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${chapter.liveSessionId} FOR SHARE`;
            const session=await tx.liveSession.findUniqueOrThrow({where:{id:chapter.liveSessionId}}),room=await tx.liveRoom.findUniqueOrThrow({where:{id:session.roomId}}),resource=await tx.resource.findUnique({where:{id:room.id}});
            const rule=session.accessRuleSnapshot as {mode?:string;courseId?:string;lessonBound?:boolean};
            if(resource?.publishState!=='PUBLISHED'||room.teacherId!==course.teacherId||rule.mode!=='COURSE'||rule.courseId!==id||!rule.lessonBound||session.state==='CANCELLED')throw new BadRequestException('专属直播间须已发布，场次须有效且属于本课程名师');
          }
        }
      }
      if (dto.action === 'publish') {
        const release = await tx.courseRelease.create({ data: { courseId: id, version: course.version, title: course.title, memberPolicySnapshot:{discountEligible:course.memberDiscountEligible,category:course.category,earlyAccessAt:course.earlyAccessAt?.toISOString()??null,publicOpenAt:course.publicOpenAt?.toISOString()??null}, descriptionSnapshot: course.description, teacherSnapshot: { id: course.teacher.id, name: course.teacher.name }, accessDays: course.accessDays, refundPolicySnapshot: { text: course.refundPolicy }, completionPolicySnapshot: { text: course.completionPolicy }, lessons: { create: course.chapters.map(c => ({ sourceId: c.stableKey || c.id, position: c.position, title: c.title, format: c.format, body: c.body, subtitleText:c.subtitleText, mediaId: c.mediaId, liveSessionId:c.liveSessionId,eventSessionId:c.eventSessionId, durationSeconds: c.durationSeconds, trial: c.trial, required: c.required })) } } });
        await tx.course.update({ where: { id }, data: { publishedReleaseId: release.id } });
        if(course.format!=='OFFLINE')await tx.saleOffer.create({data:{kind:'COURSE',courseReleaseId:release.id,currency:'CNY',price:BigInt(course.price),active:true,quantityLimit:1,policySnapshot:{title:release.title,accessDays:release.accessDays,refundPolicy:release.refundPolicySnapshot,refundDays:7}}});
      }
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'course.' + dto.action, resource: 'course', resourceId: id, changes: { reason: dto.reason, version: course.version } } });
      return tx.course.findUniqueOrThrow({ where: { id } });
    });
  }
  async grant(req: AuthRequest, id: string, dto: GrantDto) {
    requireRoles(req, ['ADMIN']);
    return this.db.$transaction(async tx => {
      const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${dto.userId} AND status = 'ACTIVE' FOR UPDATE`;
      if (!users.length) throw new NotFoundException('有效用户不存在');
      const course = await tx.course.findUnique({ where: { id } });
      if(course?.format==='OFFLINE')throw new BadRequestException('线下课程请通过实际场次报名，不可单独授予绕过席位的数字权限');
      if (!course?.publishedReleaseId || course.status !== 'PUBLISHED') throw new BadRequestException('只能授权已发布课程');
      await tx.$queryRaw`SELECT id FROM "CourseRelease" WHERE id=${course.publishedReleaseId} FOR SHARE`;
      if((await tx.courseRelease.findUniqueOrThrow({where:{id:course.publishedReleaseId}})).withdrawnAt)throw new BadRequestException('此版本已停止交付，不能补授访问权');
      const previous = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: dto.userId, courseId: id } } });
      if(previous?.cohortId)throw new ConflictException('此账号已有营期记录，请通过训练营流程处理，不能覆盖营期权限');
      if (previous && !previous.revokedAt && (!previous.expiresAt || previous.expiresAt > new Date())) throw new ConflictException('用户已有有效课程权限');
      const data = { grantKey: randomUUID(), version: (previous?.version ?? 0) + 1, releaseId: course.publishedReleaseId, source: 'ADMIN_COMPENSATION', orderItemId:null, startedAt:null, revokedAt: null, startsAt: new Date(), grantActorId: req.actor.id, grantReason: dto.reason, expiresAt: course.accessDays ? new Date(Date.now() + course.accessDays * 86400000) : null };
      const result = await tx.enrollment.upsert({ where: { userId_courseId: { userId: dto.userId, courseId: id } }, create: { userId: dto.userId, courseId: id, ...data }, update: data });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'course.grant', resource: 'course', resourceId: id, changes: { userId: dto.userId, reason: dto.reason, releaseId: result.releaseId } } });
      return result;
    });
  }
  async memberGrant(req: AuthRequest, dto: MemberGrantDto) {
    requireRoles(req, ['ADMIN']);
    return this.db.$transaction(async tx => {
      const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${dto.userId} AND status = 'ACTIVE' FOR UPDATE`;
      if (!users.length) throw new NotFoundException('有效用户不存在');
      const plan = await tx.membershipPlan.findUnique({ where: { id: dto.planId } });
      if (!plan?.active || plan.tier<1) throw new BadRequestException('会员套餐未启用；注册会员无需额外授权');
      const latest = await tx.membership.findFirst({ where: { userId: dto.userId, revokedAt: null, endsAt: { gt: new Date() } }, orderBy: { endsAt: 'desc' } });
      const startsAt = latest?.endsAt ?? new Date();
      const member = await tx.membership.create({ data: { userId: dto.userId, planId: plan.id, tier: plan.tier, startsAt, endsAt: new Date(startsAt.getTime() + plan.days * 86400000), source: 'ADMIN_COMPENSATION',actorId:req.actor.id,reason:dto.reason } });
      await activateMemberGift(tx,member.id);await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'membership.grant', resource: 'membership', resourceId: member.id, changes: { userId: dto.userId, reason: dto.reason, planId: plan.id } } });
      return member;
    });
  }
  async plan(req: AuthRequest, dto: PlanDto) {
    requireRoles(req, ['ADMIN']);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership.plan:${dto.tier}:${dto.days}`},0))`;
      const old=await tx.membershipPlan.findUnique({where:{tier_days:{tier:dto.tier,days:dto.days}}});
      if(old&&dto.expectedVersion!==old.version)throw new ConflictException('同层级同期限套餐已存在或版本已变化，请刷新后编辑；不会静默覆盖旧套餐');
      if(!old&&dto.expectedVersion!==undefined)throw new ConflictException('套餐不存在，请刷新后重新创建');
      const {expectedVersion:_,...data}=dto;
      const row=old?await tx.membershipPlan.update({where:{id:old.id},data:{...data,version:{increment:1}}}):await tx.membershipPlan.create({data});
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'membership.plan', resource: 'membershipPlan', resourceId: row.id, changes: { ...dto } } });
      return tx.membershipPlan.findUniqueOrThrow({where:{id:row.id}});
    });
  }
  async planChannels(id:string){
    const plan=await this.db.membershipPlan.findUnique({where:{id}});if(!plan)throw new NotFoundException('会员套餐不存在');
    const offers=plan.currentVersionId?await this.db.saleOffer.findMany({where:{kind:'MEMBERSHIP',membershipVersionId:plan.currentVersionId,active:true}}):[];
    const mappings=await this.db.channelProductMapping.findMany({where:{offerId:{in:offers.map(o=>o.id)},channel:'APPLE_IAP'}});
    const issues:string[]=['会员购买续费、退款及对应原生渠道尚未完成验收，当前不收费。'];
    if(!offers.length)issues.push('当前套餐版本没有有效会员售卖项；后续购买流程须绑定此版本。');
    if(!mappings.length)issues.push('尚无Apple会员产品映射；固定天数手动套餐须对应非续期订阅，不能复用长期课程的非消耗型产品。');
    return{planId:id,version:plan.version,planVersionId:plan.currentVersionId,purchaseReady:false,issues,products:mappings.map(m=>({id:m.id,appScope:m.appScope,productId:m.externalProductId,active:m.active,price:String(m.priceMinor??0n),valid:m.productType==='Non-Renewing Subscription'&&m.currency==='CNY'&&m.priceMinor===BigInt(plan.price)&&!!offers.find(o=>o.id===m.offerId&&o.currency==='CNY'&&o.price===BigInt(plan.price)),explanation:m.productType!=='Non-Renewing Subscription'?'产品类型不匹配固定天数手动会员套餐':'价格、版本和商店配置仍需对应购买流程验证'}))};
  }
  async entitlements(req: AuthRequest, query: EntitlementQuery) {
    requireRoles(req, ['ADMIN']);
    const where = query.userId ? { userId: query.userId } : {};
    const paging = { skip: (query.page - 1) * query.size, take: query.size, orderBy: { createdAt: 'desc' as const } };
    const user = { select: { id: true, nickname: true, phone: true, phoneCipher: true } };
    const [rows, total] = query.kind === 'membership'
      ? await this.db.$transaction([this.db.membership.findMany({ where, ...paging, include: { user, plan: true } }), this.db.membership.count({ where })])
      : await this.db.$transaction([this.db.enrollment.findMany({ where, ...paging, include: { user, course: { select: { id: true, title: true } } } }), this.db.enrollment.count({ where })]);
    const versions=query.kind==='membership'?await this.db.membershipPlanVersion.findMany({where:{id:{in:rows.flatMap(row=>'planVersionId' in row&&row.planVersionId?[row.planVersionId]:[])}}}):[];
    const suspended=query.kind==='membership'?(await Promise.all([...new Set(rows.map(row=>row.userId))].map(userId=>membershipRefundHolds(userId,this.db)))).flat():[];
    return { items: rows.map(row => ({ ...row,...('plan' in row?{plan:membershipPlanView(row.plan,versions.find(v=>v.id===row.planVersionId)),refundPending:suspended.includes(row.id)}:{}), user: { id: row.user.id, nickname: row.user.nickname, phone: maskedPhone(row.user) } })), total };
  }
  async revoke(req: AuthRequest, kind: 'membership' | 'course', id: string, reason: string) {
    requireRoles(req, ['ADMIN']);
    if (!reason.trim()) throw new BadRequestException('请填写撤销原因');
    return this.db.$transaction(async tx => {
      const row = kind === 'membership' ? await tx.membership.findUnique({ where: { id } }) : await tx.enrollment.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('授权记录不存在');
      if('cohortId' in row&&row.cohortId)throw new ConflictException('营期撤权须通过训练营退出流程，避免席位与访问权不一致');
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${row.userId} FOR UPDATE`;
      const update = { where: { id, revokedAt: null }, data: { revokedAt: new Date() } };
      const changed = kind === 'membership' ? await tx.membership.updateMany(update) : await tx.enrollment.updateMany(update);
      if (changed.count) await tx.auditLog.create({ data: { actorId: req.actor.id, action: kind + '.revoke', resource: kind === 'membership' ? 'membership' : 'enrollment', resourceId: id, changes: { userId: row.userId, reason: reason.trim() } } });
      return { revoked: true };
    });
  }
}
@Controller('admin') @UseGuards(AdminGuard)
export class CurriculumAdminController {
  constructor(private readonly service: CurriculumAdminService, private readonly db: Database,private readonly categories:Categories) {}
  @Get('courses') list(@Query() query: TableQuery, @Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.service.list(query).then(value=>this.categories.decorate('COURSE',value)); }
  @Get('courses/:id') async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); const row = await this.db.course.findUnique({ where: { id }, include: { chapters: { orderBy: { position: 'asc' } } } }); if (!row || row.deletedAt) throw new NotFoundException('课程不存在或已删除'); return row; }
  @Post('courses') create(@Body() dto: CourseDto, @Req() req: AuthRequest) { return this.service.save(req, dto); }
  @Patch('courses/:id') edit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CourseEditDto, @Req() req: AuthRequest) { return this.service.save(req, dto, id); }
  @Post('courses/:id/delete') remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CourseDeleteDto, @Req() req: AuthRequest) { return this.service.remove(req, id, dto); }
  @Post('courses/:id/transition') transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @Req() req: AuthRequest) { return this.service.transition(req, id, dto); }
  @Get('courses/:id/audit') audit(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.db.auditLog.findMany({ where: { resource: 'course', resourceId: id }, orderBy: { createdAt: 'desc' }, take: 100 }); }
  @Post('courses/:id/grant') grant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GrantDto, @Req() req: AuthRequest) { return this.service.grant(req, id, dto); }
  @Get('teachers') teachers(@Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.db.teacher.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 }); }
  @Post('teachers') async teacher(@Body() dto: TeacherDto, @Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR']);
    return this.db.$transaction(async tx => { const row = await tx.teacher.create({ data: dto }); await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'teacher.create', resource: 'teacher', resourceId: row.id, changes: { name: row.name } } }); return row; });
  }
  @Post('teachers/:id/transition') async teacherTransition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @Req() req: AuthRequest) {
    requireRoles(req, ['publish', 'reject'].includes(dto.action) ? ['MODERATOR'] : ['OPERATOR']);
    const states: Record<string, [PublishStatus[], PublishStatus]> = { submit: [['DRAFT', 'REJECTED'], 'REVIEW'], publish: [req.actor.roles.includes('ADMIN') ? ['DRAFT','REJECTED','REVIEW'] : ['REVIEW'], 'PUBLISHED'], reject: [['REVIEW'], 'REJECTED'], archive: [['PUBLISHED'], 'ARCHIVED'], revise: [req.actor.roles.includes('ADMIN') ? ['ARCHIVED','REJECTED','PUBLISHED'] : ['ARCHIVED','REJECTED'], 'DRAFT'] };
    return this.db.$transaction(async tx => { if(['submit','publish'].includes(dto.action))await validateEvidencePublication(tx,id); const [from, to] = states[dto.action]!; const changed = await tx.teacher.updateMany({ where: { id, version: dto.expectedVersion, status: { in: from } }, data: { status: to, version: { increment: 1 } } }); if (!changed.count) throw new ConflictException('名师状态或版本已变化'); await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'teacher.' + dto.action, resource: 'teacher', resourceId: id, changes: { reason: dto.reason } } }); return tx.teacher.findUniqueOrThrow({ where: { id } }); });
  }
  @Patch('teachers/:id') async editTeacher(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TeacherEditDto, @Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR']);
    const { expectedVersion, ...data } = dto;
    return this.db.$transaction(async tx => { const result = await tx.teacher.updateMany({ where: { id, version: expectedVersion, status: { in: ['DRAFT', 'REJECTED'] } }, data: { ...data, version: { increment: 1 } } }); if (!result.count) throw new ConflictException('名师版本或状态已变化'); await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'teacher.edit', resource: 'teacher', resourceId: id, changes: { name: dto.name, changedFields: Object.keys(data), version:expectedVersion+1 } } }); return tx.teacher.findUniqueOrThrow({ where: { id } }); });
  }
  @Get('entitlements/users') async users(@Query() query: TableQuery, @Req() req: AuthRequest) {
    requireRoles(req, ['ADMIN']);
    const where = { status: 'ACTIVE' as const, ...(query.q ? { OR: [{ nickname: { contains: query.q } }, { phone: { contains: query.q } }, ...(/^1[3-9]\d{9}$/.test(query.q) ? [{phoneHash:phoneLookup(query.q)}] : [])] } : {}) };
    const rows = await this.db.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.size, skip: (query.page - 1) * query.size, select: { id: true, nickname: true, phone: true, phoneCipher: true } });
    return rows.map(row => ({ id: row.id, nickname: row.nickname, phone: maskedPhone(row) }));
  }
  @Post('memberships/grant') memberGrant(@Body() dto: MemberGrantDto, @Req() req: AuthRequest) { return this.service.memberGrant(req, dto); }
  @Get('memberships/plans') plans(@Req() req: AuthRequest) { requireRoles(req, ['ADMIN']); return this.db.membershipPlan.findMany({ orderBy: [{ tier: 'asc' }, { days: 'asc' }] }); }
  @Get('memberships/plans/:id/channel-check') planChannels(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){requireRoles(req,['ADMIN']);return this.service.planChannels(id);}
  @Post('memberships/plans') plan(@Body() dto: PlanDto, @Req() req: AuthRequest) { return this.service.plan(req, dto); }
  @Get('entitlements') entitlements(@Query() query: EntitlementQuery, @Req() req: AuthRequest) { return this.service.entitlements(req, query); }
  @Post('memberships/:id/revoke') revokeMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @Req() req: AuthRequest) { return this.service.revoke(req, 'membership', id, dto.reason); }
  @Post('enrollments/:id/revoke') revokeCourse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @Req() req: AuthRequest) { return this.service.revoke(req, 'course', id, dto.reason); }
}
