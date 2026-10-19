export const orderPages: Record<string, string> = { GIFT:'/gifts',COURSE: '/course-orders', MEMBERSHIP: '/membership-orders', PHYSICAL: '/orders', CONSULTATION: '/booking-orders', EVENT: '/booking-orders', COHORT: '/cohort-orders' };
export const businessNames: Record<string, string> = { GIFT:'礼物余额',COURSE: '课程', MEMBERSHIP: '会员', PHYSICAL: '商品', CONSULTATION: '咨询预约', EVENT: '活动报名', COHORT: '训练营' };
export const channelNames: Record<string, string> = { WECHAT_APP: '微信支付', ALIPAY_APP: '支付宝', APPLE_IAP: 'Apple 内购' };
export function orderLink(order: { kind: string; id: string }) {
  return orderPages[order.kind] ? `${orderPages[order.kind]}?orderId=${encodeURIComponent(order.id)}` : undefined;
}
export function currencyAmount(value: string | null | undefined, currency = 'CNY') {
  if (value == null) return '—';
  const amount = BigInt(value), abs = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${currency === 'CNY' ? '¥' : currency + ' '}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
