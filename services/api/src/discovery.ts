import { publicEvidence } from './evidence.js';
import { demoContentVisible } from './public-content.js';
import { Body, Controller, Get, Post, Injectable, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { OptionalUserGuard, UserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';
import { Database } from './database.js';
import { Prisma } from './generated/prisma/client.js';
import { CatalogService } from './catalog.js';

export const contentTypes = ['ARTICLE', 'COURSE', 'TEACHER', 'PRODUCT', 'EVENT', 'LIVE', 'THREAD'];
export class SearchQuery {
  @IsOptional() @IsString() @Length(0, 80) q = '';
  @IsOptional() @IsIn(contentTypes) type?: string;
  @IsOptional() @IsString() @Length(1, 40) tag?: string;
  @IsOptional() @IsIn(['relevance', 'recent', 'popular']) sort = 'relevance';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
class RecommendationPreferenceDto {@IsBoolean() enabled!:boolean;}

type Item = { id: string; type: string; title: string; summary: string; cover: string; tags: string[]; publishedAt: Date; visibility: string; isDemo: boolean; popularity: number; score?: number };

@Injectable()
export class DiscoveryService {
  constructor(private readonly db: Database, private readonly catalog: CatalogService) {}
  // Resource is the identity projection; concrete status and teacher publication are also checked.
  private async pool(userId?: string) {
    return Prisma.sql`WITH pool AS (
      SELECT r.id, r.kind AS type, r.title, r.summary, r.visibility, r."isDemo", COALESCE(a."publishedAt",r."publishedAt",r."createdAt") AS "publishedAt",
        COALESCE(a.cover,c.cover,p.cover,e.cover,t.portrait,'') AS cover,
        ARRAY(SELECT DISTINCT tag FROM unnest(COALESCE(a.tags,c.tags,t.expertise,ARRAY[]::text[]) || ARRAY(SELECT tg.name FROM "ResourceTag" rt JOIN "Tag" tg ON tg.id=rt."tagId" AND tg.active WHERE rt."resourceId"=r.id)) AS tag ORDER BY tag) AS tags,
        (SELECT count(*)::int FROM "Reaction" x WHERE x."resourceId"=r.id AND x.kind='LIKE') AS popularity
      FROM "Resource" r LEFT JOIN "Article" a ON a.id=r.id AND r.kind='ARTICLE'
        LEFT JOIN "Course" c ON c.id=r.id AND r.kind='COURSE' LEFT JOIN "Teacher" ct ON ct.id=c."teacherId"
        LEFT JOIN "Product" p ON p.id=r.id AND r.kind='PRODUCT' LEFT JOIN "Event" e ON e.id=r.id AND r.kind='EVENT'
        LEFT JOIN "Teacher" t ON t.id=r.id AND r.kind='TEACHER' LEFT JOIN "LiveRoom" l ON l.id=r.id AND r.kind='LIVE'
        LEFT JOIN "Teacher" lt ON lt.id=l."teacherId"
        LEFT JOIN "ForumThread" ft ON ft.id=r.id AND r.kind='THREAD' LEFT JOIN "ForumSection" fs ON fs.id=ft."sectionId"
      WHERE r."publishState"='PUBLISHED' AND (${await demoContentVisible(this.db)} OR NOT r."isDemo") AND (
        (a.status='PUBLISHED') OR (c.status='PUBLISHED' AND ct.status='PUBLISHED') OR (p.status='PUBLISHED') OR (e.status='PUBLISHED') OR (t.status='PUBLISHED') OR (l.id IS NOT NULL AND lt.status='PUBLISHED') OR (ft.id IS NOT NULL AND ft."deletedAt" IS NULL AND fs.active AND fs.scope='PUBLIC' AND fs."cohortId" IS NULL AND r.visibility='PUBLIC')
      ) ${userId ? Prisma.sql`AND NOT EXISTS(SELECT 1 FROM "UserBlock" b WHERE b."userId"=${userId} AND b."blockedId"=ft."authorId")` : Prisma.empty}
      AND (${await demoContentVisible(this.db)} OR (COALESCE(ct."isDemo",false)=false AND COALESCE(lt."isDemo",false)=false))
    )`;
  }
  async search(query: SearchQuery, userId?: string) {
    const q = query.q.trim();
    const condition = Prisma.sql`(${query.type ?? null}::text IS NULL OR type=${query.type ?? null}) AND (${query.tag ?? null}::text IS NULL OR ${query.tag ?? null}=ANY(tags)) AND (${q}='' OR strpos(lower(title),lower(${q}))>0 OR strpos(lower(summary),lower(${q}))>0 OR EXISTS(SELECT 1 FROM unnest(tags) tag WHERE strpos(lower(tag),lower(${q}))>0))`;
    const score = Prisma.sql`(CASE WHEN lower(title)=lower(${q}) AND ${q}<>'' THEN 100 WHEN strpos(lower(title),lower(${q}))>0 AND ${q}<>'' THEN 30 ELSE 0 END + CASE WHEN ${q}=ANY(tags) THEN 20 ELSE 0 END)`;
    const order = query.sort === 'recent' ? Prisma.sql`"publishedAt" DESC, id` : query.sort === 'popular' ? Prisma.sql`popularity DESC, "publishedAt" DESC, id` : Prisma.sql`score DESC, "publishedAt" DESC, id`;
    const [items, count] = await this.db.$transaction([
      this.db.$queryRaw<Item[]>(Prisma.sql`${await this.pool(userId)} SELECT *, ${score} AS score FROM pool WHERE ${condition} ORDER BY ${order} LIMIT ${query.size} OFFSET ${(query.page - 1) * query.size}`),
      this.db.$queryRaw<{ total: number }[]>(Prisma.sql`${await this.pool(userId)} SELECT count(*)::int AS total FROM pool WHERE ${condition}`),
    ]);
    return { items, total: count[0]!.total, page: query.page, size: query.size, hasMore: query.page * query.size < count[0]!.total };
  }
  async tags(userId?: string) {
    return this.db.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`${await this.pool(userId)} SELECT tag AS name,count(*)::int AS count FROM pool CROSS JOIN LATERAL unnest(tags) tag GROUP BY tag ORDER BY count DESC,tag LIMIT 80`);
  }
  async publicItem(id: string, type: string, userId?: string) {
    const rows = await this.db.$queryRaw<Item[]>(Prisma.sql`${await this.pool(userId)} SELECT * FROM pool WHERE id=${id} AND type=${type}`);
    if (!rows[0]) throw new NotFoundException('内容不存在或已下架');
    return rows[0];
  }
  async related(id: string, userId?: string) {
    const source=await this.db.resource.findUnique({where:{id}});
    if(!source)throw new NotFoundException('内容不存在');
    await this.publicItem(id,source.kind,userId);
    const now=new Date(),relations=await this.db.contentRelation.findMany({where:{OR:[{fromId:id},{toId:id}],approvedBy:{not:null},AND:[{OR:[{startsAt:null},{startsAt:{lte:now}}]},{OR:[{endsAt:null},{endsAt:{gt:now}}]}]},orderBy:[{rank:'asc'},{id:'asc'}]});
    if(!relations.length)return {items:[]};
    const targets=relations.map(r=>r.fromId===id?r.toId:r.fromId),rows=await this.db.$queryRaw<Item[]>(Prisma.sql`${await this.pool(userId)} SELECT * FROM pool WHERE id IN (${Prisma.join(targets)}) AND (type<>'EVENT' OR EXISTS(SELECT 1 FROM "Event" e WHERE e.id=pool.id AND e."endsAt">now()))`),seen=new Set<string>();
    return {items:relations.flatMap(r=>{const item=rows.find(i=>i.id===(r.fromId===id?r.toId:r.fromId));if(!item||seen.has(item.id))return [];seen.add(item.id);return [{...item,relationType:r.relationType}];})};
  }
  async recommendationPreference(userId:string){const record=await this.db.consentRecord.findFirst({where:{userId,policyCode:'PERSONALIZED_RECOMMENDATIONS'},orderBy:[{actedAt:'desc'},{id:'desc'}]});return {enabled:record?.accepted??true,policyVersion:'1',explanation:'根据兴趣标签、阅读、收藏、点赞及有效购买推荐；退款撤销购买信号，排除有效已购课程。关闭后仅展示公开精选。'};}
  async setRecommendationPreference(userId:string,enabled:boolean){await this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;await tx.consentRecord.create({data:{userId,policyCode:'PERSONALIZED_RECOMMENDATIONS',policyVersion:'1',purpose:'CONTENT_RECOMMENDATION',accepted:enabled,actedAt:new Date(),source:'APP_SETTINGS'}});});return this.recommendationPreference(userId);}
  async recommendations(userId?: string) {
    const weights: Record<string, number> = Object.create(null);
    let seen: string[] = [];
    const preference=userId?await this.recommendationPreference(userId):null;
    const purchases=userId?await this.db.$queryRaw<{resourceId:string;owned:boolean}[]>`SELECT DISTINCT COALESCE(r."courseId",ps."productId") AS "resourceId", CASE WHEN r."courseId" IS NULL THEN false ELSE EXISTS(SELECT 1 FROM "Enrollment" e WHERE e."userId"=${userId} AND e."courseId"=r."courseId" AND e."revokedAt" IS NULL AND e."startsAt"<=now() AND (e."expiresAt" IS NULL OR e."expiresAt">now())) END AS owned FROM "TradeOrderItem" i JOIN "TradeOrder" o ON o.id=i."orderId" JOIN "SaleOffer" s ON s.id=i."offerId" LEFT JOIN "ProductSku" ps ON ps.id=s."skuId" LEFT JOIN "CourseRelease" r ON r.id=i."courseReleaseId" WHERE o."userId"=${userId} AND o."paidTotal">o."refundedTotal" AND i.state IN ('PAID','DELIVERED') AND o.state IN ('PAID','FULFILLING','COMPLETED') AND i.payable>i."refundedAmount" AND (r."courseId" IS NOT NULL OR ps."productId" IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM "Refund" f WHERE f."orderId"=o.id AND f.state IN ('REQUESTED','APPROVED','REFUNDING','FAILED')) ORDER BY "resourceId" LIMIT 500`:[];
    if (userId&&preference?.enabled) {
      const [user, tags, signals] = await Promise.all([
        this.db.user.findUnique({ where: { id: userId }, select: { tags: true } }),
        this.db.$queryRaw<{ name: string }[]>`SELECT t.name FROM "UserTag" u JOIN "Tag" t ON t.id=u."tagId" AND t.active WHERE u."userId"=${userId}`,
        this.db.$queryRaw<{ resourceId: string; weight: number }[]>`SELECT "resourceId", max(weight)::int AS weight FROM (
          (SELECT "resourceId",1 AS weight FROM "ReadingEvent" WHERE "userId"=${userId} ORDER BY "createdAt" DESC LIMIT 100)
          UNION ALL (SELECT "resourceId",3 AS weight FROM "Reaction" WHERE "userId"=${userId} AND kind='LIKE' ORDER BY "createdAt" DESC LIMIT 100)
          UNION ALL (SELECT "articleId" AS "resourceId",4 AS weight FROM "Favorite" WHERE "userId"=${userId} ORDER BY "createdAt" DESC LIMIT 100)
        ) s GROUP BY "resourceId"`,
      ]);
      const add = (tag: string, weight: number) => { weights[tag] = (weights[tag] ?? 0) + weight; };
      for (const tag of [...(user?.tags ?? []), ...tags.map(t => t.name)]) add(tag, 5);
      for(const purchase of purchases){const signal=signals.find(s=>s.resourceId===purchase.resourceId);if(signal)signal.weight=Math.max(signal.weight,8);else signals.push({resourceId:purchase.resourceId,weight:8});}
      seen = signals.map(s => s.resourceId);
      if (seen.length) {
        const sources = await this.db.$queryRaw<Item[]>(Prisma.sql`${await this.pool(userId)} SELECT * FROM pool WHERE id IN (${Prisma.join(seen)})`);
        for (const source of sources) for (const tag of source.tags) add(tag, signals.find(s => s.resourceId === source.id)!.weight);
      }
    }
    const excluded=[...new Set([...seen,...purchases.filter(p=>p.owned).map(p=>p.resourceId)])];
    const rank = Prisma.sql`COALESCE((SELECT sum(w.value::int) FROM jsonb_each_text(${JSON.stringify(weights)}::jsonb) w WHERE w.key=ANY(tags)),0)::int`;
    const items = await this.db.$queryRaw<Item[]>(Prisma.sql`${await this.pool(userId)} SELECT *,${rank} AS score FROM pool ${excluded.length ? Prisma.sql`WHERE id NOT IN (${Prisma.join(excluded)})` : Prisma.empty} ORDER BY score DESC,popularity DESC,"publishedAt" DESC,id LIMIT 12`);
    return { items: items.map(i => ({ ...i, reason: i.score ? (purchases.length?'与你的研习标签及有效购买相关':'与你的研习标签相关') : '书院精选内容' })), personalized: Object.keys(weights).length > 0 };
  }
  async context(id: string, userId?: string) {
    await this.catalog.article(id, userId);
    const now = new Date();
    const bindings = await this.db.resourceEvidence.findMany({ where: { resourceId: id } });
    const article=await this.db.article.findUniqueOrThrow({where:{id},select:{isDemo:true}});
    const evidence=await publicEvidence(this.db,id,article.isDemo);
    const relations = await this.db.contentRelation.findMany({ where: { fromId: id, approvedBy: { not: null }, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] });
    const related = relations.length ? await this.db.$queryRaw<Item[]>(Prisma.sql`${await this.pool(userId)} SELECT * FROM pool WHERE id IN (${Prisma.join(relations.map(r => r.toId))}) AND type IN ('COURSE','LIVE')`) : [];
    return { evidence: evidence.map(e => ({ ...e, sourceUrl: e.sourceUrl?.startsWith('https://') ? e.sourceUrl : null, purpose: bindings.find(b => b.evidenceId === e.id)?.purpose })), related: relations.flatMap(r => { const item = related.find(i => i.id === r.toId); return item ? [{ ...item, relationType: r.relationType }] : []; }) };
  }
  async live(id: string) {
    const item = await this.publicItem(id, 'LIVE');
    const room = await this.db.liveRoom.findUniqueOrThrow({ where: { id } });
    const sessions = await this.db.liveSession.findMany({ where: { roomId: id, state: { in: ['SCHEDULED', 'LIVE', 'ENDED'] } }, select: { id: true, title: true, scheduledAt: true, startedAt: true, endedAt: true, state: true }, orderBy: { scheduledAt: 'desc' }, take: 10 });
    return { ...item, teacher: await this.catalog.teacher(room.teacherId), courseId: room.courseId, sessions, playbackAvailable: false };
  }
}

@Controller('discovery') @UseGuards(OptionalUserGuard)
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}
  @Get('search') search(@Query() q: SearchQuery, @Req() req: AuthRequest) { return this.discovery.search(q,req.actor?.id); }
  @Get('related/:id') related(@Param('id',ParseUUIDPipe) id: string,@Req() req: AuthRequest) { return this.discovery.related(id,req.actor?.id); }
  @Get('tags') tags(@Req() req: AuthRequest) { return this.discovery.tags(req.actor?.id); }
  @Get('recommendations') recommendations(@Req() req: AuthRequest) { return this.discovery.recommendations(req.actor?.id); }
  @Get('recommendation-preference') @UseGuards(UserGuard) preference(@Req() req:AuthRequest){return this.discovery.recommendationPreference(req.actor.id);}
  @Post('recommendation-preference') @UseGuards(UserGuard) setPreference(@Req() req:AuthRequest,@Body() dto:RecommendationPreferenceDto){return this.discovery.setRecommendationPreference(req.actor.id,dto.enabled);}
  @Get('articles/:id/context') context(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.discovery.context(id, req.actor?.id); }
  @Get('live/:id') live(@Param('id', ParseUUIDPipe) id: string) { return this.discovery.live(id); }
}

@Controller('me/reading-history') @UseGuards(UserGuard)
export class ReadingController {
  constructor(private readonly db: Database) {}
  @Get() async history(@Query() q: SearchQuery, @Req() req: AuthRequest) {
    const items = await this.db.$queryRaw<unknown[]>`SELECT a.id,a.title,a.summary,a.cover,a.category,a.author, max(h."createdAt") AS "lastReadAt",sum(h."dwellSeconds")::int AS "readDuration" FROM "ReadingEvent" h JOIN "Article" a ON a.id=h."resourceId" WHERE h."userId"=${req.actor.id} AND a.status='PUBLISHED' AND (${await demoContentVisible(this.db)} OR NOT a."isDemo") GROUP BY a.id ORDER BY "lastReadAt" DESC,a.id LIMIT ${q.size + 1} OFFSET ${(q.page - 1) * q.size}`;
    return { items: items.slice(0, q.size), hasMore: items.length > q.size, page: q.page };
  }
}
