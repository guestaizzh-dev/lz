import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from './generated/prisma/client.js';
import { UserGuard, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { PaymentChannels, type AppPaymentChannel } from './payment-channels.js';
import { DigitalGoods } from './digital.js';
import { productSalesEnabled } from './product-sales.js';
import type { WechatTransaction } from './wechat-pay.js';

const now = () => new Date();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe = (value: unknown) => JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

class DigitalCheckoutDto {
  @IsUUID() skuId!: string;
  @IsUUID() requestKey!: string;
  @IsIn(['WECHAT_APP', 'ALIPAY_APP', 'SIMULATED']) channel!: AppPaymentChannel;
  @IsOptional() @IsIn(['ANDROID', 'IOS', 'WEB']) platform?: string;
}

/** 数字商品：独立订单，付款后发放资料包，无物流。 */
@Injectable()
export class DigitalSales {
  constructor(private readonly db: Database, private readonly channels: PaymentChannels, private readonly digital: DigitalGoods) {}

  private async sale(skuId: string) {
    const sku = await this.db.productSku.findUnique({ where: { id: skuId }, include: { product: true } });
    if (!sku || !sku.active || sku.product.type !== 'DIGITAL' || sku.product.status !== 'PUBLISHED' || sku.product.isDemo) throw new NotFoundException('数字商品不可购买');
    if (!sku.digitalReleaseId) throw new ConflictException('数字资料尚未准备完成');
    if (sku.price <= 0) throw new ConflictException('价格尚未配置');
    return sku;
  }

  async checkout(userId: string, dto: DigitalCheckoutDto) {
    if (!productSalesEnabled()) throw new BadRequestException('数字商品销售尚未开放');
    if ((dto.platform ?? 'ANDROID') !== 'ANDROID') throw new BadRequestException('请在 Android App 内购买');
    this.channels.resolve(dto.channel).identity();
    const sku = await this.sale(dto.skuId);
    const requestHash = hash({ skuId: dto.skuId, channel: dto.channel });
    const order = await this.db.$transaction(async (tx) => {
      const existing = await tx.tradeOrder.findFirst({ where: { userId, requestKey: dto.requestKey } });
      if (existing) {
        if (existing.kind !== 'DIGITAL' || existing.requestHash !== requestHash) throw new ConflictException('请求编号已用于其他订单');
        return existing;
      }
      const row = await tx.tradeOrder.create({
        data: {
          orderNo: 'D' + randomUUID().replaceAll('-', '').slice(0, 31),
          kind: 'DIGITAL',
          userId,
          requestKey: dto.requestKey,
          requestHash,
          currency: 'CNY',
          subtotal: BigInt(sku.price),
          payableTotal: BigInt(sku.price),
          pricingSnapshot: { platform: dto.platform ?? 'ANDROID', channel: dto.channel, digitalReleaseId: sku.digitalReleaseId },
          quoteHash: hash({ skuId: sku.id, price: String(sku.price), version: sku.version }),
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      });
      const offer = await tx.saleOffer.create({ data: { kind: 'DIGITAL', skuId: sku.id, price: BigInt(sku.price), active: false, quantityLimit: 1, policySnapshot: {} } });
      await tx.tradeOrderItem.create({
        data: {
          orderId: row.id,
          lineNo: 1,
          offerId: offer.id,
          quantity: 1,
          unitPrice: BigInt(sku.price),
          subtotal: BigInt(sku.price),
          payable: BigInt(sku.price),
          itemSnapshot: { skuId: sku.id, title: sku.product.title, skuTitle: sku.title, digitalReleaseId: sku.digitalReleaseId },
          benefitSnapshot: {},
          state: 'PENDING',
        },
      });
      await tx.paymentAttempt.create({ data: { orderId: row.id, channel: dto.channel, requestKey: 'digital.attempt:' + row.id, state: 'CREATED', amount: BigInt(sku.price), currency: 'CNY', expiresAt: row.expiresAt } });
      await tx.auditLog.create({ data: { actorId: userId, action: 'digital.order.create', resource: 'trade_order', resourceId: row.id, changes: { amount: String(sku.price) } } });
      return row;
    });
    return this.detail(order.id, userId);
  }

  async detail(id: string, userId: string) {
    const row = await this.db.tradeOrder.findFirst({ where: { id, userId, kind: 'DIGITAL' } });
    if (!row) throw new NotFoundException('数字商品订单不存在');
    const items = await this.db.tradeOrderItem.findMany({ where: { orderId: row.id } });
    const delivery = items[0] ? await this.db.digitalDelivery.findUnique({ where: { orderItemId: items[0].id } }) : null;
    const pack = delivery ? await this.digital.releases((await this.db.digitalRelease.findUnique({ where: { id: delivery.releaseId } }))?.productId ?? '').catch(() => null) : null;
    return safe({ ...row, items, delivery, pack: pack?.items?.[0] ?? null });
  }

  async list(userId: string, page = 1, size = 20) {
    const [items, total] = await this.db.$transaction([
      this.db.tradeOrder.findMany({ where: { userId, kind: 'DIGITAL' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: size, skip: (page - 1) * size }),
      this.db.tradeOrder.count({ where: { userId, kind: 'DIGITAL' } }),
    ]);
    return safe({ items, total });
  }

  async prepay(id: string, userId: string) {
    const order = await this.db.tradeOrder.findFirst({ where: { id, userId, kind: 'DIGITAL' } });
    if (!order || order.state !== 'PENDING') throw new ConflictException('订单当前不可支付');
    const channel = (order.pricingSnapshot as { channel: AppPaymentChannel }).channel;
    const adapter = this.channels.resolve(channel);
    const attempt = await this.db.paymentAttempt.findFirst({ where: { orderId: id, channel } });
    if (!attempt) throw new ConflictException('支付尝试缺失，请重新下单');
    return { channel, orderNo: order.orderNo, amount: String(order.payableTotal), ...(await adapter.prepay(order.orderNo, '数字资料', Number(order.payableTotal), order.expiresAt).then(orderInfo => ({ orderInfo })).catch(() => ({}))) };
  }

  async confirmPayment(data: WechatTransaction, _callback?: { id: string; payloadHash: string }, channel: AppPaymentChannel = 'WECHAT_APP') {
    const identity = this.channels.resolve(channel).identity();
    if (data.appid !== identity.appid || data.mchid !== identity.mchid || data.trade_type !== 'APP' || data.trade_state !== 'SUCCESS' || !data.transaction_id || !Number.isSafeInteger(data.amount?.total) || data.amount!.total <= 0 || data.amount!.currency !== 'CNY' || !data.success_time) throw new BadRequestException('收款信息无效');
    const initial = await this.db.tradeOrder.findUnique({ where: { orderNo: data.out_trade_no } });
    if (initial?.kind !== 'DIGITAL') throw new NotFoundException('数字商品订单不存在');
    return this.db.$transaction(async (tx) => {
      const order = await tx.tradeOrder.findUniqueOrThrow({ where: { id: initial.id } });
      const item = await tx.tradeOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
      const amount = BigInt(data.amount!.total);
      const old = await tx.paymentTransaction.findFirst({ where: { channel, appScope: identity.appid, externalTransactionId: data.transaction_id! } });
      if (old) return { disposition: old.disposition };
      const paidAt = new Date(data.success_time!);
      const disposition = amount !== order.payableTotal ? 'AMOUNT_MISMATCH' : order.state === 'CLOSED' || paidAt > order.expiresAt ? 'LATE' : 'ACCEPTED';
      const payment = await tx.paymentTransaction.create({ data: { orderId: order.id, channel, appScope: identity.appid, externalTransactionId: data.transaction_id!, amount, currency: 'CNY', paidAt, verifiedAt: now(), disposition, receiptHash: hash(data) } });
      const receivable = channel === 'WECHAT_APP' ? 'WECHAT_RECEIVABLE' : 'ALIPAY_RECEIVABLE';
      const journal = await tx.financeJournal.create({ data: { eventKey: 'digital.payment:' + payment.id, kind: 'PRODUCT_PAYMENT', orderId: order.id, transactionId: payment.id, currency: 'CNY', postedAt: now(), description: '数字资料已验证收款' } });
      await tx.financeEntry.createMany({ data: [
        { journalId: journal.id, accountCode: receivable, debit: amount, userId: order.userId },
        { journalId: journal.id, accountCode: disposition === 'ACCEPTED' ? 'PRODUCT_REVENUE' : 'PRODUCT_REFUND_PAYABLE', credit: amount, userId: order.userId },
      ] });
      if (disposition !== 'ACCEPTED') {
        await tx.refund.create({ data: { orderId: order.id, userId: order.userId, requestKey: 'digital.anomaly:' + payment.id, kind: 'REFUND_ONLY', state: 'REFUNDING', requestedAmount: amount, approvedAmount: amount, paymentTransactionId: payment.id, channelRequestKey: 'R' + randomUUID().replaceAll('-', ''), reasonCode: disposition, description: '数字资料收款异常，原路退回' } });
        return { disposition };
      }
      await this.digital.grant(tx, order.userId, item.id, (item.itemSnapshot as { digitalReleaseId: string }).digitalReleaseId, null);
      await tx.tradeOrder.update({ where: { id: order.id }, data: { state: 'COMPLETED', paidTotal: amount, paidAt, completedAt: now(), version: { increment: 1 } } });
      await tx.tradeOrderItem.update({ where: { id: item.id }, data: { state: 'PAID' } });
      await tx.auditLog.create({ data: { actorId: order.userId, action: 'digital.payment.confirm', resource: 'trade_order', resourceId: order.id, changes: { source: channel, amount: String(amount) } } });
      return { disposition };
    });
  }
}

@Controller('commerce')
@UseGuards(UserGuard)
export class DigitalSalesController {
  constructor(private readonly sales: DigitalSales) {}

  @Post('digital-orders')
  checkout(@Req() req: AuthRequest, @Body() dto: DigitalCheckoutDto) { return this.sales.checkout(req.actor.id, dto); }

  @Get('digital-orders')
  list(@Req() req: AuthRequest) { return this.sales.list(req.actor.id); }

  @Get('digital-orders/:id')
  detail(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.sales.detail(id, req.actor.id); }

  @Post('digital-orders/:id/payment')
  prepay(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.sales.prepay(id, req.actor.id); }
}
