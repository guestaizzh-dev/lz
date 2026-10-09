import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Database } from './database.js';
import { AdminGuard, requireRoles } from './auth.js';
import type { AuthRequest } from './auth.js';
import { TableQuery, TransitionDto } from './admin.js';
import type { CourseFormat, LessonFormat, PublishStatus } from './generated/prisma/client.js';

class ChapterDto {
  @IsString() @Length(1, 120) title!: string;
  @IsIn(['TEXT', 'VIDEO', 'AUDIO']) format!: LessonFormat;
  @IsString() @Length(0, 50000) body!: string;
  @IsOptional() @IsUUID() mediaId?: string | null;
  @IsInt() @Min(0) @Max(86400) durationSeconds!: number;
  @IsBoolean() trial!: boolean;
  @IsBoolean() required!: boolean;
}
class CourseDto {
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 500) subtitle!: string;
  @IsString() @Length(1, 10000) description!: string;
  @IsIn(['经典研习', '实践修行', '生活应用', '少儿启蒙']) category!: string;
  @IsIn(['VIDEO', 'AUDIO', 'LIVE', 'COHORT', 'OFFLINE']) format!: CourseFormat;
  @IsString() @Matches(/^(https:\/\/[^\s]+|\/static\/art\/[a-z-]+\.svg)$/) cover!: string;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsUUID() teacherId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(3) membershipTier?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(3650) accessDays?: number | null;
  @IsString() @Length(1, 1000) refundPolicy!: string;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 30, { each: true }) tags!: string[];
  @IsBoolean() featured!: boolean;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChapterDto) chapters!: ChapterDto[];
}
class CourseEditDto extends CourseDto { @IsInt() @Min(1) expectedVersion!: number; }
class TeacherDto {
  @IsString() @Length(1, 100) name!: string;
  @IsString() @Length(1, 200) title!: string;
  @IsString() @Length(1, 10000) bio!: string;
  @IsOptional() @IsString() @Matches(/^https:\/\/[^\s]+$/) portrait?: string | null;
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
  @IsString() @Length(1, 100) title!: string;
  @IsInt() @Min(1) @Max(3) tier!: number;
  @IsInt() @IsIn([30, 90, 365]) days!: number;
  @IsInt() @Min(0) @Max(100000000) price!: number;
  @IsString() @Length(1, 2000) description!: string;
  @IsBoolean() active!: boolean;
}

@Injectable()
export class CurriculumAdminService {
  constructor(private readonly db: Database) {}
  async list(query: TableQuery) {
    const where = { ...(query.status ? { status: query.status } : {}), ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await this.db.$transaction([this.db.course.findMany({ where, include: { teacher: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }), this.db.course.count({ where })]);
    return { items, total };
  }
  async save(req: AuthRequest, dto: CourseDto | CourseEditDto, id?: string) {
    requireRoles(req, ['OPERATOR']);
    if (!await this.db.teacher.findUnique({ where: { id: dto.teacherId } })) throw new BadRequestException('名师不存在');
    for (const chapter of dto.chapters) {
      if (chapter.format === 'TEXT' && !chapter.body.trim()) throw new BadRequestException('图文章节必须填写正文');
      if (chapter.format !== 'TEXT') {
        const media = chapter.mediaId ? await this.db.mediaAsset.findUnique({ where: { id: chapter.mediaId } }) : null;
        if (!media || !media.mime.startsWith(chapter.format === 'VIDEO' ? 'video/' : 'audio/') || chapter.durationSeconds === 0) throw new BadRequestException('音视频章节必须选择对应媒体并填写时长');
      }
    }
    const { chapters, expectedVersion: _, ...data } = dto as CourseEditDto;
    return this.db.$transaction(async tx => {
      let course;
      const stats = { chaptersCount: chapters.length, durationMinutes: Math.ceil(chapters.reduce((sum, c) => sum + c.durationSeconds, 0) / 60) };
      if (id) {
        const changed = await tx.course.updateMany({ where: { id, version: (dto as CourseEditDto).expectedVersion, status: { in: ['DRAFT', 'REJECTED'] } }, data: { ...data, ...stats, version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('版本或状态已变化；已发布课程需先下架修订');
        course = await tx.course.findUniqueOrThrow({ where: { id } });
        await tx.courseChapter.deleteMany({ where: { courseId: id } });
      } else course = await tx.course.create({ data: { ...data, ...stats } });
      if (chapters.length) await tx.courseChapter.createMany({ data: chapters.map((c, i) => ({ ...c, courseId: course.id, position: i + 1, mediaId: c.format === 'TEXT' ? null : c.mediaId })) });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: id ? 'course.edit' : 'course.create', resource: 'course', resourceId: course.id, changes: { version: course.version, chapters: chapters.length } } });
      return course;
    });
  }
  async transition(req: AuthRequest, id: string, dto: TransitionDto) {
    requireRoles(req, ['publish', 'reject'].includes(dto.action) ? ['MODERATOR'] : ['OPERATOR']);
    const states: Record<string, { from: PublishStatus[]; to: PublishStatus }> = {
      submit: { from: ['DRAFT', 'REJECTED'], to: 'REVIEW' }, publish: { from: ['REVIEW'], to: 'PUBLISHED' }, reject: { from: ['REVIEW'], to: 'REJECTED' }, archive: { from: ['PUBLISHED'], to: 'ARCHIVED' }, revise: { from: ['ARCHIVED', 'REJECTED'], to: 'DRAFT' },
    };
    const state = states[dto.action]!;
    return this.db.$transaction(async tx => {
      const changed = await tx.course.updateMany({ where: { id, version: dto.expectedVersion, status: { in: state.from } }, data: { status: state.to, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('版本或状态已变化，请刷新');
      const course = await tx.course.findUniqueOrThrow({ where: { id }, include: { chapters: { orderBy: { position: 'asc' } }, teacher: true } });
      if (['submit', 'publish'].includes(dto.action)) {
        if (!course.chapters.length || course.teacher.status !== 'PUBLISHED') throw new BadRequestException('须先发布名师并填写有效章节');
        if (!['VIDEO', 'AUDIO'].includes(course.format)) throw new BadRequestException('直播、训练营与线下交付尚未配置，不能发布');
      }
      if (dto.action === 'publish') {
        const release = await tx.courseRelease.create({ data: { courseId: id, version: course.version, title: course.title, descriptionSnapshot: course.description, teacherSnapshot: { id: course.teacher.id, name: course.teacher.name }, accessDays: course.accessDays, refundPolicySnapshot: { text: course.refundPolicy }, completionPolicySnapshot: { text: course.completionPolicy }, lessons: { create: course.chapters.map(c => ({ sourceId: c.stableKey || c.id, position: c.position, title: c.title, format: c.format, body: c.body, mediaId: c.mediaId, durationSeconds: c.durationSeconds, trial: c.trial, required: c.required })) } } });
        await tx.course.update({ where: { id }, data: { publishedReleaseId: release.id } });
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
      if (!course?.publishedReleaseId || course.status !== 'PUBLISHED') throw new BadRequestException('只能授权已发布课程');
      const previous = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: dto.userId, courseId: id } } });
      if (previous && !previous.revokedAt && (!previous.expiresAt || previous.expiresAt > new Date())) throw new ConflictException('用户已有有效课程权限');
      const data = { releaseId: course.publishedReleaseId, source: 'ADMIN_COMPENSATION', revokedAt: null, startsAt: new Date(), grantActorId: req.actor.id, grantReason: dto.reason, expiresAt: course.accessDays ? new Date(Date.now() + course.accessDays * 86400000) : null };
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
      if (!plan?.active) throw new BadRequestException('会员套餐未启用');
      const latest = await tx.membership.findFirst({ where: { userId: dto.userId, revokedAt: null, endsAt: { gt: new Date() } }, orderBy: { endsAt: 'desc' } });
      const startsAt = latest?.endsAt ?? new Date();
      const member = await tx.membership.create({ data: { userId: dto.userId, planId: plan.id, tier: plan.tier, startsAt, endsAt: new Date(startsAt.getTime() + plan.days * 86400000), source: 'ADMIN_COMPENSATION' } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'membership.grant', resource: 'membership', resourceId: member.id, changes: { userId: dto.userId, reason: dto.reason, planId: plan.id } } });
      return member;
    });
  }
  async plan(req: AuthRequest, dto: PlanDto) {
    requireRoles(req, ['ADMIN']);
    return this.db.$transaction(async tx => {
      const row = await tx.membershipPlan.upsert({ where: { tier_days: { tier: dto.tier, days: dto.days } }, create: dto, update: dto });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'membership.plan', resource: 'membershipPlan', resourceId: row.id, changes: { ...dto } } });
      return row;
    });
  }
  async entitlements(req: AuthRequest, query: EntitlementQuery) {
    requireRoles(req, ['ADMIN']);
    const where = query.userId ? { userId: query.userId } : {};
    const paging = { skip: (query.page - 1) * query.size, take: query.size, orderBy: { createdAt: 'desc' as const } };
    const user = { select: { id: true, nickname: true, phone: true } };
    const [rows, total] = query.kind === 'membership'
      ? await this.db.$transaction([this.db.membership.findMany({ where, ...paging, include: { user, plan: true } }), this.db.membership.count({ where })])
      : await this.db.$transaction([this.db.enrollment.findMany({ where, ...paging, include: { user, course: { select: { id: true, title: true } } } }), this.db.enrollment.count({ where })]);
    return { items: rows.map(row => ({ ...row, user: { ...row.user, phone: row.user.phone ? row.user.phone.slice(0, 3) + '****' + row.user.phone.slice(-4) : null } })), total };
  }
  async revoke(req: AuthRequest, kind: 'membership' | 'course', id: string, reason: string) {
    requireRoles(req, ['ADMIN']);
    if (!reason.trim()) throw new BadRequestException('请填写撤销原因');
    return this.db.$transaction(async tx => {
      const row = kind === 'membership' ? await tx.membership.findUnique({ where: { id } }) : await tx.enrollment.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('授权记录不存在');
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
  constructor(private readonly service: CurriculumAdminService, private readonly db: Database) {}
  @Get('courses') list(@Query() query: TableQuery, @Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.service.list(query); }
  @Get('courses/:id') async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); const row = await this.db.course.findUnique({ where: { id }, include: { chapters: { orderBy: { position: 'asc' } } } }); if (!row) throw new NotFoundException('课程不存在'); return row; }
  @Post('courses') create(@Body() dto: CourseDto, @Req() req: AuthRequest) { return this.service.save(req, dto); }
  @Patch('courses/:id') edit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CourseEditDto, @Req() req: AuthRequest) { return this.service.save(req, dto, id); }
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
    const states: Record<string, [PublishStatus[], PublishStatus]> = { submit: [['DRAFT', 'REJECTED'], 'REVIEW'], publish: [['REVIEW'], 'PUBLISHED'], reject: [['REVIEW'], 'REJECTED'], archive: [['PUBLISHED'], 'ARCHIVED'], revise: [['ARCHIVED', 'REJECTED'], 'DRAFT'] };
    return this.db.$transaction(async tx => { const [from, to] = states[dto.action]!; const changed = await tx.teacher.updateMany({ where: { id, version: dto.expectedVersion, status: { in: from } }, data: { status: to, version: { increment: 1 } } }); if (!changed.count) throw new ConflictException('名师状态或版本已变化'); await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'teacher.' + dto.action, resource: 'teacher', resourceId: id, changes: { reason: dto.reason } } }); return tx.teacher.findUniqueOrThrow({ where: { id } }); });
  }
  @Patch('teachers/:id') async editTeacher(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TeacherEditDto, @Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR']);
    const { expectedVersion, ...data } = dto;
    return this.db.$transaction(async tx => { const result = await tx.teacher.updateMany({ where: { id, version: expectedVersion, status: { in: ['DRAFT', 'REJECTED'] } }, data: { ...data, version: { increment: 1 } } }); if (!result.count) throw new ConflictException('名师版本或状态已变化'); await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'teacher.edit', resource: 'teacher', resourceId: id, changes: { name: dto.name } } }); return tx.teacher.findUniqueOrThrow({ where: { id } }); });
  }
  @Get('users') async users(@Query() query: TableQuery, @Req() req: AuthRequest) {
    requireRoles(req, ['ADMIN']);
    const where = { status: 'ACTIVE' as const, ...(query.q ? { OR: [{ nickname: { contains: query.q } }, { phone: { contains: query.q } }] } : {}) };
    const rows = await this.db.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.size, skip: (query.page - 1) * query.size, select: { id: true, nickname: true, phone: true } });
    return rows.map(({ phone, ...row }) => ({ ...row, phone: phone ? phone.slice(0, 3) + '****' + phone.slice(-4) : null }));
  }
  @Post('memberships/grant') memberGrant(@Body() dto: MemberGrantDto, @Req() req: AuthRequest) { return this.service.memberGrant(req, dto); }
  @Get('memberships/plans') plans(@Req() req: AuthRequest) { requireRoles(req, ['ADMIN']); return this.db.membershipPlan.findMany({ orderBy: [{ tier: 'asc' }, { days: 'asc' }] }); }
  @Post('memberships/plans') plan(@Body() dto: PlanDto, @Req() req: AuthRequest) { return this.service.plan(req, dto); }
  @Get('entitlements') entitlements(@Query() query: EntitlementQuery, @Req() req: AuthRequest) { return this.service.entitlements(req, query); }
  @Post('memberships/:id/revoke') revokeMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @Req() req: AuthRequest) { return this.service.revoke(req, 'membership', id, dto.reason); }
  @Post('enrollments/:id/revoke') revokeCourse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @Req() req: AuthRequest) { return this.service.revoke(req, 'course', id, dto.reason); }
}
