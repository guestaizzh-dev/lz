import {Categories} from './categories.js';
import {productPromotionHints} from './product-promotions.js';
import { publicEvidence } from './evidence.js';
import { teacherContent } from './teacher-content.js';
import { productReturnPolicy, productSalesEnabled } from './product-sales.js';
import { Prisma } from './generated/prisma/client.js';
import { publicContentScope } from './public-content.js';
import { Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { OptionalUserGuard } from './auth.js';
import type { AuthRequest } from './auth.js';
import { LearningService } from './learning.js';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { CourseFormat } from './generated/prisma/client.js';
import { Database } from './database.js';
import { Optional } from '@nestjs/common';
import { SystemConfig, configDefaults } from './system-config.js';
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
  @IsOptional() @IsIn(['TEXT','AUDIO','VIDEO','LIVE']) contentFormat?: 'TEXT'|'AUDIO'|'VIDEO'|'LIVE';
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @IsIn(['recent','priceAsc','priceDesc','popular']) sort?: 'recent'|'priceAsc'|'priceDesc'|'popular';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
function page<T extends { id: string }>(items: T[], size: number) {
  return { items: items.slice(0, size), nextCursor: items.length > size ? items[size - 1]!.id : null };
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: Database, private readonly learning: LearningService, @Optional() private readonly config?: SystemConfig) {}
  private async courseCards<T extends { publishedReleaseId: string | null }>(courses: T[]) {
    const ids = courses.map(course => course.publishedReleaseId).filter((id): id is string => !!id);
    const lessons = ids.length ? await this.db.lesson.findMany({ where: { releaseId: { in: ids } }, select: { releaseId: true, format: true } }) : [];
    return courses.map(course => ({ ...course, contentFormats: ['TEXT', 'AUDIO', 'VIDEO', 'LIVE'].filter(format => lessons.some(lesson => lesson.releaseId === course.publishedReleaseId && lesson.format === format)) }));
  }
  private publicScope() { return publicContentScope(this.db); }
  private async scope(query: CatalogQuery) {
    return { ...await this.publicScope(), ...(query.category ? { category: query.category } : {}), ...(query.q?.trim() ? { title: { contains: query.q.trim(), mode: 'insensitive' as const } } : {}) };
  }
  private pagination(query: CatalogQuery) {
    return { take: query.size + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] };
  }
  async home() {
    const settings = this.config ? (await this.config.current('catalog')).value : configDefaults.catalog;
    const [articles, courses, products, events] = await Promise.all([
      this.db.article.findMany({ where: await this.publicScope(), select: articlePreview, orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }], take: settings.homeArticles }),
      this.db.course.findMany({ where: { ...await this.publicScope(), teacher: await this.publicScope() }, include: { teacher: { select: teacherPreview } }, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: settings.homeCourses }),
      this.db.product.findMany({ where: await this.publicScope(), orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: settings.homeProducts }),
      this.db.event.findMany({ where: await this.publicScope(), orderBy: { startsAt: 'asc' }, take: settings.homeEvents }),
    ]);
    return { articles, courses: await this.courseCards(courses), products, events, development: process.env.NODE_ENV !== 'production', demoContentVisible: !(await this.publicScope()).isDemo };
  }
  async articles(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.article.findMany({ where: await this.scope(query), select: articlePreview, ...this.pagination(query) }), query.size);
  }
  async article(id: string, userId?: string) {
    const item = await this.db.article.findFirst({ where: { ...await this.publicScope(), id } });
    if (!item) throw new NotFoundException('文章不存在或已下架');
    const preview = { id: item.id, version: item.version, title: item.title, summary: item.summary, category: item.category, author: item.author, source: item.source, cover: item.cover, tags: item.tags, visibility: item.visibility, membershipTier: item.membershipTier, isDemo: item.isDemo, publishedAt: item.publishedAt, currentReleaseId: item.currentReleaseId };
    const member = item.visibility === 'MEMBER' ? await this.learning.membership(userId) : null;
    if (item.visibility === 'MEMBER' && (!member || member.contentTier < item.membershipTier)) {
      return { ...preview, blocks: [], access: 'MEMBERSHIP_REQUIRED' };
    }
    const release=item.currentReleaseId?await this.db.articleRelease.findUnique({where:{id:item.currentReleaseId},select:{templateCode:true}}):null;
    return { ...preview, templateCode:release?.templateCode??'PLAIN', blocks: item.blocks, access: item.visibility === 'MEMBER' ? 'MEMBER' : 'PUBLIC' };
  }
  async courses(query: CatalogQuery = new CatalogQuery()) {
    const releases = query.contentFormat ? await this.db.lesson.findMany({where:{format:query.contentFormat},distinct:['releaseId'],select:{releaseId:true}}) : null;
    return page(await this.courseCards(await this.db.course.findMany({ where: { ...await this.scope(query), teacher: await this.publicScope(), ...(query.format ? { format: query.format } : {}), ...(releases ? {publishedReleaseId:{in:releases.map(row=>row.releaseId)}} : {}), ...(query.teacherId ? { teacherId: query.teacherId } : {}) }, include: { teacher: { select: teacherPreview } }, ...this.pagination(query) })), query.size);
  }
  async course(id: string,userId?:string) {
    const item = await this.db.course.findFirst({ where: { ...await this.publicScope(), id, teacher: await this.publicScope() }, include: { teacher: { select: teacherPreview } } });
    if(userId){const context=await this.learning.context(id,userId);if(context.enrollment){const release=await this.db.courseRelease.findUniqueOrThrow({where:{id:context.enrollment.releaseId},include:{lessons:{select:{format:true}}}}),teacher=context.course.teacher;return{...(item??context.course),publishedReleaseId:release.id,chaptersCount:release.lessons.length,contentFormats:['TEXT','AUDIO','VIDEO','LIVE'].filter(format=>release.lessons.some(lesson=>lesson.format===format)),title:release.title,description:release.descriptionSnapshot,teacher:{id:teacher.id,name:(release.teacherSnapshot as {name?:string})?.name??teacher.name,title:teacher.title,bio:teacher.bio,expertise:teacher.expertise,portrait:teacher.portrait,isDemo:teacher.isDemo}};}}
    if (!item) {
      throw new NotFoundException('课程不存在或已下架');
    }
    return (await this.courseCards([item]))[0]!;
  }
  async teachers(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.teacher.findMany({ where: { ...await this.publicScope(), ...(query.q?.trim() ? { name: { contains: query.q.trim(), mode: 'insensitive' as const } } : {}) }, select: teacherPreview, ...this.pagination(query) }), query.size);
  }
  async teacher(id: string) {
    const item = await this.db.teacher.findFirst({ where: { ...await this.publicScope(), id }, select: {...teacherPreview,teachingDirection:true,lineageSummary:true,achievementSummary:true} });
    if (!item) throw new NotFoundException('名师不存在或已下架');
    const content=await teacherContent(this.db,id);
    return {...item,...content,representativeCourses:await this.courseCards(content.representativeCourses),evidence:await publicEvidence(this.db,id,item.isDemo)};
  }
  async events(query: CatalogQuery = new CatalogQuery()) {
    return page(await this.db.event.findMany({ where: await this.scope(query), ...this.pagination(query) }), query.size);
  }
  async event(id: string) {
    const item = await this.db.event.findFirst({ where: { ...await this.publicScope(), id } });
    if (!item) throw new NotFoundException('活动不存在或已下架');
    return item;
  }
  async products(query: CatalogQuery = new CatalogQuery()) {
    if(query.sort==='popular'){
      const showDemo=!(await this.publicScope()).isDemo;
      const rows=await this.db.$queryRaw<(Record<string,unknown>&{id:string;soldQuantity:number})[]>(Prisma.sql`
        WITH ranked AS (
          SELECT p.*,COALESCE(s.sold,0)::int AS "soldQuantity",row_number() OVER(ORDER BY COALESCE(s.sold,0) DESC,p."createdAt" DESC,p.id DESC) AS position
          FROM "Product" p LEFT JOIN (
            SELECT sku."productId",SUM(i.quantity-COALESCE(r.quantity,0)) AS sold FROM "TradeOrderItem" i
            JOIN "SaleOffer" offer ON offer.id=i."offerId" JOIN "ProductSku" sku ON sku.id=offer."skuId" JOIN "TradeOrder" o ON o.id=i."orderId"
            LEFT JOIN (SELECT ri."orderItemId",SUM(ri.quantity) AS quantity FROM "RefundItem" ri JOIN "Refund" r ON r.id=ri."refundId" WHERE r.state='SUCCEEDED' AND r.kind<>'EXCHANGE' AND r."reasonCode"='PRODUCT_RETURN' GROUP BY ri."orderItemId") r ON r."orderItemId"=i.id
            WHERE o.kind='PHYSICAL' AND EXISTS(SELECT 1 FROM "PaymentTransaction" pay WHERE pay."orderId"=o.id AND pay.disposition='ACCEPTED') GROUP BY sku."productId"
          ) s ON s."productId"=p.id WHERE p.status='PUBLISHED' AND (${showDemo} OR NOT p."isDemo")
          AND (${query.category??null}::text IS NULL OR p.category=${query.category??null}) AND (${query.q?.trim()??''}='' OR p.title ILIKE ${'%'+(query.q?.trim()??'')+'%'})
        ) SELECT * FROM ranked WHERE (${query.cursor??null}::text IS NULL OR position>COALESCE((SELECT position FROM ranked WHERE id=${query.cursor??null}),0)) ORDER BY position LIMIT ${query.size+1}`);
      return page(rows.map(({position,...row})=>row),query.size);
    }
    const pagination=this.pagination(query);
    const orderBy=query.sort==='priceAsc'?[{price:'asc' as const},{id:'asc' as const}]:query.sort==='priceDesc'?[{price:'desc' as const},{id:'desc' as const}]:pagination.orderBy;
    return page(await this.db.product.findMany({ where: await this.scope(query), ...pagination, orderBy }), query.size);
  }
  async product(id: string) {
    const item = await this.db.product.findFirst({ where: { ...await this.publicScope(), id }, include: { skus: { where: { active: true }, orderBy: [{ price: 'asc' }, { id: 'asc' }] } } });
    if (!item) throw new NotFoundException('商品不存在或已下架');
    const time=new Date(),evidence=await publicEvidence(this.db,id,item.isDemo);
    const relations=await this.db.contentRelation.findMany({where:{fromId:id,relationType:'PRODUCT_COURSE',approvedBy:{not:null},AND:[{OR:[{startsAt:null},{startsAt:{lte:time}}]},{OR:[{endsAt:null},{endsAt:{gt:time}}]}]},orderBy:[{rank:'asc'},{id:'asc'}]});
    const courses=await this.db.course.findMany({where:{id:{in:relations.map(r=>r.toId)},...await this.publicScope(),teacher:await this.publicScope()},select:{id:true,title:true,description:true}});
    const promotions=await productPromotionHints(this.db,item.skus.map(s=>s.id),false);
    return { ...item,serverTime:new Date().toISOString(),promotions:promotions.map(p=>({...p,price:p.price===null?null:Number(p.price)})), skus: item.skus.map(s=>({...publicSku(s),available:s.stock-s.reserved+Math.max(0,...promotions.filter(p=>p.skuId===s.id&&p.startsAt<=new Date()).map(p=>p.remaining))})), checkoutEnabled: productSalesEnabled()&&!item.isDemo&&item.type==='PHYSICAL', refundPolicy:productReturnPolicy, evidence:evidence.map(e=>({...e,sourceUrl:e.sourceUrl?.startsWith('https://')?e.sourceUrl:null})),relatedCourses:relations.flatMap(r=>courses.filter(c=>c.id===r.toId)) };
  }
  async courseTools(id:string){
    if(!await this.db.course.findFirst({where:{id,...await this.publicScope(),teacher:await this.publicScope()}}))throw new NotFoundException('课程不存在或已下架');
    const time=new Date(),relations=await this.db.contentRelation.findMany({where:{toId:id,relationType:'PRODUCT_COURSE',approvedBy:{not:null},AND:[{OR:[{startsAt:null},{startsAt:{lte:time}}]},{OR:[{endsAt:null},{endsAt:{gt:time}}]}]},orderBy:[{rank:'asc'},{id:'asc'}]});
    const products=await this.db.product.findMany({where:{id:{in:relations.map(r=>r.fromId)},...await this.publicScope()},select:{id:true,title:true,subtitle:true,price:true,cover:true,type:true}});
    return{items:relations.flatMap(r=>products.filter(p=>p.id===r.fromId))};
  }

}

@ApiTags('公开内容')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService, private readonly categories:Categories) {}
  @Get('home') async home() {const data=await this.catalog.home();return {...data,articles:await this.categories.decorate('ARTICLE',data.articles,true),courses:await this.categories.decorate('COURSE',data.courses,true),products:await this.categories.decorate('PRODUCT',data.products,true),events:await this.categories.decorate('EVENT',data.events,true)};}
  @Get('articles') articles(@Query() query: CatalogQuery) { return this.catalog.articles(query).then(value=>this.categories.decorate('ARTICLE',value,true)); }
  @Get('articles/:id') @UseGuards(OptionalUserGuard) article(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) { return this.catalog.article(id, req.actor?.id).then(value=>this.categories.decorate('ARTICLE',value,true)); }
  @Get('courses') courses(@Query() query: CatalogQuery) { return this.catalog.courses(query).then(value=>this.categories.decorate('COURSE',value,true)); }
  @Get('courses/:id') @UseGuards(OptionalUserGuard) course(@Param('id', ParseUUIDPipe) id: string,@Req() req:AuthRequest) { return this.catalog.course(id,req.actor?.id).then(value=>this.categories.decorate('COURSE',value,true)); }
  @Get('teachers') teachers(@Query() query: CatalogQuery) { return this.catalog.teachers(query); }
  @Get('teachers/:id') teacher(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.teacher(id); }
  @Get('events') events(@Query() query: CatalogQuery) { return this.catalog.events(query).then(value=>this.categories.decorate('EVENT',value,true)); }
  @Get('events/:id') event(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.event(id).then(value=>this.categories.decorate('EVENT',value,true)); }
  @Get('products') products(@Query() query: CatalogQuery) { return this.catalog.products(query).then(value=>this.categories.decorate('PRODUCT',value,true)); }
  @Get('courses/:id/tools') tools(@Param('id',ParseUUIDPipe) id:string){return this.catalog.courseTools(id);}
  @Get('products/:id') product(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.product(id).then(value=>this.categories.decorate('PRODUCT',value,true)); }
}
