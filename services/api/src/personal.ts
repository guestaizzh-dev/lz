import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { UserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';
import { Database } from './database.js';
import { LearningService } from './learning.js';
import { OrdersService } from './orders.js';

class PageQuery {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
function paging(query: PageQuery) { return { take: query.size + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] }; }
function page<T extends { id: string }>(items: T[], size: number) { return { items: items.slice(0, size), nextCursor: items.length > size ? items[size - 1]!.id : null }; }
class NoteDto {
  @IsUUID() articleId!: string;
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,80}$/) blockId!: string;
  @IsString() @Length(1, 10000) text!: string;
}
class TextDto { @IsString() @Length(1, 10000) text!: string; }
class PracticeDto extends TextDto { @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) day!: string; }
class TagsDto {
  @IsArray() @ArrayMaxSize(8) @IsIn(['经典研习', '实践修行', '生活应用', '少儿启蒙', '名师解读', '文创', '养生交流', '线下活动'], { each: true }) tags!: string[];
}
class CloseAccountDto { @IsIn(['确认注销']) confirmation!: string; }
@Controller('me') @UseGuards(UserGuard)
export class PersonalController {
  constructor(private readonly db: Database, private readonly learning: LearningService, private readonly orders: OrdersService) {}
  @Get('notes') async notes(@Query() query: PageQuery, @Req() req: AuthRequest) {
    return page(await this.db.note.findMany({ where: { userId: req.actor.id }, ...paging(query) }), query.size);
  }
  @Post('notes') async note(@Body() body: NoteDto, @Req() req: AuthRequest) {
    const article = await this.db.article.findFirst({ where: { id: body.articleId, status: 'PUBLISHED', ...(process.env.NODE_ENV === 'production' ? { isDemo: false } : {}) } });
    if (!article) throw new NotFoundException('文章不可阅读');
    if (article.visibility === 'MEMBER') { const member = await this.learning.membership(req.actor.id); if (!member || member.tier < article.membershipTier) throw new NotFoundException('文章不可阅读'); }
    const block = (article.blocks as { id: string; text: string }[]).find(block => block.id === body.blockId);
    if (!block) throw new BadRequestException('原文段落已变化，请重新打开文章');
    return this.db.note.create({ data: { userId: req.actor.id, articleId: article.id, articleTitle: article.title, articleVersion: article.version, blockId: block.id, quote: block.text, text: body.text } });
  }
  @Patch('notes/:id') async editNote(@Param('id', ParseUUIDPipe) id: string, @Body() body: TextDto, @Req() req: AuthRequest) {
    const result = await this.db.note.updateMany({ where: { id, userId: req.actor.id }, data: { text: body.text } });
    if (result.count !== 1) throw new NotFoundException('笔记不存在');
    return this.db.note.findFirstOrThrow({ where: { id, userId: req.actor.id } });
  }
  @Delete('notes/:id') async deleteNote(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    const result = await this.db.note.deleteMany({ where: { id, userId: req.actor.id } });
    if (result.count !== 1) throw new NotFoundException('笔记不存在');
    return { success: true };
  }
  @Get('favorites') async favorites(@Query() query: PageQuery, @Req() req: AuthRequest) {
    const result = page(await this.db.favorite.findMany({ where: { userId: req.actor.id }, ...paging(query) }), query.size);
    const articles = await this.db.article.findMany({ where: { id: { in: result.items.map(row => row.articleId) }, status: 'PUBLISHED', ...(process.env.NODE_ENV === 'production' ? { isDemo: false } : {}) }, select: { id: true, title: true, summary: true, category: true, cover: true, visibility: true } });
    return { ...result, items: result.items.map(item => ({ ...item, article: articles.find(article => article.id === item.articleId) ?? null })) };
  }
  @Put('favorites/:id') async favorite(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    if (!await this.db.article.findFirst({ where: { id, status: 'PUBLISHED', ...(process.env.NODE_ENV === 'production' ? { isDemo: false } : {}) } })) throw new NotFoundException('文章不可收藏');
    return this.db.favorite.upsert({ where: { userId_articleId: { userId: req.actor.id, articleId: id } }, create: { userId: req.actor.id, articleId: id }, update: {} });
  }
  @Get('favorite-state/:id') async favoriteState(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return { favorited: !!await this.db.favorite.findUnique({ where: { userId_articleId: { userId: req.actor.id, articleId: id } }, select: { id: true } }) };
  }
  @Delete('favorites/:id') async unfavorite(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    await this.db.favorite.deleteMany({ where: { userId: req.actor.id, articleId: id } }); return { success: true };
  }
  @Get('practice') async practice(@Query() query: PageQuery, @Req() req: AuthRequest) {
    return page(await this.db.practiceLog.findMany({ where: { userId: req.actor.id }, ...paging(query) }), query.size);
  }
  @Put('practice') async record(@Body() body: PracticeDto, @Req() req: AuthRequest) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const parsed = new Date(body.day + 'T00:00:00Z');
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== body.day || body.day > today) throw new BadRequestException('请选择有效且不晚于今天的日期');
    return this.db.practiceLog.upsert({ where: { userId_day: { userId: req.actor.id, day: body.day } }, create: { userId: req.actor.id, ...body }, update: { text: body.text } });
  }
  @Delete('practice/:id') async deletePractice(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    if ((await this.db.practiceLog.deleteMany({ where: { id, userId: req.actor.id } })).count !== 1) throw new NotFoundException('日志不存在');
    return { success: true };
  }
  @Patch('tags') async tags(@Body() body: TagsDto, @Req() req: AuthRequest) {
    const tags = [...new Set(body.tags)]; await this.db.user.update({ where: { id: req.actor.id }, data: { tags } }); return { tags };
  }
  @Post('close-account') async close(@Body() _: CloseAccountDto, @Req() req: AuthRequest) {
    // Close unpaid preview reservations before removing personal data.
    const pending = await this.db.order.findMany({where:{userId:req.actor.id,status:'PENDING'},select:{id:true}});
    for(const row of pending)await this.orders.cancel(req.actor.id,row.id);
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.actor.id} FOR UPDATE`;
      if(await tx.order.count({where:{userId:req.actor.id,status:'PENDING'}}))throw new BadRequestException('订单状态已变化，请重试注销');
      // No payments exist in this phase; retain monetary snapshots and remove
      // recipient data. Future paid fulfilment requires its own resolution.
      await tx.order.updateMany({where:{userId:req.actor.id},data:{address:{redacted:true}}});
      await tx.membership.updateMany({ where: { userId: req.actor.id }, data: { revokedAt: new Date() } });
      await tx.enrollment.updateMany({ where: { userId: req.actor.id }, data: { revokedAt: new Date() } });
      await tx.studyEvent.deleteMany({ where: { userId: req.actor.id } });
      await tx.studyProgress.deleteMany({ where: { userId: req.actor.id } });
      await tx.note.deleteMany({ where: { userId: req.actor.id } });
      await tx.favorite.deleteMany({ where: { userId: req.actor.id } });
      await tx.practiceLog.deleteMany({ where: { userId: req.actor.id } });
      const homework = await tx.submission.findMany({ where: { userId: req.actor.id }, select: { id: true } });
      await tx.attachmentBinding.deleteMany({ where: { submissionId: { in: homework.map(row => row.id) } } });
      await tx.submission.updateMany({ where: { userId: req.actor.id }, data: { body: '已注销用户的作业正文已清除', updatedAt: new Date() } });
      await tx.notification.deleteMany({ where: { userId: req.actor.id } });
      await tx.idempotencyRecord.deleteMany({ where: { userId: req.actor.id, operation: { startsWith: 'assignment.submit:' } } });
      await tx.cartItem.deleteMany({ where: { userId: req.actor.id } });
      await tx.address.deleteMany({ where: { userId: req.actor.id } });
      await tx.authSession.updateMany({ where: { userId: req.actor.id }, data: { revokedAt: new Date() } });
      await tx.user.update({ where: { id: req.actor.id }, data: { phone: null, username: null, passwordHash: null, avatar: null, nickname: '已注销', tags: [], roles: ['USER'], status: 'DELETED' } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'account.close', resource: 'user', resourceId: req.actor.id, changes: { reason: 'user-requested' } } });
    });
    return { success: true };
  }
}
