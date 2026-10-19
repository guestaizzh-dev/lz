import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { DiscoveryService } from './discovery.js';
import { resourceScopes } from './admin-permissions.js';
import { validateArticleMedia, type ArticleMediaBlock } from './article-media.js';

const kinds=['ARTICLE','TEACHER','COURSE','LIVE','PRODUCT','EVENT'];
class RelationDto {
  @IsOptional() @IsIn(['RELATED','INTRODUCTION','INTERPRETATION']) purpose?: string;
  @IsUUID() fromId!: string;
  @IsIn(kinds) fromType!: string;
  @IsUUID() toId!: string;
  @IsIn(kinds) type!: string;
  @IsInt() @Min(0) @Max(9999) rank!: number;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsString() @Length(1,500) reason!: string;
}
@Controller('admin/content-relations') @UseGuards(AdminGuard)
export class ContentRelationsController {
  constructor(private readonly db: Database,private readonly discovery: DiscoveryService) {}
  private async source(req: AuthRequest,id: string,write = false) {
    const row=await this.db.resource.findUnique({where:{id}});if(!row)throw new NotFoundException('内容不存在');
    const permission=resourceScopes[row.kind]+(write?'.review':'.read');
    if(!kinds.includes(row.kind)||!req.permissions?.includes(permission))throw new ForbiddenException('无此内容关联的维护权限');
    requireRoles(req,write?['MODERATOR']:['OPERATOR','MODERATOR']);return row;
  }
  @Get(':id') async list(@Req() req: AuthRequest,@Param('id',ParseUUIDPipe) id: string) {
    await this.source(req,id);
    const rows=await this.db.contentRelation.findMany({where:{OR:[{fromId:id},{toId:id}]},orderBy:[{rank:'asc'},{id:'asc'}]}),resources=await this.db.resource.findMany({where:{id:{in:rows.map(r=>r.fromId===id?r.toId:r.fromId)}},select:{id:true,title:true,kind:true,publishState:true}});
    return {items:rows.map(r=>({...r,incoming:r.toId===id,target:resources.find(t=>t.id===(r.fromId===id?r.toId:r.fromId))}))};
  }
  @Post() async save(@Req() req: AuthRequest,@Body() dto: RelationDto) {
    const source=await this.source(req,dto.fromId,true);
    if(source.kind!==dto.fromType||dto.fromId===dto.toId||!dto.reason.trim())throw new BadRequestException('请核查来源类型、关联目标与原因');
    if(dto.purpose&&dto.purpose!=='RELATED'&&(dto.fromType!=='TEACHER'||dto.type!=='ARTICLE'))throw new BadRequestException('名师介绍与专属解读须从名师档案关联文章');
    await this.discovery.publicItem(dto.toId,dto.type);
    const startsAt=dto.startsAt?new Date(dto.startsAt):null,endsAt=dto.endsAt?new Date(dto.endsAt):null;
    if(endsAt&&(endsAt<=new Date()||startsAt&&endsAt<=startsAt))throw new BadRequestException('关联截止时间须晚于开始时间及当前时间');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Resource" WHERE id IN (${dto.fromId},${dto.toId}) ORDER BY id FOR UPDATE`;
      if(dto.fromType==='TEACHER'&&dto.type==='COURSE'&&!await tx.course.findFirst({where:{id:dto.toId,teacherId:dto.fromId,status:'PUBLISHED'}}))throw new BadRequestException('代表课程须为该名师本人已发布课程');
      if(dto.fromType==='TEACHER'&&dto.type==='ARTICLE'){
        const article=await tx.article.findUnique({where:{id:dto.toId}});
        if(!article||article.status!=='PUBLISHED')throw new BadRequestException('请关联已发布文章');
        if(dto.purpose==='INTERPRETATION'&&article.visibility!=='MEMBER')throw new BadRequestException('会员专属解读必须关联会员文章');
        if(dto.purpose==='INTRODUCTION'&&(article.visibility!=='PUBLIC'||!Array.isArray(article.blocks)||!article.blocks.some((b:unknown)=>b&&typeof b==='object'&&['audio','video'].includes(String((b as {type?:string}).type)))))throw new BadRequestException('音视频介绍须关联含音频或视频的公开文章');
        if(dto.purpose==='INTRODUCTION')await validateArticleMedia(tx,article.blocks as ArticleMediaBlock[]);
      }
      const relationType=dto.fromType+'_'+dto.type+(dto.purpose&&dto.purpose!=='RELATED'?'_'+dto.purpose:''),before=await tx.contentRelation.findFirst({where:{fromId:dto.fromId,toId:dto.toId,...(dto.fromType==='TEACHER'&&dto.type==='ARTICLE'?{}:{relationType})}});
      if(!before&&await tx.contentRelation.count({where:{fromId:dto.toId,toId:dto.fromId}}))throw new ConflictException('已有反向关联，请从其来源内容调整顺序和期限');
      if(before&&before.version!==dto.expectedVersion||!before&&dto.expectedVersion)throw new ConflictException('关联版本已变化，请刷新后编辑');
      const data={rank:dto.rank,startsAt,endsAt,approvedBy:req.actor.id,relationType};
      const row=before?await tx.contentRelation.update({where:{id:before.id},data:{...data,version:{increment:1}}}):await tx.contentRelation.create({data:{...data,fromId:dto.fromId,toId:dto.toId,relationType}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'content.relate',resource:source.kind.toLowerCase(),resourceId:dto.fromId,changes:{toId:dto.toId,reason:dto.reason,version:row.version,relationType}}});return row;
    });
  }
  @Delete(':sourceId/:id') async remove(@Req() req: AuthRequest,@Param('sourceId',ParseUUIDPipe) sourceId: string,@Param('id',ParseUUIDPipe) id: string) {
    const source=await this.source(req,sourceId,true);
    return this.db.$transaction(async tx=>{
      if(!(await tx.contentRelation.deleteMany({where:{id,fromId:sourceId}})).count)throw new ConflictException('反向关联须由来源内容维护，或关联已删除');
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'content.unrelate',resource:source.kind.toLowerCase(),resourceId:sourceId,changes:{relationId:id}}});return {success:true};
    });
  }
}
