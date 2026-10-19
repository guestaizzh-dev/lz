import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { MediaService } from './media.js';
import { Gifts } from './gifts.js';
import { AppleCommerceService } from './apple-commerce.js';
class GiftMappingDto {
  @IsUUID() offerId!:string;
  @IsString() @Matches(/^[\w-]+(?:\.[\w-]+)+$/) @Length(3,180) bundleId!:string;
  @IsIn(['Production','Sandbox']) environment!:string;
  @IsString() @Matches(/^[-\w.]{1,255}$/) externalProductId!:string;
  @IsInt() @Min(1) @Max(100000) priceMinor!:number;
  @IsString() @Length(2,500) @Matches(/\S/) reason!:string;
}
class GiftMappingStateDto { @IsUUID() id!:string; @IsInt() @Min(1) expectedVersion!:number; @IsBoolean() active!:boolean; @IsString() @Length(2,500) @Matches(/\S/) reason!:string; }
const safe = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? String(x) : x)));
class PackDto {
  @IsOptional()
  @IsUUID()
  id?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
  @IsString()
  @Length(1, 80)
  @Matches(/\S/)
  title!: string;
  @IsInt()
  @Min(100)
  @Max(100000)
  credits!: number;
  @IsBoolean()
  active!: boolean;
  @IsString()
  @Length(2, 500)
  @Matches(/\S/)
  reason!: string;
}
class GiftDto {
  @IsOptional()
  @IsUUID()
  id?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
  @IsString()
  @Length(1, 80)
  title!: string;
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  code!: string;
  @IsInt()
  @Min(1)
  @Max(10000)
  creditCost!: number;
  @IsBoolean()
  active!: boolean;
  @IsString()
  @Length(2, 500)
  @Matches(/\S/)
  reason!: string;
}
class ContractDto {
  @IsUUID()
  teacherId!: string;
  @IsUUID()
  partnerId!: string;
  @IsUUID()
  proofAssetId!: string;
  @IsString()
  @Length(2, 80)
  contractNo!: string;
  @IsInt()
  @Min(0)
  @Max(10000)
  rateBasisPoints!: number;
  @IsISO8601()
  startsAt!: string;
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
  @IsBoolean()
  verified!: boolean;
  @IsString()
  @Length(2, 500)
  @Matches(/\S/)
  reason!: string;
}
class BindingDto {
  @IsUUID()
  teacherId!: string;
  @IsUUID()
  contractId!: string;
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @IsBoolean()
  enabled!: boolean;
  @IsString()
  @Length(2, 500)
  @Matches(/\S/)
  reason!: string;
}
@Controller('admin/gifts/config')
@UseGuards(AdminGuard)
export class GiftsAdminController {
  constructor(
    private readonly db: Database,
    private readonly media: MediaService,
    private readonly giftsService: Gifts,
    private readonly apple: AppleCommerceService,
  ) {}
  @Get()
  async options() {
    return safe({
      packs: await this.db.giftCreditPack.findMany({ orderBy: { price: 'asc' } }),
      gifts: await this.db.virtualGift.findMany({ orderBy: { creditCost: 'asc' } }),
      bindings: await this.db.giftTeacherContract.findMany(),
      contracts: await this.db.partnerContract.findMany({
        where: { scopeSnapshot: { path: ['kind'], equals: 'GIFT' } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      teachers: await this.db.teacher.findMany({
        where: { status: 'PUBLISHED', userId: { not: null } },
        select: { id: true, name: true },
        take: 200,
      }),
      partners: await this.db.partner.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
        take: 200,
      }),
      salesReady: process.env.GIFT_SALES_ENABLED === 'true',
      offers:await this.db.saleOffer.findMany({where:{kind:'GIFT',active:true},orderBy:{createdAt:'desc'}}),
      mappings:await this.db.channelProductMapping.findMany({where:{channel:'APPLE_IAP',productType:'Consumable'},orderBy:{createdAt:'desc'}}),
    });
  }
  @Post('apple-mappings') async mapping(@Req() req:AuthRequest,@Body() dto:GiftMappingDto){
    requireRoles(req,['FINANCE']);if(process.env.NODE_ENV==='production'&&dto.environment!=='Production')throw new BadRequestException('正式服务不能配置沙箱收款');
    return this.db.$transaction(async tx=>{
      const {offer}=await this.giftsService.validateAppleOffer(dto.offerId,tx);if(offer.price!==BigInt(dto.priceMinor))throw new ConflictException('App Store人民币价格与充值包不一致');
      const appScope=dto.bundleId+':'+dto.environment;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${appScope+':'+dto.externalProductId},0))`;
      if(await tx.channelProductMapping.count({where:{channel:'APPLE_IAP',appScope,externalProductId:dto.externalProductId}}))throw new ConflictException('该Apple产品已绑定，不能改写历史购买版本');
      const row=await tx.channelProductMapping.create({data:{offerId:offer.id,channel:'APPLE_IAP',appScope,externalProductId:dto.externalProductId,productType:'Consumable',currency:'CNY',priceMinor:offer.price,minorExponent:2}});
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'gift.apple.mapping',resource:'channel_product_mapping',resourceId:row.id,reason:dto.reason.trim(),changes:{appScope,productId:row.externalProductId,amount:String(row.priceMinor)}}});return safe(row);
    });
  }
  @Post('apple-mappings/state') activation(@Req() req:AuthRequest,@Body() dto:GiftMappingStateDto){requireRoles(req,['FINANCE']);return this.apple.activate(dto.id,req,dto);}
  @Post('contracts/:id/proof') contractProof(@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthRequest){return this.media.giftProofTicket(id,req);}
  @Post('proof')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  proof(
    @Req()
    req: AuthRequest,
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    requireRoles(req, ['FINANCE']);
    return this.media.upload(req, file, true, 'EVIDENCE_FILE');
  }
  @Post('packs')
  async pack(
    @Req()
    req: AuthRequest,
    @Body()
    dto: PackDto,
  ) {
    requireRoles(req, ['FINANCE']);
    return this.db.$transaction(async (tx) => {
      if (dto.id) {
        await tx.$queryRaw`SELECT id FROM "GiftCreditPack" WHERE id=${dto.id} FOR UPDATE`;
        const old = await tx.giftCreditPack.findUniqueOrThrow({ where: { id: dto.id } });
        if (old.version !== dto.expectedVersion) throw new ConflictException('充值包已变化，请刷新');
      }
      if (dto.active && process.env.GIFT_SALES_ENABLED !== 'true')
        throw new BadRequestException('礼物收款与履约验收前不能开放充值包');
      const pack = dto.id
        ? await tx.giftCreditPack.update({
            where: { id: dto.id },
            data: {
              title: dto.title.trim(),
              credits: BigInt(dto.credits),
              price: BigInt(dto.credits),
              active: dto.active,
              version: { increment: 1 },
            },
          })
        : await tx.giftCreditPack.create({
            data: {
              title: dto.title.trim(),
              credits: BigInt(dto.credits),
              price: BigInt(dto.credits),
              active: dto.active,
            },
          });
      await tx.saleOffer.updateMany({
        where: { kind: 'GIFT', giftPackId: pack.id, active: true },
        data: { active: false, validUntil: new Date(), version: { increment: 1 } },
      });
      if (dto.active)
        await tx.saleOffer.create({
          data: {
            kind: 'GIFT',
            giftPackId: pack.id,
            price: pack.price,
            active: true,
            validFrom: new Date(),
            policySnapshot: {
              packId: pack.id,
              price: String(pack.price),
              title: pack.title,
              credits: String(pack.credits),
              version: pack.version,
              refundPolicy: '未消费余额可申请原路退款，已消费部分不自助退款；Apple交易由Apple审核。',
            },
          },
        });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'gift.pack.version',
          resource: 'gift_pack',
          resourceId: pack.id,
          reason: dto.reason,
          changes: { version: pack.version, active: pack.active },
        },
      });
      return safe(pack);
    });
  }
  @Post('catalog')
  async gift(
    @Req()
    req: AuthRequest,
    @Body()
    dto: GiftDto,
  ) {
    requireRoles(req, ['FINANCE']);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'gift.code:'+dto.code}))`;if(await tx.virtualGift.count({where:{code:dto.code,...(dto.id?{id:{not:dto.id}}:{})}}))throw new ConflictException('礼物编码已使用，请修改');
      if (dto.id) {
        await tx.$queryRaw`SELECT id FROM "VirtualGift" WHERE id=${dto.id} FOR UPDATE`;
        const old = await tx.virtualGift.findUniqueOrThrow({ where: { id: dto.id } });
        if (old.version !== dto.expectedVersion) throw new ConflictException('礼物已变化，请刷新');
      }
      const row = dto.id
        ? await tx.virtualGift.update({
            where: { id: dto.id },
            data: {
              title: dto.title.trim(),
              code: dto.code,
              creditCost: BigInt(dto.creditCost),
              active: dto.active,
              version: { increment: 1 },
            },
          })
        : await tx.virtualGift.create({
            data: { title: dto.title.trim(), code: dto.code, creditCost: BigInt(dto.creditCost), active: dto.active },
          });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'gift.catalog.edit',
          resource: 'virtual_gift',
          resourceId: row.id,
          reason: dto.reason,
          changes: { version: row.version, active: row.active },
        },
      });
      return safe(row);
    });
  }
  @Post('contracts')
  async contract(
    @Req()
    req: AuthRequest,
    @Body()
    dto: ContractDto,
  ) {
    requireRoles(req, ['FINANCE']);
    if (!dto.verified) throw new BadRequestException('请先核对合同双方、签署及分成费率');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Teacher" WHERE id=${dto.teacherId} FOR UPDATE`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'gift.contract:' + dto.contractNo}))`;
      const teacher = await tx.teacher.findFirst({
          where: { id: dto.teacherId, status: 'PUBLISHED', userId: { not: null }, isDemo: false },
        }),
        partner = await tx.partner.findFirst({ where: { id: dto.partnerId, status: 'ACTIVE' } }),
        proof = await tx.mediaAsset.findFirst({
          where: {
            id: dto.proofAssetId,
            status: 'READY',
            visibility: 'PRIVATE',
            variants: { path: ['uploadPurpose'], equals: 'EVIDENCE_FILE' },
          },
        });
      if (
        !teacher ||
        !partner ||
        !proof ||
        !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(proof.mime)
      )
        throw new BadRequestException('须选择真实已发布名师、有效合作方及私有合同附件');
      const startsAt = new Date(dto.startsAt),
        endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
      if (endsAt && endsAt <= startsAt) throw new BadRequestException('合同结束须晚于开始');
      const last = await tx.partnerContract.aggregate({
        where: { partnerId: dto.partnerId, contractNo: dto.contractNo },
        _max: { revision: true },
      });
      const contract = await tx.partnerContract.create({
        data: {
          partnerId: partner.id,
          contractNo: dto.contractNo,
          revision: (last._max.revision ?? 0) + 1,
          startsAt,
          endsAt,
          rateBasisPoints: dto.rateBasisPoints,
          feePolicy: { feeBearer: 'PLATFORM', chargebackBearer: 'PLATFORM', basis: 'GROSS' },
          settlementCycle: 'MONTH',
          proofAssetId: proof.id,
          scopeSnapshot: { kind: 'GIFT', teacherId: teacher.id, verified: true },
          approvedBy: req.actor.id,
        },
      });
      const binding = await tx.giftTeacherContract.upsert({
        where: { teacherId: teacher.id },
        create: { teacherId: teacher.id, contractId: contract.id, enabled: false, updatedBy: req.actor.id },
        update: { contractId: contract.id, enabled: false, updatedBy: req.actor.id, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'gift.contract.approve',
          resource: 'partner_contract',
          resourceId: contract.id,
          reason: dto.reason,
          changes: {
            teacherId: teacher.id,
            proofAssetId: proof.id,
            revision: contract.revision,
            rateBasisPoints: contract.rateBasisPoints,
          },
        },
      });
      return safe({ contract, binding });
    });
  }
  @Post('bindings')
  async binding(
    @Req()
    req: AuthRequest,
    @Body()
    dto: BindingDto,
  ) {
    requireRoles(req, ['FINANCE']);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "teacherId" FROM "GiftTeacherContract" WHERE "teacherId"=${dto.teacherId} FOR UPDATE`;const old = await tx.giftTeacherContract.findUniqueOrThrow({ where: { teacherId: dto.teacherId } });
      if (old.version !== dto.expectedVersion || old.contractId !== dto.contractId)
        throw new ConflictException('老师合同已变化，请刷新');
      const contract = await tx.partnerContract.findUniqueOrThrow({ where: { id: dto.contractId } });
      if (
        (
          contract.scopeSnapshot as {
            teacherId: string;
          }
        ).teacherId !== dto.teacherId
      )
        throw new BadRequestException('合同不属于该老师');
      if (
        dto.enabled &&
        (process.env.GIFT_SALES_ENABLED !== 'true' ||
          contract.startsAt > new Date() ||
          (contract.endsAt && contract.endsAt <= new Date()))
      )
        throw new BadRequestException('礼物功能未验收或合同不在有效期间');
      const row = await tx.giftTeacherContract.update({
        where: { teacherId: dto.teacherId, version: dto.expectedVersion },
        data: { enabled: dto.enabled, updatedBy: req.actor.id, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'gift.contract.binding',
          resource: 'teacher',
          resourceId: dto.teacherId,
          reason: dto.reason,
          changes: { contractId: dto.contractId, enabled: dto.enabled },
        },
      });
      return row;
    });
  }
}
