import { ConflictException } from '@nestjs/common';
import type { Database } from './database.js';
import type { Prisma } from './generated/prisma/client.js';
type Store = Database | Prisma.TransactionClient;
export const voucherValue = 300;
export async function currentLongTermMember(store: Store, userId: string) {
  return store.memberPurchase.findFirst({
    where: { userId, state: { in: ['ACTIVE', 'REFUND_HELD'] } },
    orderBy: { createdAt: 'desc' },
  });
}
export type VoucherAllocation = { lotId: string; quantity: number; value: number };
export async function voucherPolicy(store: Store) {
  return store.videoVoucherPolicy.findUniqueOrThrow({ where: { id: 1 } });
}
export async function voucherQuote(
  store: Store,
  userId: string | undefined,
  amount: bigint,
  requested: number,
  eligible: boolean,
) {
  if (!Number.isSafeInteger(requested) || requested < 0 || requested > 100000)
    throw new ConflictException('代金券份数无效');
  const lots = userId
    ? await store.videoVoucherLot.findMany({
        where: { userId, suspended: false, remaining: { gt: 0 } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  const available = lots.reduce((n, l) => n + l.remaining, 0);
  const availableValue = lots.reduce((n, l) => n + l.remaining * l.faceValue, 0);
  function allocate(count: number) {
    let left = count,
      balance = amount;
    const allocations: VoucherAllocation[] = [];
    if (eligible)
      for (const lot of lots) {
        const quantity = Math.min(left, lot.remaining, Number(balance / BigInt(lot.faceValue)));
        if (!quantity) continue;
        allocations.push({ lotId: lot.id, quantity, value: lot.faceValue });
        balance -= BigInt(quantity * lot.faceValue);
        left -= quantity;
        if (!left) break;
      }
    return { allocations, quantity: count - left, discount: Number(amount - balance) };
  }
  const maximum = allocate(100000).quantity;
  if (requested > maximum)
    throw new ConflictException(
      eligible ? '代金券余额或可抵扣份数已变化，请重新确认' : '代金券仅用于付费视频',
    );
  const selected = allocate(requested);
  return {
    quantity: requested,
    value:
      lots.length && lots.every((l) => l.faceValue === lots[0]!.faceValue) ? lots[0]!.faceValue : 0,
    discount: selected.discount,
    available,
    availableValue,
    maximum,
    allocations: selected.allocations,
  };
}
export async function holdVideoVouchers(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  allocations: VoucherAllocation[],
) {
  // The owning checkout locks User; bind the quote to exact lots and immutable denominations.
  for (const item of allocations) {
    const changed = await tx.videoVoucherLot.updateMany({
      where: {
        id: item.lotId,
        userId,
        suspended: false,
        faceValue: item.value,
        remaining: { gte: item.quantity },
      },
      data: { remaining: { decrement: item.quantity }, held: { increment: item.quantity } },
    });
    if (changed.count !== 1) throw new ConflictException('可用代金券已变化，请重新确认');
    await tx.videoVoucherAllocation.create({
      data: { lotId: item.lotId, orderId, quantity: item.quantity },
    });
  }
}
export async function videoVouchersReady(store: Store, orderId: string) {
  const rows = await store.videoVoucherAllocation.findMany({ where: { orderId, state: 'HELD' } });
  return (
    !rows.length ||
    (await store.videoVoucherLot.count({
      where: { id: { in: rows.map((r) => r.lotId) }, suspended: false },
    })) === rows.length
  );
}
export async function finishVideoVouchers(
  tx: Prisma.TransactionClient,
  orderId: string,
  action: 'CONSUMED' | 'RELEASED' | 'RETURNED',
) {
  const order = await tx.tradeOrder.findUniqueOrThrow({ where: { id: orderId } });
  const rows = await tx.videoVoucherAllocation.findMany({
    where: { orderId, state: action === 'RETURNED' ? 'CONSUMED' : 'HELD' },
    orderBy: { lotId: 'asc' },
  });
  let purchasedValue = 0n;
  for (const row of rows) {
    const lot = await tx.videoVoucherLot.findUniqueOrThrow({ where: { id: row.lotId } });
    await tx.videoVoucherLot.update({
      where: { id: row.lotId },
      data:
        action === 'CONSUMED'
          ? { held: { decrement: row.quantity }, used: { increment: row.quantity } }
          : action === 'RELEASED'
            ? { held: { decrement: row.quantity }, remaining: { increment: row.quantity } }
            : { used: { decrement: row.quantity }, remaining: { increment: row.quantity } },
    });
    await tx.videoVoucherAllocation.update({ where: { id: row.id }, data: { state: action } });
    if (lot.source === 'PURCHASE') purchasedValue += BigInt(row.quantity * lot.unitPrice);
  }
  if (purchasedValue > 0n && action !== 'RELEASED') {
    const incoming = action === 'CONSUMED';
    const journal = await tx.financeJournal.create({
      data: {
        eventKey: 'video.voucher:' + action + ':' + orderId,
        kind: 'VIDEO_VOUCHER_REDEEM',
        orderId,
        currency: 'CNY',
        postedAt: new Date(),
        description: incoming ? '已购代金券兑换视频' : '视频退款退回已购代金券',
      },
    });
    await tx.financeEntry.createMany({
      data: [
        {
          journalId: journal.id,
          accountCode: incoming ? 'VIDEO_VOUCHER_LIABILITY' : 'COURSE_REVENUE',
          debit: purchasedValue,
          userId: order.userId,
        },
        {
          journalId: journal.id,
          accountCode: incoming ? 'COURSE_REVENUE' : 'VIDEO_VOUCHER_LIABILITY',
          credit: purchasedValue,
          userId: order.userId,
        },
      ],
    });
  }
}
export async function holdMemberDiscount(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  memberId: string,
) {
  const member = await currentLongTermMember(tx, userId);
  if (member?.id !== memberId || member.state !== 'ACTIVE')
    throw new ConflictException('会员优惠已变化，请重新确认');
  await tx.memberDiscountUse.upsert({
    where: { memberPurchaseId_orderId: { memberPurchaseId: memberId, orderId } },
    create: { memberPurchaseId: memberId, orderId },
    update: {},
  });
}
export async function longTermDiscountReady(store: Store, orderId: string) {
  const held = await store.memberDiscountUse.findMany({ where: { orderId, state: 'HELD' } });
  return (
    !held.length ||
    (await store.memberPurchase.count({
      where: { id: { in: held.map((h) => h.memberPurchaseId) }, state: 'ACTIVE' },
    })) === held.length
  );
}
export async function finishMemberDiscount(
  tx: Prisma.TransactionClient,
  orderId: string,
  state: 'CONSUMED' | 'RELEASED' | 'RETURNED',
) {
  await tx.memberDiscountUse.updateMany({
    where: { orderId, state: state === 'RETURNED' ? 'CONSUMED' : 'HELD' },
    data: { state },
  });
}
