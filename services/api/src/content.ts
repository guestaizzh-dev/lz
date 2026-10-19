import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { AdminGuard, OptionalUserGuard, requireRoles, UserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';
import { CatalogService } from './catalog.js';
import { Database } from './database.js';
import { Prisma } from './generated/prisma/client.js';

class ReactionDto { @IsIn(['LIKE']) kind!: string; }
class ReadingDto {
  @IsOptional() @IsString() @Length(1, 100) eventKey?: string;
  @IsInt() @Min(0) @Max(86400) dwellSeconds!: number;
}
class QuoteRangeDto {
  @IsString() @Length(1, 80) blockId!: string;
  @IsInt() @Min(0) rangeStart!: number;
  @IsInt() @Min(1) rangeEnd!: number;
}
class CommentDto {
  @IsString() @Length(1, 5000) body!: string;
  @IsOptional() @IsString() @Length(1, 80) quotedBlockId?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsInt() @Min(1) articleVersion?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>QuoteRangeDto) quotedRanges?: QuoteRangeDto[];
}
class ReportDto {
  @IsIn(['SPAM', 'INAPPROPRIATE', 'MISLEADING', 'COPYRIGHT', 'OTHER']) reason!: string;
  @IsString() @Length(0, 1000) description!: string;
  @IsOptional() @IsUUID() commentId?: string;
}
class PageQuery {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
class ReviewDto {
  @IsIn(['APPROVED', 'REJECTED']) state!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(1, 500) reason!: string;
}

@Injectable()
export class ContentService {
  constructor(private readonly db: Database, private readonly catalog: CatalogService) {}
  async readable(id: string, userId?: string) {
    const article = await this.catalog.article(id, userId);
    if (article.access === 'MEMBERSHIP_REQUIRED') throw new ForbiddenException('当前会员权益不能阅读该文章');
    return article;
  }
  async reactionState(id: string, userId?: string) {
    await this.catalog.article(id, userId);
    const [reaction, count] = await Promise.all([
      userId ? this.db.reaction.findFirst({ where: { userId, resourceId: id, kind: 'LIKE' } }) : null,
      this.db.reaction.count({ where: { resourceId: id, kind: 'LIKE' } }),
    ]);
    return { liked: !!reaction, count };
  }
  async like(id: string, userId: string) {
    await this.readable(id, userId);
    await this.db.$executeRaw`INSERT INTO "Reaction" ("userId", "resourceId", kind) VALUES (${userId}, ${id}, 'LIKE') ON CONFLICT ("userId", "resourceId", kind) DO NOTHING`;
    return this.reactionState(id, userId);
  }
  async unlike(id: string, userId: string) {
    await this.db.reaction.deleteMany({ where: { userId, resourceId: id, kind: 'LIKE' } });
    return { liked: false };
  }
  async reading(id: string, userId: string, dto: ReadingDto) {
    await this.readable(id, userId);
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    // Server-owned key prevents callers from retrieving another reader's event.
    const eventKey = createHash('sha256').update(`${userId}:${id}:${day}:${dto.eventKey ?? randomUUID()}`).digest('hex');
    const rows = await this.db.$queryRaw<{ id: string; businessDay: Date }[]>`INSERT INTO "ReadingEvent" ("userId","resourceId","eventKey","businessDay","dwellSeconds")
      VALUES (${userId},${id},${eventKey},${new Date(day + 'T00:00:00Z')},${dto.dwellSeconds})
      ON CONFLICT ("eventKey") DO UPDATE SET "dwellSeconds"=GREATEST("ReadingEvent"."dwellSeconds",EXCLUDED."dwellSeconds") RETURNING id,"businessDay"`;
    return rows[0];
  }
  async report(id: string, userId: string, dto: ReportDto) {
    await this.catalog.article(id, userId);
    if (dto.commentId && !await this.db.comment.findFirst({ where: { id: dto.commentId, resourceId: id, reviewState: 'APPROVED', deletedAt: null } })) throw new NotFoundException('评论不存在');
    return this.db.report.create({ data: { reporterId: userId, resourceId: dto.commentId ? null : id, commentId: dto.commentId, reasonCode: dto.reason, description: dto.description, state: 'PENDING' }, select: { id: true, state: true } });
  }
  async createComment(id: string, userId: string, dto: CommentDto) {
    const article = await this.readable(id, userId);
    if (!dto.body.trim()) throw new BadRequestException('评论不能为空');
    const now = new Date();
    if (await this.db.userRestriction.findFirst({ where: { userId, revokedAt: null, startsAt: { lte: now }, AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, { OR: [{ resourceId: null }, { resourceId: id }] }], scope: { in: ['ALL', 'COMMENT', 'POST'] } } })) throw new ForbiddenException('当前账号暂不能评论');
    if(dto.parentId){
      const parent=await this.db.comment.findFirst({where:{id:dto.parentId,resourceId:id,parentId:null,reviewState:'APPROVED',deletedAt:null}});
      if(!parent)throw new BadRequestException('回复的评论不可用');
      if(await this.db.userBlock.findFirst({where:{OR:[{userId,blockedId:parent.authorId},{userId:parent.authorId,blockedId:userId}]}}))throw new ForbiddenException('已拉黑的用户之间不能直接互动');
    }
    let quoteBlockId: string | undefined, quoteSnapshot: string | undefined;
    if (dto.quotedBlockId) {
      const block = (article.blocks as { id: string; type: string; text?: string }[]).find(b => b.id === dto.quotedBlockId && b.type !== 'image');
      if (!block?.text) throw new BadRequestException('引用段落已变化，请重新打开文章');
      quoteSnapshot = block.text;
      if (dto.quotedRanges) {
        if (dto.articleVersion !== article.version) throw new ConflictException('文章已更新，请重新选取引用');
        const blocks = article.blocks as {id:string;type:string;text?:string}[];
        let position = -1;
        const quotes: string[] = [];
        for (const range of dto.quotedRanges) {
          const next = blocks.findIndex(b=>b.id===range.blockId), source=blocks[next];
          if (!source?.text || source.type==='image' || next<=position || range.rangeEnd<=range.rangeStart || range.rangeEnd>source.text.length || /[\uDC00-\uDFFF]/.test(source.text[range.rangeStart]??'') || /[\uDC00-\uDFFF]/.test(source.text[range.rangeEnd]??'')) throw new BadRequestException('引用范围无效');
          quotes.push(source.text.slice(range.rangeStart,range.rangeEnd));position=next;
        }
        if (dto.quotedRanges[0]!.blockId !== dto.quotedBlockId) throw new BadRequestException('引用起始段落不一致');
        quoteSnapshot=quotes.join('\n\n');
      }
      if (article.currentReleaseId) quoteBlockId = (await this.db.articleBlock.findFirst({ where: { releaseId: article.currentReleaseId, stableKey: block.id } }))?.id;
    }
    if (dto.quotedRanges && !dto.quotedBlockId) throw new BadRequestException('请选择引用原文');
    return this.db.comment.create({ data: { resourceId: id, authorId: userId, parentId: dto.parentId, body: dto.body.trim(), quoteBlockId, quoteSnapshot, reviewState: 'PENDING' } });
  }
  async comments(id: string, userId: string | undefined, query: PageQuery) {
    await this.readable(id, userId);
    if (query.parentId && !await this.db.comment.findFirst({ where: { id: query.parentId, resourceId: id, parentId: null, reviewState: 'APPROVED', deletedAt: null } })) throw new NotFoundException('评论不可用');
    const blocked = userId ? await this.db.userBlock.findMany({ where: { userId }, select: { blockedId: true } }) : [];
    const visible = { resourceId: id, reviewState: 'APPROVED', deletedAt: null, authorId: { notIn: blocked.map(b => b.blockedId) } };
    if (query.cursor && !await this.db.comment.findFirst({ where: { ...visible, id: query.cursor, parentId: query.parentId ?? null } })) throw new BadRequestException('分页位置不可用');
    const rows = await this.db.comment.findMany({ where: { ...visible, parentId: query.parentId ?? null }, take: query.size + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
    const items = rows.slice(0, query.size);
    const replies = query.parentId || !items.length ? [] : await this.db.$queryRaw<(typeof rows[number] & { replyCount: number })[]>(Prisma.sql`SELECT * FROM (
      SELECT c.*,count(*) OVER (PARTITION BY "parentId")::int AS "replyCount",row_number() OVER (PARTITION BY "parentId" ORDER BY "createdAt",id) AS position
      FROM "Comment" c WHERE "resourceId"=${id} AND "parentId" IN (${Prisma.join(items.map(c => c.id))}) AND "reviewState"='APPROVED' AND "deletedAt" IS NULL
      ${blocked.length ? Prisma.sql`AND "authorId" NOT IN (${Prisma.join(blocked.map(b => b.blockedId))})` : Prisma.empty}
    ) ranked WHERE position<=3`);
    const authors = await this.db.user.findMany({ where: { id: { in: [...new Set([...items, ...replies].map(c => c.authorId))] } }, select: { id: true, nickname: true, avatar: true } });
    const withAuthor = (c: typeof rows[number]) => ({ id: c.id, body: c.body, parentId: c.parentId, quoteSnapshot: c.quoteSnapshot, createdAt: c.createdAt, author: authors.find(a => a.id === c.authorId) });
    return { items: items.map(c => ({ ...withAuthor(c), replies: replies.filter(r => r.parentId === c.id).map(withAuthor), replyCount: replies.find(r => r.parentId === c.id)?.replyCount ?? 0 })), nextCursor: rows.length > query.size ? items.at(-1)!.id : null };
  }
  async moderate(id: string, req: AuthRequest, dto: ReviewDto) {
    requireRoles(req, ['MODERATOR']);
    return this.db.$transaction(async tx => {
      const comment=await tx.comment.findUnique({where:{id},select:{resourceId:true}});
      if(!comment||!await tx.article.findUnique({where:{id:comment.resourceId},select:{id:true}}))throw new NotFoundException('文章评论不存在，请在所属业务模块处理');
      const result = await tx.comment.updateMany({ where: { id, reviewState: 'PENDING', deletedAt: null, version: dto.expectedVersion }, data: { reviewState: dto.state, version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('评论已处理或版本已变化');
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'comment.review', resource: 'comment', resourceId: id, changes: { state: dto.state, reason: dto.reason } } });
      return tx.comment.findUniqueOrThrow({ where: { id } });
    });
  }
}

@Controller('articles/:id')
@UseGuards(OptionalUserGuard)
export class ArticleInteractionController {
  constructor(private readonly content: ContentService, private readonly db: Database) {}
  @Post('reactions') @UseGuards(UserGuard) like(@Param('id', ParseUUIDPipe) id: string, @Body() _: ReactionDto, @Req() req: AuthRequest) { return this.content.like(id, req.actor.id); }
  @Delete('reactions/:kind') @UseGuards(UserGuard) unlike(@Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Req() req: AuthRequest) { if (kind !== 'LIKE') throw new BadRequestException('反应类型无效'); return this.content.unlike(id, req.actor.id); }
  @Get('reaction-state') state(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.content.reactionState(id, req.actor?.id); }
  @Post('reading-events') @UseGuards(UserGuard) reading(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReadingDto, @Req() req: AuthRequest) { return this.content.reading(id, req.actor.id, dto); }
  @Post('reports') @UseGuards(UserGuard) report(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportDto, @Req() req: AuthRequest) { return this.content.report(id, req.actor.id, dto); }
  @Get('comments') comments(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQuery, @Req() req: AuthRequest) { return this.content.comments(id, req.actor?.id, query); }
  @Get('comments/mine') @UseGuards(UserGuard) async mine(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    await this.content.readable(id, req.actor.id);
    return this.db.comment.findMany({ where: { resourceId: id, authorId: req.actor.id, reviewState: { in: ['PENDING', 'REJECTED'] }, deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, body: true, reviewState: true, createdAt: true, parentId: true } });
  }
  @Delete('comments/:commentId') @UseGuards(UserGuard) async removeComment(@Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string, @Req() req: AuthRequest) {
    if ((await this.db.comment.updateMany({ where: { id: commentId, resourceId: id, authorId: req.actor.id, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } })).count !== 1) throw new NotFoundException('评论不存在');
    return { success: true };
  }
  @Post('comments') @UseGuards(UserGuard) comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto, @Req() req: AuthRequest) { return this.content.createComment(id, req.actor.id, dto); }
}

@Controller('admin/comments') @UseGuards(AdminGuard)
export class CommentAdminController {
  constructor(private readonly db: Database, private readonly content: ContentService) {}
  @Get() async list(@Query() query: PageQuery, @Req() req: AuthRequest) {
    requireRoles(req, ['MODERATOR']);
    const items=await this.db.$queryRaw<Prisma.CommentGetPayload<{}>[]>(Prisma.sql`SELECT c.* FROM "Comment" c JOIN "Article" a ON a.id=c."resourceId" WHERE c."reviewState"='PENDING' AND c."deletedAt" IS NULL ${query.cursor?Prisma.sql`AND (c."createdAt",c.id)<(SELECT "createdAt",id FROM "Comment" WHERE id=${query.cursor})`:Prisma.empty} ORDER BY c."createdAt" DESC,c.id DESC LIMIT ${query.size+1}`);
    return { items: items.slice(0, query.size), nextCursor: items.length > query.size ? items[query.size - 1]!.id : null };
  }
  @Post(':id/review') review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Req() req: AuthRequest) { return this.content.moderate(id, req, dto); }
}
