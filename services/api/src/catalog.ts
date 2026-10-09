import { Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { OptionalUserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';
import { LearningService } from './learning.js';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { CourseFormat } from './generated/prisma/client.js';
import { Database } from './database.js';
import { publicSku } from './shopping.js';

const articlePreview = {
  id: true, title: true, summary: true, category: true, author: true, source: true,
  cover: true, tags: true, visibility: true, isDemo: true, publishedAt: true,
} as const;

const teacherPreview = { id: true, name: true, title: true, bio: true, portrait: true, expertise: true, isDemo: true } as const;
class CatalogQuery {
  @IsOptional() @IsString() @Length(1, 40) category?: string;
  @IsOptional() @IsString() @Length(0, 80) q?: string;
  @IsOptional() @IsIn(['VIDEO','AUDIO','LIVE','COHORT','OFFLINE']) format?: CourseFormat;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
function page<T extends { id: string }>(items: T[], size: number) {
  return { items: items.slice(0, size), nextCursor: items.length > size ? items[size - 1]!.id : null };
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: Database, private readonly learning: LearningService) {}
  private get publicScope() {
    return { status: 'PUBLISHED' as const, ...(process.env.NODE_ENV === 'production' ? { isDemo: false } : {}) };
  }
  private scope(query: CatalogQuery) {
    return { ...this.publicScope, ...(query.category ? { category: query.category } : {}), ...(query.q?.trim() ? { title: { contains: query.q.trim(), mode: 'insensitive' as const } } : {}) };
  }
  private pagination(query: CatalogQuery) {
    return { take: query.size + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] };
  }
  async home() {
    const [articles, courses, products, events] = await Promise.all([
      this.db.article.findMany({ where: this.publicScope, select: articlePreview, orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }], take: 4 }),
      this.db.course.findMany({ where: { ...this.publicScope, teacher: this.publicScope }, include: { teacher: { select: teacherPreview } }, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: 4 }),
      this.db.product.findMany({ where: this.publicScope, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: 6 }),
      this.db.event.findMany({ where: this.publicScope, orderBy: { startsAt: 'asc' }, take: 3 }),
    ]);
    return { articles, courses, products, events, development: process.env.NODE_ENV !== 'production' };
  }
  async articles(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.article.findMany({ where: this.scope(query), select: articlePreview, ...this.pagination(query) }), query.size);
  }
  async article(id: string, userId?: string) {
    const item = await this.db.article.findFirst({ where: { ...this.publicScope, id } });
    if (!item) throw new NotFoundException('文章不存在或已下架');
    const member = item.visibility === 'MEMBER' ? await this.learning.membership(userId) : null;
    if (item.visibility === 'MEMBER' && (!member || member.tier < item.membershipTier)) {
      const { blocks: _, ...preview } = item;
      return { ...preview, blocks: [], access: 'MEMBERSHIP_REQUIRED' };
    }
    return { ...item, access: item.visibility === 'MEMBER' ? 'MEMBER' : 'PUBLIC' };
  }
  async courses(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.course.findMany({ where: { ...this.scope(query), teacher: this.publicScope, ...(query.format ? { format: query.format } : {}), ...(query.teacherId ? { teacherId: query.teacherId } : {}) }, include: { teacher: { select: teacherPreview } }, ...this.pagination(query) }), query.size);
  }
  async course(id: string) {
    const item = await this.db.course.findFirst({ where: { ...this.publicScope, id, teacher: this.publicScope }, include: { teacher: { select: teacherPreview } } });
    if (!item) throw new NotFoundException('课程不存在或已下架');
    return item;
  }
  async teachers(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.teacher.findMany({ where: { ...this.publicScope, ...(query.q?.trim() ? { name: { contains: query.q.trim(), mode: 'insensitive' as const } } : {}) }, select: teacherPreview, ...this.pagination(query) }), query.size);
  }
  async teacher(id: string) {
    const item = await this.db.teacher.findFirst({ where: { ...this.publicScope, id }, select: teacherPreview });
    if (!item) throw new NotFoundException('名师不存在或已下架');
    return item;
  }
  async events(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.event.findMany({ where: this.scope(query), ...this.pagination(query) }), query.size);
  }
  async event(id: string) {
    const item = await this.db.event.findFirst({ where: { ...this.publicScope, id } });
    if (!item) throw new NotFoundException('活动不存在或已下架');
    return item;
  }
  async products(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.product.findMany({ where: this.scope(query), ...this.pagination(query) }), query.size);
  }
  async product(id: string) {
    const item = await this.db.product.findFirst({ where: { ...this.publicScope, id }, include: { skus: { where: { active: true }, orderBy: [{ price: 'asc' }, { id: 'asc' }] } } });
    if (!item) throw new NotFoundException('商品不存在或已下架');
    return { ...item, skus: item.skus.map(publicSku), checkoutEnabled: false };
  }
}

@ApiTags('公开内容')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('home') home() { return this.catalog.home(); }
  @Get('articles') articles(@Query() query: CatalogQuery) { return this.catalog.articles(query); }
  @Get('articles/:id') @UseGuards(OptionalUserGuard) article(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.catalog.article(id, req.actor?.id); }
  @Get('courses') courses(@Query() query: CatalogQuery) { return this.catalog.courses(query); }
  @Get('courses/:id') course(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.course(id); }
  @Get('teachers') teachers(@Query() query: CatalogQuery) { return this.catalog.teachers(query); }
  @Get('teachers/:id') teacher(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.teacher(id); }
  @Get('events') events(@Query() query: CatalogQuery) { return this.catalog.events(query); }
  @Get('events/:id') event(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.event(id); }
  @Get('products') products(@Query() query: CatalogQuery) { return this.catalog.products(query); }
  @Get('products/:id') product(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.product(id); }
}
