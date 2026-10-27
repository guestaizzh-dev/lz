import {FileInterceptor} from '@nestjs/platform-express';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { AdminGuard, requireRoles, UserGuard, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { MediaService } from './media.js';
import type { Prisma } from './generated/prisma/client.js';

class ReleaseDto {
  @IsString() @Length(1, 2000) @Matches(/\S/) description!: string;
  @IsOptional() @IsInt() @Min(1) @Max(3650) accessDays?: number | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) assetIds!: string[];
}

/** 数字商品：版本化资料包、付款后发放、按凭证取文件。 */
@Injectable()
export class DigitalGoods {
  constructor(private readonly db: Database, private readonly media: MediaService) {}

  async pack(releaseId: string) {
    const release = await this.db.digitalRelease.findUnique({ where: { id: releaseId } });
    if (!release) return null;
    const product = await this.db.product.findUnique({ where: { id: release.productId } });
    const links = await this.db.digitalReleaseAsset.findMany({ where: { releaseId }, orderBy: { position: 'asc' } });
    const assets = await this.db.mediaAsset.findMany({ where: { id: { in: links.map((l) => l.assetId) }, status: 'READY' } });
    return {
      title: (release.rightsSnapshot as {productTitle?:string}).productTitle ?? product?.title ?? '数字资料',
      releaseNo:release.releaseNo,
      description: release.description,
      accessDays: release.accessDays,
      files: links.map((link) => {
        const asset = assets.find((a) => a.id === link.assetId);
        return asset ? { id: asset.id, name: asset.name, mime: asset.mime, bytes: asset.bytes } : null;
      }).filter(Boolean),
    };
  }

  files(){return this.db.$queryRaw<{id:string;name:string;mime:string;bytes:number}[]>`SELECT id,name,mime,bytes FROM "MediaAsset" WHERE status='READY' AND visibility='PRIVATE' AND coalesce(variants->>'uploadPurpose','') NOT IN ('EVIDENCE_FILE','PUBLIC_IMAGE','FORUM_MEDIA','HOME_HERO') ORDER BY "createdAt" DESC,id DESC LIMIT 200`;}

  async checkRelease(id:string,store:Database|Prisma.TransactionClient=this.db){
    const links=await store.digitalReleaseAsset.findMany({where:{releaseId:id}});
    const assets=await store.mediaAsset.findMany({where:{id:{in:links.map(l=>l.assetId)},visibility:'PRIVATE',status:'READY'}});
    if(!links.length||links.length!==assets.length||assets.some(a=>['EVIDENCE_FILE','PUBLIC_IMAGE','FORUM_MEDIA','HOME_HERO'].includes(String((a.variants as {uploadPurpose?:string}|null)?.uploadPurpose))))throw new BadRequestException('资料包文件不完整或不可交付，请联系书院');
  }

  async mine(userId: string) {
    const rows = await this.db.digitalDelivery.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const items = [];
    for (const row of rows) {
      const pack = await this.pack(row.releaseId);
      if (pack) items.push({ id: row.id, startsAt: row.startsAt, expiresAt: row.expiresAt, revokedAt:row.revokedAt, firstAccessAt:row.firstAccessAt, orderId:(await this.db.tradeOrderItem.findUniqueOrThrow({where:{id:row.orderItemId}})).orderId, ...pack });
    }
    return { items };
  }

  file(deliveryId: string, assetId: string, req: AuthRequest) {
    return this.media.digitalFile(deliveryId, assetId, req);
  }

  async releases(productId: string) {
    const rows = await this.db.digitalRelease.findMany({ where: { productId }, orderBy: { releaseNo: 'desc' } });
    const result = [];
    for (const row of rows) {
      const pack = await this.pack(row.id);
      result.push({ id: row.id, releaseNo: row.releaseNo, description: row.description, accessDays: row.accessDays, files: pack?.files ?? [] });
    }
    return { items: result };
  }

  async createRelease(productId: string, actorId: string, dto: ReleaseDto) {
    const description = (dto.description ?? '').trim();
    const assetIds = [...new Set(dto.assetIds ?? [])];
    if (!description || !assetIds.length) throw new BadRequestException('请填写资料说明并选择至少一个文件');
    if (dto.accessDays !== undefined && dto.accessDays !== null && (!Number.isInteger(dto.accessDays) || dto.accessDays < 1 || dto.accessDays > 3650)) throw new BadRequestException('有效天数须在 1—3650 天之间');
    return this.db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException('商品不存在');
      if (product.type !== 'DIGITAL') throw new BadRequestException('只有数字商品可以配置资料包');
      const candidates = await tx.mediaAsset.findMany({where:{id:{in:assetIds},status:'READY',visibility:'PRIVATE'}}),assets=candidates.filter(a=>!['EVIDENCE_FILE','PUBLIC_IMAGE','FORUM_MEDIA','HOME_HERO'].includes(String((a.variants as {uploadPurpose?:string}|null)?.uploadPurpose)));
      if (assets.length !== assetIds.length) throw new BadRequestException('资料文件必须是媒体库中已就绪的私有文件');
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
      const last = await tx.digitalRelease.findFirst({ where: { productId }, orderBy: { releaseNo: 'desc' }, select: { releaseNo: true } });
      const release = await tx.digitalRelease.create({
        data: { productId, releaseNo: (last?.releaseNo ?? 0) + 1, description, accessDays: dto.accessDays ?? null, rightsSnapshot: { productTitle: product.title } },
      });
      await tx.digitalReleaseAsset.createMany({ data: assetIds.map((assetId, index) => ({ releaseId: release.id, assetId, position: index + 1 })) });
      if(!await tx.productSku.count({where:{productId}}))await tx.productSku.create({data:{productId,title:'标准资料',price:product.price,stock:0,active:true,digitalReleaseId:release.id}});
      else await tx.productSku.updateMany({where:{productId},data:{digitalReleaseId:release.id,version:{increment:1}}});
      await tx.auditLog.create({ data: { actorId, action: 'digital.release.create', resource: 'product', resourceId: productId, changes: { releaseId: release.id, releaseNo: release.releaseNo, files: assetIds.length } } });
      return { id: release.id, releaseNo: release.releaseNo };
    });
  }

  /** 付款确认后发放；同一订单项只发一次。 */
  async grant(tx: Prisma.TransactionClient, userId: string, orderItemId: string, releaseId: string, accessDays: number | null) {
    const existing = await tx.digitalDelivery.findUnique({ where: { orderItemId } });
    if (existing) return existing;
    const release = await tx.digitalRelease.findUnique({ where: { id: releaseId } });
    if (!release) throw new NotFoundException('数字资料版本不存在');
    const days = accessDays ?? release.accessDays;
    const startsAt = new Date();
    return tx.digitalDelivery.create({
      data: { userId, orderItemId, releaseId, startsAt, expiresAt: days ? new Date(startsAt.getTime() + days * 86400_000) : null, grantKey: 'digital:' + orderItemId },
    });
  }
}

@Controller('me/digital')
@UseGuards(UserGuard)
export class DigitalController {
  constructor(private readonly digital: DigitalGoods) {}

  @Get()
  mine(@Req() req: AuthRequest) { return this.digital.mine(req.actor.id); }

  @Post(':id/files/:assetId')
  file(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.digital.file(id, assetId, req);
  }
}

@Controller('admin/products')
@UseGuards(AdminGuard)
export class DigitalAdminController {
  constructor(private readonly digital: DigitalGoods,private readonly media:MediaService) {}

  @Post(':id/digital-files') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024,files:1}}))
  upload(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string,@UploadedFile() file:{originalname:string;mimetype:string;size:number;buffer:Buffer}){requireRoles(req,['OPERATOR']);return this.media.upload(req,file,true,'DIGITAL_FILE');}

  @Get(':id/digital-files') files(@Req() req:AuthRequest){requireRoles(req,['OPERATOR','MODERATOR']);return this.digital.files();}

  @Get(':id/digital-releases')
  list(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    requireRoles(req, ['OPERATOR', 'MODERATOR']);
    return this.digital.releases(id);
  }

  @Post(':id/digital-releases')
  create(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleaseDto) {
    requireRoles(req, ['OPERATOR']);
    return this.digital.createRelease(id, req.actor.id, dto);
  }
}
