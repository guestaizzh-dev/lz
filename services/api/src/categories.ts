import {randomUUID} from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import {Type} from 'class-transformer';
import { Database } from './database.js';
import { AdminGuard, requireRoles, type AuthRequest } from './auth.js';
import { Prisma } from './generated/prisma/client.js';

const scopes = ['ARTICLE', 'COURSE', 'PRODUCT', 'EVENT'] as const;
type Scope = typeof scopes[number];
const tables: Record<Scope, string> = { ARTICLE: 'Article', COURSE: 'Course', PRODUCT: 'Product', EVENT: 'Event' };
class CategoryQuery { @IsIn(scopes) scope!: Scope; @IsOptional() @IsString() @Length(1,40) current?:string; }
class CategoryDto extends CategoryQuery {
  @IsString() @Length(1, 40) label!: string;
  @IsInt() @Min(0) @Max(9999) position = 0;
  @IsBoolean() enabled = true;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
class CategoryItemDto {@IsUUID() id!:string;@IsInt() @Min(1) version!:number;}
class CategoryAssignDto extends CategoryQuery {
  @IsString() @Length(1,40) category!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>CategoryItemDto) items!:CategoryItemDto[];
}

// Codes are immutable: renaming a category must not rewrite sold versions or benefit scopes.
export async function validateCategory(tx: Prisma.TransactionClient, scope: Scope, code: string, existing?: string) {
  const rows = await tx.$queryRaw<{ enabled: boolean }[]>`SELECT enabled FROM "CatalogCategory" WHERE scope=${scope} AND code=${code} FOR SHARE`;
  if (!rows.length || !rows[0]!.enabled && code !== existing) throw new BadRequestException('请选择启用的分类，可在分类管理中新增');
}

@Injectable()
export class Categories {
  constructor(private readonly db: Database) {}
  async assign(req:AuthRequest,dto:CategoryAssignDto){
    requireRoles(req,['ADMIN']);
    if(new Set(dto.items.map(item=>item.id)).size!==dto.items.length)throw new BadRequestException('选择的内容不能重复');
    return this.db.$transaction(async tx=>{
      await validateCategory(tx,dto.scope,dto.category);
      for(const item of [...dto.items].sort((a,b)=>a.id.localeCompare(b.id))){
        const changed=await tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"'+tables[dto.scope]+'"')} SET category=${dto.category},version=version+1,"updatedAt"=now() WHERE id=${item.id} AND version=${item.version}`);
        if(changed!==1)throw new ConflictException('部分内容已变化，请刷新列表重新选择；本次未修改任何内容');
      }
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'category.assign',resource:'category',resourceId:dto.category,changes:{scope:dto.scope,items:dto.items.map(({id,version})=>({id,version})),category:dto.category}}});
      return {success:true,count:dto.items.length};
    });
  }
  async decorate<T>(scope: Scope, value: T, display=false, loaded?:{code:string;label:string}[]): Promise<T> {
    const rows=loaded??await this.db.catalogCategory.findMany({where:{scope},select:{code:true,label:true}});
    const label=(item: any)=>item&&typeof item==='object'&&typeof item.category==='string'?{...item,categoryLabel:rows.find(row=>row.code===item.category)?.label??item.category,...(display?{categoryCode:item.category,category:rows.find(row=>row.code===item.category)?.label??item.category}:{})}:item;
    if(Array.isArray(value))return value.map(label) as T;
    if(value&&typeof value==='object'&&'items' in value)return {...value,items:(value as any).items.map(label)};
    return label(value);
  }
  async decorateHome<T extends {articles:unknown[];courses:unknown[];products:unknown[];events:unknown[]}>(data:T){
    const rows=await this.db.catalogCategory.findMany({where:{scope:{in:['ARTICLE','COURSE','PRODUCT','EVENT']}},select:{scope:true,code:true,label:true}}),[articles,courses,products,events]=await Promise.all([this.decorate('ARTICLE',data.articles,true,rows.filter(r=>r.scope==='ARTICLE')),this.decorate('COURSE',data.courses,true,rows.filter(r=>r.scope==='COURSE')),this.decorate('PRODUCT',data.products,true,rows.filter(r=>r.scope==='PRODUCT')),this.decorate('EVENT',data.events,true,rows.filter(r=>r.scope==='EVENT'))]);
    return{...data,articles,courses,products,events};
  }
  async list(scope: Scope, admin = false, current?:string) {
    const items = await this.db.catalogCategory.findMany({ where: { scope, ...(!admin ? {OR:[{enabled:true},...(current?[{code:current}]:[])]} : {}) }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
    if (!admin) return items.map(({ code, label, enabled }) => ({ code, label, enabled }));
    const counts = await this.db.$queryRaw<{ code: string; count: number }[]>(Prisma.sql`SELECT category AS code,count(*)::int AS count FROM ${Prisma.raw('"' + tables[scope] + '"')} GROUP BY category`);
    return items.map(item => ({ ...item, count: counts.find(row => row.code === item.code)?.count ?? 0 }));
  }
  async save(req: AuthRequest, dto: CategoryDto, id?: string) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('请填写分类名称');
    try {
      return await this.db.$transaction(async tx => {
        const original = id ? await tx.catalogCategory.findUnique({ where: { id } }) : null;
        if (id && (!original || original.scope !== dto.scope || original.version !== dto.expectedVersion)) throw new ConflictException('分类已变化，请刷新后重新编辑');
        const data = { label, position: dto.position, enabled: dto.enabled };
        const row = original ? await tx.catalogCategory.update({ where: { id, version: dto.expectedVersion }, data: { ...data, version: { increment: 1 } } }) : await tx.catalogCategory.create({ data: { ...data, scope: dto.scope, code: randomUUID() } });
        await tx.auditLog.create({ data: { actorId: req.actor.id, action: original ? 'category.edit' : 'category.create', resource: 'category', resourceId: row.id, changes: { ...data, scope: dto.scope } } });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('该分类名称已存在，请更换名称');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new ConflictException('分类已变化，请刷新');
      throw error;
    }
  }
  async remove(req: AuthRequest, id: string) {
    return this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ scope: Scope; code: string }[]>`SELECT scope,code FROM "CatalogCategory" WHERE id=${id} FOR UPDATE`;
      const row = rows[0]; if (!row) throw new ConflictException('分类已删除，请刷新');
      const used = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT count(*)::int AS count FROM ${Prisma.raw('"' + tables[row.scope] + '"')} WHERE category=${row.code}`);
      if (used[0]!.count) throw new ConflictException('该分类仍有内容，请先调整内容分类，或停用分类');
      await tx.catalogCategory.delete({ where: { id } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'category.delete', resource: 'category', resourceId: id, changes: row } });
      return { success: true };
    });
  }
}
@Controller('catalog/categories')
export class CategoriesCatalogController {
  constructor(private readonly categories: Categories) {}
  @Get() list(@Query() query: CategoryQuery) { return this.categories.list(query.scope,false,query.current); }
}
@Controller('admin/categories') @UseGuards(AdminGuard)
export class CategoriesAdminController {
  constructor(private readonly categories: Categories) {}
  @Get() list(@Query() query: CategoryQuery) { return this.categories.list(query.scope, true); }
  @Post('assign') assign(@Req() req:AuthRequest,@Body() dto:CategoryAssignDto){return this.categories.assign(req,dto);}
  @Post() create(@Req() req: AuthRequest, @Body() dto: CategoryDto) { return this.categories.save(req, dto); }
  @Patch(':id') save(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) { return this.categories.save(req, dto, id); }
  @Delete(':id') remove(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.categories.remove(req, id); }
}
