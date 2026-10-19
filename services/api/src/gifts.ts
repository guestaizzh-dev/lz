import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { AppleFact } from './apple-store.js';
import { AppleStoreService } from './apple-store.js';
import type { AppleTransactionState } from './generated/prisma/client.js';
import { Database } from './database.js';
import { AuthService, AdminGuard, UserGuard, requireRoles, type AuthRequest } from './auth.js';
import { PaymentChannels, type AppPaymentChannel } from './payment-channels.js';
import type { LiveService } from './live.js';
import type { WechatTransaction, WechatRefund } from './wechat-pay.js';
import { Prisma, type TradeOrder, type GiftLedger, type PaymentTransaction } from './generated/prisma/client.js';
const safe = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(safe(value)))
    .digest('hex');
class PackQuery {
  @IsIn(['ANDROID', 'IOS', 'WEB'])
  platform = 'WEB';
}
class GiftPage {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  size = 20;
}
class TopupDto extends PackQuery {
  @IsUUID()
  packId!: string;
  @IsUUID()
  requestKey!: string;
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  quoteHash!: string;
  @IsIn(['WECHAT_APP', 'ALIPAY_APP'])
  channel!: AppPaymentChannel;
  @IsBoolean()
  accepted!: boolean;
}
class GiveDto {
  @IsUUID()
  giftId!: string;
  @IsUUID()
  sessionId!: string;
  @IsUUID()
  requestKey!: string;
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @IsBoolean()
  accepted!: boolean;
}
class GiftRefundDto {
  @IsUUID()
  requestKey!: string;
  @IsString()
  @Length(2, 500)
  @Matches(/\S/)
  reason!: string;
}
class GiftRefundReview {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @IsIn(['APPROVE', 'REJECT', 'RETRY'])
  action!: string;
  @IsString()
  @Length(2, 500)
  @Matches(/\S/)
  reason!: string;
}
type PackSnapshot = {
  packId: string;
  title: string;
  credits: string;
  price: string;
  version: number;
};
@Injectable()
export class Gifts implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private working = false;
  constructor(
    private readonly db: Database,
    private readonly channels: PaymentChannels,
    private readonly auth: AuthService,
    @Inject('LIVE_SERVICE')
    private readonly live: LiveService,
    private readonly apple: AppleStoreService,
  ) {}
  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => void this.runJobs().catch(() => {}), 20000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  ready() {
    return process.env.GIFT_SALES_ENABLED === 'true' && this.channels.choices().some((c) => c.enabled);
  }
  async validateAppleOffer(offerId:string,store:Database|Prisma.TransactionClient=this.db){
    const offer=await store.saleOffer.findUnique({where:{id:offerId}});
    if(!offer||offer.kind!=='GIFT'||!offer.giftPackId||!offer.active||offer.currency!=='CNY')throw new BadRequestException('请选择已发布的礼物充值包');
    const pack=await store.giftCreditPack.findUniqueOrThrow({where:{id:offer.giftPackId}});
    if(!pack.active||pack.price!==offer.price||pack.credits!==offer.price||(offer.policySnapshot as {version:number}).version!==pack.version)throw new ConflictException('充值包已改版，请创建新产品映射');
    return {offer,pack};
  }
  async applePacks(userId:string){
    const configured=process.env.APPLE_IAP_ENABLED==='true',identity=configured?this.apple.identity():null;
    const rows=identity?await this.db.channelProductMapping.findMany({where:{channel:'APPLE_IAP',appScope:identity.appScope,productType:'Consumable',active:true},orderBy:{createdAt:'desc'}}):[];
    const items=[];
    for(const mapping of rows){
      try{const {offer,pack}=await this.validateAppleOffer(mapping.offerId);if(mapping.priceMinor!==offer.price)continue;
        items.push({id:pack.id,title:pack.title,credits:String(pack.credits),price:String(pack.price),mapping:{id:mapping.id,version:mapping.version,productId:mapping.externalProductId},quoteHash:hash({userId,mappingId:mapping.id,version:mapping.version,offerId:offer.id,credits:String(pack.credits),price:String(pack.price)})});
      }catch{/* Historic mappings remain available for receipt recovery, never new purchase. */}
    }
    return {items,enabled:configured&&process.env.GIFT_SALES_ENABLED==='true'&&process.env.APPLE_GIFT_SALES_ENABLED==='true'&&process.env.APPLE_NATIVE_PURCHASE_READY==='true',reason:'Apple内购价格须与商店一致；未完成的交易在登录原账号后恢复，退款由Apple审核。'};
  }
  async prepareApple(userId:string,binding:{appScope:string;accountToken:string},dto:{mappingId:string;expectedVersion:number;accepted:boolean;quoteHash?:string}){
    if(process.env.GIFT_SALES_ENABLED!=='true'||process.env.APPLE_GIFT_SALES_ENABLED!=='true'||process.env.APPLE_NATIVE_PURCHASE_READY!=='true')throw new ServiceUnavailableException('Apple礼物内购尚未开放');
    return this.db.$transaction(async tx=>{
      await this.userLock(tx,userId);const wallet=await this.wallet(tx,userId);if(wallet.systemHold||wallet.balance>=1000000n)throw new ConflictException('请先处理余额或渠道核查');
      await tx.$queryRaw`SELECT id FROM "ChannelProductMapping" WHERE id=${dto.mappingId} FOR SHARE`;
      const mapping=await tx.channelProductMapping.findFirst({where:{id:dto.mappingId,channel:'APPLE_IAP',appScope:binding.appScope,active:true,productType:'Consumable'}});
      if(!mapping||mapping.version!==dto.expectedVersion||!dto.accepted)throw new ConflictException('请刷新并确认充值与退款说明');
      const {offer,pack}=await this.validateAppleOffer(mapping.offerId,tx);
      if(mapping.priceMinor!==offer.price||dto.quoteHash!==hash({userId,mappingId:mapping.id,version:mapping.version,offerId:offer.id,credits:String(pack.credits),price:String(pack.price)}))throw new ConflictException('充值包或价格已变化，请重新确认');
      await tx.auditLog.create({data:{actorId:userId,action:'apple.gift.prepare',resource:'channel_product_mapping',resourceId:mapping.id,changes:{accepted:true,version:mapping.version,amount:String(mapping.priceMinor),quoteHash:dto.quoteHash}}});
      return {productId:mapping.externalProductId,appAccountToken:binding.accountToken,price:String(mapping.priceMinor),currency:'CNY',environment:this.apple.identity().environment};
    });
  }
  async userLock(tx: Prisma.TransactionClient, userId: string) {
    if (
      !(
        await tx.$queryRaw<
          {
            id: string;
          }[]
        >`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`
      ).length
    )
      throw new NotFoundException('账号不存在');
  }
  async wallet(tx: Prisma.TransactionClient, userId: string) {
    return tx.giftWallet.upsert({ where: { userId }, create: { userId }, update: {} });
  }
  async ledger(
    tx: Prisma.TransactionClient,
    userId: string,
    eventKey: string,
    delta: bigint,
    kind: string,
    extra: Omit<
      Prisma.GiftLedgerUncheckedCreateInput,
      'walletId' | 'eventKey' | 'delta' | 'kind' | 'balanceAfter'
    > = {},
  ) {
    const old = await tx.giftLedger.findUnique({ where: { eventKey } });
    if (old) return old;
    const wallet = await this.wallet(tx, userId),
      balance = wallet.balance + delta;
    if (balance < 0n) throw new ConflictException('礼物余额不足，请先充值；免费积分不能用于赠礼');
    const row = await tx.giftLedger.create({
      data: { walletId: wallet.id, eventKey, delta, kind, balanceAfter: balance, ...extra },
    });
    await tx.giftWallet.update({
      where: { id: wallet.id },
      data: { balance, version: { increment: 1 }, updatedAt: new Date() },
    });
    return row;
  }
  async post(
    tx: Prisma.TransactionClient,
    key: string,
    description: string,
    entries: {
      accountCode: string;
      debit?: bigint;
      credit?: bigint;
      userId?: string;
      partnerId?: string;
    }[],
    ids: {
      orderId?: string;
      transactionId?: string;
      refundId?: string;
      reversalOfId?: string;
    } = {},
  ) {
    if (await tx.financeJournal.findUnique({ where: { eventKey: key } })) return;
    const journal = await tx.financeJournal.create({
      data: { eventKey: key, kind: 'GIFT', description, currency: 'CNY', postedAt: new Date(), ...ids },
    });
    await tx.financeEntry.createMany({
      data: entries
        .filter((e) => (e.debit ?? 0n) + (e.credit ?? 0n) > 0n)
        .map((e) => ({ journalId: journal.id, ...e })),
    });
  }
  private receivable(channel: string) {
    if (channel === 'APPLE_IAP') return 'APPLE_RECEIVABLE';
    if (channel === 'ALIPAY_APP') return 'ALIPAY_RECEIVABLE';
    if (channel === 'WECHAT_APP') return 'WECHAT_RECEIVABLE';
    throw new BadRequestException('原支付渠道无效');
  }
  async balance(userId: string, q: GiftPage) {
    const wallet = await this.db.giftWallet.findUnique({ where: { userId } }),
      where = { walletId: wallet?.id ?? '' };
    return safe({
      balance: wallet?.balance ?? 0n,
      systemHold: wallet?.systemHold ?? false,
      items: await this.db.giftLedger.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.size,
        take: q.size,
        select: {
          id: true,
          delta: true,
          kind: true,
          balanceAfter: true,
          createdAt: true,
          snapshot: true,
          orderItemId: true,
        },
      }),
      total: await this.db.giftLedger.count({ where }),
      policy:
        '100书香点=人民币1元，仅可赠礼；与免费积分独立，不设过期。未消费余额可申请原路退款，已赠礼部分不自助退款；Apple交易由Apple审核。',
    });
  }
  async packs(userId: string, platform: string) {
    const rows = await this.db.giftCreditPack.findMany({
      where: { active: true },
      orderBy: { price: 'asc' },
      take: 20,
    });
    return safe({
      items: rows.map((p) => ({
        id: p.id,
        title: p.title,
        credits: p.credits,
        price: p.price,
        version: p.version,
        quoteHash: hash({ userId, platform, id: p.id, version: p.version, credits: p.credits, price: p.price }),
      })),
      enabled: platform === 'ANDROID' && this.ready(),
      channels: this.channels.choices(),
      reason:
        platform === 'IOS'
          ? '请使用本页Apple内购入口；不支持从其他渠道绕过Apple购买'
          : platform === 'WEB'
            ? '请在App中购买礼物余额'
            : this.ready()
              ? ''
              : '礼物收款与原生支付尚未开通，暂不充值',
    });
  }
  private async owned(id: string, userId: string) {
    const row = await this.db.tradeOrder.findFirst({ where: { id, userId, kind: 'GIFT' } });
    if (!row) throw new NotFoundException('礼物余额订单不存在');
    return row;
  }
  async detail(id: string, userId: string) {
    const row = await this.owned(id, userId),
      item = await this.db.tradeOrderItem.findFirstOrThrow({ where: { orderId: id } }),
      refunds = await this.db.refund.findMany({ where: { orderId: id }, orderBy: { createdAt: 'desc' } }),
      payment = await this.db.paymentTransaction.findFirst({ where: { orderId: id, disposition: 'ACCEPTED' } }),
      credit = payment
        ? await this.db.giftLedger.findFirst({ where: { paymentTransactionId: payment.id, kind: 'PURCHASE' } })
        : null,
      remaining = credit ? credit.delta - (await this.used(this.db, credit.id)) : 0n,
      attempt = await this.db.paymentAttempt.findFirst({ where: { orderId: id }, orderBy: { createdAt: 'desc' } });
    return safe({
      id: row.id,
      orderNo: row.orderNo,
      state: row.state,
      amount: row.payableTotal,
      paidAmount: row.paidTotal,
      refundedAmount: row.refundedTotal,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      pack: item.itemSnapshot,
      channel: (
        row.pricingSnapshot as {
          channel: string;
        }
      ).channel,
      canPay:
        row.state === 'PENDING' &&
        row.expiresAt > new Date() &&
        this.ready() &&
        (!attempt || (!!attempt.lastQueriedAt && attempt.lastQueriedAt >= attempt.updatedAt && !attempt.failureCode)),
      refundableCredits: remaining,
      canRefund:
        !!payment &&
        payment.channel !== 'APPLE_IAP' &&
        remaining > 0n &&
        !refunds.some((r) => !['SUCCEEDED', 'REJECTED', 'CANCELLED', 'REVERSED'].includes(r.state)),
      refunds: refunds.map((r) => ({
        id: r.id,
        state: r.state,
        version: r.version,
        amount: r.requestedAmount,
        reason: r.description,
        reviewNote: r.reviewNote,
      })),
    });
  }
  async orders(userId: string, q: GiftPage) {
    const where = { userId, kind: 'GIFT' },
      rows = await this.db.tradeOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.size,
        skip: (q.page - 1) * q.size,
      });
    return {
      items: await Promise.all(rows.map((r) => this.detail(r.id, userId))),
      total: await this.db.tradeOrder.count({ where }),
    };
  }
  async checkout(userId: string, dto: TopupDto) {
    if (
      !dto.accepted ||
      dto.platform !== 'ANDROID' ||
      !this.ready() ||
      !this.channels.resolve(dto.channel).availability().enabled
    )
      throw new BadRequestException('请在已开通的Android渠道确认余额与退款说明后充值');
    await this.auth.rateLimit('gift-checkout:' + userId, 30, 60000);
    const id = await this.db.$transaction(async (tx) => {
      await this.userLock(tx, userId);
      const old = await tx.tradeOrder.findFirst({ where: { userId, requestKey: dto.requestKey } });
      if (old) {
        if (old.kind !== 'GIFT' || old.requestHash !== hash(dto)) throw new ConflictException('充值编号已用于其他请求');
        return old.id;
      }
      if (await tx.tradeOrder.count({ where: { userId, kind: 'GIFT', state: 'PENDING' } }))
        throw new ConflictException('请先处理待支付的礼物余额订单');
      const wallet = await this.wallet(tx, userId);
      if (wallet.systemHold) throw new ForbiddenException('礼物余额存在渠道撤销待核查，请联系书院');
      if (wallet.balance >= 1000000n) throw new BadRequestException('余额较多，请使用或退款后再充值');
      await tx.$queryRaw`SELECT id FROM "GiftCreditPack" WHERE id=${dto.packId} FOR SHARE`;const p = await tx.giftCreditPack.findFirst({ where: { id: dto.packId, active: true } });
      if (
        !p ||
        dto.quoteHash !==
          hash({ userId, platform: dto.platform, id: p.id, version: p.version, credits: p.credits, price: p.price })
      )
        throw new ConflictException('充值包或价格已变化，请刷新确认');
      const snapshot: PackSnapshot = {
          packId: p.id,
          title: p.title,
          credits: String(p.credits),
          price: String(p.price),
          version: p.version,
        },
        offer = await tx.saleOffer.findFirst({
          where: { kind: 'GIFT', giftPackId: p.id, active: true, price: p.price },
          orderBy: { createdAt: 'desc' },
        });
      if (!offer) throw new ConflictException('充值包售卖版本尚未发布');
      const order = await tx.tradeOrder.create({
        data: {
          orderNo: 'G' + randomUUID().replaceAll('-', '').slice(0, 31),
          userId,
          kind: 'GIFT',
          requestKey: dto.requestKey,
          requestHash: hash(dto),
          currency: 'CNY',
          subtotal: p.price,
          payableTotal: p.price,
          pricingSnapshot: { platform: 'ANDROID', channel: dto.channel, pack: snapshot },
          quoteHash: dto.quoteHash,
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      });
      await tx.tradeOrderItem.create({
        data: {
          orderId: order.id,
          lineNo: 1,
          offerId: offer.id,
          quantity: 1,
          unitPrice: p.price,
          subtotal: p.price,
          payable: p.price,
          itemSnapshot: snapshot,
          benefitSnapshot: { credits: String(p.credits) },
          state: 'PENDING',
        },
      });
      await tx.outboxJob.create({
        data: {
          kind: 'GIFT_PAYMENT_CHECK',
          aggregateType: 'GIFT_ORDER',
          aggregateId: order.id,
          eventKey: 'gift.expire:' + order.id,
          payload: {},
          availableAt: order.expiresAt,
        },
      });
      return order.id;
    });
    return this.detail(id, userId);
  }
  async payment(id: string, userId: string) {
    const initial = await this.owned(id, userId),
      channel = (
        initial.pricingSnapshot as {
          channel: AppPaymentChannel;
        }
      ).channel,
      adapter = this.channels.resolve(channel);
    if (!this.ready() || !adapter.availability().enabled) throw new ServiceUnavailableException('此充值渠道暂未开通');
    const attempt = await this.db.$transaction(async (tx) => {
      await this.userLock(tx, userId);
      await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${id} FOR UPDATE`;
      const order = await tx.tradeOrder.findUniqueOrThrow({ where: { id } });
      if (order.state !== 'PENDING' || order.expiresAt <= new Date())
        throw new ConflictException('订单已支付或过期，请查询订单');
      const old = await tx.paymentAttempt.findFirst({where:{orderId:id}});
      if(old){
        if(!old.lastQueriedAt||old.lastQueriedAt<old.updatedAt||old.failureCode||old.state==='SUCCEEDED')throw new ConflictException('已有支付尝试，请先查询结果，勿重复充值');
        return tx.paymentAttempt.update({where:{id:old.id},data:{lastQueriedAt:null,failureCode:null,updatedAt:new Date()}});
      }
      return tx.paymentAttempt.create({
        data: {
          orderId: id,
          channel,
          requestKey: 'gift.pay:' + id,
          amount: order.payableTotal,
          currency: 'CNY',
          expiresAt: order.expiresAt,
          state: 'PENDING',
          lastQueriedAt: null,
        },
      });
    });
    try {
      const orderInfo = await adapter.prepay(
        initial.orderNo,
        '书院书香点余额',
        Number(initial.payableTotal),
        initial.expiresAt,
      );
      return { provider: channel === 'ALIPAY_APP' ? 'alipay' : 'wxpay', channel, orderInfo };
    } catch {
      await this.db.paymentAttempt.update({
        where: { id: attempt.id },
        data: { failureCode: 'PROVIDER_RESULT_UNKNOWN' },
      });
      throw new ServiceUnavailableException('支付结果待查询，勿重复充值');
    }
  }
  async confirmPayment(
    data: WechatTransaction,
    callback?: {
      id: string;
      payloadHash: string;
    },
    channel: AppPaymentChannel = 'WECHAT_APP',
  ) {
    const identity = this.channels.resolve(channel).identity();
    if (
      data.appid !== identity.appid ||
      data.mchid !== identity.mchid ||
      data.trade_type !== 'APP' ||
      data.trade_state !== 'SUCCESS' ||
      !data.transaction_id ||
      data.transaction_id.length > 128 ||
      !Number.isSafeInteger(data.amount?.total) ||
      data.amount!.total <= 0 ||
      data.amount!.currency !== 'CNY' ||
      !data.success_time ||
      !Number.isFinite(Date.parse(data.success_time)) ||
      Date.parse(data.success_time) > Date.now() + 300000
    )
      throw new BadRequestException('礼物收款身份、币种或金额无效');
    const initial = await this.db.tradeOrder.findUnique({ where: { orderNo: data.out_trade_no } });
    if (!initial || initial.kind !== 'GIFT') throw new NotFoundException('礼物订单不存在');
    return this.db.$transaction(async (tx) => {
      await this.userLock(tx, initial.userId);
      await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${initial.id} FOR UPDATE`;
      const order = await tx.tradeOrder.findUniqueOrThrow({ where: { id: initial.id } }),
        item = await tx.tradeOrderItem.findFirstOrThrow({ where: { orderId: order.id } }),
        old = await tx.paymentTransaction.findFirst({
          where: { channel, appScope: identity.appid, externalTransactionId: data.transaction_id! },
        });
      if (old) {
        if (old.orderId !== order.id || old.amount !== BigInt(data.amount!.total))
          throw new ConflictException('该渠道交易已用于其他收款');
        return { disposition: old.disposition };
      }
      const accepted = await tx.paymentTransaction.findFirst({ where: { orderId: order.id, disposition: 'ACCEPTED' } }),
        attempt = await tx.paymentAttempt.findFirst({ where: { orderId: order.id, channel } }),
        user = await tx.user.findUniqueOrThrow({ where: { id: order.userId } }),
        amount = BigInt(data.amount!.total),
        paidAt = new Date(data.success_time!),
        stored = (
          order.pricingSnapshot as {
            channel: string;
          }
        ).channel;
      const disposition =
        amount !== order.payableTotal
          ? 'AMOUNT_MISMATCH'
          : accepted
            ? 'DUPLICATE'
            : stored !== channel || !attempt || order.state === 'CLOSED' || paidAt > order.expiresAt
              ? 'LATE'
              : user.status !== 'ACTIVE'
                ? 'REFUND_REQUIRED'
                : 'ACCEPTED';
      const payment = await tx.paymentTransaction.create({
        data: {
          attemptId: attempt?.id,
          orderId: order.id,
          channel,
          appScope: identity.appid,
          externalTransactionId: data.transaction_id!,
          amount,
          currency: 'CNY',
          verifiedAt: new Date(),
          paidAt,
          disposition,
          receiptHash: hash(data),
        },
      });
      await this.post(
        tx,
        'gift.payment:' + payment.id,
        '礼物余额可信收款',
        [
          { accountCode: this.receivable(channel), debit: amount, userId: order.userId },
          {
            accountCode: disposition === 'ACCEPTED' ? 'GIFT_CREDIT_LIABILITY' : 'GIFT_REFUND_PAYABLE',
            credit: amount,
            userId: order.userId,
          },
        ],
        { orderId: order.id, transactionId: payment.id },
      );
      if (disposition === 'ACCEPTED') {
        const credits = BigInt(
          (
            item.benefitSnapshot as {
              credits: string;
            }
          ).credits,
        );
        if (credits !== amount) throw new ConflictException('充值版本金额与书香点不一致');
        await this.ledger(tx, order.userId, 'gift.credit:' + payment.id, credits, 'PURCHASE', {
          orderItemId: item.id,
          paymentTransactionId: payment.id,
          snapshot: item.itemSnapshot as Prisma.InputJsonValue,
        });
        await tx.tradeOrder.update({
          where: { id: order.id },
          data: { state: 'COMPLETED', paidTotal: amount, paidAt, completedAt: new Date(), version: { increment: 1 } },
        });
        await tx.tradeOrderItem.update({ where: { id: item.id }, data: { state: 'DELIVERED' } });
      } else {
        if (!accepted)
          await tx.tradeOrder.update({
            where: { id: order.id },
            data: { state: 'CLOSED', closedAt: new Date(), closeReason: disposition, version: { increment: 1 } },
          });
        const refund = await tx.refund.create({
          data: {
            orderId: order.id,
            userId: order.userId,
            requestKey: 'gift.anomaly:' + payment.id,
            kind: 'REFUND_ONLY',
            state: 'REFUNDING',
            requestedAmount: amount,
            approvedAmount: amount,
            reasonCode: disposition,
            description: '礼物异常收款自动原路补偿，未增加可用余额',
            paymentTransactionId: payment.id,
            channelRequestKey: 'R' + randomUUID().replaceAll('-', '').slice(0, 31),
          },
        });
        await tx.refundItem.create({
          data: { refundId: refund.id, orderItemId: item.id, quantity: 1, amount, revokeQuantity: 0 },
        });
        await this.refundJob(tx, refund.id);
      }
      if (attempt)
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { state: 'SUCCEEDED', failureCode: null } });
      if (callback)
        await tx.providerCallback.create({
          data: {
            provider: channel,
            appScope: identity.appid,
            externalEventId: callback.id,
            kind: 'TRANSACTION.SUCCESS',
            payloadHash: callback.payloadHash,
            payloadStorageRef: 'sha256:' + callback.payloadHash,
            signatureVerified: true,
            state: 'HANDLED',
            handledAt: new Date(),
          },
        });
      await tx.outboxJob.updateMany({
        where: { eventKey: 'gift.expire:' + order.id },
        data: { state: 'DONE', completedAt: new Date(), lockedUntil: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: order.userId,
          action: 'gift.payment.confirm',
          resource: 'trade_order',
          resourceId: order.id,
          changes: { paymentId: payment.id, disposition, channel },
        },
      });
      return { disposition };
    });
  }
  async used(tx: Database | Prisma.TransactionClient, creditId: string) {
    const rows = await tx.$queryRaw<
      {
        used: bigint;
      }[]
    >`SELECT COALESCE(sum(CASE WHEN "reversalOfId" IS NULL THEN credits ELSE -credits END),0)::bigint AS used FROM "GiftCreditAllocation" WHERE "creditLedgerId"=${creditId}`;
    return rows[0]?.used ?? 0n;
  }
  private async contract(tx: Database | Prisma.TransactionClient, teacherId: string) {
    await tx.$queryRaw`SELECT id FROM "GiftTeacherContract" WHERE "teacherId"=${teacherId} FOR SHARE`;const binding = await tx.giftTeacherContract.findUnique({ where: { teacherId } });
    if (!binding?.enabled) throw new ForbiddenException('该老师尚未开通礼物');
    const contract = await tx.partnerContract.findUniqueOrThrow({ where: { id: binding.contractId } }),
      partner = await tx.partner.findUniqueOrThrow({ where: { id: contract.partnerId } }),
      scope = contract.scopeSnapshot as {
        teacherId?: string;
        kind?: string;
      },
      fees = contract.feePolicy as {
        feeBearer?: string;
        chargebackBearer?: string;
      };
    if (
      partner.status !== 'ACTIVE' ||
      scope.teacherId !== teacherId ||
      scope.kind !== 'GIFT' ||
      fees.feeBearer !== 'PLATFORM' ||
      fees.chargebackBearer !== 'PLATFORM' ||
      contract.startsAt > new Date() ||
      (contract.endsAt && contract.endsAt <= new Date())
    )
      throw new ForbiddenException('礼物合作授权已到期或暂停');
    return contract;
  }
  async catalog(sessionId: string, userId: string) {
    const session = await this.live.access(sessionId, userId),
      room = await this.db.liveRoom.findUniqueOrThrow({ where: { id: session.roomId } });
    let available = session.state === 'LIVE' && process.env.GIFT_SALES_ENABLED === 'true';
    try {
      await this.contract(this.db, room.teacherId);
    } catch {
      available = false;
    }
    return safe({
      available,
      items: await this.db.virtualGift.findMany({
        where: { active: true },
        orderBy: { creditCost: 'asc' },
        take: 20,
        select: { id: true, title: true, code: true, creditCost: true, version: true },
      }),
    });
  }
  async give(userId: string, dto: GiveDto) {
    if (!dto.accepted) throw new BadRequestException('请确认本次赠礼与消费规则');
    await this.auth.rateLimit('gift-give:' + userId, 30, 60000);
    return this.db.$transaction(async (tx) => {
      await this.userLock(tx, userId);
      const wallet = await this.wallet(tx, userId),
        key = 'gift.give:' + userId + ':' + dto.requestKey,
        old = await tx.giftLedger.findUnique({ where: { eventKey: key } });
      if (old) {
        if (old.walletId !== wallet.id || old.requestHash !== hash(dto))
          throw new ConflictException('赠礼编号已用于不同请求');
        return safe({ id: old.id, balance: old.balanceAfter, gift: old.snapshot });
      }
      if (wallet.systemHold || process.env.GIFT_SALES_ENABLED !== 'true')
        throw new ForbiddenException('礼物余额暂不可用，请联系书院核查');
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id=${dto.sessionId} FOR SHARE`;
      const session = await this.live.access(dto.sessionId, userId, tx);
      if (session.state !== 'LIVE') throw new ConflictException('仅直播中可以赠礼');
      const room = await tx.liveRoom.findUniqueOrThrow({ where: { id: session.roomId } }),
        teacher = await tx.teacher.findUniqueOrThrow({ where: { id: room.teacherId } });
      if (teacher.userId === userId) throw new BadRequestException('不能给自己负责的直播赠礼');
      await tx.$queryRaw`SELECT id FROM "VirtualGift" WHERE id=${dto.giftId} FOR SHARE`;const contract = await this.contract(tx, teacher.id),
        gift = await tx.virtualGift.findFirst({ where: { id: dto.giftId, active: true } });
      if (!gift || gift.version !== dto.expectedVersion) throw new ConflictException('礼物或价格已变化，请刷新确认');
      const cost = gift.creditCost * BigInt(dto.quantity);
      if (cost > 100000n || cost <= 0n) throw new BadRequestException('单次赠礼超出额度');
      const snapshot = {
          title: gift.title,
          code: gift.code,
          creditCost: String(gift.creditCost),
          quantity: dto.quantity,
          contractId: contract.id,
          rateBasisPoints: contract.rateBasisPoints,
        },
        debit = await this.ledger(tx, userId, key, -cost, 'GIVE', {
          giftId: gift.id,
          quantity: dto.quantity,
          sessionId: dto.sessionId,
          requestHash: hash(dto),
          snapshot,
        });
      let remaining = cost,
        allocated = 0n,
        partnerTotal = 0n;
      for (const credit of await tx.giftLedger.findMany({
        where: { walletId: wallet.id, kind: 'PURCHASE', delta: { gt: 0 } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) {
        const usable = credit.delta - (await this.used(tx, credit.id));
        if (usable <= 0n) continue;
        const take = usable < remaining ? usable : remaining,
          share =
            ((allocated + take) * BigInt(contract.rateBasisPoints)) / 10000n -
            (allocated * BigInt(contract.rateBasisPoints)) / 10000n;
        await tx.giftCreditAllocation.create({
          data: {
            debitLedgerId: debit.id,
            creditLedgerId: credit.id,
            credits: take,
            allocatedPaidMinor: take,
            allocatedFeeMinor: 0n,
            partnerAmountMinor: share,
            currency: 'CNY',
            contractId: contract.id,
          },
        });
        allocated += take;
        partnerTotal += share;
        remaining -= take;
        if (!remaining) break;
      }
      if (remaining) throw new ConflictException('购买来源余额不足，不能使用积分或手工余额赠礼');
      await this.post(tx, 'gift.consume:' + debit.id, '直播礼物消费与合同分成', [
        { accountCode: 'GIFT_CREDIT_LIABILITY', debit: cost, userId },
        { accountCode: 'GIFT_PARTNER_PAYABLE', credit: partnerTotal, partnerId: contract.partnerId },
        { accountCode: 'GIFT_REVENUE', credit: cost - partnerTotal },
      ]);
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'gift.give',
          resource: 'live',
          resourceId: session.id,
          changes: {
            ledgerId: debit.id,
            credits: String(cost),
            contractId: contract.id,
            partnerAmount: String(partnerTotal),
          },
        },
      });
      return safe({ id: debit.id, balance: debit.balanceAfter, gift: snapshot });
    });
  }
  async feed(sessionId: string, userId: string) {
    await this.live.access(sessionId, userId);
    const rows = await this.db.giftLedger.findMany({
      where: { sessionId, kind: 'GIVE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    return safe({ items: rows.map((r) => ({ id: r.id, gift: r.snapshot, createdAt: r.createdAt })) });
  }
  async deliverApple(
    tx: Prisma.TransactionClient,
    row: AppleTransactionState,
    fact: AppleFact,
    userId: string,
    oldRevoked: Date | null | undefined,
  ) {
    const review = (issueCode: string) =>
      tx.appleTransactionState.update({ where: { id: row.id }, data: { state: 'REVIEW', issueCode } });
    if (!row.paymentId) {
      const mapping = await tx.channelProductMapping.findFirst({
        where: { channel: 'APPLE_IAP', appScope: row.appScope, externalProductId: fact.productId },
      });
      if (
        !mapping ||
        mapping.productType !== 'Consumable' ||
        mapping.priceMinor !== fact.amount ||
        mapping.currency !== fact.currency ||
        !mapping.activatedAt ||
        fact.purchasedAt < mapping.activatedAt ||
        (!mapping.active && (!mapping.deactivatedAt || fact.purchasedAt > mapping.deactivatedAt))
      )
        return review('GIFT_MAPPING_MISMATCH');
      const offer = await tx.saleOffer.findUniqueOrThrow({ where: { id: mapping.offerId } }),
        snapshot = offer.policySnapshot as unknown as PackSnapshot;
      if (
        offer.kind !== 'GIFT' ||
        !offer.giftPackId ||
        !snapshot.credits ||
        BigInt(snapshot.credits) !== fact.amount ||
        (offer.validFrom && fact.purchasedAt < offer.validFrom) ||
        (offer.validUntil && fact.purchasedAt >= offer.validUntil)
      )
        return review('GIFT_OFFER_NOT_VALID_AT_PURCHASE');
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } }),
        disposition = user.status === 'ACTIVE' ? 'ACCEPTED' : 'REFUND_REQUIRED';
      const order = await tx.tradeOrder.create({
        data: {
          orderNo: 'I' + randomUUID().replaceAll('-', '').slice(0, 31),
          userId,
          kind: 'GIFT',
          requestKey: 'apple:' + row.appScope + ':' + fact.transactionId,
          requestHash: hash(snapshot),
          state: disposition === 'ACCEPTED' ? 'COMPLETED' : 'CLOSED',
          currency: 'CNY',
          subtotal: fact.amount,
          payableTotal: fact.amount,
          paidTotal: fact.amount,
          paidAt: fact.purchasedAt,
          expiresAt: fact.purchasedAt,
          completedAt: disposition === 'ACCEPTED' ? new Date() : null,
          closedAt: disposition === 'ACCEPTED' ? null : new Date(),
          closeReason: disposition === 'ACCEPTED' ? null : disposition,
          pricingSnapshot: { platform: 'IOS', channel: 'APPLE_IAP', pack: snapshot },
          quoteHash: hash(snapshot),
        },
      });
      const item = await tx.tradeOrderItem.create({
          data: {
            orderId: order.id,
            lineNo: 1,
            offerId: offer.id,
            quantity: 1,
            unitPrice: fact.amount,
            subtotal: fact.amount,
            payable: fact.amount,
            itemSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            benefitSnapshot: { credits: snapshot.credits },
            state: disposition === 'ACCEPTED' ? 'DELIVERED' : 'CLOSED',
          },
        }),
        attempt = await tx.paymentAttempt.create({
          data: {
            orderId: order.id,
            channel: 'APPLE_IAP',
            mappingId: mapping.id,
            requestKey: 'apple.gift:' + row.id,
            state: 'SUCCEEDED',
            amount: fact.amount,
            currency: 'CNY',
            expiresAt: fact.purchasedAt,
            lastQueriedAt: new Date(),
          },
        }),
        payment = await tx.paymentTransaction.create({
          data: {
            attemptId: attempt.id,
            orderId: order.id,
            channel: 'APPLE_IAP',
            appScope: row.appScope,
            externalTransactionId: fact.transactionId,
            originalTransactionId: fact.originalTransactionId,
            amount: fact.amount,
            currency: 'CNY',
            verifiedAt: new Date(),
            paidAt: fact.purchasedAt,
            disposition,
            receiptHash: hash(fact),
          },
        });
      await this.post(
        tx,
        'gift.payment:' + payment.id,
        'Apple可信礼物余额收款',
        [
          { accountCode: 'APPLE_RECEIVABLE', debit: fact.amount, userId },
          {
            accountCode: disposition === 'ACCEPTED' ? 'GIFT_CREDIT_LIABILITY' : 'GIFT_REFUND_PAYABLE',
            credit: fact.amount,
            userId,
          },
        ],
        { orderId: order.id, transactionId: payment.id },
      );
      if (disposition === 'ACCEPTED' && !fact.revokedAt)
        await this.ledger(tx, userId, 'gift.credit:' + payment.id, fact.amount, 'PURCHASE', {
          orderItemId: item.id,
          paymentTransactionId: payment.id,
          snapshot: item.itemSnapshot as Prisma.InputJsonValue,
        });
      row = await tx.appleTransactionState.update({
        where: { id: row.id },
        data: {
          mappingId: mapping.id,
          mappingSnapshot: safe(snapshot),
          paymentId: payment.id,
          state: disposition === 'ACCEPTED' ? 'DELIVERED' : 'REVIEW',
          issueCode: disposition === 'ACCEPTED' ? null : 'GIFT_ACCOUNT_UNAVAILABLE',
        },
      });
    }
    const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: row.paymentId! } }),
      order = await tx.tradeOrder.findUniqueOrThrow({ where: { id: payment.orderId } }),
      item = await tx.tradeOrderItem.findFirstOrThrow({ where: { orderId: order.id } }),
      credit = await tx.giftLedger.findUnique({ where: { eventKey: 'gift.credit:' + payment.id } });
    if (order.kind !== 'GIFT') throw new ConflictException('Apple交易业务类型不可变化');
    if (fact.revokedAt) {
      if (
        fact.revocationType !== 'REFUND_FULL' ||
        (fact.revocationPercentage !== null && fact.revocationPercentage !== 100000)
      ) {
        await this.wallet(tx,userId);await tx.giftWallet.updateMany({ where: { userId }, data: { systemHold: true } });
        return review('GIFT_PARTIAL_REVOCATION_REQUIRES_REVIEW');
      }
      const repeatedCycle=await tx.refund.findFirst({where:{requestKey:'apple.gift.revoked:'+row.id+':'+fact.revokedAt.valueOf(),state:'REVERSED'}});if(repeatedCycle){await this.wallet(tx,userId);await tx.giftWallet.updateMany({where:{userId},data:{systemHold:true}});return review('GIFT_REFUND_CYCLE_REQUIRES_REVIEW');}
      const previous = await tx.refund.findFirst({
        where: { paymentTransactionId: payment.id, reasonCode: 'APPLE_GIFT_REVOKED', state: 'SUCCEEDED' },
      });
      if (previous)
        return tx.appleTransactionState.update({
          where: { id: row.id },
          data: { state: 'REVOKED', revokedAt: fact.revokedAt, issueCode: null },
        });
      const remaining = credit ? credit.delta - (await this.used(tx, credit.id)) : 0n,
        spent = credit ? credit.delta - remaining : 0n;
      const refund = await tx.refund.create({
        data: {
          orderId: order.id,
          userId,
          requestKey: 'apple.gift.revoked:' + row.id + ':' + fact.revokedAt.valueOf(),
          kind: 'REFUND_ONLY',
          state: 'SUCCEEDED',
          requestedAmount: payment.amount,
          approvedAmount: payment.amount,
          reasonCode: 'APPLE_GIFT_REVOKED',
          description: 'Apple签名确认全额退款；未消费余额撤销，已赠礼损失由平台承担并暂停账户赠礼核查。',
          paymentTransactionId: payment.id,
          succeededAt: fact.revokedAt,
          assessmentSnapshot: { remaining: String(remaining), spent: String(spent) },
        },
      });
      await tx.refundItem.create({
        data: { refundId: refund.id, orderItemId: item.id, quantity: 1, amount: payment.amount, revokeQuantity: 0 },
      });
      await tx.refundTransaction.create({
        data: {
          refundId: refund.id,
          paymentTransactionId: payment.id,
          channel: 'APPLE_IAP',
          appScope: row.appScope,
          externalRefundId: 'apple.gift:' + fact.transactionId + ':' + fact.revokedAt.valueOf(),
          amount: payment.amount,
          currency: 'CNY',
          verifiedAt: new Date(),
          succeededAt: fact.revokedAt,
          receiptHash: hash(fact),
        },
      });
      if (credit && remaining > 0n) {
        const debit = await this.ledger(tx, userId, 'gift.apple.reclaim:' + refund.id, -remaining, 'APPLE_REFUND', {
          orderItemId: item.id,
          paymentTransactionId: payment.id,
          snapshot: { refundId: refund.id },
        });
        await tx.giftCreditAllocation.create({
          data: {
            debitLedgerId: debit.id,
            creditLedgerId: credit.id,
            credits: remaining,
            allocatedPaidMinor: remaining,
            allocatedFeeMinor: 0n,
            currency: 'CNY',
          },
        });
      }
      if (spent > 0n)
        await tx.giftWallet.update({ where: { userId }, data: { systemHold: true, version: { increment: 1 } } });
      const liability = payment.disposition === 'ACCEPTED' ? 'GIFT_CREDIT_LIABILITY' : 'GIFT_REFUND_PAYABLE';
      await this.post(
        tx,
        'gift.apple.refund:' + refund.id,
        'Apple礼物全额撤销与平台损失',
        [
          { accountCode: liability, debit: credit ? remaining : payment.amount, userId },
          { accountCode: 'GIFT_CHARGEBACK_LOSS', debit: spent, userId },
          { accountCode: 'APPLE_RECEIVABLE', credit: payment.amount, userId },
        ],
        { orderId: order.id, transactionId: payment.id, refundId: refund.id },
      );
      await tx.tradeOrder.update({
        where: { id: order.id },
        data: { refundedTotal: { increment: payment.amount }, version: { increment: 1 } },
      });
      await tx.tradeOrderItem.update({
        where: { id: item.id },
        data: { refundedAmount: { increment: payment.amount } },
      });
      return tx.appleTransactionState.update({
        where: { id: row.id },
        data: { state: 'REVOKED', revokedAt: fact.revokedAt, issueCode: null },
      });
    }
    if (oldRevoked) {
      const refund = await tx.refund.findFirst({
        where: { paymentTransactionId: payment.id, reasonCode: 'APPLE_GIFT_REVOKED', state: 'SUCCEEDED' },
      });
      if (!refund) return review('GIFT_REFUND_REVERSAL_REQUIRES_REVIEW');
      const original = await tx.financeJournal.findUniqueOrThrow({
          where: { eventKey: 'gift.apple.refund:' + refund.id },
        }),
        entries = await tx.financeEntry.findMany({ where: { journalId: original.id } }),
        reclaim = await tx.giftLedger.findUnique({ where: { eventKey: 'gift.apple.reclaim:' + refund.id } });
      if (reclaim) {
        const restored = await this.ledger(
          tx,
          userId,
          'gift.apple.refund.reverse:' + refund.id,
          -reclaim.delta,
          'REFUND_RESTORE',
          { reversalOfId: reclaim.id, snapshot: { refundId: refund.id } },
        );
        for (const allocation of await tx.giftCreditAllocation.findMany({
          where: { debitLedgerId: reclaim.id, reversalOfId: null },
        }))
          await tx.giftCreditAllocation.create({
            data: {
              debitLedgerId: restored.id,
              creditLedgerId: allocation.creditLedgerId,
              credits: allocation.credits,
              allocatedPaidMinor: allocation.allocatedPaidMinor,
              allocatedFeeMinor: 0n,
              currency: 'CNY',
              reversalOfId: allocation.id,
            },
          });
      }
      await this.post(
        tx,
        'gift.apple.refund.reverse:' + refund.id,
        'Apple撤回礼物退款，恢复原余额',
        [
          ...entries.map((e) => ({
            accountCode: e.accountCode,
            debit: e.credit,
            credit: e.debit,
            userId: e.userId ?? undefined,
            partnerId: e.partnerId ?? undefined,
          })),
        ],
        { orderId: order.id, transactionId: payment.id, refundId: refund.id, reversalOfId: original.id },
      );
      await tx.refund.update({ where: { id: refund.id }, data: { state: 'REVERSED', version: { increment: 1 } } });
      await tx.tradeOrder.update({
        where: { id: order.id },
        data: { refundedTotal: { decrement: payment.amount }, version: { increment: 1 } },
      });
      await tx.tradeOrderItem.update({
        where: { id: item.id },
        data: { refundedAmount: { decrement: payment.amount } },
      });
      if(!credit&&payment.disposition==='ACCEPTED')await this.ledger(tx,userId,'gift.credit:'+payment.id,payment.amount,'PURCHASE',{orderItemId:item.id,paymentTransactionId:payment.id,snapshot:item.itemSnapshot as Prisma.InputJsonValue});
      const partialHold=await tx.appleTransactionState.count({where:{accountToken:{in:(await tx.appleAccountBinding.findMany({where:{userId},select:{accountToken:true}})).map(b=>b.accountToken)},id:{not:row.id},state:'REVIEW',issueCode:'GIFT_PARTIAL_REVOCATION_REQUIRES_REVIEW'}});
      const outstanding = await tx.refund.findMany({
        where: { userId, reasonCode: 'APPLE_GIFT_REVOKED', state: 'SUCCEEDED' },
        select: { assessmentSnapshot: true },
      });
      await tx.giftWallet.updateMany({
        where: { userId },
        data: {
          systemHold: partialHold>0||outstanding.some(
            (r) =>
              BigInt(
                (
                  r.assessmentSnapshot as {
                    spent?: string;
                  } | null
                )?.spent ?? '0',
              ) > 0n,
          ),
        },
      });
      return tx.appleTransactionState.update({
        where: { id: row.id },
        data: {
          state: payment.disposition==='ACCEPTED' ? 'DELIVERED' : 'REVIEW',
          revokedAt: null,
          issueCode: payment.disposition==='ACCEPTED' ? null : 'GIFT_ACCOUNT_UNAVAILABLE',
        },
      });
    }
    return row;
  }
  private async refundJob(tx: Prisma.TransactionClient, id: string) {
    await tx.outboxJob.upsert({
      where: { eventKey: 'gift.refund:' + id },
      create: {
        eventKey: 'gift.refund:' + id,
        kind: 'GIFT_REFUND',
        aggregateType: 'GIFT_REFUND',
        aggregateId: id,
        payload: {},
        availableAt: new Date(),
      },
      update: { state: 'READY', lockedUntil: null, availableAt: new Date(), lastErrorCode: null },
    });
  }
  async requestRefund(id: string, userId: string, dto: GiftRefundDto) {
    const initial = await this.owned(id, userId);
    await this.db.$transaction(async (tx) => {
      await this.userLock(tx, userId);
      await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${id} FOR UPDATE`;
      const old = await tx.refund.findFirst({ where: { userId, requestKey: dto.requestKey } });
      if (old) {
        if (old.orderId !== id || old.description !== dto.reason.trim())
          throw new ConflictException('退款编号已被其他请求使用');
        return;
      }
      const payment = await tx.paymentTransaction.findFirst({ where: { orderId: id, disposition: 'ACCEPTED' } });
      if (!payment) throw new BadRequestException('本订单没有有效收款');
      if (payment.channel === 'APPLE_IAP')
        throw new BadRequestException('Apple内购退款由Apple审核，请使用Apple报告问题入口');
      if (
        await tx.refund.count({
          where: {
            orderId: id,
            paymentTransactionId: payment.id,
            state: { notIn: ['SUCCEEDED', 'REJECTED', 'CANCELLED', 'REVERSED'] },
          },
        })
      )
        throw new ConflictException('已有退款申请，请查看进度');
      const credit = await tx.giftLedger.findFirstOrThrow({
          where: { paymentTransactionId: payment.id, kind: 'PURCHASE' },
        }),
        remaining = credit.delta - (await this.used(tx, credit.id));
      if (remaining <= 0n) throw new BadRequestException('本次购买的余额已经消费或退款，没有可自助退款余额');
      const refund = await tx.refund.create({
        data: {
          orderId: id,
          userId,
          requestKey: dto.requestKey,
          kind: 'REFUND_ONLY',
          state: 'REQUESTED',
          requestedAmount: remaining,
          reasonCode: 'GIFT_UNUSED',
          description: dto.reason.trim(),
          paymentTransactionId: payment.id,
          channelRequestKey: 'R' + randomUUID().replaceAll('-', '').slice(0, 31),
        },
      });
      const hold = await this.ledger(tx, userId, 'gift.refund.hold:' + refund.id, -remaining, 'REFUND_HOLD', {
        orderItemId: credit.orderItemId,
        paymentTransactionId: payment.id,
        snapshot: { refundId: refund.id },
      });
      await tx.giftCreditAllocation.create({
        data: {
          debitLedgerId: hold.id,
          creditLedgerId: credit.id,
          credits: remaining,
          allocatedPaidMinor: remaining,
          allocatedFeeMinor: 0n,
          currency: 'CNY',
        },
      });
      await tx.refundItem.create({
        data: {
          refundId: refund.id,
          orderItemId: credit.orderItemId!,
          quantity: 1,
          amount: remaining,
          revokeQuantity: 0,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'gift.refund.request',
          resource: 'refund',
          resourceId: refund.id,
          changes: { amount: String(remaining) },
        },
      });
    });
    return this.detail(initial.id, userId);
  }
  async reviewRefund(id: string, req: AuthRequest, dto: GiftRefundReview) {
    requireRoles(req, ['FINANCE']);
    const initial = await this.db.refund.findUnique({ where: { id } });
    if (!initial) throw new NotFoundException('退款不存在');
    if(initial.version!==dto.expectedVersion)throw new ConflictException('退款状态已变化，请刷新后核对');
    const order = await this.owned(initial.orderId, initial.userId);
    let restartClosed = false;
    if(dto.action==='RETRY') {
      const payment=await this.db.paymentTransaction.findUniqueOrThrow({where:{id:initial.paymentTransactionId!}});
      if(payment.channel==='APPLE_IAP')throw new BadRequestException('Apple退款由Apple处理');
      const fact=await this.channels.resolve(payment.channel).queryRefund(initial.channelRequestKey!,{transactionId:payment.externalTransactionId,orderNo:order.orderNo,total:Number(payment.amount)});
      await this.confirmRefund(fact,payment.channel as AppPaymentChannel);
      if((fact.refund_status??fact.status)==='SUCCESS')return this.detail(order.id,order.userId);
      restartClosed=(fact.refund_status??fact.status)==='CLOSED';
    }
    await this.db.$transaction(async (tx) => {
      await this.userLock(tx, order.userId);
      const refund = await tx.refund.findUniqueOrThrow({ where: { id } });
      if (
        (dto.action==='RETRY' ? refund.channelRequestKey!==initial.channelRequestKey : refund.version!==dto.expectedVersion) ||
        (dto.action === 'RETRY' ? !['FAILED', 'REFUNDING'].includes(refund.state) : refund.state !== 'REQUESTED')
      )
        throw new ConflictException('退款状态已变化，请刷新');
      if (dto.action === 'REJECT') {
        const hold = await tx.giftLedger.findUnique({ where: { eventKey: 'gift.refund.hold:' + id } });
        if (hold) {
          const restored = await this.ledger(
            tx,
            order.userId,
            'gift.refund.restore:' + id,
            -hold.delta,
            'REFUND_RESTORE',
            { reversalOfId: hold.id, snapshot: { refundId: id } },
          );
          for (const allocation of await tx.giftCreditAllocation.findMany({
            where: { debitLedgerId: hold.id, reversalOfId: null },
          }))
            await tx.giftCreditAllocation.create({
              data: {
                debitLedgerId: restored.id,
                creditLedgerId: allocation.creditLedgerId,
                credits: allocation.credits,
                allocatedPaidMinor: allocation.allocatedPaidMinor,
                allocatedFeeMinor: 0n,
                currency: 'CNY',
                reversalOfId: allocation.id,
              },
            });
        }
      }
      await tx.refund.update({
        where: { id },
        data: {
          state: dto.action === 'REJECT' ? 'REJECTED' : 'REFUNDING',
          approvedAmount: dto.action === 'REJECT' ? null : refund.requestedAmount,
          reviewerId: req.actor.id,
          reviewNote: dto.reason.trim(),
          failureCode: null,
          ...(restartClosed?{channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31)}:{}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (dto.action !== 'REJECT') await this.refundJob(tx, id);
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'gift.refund.' + dto.action.toLowerCase(),
          resource: 'refund',
          resourceId: id,
          reason: dto.reason.trim(),changes:{action:dto.action,amount:String(refund.requestedAmount),previousRequestKey:refund.channelRequestKey},
        },
      });
    });
    return this.detail(order.id, order.userId);
  }
  async confirmRefund(data: WechatRefund, channel: AppPaymentChannel = 'WECHAT_APP') {
    const refund = await this.db.refund.findUnique({ where: { channelRequestKey: data.out_refund_no } });
    if (!refund) throw new NotFoundException('退款不存在');
    const order = await this.owned(refund.orderId, refund.userId),
      payment = await this.db.paymentTransaction.findUniqueOrThrow({ where: { id: refund.paymentTransactionId! } }),
      identity = this.channels.resolve(channel).identity(),
      state = data.refund_status ?? data.status;
    if (
      payment.channel !== channel ||
      payment.appScope !== identity.appid ||
      (data.mchid && data.mchid !== identity.mchid) ||
      data.out_trade_no !== order.orderNo ||
      data.transaction_id !== payment.externalTransactionId ||
      !Number.isSafeInteger(data.amount?.refund) ||
      !Number.isSafeInteger(data.amount?.total) ||
      BigInt(data.amount!.refund) !== refund.approvedAmount ||
      BigInt(data.amount!.total) !== payment.amount ||
      (data.amount?.currency && data.amount.currency !== 'CNY') ||
      !data.refund_id ||
      data.refund_id.length > 128 ||
      !['SUCCESS', 'PROCESSING', 'ABNORMAL', 'CLOSED'].includes(state ?? '')
    )
      throw new BadRequestException('礼物退款事实与原收款不一致');
    return this.db.$transaction(async (tx) => {
      await this.userLock(tx, order.userId);
      await tx.$queryRaw`SELECT id FROM "Refund" WHERE id=${refund.id} FOR UPDATE`;
      const current = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      if (current.state === 'SUCCEEDED') return true;
      if (current.state !== 'REFUNDING' && current.state !== 'FAILED') throw new ConflictException('退款不是处理中');
      if (state === 'PROCESSING') return false;
      if (state !== 'SUCCESS') {
        await tx.refund.update({
          where: { id: refund.id },
          data: { state: 'FAILED', failureCode: 'PROVIDER_' + state, version: { increment: 1 } },
        });
        return false;
      }
      const transaction = await tx.refundTransaction.create({
        data: {
          refundId: refund.id,
          paymentTransactionId: payment.id,
          channel,
          appScope: identity.appid,
          externalRefundId: data.refund_id!,
          amount: current.approvedAmount!,
          currency: 'CNY',
          verifiedAt: new Date(),
          succeededAt: new Date(),
          receiptHash: hash(data),
        },
      });
      await this.post(
        tx,
        'gift.refunded:' + refund.id,
        '礼物余额可信原路退款',
        [
          {
            accountCode: payment.disposition === 'ACCEPTED' ? 'GIFT_CREDIT_LIABILITY' : 'GIFT_REFUND_PAYABLE',
            debit: transaction.amount,
            userId: order.userId,
          },
          { accountCode: this.receivable(channel), credit: transaction.amount, userId: order.userId },
        ],
        { orderId: order.id, transactionId: payment.id, refundId: refund.id },
      );
      if (payment.disposition === 'ACCEPTED') {
        await tx.tradeOrder.update({
          where: { id: order.id },
          data: { refundedTotal: { increment: transaction.amount }, version: { increment: 1 } },
        });
        await tx.tradeOrderItem.updateMany({
          where: { orderId: order.id },
          data: { refundedAmount: { increment: transaction.amount } },
        });
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: { state: 'SUCCEEDED', succeededAt: new Date(), failureCode: null, version: { increment: 1 } },
      });
      return true;
    });
  }
  async refresh(id: string, userId: string) {
    const order = await this.owned(id, userId),
      attempt = await this.db.paymentAttempt.findFirst({ where: { orderId: id } });
    if (attempt && order.state === 'PENDING') {
      const data = await this.channels.resolve(attempt.channel).query(order.orderNo);
      if (data.trade_state === 'SUCCESS')
        await this.confirmPayment(data, undefined, attempt.channel as AppPaymentChannel);
      else if (['NOTPAY', 'NOTFOUND', 'CLOSED'].includes(data.trade_state)) {
        await this.db.paymentAttempt.updateMany({
          where: { id: attempt.id, updatedAt:attempt.updatedAt },
          data: { lastQueriedAt: new Date(), failureCode: null },
        });
        if (order.expiresAt <= new Date() || data.trade_state === 'CLOSED') await this.cancel(id, userId);
      }
    }
    for (const refund of await this.db.refund.findMany({
      where: { orderId: id, state: { in: ['REFUNDING', 'FAILED'] } },
    })) {
      if (!refund.paymentTransactionId || !refund.channelRequestKey) continue;
      const payment = await this.db.paymentTransaction.findUniqueOrThrow({
        where: { id: refund.paymentTransactionId },
      });
      if (payment.channel === 'APPLE_IAP') continue;
      const result = await this.channels
        .resolve(payment.channel)
        .queryRefund(refund.channelRequestKey, {
          transactionId: payment.externalTransactionId,
          orderNo: order.orderNo,
          total: Number(payment.amount),
        });
      await this.confirmRefund(result, payment.channel as AppPaymentChannel);
    }
    return this.detail(id, userId);
  }
  async cancel(id: string, userId: string) {
    const order = await this.owned(id, userId);
    if (order.state !== 'PENDING') return this.detail(id, userId);
    const attempt = await this.db.paymentAttempt.findFirst({ where: { orderId: id } });
    if (attempt) {
      const result = await this.channels.resolve(attempt.channel).query(order.orderNo);
      if (result.trade_state === 'SUCCESS') {
        await this.confirmPayment(result, undefined, attempt.channel as AppPaymentChannel);
        return this.detail(id, userId);
      }
      if (!['NOTPAY', 'CLOSED', 'NOTFOUND'].includes(result.trade_state))
        throw new ConflictException('渠道结果待确认，订单已保留');
      if (result.trade_state === 'NOTPAY') await this.channels.resolve(attempt.channel).close(order.orderNo);
    }
    await this.db.$transaction(async (tx) => {
      await this.userLock(tx, userId);
      await tx.tradeOrder.updateMany({
        where: { id, userId, state: 'PENDING' },
        data: { state: 'CLOSED', closedAt: new Date(), closeReason: 'USER_OR_TIMEOUT', version: { increment: 1 } },
      });
    });
    return this.detail(id, userId);
  }
  async runJobs() {
    if (this.working) return;
    this.working = true;
    try {
      for (let i = 0; i < 10; i++) {
        const rows = await this.db.$queryRaw<
          {
            id: string;
            kind: string;
            aggregateId: string;
            attempts: number;
          }[]
        >`UPDATE "OutboxJob" SET state='RUNNING',attempts=attempts+1,"lockedUntil"=now()+interval '2 minutes',"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind IN ('GIFT_PAYMENT_CHECK','GIFT_REFUND') AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,kind,"aggregateId",attempts`;
        const job = rows[0];
        if (!job) break;
        try {
          let done = true;
          if (job.kind === 'GIFT_PAYMENT_CHECK') {
            const order = await this.db.tradeOrder.findUniqueOrThrow({ where: { id: job.aggregateId } });
            if (order.state === 'PENDING') {
              await this.refresh(order.id, order.userId);
              const updated = await this.db.tradeOrder.findUniqueOrThrow({ where: { id: order.id } });
              if (updated.state === 'PENDING') {
                if (!(await this.db.paymentAttempt.count({ where: { orderId: order.id } })))
                  await this.cancel(order.id, order.userId);
                else done = false;
              }
            }
          } else {
            const refund = await this.db.refund.findUniqueOrThrow({ where: { id: job.aggregateId } });
            if (['REFUNDING', 'FAILED'].includes(refund.state)) {
              const payment = await this.db.paymentTransaction.findUniqueOrThrow({
                  where: { id: refund.paymentTransactionId! },
                }),
                order = await this.db.tradeOrder.findUniqueOrThrow({ where: { id: refund.orderId } });
              done = await this.confirmRefund(
                await this.channels
                  .resolve(payment.channel)
                  .refund(
                    payment.externalTransactionId,
                    refund.channelRequestKey!,
                    Number(refund.approvedAmount),
                    Number(payment.amount),
                    order.orderNo,
                  ),
                payment.channel as AppPaymentChannel,
              );
            }
          }
          await this.db.outboxJob.updateMany({
            where: { id: job.id, attempts: job.attempts, state: 'RUNNING' },
            data: {
              state: done ? 'DONE' : 'READY',
              lockedUntil: null,
              completedAt: done ? new Date() : null,
              availableAt: new Date(Date.now() + 60000),
              lastErrorCode: null,
            },
          });
        } catch {
          await this.db.outboxJob.updateMany({
            where: { id: job.id, attempts: job.attempts, state: 'RUNNING' },
            data: {
              state: job.attempts >= 8 ? 'DEAD' : 'READY',
              lockedUntil: null,
              availableAt: new Date(Date.now() + Math.min(1800, 30 * 2 ** job.attempts) * 1000),
              lastErrorCode: 'GIFT_PROVIDER_PENDING',
            },
          });
        }
      }
    } finally {
      this.working = false;
    }
  }
}
@Controller('gifts')
@UseGuards(UserGuard)
export class GiftsController {
  constructor(private readonly gifts: Gifts) {}
  @Get('wallet')
  balance(
    @Req()
    req: AuthRequest,
    @Query()
    q: GiftPage,
  ) {
    return this.gifts.balance(req.actor.id, q);
  }
  @Get('packs')
  packs(
    @Req()
    req: AuthRequest,
    @Query()
    q: PackQuery,
  ) {
    return q.platform==='IOS'?this.gifts.applePacks(req.actor.id):this.gifts.packs(req.actor.id, q.platform);
  }
  @Get('orders')
  list(
    @Req()
    req: AuthRequest,
    @Query()
    q: GiftPage,
  ) {
    return this.gifts.orders(req.actor.id, q);
  }
  @Post('orders')
  checkout(
    @Req()
    req: AuthRequest,
    @Body()
    dto: TopupDto,
  ) {
    return this.gifts.checkout(req.actor.id, dto);
  }
  @Get('orders/:id')
  detail(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
  ) {
    return this.gifts.detail(id, req.actor.id);
  }
  @Post('orders/:id/payment')
  payment(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
  ) {
    return this.gifts.payment(id, req.actor.id);
  }
  @Post('orders/:id/refresh')
  refresh(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
  ) {
    return this.gifts.refresh(id, req.actor.id);
  }
  @Post('orders/:id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
  ) {
    return this.gifts.cancel(id, req.actor.id);
  }
  @Post('orders/:id/refund')
  refund(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
    @Body()
    dto: GiftRefundDto,
  ) {
    return this.gifts.requestRefund(id, req.actor.id, dto);
  }
  @Get('sessions/:id')
  catalog(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
  ) {
    return this.gifts.catalog(id, req.actor.id);
  }
  @Get('sessions/:id/feed')
  feed(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
  ) {
    return this.gifts.feed(id, req.actor.id);
  }
  @Post('give')
  give(
    @Req()
    req: AuthRequest,
    @Body()
    dto: GiveDto,
  ) {
    return this.gifts.give(req.actor.id, dto);
  }
}
@Controller('admin/gifts')
@UseGuards(AdminGuard)
export class GiftsFinanceController {
  constructor(
    private readonly gifts: Gifts,
    private readonly db: Database,
  ) {}
  @Get('orders')
  async orders(
    @Query()
    q: GiftPage,
  ) {
    const rows = await this.db.tradeOrder.findMany({
      where: { kind: 'GIFT' },
      orderBy: { createdAt: 'desc' },
      take: q.size,
      skip: (q.page - 1) * q.size,
    });
    return {
      items: await Promise.all(rows.map((r) => this.gifts.detail(r.id, r.userId))),
      total: await this.db.tradeOrder.count({ where: { kind: 'GIFT' } }),
    };
  }
  @Get('orders/:id') async order(@Param('id',ParseUUIDPipe) id:string){const row=await this.db.tradeOrder.findFirst({where:{id,kind:'GIFT'}});if(!row)throw new NotFoundException('礼物订单不存在');return this.gifts.detail(id,row.userId);}
  @Post('refunds/:id/review')
  review(
    @Param('id', ParseUUIDPipe)
    id: string,
    @Req()
    req: AuthRequest,
    @Body()
    dto: GiftRefundReview,
  ) {
    return this.gifts.reviewRefund(id, req, dto);
  }
}
