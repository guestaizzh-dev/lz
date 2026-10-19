import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { createHash } from 'node:crypto';
import { AdminGuard, requireRoles, type AuthRequest } from './auth.js';
import { Database } from './database.js';
import { Prisma } from './generated/prisma/client.js';

export const recoveryKinds = [
  'CONSUMPTION_SYNC','GIFT_PAYMENT_CHECK','GIFT_REFUND','AUTH_APPLE_REVOKE', 'NOTIFICATION_PUSH', 'COURSE_PAYMENT_CHECK', 'COURSE_REFUND', 'COURSE_DELIVERY_NOTICE',
  'MEMBERSHIP_PAYMENT_CHECK', 'MEMBERSHIP_REFUND', 'PRODUCT_PAYMENT_CHECK', 'PRODUCT_REFUND',
  'BOOKING_PAYMENT_CHECK', 'BOOKING_REFUND', 'BOOKING_CANCEL_COMPENSATION',
  'COHORT_PAYMENT_CHECK', 'COHORT_REFUND', 'COHORT_SCHEDULE_COMPENSATION',
] as const;
const safe = <T>(value: T) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item));
const jobSelect = { id: true, version: true, kind: true, aggregateType: true, aggregateId: true, state: true, attempts: true, availableAt: true, lockedUntil: true, lastErrorCode: true, completedAt: true, updatedAt: true, createdAt: true } as const;
const revision = (row: object) => createHash('sha256').update(JSON.stringify(Object.keys(jobSelect).map(key => row[key as keyof typeof row]))).digest('hex');

class OperationsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
  @IsOptional() @IsString() @Length(0, 80) q?: string;
  @IsOptional() @IsIn(['READY', 'RUNNING', 'DEAD', 'DONE']) state?: string;
  @IsOptional() @IsIn(recoveryKinds) kind?: string;
}
class RetryJobDto {
  @IsString() @Length(64, 64) expectedRevision!: string;
  @IsString() @Length(2, 500) reason!: string;
}
class FinanceQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size = 20;
  @IsOptional() @IsString() @Length(0, 80) q?: string;
  @IsOptional() @IsIn(['COURSE', 'MEMBERSHIP', 'PHYSICAL', 'CONSULTATION', 'EVENT', 'COHORT', 'GIFT']) kind?: string;
  @IsOptional() @IsIn(['WECHAT_APP', 'ALIPAY_APP', 'APPLE_IAP']) channel?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export function financePeriod(query: { from?: string; to?: string }) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('日期范围应为正序且不超过366天');
  return { from, to };
}

@Injectable()
export class OperationsAdmin {
  constructor(private readonly db: Database) {}

  async jobSummary() {
    return this.db.$transaction(async tx => {
      const now = new Date();
      const counts = await tx.outboxJob.groupBy({ by: ['state'], _count: { _all: true } });
      return { counts: { READY: 0, RUNNING: 0, DEAD: 0, DONE: 0, ...Object.fromEntries(counts.map(row => [row.state, row._count._all])) },
        overdue: await tx.outboxJob.count({ where: { state: 'READY', availableAt: { lt: new Date(now.getTime() - 5 * 60000) } } }),
        expiredLeases: await tx.outboxJob.count({ where: { state: 'RUNNING', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } }),
        oldestPendingAt: (await tx.outboxJob.findFirst({ where: { state: { in: ['READY', 'RUNNING', 'DEAD'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt ?? null,
        checkedAt: now,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async jobs(query: OperationsQuery) {
    const where: Prisma.OutboxJobWhereInput = {
      ...(query.state ? { state: query.state } : {}), ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q?.trim() ? { OR: [{ id: query.q.trim() }, { aggregateId: query.q.trim() }, { kind: { contains: query.q.trim(), mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.outboxJob.findMany({ where, select: jobSelect, orderBy: [{ availableAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.size, take: query.size }),
      this.db.outboxJob.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: items.map(row => ({ ...row, revision: revision(row), retryable: row.state === 'DEAD' && !(row.kind==='NOTIFICATION_PUSH'&&row.lastErrorCode==='PUSH_AMBIGUOUS') && recoveryKinds.includes(row.kind as typeof recoveryKinds[number]) && (!row.lockedUntil || row.lockedUntil <= new Date()) })), total };
  }

  async job(id: string) {
    const row = await this.db.outboxJob.findUnique({ where: { id }, select: jobSelect });
    if (!row) throw new NotFoundException('任务不存在');
    let orderId: string | undefined;
    if (['COURSE_ORDER', 'MEMBERSHIP_ORDER', 'PRODUCT_ORDER', 'BOOKING_ORDER', 'COHORT_ORDER'].includes(row.aggregateType) || row.kind.endsWith('PAYMENT_CHECK') || row.kind === 'COURSE_DELIVERY_NOTICE') orderId = row.aggregateId;
    if (row.kind.endsWith('_REFUND')) orderId = (await this.db.refund.findUnique({ where: { id: row.aggregateId }, select: { orderId: true } }))?.orderId;
    const order = orderId ? await this.db.tradeOrder.findUnique({ where: { id: orderId }, select: { id: true, orderNo: true, kind: true, state: true } }) : null;
    const audit = await this.db.auditLog.findMany({ where: { resource: 'outbox_job', resourceId: id, action: 'operations.job.retry' }, select: { id: true, createdAt: true, actorId: true, reason: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
    const pushDeliveries=row.kind==='NOTIFICATION_PUSH'?await this.db.notificationDelivery.findMany({where:{notificationId:row.aggregateId},select:{id:true,state:true,attempts:true,providerMessageId:true,failureCode:true,updatedAt:true},orderBy:{createdAt:'desc'},take:20}):[];
    return { ...row, revision: revision(row), order, audit, pushDeliveries, retryable: row.state === 'DEAD' && !(row.kind==='NOTIFICATION_PUSH'&&row.lastErrorCode==='PUSH_AMBIGUOUS') && recoveryKinds.includes(row.kind as typeof recoveryKinds[number]) && (!row.lockedUntil || row.lockedUntil <= new Date()) };
  }

  async retry(req: AuthRequest, id: string, dto: RetryJobDto) {
    requireRoles(req, ['ADMIN']);
    if (dto.reason.trim().length < 2) throw new BadRequestException('请填写核查原因');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "OutboxJob" WHERE id=${id} FOR UPDATE`;
      const row = await tx.outboxJob.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('任务不存在');
      if (revision(row) !== dto.expectedRevision) throw new ConflictException('任务已变化，请刷新后核查最新状态');
      if (row.state !== 'DEAD' || row.lockedUntil && row.lockedUntil > new Date()) throw new ConflictException('仅可重试没有有效执行租约的失败任务');
      if (!recoveryKinds.includes(row.kind as typeof recoveryKinds[number])) throw new BadRequestException('该任务尚未接通安全人工恢复，不能重试');
      if(row.kind==='NOTIFICATION_PUSH'&&row.lastErrorCode==='PUSH_AMBIGUOUS')throw new ConflictException('推送结果不确定，请先核对云网关记录，不能盲目重复发送；站内消息仍可正常查看');
      let payload = row.payload as Prisma.InputJsonValue;
      // Reset only the worker failure counter; preserve compensation cursor and original business identity.
      if (['COHORT_SCHEDULE_COMPENSATION', 'COURSE_DELIVERY_NOTICE'].includes(row.kind)) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ConflictException('任务内容异常，需开发维护人员核查');
        payload = { ...payload, [row.kind === 'COURSE_DELIVERY_NOTICE' ? 'deliveryFailures' : 'failures']: 0 };
      }
      await tx.outboxJob.update({ where: { id }, data: { state: 'READY', attempts: 0, availableAt: new Date(), lockedUntil: null, workerId: null, completedAt: null, lastErrorCode: null, payload, version: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: 'operations.job.retry', resource: 'outbox_job', resourceId: id, reason: dto.reason.trim(), requestId: req.requestId ?? '', changes: { kind: row.kind, previousAttempts: row.attempts, previousErrorCode: row.lastErrorCode } } });
      return { queued: true, message: '任务已重新排队；实际执行结果由原业务执行器确认' };
    });
  }

  private filter(query: FinanceQuery) {
    const { from, to } = financePeriod(query);
    const conditions = [Prisma.sql`o.kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT','COHORT')`];
    if (query.kind) conditions.push(Prisma.sql`o.kind=${query.kind}`);
    if (query.q?.trim()) conditions.push(Prisma.sql`position(lower(${query.q.trim()}) in lower(o."orderNo"))>0`);
    return { from, to, where: Prisma.join(conditions, ' AND ') };
  }

  async financeSummary(query: FinanceQuery) {
    const { from, to, where } = this.filter(query);
    const paymentChannel = query.channel ? Prisma.sql`AND p.channel=${query.channel}` : Prisma.empty;
    return this.db.$transaction(async tx => {
      const payments = await tx.$queryRaw<{ currency: string; accepted: string; abnormal: string; count: number }[]>`
        SELECT p.currency,coalesce(sum(p.amount) FILTER(WHERE p.disposition='ACCEPTED'),0)::text accepted,
        coalesce(sum(p.amount) FILTER(WHERE p.disposition<>'ACCEPTED'),0)::text abnormal,count(*)::int count
        FROM "PaymentTransaction" p JOIN "TradeOrder" o ON o.id=p."orderId"
        WHERE ${where} AND p."paidAt">=${from} AND p."paidAt"<${to} ${paymentChannel} GROUP BY p.currency`;
      // Immutable channel facts retain the original expenditure even after an Apple refund reversal.
      const refunds = await tx.$queryRaw<{ currency: string; amount: string; count: number }[]>`
        SELECT f.currency,coalesce(sum(f.amount),0)::text amount,count(*)::int count
        FROM "RefundTransaction" f JOIN "Refund" r ON r.id=f."refundId" JOIN "PaymentTransaction" p ON p.id=f."paymentTransactionId" JOIN "TradeOrder" o ON o.id=r."orderId"
        WHERE ${where} AND f."succeededAt">=${from} AND f."succeededAt"<${to} ${paymentChannel} GROUP BY f.currency`;
      const reversals = await tx.$queryRaw<{ currency: string; amount: string; count: number }[]>`
        SELECT j.currency,coalesce(sum(e.debit),0)::text amount,count(DISTINCT j.id)::int count
        FROM "FinanceJournal" j JOIN "FinanceEntry" e ON e."journalId"=j.id JOIN "PaymentTransaction" p ON p.id=j."transactionId" JOIN "TradeOrder" o ON o.id=j."orderId"
        WHERE ${where} AND j.kind IN ('COURSE_REFUND_REVERSAL','MEMBERSHIP_REFUND_REVERSAL') AND j."reversalOfId" IS NOT NULL
        AND j."postedAt">=${from} AND j."postedAt"<${to} ${paymentChannel} GROUP BY j.currency`;
      return { from, to, currencies: [...new Set([...payments, ...refunds, ...reversals].map(row => row.currency))].map(currency => {
        const paid = payments.find(row => row.currency === currency), refunded = refunds.find(row => row.currency === currency), reversal = reversals.find(row => row.currency === currency);
        const netRefund = BigInt(refunded?.amount ?? '0') - BigInt(reversal?.amount ?? '0');
        return { currency, accepted: paid?.accepted ?? '0', abnormal: paid?.abnormal ?? '0', refunded: String(netRefund), refundReversed: reversal?.amount ?? '0', cashDifference: String(BigInt(paid?.accepted ?? '0') + BigInt(paid?.abnormal ?? '0') - netRefund), paymentCount: paid?.count ?? 0, refundCount: refunded?.count ?? 0, reversalCount: reversal?.count ?? 0 };
      }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async financeList(type: 'payments' | 'refunds' | 'journals', query: FinanceQuery) {
    const { from, to, where } = this.filter(query);
    const channel = query.channel ? Prisma.sql`AND p.channel=${query.channel}` : Prisma.empty;
    let base: Prisma.Sql;
    if (type === 'payments') base = Prisma.sql`
      SELECT p.id,p.channel,p.currency,p.amount::text amount,p.disposition state,p."paidAt" "occurredAt",
      p."externalTransactionId",o.id "orderId",o."orderNo",o.kind "orderKind"
      FROM "PaymentTransaction" p JOIN "TradeOrder" o ON o.id=p."orderId"
      WHERE ${where} AND p."paidAt">=${from} AND p."paidAt"<${to} ${channel}`;
    else if (type === 'refunds') base = Prisma.sql`
      SELECT r.id,p.channel,o.currency,coalesce(r."approvedAmount",r."requestedAmount")::text amount,r.state,r."createdAt" "occurredAt",r."succeededAt",r."reasonCode",r."failureCode",o.id "orderId",o."orderNo",o.kind "orderKind"
      FROM "Refund" r JOIN "TradeOrder" o ON o.id=r."orderId" LEFT JOIN "PaymentTransaction" p ON p.id=r."paymentTransactionId"
      WHERE ${where} AND r.kind<>'EXCHANGE' AND r."createdAt">=${from} AND r."createdAt"<${to} ${channel}`;
    else {
      // Channel-filtered journals must belong to a verified payment/refund, not merely share an order.
      const journalChannel = query.channel ? Prisma.sql`AND EXISTS(SELECT 1 FROM "PaymentTransaction" p WHERE p.channel=${query.channel} AND (p.id=j."transactionId" OR p.id=(SELECT r."paymentTransactionId" FROM "Refund" r WHERE r.id=j."refundId")))` : Prisma.empty;
      base = Prisma.sql`
        SELECT j.id,j.kind,j.currency,j.description,j."postedAt" "occurredAt",o.id "orderId",o."orderNo",o.kind "orderKind",
        coalesce(sum(e.debit),0)::text debit,coalesce(sum(e.credit),0)::text credit,
        count(e.id)::int "entryCount",(count(e.id)>0 AND coalesce(sum(e.debit),0)=coalesce(sum(e.credit),0)) balanced
        FROM "FinanceJournal" j JOIN "TradeOrder" o ON o.id=j."orderId" LEFT JOIN "FinanceEntry" e ON e."journalId"=j.id
        WHERE ${where} AND j."postedAt">=${from} AND j."postedAt"<${to} ${journalChannel}
        GROUP BY j.id,o.id`;
    }
    const [items, count] = await this.db.$transaction([
      this.db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM (${base}) rows ORDER BY "occurredAt" DESC,id DESC LIMIT ${query.size} OFFSET ${(query.page - 1) * query.size}`),
      this.db.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int total FROM (${base}) rows`),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items, total: count[0]?.total ?? 0, from, to };
  }

  async financeOrder(id: string) {
    return this.db.$transaction(async tx => {
      const order = await tx.tradeOrder.findUnique({ where: { id }, select: { id: true, orderNo: true, kind: true, state: true, currency: true, payableTotal: true, paidTotal: true, refundedTotal: true, createdAt: true, paidAt: true } });
      if (!order || !['COURSE', 'MEMBERSHIP', 'PHYSICAL', 'CONSULTATION', 'EVENT', 'COHORT', 'GIFT'].includes(order.kind)) throw new NotFoundException('订单不存在或不在当前财务范围');
      const [payments, refunds, journals] = await Promise.all([
        tx.paymentTransaction.findMany({ where: { orderId: id }, select: { id: true, channel: true, amount: true, currency: true, disposition: true, externalTransactionId: true, paidAt: true, verifiedAt: true }, orderBy: { paidAt: 'desc' } }),
        tx.refund.findMany({ where: { orderId: id, kind: { not: 'EXCHANGE' } }, select: { id: true, requestedAmount: true, approvedAmount: true, state: true, reasonCode: true, createdAt: true, succeededAt: true, failureCode: true }, orderBy: { createdAt: 'desc' } }),
        tx.financeJournal.findMany({ where: { orderId: id }, select: { id: true, kind: true, description: true, currency: true, postedAt: true }, orderBy: { postedAt: 'desc' }, take: 100 }),
      ]);
      const entries = await tx.financeEntry.findMany({ where: { journalId: { in: journals.map(row => row.id) } }, select: { id: true, journalId: true, accountCode: true, debit: true, credit: true }, orderBy: { id: 'asc' } });
      const accounts = await tx.financeAccount.findMany({ where: { code: { in: entries.map(row => row.accountCode) } }, select: { code: true, title: true } });
      return safe({ order, payments, refunds, journals: journals.map(journal => {
        const lines = entries.filter(row => row.journalId === journal.id);
        return { ...journal, balanced: lines.length > 0 && lines.reduce((sum, row) => sum + row.debit - row.credit, 0n) === 0n, entries: lines.map(row => ({ ...row, accountName: accounts.find(account => account.code === row.accountCode)?.title ?? row.accountCode })) };
      }), journalsLimited: journals.length === 100 });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

@Controller('admin/operations') @UseGuards(AdminGuard)
export class OperationsAdminController {
  constructor(private readonly operations: OperationsAdmin) {}
  @Get('summary') summary() { return this.operations.jobSummary(); }
  @Get('jobs') jobs(@Query() query: OperationsQuery) { return this.operations.jobs(query); }
  @Get('jobs/:id') job(@Param('id', ParseUUIDPipe) id: string) { return this.operations.job(id); }
  @Post('jobs/:id/retry') retry(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryJobDto) { return this.operations.retry(req, id, dto); }
}

@Controller('admin/finance') @UseGuards(AdminGuard)
export class FinanceAdminController {
  constructor(private readonly operations: OperationsAdmin) {}
  @Get('summary') summary(@Query() query: FinanceQuery) { return this.operations.financeSummary(query); }
  @Get('payments') payments(@Query() query: FinanceQuery) { return this.operations.financeList('payments', query); }
  @Get('refunds') refunds(@Query() query: FinanceQuery) { return this.operations.financeList('refunds', query); }
  @Get('journals') journals(@Query() query: FinanceQuery) { return this.operations.financeList('journals', query); }
  @Get('orders/:id') order(@Param('id', ParseUUIDPipe) id: string) { return this.operations.financeOrder(id); }
}
