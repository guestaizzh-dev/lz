import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsUUID, Max, Min } from 'class-validator';
import { createHash } from 'node:crypto';
import { Database } from './database.js';
import { OptionalUserGuard, UserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';

class ProgressDto {
  @IsUUID() eventId!: string;
  @IsInt() @Min(0) @Max(86400) positionSeconds!: number;
  @IsInt() @Min(0) @Max(30) elapsedSeconds!: number;
  @IsBoolean() completed!: boolean;
}
type AccessStore = Pick<Database, 'course' | 'enrollment' | 'membership'>;
@Injectable()
export class LearningService {
  constructor(private readonly db: Database) {}
  plans() { return this.db.membershipPlan.findMany({ where: { active: true }, orderBy: [{ tier: 'asc' }, { days: 'asc' }] }); }
  async membership(userId?: string, store: AccessStore = this.db) {
    if (!userId) return null;
    const now = new Date();
    return store.membership.findFirst({ where: { userId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { tier: 'desc' }, include: { plan: true } });
  }
  async context(courseId: string, userId?: string, store: AccessStore = this.db) {
    const course = await store.course.findUnique({ where: { id: courseId }, include: { teacher: true } });
    if (!course || (process.env.NODE_ENV === 'production' && (course.isDemo || course.teacher.isDemo))) throw new NotFoundException('课程不存在');
    const now = new Date();
    const enrollment = userId ? await store.enrollment.findFirst({ where: { courseId, userId, startsAt: { lte: now }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }) : null;
    const publicCourse = course.status === 'PUBLISHED' && course.teacher.status === 'PUBLISHED';
    if (!publicCourse && !enrollment) throw new NotFoundException('课程不存在或已下架');
    const member = publicCourse && course.membershipTier ? await this.membership(userId, store) : null;
    const memberAccess = !!member && member.tier >= (course.membershipTier ?? 4);
    return { course, releaseId: enrollment?.releaseId ?? course.publishedReleaseId, access: enrollment ? 'ENROLLED' : memberAccess ? 'MEMBER' : 'TRIAL', enrollment, publicCourse };
  }
  async curriculum(id: string, userId?: string) {
    const context = await this.context(id, userId);
    const release = context.releaseId ? await this.db.courseRelease.findFirst({ where: { id: context.releaseId, courseId: id }, include: { lessons: { orderBy: { position: 'asc' }, include: { progress: { where: { userId: userId ?? '' } } } } } }) : null;
    return { course: { id, title: release?.title ?? context.course.title, cover: context.course.cover, refundPolicy: context.course.refundPolicy, accessDays: context.course.accessDays }, access: context.access, releaseId: release?.id ?? null, lessons: release?.lessons.map(({ body: _, mediaId: __, sourceId: ___, progress, ...lesson }) => ({ ...lesson, accessible: context.access !== 'TRIAL' || (context.publicCourse && lesson.trial), progress: progress[0] ?? null })) ?? [] };
  }
  async lesson(id: string, userId?: string) {
    const lesson = await this.db.lesson.findUnique({ where: { id }, include: { release: true } });
    if (!lesson) throw new NotFoundException('章节不存在');
    const context = await this.context(lesson.release.courseId, userId);
    if (context.releaseId !== lesson.releaseId || (context.access === 'TRIAL' && (!context.publicCourse || !lesson.trial))) throw new ForbiddenException('请先获得课程权限，或选择试听章节');
    const progress = userId ? await this.db.studyProgress.findUnique({ where: { userId_lessonId: { userId, lessonId: id } } }) : null;
    return { lesson, context, progress };
  }
  async enroll(id: string, userId: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} AND status = 'ACTIVE' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${id} FOR SHARE`;
      const { course, releaseId, publicCourse } = await this.context(id, userId, tx);
      if (!publicCourse || course.price !== 0 || !releaseId) throw new BadRequestException('该课程需要购买或尚未发布章节');
      const existing = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId: id } } });
      if (existing) {
        if (existing.revokedAt || (existing.expiresAt && existing.expiresAt <= new Date())) throw new ForbiddenException('课程权限已撤销或到期，请联系书院');
        return existing;
      }
      return tx.enrollment.create({ data: { userId, courseId: id, releaseId, source: 'FREE', expiresAt: course.accessDays ? new Date(Date.now() + course.accessDays * 86400000) : null } });
    });
  }
  async library(userId: string) {
    const member = await this.membership(userId);
    const enrolled = await this.db.enrollment.findMany({ where: { userId, startsAt: { lte: new Date() }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { course: { include: { teacher: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    const memberCourses = member ? await this.db.course.findMany({ where: { status: 'PUBLISHED', teacher: { status: 'PUBLISHED', ...(process.env.NODE_ENV === 'production' ? { isDemo: false } : {}) }, membershipTier: { lte: member.tier }, ...(process.env.NODE_ENV === 'production' ? { isDemo: false } : {}) }, include: { teacher: true }, take: 100 }) : [];
    const courses = [...enrolled.map(row => row.course), ...memberCourses.filter(row => !enrolled.some(e => e.courseId === row.id))];
    return { items: await Promise.all(courses.filter(row => process.env.NODE_ENV !== 'production' || (!row.isDemo && !row.teacher.isDemo)).map(async course => ({ ...(await this.curriculum(course.id, userId)), catalog: course }))) };
  }
  async progress(id: string, userId: string, dto: ProgressDto) {
    const { lesson } = await this.lesson(id, userId);
    const payloadHash = createHash('sha256').update(JSON.stringify({ id, ...dto })).digest('hex');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const context = await this.context(lesson.release.courseId, userId, tx);
      if (context.releaseId !== lesson.releaseId || (context.access === 'TRIAL' && (!context.publicCourse || !lesson.trial))) throw new ForbiddenException('课程权限已变化，请重新打开章节');
      const event = await tx.studyEvent.findUnique({ where: { id: dto.eventId } });
      if (event) {
        if (event.userId !== userId || event.payloadHash !== payloadHash) throw new ConflictException('学习事件标识已用于其他操作');
        return event.result;
      }
      const old = await tx.studyProgress.findUnique({ where: { userId_lessonId: { userId, lessonId: id } } });
      const elapsed = Math.min(dto.elapsedSeconds, old ? Math.max(0, Math.floor((Date.now() - old.updatedAt.getTime()) / 1000)) : 0);
      const watchedSeconds = Math.min(lesson.durationSeconds, (old?.watchedSeconds ?? 0) + elapsed);
      const complete = lesson.format === 'TEXT' ? dto.completed : lesson.durationSeconds > 0 && watchedSeconds >= lesson.durationSeconds * 0.9;
      const data = { positionSeconds: Math.min(dto.positionSeconds, lesson.durationSeconds), watchedSeconds, completedAt: old?.completedAt ?? (complete ? new Date() : null) };
      const progress = await tx.studyProgress.upsert({ where: { userId_lessonId: { userId, lessonId: id } }, create: { userId, lessonId: id, ...data }, update: data });
      const result = JSON.parse(JSON.stringify(progress));
      await tx.studyEvent.create({ data: { id: dto.eventId, userId, lessonId: id, payloadHash, result } });
      return result;
    });
  }
}
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningService) {}
  @Get('courses/:id') @UseGuards(OptionalUserGuard) curriculum(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.learning.curriculum(id, req.actor?.id); }
  @Get('lessons/:id') @UseGuards(OptionalUserGuard) async lesson(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    const { lesson, progress } = await this.learning.lesson(id, req.actor?.id);
    const { mediaId: _, sourceId: __, release: ___, ...safe } = lesson;
    return { ...safe, hasMedia: !!lesson.mediaId, progress };
  }
  @Post('courses/:id/enroll') @UseGuards(UserGuard) enroll(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.learning.enroll(id, req.actor.id); }
  @Get('library') @UseGuards(UserGuard) library(@Req() req: AuthRequest) { return this.learning.library(req.actor.id); }
  @Post('lessons/:id/progress') @UseGuards(UserGuard) progress(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProgressDto, @Req() req: AuthRequest) { return this.learning.progress(id, req.actor.id, dto); }
  @Get('membership') @UseGuards(UserGuard) membership(@Req() req: AuthRequest) { return this.learning.membership(req.actor.id); }
  @Get('plans') plans() { return this.learning.plans(); }
}
