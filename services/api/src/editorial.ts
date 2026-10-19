import { publicContentScope } from './public-content.js';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors, UseGuards, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, Max } from 'class-validator';
import { AdminGuard, requireRoles } from './auth.js';
import type { AuthRequest } from './auth.js';
import { Database } from './database.js';
import { DiscoveryService } from './discovery.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.js';
class EvidenceDto {
  @IsIn(['ANNOTATION', 'LICENSE', 'SOURCE', 'CULTURAL', 'QUALITY', 'CREDENTIAL', 'LINEAGE']) kind!: string;
  @IsString() @Length(1, 150) title!: string;
  @IsString() @Length(1, 100) author!: string;
  @IsString() @Length(1, 150) edition!: string;
  @IsString() @Matches(/^https:\/\/[^\s]+$/) sourceUrl!: string;
  @IsString() @Length(1, 150) rightsHolder!: string;
  @IsString() @Length(1, 1000) licenseScope!: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) validFrom?: string;
  @IsOptional() @IsUUID() proofAssetId?: string;
}
class ReviewDto {
  @IsOptional() @IsBoolean() proofReviewed?: boolean;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['APPROVED', 'REJECTED']) state!: string;
  @IsString() @Length(1, 500) reason!: string;
}
class RelationDto {
  @IsUUID() toId!: string;
  @IsIn(['COURSE', 'LIVE']) type!: string;
  @IsInt() @Min(0) @Max(9999) rank!: number;
  @IsString() @Length(1, 500) reason!: string;
}
@Controller(['admin/articles/:id/editorial','admin/products/:id/editorial','admin/teachers/:id/editorial']) @UseGuards(AdminGuard)
export class EditorialController {
  constructor(private readonly db: Database, private readonly discovery: DiscoveryService, private readonly media:MediaService) {}
  private kind(req:AuthRequest){return req.originalUrl?.includes('/admin/products/')?'product':req.originalUrl?.includes('/admin/teachers/')?'teacher':'article';}
  private async source(id:string,req:AuthRequest){const row=this.kind(req)==='product'?await this.db.product.findUnique({where:{id}}):this.kind(req)==='teacher'?await this.db.teacher.findUnique({where:{id}}):await this.db.article.findUnique({where:{id}});if(!row)throw new NotFoundException('内容不存在');return row;}
  @Get() async list(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR', 'MODERATOR']); const source=await this.source(id,req);
    const bindings = await this.db.resourceEvidence.findMany({ where: { resourceId: id } });
    const evidence = await this.db.sourceEvidence.findMany({ where: { id: { in: bindings.map(b => b.evidenceId) } }, orderBy: { createdAt: 'desc' } });
    const relations = await this.db.contentRelation.findMany({ where: { fromId: id }, orderBy: { rank: 'asc' } });
    const resources = await this.db.resource.findMany({ where: { id: { in: relations.map(r => r.toId) } }, select: { id: true, title: true, kind: true, publishState: true } });
    return { isDemo:source.isDemo, evidence, relations: relations.map(r => ({ ...r, target: resources.find(i => i.id === r.toId) })) };
  }
  @Post('evidence-files') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:0}})) async uploadProof(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest,@UploadedFile() file:{buffer:Buffer;originalname:string;mimetype:string;size:number}){
    requireRoles(req,['OPERATOR']);await this.source(id,req);return this.media.upload(req,file,true,'EVIDENCE_FILE');
  }
  @Post('evidence/:evidenceId/proof') async proof(@Param('id',ParseUUIDPipe) id:string,@Param('evidenceId',ParseUUIDPipe) evidenceId:string,@Req() req:AuthRequest){
    requireRoles(req,['OPERATOR','MODERATOR']);await this.source(id,req);return this.media.evidenceTicket(id,evidenceId,req);
  }
  @Post('evidence') async addEvidence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EvidenceDto, @Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR']); await this.source(id,req);
    const kinds:Record<string,string[]>={article:['ANNOTATION','LICENSE','SOURCE'],product:['CULTURAL','QUALITY','LICENSE','SOURCE'],teacher:['CREDENTIAL','LINEAGE','LICENSE','SOURCE']};
    if(!kinds[this.kind(req)]!.includes(dto.kind))throw new BadRequestException('证据类型与内容不符');
    if([dto.title,dto.author,dto.edition,dto.rightsHolder,dto.licenseScope].some(v=>!v.trim()))throw new BadRequestException('来源资料不能为空白');
    const until = dto.validUntil ? new Date(dto.validUntil + 'T23:59:59+08:00') : null;
    if (until && (!Number.isFinite(until.valueOf()) || until <= new Date() || until.toISOString().slice(0, 10) !== dto.validUntil)) throw new BadRequestException('有效期须为未来的有效日期');
    const from=dto.validFrom?new Date(dto.validFrom+'T00:00:00+08:00'):null;
    if(from&&(!Number.isFinite(from.valueOf())||new Date(from.getTime()+8*3600000).toISOString().slice(0,10)!==dto.validFrom)||from&&until&&from>=until)throw new BadRequestException('授权生效日期或有效期无效');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Resource" WHERE id=${id} FOR UPDATE`;
      if(dto.proofAssetId&&!await tx.mediaAsset.findFirst({where:{id:dto.proofAssetId,uploaderId:req.actor.id,status:'READY',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}}))throw new BadRequestException('请上传本账号的来源证据文件');
      const row = await tx.sourceEvidence.create({ data: { ...dto, validFrom:from, validUntil: until, reviewState: 'PENDING' } });
      await tx.resourceEvidence.create({ data: { resourceId: id, evidenceId: row.id, purpose: dto.kind } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'evidence.create', resource: this.kind(req), resourceId: id, changes: { evidenceId: row.id } } });
      return row;
    });
  }
  @Post('evidence/:evidenceId/review') async review(@Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @Body() dto: ReviewDto, @Req() req: AuthRequest) {
    requireRoles(req, ['MODERATOR']); await this.source(id,req);
    if(!dto.reason.trim())throw new BadRequestException('请填写实际核查结果');
    if (!await this.db.resourceEvidence.findFirst({ where: { resourceId: id, evidenceId } })) throw new NotFoundException('来源证据不存在');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Resource" WHERE id=${id} FOR UPDATE`;
      const old=await tx.sourceEvidence.findUniqueOrThrow({where:{id:evidenceId}});
      if(dto.state==='APPROVED'){
        if(old.validUntil&&old.validUntil<=new Date())throw new BadRequestException('已过期证据不能审核通过，请提交新版本');
        if(old.proofAssetId){
          if(dto.proofReviewed!==true)throw new BadRequestException('请查看证据文件并确认已核对');
          if(!await tx.mediaAsset.findFirst({where:{id:old.proofAssetId,status:'READY',variants:{path:['uploadPurpose'],equals:'EVIDENCE_FILE'}}}))throw new BadRequestException('证据文件已经不可用');
        }
      }
      const result = await tx.sourceEvidence.updateMany({ where: { id: evidenceId, version: dto.expectedVersion }, data: { reviewState: dto.state, reviewerId: req.actor.id, reviewNote: dto.reason, version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('证据版本已变化');
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'evidence.review', resource: this.kind(req), resourceId: id, changes: { evidenceId, state: dto.state, reason: dto.reason, proofReviewed:dto.proofReviewed===true, previousVersion:old.version } } });
      return tx.sourceEvidence.findUniqueOrThrow({ where: { id: evidenceId } });
    });
  }
  @Post('relations') async relate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RelationDto, @Req() req: AuthRequest) {
    requireRoles(req, ['MODERATOR']); await this.source(id,req); await this.discovery.publicItem(dto.toId, dto.type);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Resource" WHERE id IN (${id},${dto.toId}) ORDER BY id FOR UPDATE`;
      if(await tx.contentRelation.count({where:{fromId:dto.toId,toId:id}}))throw new ConflictException('已有反向关联，请从来源内容维护');
      const relationType = this.kind(req).toUpperCase()+'_' + dto.type;
      await tx.$executeRaw`INSERT INTO "ContentRelation" ("fromId","toId","relationType",rank,"approvedBy") VALUES (${id},${dto.toId},${relationType},${dto.rank},${req.actor.id}) ON CONFLICT ("fromId","toId","relationType") DO UPDATE SET rank=EXCLUDED.rank,"approvedBy"=EXCLUDED."approvedBy",version="ContentRelation".version+1,"updatedAt"=now()`;
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'article.relate', resource: this.kind(req), resourceId: id, changes: { toId: dto.toId, reason: dto.reason } } });
      return tx.contentRelation.findFirstOrThrow({ where: { fromId: id, toId: dto.toId, relationType } });
    });
  }
  @Delete('relations/:relationId') async remove(@Param('id', ParseUUIDPipe) id: string, @Param('relationId', ParseUUIDPipe) relationId: string, @Req() req: AuthRequest) {
    requireRoles(req, ['MODERATOR']);
    return this.db.$transaction(async tx => {
      if ((await tx.contentRelation.deleteMany({ where: { id: relationId, fromId: id } })).count !== 1) throw new NotFoundException('关联不存在');
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'article.unrelate', resource: this.kind(req), resourceId: id, changes: { relationId } } });
      return { success: true };
    });
  }
}

class LivePublicationDto {
  @IsIn(['PUBLISHED', 'ARCHIVED']) state!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 500) summary!: string;
  @IsString() @Length(1, 500) reason!: string;
}
@Controller('admin/live-discovery') @UseGuards(AdminGuard)
export class LiveDiscoveryAdminController {
  constructor(private readonly db: Database, private readonly discovery: DiscoveryService) {}
  @Get() async list(@Req() req: AuthRequest) {
    requireRoles(req, ['OPERATOR', 'MODERATOR']);
    return this.db.resource.findMany({ where: { kind: 'LIVE' }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100 });
  }
  @Post(':id/publication') async publish(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LivePublicationDto, @Req() req: AuthRequest) {
    requireRoles(req, ['MODERATOR']);
    const room = await this.db.liveRoom.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('请先在数据工作台建立直播间');
    if (dto.state === 'PUBLISHED') {
      const teacher = await this.db.teacher.findFirst({ where: { id: room.teacherId, ...await publicContentScope(this.db) } });
      if (!teacher) throw new BadRequestException('请先发布主讲老师档案');
    }
    if (!dto.title.trim() || !dto.summary.trim()) throw new BadRequestException('直播标题和简介不能为空');
    return this.db.$transaction(async tx => {
      const result = await tx.resource.updateMany({ where: { id, kind: 'LIVE', version: dto.expectedVersion }, data: { title: dto.title.trim(), summary: dto.summary.trim(), publishState: dto.state, publishedAt: new Date(), version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('直播资料版本已变化，请刷新');
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'live.discovery.publish', resource: 'live', resourceId: id, changes: { state: dto.state, reason: dto.reason } } });
      return tx.resource.findUniqueOrThrow({ where: { id } });
    });
  }
}
