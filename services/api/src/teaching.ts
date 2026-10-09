import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { createHash } from 'node:crypto';
import { Database } from './database.js';
import { AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { LearningService } from './learning.js';
import type { Prisma, Role } from './generated/prisma/client.js';

type Store = Prisma.TransactionClient;
type Actor = { id: string; roles: Role[] };
class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
class StaffDto {
  @IsUUID() userId!: string;
  @IsIn(['TEACHER', 'ASSISTANT']) role!: string;
  @IsString() @Length(2, 500) reason!: string;
}
class VersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(2, 500) reason!: string;
}
class AssignmentDto {
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 10000) instructions!: string;
  @IsOptional() @IsUUID() lessonId?: string | null;
  @IsOptional() @IsDateString({ strict: true }) dueAt?: string | null;
  @IsBoolean() required!: boolean;
}
class EditAssignmentDto extends AssignmentDto { @IsInt() @Min(1) expectedVersion!: number; }
class AssignmentStateDto extends VersionDto { @IsIn(['publish', 'close']) action!: string; }
class SubmissionDto {
  @IsUUID() requestKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @Length(1, 10000) body!: string;
  @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsUUID(undefined, { each: true }) assetIds!: string[];
}
class ReviewDto extends VersionDto {
  @IsString() @Length(1, 10000) body!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number;
  @IsIn(['REVIEWED', 'RETURNED']) outcome!: string;
}

@Injectable()
export class TeachingService {
  constructor(private readonly db: Database, private readonly learning: LearningService) {}
  async staffAccess(courseId: string, actor: Actor, store: Store = this.db, lock = false) {
    if (actor.roles.includes('ADMIN')) return;
    if (!actor.roles.includes('TEACHER')) throw new ForbiddenException('无课程教学权限');
    const staff = lock
      ? await store.$queryRaw<{ id: string }[]>`SELECT id FROM "CourseStaff" WHERE "courseId"=${courseId} AND "userId"=${actor.id} AND "cohortId" IS NULL AND "revokedAt" IS NULL FOR SHARE`
      : await store.courseStaff.findMany({ where: { courseId, userId: actor.id, cohortId: null, revokedAt: null }, select: { id: true }, take: 1 });
    if (!staff.length) throw new ForbiddenException('只能处理所分配课程的作业');
  }
  async courses(actor: Actor) {
    const ids = actor.roles.includes('ADMIN') ? null : (await this.db.courseStaff.findMany({ where: { userId: actor.id, cohortId: null, revokedAt: null }, select: { courseId: true } })).map(r => r.courseId);
    if (!actor.roles.some(r => ['ADMIN', 'TEACHER'].includes(r))) throw new ForbiddenException('无教学权限');
    return this.db.course.findMany({ where: ids ? { id: { in: ids } } : {}, select: { id: true, title: true, status: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
  }
  async staff(req: AuthRequest, courseId: string, dto?: StaffDto, revokeId?: string, version?: VersionDto) {
    requireRoles(req, ['ADMIN']);
    if (!dto && !revokeId) {
      const items = await this.db.courseStaff.findMany({ where: { courseId, cohortId: null }, orderBy: { createdAt: 'desc' } });
      const users = await this.db.user.findMany({ where: { id: { in: items.map(r => r.userId) } }, select: { id: true, nickname: true, username: true } });
      return items.map(r => ({ ...r, user: users.find(u => u.id === r.userId) }));
    }
    return this.db.$transaction(async tx => {
      // Course lock serializes staff grants and revocations; staff readers lock the row until their write commits.
      const course = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Course" WHERE id=${courseId} FOR UPDATE`;
      if (!course.length) throw new NotFoundException('课程不存在');
      let row;
      if (revokeId) {
        const changed = await tx.courseStaff.updateMany({ where: { id: revokeId, courseId, version: version!.expectedVersion, revokedAt: null }, data: { revokedAt: new Date(), updatedAt: new Date(), version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('人员归属已变化，请刷新');
        row = await tx.courseStaff.findUniqueOrThrow({ where: { id: revokeId } });
      } else {
        const user = await tx.user.findUnique({ where: { id: dto!.userId } });
        if (!user || user.status !== 'ACTIVE' || !user.roles.includes('TEACHER')) throw new BadRequestException('请先为有效账号授予老师角色');
        if (await tx.courseStaff.findFirst({ where: { courseId, userId: user.id, cohortId: null, revokedAt: null } })) throw new ConflictException('该账号已有有效课程归属');
        row = await tx.courseStaff.create({ data: { courseId, userId: user.id, role: dto!.role } });
      }
      await tx.auditLog.create({ data: { actorId: req.actor.id, resource: 'course_staff', resourceId: row.id, action: revokeId ? 'teaching.staff.revoke' : 'teaching.staff.grant', reason: dto?.reason ?? version!.reason, changes: { courseId, userId: row.userId } } });
      return row;
    });
  }
  async assignments(courseId: string, actor: Actor, admin = false) {
    let releaseId: string | null = null;
    if (admin) await this.staffAccess(courseId, actor);
    else {
      const context = await this.learning.context(courseId, actor.id);
      if (context.access === 'TRIAL') throw new ForbiddenException('加入课程后可查看研习作业');
      releaseId = context.releaseId;
    }
    const lessonIds = releaseId ? (await this.db.lesson.findMany({ where: { releaseId }, select: { id: true } })).map(r => r.id) : [];
    const items = await this.db.assignment.findMany({ where: { courseId, cohortId: null, ...(admin ? {} : { state: { in: ['PUBLISHED', 'CLOSED'] }, OR: [{ lessonId: null }, { lessonId: { in: lessonIds } }] }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    if (admin) return { items };
    const submissions = await this.db.submission.findMany({ where: { assignmentId: { in: items.map(r => r.id) }, userId: actor.id }, orderBy: { revision: 'desc' } });
    const result = items.map(r => ({ ...r, submission: submissions.find(s => s.assignmentId === r.id) ?? null }));
    return { items: result, summary: { total: result.length, submitted: result.filter(r => r.submission).length, reviewed: result.filter(r => r.submission?.state === 'REVIEWED').length, required: result.filter(r => r.required).length, requiredReviewed: result.filter(r => r.required && r.submission?.state === 'REVIEWED').length } };
  }
  async saveAssignment(req: AuthRequest, courseId: string, dto: AssignmentDto | EditAssignmentDto, id?: string) {
    if (!dto.title.trim() || !dto.instructions.trim()) throw new BadRequestException('请填写作业标题及要求');
    if (dto.dueAt && new Date(dto.dueAt) <= new Date()) throw new BadRequestException('截止时间应晚于现在');
    return this.db.$transaction(async tx => {
      await this.staffAccess(courseId, req.actor, tx, true);
      const course = await tx.course.findUnique({ where: { id: courseId } });
      if (!course) throw new NotFoundException('课程不存在');
      if (dto.lessonId && !await tx.lesson.findFirst({ where: { id: dto.lessonId, releaseId: course.publishedReleaseId ?? '' } })) throw new BadRequestException('章节必须属于该课程当前发布版本');
      const data = { title: dto.title.trim(), instructions: { text: dto.instructions.trim() }, lessonId: dto.lessonId ?? null, dueAt: dto.dueAt ? new Date(dto.dueAt) : null, required: dto.required, allowedKinds: ['TEXT', 'IMAGE'] };
      let row;
      if (id) {
        const changed = await tx.assignment.updateMany({ where: { id, courseId, cohortId: null, state: 'DRAFT', version: (dto as EditAssignmentDto).expectedVersion }, data: { ...data, updatedAt: new Date(), version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('只能编辑当前版本的草稿作业');
        row = await tx.assignment.findUniqueOrThrow({ where: { id } });
      } else row = await tx.assignment.create({ data: { ...data, courseId, state: 'DRAFT' } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, resource: 'assignment', resourceId: row.id, action: id ? 'assignment.edit' : 'assignment.create', changes: { courseId, version: row.version } } });
      return row;
    });
  }
  async transition(req: AuthRequest, id: string, dto: AssignmentStateDto) {
    return this.db.$transaction(async tx => {
      const item = await tx.assignment.findUnique({ where: { id } });
      if (!item || item.cohortId) throw new NotFoundException('作业不存在');
      await this.staffAccess(item.courseId, req.actor, tx, true);
      if (dto.action === 'publish') {
        const course = await tx.course.findUnique({ where: { id: item.courseId } });
        if (course?.status !== 'PUBLISHED' || !course.publishedReleaseId || item.dueAt && item.dueAt <= new Date()) throw new BadRequestException('课程须已发布且作业未过期');
        if (item.lessonId && !await tx.lesson.findFirst({ where: { id: item.lessonId, releaseId: course.publishedReleaseId } })) throw new BadRequestException('关联章节已更新，请编辑草稿');
      }
      const changed = await tx.assignment.updateMany({ where: { id, state: dto.action === 'publish' ? 'DRAFT' : 'PUBLISHED', version: dto.expectedVersion }, data: { state: dto.action === 'publish' ? 'PUBLISHED' : 'CLOSED', updatedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('作业状态或版本已变化');
      await tx.auditLog.create({ data: { actorId: req.actor.id, resource: 'assignment', resourceId: id, action: 'assignment.' + dto.action, reason: dto.reason, changes: { previousVersion: dto.expectedVersion } } });
      return tx.assignment.findUniqueOrThrow({ where: { id } });
    });
  }
  async submit(actor: Actor, id: string, dto: SubmissionDto) {
    if (!dto.body.trim()) throw new BadRequestException('请填写研习作业内容');
    const operation = 'assignment.submit:' + id, payloadHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
      const item = await tx.assignment.findUnique({ where: { id } });
      if (!item || item.cohortId) throw new NotFoundException('作业不存在');
      const context = await this.learning.context(item.courseId, actor.id, tx);
      if (context.access === 'TRIAL') throw new ForbiddenException('课程权限不足，无法提交作业');
      if (item.lessonId && !await tx.lesson.findFirst({ where: { id: item.lessonId, releaseId: context.releaseId ?? '' } })) throw new ForbiddenException('作业不属于所学课程版本');
      const cache = await tx.idempotencyRecord.findFirst({ where: { userId: actor.id, operation, requestKey: dto.requestKey } });
      if (cache) { if (cache.payloadHash !== payloadHash) throw new ConflictException('提交标识已用于其他内容'); return cache.response; }
      const locked = await tx.$queryRaw<{ state: string; dueAt: Date | null }[]>`SELECT state,"dueAt" FROM "Assignment" WHERE id=${id} FOR SHARE`;
      if (locked[0]!.state !== 'PUBLISHED' || locked[0]!.dueAt && locked[0]!.dueAt <= new Date()) throw new BadRequestException('作业尚未发布、已关闭或已过期');
      const latest = await tx.submission.findFirst({ where: { userId: actor.id, assignmentId: id }, orderBy: { revision: 'desc' } });
      if ((latest?.revision ?? 0) !== dto.expectedRevision) throw new ConflictException('作业已有新提交，请刷新后继续');
      if (latest && latest.state !== 'RETURNED') throw new ConflictException('作业正在等待点评或已完成；退回后可再次提交');
      const assets = await tx.mediaAsset.findMany({ where: { id: { in: dto.assetIds }, uploaderId: actor.id, status: 'READY', visibility: 'PRIVATE', mime: { in: ['image/jpeg', 'image/png', 'image/webp'] } } });
      if (assets.length !== dto.assetIds.length || dto.assetIds.length && !item.allowedKinds.includes('IMAGE')) throw new BadRequestException('只能附加自己上传的有效作业图片');
      const row = await tx.submission.create({ data: { assignmentId: id, userId: actor.id, revision: dto.expectedRevision + 1, body: dto.body.trim(), state: 'SUBMITTED', submittedAt: new Date() } });
      for (const [position, assetId] of dto.assetIds.entries()) await tx.attachmentBinding.create({ data: { assetId, submissionId: row.id, position } });
      const response = JSON.parse(JSON.stringify(row));
      await tx.idempotencyRecord.create({ data: { userId: actor.id, operation, requestKey: dto.requestKey, payloadHash, state: 'DONE', responseCode: 201, response, expiresAt: new Date(Date.now() + 30 * 86400000) } });
      return response;
    });
  }
  async submissionAccess(id: string, actor: Actor, store: Store = this.db, lock = false) {
    const submission = await store.submission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('提交不存在');
    const assignment = await store.assignment.findUniqueOrThrow({ where: { id: submission.assignmentId } });
    if (assignment.cohortId) throw new ForbiddenException('营期作业须经营期流程处理');
    if (submission.userId !== actor.id) await this.staffAccess(assignment.courseId, actor, store, lock);
    return { submission, assignment };
  }
  async submission(id: string, actor: Actor) {
    const { submission, assignment } = await this.submissionAccess(id, actor);
    const [reviews, attachments, user] = await Promise.all([
      this.db.teacherReview.findMany({ where: { submissionId: id }, orderBy: { reviewedAt: 'desc' } }),
      this.db.attachmentBinding.findMany({ where: { submissionId: id }, select: { assetId: true, position: true }, orderBy: { position: 'asc' } }),
      this.db.user.findUnique({ where: { id: submission.userId }, select: { id: true, nickname: true } }),
    ]);
    return { ...submission, assignment, reviews, attachments, user };
  }
  async submissions(assignmentId: string, actor: Actor, query: PageQuery) {
    const assignment = await this.db.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.cohortId) throw new NotFoundException('作业不存在');
    await this.staffAccess(assignment.courseId, actor);
    const where = { assignmentId };
    const [rows, total] = await this.db.$transaction([this.db.submission.findMany({ where, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }), this.db.submission.count({ where })]);
    const users = await this.db.user.findMany({ where: { id: { in: rows.map(r => r.userId) } }, select: { id: true, nickname: true } });
    return { items: rows.map(r => ({ ...r, user: users.find(u => u.id === r.userId) })), total };
  }
  async review(req: AuthRequest, id: string, dto: ReviewDto) {
    if (!dto.body.trim()) throw new BadRequestException('请填写点评');
    return this.db.$transaction(async tx => {
      const { submission, assignment } = await this.submissionAccess(id, req.actor, tx, true);
      await this.staffAccess(assignment.courseId, req.actor, tx, true);
      if (submission.userId === req.actor.id) throw new ForbiddenException('不能点评自己的作业');
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${submission.userId} FOR UPDATE`;
      const latest = await tx.submission.findFirst({ where: { assignmentId: assignment.id, userId: submission.userId }, orderBy: { revision: 'desc' } });
      if (latest?.id !== id) throw new ConflictException('请点评最新提交');
      const changed = await tx.submission.updateMany({ where: { id, state: 'SUBMITTED', version: dto.expectedVersion }, data: { state: dto.outcome, updatedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('此提交已处理，请刷新');
      const review = await tx.teacherReview.create({ data: { submissionId: id, reviewerId: req.actor.id, body: dto.body.trim(), score: dto.score ?? null, state: dto.outcome, reviewedAt: new Date() } });
      await tx.notification.create({ data: { userId: submission.userId, eventKey: 'assignment.review:' + review.id, kind: 'ASSIGNMENT_REVIEW', title: dto.outcome === 'RETURNED' ? '研习作业需要补充' : '研习作业收到点评', body: assignment.title + '：' + dto.body.trim().slice(0, 200), resourceId: assignment.courseId } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, resource: 'teacher_review', resourceId: review.id, action: 'assignment.review', reason: dto.reason, changes: { submissionId: id, outcome: dto.outcome } } });
      return review;
    });
  }
  async messages(userId: string, query: PageQuery) {
    const where = { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
    const [items, total, unread] = await this.db.$transaction([this.db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }), this.db.notification.count({ where }), this.db.notification.count({ where: { ...where, readAt: null } })]);
    return { items, total, unread };
  }
  async readMessage(userId: string, id: string) {
    const changed = await this.db.notification.updateMany({ where: { id, userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { readAt: new Date(), updatedAt: new Date() } });
    if (!changed.count) throw new NotFoundException('消息不存在');
    return { success: true };
  }
}

@Controller('admin/teaching') @UseGuards(AdminGuard)
export class TeachingAdminController {
  constructor(private readonly service: TeachingService) {}
  @Get('courses') courses(@Req() req: AuthRequest) { return this.service.courses(req.actor); }
  @Get('courses/:id/staff') staff(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.service.staff(req, id); }
  @Post('courses/:id/staff') grant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffDto, @Req() req: AuthRequest) { return this.service.staff(req, id, dto); }
  @Post('courses/:id/staff/:staffId/revoke') revoke(@Param('id', ParseUUIDPipe) id: string, @Param('staffId', ParseUUIDPipe) staffId: string, @Body() dto: VersionDto, @Req() req: AuthRequest) { return this.service.staff(req, id, undefined, staffId, dto); }
  @Get('courses/:id/assignments') assignments(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.service.assignments(id, req.actor, true); }
  @Post('courses/:id/assignments') create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignmentDto, @Req() req: AuthRequest) { return this.service.saveAssignment(req, id, dto); }
  @Patch('courses/:id/assignments/:assignmentId') edit(@Param('id', ParseUUIDPipe) id: string, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: EditAssignmentDto, @Req() req: AuthRequest) { return this.service.saveAssignment(req, id, dto, assignmentId); }
  @Post('assignments/:id/transition') transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignmentStateDto, @Req() req: AuthRequest) { return this.service.transition(req, id, dto); }
  @Get('assignments/:id/submissions') submissions(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQuery, @Req() req: AuthRequest) { return this.service.submissions(id, req.actor, query); }
  @Get('submissions/:id') submission(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.service.submission(id, req.actor); }
  @Post('submissions/:id/review') review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Req() req: AuthRequest) { return this.service.review(req, id, dto); }
}
@Controller() @UseGuards(UserGuard)
export class TeachingController {
  constructor(private readonly service: TeachingService) {}
  @Get('learning/courses/:id/assignments') assignments(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.service.assignments(id, req.actor); }
  @Post('learning/assignments/:id/submissions') submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmissionDto, @Req() req: AuthRequest) { return this.service.submit(req.actor, id, dto); }
  @Get('learning/submissions/:id') submission(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.service.submission(id, req.actor); }
  @Get('me/messages') messages(@Query() query: PageQuery, @Req() req: AuthRequest) { return this.service.messages(req.actor.id, query); }
  @Post('me/messages/:id/read') read(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.service.readMessage(req.actor.id, id); }
}
