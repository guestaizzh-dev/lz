import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import {
  AdminGuard,
  OptionalUserGuard,
  UserGuard,
  requireRoles,
  type AuthRequest,
} from './auth.js';
import { Database } from './database.js';
import { PaymentChannels, type AppPaymentChannel } from './payment-channels.js';
import type { Prisma, TradeOrder } from './generated/prisma/client.js';
import type { WechatTransaction, WechatRefund } from './wechat-pay.js';
import { currentLongTermMember, voucherValue, voucherPolicy } from './video-vouchers.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
const day = 86400000,
  channel = 'WECHAT_NATIVE' as const;
const kinds = ['MEMBER_LIFETIME', 'VIDEO_VOUCHER'];
class Page {
  @IsOptional() @IsIn(['MEMBER_LIFETIME', 'VIDEO_VOUCHER']) kind?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
}
class Selection {
  @IsIn(['MEMBER_LIFETIME', 'VIDEO_VOUCHER']) kind!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) tier?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity?: number;
  @IsIn(['ANDROID', 'IOS', 'WEB']) platform = 'WEB';
}
class Checkout extends Selection {
  @IsUUID() requestKey!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash!: string;
}
class ReturnRequest {
  @IsUUID() requestKey!: string;
  @IsString() @Length(2, 500) @Matches(/\S/) reason!: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) quantity?: number;
}
class GradeEdit {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsInt() @Min(1) @Max(100000000) price!: number;
  @IsInt() @Min(0) @Max(100000) voucherQuantity!: number;
  @IsInt() @Min(1000) @Max(10000) goodsBasisPoints!: number;
  @IsInt() @Min(1000) @Max(10000) bookBasisPoints!: number;
  @IsBoolean() active!: boolean;
  @IsString() @Length(2, 500) @Matches(/\S/) reason!: string;
}
class VoucherPolicyEdit {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(1, 40) @Matches(/\S/) title!: string;
  @IsInt() @Min(1) @Max(1000000) price!: number;
  @IsInt() @Min(1) @Max(1000000) faceValue!: number;
  @IsBoolean() active!: boolean;
  @IsString() @Length(2, 500) @Matches(/\S/) reason!: string;
}
class Review {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['APPROVE', 'REJECT', 'RETRY']) action!: string;
  @IsString() @Length(2, 500) reason!: string;
}
type Store = Database | Prisma.TransactionClient;
type Terms = {
  kind: string;
  title: string;
  tier: number;
  quantity: number;
  price: number;
  giftQuantity: number;
  previousId: string | null;
  voucherPolicy?: { version: number; price: number; faceValue: number; title: string };
  grade: {
    price: number;
    voucherQuantity: number;
    goodsBasisPoints: number;
    bookBasisPoints: number;
    version: number;
  } | null;
};

@Injectable()
export class MemberCenter implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  constructor(
    private readonly db: Database,
    private readonly channels: PaymentChannels,
  ) {}
  onModuleInit() {
    if (
      process.env.NODE_ENV !== 'test' &&
      process.env.MEMBERSHIP_PAYMENT_WORKER_ENABLED !== 'false'
    )
      this.timer = setInterval(() => void this.runJobs().catch(() => {}), 20000).unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private enabled(platform: string) {
    return (
      platform === 'ANDROID' &&
      process.env.MEMBERSHIP_SALES_ENABLED === 'true' &&
      this.channels.resolve(channel).availability().enabled
    );
  }
  private async lock(tx: Prisma.TransactionClient, userId: string, active = false) {
    const rows = await tx.$queryRaw<
      { status: string }[]
    >`SELECT status FROM "User" WHERE id=${userId} FOR UPDATE`;
    if (!rows.length || (active && rows[0]!.status !== 'ACTIVE'))
      throw new BadRequestException('账号不可用，请重新登录');
    return rows[0]!.status;
  }
  private async owned(id: string, userId: string) {
    const order = await this.db.tradeOrder.findFirst({
      where: { id, userId, kind: { in: kinds } },
    });
    if (!order) throw new NotFoundException('会员或代金券订单不存在');
    return order;
  }
  private terms(order: TradeOrder) {
    return (order.pricingSnapshot as { terms: Terms }).terms;
  }
  private async selected(store: Store, userId: string | undefined, dto: Selection): Promise<Terms> {
    const policy = await voucherPolicy(store);
    const frozenPolicy = {
      version: policy.version,
      price: policy.price,
      faceValue: policy.faceValue,
      title: policy.title,
    };
    if (dto.kind === 'VIDEO_VOUCHER') {
      if (!policy.active) throw new ConflictException('代金券暂停售卖');
      if (!dto.quantity || dto.tier !== undefined) throw new BadRequestException('请选择购买份数');
      return {
        kind: dto.kind,
        title: policy.title,
        tier: 0,
        quantity: dto.quantity,
        price: dto.quantity * policy.price,
        voucherPolicy: frozenPolicy,
        giftQuantity: 0,
        previousId: null,
        grade: null,
      };
    }
    if (!dto.tier || dto.quantity !== undefined) throw new BadRequestException('请选择会员等级');
    const grade = await store.membershipGrade.findUnique({ where: { tier: dto.tier } });
    if (!grade?.active) throw new ConflictException('该等级暂未开放');
    const current = userId ? await currentLongTermMember(store, userId) : null;
    if (current?.state === 'REFUND_HELD')
      throw new ConflictException('会员退款正在办理，请先查看原订单');
    if (current && current.tier >= grade.tier)
      throw new ConflictException('当前等级已开通，无需重复购买或降级');
    const price = grade.price - (current?.priceCredit ?? 0);
    if (price <= 0) throw new ConflictException('升级价格需要书院核对，暂不收费');
    return {
      kind: dto.kind,
      title: grade.title,
      voucherPolicy: frozenPolicy,
      tier: grade.tier,
      quantity: 1,
      price,
      giftQuantity: Math.max(0, grade.voucherQuantity - (current?.giftTarget ?? 0)),
      previousId: current?.id ?? null,
      grade: {
        price: grade.price,
        voucherQuantity: grade.voucherQuantity,
        goodsBasisPoints: grade.goodsBasisPoints,
        bookBasisPoints: grade.bookBasisPoints,
        version: grade.version,
      },
    };
  }
  async overview(userId?: string) {
    const grades = await this.db.membershipGrade.findMany({ orderBy: { tier: 'asc' } }),
      member = userId ? await currentLongTermMember(this.db, userId) : null;
    const totals = userId
      ? await this.db.videoVoucherLot.aggregate({
          where: { userId, suspended: false },
          _sum: { remaining: true, held: true, used: true, refundHeld: true },
        })
      : null;
    const policy = await voucherPolicy(this.db);
    const lots = userId
      ? await this.db.videoVoucherLot.findMany({
          where: { userId, suspended: false },
          select: { remaining: true, faceValue: true },
        })
      : [];
    return {
      grades,
      member,
      voucher: {
        value: policy.faceValue,
        price: policy.price,
        title: policy.title,
        active: policy.active,
        version: policy.version,
        availableValue: lots.reduce((n, l) => n + l.remaining * l.faceValue, 0),
        available: totals?._sum.remaining ?? 0,
        held: totals?._sum.held ?? 0,
        used: totals?._sum.used ?? 0,
        refundHeld: totals?._sum.refundHeld ?? 0,
        expiresAt: null,
      },
      longTerm: true,
      refundPolicy:
        '会员开通及升级付款后7天内、未使用或占用该次权益可申请退款；升级退款恢复原等级。单独购买的代金券按尚未使用且未占用份数原路退回。',
    };
  }
  async quote(userId: string | undefined, dto: Selection) {
    const terms = await this.selected(this.db, userId, dto),
      paymentEnabled = this.enabled(dto.platform);
    return {
      ...terms,
      quoteHash: hash(terms),
      paymentEnabled,
      channel,
      expiresAt: null,
      unavailableReason: paymentEnabled
        ? ''
        : dto.platform === 'IOS'
          ? 'iOS会员及代金券购买尚未验收，暂不收费。'
          : dto.platform === 'WEB'
            ? '请在Android App中购买。'
            : '会员正式收款尚未开放。',
    };
  }
  async checkout(userId: string, dto: Checkout) {
    if (!this.enabled(dto.platform)) throw new BadRequestException('当前平台尚未开放此项付款');
    const requestHash = hash({
      kind: dto.kind,
      tier: dto.tier ?? null,
      quantity: dto.quantity ?? null,
      platform: dto.platform,
      quoteHash: dto.quoteHash,
    });
    const row = await this.db.$transaction(async (tx) => {
      await this.lock(tx, userId, true);
      await tx.$queryRaw`SELECT id FROM "VideoVoucherPolicy" WHERE id=1 FOR SHARE`;
      const old = await tx.tradeOrder.findFirst({ where: { userId, requestKey: dto.requestKey } });
      if (old) {
        if (!kinds.includes(old.kind) || old.requestHash !== requestHash)
          throw new ConflictException('提交编号已用于其他购买');
        return old;
      }
      // Lock all grades in tier order so an administrator cannot change price during checkout.
      await tx.$queryRaw`SELECT tier FROM "MembershipGrade" ORDER BY tier FOR SHARE`;
      const terms = await this.selected(tx, userId, dto);
      if (hash(terms) !== dto.quoteHash)
        throw new ConflictException('会员或赠券设置已变化，请重新确认');
      const pending = await tx.tradeOrder.findFirst({
        where: { userId, kind: { in: kinds }, state: 'PENDING' },
      });
      if (pending) throw new ConflictException('请先在会员购买记录中处理待付款订单');
      const offer = await tx.saleOffer.create({
        data: {
          kind: terms.kind,
          price: BigInt(terms.price),
          active: true,
          quantityLimit: 1,
          policySnapshot: { terms },
        },
      });
      const order = await tx.tradeOrder.create({
        data: {
          orderNo: 'L' + randomUUID().replaceAll('-', '').slice(0, 31),
          userId,
          kind: terms.kind,
          requestKey: dto.requestKey,
          requestHash,
          currency: 'CNY',
          subtotal: BigInt(terms.price),
          payableTotal: BigInt(terms.price),
          pricingSnapshot: { channel, terms },
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
          unitPrice: order.subtotal,
          subtotal: order.subtotal,
          payable: order.payableTotal,
          itemSnapshot: terms,
          benefitSnapshot: {},
          state: 'PENDING',
        },
      });
      await tx.outboxJob.create({
        data: {
          eventKey: 'center.check:' + order.id,
          kind: 'MEMBER_CENTER_CHECK',
          aggregateType: 'MEMBER_CENTER_ORDER',
          aggregateId: order.id,
          payload: {},
          availableAt: order.expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'member.center.checkout',
          resource: 'trade_order',
          resourceId: order.id,
          changes: { terms },
        },
      });
      return order;
    });
    return this.detail(row.id, userId);
  }
  async list(userId: string, page: Page) {
    const where = { userId, kind: { in: kinds } },
      [rows, total] = await this.db.$transaction([
        this.db.tradeOrder.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page.page - 1) * page.size,
          take: page.size,
        }),
        this.db.tradeOrder.count({ where }),
      ]);
    return { items: await Promise.all(rows.map((r) => this.detail(r.id, userId))), total };
  }
  async wallet(userId: string, page: Page) {
    const where = { userId },
      [items, total] = await this.db.$transaction([
        this.db.videoVoucherLot.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page.page - 1) * page.size,
          take: page.size,
        }),
        this.db.videoVoucherLot.count({ where }),
      ]);
    return { items, total, value: (await voucherPolicy(this.db)).faceValue };
  }
  async detail(id: string, userId: string) {
    const order = await this.owned(id, userId),
      terms = this.terms(order),
      lot = await this.db.videoVoucherLot.findUnique({ where: { orderId: id } }),
      member = await this.db.memberPurchase.findUnique({ where: { orderId: id } }),
      refunds = await this.db.refund.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'desc' },
      }),
      attempt = await this.db.paymentAttempt.findFirst({ where: { orderId: id } });
    const checked =
      !attempt ||
      (!!attempt.lastQueriedAt &&
        attempt.lastQueriedAt >= attempt.updatedAt &&
        !attempt.failureCode);
    return safe({
      ...order,
      terms,
      plan: { title: terms.title },
      channel,
      amount: order.payableTotal,
      paidAmount: order.paidTotal,
      refundedAmount: order.refundedTotal,
      lot,
      member,
      refunds,
      canPay:
        order.state === 'PENDING' &&
        order.expiresAt > new Date() &&
        checked &&
        this.enabled('ANDROID'),
      canCancel: order.state === 'PENDING',
      canRefund:
        order.state === 'COMPLETED' &&
        order.paidTotal > order.refundedTotal &&
        !refunds.some((r) => ['REQUESTED', 'REFUNDING', 'FAILED'].includes(r.state)) &&
        (terms.kind === 'VIDEO_VOUCHER'
          ? (lot?.remaining ?? 0) > 0
          : member?.state === 'ACTIVE' && Date.now() - order.paidAt!.getTime() <= 7 * day),
      serverTime: new Date(),
    });
  }
  async prepay(id: string, userId: string) {
    const order = await this.owned(id, userId);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, userId, true);
      await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${id} FOR UPDATE`;
      const current = await tx.tradeOrder.findUniqueOrThrow({ where: { id } }),
        terms = this.terms(current);
      if (
        !this.enabled('ANDROID') ||
        current.state !== 'PENDING' ||
        current.expiresAt <= new Date()
      )
        throw new ConflictException('订单已不可支付，请查询结果');
      if (
        terms.kind === 'MEMBER_LIFETIME' &&
        (await currentLongTermMember(tx, userId))?.id !== (terms.previousId ?? undefined)
      )
        throw new ConflictException('会员状态已变化，请取消后重新确认');
      const old = await tx.paymentAttempt.findFirst({ where: { orderId: id } });
      if (
        old &&
        ((old.state === 'CREATED' && Date.now() - old.updatedAt.getTime() < 30000) ||
          !old.lastQueriedAt ||
          old.lastQueriedAt < old.updatedAt ||
          old.failureCode)
      )
        throw new ConflictException('请先查询上次付款结果，勿重复付款');
      if (old)
        await tx.paymentAttempt.update({
          where: { id: old.id },
          data: { state: 'CREATED', updatedAt: new Date(), failureCode: null },
        });
      else
        await tx.paymentAttempt.create({
          data: {
            orderId: id,
            channel,
            requestKey: 'center.pay:' + id,
            state: 'CREATED',
            amount: order.payableTotal,
            currency: 'CNY',
            expiresAt: order.expiresAt,
          },
        });
    });
    try {
      const orderInfo = await this.channels
        .resolve(channel)
        .prepay(
          order.orderNo,
          this.terms(order).title,
          Number(order.payableTotal),
          order.expiresAt,
        );
      await this.db.paymentAttempt.updateMany({
        where: { orderId: id, state: 'CREATED' },
        data: { state: 'PENDING', updatedAt: new Date() },
      });
      return { provider: 'wxnative', orderInfo };
    } catch (e) {
      await this.db.paymentAttempt.updateMany({
        where: { orderId: id, state: 'CREATED' },
        data: { state: 'PENDING', updatedAt: new Date(), failureCode: 'PROVIDER_RESULT_UNKNOWN' },
      });
      throw e;
    }
  }
  async refresh(id: string, userId: string) {
    const order = await this.owned(id, userId),
      attempt = await this.db.paymentAttempt.findFirst({ where: { orderId: id } });
    if (order.state === 'PENDING' && attempt) {
      const fact = await this.channels.resolve(channel).query(order.orderNo);
      if (fact.trade_state === 'SUCCESS') await this.confirmPayment(fact);
      else if (['NOTPAY', 'CLOSED', 'NOTFOUND'].includes(fact.trade_state)) {
        await this.db.paymentAttempt.updateMany({
          where: { id: attempt.id, updatedAt: attempt.updatedAt },
          data: { lastQueriedAt: new Date(), failureCode: null },
        });
        if (fact.trade_state === 'CLOSED' || order.expiresAt <= new Date())
          return this.cancel(id, userId, 'TIMEOUT');
      }
    }
    return this.detail(id, userId);
  }
  async cancel(id: string, userId: string, reason = 'USER_CANCEL') {
    const order = await this.owned(id, userId),
      attempt = await this.db.paymentAttempt.findFirst({ where: { orderId: id } });
    if (order.state !== 'PENDING') return this.detail(id, userId);
    if (attempt) {
      if (attempt.state === 'CREATED' && Date.now() - attempt.updatedAt.getTime() < 30000)
        throw new ConflictException('正在发起支付，请稍后查询');
      const fact = await this.channels.resolve(channel).query(order.orderNo);
      if (fact.trade_state === 'SUCCESS') {
        await this.confirmPayment(fact);
        return this.detail(id, userId);
      }
      if (!['NOTPAY', 'CLOSED', 'NOTFOUND'].includes(fact.trade_state))
        throw new ConflictException('付款结果待确认，暂不能取消');
      if (fact.trade_state === 'NOTPAY') await this.channels.resolve(channel).close(order.orderNo);
    }
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const row = await tx.tradeOrder.findUniqueOrThrow({ where: { id } });
      if (row.state !== 'PENDING') return;
      await tx.tradeOrder.update({
        where: { id },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          closeReason: reason,
          version: { increment: 1 },
        },
      });
      await tx.tradeOrderItem.updateMany({ where: { orderId: id }, data: { state: 'CLOSED' } });
      await tx.paymentAttempt.updateMany({ where: { orderId: id }, data: { state: 'CLOSED' } });
    });
    return this.detail(id, userId);
  }
  private async journal(
    tx: Prisma.TransactionClient,
    order: TradeOrder,
    paymentId: string,
    amount: bigint,
    eventKey: string,
    incoming: boolean,
    anomaly = false,
    refundId?: string,
  ) {
    const account = anomaly
      ? 'MEMBERSHIP_REFUND_PAYABLE'
      : order.kind === 'VIDEO_VOUCHER'
        ? 'VIDEO_VOUCHER_LIABILITY'
        : 'MEMBERSHIP_REVENUE';
    const journal = await tx.financeJournal.create({
      data: {
        eventKey,
        kind: incoming ? 'MEMBER_CENTER_PAYMENT' : 'MEMBER_CENTER_REFUND',
        orderId: order.id,
        transactionId: paymentId,
        refundId,
        currency: 'CNY',
        postedAt: new Date(),
        description: incoming ? '会员中心核实收款' : '会员中心核实原路退款',
      },
    });
    await tx.financeEntry.createMany({
      data: [
        {
          journalId: journal.id,
          accountCode: incoming ? 'WECHAT_RECEIVABLE' : account,
          debit: amount,
          userId: order.userId,
        },
        {
          journalId: journal.id,
          accountCode: incoming ? account : 'WECHAT_RECEIVABLE',
          credit: amount,
          userId: order.userId,
        },
      ],
    });
  }
  async confirmPayment(
    data: WechatTransaction,
    callback?: { id: string; payloadHash: string },
    receivedChannel: AppPaymentChannel = channel,
  ) {
    const identity = this.channels.resolve(channel).identity();
    if (
      receivedChannel !== channel ||
      data.trade_state !== 'SUCCESS' ||
      data.trade_type !== 'NATIVE' ||
      data.appid !== identity.appid ||
      data.mchid !== identity.mchid ||
      !data.transaction_id ||
      data.transaction_id.length > 128 ||
      !Number.isSafeInteger(data.amount?.total) ||
      data.amount!.total <= 0 ||
      data.amount?.currency !== 'CNY' ||
      !data.success_time ||
      !Number.isFinite(Date.parse(data.success_time)) ||
      Date.parse(data.success_time) > Date.now() + 300000
    )
      throw new BadRequestException('收款事实无效');
    const initial = await this.db.tradeOrder.findUnique({ where: { orderNo: data.out_trade_no } });
    if (!initial || !kinds.includes(initial.kind)) throw new NotFoundException('订单不存在');
    return this.db.$transaction(async (tx) => {
      const userStatus = await this.lock(tx, initial.userId);
      await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${initial.id} FOR UPDATE`;
      const order = await tx.tradeOrder.findUniqueOrThrow({ where: { id: initial.id } }),
        terms = this.terms(order),
        item = await tx.tradeOrderItem.findFirstOrThrow({ where: { orderId: order.id } }),
        amount = BigInt(data.amount!.total);
      const old = await tx.paymentTransaction.findFirst({
        where: { channel, appScope: identity.appid, externalTransactionId: data.transaction_id! },
      });
      if (old) {
        if (old.orderId !== order.id || old.amount !== amount)
          throw new ConflictException('交易已绑定其他订单');
        return { disposition: old.disposition };
      }
      const attempt = await tx.paymentAttempt.findFirst({ where: { orderId: order.id, channel } });
      if (!attempt) throw new BadRequestException('找不到原付款请求');
      const current = await currentLongTermMember(tx, order.userId),
        paidAt = new Date(data.success_time!);
      if (paidAt.getTime() < order.createdAt.getTime() - 300000)
        throw new BadRequestException('付款时间早于订单');
      const duplicate = await tx.paymentTransaction.findFirst({
        where: { orderId: order.id, disposition: 'ACCEPTED' },
      });
      const disposition =
        amount !== order.payableTotal
          ? 'AMOUNT_MISMATCH'
          : duplicate
            ? 'DUPLICATE'
            : order.state !== 'PENDING' || paidAt > order.expiresAt
              ? 'LATE'
              : userStatus !== 'ACTIVE'
                ? 'REFUND_REQUIRED'
                : terms.kind === 'MEMBER_LIFETIME' &&
                    (current?.id !== (terms.previousId ?? undefined) ||
                      current?.state === 'REFUND_HELD')
                  ? 'REFUND_REQUIRED'
                  : 'ACCEPTED';
      const payment = await tx.paymentTransaction.create({
        data: {
          attemptId: attempt.id,
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
      await this.journal(
        tx,
        order,
        payment.id,
        amount,
        'center.paid:' + payment.id,
        true,
        disposition !== 'ACCEPTED',
      );
      if (disposition === 'ACCEPTED') {
        let memberId: string | null = null;
        if (terms.kind === 'MEMBER_LIFETIME') {
          if (current)
            await tx.memberPurchase.update({
              where: { id: current.id },
              data: { state: 'SUPERSEDED' },
            });
          const member = await tx.memberPurchase.create({
            data: {
              userId: order.userId,
              orderId: order.id,
              previousId: terms.previousId,
              tier: terms.tier,
              priceCredit: terms.grade!.price,
              giftTarget: Math.max(terms.grade!.voucherQuantity, current?.giftTarget ?? 0),
              goodsBasisPoints: terms.grade!.goodsBasisPoints,
              bookBasisPoints: terms.grade!.bookBasisPoints,
            },
          });
          memberId = member.id;
        }
        const quantity = terms.kind === 'VIDEO_VOUCHER' ? terms.quantity : terms.giftQuantity;
        if (quantity)
          await tx.videoVoucherLot.create({
            data: {
              userId: order.userId,
              orderId: order.id,
              memberPurchaseId: memberId,
              quantity,
              remaining: quantity,
              source: memberId ? 'MEMBERSHIP' : 'PURCHASE',
              unitPrice: memberId ? 0 : (terms.voucherPolicy?.price ?? voucherValue),
              faceValue: terms.voucherPolicy?.faceValue ?? voucherValue,
            },
          });
        await tx.tradeOrder.update({
          where: { id: order.id },
          data: {
            state: 'COMPLETED',
            paidAt,
            paidTotal: amount,
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.tradeOrderItem.update({ where: { id: item.id }, data: { state: 'DELIVERED' } });
      } else {
        if (!duplicate) {
          await tx.tradeOrder.update({
            where: { id: order.id },
            data: {
              state: 'CLOSED',
              closedAt: new Date(),
              closeReason: disposition,
              version: { increment: 1 },
            },
          });
          await tx.tradeOrderItem.update({ where: { id: item.id }, data: { state: 'CLOSED' } });
        }
        const refund = await tx.refund.create({
          data: {
            orderId: order.id,
            userId: order.userId,
            requestKey: 'center.anomaly:' + payment.id,
            kind: 'REFUND_ONLY',
            state: 'REFUNDING',
            requestedAmount: amount,
            approvedAmount: amount,
            reasonCode: disposition,
            description: '异常收款原路退回，不重复发放会员或代金券',
            paymentTransactionId: payment.id,
            channelRequestKey: 'R' + randomUUID().replaceAll('-', '').slice(0, 31),
          },
        });
        await tx.refundItem.create({
          data: {
            refundId: refund.id,
            orderItemId: item.id,
            quantity: 1,
            amount,
            revokeQuantity: 0,
          },
        });
        await this.refundJob(tx, refund.id);
      }
      await tx.notification.create({
        data: {
          userId: order.userId,
          kind: 'MEMBER_CENTER_ORDER',
          orderId: order.id,
          eventKey: 'center.paid:' + payment.id,
          title:
            disposition === 'ACCEPTED'
              ? terms.kind === 'VIDEO_VOUCHER'
                ? '视频代金券已到账'
                : '会员权益已生效'
              : '收款正在原路退回',
          body:
            disposition === 'ACCEPTED'
              ? '本次会员与代金券已按订单发放，可在会员中心查看。'
              : '本次未重复发放权益，请在订单查看退款进度。',
        },
      });
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { state: 'SUCCEEDED' } });
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
      await tx.auditLog.create({
        data: {
          actorId: order.userId,
          action: 'member.center.payment',
          resource: 'trade_order',
          resourceId: order.id,
          changes: { paymentId: payment.id, disposition },
        },
      });
      return { disposition };
    });
  }
  private refundJob(tx: Prisma.TransactionClient, id: string) {
    return tx.outboxJob.upsert({
      where: { eventKey: 'center.refund:' + id },
      create: {
        eventKey: 'center.refund:' + id,
        kind: 'MEMBER_CENTER_REFUND',
        aggregateType: 'MEMBER_CENTER_REFUND',
        aggregateId: id,
        payload: {},
        availableAt: new Date(),
      },
      update: {
        state: 'READY',
        availableAt: new Date(),
        lockedUntil: null,
        attempts: 0,
        lastErrorCode: null,
      },
    });
  }
  async requestRefund(id: string, userId: string, dto: ReturnRequest) {
    await this.owned(id, userId);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, userId, true);
      await tx.$queryRaw`SELECT id FROM "TradeOrder" WHERE id=${id} FOR UPDATE`;
      const old = await tx.refund.findFirst({ where: { userId, requestKey: dto.requestKey } });
      if (old) {
        if (
          old.orderId !== id ||
          old.description !== dto.reason.trim() ||
          (old.assessmentSnapshot as { quantity: number }).quantity !== (dto.quantity ?? 1)
        )
          throw new ConflictException('退款编号已用于其他申请');
        return;
      }
      const current = await tx.tradeOrder.findUniqueOrThrow({ where: { id } }),
        payment = await tx.paymentTransaction.findFirst({
          where: { orderId: id, disposition: 'ACCEPTED' },
        }),
        terms = this.terms(current);
      if (
        current.state !== 'COMPLETED' ||
        !payment ||
        (await tx.refund.count({
          where: { orderId: id, state: { in: ['REQUESTED', 'REFUNDING', 'FAILED'] } },
        }))
      )
        throw new ConflictException('订单不可退款或已有申请');
      const lot = await tx.videoVoucherLot.findUnique({ where: { orderId: id } });
      let quantity = dto.quantity ?? 1,
        amount: bigint;
      if (terms.kind === 'MEMBER_LIFETIME') {
        const member = await tx.memberPurchase.findUnique({ where: { orderId: id } });
        if (
          quantity !== 1 ||
          member?.state !== 'ACTIVE' ||
          Date.now() - payment.paidAt.getTime() > 7 * day ||
          (await tx.memberDiscountUse.count({
            where: { memberPurchaseId: member.id, state: { in: ['HELD', 'CONSUMED'] } },
          })) ||
          (lot && (lot.used > 0 || lot.held > 0 || lot.refundHeld > 0))
        )
          throw new ConflictException('仅支持付款7天内、尚未使用或占用本次权益的会员退款');
        await tx.memberPurchase.update({
          where: { id: member.id },
          data: { state: 'REFUND_HELD' },
        });
        if (lot)
          await tx.videoVoucherLot.update({ where: { id: lot.id }, data: { suspended: true } });
        amount = current.paidTotal - current.refundedTotal;
      } else {
        if (!lot || lot.suspended || quantity > lot.remaining)
          throw new ConflictException('可退代金券份数不足，请刷新');
        await tx.videoVoucherLot.update({
          where: { id: lot.id },
          data: { remaining: { decrement: quantity }, refundHeld: { increment: quantity } },
        });
        amount = BigInt(quantity * lot.unitPrice);
      }
      if (amount <= 0n || amount > current.paidTotal - current.refundedTotal)
        throw new ConflictException('退款金额超出剩余实付');
      const refund = await tx.refund.create({
        data: {
          orderId: id,
          userId,
          requestKey: dto.requestKey,
          kind: 'REFUND_ONLY',
          state: 'REQUESTED',
          requestedAmount: amount,
          paymentTransactionId: payment.id,
          reasonCode: 'MEMBER_CENTER_RETURN',
          description: dto.reason.trim(),
          channelRequestKey: 'R' + randomUUID().replaceAll('-', '').slice(0, 31),
          assessmentSnapshot: { quantity, lotId: lot?.id ?? null },
        },
      });
      const item = await tx.tradeOrderItem.findFirstOrThrow({ where: { orderId: id } });
      await tx.refundItem.create({
        data: {
          refundId: refund.id,
          orderItemId: item.id,
          quantity: 1,
          amount,
          revokeQuantity: terms.kind === 'MEMBER_LIFETIME' ? 1 : 0,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'member.center.refund.request',
          resource: 'refund',
          resourceId: refund.id,
          reason: dto.reason,
          changes: { quantity, amount: String(amount) },
        },
      });
    });
    return this.detail(id, userId);
  }
  async review(id: string, req: AuthRequest, dto: Review) {
    requireRoles(req, ['FINANCE']);
    const initial = await this.db.refund.findUniqueOrThrow({ where: { id } });
    await this.owned(initial.orderId, initial.userId);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, initial.userId);
      const refund = await tx.refund.findUniqueOrThrow({ where: { id } });
      if (
        refund.version !== dto.expectedVersion ||
        (dto.action === 'RETRY'
          ? !['REFUNDING', 'FAILED'].includes(refund.state)
          : refund.state !== 'REQUESTED')
      )
        throw new ConflictException('退款状态已变化，请刷新');
      const state = dto.action === 'REJECT' ? 'REJECTED' : 'REFUNDING';
      if (state === 'REJECTED')
        await this.releaseRefund(
          tx,
          refund.orderId,
          refund.assessmentSnapshot as { lotId: string | null; quantity: number },
        );
      await tx.refund.update({
        where: { id },
        data: {
          state,
          approvedAmount: state === 'REFUNDING' ? refund.requestedAmount : null,
          reviewerId: req.actor.id,
          reviewNote: dto.reason,
          failureCode: null,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (state === 'REFUNDING') await this.refundJob(tx, id);
      await tx.notification.create({
        data: {
          userId: refund.userId,
          kind: 'MEMBER_CENTER_ORDER',
          orderId: refund.orderId,
          eventKey: 'center.refund.review:' + id + ':' + (refund.version + 1),
          title: state === 'REJECTED' ? '退款申请未通过' : '退款正在办理',
          body: dto.reason.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'member.center.refund.' + dto.action,
          resource: 'refund',
          resourceId: id,
          reason: dto.reason,
          changes: { state },
        },
      });
    });
    return this.detail(initial.orderId, initial.userId);
  }
  private async releaseRefund(
    tx: Prisma.TransactionClient,
    orderId: string,
    assessment: { lotId: string | null; quantity: number },
  ) {
    const member = await tx.memberPurchase.findUnique({ where: { orderId } });
    if (member) {
      await tx.memberPurchase.update({ where: { id: member.id }, data: { state: 'ACTIVE' } });
      if (assessment.lotId)
        await tx.videoVoucherLot.update({
          where: { id: assessment.lotId },
          data: { suspended: false },
        });
    } else if (assessment.lotId)
      await tx.videoVoucherLot.update({
        where: { id: assessment.lotId },
        data: {
          remaining: { increment: assessment.quantity },
          refundHeld: { decrement: assessment.quantity },
        },
      });
  }
  async confirmRefund(data: WechatRefund, receivedChannel: AppPaymentChannel = channel) {
    const refund = await this.db.refund.findUnique({
      where: { channelRequestKey: data.out_refund_no },
    });
    if (!refund) throw new NotFoundException('退款不存在');
    const order = await this.owned(refund.orderId, refund.userId),
      payment = await this.db.paymentTransaction.findUniqueOrThrow({
        where: { id: refund.paymentTransactionId! },
      }),
      identity = this.channels.resolve(channel).identity(),
      state = data.refund_status ?? data.status;
    if (
      receivedChannel !== channel ||
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
      throw new BadRequestException('退款事实与原付款不一致');
    if (state === 'PROCESSING') return false;
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, order.userId);
      const current = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      if (current.state === 'SUCCEEDED') return true;
      if (!['REFUNDING', 'FAILED'].includes(current.state))
        throw new ConflictException('退款尚未审批');
      if (state !== 'SUCCESS') {
        await tx.refund.update({
          where: { id: refund.id },
          data: { state: 'FAILED', failureCode: state, version: { increment: 1 } },
        });
        return true;
      }
      if (
        !data.success_time ||
        !Number.isFinite(Date.parse(data.success_time)) ||
        Date.parse(data.success_time) > Date.now() + 300000
      )
        throw new BadRequestException('退款时间无效');
      const fact = await tx.refundTransaction.create({
        data: {
          refundId: refund.id,
          paymentTransactionId: payment.id,
          channel,
          appScope: identity.appid,
          externalRefundId: data.refund_id,
          amount: current.approvedAmount!,
          currency: 'CNY',
          verifiedAt: new Date(),
          succeededAt: new Date(data.success_time),
          receiptHash: hash(data),
        },
      });
      await this.journal(
        tx,
        order,
        payment.id,
        fact.amount,
        'center.refunded:' + refund.id,
        false,
        payment.disposition !== 'ACCEPTED',
        refund.id,
      );
      if (payment.disposition === 'ACCEPTED') {
        await tx.tradeOrder.update({
          where: { id: order.id },
          data: { refundedTotal: { increment: fact.amount }, version: { increment: 1 } },
        });
        if (current.reasonCode === 'MEMBER_CENTER_RETURN') {
          const assessment = current.assessmentSnapshot as {
              quantity: number;
              lotId: string | null;
            },
            member = await tx.memberPurchase.findUnique({ where: { orderId: order.id } });
          if (member) {
            await tx.memberPurchase.update({
              where: { id: member.id },
              data: { state: 'REVOKED' },
            });
            if (member.previousId)
              await tx.memberPurchase.update({
                where: { id: member.previousId },
                data: { state: 'ACTIVE' },
              });
            if (assessment.lotId) {
              const lot = await tx.videoVoucherLot.findUniqueOrThrow({
                where: { id: assessment.lotId },
              });
              if (lot.used || lot.held) throw new ConflictException('赠券账务异常，保留退款待核查');
              await tx.videoVoucherLot.update({
                where: { id: lot.id },
                data: { remaining: 0, refunded: { increment: lot.remaining }, suspended: true },
              });
            }
          } else if (assessment.lotId)
            await tx.videoVoucherLot.update({
              where: { id: assessment.lotId },
              data: {
                refundHeld: { decrement: assessment.quantity },
                refunded: { increment: assessment.quantity },
              },
            });
        }
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          state: 'SUCCEEDED',
          succeededAt: fact.succeededAt,
          failureCode: null,
          version: { increment: 1 },
        },
      });
      await tx.notification.create({
        data: {
          userId: order.userId,
          kind: 'MEMBER_CENTER_ORDER',
          orderId: order.id,
          eventKey: 'center.refunded:' + refund.id,
          title: '原路退款已完成',
          body: '支付渠道已确认退款，本次退回的会员或代金券已同步更新；具体金额请查看订单。',
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: order.userId,
          action: 'member.center.refund.confirm',
          resource: 'refund',
          resourceId: refund.id,
          changes: { amount: String(fact.amount) },
        },
      });
      return true;
    });
  }
  async voucherAdmin(page: Page) {
    const [policy, rows, total] = await Promise.all([
      voucherPolicy(this.db),
      this.db.videoVoucherLot.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.size,
        take: page.size,
      }),
      this.db.videoVoucherLot.count(),
    ]);
    const users = await this.db.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, nickname: true },
    });
    return {
      policy,
      lots: {
        items: rows.map((r) => ({
          ...r,
          nickname: users.find((u) => u.id === r.userId)?.nickname ?? '用户',
        })),
        total,
      },
    };
  }
  async editVoucher(req: AuthRequest, dto: VoucherPolicyEdit) {
    requireRoles(req, ['ADMIN']);
    if (dto.price > dto.faceValue) throw new BadRequestException('售价不能高于抵扣面额');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VideoVoucherPolicy" WHERE id=1 FOR UPDATE`;
      const before = await voucherPolicy(tx);
      if (before.version !== dto.expectedVersion)
        throw new ConflictException('代金券设置已变化，请刷新');
      const { expectedVersion: _, reason, ...data } = dto;
      const after = await tx.videoVoucherPolicy.update({
        where: { id: 1 },
        data: { ...data, title: data.title.trim(), version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'video.voucher.policy.update',
          resource: 'video_voucher_policy',
          resourceId: '1',
          reason,
          changes: { before, after },
        },
      });
      return after;
    });
  }
  async admin(page: Page) {
    const where = { kind: page.kind ?? { in: kinds } },
      [rows, total] = await this.db.$transaction([
        this.db.tradeOrder.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page.page - 1) * page.size,
          take: page.size,
        }),
        this.db.tradeOrder.count({ where }),
      ]);
    return {
      voucherPolicy: await voucherPolicy(this.db),
      grades: await this.db.membershipGrade.findMany({ orderBy: { tier: 'asc' } }),
      orders: { items: await Promise.all(rows.map((r) => this.detail(r.id, r.userId))), total },
    };
  }
  async adminOrder(id: string) {
    const order = await this.db.tradeOrder.findUnique({ where: { id } });
    if (!order || !kinds.includes(order.kind))
      throw new NotFoundException('会员或代金券订单不存在');
    return this.detail(id, order.userId);
  }
  async edit(tier: number, req: AuthRequest, dto: GradeEdit) {
    requireRoles(req, ['ADMIN']);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT tier FROM "MembershipGrade" ORDER BY tier FOR UPDATE`;
      const old = await tx.membershipGrade.findUniqueOrThrow({ where: { tier } });
      if (old.version !== dto.expectedVersion)
        throw new ConflictException('等级设置已变化，请刷新');
      const rows = await tx.membershipGrade.findMany({ orderBy: { tier: 'asc' } });
      rows[tier - 1] = { ...old, ...dto };
      if (
        rows.some(
          (r, i) =>
            i > 0 &&
            (r.price <= rows[i - 1]!.price || r.voucherQuantity < rows[i - 1]!.voucherQuantity),
        )
      )
        throw new BadRequestException('更高等级的价格须递增，赠券总份数不得减少');
      const changed = await tx.membershipGrade.update({
        where: { tier },
        data: {
          price: dto.price,
          voucherQuantity: dto.voucherQuantity,
          goodsBasisPoints: dto.goodsBasisPoints,
          bookBasisPoints: dto.bookBasisPoints,
          active: dto.active,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          action: 'member.center.grade.update',
          resource: 'membership_grade',
          resourceId: String(tier),
          reason: dto.reason,
          changes: { before: old, after: changed },
        },
      });
      return changed;
    });
  }
  async runJobs() {
    if (this.working) return;
    this.working = true;
    try {
      for (let i = 0; i < 10; i++) {
        const jobs = await this.db.$queryRaw<
          { id: string; kind: string; aggregateId: string; attempts: number }[]
        >`UPDATE "OutboxJob" SET state='RUNNING',"lockedUntil"=now()+interval '2 minutes',attempts=attempts+1,"updatedAt"=now() WHERE id=(SELECT id FROM "OutboxJob" WHERE kind IN ('MEMBER_CENTER_CHECK','MEMBER_CENTER_REFUND') AND ((state='READY' AND "availableAt"<=now()) OR (state='RUNNING' AND "lockedUntil"<now())) ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,kind,"aggregateId",attempts`;
        if (!jobs.length) break;
        const job = jobs[0]!;
        let done = true;
        try {
          if (job.kind === 'MEMBER_CENTER_CHECK') {
            const o = await this.db.tradeOrder.findUniqueOrThrow({
              where: { id: job.aggregateId },
            });
            if (o.state === 'PENDING') {
              if (await this.db.paymentAttempt.count({ where: { orderId: o.id } }))
                await this.refresh(o.id, o.userId);
              else await this.cancel(o.id, o.userId, 'TIMEOUT');
              done =
                (await this.db.tradeOrder.findUniqueOrThrow({ where: { id: o.id } })).state !==
                'PENDING';
            }
          } else {
            const r = await this.db.refund.findUniqueOrThrow({ where: { id: job.aggregateId } });
            if (['REFUNDING', 'FAILED'].includes(r.state)) {
              const p = await this.db.paymentTransaction.findUniqueOrThrow({
                  where: { id: r.paymentTransactionId! },
                }),
                o = await this.db.tradeOrder.findUniqueOrThrow({ where: { id: r.orderId } });
              done = await this.confirmRefund(
                await this.channels
                  .resolve(channel)
                  .refund(
                    p.externalTransactionId,
                    r.channelRequestKey!,
                    Number(r.approvedAmount),
                    Number(p.amount),
                    o.orderNo,
                  ),
              );
            }
          }
          await this.db.outboxJob.update({
            where: { id: job.id },
            data: {
              state: done ? 'DONE' : 'READY',
              lockedUntil: null,
              availableAt: new Date(Date.now() + 60000),
              completedAt: done ? new Date() : null,
            },
          });
        } catch {
          await this.db.outboxJob.update({
            where: { id: job.id },
            data: {
              state: job.attempts >= 20 ? 'DEAD' : 'READY',
              lockedUntil: null,
              availableAt: new Date(Date.now() + 60000 * Math.min(job.attempts, 60)),
              lastErrorCode: 'MEMBER_CENTER_PROVIDER_CHECK',
            },
          });
        }
      }
    } finally {
      this.working = false;
    }
  }
}

@Controller('membership-center')
export class MemberCenterController {
  constructor(private readonly center: MemberCenter) {}
  @Get() @UseGuards(OptionalUserGuard) overview(@Req() req: AuthRequest) {
    return this.center.overview(req.actor?.id);
  }
  @Get('quote') @UseGuards(OptionalUserGuard) quote(
    @Req() req: AuthRequest,
    @Query() dto: Selection,
  ) {
    return this.center.quote(req.actor?.id, dto);
  }
  @Get('vouchers') @UseGuards(UserGuard) wallet(@Req() req: AuthRequest, @Query() page: Page) {
    return this.center.wallet(req.actor.id, page);
  }
  @Post('orders') @UseGuards(UserGuard) checkout(@Req() req: AuthRequest, @Body() dto: Checkout) {
    return this.center.checkout(req.actor.id, dto);
  }
  @Get('orders') @UseGuards(UserGuard) list(@Req() req: AuthRequest, @Query() page: Page) {
    return this.center.list(req.actor.id, page);
  }
  @Get('orders/:id') @UseGuards(UserGuard) detail(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.center.detail(id, req.actor.id);
  }
  @Post('orders/:id/payment') @UseGuards(UserGuard) prepay(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.center.prepay(id, req.actor.id);
  }
  @Post('orders/:id/refresh') @UseGuards(UserGuard) refresh(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.center.refresh(id, req.actor.id);
  }
  @Post('orders/:id/cancel') @UseGuards(UserGuard) cancel(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.center.cancel(id, req.actor.id);
  }
  @Post('orders/:id/refund') @UseGuards(UserGuard) refund(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnRequest,
  ) {
    return this.center.requestRefund(id, req.actor.id, dto);
  }
}
@Controller('admin/membership-center')
@UseGuards(AdminGuard)
export class MemberCenterAdminController {
  constructor(private readonly center: MemberCenter) {}
  @Get() overview(@Query() page: Page) {
    return this.center.admin(page);
  }
  @Get('voucher-settings') voucherSettings(@Query() page: Page) {
    return this.center.voucherAdmin(page);
  }
  @Put('voucher-settings') saveVoucher(@Req() req: AuthRequest, @Body() dto: VoucherPolicyEdit) {
    return this.center.editVoucher(req, dto);
  }
  @Get('orders/:id') order(@Param('id', ParseUUIDPipe) id: string) {
    return this.center.adminOrder(id);
  }
  @Put('grades/:tier') edit(
    @Req() req: AuthRequest,
    @Param('tier') tier: string,
    @Body() dto: GradeEdit,
  ) {
    const value = Number(tier);
    if (!Number.isInteger(value) || value < 1 || value > 4)
      throw new BadRequestException('会员等级无效');
    return this.center.edit(value, req, dto);
  }
  @Post('refunds/:id/review') review(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Review,
  ) {
    return this.center.review(id, req, dto);
  }
}
