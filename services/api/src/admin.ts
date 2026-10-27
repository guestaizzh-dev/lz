import {Categories,validateCategory} from './categories.js';
import {imageUrlPattern} from './image-url.js';
import { validateEvidencePublication } from './evidence.js';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { validateArticleMedia } from './article-media.js';
import { Database } from './database.js';
import { AdminGuard, requireRoles } from './auth.js';
import type { AuthRequest } from './auth.js';
import type { PublishStatus } from './generated/prisma/client.js';

export class TableQuery {
  @IsOptional() @IsString() @Length(1,40) category?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
  @IsOptional() @IsIn(['DRAFT', 'REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED']) status?: PublishStatus;
  @IsOptional() @IsString() @Length(0, 80) q?: string;
}
class BlockDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,80}$/) id!: string;
  @IsIn(['paragraph', 'quote', 'image', 'audio', 'video']) type!: string;
  @IsString() @Length(0, 10000) text!: string;
  @IsOptional() @IsString() @Matches(imageUrlPattern,{message:'请上传有效的图片'}) url?: string;
  @IsOptional() @IsString() @Length(0, 500) caption?: string;
  @IsOptional() @IsUUID() mediaId?: string;
}
class ArticleDto {
  @IsOptional() @IsIn(['PLAIN','CLASSIC','INK']) draftTemplateCode?:string;
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 500) summary!: string;
  @IsString() @Length(1, 40) category!: string;
  @IsString() @Length(1, 100) author!: string;
  @IsString() @Length(1, 500) source!: string;
  @IsString() @Matches(imageUrlPattern,{message:'请上传有效的图片'}) cover!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BlockDto) blocks!: BlockDto[];
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 30, { each: true }) tags!: string[];
  @IsIn(['PUBLIC', 'MEMBER']) visibility!: 'PUBLIC' | 'MEMBER';
  @IsOptional() @IsInt() @Min(1) @Max(4) membershipTier?: number;
  @IsBoolean() featured!: boolean;
}
class ArticleEditDto extends ArticleDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class TransitionDto {
  @IsIn(['submit', 'publish', 'reject', 'archive', 'revise']) action!: string;
  @IsOptional() @IsString() @Length(1, 500) reason: string = '管理员操作';
  @IsInt() @Min(1) expectedVersion!: number;
}
@Injectable()
export class AdminService {
  constructor(private readonly db: Database) {}
  async overview(req: AuthRequest) {
    const can=(code:string)=>req.permissions?.includes(code)??false;
    const [articles,courses,products,teachers,pending,published,publishedCourses,learners,pendingThreads,pendingComments,feedbackOpen,activity,events,refunds,deadJobs,finance] = await Promise.all([
      can('content.read')?this.db.article.count():null,
      can('courses.read')?this.db.course.count():null,
      can('products.read')?this.db.product.count():null,
      can('courses.read')?this.db.teacher.count():null,
      can('content.review')?this.db.article.count({where:{status:'REVIEW'}}):null,
      can('content.read')?this.db.article.count({where:{status:'PUBLISHED'}}):null,
      can('courses.read')?this.db.course.count({where:{status:'PUBLISHED'}}):null,
      can('courses.read')?this.db.$queryRaw<{total:number}[]>`SELECT count(DISTINCT "userId")::int AS total FROM "StudyProgress"`:[],
      can('community.review')?this.db.resource.count({where:{kind:'THREAD',publishState:'REVIEW'}}):null,
      can('content.review')?this.db.$queryRaw<{total:number}[]>`SELECT count(*)::int AS total FROM "Comment" c JOIN "Resource" r ON r.id=c."resourceId" WHERE r.kind='ARTICLE' AND c."reviewState"='PENDING' AND c."deletedAt" IS NULL`:null,
      can('support.read')?this.db.feedback.count({where:{state:{in:['OPEN','PROCESSING']}}}):null,
      can('content.read')?this.db.$queryRaw<{day:string;readers:number;checkins:number}[]>`WITH days AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date-29,(now() AT TIME ZONE 'Asia/Shanghai')::date,'1 day')::date AS day), reading AS (SELECT "businessDay" AS day,count(DISTINCT "userId")::int AS readers FROM "ReadingEvent" WHERE "businessDay">=(now() AT TIME ZONE 'Asia/Shanghai')::date-29 GROUP BY "businessDay"), practice AS (SELECT "businessDay" AS day,count(DISTINCT "userId")::int AS checkins FROM "PracticeCheckin" WHERE state='VALID' AND "businessDay">=(now() AT TIME ZONE 'Asia/Shanghai')::date-29 GROUP BY "businessDay") SELECT to_char(d.day,'YYYY-MM-DD') AS day,COALESCE(r.readers,0)::int AS readers,COALESCE(p.checkins,0)::int AS checkins FROM days d LEFT JOIN reading r ON r.day=d.day LEFT JOIN practice p ON p.day=d.day ORDER BY d.day`:[],
      can('events.review')?this.db.event.count({where:{status:'REVIEW'}}):null,
      can('finance.refund')?this.db.$queryRaw<{courses:number;memberships:number;products:number;bookings:number}[]>`SELECT count(*) FILTER(WHERE o.kind='COURSE')::int AS courses,count(*) FILTER(WHERE o.kind='MEMBERSHIP')::int AS memberships,count(*) FILTER(WHERE o.kind='PHYSICAL')::int AS products,count(*) FILTER(WHERE o.kind IN ('CONSULTATION','EVENT'))::int AS bookings FROM "Refund" r JOIN "TradeOrder" o ON o.id=r."orderId" WHERE r.state IN ('REQUESTED','REVIEW','FAILED')`:null,
      can('audit.read')?this.db.outboxJob.count({where:{state:'DEAD'}}):null,
      can('orders.read')&&req.actor.roles.some(role=>role==='ADMIN'||role==='FINANCE')?this.financialOverview():null,
    ]);
    const tasks=[
      {title:'文章审核',count:pending,path:'/content/articles'},
      {title:'社区帖子审核',count:pendingThreads,path:'/forum'},
      {title:'文章评论审核',count:pendingComments?.[0]?.total??null,path:'/content/comments'},
      {title:'活动审核',count:events,path:'/events'},
      {title:'待处理客服反馈',count:feedbackOpen,path:'/feedback'},
      {title:'课程退款审核与失败处理',count:refunds?.[0]?.courses??null,path:'/course-orders'},
      {title:'会员退款审核与失败处理',count:refunds?.[0]?.memberships??null,path:'/membership-orders'},
      {title:'预约活动退款审核与失败处理',count:refunds?.[0]?.bookings??null,path:'/booking-orders'},
      {title:'商品售后审核与失败处理',count:refunds?.[0]?.products??null,path:'/orders'},
      {title:'失败的恢复任务',count:deadJobs,path:'/data'},
    ].filter(task=>task.count!==null);
    return {articles,courses,products,teachers,pending,published,publishedCourses,learners:learners[0]?.total??null,pendingThreads,pendingComments:pendingComments?.[0]?.total??null,feedbackOpen,activity,tasks,finance,development:process.env.NODE_ENV!=='production'};
  }
  private async financialOverview() {
    const [totals,trend]=await Promise.all([
      this.db.$queryRaw<{orders:number;paidOrders:number;paid:string;refunded:string;net:string}[]>`WITH orders AS (SELECT o.*,EXISTS(SELECT 1 FROM "PaymentTransaction" p WHERE p."orderId"=o.id AND p.disposition='ACCEPTED') AS accepted FROM "TradeOrder" o WHERE o.kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT') AND o.currency='CNY') SELECT count(*)::int AS orders,count(*) FILTER(WHERE accepted AND "paidTotal">0)::int AS "paidOrders",COALESCE(sum("paidTotal") FILTER(WHERE accepted),0)::text AS paid,COALESCE(sum("refundedTotal") FILTER(WHERE accepted),0)::text AS refunded,COALESCE(sum("paidTotal"-"refundedTotal") FILTER(WHERE accepted),0)::text AS net FROM orders`,
      this.db.$queryRaw<{day:string;paid:string;refunded:string}[]>`WITH days AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date-29,(now() AT TIME ZONE 'Asia/Shanghai')::date,'1 day')::date AS day), paid AS (SELECT ("paidAt" AT TIME ZONE 'Asia/Shanghai')::date AS day,sum(amount)::text AS amount FROM "PaymentTransaction" WHERE currency='CNY' AND disposition='ACCEPTED' AND "orderId" IN(SELECT id FROM "TradeOrder" WHERE kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT')) GROUP BY 1), refund_events AS (SELECT ("succeededAt" AT TIME ZONE 'Asia/Shanghai')::date AS day,amount FROM "RefundTransaction" WHERE currency='CNY' AND "paymentTransactionId" IN(SELECT id FROM "PaymentTransaction" WHERE disposition='ACCEPTED' AND "orderId" IN(SELECT id FROM "TradeOrder" WHERE kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT'))) UNION ALL SELECT (j."postedAt" AT TIME ZONE 'Asia/Shanghai')::date,-r."approvedAmount" FROM "FinanceJournal" j JOIN "Refund" r ON r.id=j."refundId" JOIN "PaymentTransaction" p ON p.id=j."transactionId" WHERE j.kind IN ('COURSE_REFUND_REVERSAL','MEMBERSHIP_REFUND_REVERSAL') AND j.currency='CNY' AND p.disposition='ACCEPTED'), refunded AS (SELECT day,sum(amount)::text AS amount FROM refund_events GROUP BY 1) SELECT to_char(d.day,'YYYY-MM-DD') AS day,COALESCE(p.amount,'0') AS paid,COALESCE(r.amount,'0') AS refunded FROM days d LEFT JOIN paid p USING(day) LEFT JOIN refunded r USING(day) ORDER BY d.day`
    ]);
    return {...totals[0],trend};
  }
  async articles(query: TableQuery) {
    const where = { ...(query.category ? {category:query.category} : {}), ...(query.status ? { status: query.status } : {}), ...(query.q ? { OR: [{title:{ contains:query.q,mode:'insensitive' as const }},{id:query.q}] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.article.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }),
      this.db.article.count({ where }),
    ]);
    return { items, total, page: query.page, size: query.size };
  }
  async save(req: AuthRequest, data: ArticleDto | ArticleEditDto, id?: string) {
    requireRoles(req, ['OPERATOR']);
    if (new Set(data.blocks.map(block => block.id)).size !== data.blocks.length) throw new BadRequestException('段落标识不能重复');
    if (data.blocks.some(b => b.type === 'image' ? !b.url : ['paragraph', 'quote'].includes(b.type) && !b.text.trim())) throw new BadRequestException('文字块不能为空，图片块须有 HTTPS 图片地址');
    const { expectedVersion: _, ...record } = data as ArticleEditDto;
    const safeData = { ...record, blocks: record.blocks.map(block => ({ id:block.id, type:block.type, text:['paragraph','quote'].includes(block.type)?block.text:'', ...(block.type==='image'?{url:block.url}:{}), ...(['audio','video'].includes(block.type)?{mediaId:block.mediaId}:{}), ...(['audio','video','image'].includes(block.type)&&block.caption?{caption:block.caption}:{}) })) };
    return this.db.$transaction(async tx => {
      await validateCategory(tx, 'ARTICLE', data.category, id ? (await tx.article.findUnique({where:{id},select:{category:true}}))?.category : undefined);
      await validateArticleMedia(tx, data.blocks);
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
      submit: { from: ['DRAFT', 'REJECTED'], to: 'REVIEW' }, publish: { from: req.actor.roles.includes('ADMIN') ? ['DRAFT','REJECTED','REVIEW'] : ['REVIEW'], to: 'PUBLISHED' },
      reject: { from: ['REVIEW'], to: 'REJECTED' }, archive: { from: ['PUBLISHED'], to: 'ARCHIVED' },
      revise: { from: req.actor.roles.includes('ADMIN') ? ['ARCHIVED','REJECTED','PUBLISHED'] : ['ARCHIVED','REJECTED'], to: 'DRAFT' },
    };
    const state = states[dto.action]!;
    return this.db.$transaction(async tx => {
      const changed = await tx.article.updateMany({ where: { id, version: dto.expectedVersion, status: { in: state.from } }, data: { status: state.to, version: { increment: 1 }, ...(state.to === 'PUBLISHED' ? { publishedAt: new Date() } : {}) } });
      if (changed.count !== 1) throw new ConflictException('状态已变化或操作不适用于当前文章，请刷新列表');
      if (dto.action === 'submit' || dto.action === 'publish') {
        const article = await tx.article.findUniqueOrThrow({ where: { id } });
        await validateEvidencePublication(tx, id);
        await validateArticleMedia(tx, article.blocks as import('./article-media.js').ArticleMediaBlock[]);
      }
      if (state.to === 'PUBLISHED') {
        const article = await tx.article.findUniqueOrThrow({ where: { id } });
        const previous = await tx.articleRelease.aggregate({ where: { articleId: id }, _max: { releaseNo: true } });
        const release = await tx.articleRelease.create({ data: { articleId: id, releaseNo: (previous._max.releaseNo ?? 0) + 1, templateCode:['PLAIN','CLASSIC','INK'].includes(article.draftTemplateCode??'')?article.draftTemplateCode!:'PLAIN', sourceSnapshot: { source: article.source, title: article.title }, authorSnapshot: { author: article.author }, reviewerId: req.actor.id, publishedAt: new Date() } });
        const blocks = article.blocks as import('./article-media.js').ArticleMediaBlock[];
        await tx.articleBlock.createMany({ data: blocks.map((b, position) => ({ releaseId: release.id, stableKey: b.id, position, kind: b.type.toUpperCase(), body: b, mediaId: ['audio', 'video'].includes(b.type) ? b.mediaId : null })) });
        await tx.article.update({ where: { id }, data: { currentReleaseId: release.id } });
      }
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: `article.${dto.action}`, resource: 'article', resourceId: id, changes: { status: state.to, reason: dto.reason, previousVersion: dto.expectedVersion } } });
      return tx.article.findUniqueOrThrow({ where: { id } });
    });
  }

}
@Controller('admin') @UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly db: Database,private readonly categories:Categories) {}
  @Get('overview') overview(@Req() req: AuthRequest) { return this.admin.overview(req); }
  @Get('articles') articles(@Query() query: TableQuery, @Req() req: AuthRequest) { requireRoles(req, ['OPERATOR', 'MODERATOR']); return this.admin.articles(query).then(value=>this.categories.decorate('ARTICLE',value)); }
  @Post('articles') save(@Body() body: ArticleDto, @Req() req: AuthRequest) { return this.admin.save(req, body); }
  @Patch('articles/:id') edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: ArticleEditDto, @Req() req: AuthRequest) { return this.admin.save(req, body, id); }
  @Post('articles/:id/transition') transition(@Param('id', ParseUUIDPipe) id: string, @Body() body: TransitionDto, @Req() req: AuthRequest) { return this.admin.transition(req, id, body); }
  @Get('articles/:id/audit') async audit(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR', 'MODERATOR']);
    if (!await this.db.article.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('文章不存在');
    return this.db.auditLog.findMany({ where: { resource: 'article', resourceId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

}
