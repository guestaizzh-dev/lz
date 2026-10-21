import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
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

  private async pack(releaseId: string) {
    const release = await this.db.digitalRelease.findUnique({ where: { id: releaseId } });
    if (!release) return null;
    const product = await this.db.product.findUnique({ where: { id: release.productId } });
    const links = await this.db.digitalReleaseAsset.findMany({ where: { releaseId }, orderBy: { position: 'asc' } });
    const assets = await this.db.mediaAsset.findMany({ where: { id: { in: links.map((l) => l.assetId) }, status: 'READY' } });
    return {
      title: product?.title ?? '数字资料',
      description: release.description,
      accessDays: release.accessDays,
      files: links.map((link) => {
        const asset = assets.find((a) => a.id === link.assetId);
        return asset ? { id: asset.id, name: asset.name, mime: asset.mime, bytes: asset.bytes } : null;
      }).filter(Boolean),
    };
  }

  async mine(userId: string) {
    const rows = await this.db.digitalDelivery.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    const items = [];
    for (const row of rows) {
      const pack = await this.pack(row.releaseId);
      if (pack) items.push({ id: row.id, startsAt: row.startsAt, expiresAt: row.expiresAt, ...pack });
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
      const assets = await tx.mediaAsset.findMany({ where: { id: { in: assetIds }, status: 'READY', visibility: 'PRIVATE' }, select: { id: true } });
      if (assets.length !== assetIds.length) throw new BadRequestException('资料文件必须是媒体库中已就绪的私有文件');
      const last = await tx.digitalRelease.findFirst({ where: { productId }, orderBy: { releaseNo: 'desc' }, select: { releaseNo: true } });
      const release = await tx.digitalRelease.create({
        data: { productId, releaseNo: (last?.releaseNo ?? 0) + 1, description, accessDays: dto.accessDays ?? null, rightsSnapshot: { productTitle: product.title } },
      });
      await tx.digitalReleaseAsset.createMany({ data: assetIds.map((assetId, index) => ({ releaseId: release.id, assetId, position: index + 1 })) });
      await tx.productSku.updateMany({ where: { productId }, data: { digitalReleaseId: release.id } });
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
  constructor(private readonly digital: DigitalGoods) {}

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
