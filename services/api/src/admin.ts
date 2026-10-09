import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Database } from './database.js';
import { AdminGuard, requireRoles } from './auth.js';
import type { AuthRequest } from './auth.js';
import type { PublishStatus } from './generated/prisma/client.js';

export class TableQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
  @IsOptional() @IsIn(['DRAFT', 'REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED']) status?: PublishStatus;
  @IsOptional() @IsString() @Length(0, 80) q?: string;
}
class BlockDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,80}$/) id!: string;
  @IsIn(['paragraph', 'quote']) type!: string;
  @IsString() @Length(1, 10000) text!: string;
}
class ArticleDto {
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 500) summary!: string;
  @IsIn(['经典原文', '名师解读', '实践心得', '道学常识']) category!: string;
  @IsString() @Length(1, 100) author!: string;
  @IsString() @Length(1, 500) source!: string;
  @IsString() @Matches(/^(https:\/\/[^\s]+|\/static\/art\/[a-z-]+\.svg)$/) cover!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BlockDto) blocks!: BlockDto[];
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 30, { each: true }) tags!: string[];
  @IsIn(['PUBLIC', 'MEMBER']) visibility!: 'PUBLIC' | 'MEMBER';
  @IsOptional() @IsInt() @Min(1) @Max(3) membershipTier?: number;
  @IsBoolean() featured!: boolean;
}
class ArticleEditDto extends ArticleDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class TransitionDto {
  @IsIn(['submit', 'publish', 'reject', 'archive', 'revise']) action!: string;
  @IsString() @Length(1, 500) reason!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
@Injectable()
export class AdminService {
  constructor(private readonly db: Database) {}
  async overview() {
    const [articles, courses, products, teachers, pending, published] = await Promise.all([
      this.db.article.count(), this.db.course.count(), this.db.product.count(), this.db.teacher.count(),
      this.db.article.count({ where: { status: 'REVIEW' } }), this.db.article.count({ where: { status: 'PUBLISHED' } }),
    ]);
    return { articles, courses, products, teachers, pending, published, development: process.env.NODE_ENV !== 'production' };
  }
  async articles(query: TableQuery) {
    const where = { ...(query.status ? { status: query.status } : {}), ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.article.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }),
      this.db.article.count({ where }),
    ]);
    return { items, total, page: query.page, size: query.size };
  }
  async save(req: AuthRequest, data: ArticleDto | ArticleEditDto, id?: string) {
    requireRoles(req, ['OPERATOR']);
    if (new Set(data.blocks.map(block => block.id)).size !== data.blocks.length) throw new BadRequestException('段落标识不能重复');
    const { expectedVersion: _, ...record } = data as ArticleEditDto;
    const safeData = { ...record, blocks: record.blocks.map(block => ({ ...block })) };
    return this.db.$transaction(async tx => {
      let item;
      if (id) {
        const changed = await tx.article.updateMany({ where: { id, version: (data as ArticleEditDto).expectedVersion, status: { in: ['DRAFT', 'REJECTED'] } }, data: { ...safeData, version: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException('文章状态或版本已变化，请重新打开；已发布内容需先下架修订');
        item = await tx.article.findUniqueOrThrow({ where: { id } });
      } else item = await tx.article.create({ data: { ...safeData, status: 'DRAFT' } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: id ? 'article.edit' : 'article.create', resource: 'article', resourceId: item.id, changes: { version: item.version, title: item.title } } });
      return item;
    });
  }
  async transition(req: AuthRequest, id: string, dto: TransitionDto) {
    requireRoles(req, dto.action === 'publish' || dto.action === 'reject' ? ['MODERATOR'] : ['OPERATOR']);
    const states: Record<string, { from: PublishStatus[]; to: PublishStatus }> = {
      submit: { from: ['DRAFT', 'REJECTED'], to: 'REVIEW' }, publish: { from: ['REVIEW'], to: 'PUBLISHED' },
      reject: { from: ['REVIEW'], to: 'REJECTED' }, archive: { from: ['PUBLISHED'], to: 'ARCHIVED' },
      revise: { from: ['ARCHIVED', 'REJECTED'], to: 'DRAFT' },
    };
    const state = states[dto.action]!;
    return this.db.$transaction(async tx => {
      const changed = await tx.article.updateMany({ where: { id, version: dto.expectedVersion, status: { in: state.from } }, data: { status: state.to, version: { increment: 1 }, ...(state.to === 'PUBLISHED' ? { publishedAt: new Date() } : {}) } });
      if (changed.count !== 1) throw new ConflictException('状态已变化或操作不适用于当前文章，请刷新列表');
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: `article.${dto.action}`, resource: 'article', resourceId: id, changes: { status: state.to, reason: dto.reason, previousVersion: dto.expectedVersion } } });
      return tx.article.findUniqueOrThrow({ where: { id } });
    });
  }
}
@Controller('admin') @UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly db: Database) {}
  @Get('overview') overview(@Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.admin.overview(); }
  @Get('articles') articles(@Query() query: TableQuery, @Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.admin.articles(query); }
  @Post('articles') save(@Body() body: ArticleDto, @Req() req: AuthRequest) { return this.admin.save(req, body); }
  @Patch('articles/:id') edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: ArticleEditDto, @Req() req: AuthRequest) { return this.admin.save(req, body, id); }
  @Post('articles/:id/transition') transition(@Param('id', ParseUUIDPipe) id: string, @Body() body: TransitionDto, @Req() req: AuthRequest) { return this.admin.transition(req, id, body); }
  @Get('articles/:id/audit') async audit(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR', 'MODERATOR']);
    if (!await this.db.article.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('文章不存在');
    return this.db.auditLog.findMany({ where: { resource: 'article', resourceId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
